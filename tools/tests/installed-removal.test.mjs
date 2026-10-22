import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmRemoval, previewRemoval, removalOutcome } from '../../src/app/installed-removal.js';

// A fake host that behaves like Core's managed removal: an item is retained while another installed item requires it.
const project = 'C:\\Temp\\proof\\sample-js-app';
function fakeHost({ requires = {}, members = {}, applyResult, script = {} } = {}) {
  const installed = new Set(Object.keys(members)), calls = [];
  let session = 0;
  const sessions = new Map();
  const review = id => ({ target: { project }, reviewDigest: `d-${id}-${session}`, operations: members[id].map((path, index) => ({
    id: `lifecycle/remove-${index}`, kind: 'file.remove', effects: 'remove-file', details: { target: `${project}\\${path}` } })) });
  const host = async (operation, body) => {
    calls.push([operation, body.managementId ?? body.sessionId]);
    const scripted = script[`${operation}:${body.managementId ?? ''}`]; if (scripted) return scripted();
    if (operation === 'remove') {
      const id = body.managementId;
      if (!installed.has(id)) return { disposition: 'absent', diagnostics: [] };
      if ([...installed].some(other => requires[other]?.includes(id))) return { disposition: 'retained', diagnostics: [{ reason: 'dependency-retained', message: 'Another managed selection still requires this one, so its claim is retained.' }] };
      session++; const sessionId = `s${session}`, prepared = review(id); sessions.set(sessionId, { id, prepared });
      return { disposition: 'prepared', diagnostics: [], preparation: { status: 'ready', sessionId, review: prepared } };
    }
    const held = sessions.get(body.sessionId);
    if (!held || held.prepared.reviewDigest !== body.reviewDigest) return { status: 'rejected', diagnostics: [{ message: 'digest-mismatch' }] };
    if (applyResult) return applyResult(held);
    installed.delete(held.id);
    return { completion: 'complete', diagnostics: [], operations: held.prepared.operations.map(operation => ({ id: operation.id, application: 'applied', verification: { status: 'passed' } })) };
  };
  return { host, calls, installed };
}
const entry = (name, memberCount = 2) => ({ name, managementId: `m-${name}`, scope: 'project', memberCount });
const grill = { members: { 'm-grill-me': ['.claude\\skills\\grill-me\\SKILL.md', '.claude\\skills\\grill-me\\LICENSE'], 'm-grilling': ['.claude\\skills\\grilling\\SKILL.md', '.claude\\skills\\grilling\\LICENSE'] },
  requires: { 'm-grill-me': ['m-grilling'] } };

test('the preview shows the files of the first item and says the needed items are prepared after it', async () => {
  const { host, installed } = fakeHost(grill);
  const preview = await previewRemoval({ entries: [entry('grill-me'), entry('grilling')], host, mode: 'vibe' });
  assert.equal(preview.canConfirm, true);
  assert.deepEqual(preview.steps.map(step => step.state), ['ready', 'after']);
  assert.deepEqual(preview.steps[0].files.map(file => file.path), ['.claude/skills/grill-me/SKILL.md', '.claude/skills/grill-me/LICENSE']);
  assert.match(preview.steps[1].message, /2 files.*after grill-me is removed/);
  assert.equal(installed.size, 2, 'the preview removes nothing');
});

test('Confirm removes each item in order with its own review and reports each as removed', async () => {
  const { host, calls, installed } = fakeHost(grill);
  const preview = await previewRemoval({ entries: [entry('grill-me'), entry('grilling')], host, mode: 'vibe' });
  const done = await confirmRemoval({ preview, host, mode: 'vibe' });
  assert.deepEqual(done.results.map(result => [result.name, result.state]), [['grill-me', 'removed'], ['grilling', 'removed']]);
  assert.equal(installed.size, 0);
  // Each item is prepared again before its own Apply, so every approval names a fresh review.
  assert.deepEqual(calls.slice(2).map(call => call[0]), ['remove', 'apply', 'remove', 'apply']);
  assert.match(done.message, /^Removed grill-me and grilling\.$/);
});

test('an item Core retains is reported as kept in words, never as removed', async () => {
  const { host } = fakeHost({ members: { ...grill.members, 'm-notices': ['n'], 'm-kiro': ['k'] }, requires: { ...grill.requires, 'm-grilling': ['m-notices'], 'm-kiro': ['m-notices'] } });
  const preview = await previewRemoval({ entries: [entry('grill-me'), entry('grilling'), entry('notices', 1)], host, mode: 'vibe' });
  const done = await confirmRemoval({ preview, host, mode: 'vibe' });
  assert.deepEqual(done.results.map(result => result.state), ['removed', 'removed', 'kept']);
  assert.match(done.message, /Removed grill-me and grilling\. Kept notices: Core says another installed item still requires it\./);
});

test('an item retained with nothing removed before it is kept in the preview and not touched on Confirm', async () => {
  const { host, calls } = fakeHost({ members: { 'm-notices': ['n'], 'm-kiro': ['k'] }, requires: { 'm-kiro': ['m-notices'] } });
  const preview = await previewRemoval({ entries: [entry('notices', 1)], host, mode: 'vibe' });
  assert.deepEqual(preview.steps.map(step => step.state), ['kept']);
  assert.equal(preview.canConfirm, false);
});

