import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectsFingerprint, installFiles, installOutcome, projectName, relativeTarget, skillHints } from '../../src/app/install-panel.js';

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
  assert.match(partial.message, /1 of 2 applied.*Disk full\./);

  assert.equal(installOutcome(run('complete', []), files, project).ok, false, 'an empty run is not a success');
  assert.equal(installOutcome({ status: 'superseded' }, files, project).ok, false);
  assert.equal(installOutcome(undefined, files, project).ok, false);
});
