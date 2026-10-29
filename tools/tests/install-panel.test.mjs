import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installOutcome, installSummary, projectName, relativeTarget, skillHints } from '../../src/app/install-panel.js';
import { installFiles } from '../../src/app/host-review.js';

const project = 'C:\\Temp\\proof\\sample-js-app';
const write = (id, path) => ({ id, kind: 'file.write', effects: 'create-file', purpose: `Deliver ${path}`, details: { target: `${project}\\${path}` } });
const review = { target: { project, scope: 'project' }, reviewDigest: 'd1', operations: [
  write('a', '.claude\\skills\\grill-me\\SKILL.md'), write('b', '.claude\\skills\\grilling\\SKILL.md'), write('c', '.aih-extensions\\notices\\LICENSE'),
] };

test('lists every file the review will write, relative to the project, with a plain verb', () => {
  assert.deepEqual(installFiles(review), [
    { action: 'Add', path: '.claude/skills/grill-me/SKILL.md' },
    { action: 'Add', path: '.claude/skills/grilling/SKILL.md' },
    { action: 'Add', path: '.aih-extensions/notices/LICENSE' },
  ]);
  assert.equal(projectName(project), 'sample-js-app');
  assert.equal(relativeTarget('D:\\elsewhere\\file', project), 'D:/elsewhere/file');
  assert.deepEqual(installFiles(undefined), []);
  const satisfied = { ...write('d', '.aih-extensions\\notices\\NOTICE.md'), effects: 'already-satisfied' };
  assert.deepEqual(installFiles({ ...review, operations: [satisfied] }), [{ action: 'Already in place', path: '.aih-extensions/notices/NOTICE.md' }]);
});

// Run result 1.4 members: what the reviewed plan meant for the member, what the run did, what Core found on disk.
const member = (path, intent, outcome, check) => ({ intent, outcome, check, path: `${project}\\${path}` });
const run14 = (completion, members, diagnostics = []) => ({ completion, diagnostics, members });

test('relative targets respect path boundaries and platform case semantics', () => {
  assert.equal(relativeTarget('/work/app-backup/settings.json', '/work/app'), '/work/app-backup/settings.json');
  assert.equal(relativeTarget('/Work/App/settings.json', '/work/app'), '/Work/App/settings.json');
  assert.equal(relativeTarget('/work/app/settings.json', '/work/app'), 'settings.json');
  assert.equal(relativeTarget('C:\\work\\app-backup\\settings.json', 'C:\\work\\app'), 'C:/work/app-backup/settings.json');
  assert.equal(relativeTarget('C:\\Work\\App\\settings.json', 'C:\\work\\app'), 'settings.json');
});

test('names the skills to try from the SKILL.md files being added', () => {
  assert.deepEqual(skillHints(installFiles(review)), ['grill-me', 'grilling']);
});