test('Remove stops at the first failure and says what was and was not removed', async () => {
  const { host } = fakeHost({ ...grill, members: { ...grill.members, 'm-notices': ['n'] }, requires: { ...grill.requires, 'm-grilling': ['m-notices'] } });
  const preview = await previewRemoval({ entries: [entry('grill-me'), entry('grilling'), entry('notices', 1)], host, mode: 'vibe' });
  let applies = 0;
  const failing = async (operation, body) => operation === 'apply' && ++applies === 2
    ? { completion: 'partial', diagnostics: [{ message: 'Disk busy.' }], operations: [{ id: 'a', application: 'applied', verification: { status: 'passed' } }, { id: 'b', application: 'not-applied', verification: { status: 'not-run' } }] }
    : host(operation, body);
  const done = await confirmRemoval({ preview, host: failing, mode: 'vibe' });
  assert.deepEqual(done.results.map(result => result.state), ['removed', 'failed', 'not-attempted']);
  assert.match(done.message, /Removed grill-me\. grilling did not finish: 1 of 2 removed, 1 verified\. Disk busy\. Not removed: notices\./);
});

test('a superseded Apply cannot tell whether files were removed', async () => {
  const { host } = fakeHost(grill);
  const preview = await previewRemoval({ entries: [entry('grill-me'), entry('grilling')], host, mode: 'vibe' });
  const done = await confirmRemoval({ preview, host: async (operation, body) => operation === 'apply' ? { status: 'superseded' } : host(operation, body), mode: 'vibe' });
  assert.deepEqual(done.results.map(result => result.state), ['superseded', 'not-attempted']);
  assert.match(done.results[0].message, /cannot tell whether files were removed; check the list/);
});

test('files that changed since the preview stop Remove before anything is applied', async () => {
  const { host, installed } = fakeHost(grill);
  const preview = await previewRemoval({ entries: [entry('grill-me'), entry('grilling')], host, mode: 'vibe' });
  grill.members['m-grill-me'].push('.claude\\skills\\grill-me\\extra.md');
  try {
    const done = await confirmRemoval({ preview, host, mode: 'vibe' });
    assert.deepEqual(done.results.map(result => result.state), ['changed', 'not-attempted']);
    assert.equal(installed.size, 2);
  } finally { grill.members['m-grill-me'].pop(); }
  // A needed item whose prepared removal does not match the file count shown is not applied either.
  const short = fakeHost(grill);
  const second = await previewRemoval({ entries: [entry('grill-me'), entry('grilling', 3)], host: short.host, mode: 'vibe' });
  const done = await confirmRemoval({ preview: second, host: short.host, mode: 'vibe' });
  assert.deepEqual(done.results.map(result => result.state), ['removed', 'changed']);
  assert.equal(short.installed.has('m-grilling'), true);
});

test('Core refusals are said in words and offer no Confirm', async () => {
  const { host } = fakeHost({ ...grill, script: { 'remove:m-grill-me': async () => ({ disposition: 'reconcile-required', diagnostics: [{ message: 'A file was edited.' }] }) } });
  const preview = await previewRemoval({ entries: [entry('grill-me'), entry('grilling')], host, mode: 'vibe' });
  assert.equal(preview.canConfirm, false);
  assert.match(preview.steps[0].message, /needs reconciling.*A file was edited\./);
});

test('a removal counts only when every operation was applied and verified', () => {
  const files = [{ path: 'a' }, { path: 'b' }];
  const op = (application, status) => ({ application, verification: { status } });
  assert.equal(removalOutcome({ completion: 'complete', operations: [op('applied', 'passed'), op('applied', 'passed')] }, files).ok, true);
  assert.equal(removalOutcome({ completion: 'complete', operations: [op('applied', 'passed'), op('applied', 'failed')] }, files).ok, false);
  assert.equal(removalOutcome({ completion: 'complete', operations: [op('applied', 'passed')] }, files).ok, false);
  assert.equal(removalOutcome(undefined, files).ok, false);
});

test('a complete removal Core did not verify is said as deleted but unverified, never as removed', async () => {
  // Core's removal operations carry no checks, so a finished run reports each operation applied but unverified.
  const unverified = held => ({ completion: 'complete', diagnostics: [], operations: held.prepared.operations.map(operation => ({ id: operation.id, application: 'applied', verification: { status: 'unverified' } })) });
  const fake = fakeHost({ ...grill, applyResult: held => { fake.installed.delete(held.id); return unverified(held); } });
  const preview = await previewRemoval({ entries: [entry('grill-me'), entry('grilling')], host: fake.host, mode: 'vibe' });
  const done = await confirmRemoval({ preview, host: fake.host, mode: 'vibe' });
  assert.deepEqual(done.results.map(result => result.state), ['unverified', 'unverified']);
  assert.equal(fake.installed.size, 0);
  assert.match(done.message, /^Core deleted the files of grill-me and grilling but did not verify the removal\. Check the list below\.$/);
  assert.doesNotMatch(done.message, /Removed|Nothing was removed/);
  const outcome = removalOutcome(unverified({ prepared: { operations: [{ id: 'a' }] } }), [{ path: 'a' }]);
  assert.deepEqual([outcome.ok, outcome.unverified], [false, true]);
});
