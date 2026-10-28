import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmRemoval, previewRemoval, removalOutcome } from '../../src/app/installed-removal.js';

// A fake host that behaves like Core's managed removal: an item is retained while another installed item requires it.
const project = 'C:\\Temp\\proof\\sample-js-app';
function fakeHost({ requires = {}, members = {}, applyResult, script = {} } = {}) {
  const installed = new Set(Object.keys(members)), calls = [];
  let session = 0, preparedCounts = new Map();
  const sessions = new Map();
  const review = id => ({ target: { project }, reviewDigest: `d-${id}-${session}`, operations: members[id].map((path, index) => ({
    id: `lifecycle/remove-${index}`, kind: 'file.remove', effects: 'remove-file', details: { target: `${project}\\${path}` } })) });
  const request = async (operation, body) => {
    calls.push([operation, body.managementId ?? body.sessionId]);
    const scripted = script[`${operation}:${body.managementId ?? ''}`]; if (scripted) return scripted();
    if (operation === 'remove') {
      const id = body.managementId;
      if (!installed.has(id)) return { disposition: 'absent', diagnostics: [] };
      if ([...installed].some(other => requires[other]?.includes(id))) return { disposition: 'retained', diagnostics: [{ reason: 'dependency-retained', message: 'Another managed selection still requires this one, so its claim is retained.' }] }
      // Core is the stale authority (#165): when the reviewed files changed since this item was last prepared,
      // the fresh preparation carries Core's own REVIEW_STALE reason; the Workbench never compares effects.
      const stale = preparedCounts.has(id) && preparedCounts.get(id) !== members[id].length;
      preparedCounts.set(id, members[id].length);
      session++; const sessionId = `s${session}`, prepared = review(id); sessions.set(sessionId, { id, prepared });
      return { disposition: 'prepared', diagnostics: [],
        preparation: { status: 'ready', sessionId, review: prepared,
          ...(stale ? { diagnostics: [{ code: 'REVIEW_STALE', message: 'A reviewed file changed since this list was shown.', changed: { reason: 'binding-changed' } }] } : {}) } };
    }
    const held = sessions.get(body.sessionId);
    if (!held || held.prepared.reviewDigest !== body.reviewDigest) return { status: 'rejected', diagnostics: [{ message: 'digest-mismatch' }] };
    installed.delete(held.id);
    if (applyResult) return applyResult(held);
    return { completion: 'complete', diagnostics: [], operations: held.prepared.operations.map(operation => ({ id: operation.id, application: 'applied', verification: { status: 'passed' } })) };
  };
  return { request, calls, installed };
}
const entry = name => ({ name, managementId: `m-${name}`, scope: 'project' });
const members = () => ({ 'm-grill-me': ['.claude\\skills\\grill-me\\SKILL.md', '.claude\\skills\\grill-me\\LICENSE'], 'm-grilling': ['.claude\\skills\\grilling\\SKILL.md', '.claude\\skills\\grilling\\LICENSE'] });
const grill = () => ({ members: members(), requires: { 'm-grill-me': ['m-grilling'] } });
const confirmAll = async (preview, request) => {
  let done = await confirmRemoval({ preview, request, mode: 'vibe' });
  while (done.next) done = await confirmRemoval({ preview: done.next, request, mode: 'vibe', results: done.results });
  return done;
};

test('the preview shows the first item\'s files, says needed items are shown after it, and that Core keeps what others need', async () => {
  const { request, installed } = fakeHost(grill());
  const preview = await previewRemoval({ entries: [entry('grill-me'), entry('grilling')], request, mode: 'vibe' });
  assert.equal(preview.canConfirm, true);
  assert.deepEqual(preview.steps.map(step => step.state), ['ready', 'after']);
  assert.deepEqual(preview.steps[0].files.map(file => file.path), ['.claude/skills/grill-me/SKILL.md', '.claude/skills/grill-me/LICENSE']);
  assert.match(preview.steps[1].message, /after grill-me is removed.*its files are shown/);
  assert.doesNotMatch(preview.steps[1].message, /\d+ files?/, 'no count is promised for files the page has not seen');
  assert.match(preview.note, /Core keeps anything another installed item still needs, including items outside your current setup/);
  assert.equal(installed.size, 2, 'the preview removes nothing');
});