test('confirms on disk only when the run is complete and every intended write member was written and checked present-matching', () => {
  const files = installFiles(review);
  const ok = installOutcome(run14('complete', [
    member('.claude\\skills\\grill-me\\SKILL.md', 'write', 'written', 'present-matching'),
    member('.claude\\skills\\grilling\\SKILL.md', 'write', 'written', 'present-matching'),
    member('.aih-extensions\\notices\\LICENSE', 'write', 'written', 'present-matching'),
  ]), files, project);
  assert.equal(ok.ok, true);
  assert.equal(ok.state, 'confirmed');
  assert.match(ok.message, /Confirmed on disk: all 3 files written into sample-js-app checked present-matching\. Open Claude Code in this folder and type \/grill-me or \/grilling\./);

  // One member written but found present-different: never green, the member is named.
  const different = installOutcome(run14('complete', [
    member('.claude\\skills\\grill-me\\SKILL.md', 'write', 'written', 'present-different'),
    member('.claude\\skills\\grilling\\SKILL.md', 'write', 'written', 'present-matching'),
  ]), files, project);
  assert.equal(different.ok, false);
  assert.match(different.message, /not confirmed on disk: .claude\/skills\/grill-me\/SKILL\.md \(written, check present-different\)/);

  // A kept member and a restored one never satisfy the install-success claim.
  const kept = installOutcome(run14('complete', [
    member('a.md', 'write', 'written', 'present-matching'),
    member('b.md', 'write', 'kept', 'unchecked'),
  ]), files, project);
  assert.equal(kept.ok, false);
  assert.match(kept.message, /b\.md \(kept, check unchecked\)/);
  const restored = installOutcome(run14('complete', [member('a.md', 'remove', 'restored', 'present-matching')]), files, project);
  assert.equal(restored.ok, false);

  // An incomplete run is partial and names the members the run did not finish.
  const partial = installOutcome(run14('incomplete', [member('a.md', 'write', 'written', 'present-matching')], [{ code: 'X', message: 'Disk full.' }]), files, project);
  assert.equal(partial.ok, false);
  assert.equal(partial.state, 'partial');
  assert.match(partial.message, /run incomplete.*Disk full\./);

  // Empty, cancelled and memberless runs never confirm.
  assert.equal(installOutcome(run14('complete', []), files, project).ok, false, 'an empty run is not a success');
  assert.equal(installOutcome(run14('cancelled', []), files, project).ok, false);
  const superseded = installOutcome({ status: 'superseded' }, files, project);
  assert.equal(superseded.ok, false);
  assert.match(superseded.message, /cannot tell whether any files were written/);
  assert.doesNotMatch(superseded.message, /interrupted|Nothing is reported/);
  // A run without the 1.4 member projection cannot claim installed-and-checked.
  const legacy = installOutcome({ completion: 'complete', diagnostics: [], operations: [
    { id: '0', application: 'applied', verification: { status: 'passed' } }] }, files, project);
  assert.equal(legacy.ok, false);
  assert.doesNotMatch(legacy.message, /Confirmed on disk/i);
  assert.equal(installOutcome(undefined, files, project).ok, false);
});

test('run results have no invented policyChanged field; policy changes are REVIEW_STALE diagnostics', () => {
  const outcome = installOutcome({ ...run14('complete', [member('a.md', 'write', 'written', 'present-matching')]), policyChanged: true }, installFiles(review), project);
  assert.equal(outcome.policyChanged, undefined);
  assert.doesNotMatch(outcome.message, /policy/i);
});

test('files in place are not called installed unless Core lists the whole setup as installed', async () => {
  const { installSummary } = await import('../../src/app/install-panel.js');
  const placed = path => ({ action: 'Already in place', path });
  const rows = [placed('a'), placed('b'), placed('c')];
  // Matching bytes alone do not show that Core manages them.
  const unknown = installSummary(rows);
  assert.equal(unknown.heading, 'All 3 files are already in place');
  assert.match(unknown.message, /^All 3 files are already in place\./);
  assert.doesNotMatch(`${unknown.heading} ${unknown.message}`, /installed|will change|Nothing has been installed yet/i);
  assert.doesNotMatch(installSummary(rows, { managed: false }).message, /installed/i);
  assert.match(installSummary(rows, { managed: true }).message, /^Already installed: all 3 files are in place\./);
  const some = installSummary([placed('a'), { action: 'Add', path: 'b' }, { action: 'Add', path: 'c' }], { managed: true });
  assert.equal(some.heading, '2 files will change (1 already in place)');
  assert.match(some.message, /Not fully installed: 1 of 3 files are already in place\./);
  const none = installSummary([{ action: 'Add', path: 'a' }]);
  assert.equal(none.heading, '1 file will change');
  assert.equal(none.message, 'Nothing has been installed yet.');
  assert.equal(installSummary([]).heading, 'Nothing to change');
});

test('the Install line counts the files that will change', () => {
  assert.equal(installSummary([{ action: 'Add', path: 'a' }, { action: 'Add', path: 'b' }]).heading, '2 files will change');
});

test('Install says why it is unavailable when the review has nothing to change (#144), and is offered otherwise', async () => {
  const { nothingToInstall } = await import('../../src/app/install-panel.js');
  assert.equal(nothingToInstall({ roots: [], rows: [] }), 'Nothing to change yet — add something from the catalog first.');
  assert.match(nothingToInstall({ roots: [{ itemId: 'x' }], rows: [] }), /^Nothing to change: /);
  assert.equal(nothingToInstall({ roots: [{ itemId: 'x' }], rows: [{ action: 'Add', path: 'a' }] }), '');
  // Files already in place are still checked again by Install, as before.
  assert.equal(nothingToInstall({ roots: [{ itemId: 'x' }], rows: [{ action: 'Already in place', path: 'a' }] }), '');
});
