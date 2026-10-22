import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installOutcome, projectName, relativeTarget, skillHints } from '../../src/app/install-panel.js';
import { effectsFingerprint, installFiles } from '../../src/app/host-review.js';

const project = 'C:\\Temp\\proof\\sample-js-app';
const write = (id, path) => ({ id, kind: 'file.write', effects: 'create-file', purpose: `Deliver ${path}`, details: { target: `${project}\\${path}` } });
const review = { target: { project, scope: 'project' }, reviewDigest: 'd1', operations: [
  write('a', '.claude\\skills\\grill-me\\SKILL.md'), write('b', '.claude\\skills\\grilling\\SKILL.md'), write('c', '.aih-extensions\\notices\\LICENSE'),
] };
const run = (completion, states) => ({ completion, diagnostics: [], operations: states.map(([application, verification], index) => ({ id: String(index), application, verification: { status: verification } })) });

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

test('two Prepares with the same effects match even though their review digests differ', () => {
  const again = { ...structuredClone(review), reviewDigest: 'd2' };
  assert.equal(effectsFingerprint(again), effectsFingerprint(review));
  const changedContent = structuredClone(review); changedContent.operations[0].checks = [{ details: { content: 'sha256:other' } }];
  assert.notEqual(effectsFingerprint(changedContent), effectsFingerprint(review));
  const extraFile = structuredClone(review); extraFile.operations.push(write('d', 'extra.md'));
  assert.notEqual(effectsFingerprint(extraFile), effectsFingerprint(review));
});

test('names the skills to try from the SKILL.md files being added', () => {
  assert.deepEqual(skillHints(installFiles(review)), ['grill-me', 'grilling']);
});

test('reports success only when every operation was applied and verified', () => {
  const files = installFiles(review);
  const ok = installOutcome(run('complete', [['applied', 'passed'], ['applied', 'passed'], ['applied', 'passed']]), files, project);
  assert.equal(ok.ok, true);
  assert.match(ok.message, /Installed 3 files into sample-js-app\. Open Claude Code in this folder and type \/grill-me or \/grilling\./);

  const unverified = installOutcome(run('complete', [['applied', 'passed'], ['applied', 'failed'], ['applied', 'passed']]), files, project);
  assert.equal(unverified.ok, false);
  assert.match(unverified.message, /3 of 3 applied, 2 verified/);

  const partial = installOutcome({ ...run('partial', [['applied', 'passed'], ['not-applied', 'not-run']]), diagnostics: [{ code: 'X', message: 'Disk full.' }] }, files, project);
  assert.equal(partial.ok, false);
  assert.match(partial.message, /1 of 3 applied.*Disk full\./);

  // Files already in place with the expected bytes are verified by Core and count as installed, but are named apart.
  const inPlace = installOutcome(run('complete', [['already-satisfied', 'passed'], ['applied', 'passed'], ['applied', 'passed']]), files, project);
  assert.equal(inPlace.ok, true);
  assert.match(inPlace.message, /Installed 3 files into sample-js-app \(1 was already in place\)\./);
  const inPlaceUnverified = installOutcome(run('complete', [['already-satisfied', 'failed'], ['applied', 'passed']]), files, project);
  assert.equal(inPlaceUnverified.ok, false);
  assert.match(inPlaceUnverified.message, /1 of 3 applied, 1 already in place, 1 verified/);

  assert.equal(installOutcome(run('complete', []), files, project).ok, false, 'an empty run is not a success');
  // A newer page request can supersede Apply after the host already wrote files, so it never claims nothing changed.
  const superseded = installOutcome({ status: 'superseded' }, files, project);
  assert.equal(superseded.ok, false);
  assert.match(superseded.message, /cannot tell whether any files were written/);
  assert.doesNotMatch(superseded.message, /interrupted|Nothing is reported/);
  // A run that reports fewer operations than were reviewed is not a complete install.
  const short = installOutcome(run('complete', [['applied', 'passed'], ['applied', 'passed']]), files, project);
  assert.equal(short.ok, false);
  assert.match(short.message, /2 of 3 applied/);
  assert.equal(installOutcome(undefined, files, project).ok, false);
});

test('files in place are not called installed unless Core lists the whole setup as installed', async () => {
  const { installSummary } = await import('../../src/app/install-panel.js');
  const placed = path => ({ action: 'Already in place', path });
  const rows = [placed('a'), placed('b'), placed('c')];
  // Matching bytes alone do not show that Core manages them.
  const unknown = installSummary(rows);
  assert.equal(unknown.heading, 'All 3 files are already in place');
  assert.match(unknown.message, /^All 3 files are already in place\./);
  assert.doesNotMatch(`${unknown.heading} ${unknown.message}`, /installed|will be changed|Nothing has been installed yet/i);
  assert.doesNotMatch(installSummary(rows, { managed: false }).message, /installed/i);
  assert.match(installSummary(rows, { managed: true }).message, /^Already installed: all 3 files are in place\./);
  const some = installSummary([placed('a'), { action: 'Add', path: 'b' }, { action: 'Add', path: 'c' }], { managed: true });
  assert.equal(some.heading, '2 files will be changed (1 already in place)');
  assert.match(some.message, /Not fully installed: 1 of 3 files are already in place\./);
  const none = installSummary([{ action: 'Add', path: 'a' }]);
  assert.equal(none.heading, '1 file will be changed');
  assert.equal(none.message, 'Nothing has been installed yet.');
  assert.equal(installSummary([]).heading, 'Nothing to change');
});

// Core gives an operation the Catalog declared no check for "unverified" (no-supplied-check), e.g. a marked block merged
// into AGENTS.md. Everything was applied; the page says which change was not checked, and never calls it verified.
test('an applied change with no check is named as not checked, not as an unfinished install', () => {
  const files = [{ action: 'Add', path: 'ai-coding/RULE_ROUTER.md' }, { action: 'Add', path: 'AGENTS.md' }];
  const noCheck = { completion: 'complete', diagnostics: [], operations: [
    { id: 'a', application: 'applied', verification: { status: 'passed' } },
    { id: 'b', application: 'applied', verification: { status: 'unverified', reason: 'no-supplied-check' } }] };
  const outcome = installOutcome(noCheck, files, project);
  assert.equal(outcome.ok, false, 'not a verified success');
  assert.equal(outcome.state, 'unchecked');
  assert.match(outcome.message, /^Installed 2 files into sample-js-app\. 1 was checked; AGENTS\.md was written but has no check from the Catalog, so it is not verified\. Open it to confirm\.$/);
  assert.doesNotMatch(outcome.message, /did not finish/);
  // A failed or unavailable check is still an unfinished install.
  const failed = structuredClone(noCheck); failed.operations[0].verification = { status: 'failed' };
  assert.match(installOutcome(failed, files, project).message, /Install did not finish: 2 of 2 applied, 0 verified/);
});