test('a needed item\'s own files are shown and confirmed before it is removed', async () => {
  const { request, calls, installed } = fakeHost(grill());
  const preview = await previewRemoval({ entries: [entry('grill-me'), entry('grilling')], request, mode: 'vibe' });
  const first = await confirmRemoval({ preview, request, mode: 'vibe' });
  assert.deepEqual(first.results.map(result => [result.name, result.state]), [['grill-me', 'removed']]);
  assert.equal(first.outcome, 'needs-confirm');
  assert.deepEqual(first.next.steps.map(step => step.state), ['ready']);
  assert.deepEqual(first.next.steps[0].files.map(file => file.path), ['.claude/skills/grilling/SKILL.md', '.claude/skills/grilling/LICENSE']);
  assert.equal(installed.has('m-grilling'), true, 'nothing is applied for an item whose files were not shown');
  assert.match(first.message, /Removed grill-me\. Check the files of grilling, then confirm again\./);
  const second = await confirmRemoval({ preview: first.next, request, mode: 'vibe', results: first.results });
  assert.deepEqual(second.results.map(result => [result.name, result.state]), [['grill-me', 'removed'], ['grilling', 'removed']]);
  assert.equal(second.outcome, 'removed');
  assert.equal(installed.size, 0);
  // Every Apply follows its own fresh Prepare, so each approval names a review that matches what was shown.
  assert.deepEqual(calls.slice(2).map(call => call[0]), ['remove', 'apply', 'remove', 'remove', 'apply']);
  assert.match(second.message, /^Removed grill-me and grilling\.$/);
});

test('an item Core retains is reported as kept in words, never as removed', async () => {
  const { request } = fakeHost({ members: { ...members(), 'm-notices': ['n'], 'm-kiro': ['k'] }, requires: { 'm-grill-me': ['m-grilling'], 'm-grilling': ['m-notices'], 'm-kiro': ['m-notices'] } });
  const preview = await previewRemoval({ entries: [entry('grill-me'), entry('grilling'), entry('notices')], request, mode: 'vibe' });
  const done = await confirmAll(preview, request);
  assert.deepEqual(done.results.map(result => result.state), ['removed', 'removed', 'kept']);
  assert.match(done.message, /Removed grill-me and grilling\. Kept notices: Core says another installed item still needs it\./);
});

test('when nothing is removed the outcome says so, even if every item was kept or already gone', async () => {
  const { request } = fakeHost({ members: { 'm-notices': ['n'], 'm-kiro': ['k'] }, requires: { 'm-kiro': ['m-notices'] } });
  const kept = await previewRemoval({ entries: [entry('notices')], request, mode: 'vibe' });
  assert.deepEqual(kept.steps.map(step => step.state), ['kept']);
  assert.equal(kept.canConfirm, false);
  const done = await confirmRemoval({ preview: { steps: [...kept.steps, { entry: entry('gone'), state: 'absent', files: [] }] }, request, mode: 'vibe' });
  assert.equal(done.outcome, 'nothing-removed');
  assert.match(done.message, /^Nothing was removed\./);
});

test('Remove stops at the first failure and says what was and was not removed', async () => {
  const { request } = fakeHost({ members: { ...members(), 'm-other': ['o'] } });
  const preview = await previewRemoval({ entries: [entry('grill-me'), entry('grilling'), entry('other')], request, mode: 'vibe' });
  let applies = 0;
  const failing = async (operation, body) => operation === 'apply' && ++applies === 2
    ? { completion: 'partial', diagnostics: [{ message: 'Disk busy.' }], operations: [{ id: 'a', application: 'applied', verification: { status: 'passed' } }, { id: 'b', application: 'not-applied', verification: { status: 'not-run' } }] }
    : request(operation, body);
  const done = await confirmRemoval({ preview, request: failing, mode: 'vibe' });
  assert.deepEqual(done.results.map(result => result.state), ['removed', 'failed', 'not-attempted']);
  assert.equal(done.outcome, 'failed');
  assert.match(done.message, /Removed grill-me\. grilling did not finish: 1 of 2 removed, 1 verified\. Disk busy\. Not removed: other\./);
});

test('a superseded Apply cannot tell whether files were removed', async () => {
  const { request } = fakeHost(grill());
  const preview = await previewRemoval({ entries: [entry('grill-me'), entry('grilling')], request, mode: 'vibe' });
  const done = await confirmRemoval({ preview, request: async (operation, body) => operation === 'apply' ? { status: 'superseded' } : request(operation, body), mode: 'vibe' });
  assert.deepEqual(done.results.map(result => result.state), ['superseded', 'not-attempted']);
  assert.match(done.results[0].message, /cannot tell whether files were removed; check the list/);
});

test('files that changed since they were shown stop Remove before anything is applied', async () => {
  const host = grill(), { request, installed } = fakeHost(host);
  const preview = await previewRemoval({ entries: [entry('grill-me'), entry('grilling')], request, mode: 'vibe' });
  host.members['m-grill-me'].push('.claude\\skills\\grill-me\\extra.md');
  const done = await confirmRemoval({ preview, request, mode: 'vibe' });
  assert.deepEqual(done.results.map(result => result.state), ['changed', 'not-attempted']);
  assert.equal(installed.size, 2);
});

test('Core refusals are said in words and offer no Confirm', async () => {
  const { request } = fakeHost({ ...grill(), script: { 'remove:m-grill-me': async () => ({ disposition: 'reconcile-required', diagnostics: [{ message: 'A file was edited.' }] }) } });
  const preview = await previewRemoval({ entries: [entry('grill-me'), entry('grilling')], request, mode: 'vibe' });
  assert.equal(preview.canConfirm, false);
  assert.match(preview.steps[0].message, /needs reconciling.*A file was edited\./);
});

test('a complete removal Core did not verify is said as deleted but unverified, never as removed', async () => {
  // Core's removal operations carry no checks, so a finished run reports each operation applied but unverified.
  const unverified = held => ({ completion: 'complete', diagnostics: [], operations: held.prepared.operations.map(operation => ({ id: operation.id, application: 'applied', verification: { status: 'unverified' } })) });
  const fake = fakeHost({ ...grill(), applyResult: unverified });
  const preview = await previewRemoval({ entries: [entry('grill-me'), entry('grilling')], request: fake.request, mode: 'vibe' });
  const done = await confirmAll(preview, fake.request);
  assert.deepEqual(done.results.map(result => result.state), ['unverified', 'unverified']);
  assert.equal(done.outcome, 'unverified');
  assert.equal(fake.installed.size, 0);
  assert.match(done.message, /^Core deleted the files of grill-me and grilling but did not verify the removal\. Check the list below\.$/);
  assert.doesNotMatch(done.message, /Removed|Nothing was removed/);
});

test('a removal counts only when every operation was applied and verified', () => {
  const files = [{ path: 'a' }, { path: 'b' }];
  const op = (application, status) => ({ application, verification: { status } });
  assert.equal(removalOutcome({ completion: 'complete', operations: [op('applied', 'passed'), op('applied', 'passed')] }, files).state, 'removed');
  assert.equal(removalOutcome({ completion: 'complete', operations: [op('applied', 'unverified'), op('applied', 'passed')] }, files).state, 'unverified');
  assert.equal(removalOutcome({ completion: 'complete', operations: [op('applied', 'passed'), op('applied', 'failed')] }, files).state, 'failed');
  assert.equal(removalOutcome({ completion: 'complete', operations: [op('applied', 'passed')] }, files).state, 'failed');
  assert.equal(removalOutcome(undefined, files).state, 'failed');
});

test('in a later round a needed item still waiting names only what is still to be removed', async () => {
  const { request } = fakeHost({ members: { ...members(), 'm-notices': ['n'], 'm-kiro': ['k'] }, requires: { 'm-grill-me': ['m-grilling'], 'm-grilling': ['m-notices'], 'm-kiro': ['m-notices'] } });
  const preview = await previewRemoval({ entries: [entry('grill-me'), entry('grilling'), entry('notices')], request, mode: 'vibe' });
  assert.match(preview.steps[2].message, /after grill-me and grilling are removed/);
  const first = await confirmRemoval({ preview, request, mode: 'vibe' });
  assert.deepEqual(first.next.steps.map(step => [step.entry.name, step.state]), [['grilling', 'ready'], ['notices', 'after']]);
  assert.match(first.next.steps[1].message, /after grilling is removed/);
  assert.doesNotMatch(first.next.steps[1].message, /grill-me/, 'grill-me is already gone');
});
