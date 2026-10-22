import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { declaresTool, preferredCopy, sameSourceGroups, sameSourceWarning } from '../../src/app/source-copies.js';

// Shapes as the Catalog publishes them for the three tool copies of grill-me and the undeclared one.
const MATT = { id: 'matt', origin: { kind: 'git', repository: 'https://github.com/mattpocock/skills', revision: 'd81f' } };
const MATT_OTHER_ID = { id: 'mattpocock-skills-d81f', origin: MATT.origin };
const ECC = { id: 'ecc', origin: { kind: 'git', repository: 'https://github.com/example/ecc', revision: '5064' } };
const path = 'skills/productivity/grill-me/SKILL.md';
const facts = (identifier, revision = 'd81f') => ({ sourceFacts: { identifier, provenance: { path: identifier, revision, sha256: 'c'.repeat(64) } } });
const copy = (id, client, { sources = [MATT], metadata = facts(path), label = 'grill-me' } = {}) => ({ id, label, sources, root: { releaseSha256: 'e'.repeat(64) },
  metadata: { ...metadata, ...(client ? { discovery: { clientCapabilities: [{ client, surface: `.${client}/skills`, capability: 'skill-material-format', support: 'supported' }] } } : {}) } });
const claude = copy('extensions.matt.grill-me', 'claude-code');
const kiro = copy('extensions.kiro.matt.grill-me', 'kiro-ide');
const copilot = copy('extensions.copilot.matt.grill-me', 'copilot-vscode');
// Declares no tool and no source facts, only the upstream path of the same repository and revision.
const undeclared = copy('mattpocock.grill-me', null, { sources: [MATT_OTHER_ID], metadata: { upstream: { path } }, label: 'Grill me' });
// Same file name in another repository: not the same source file.
const elsewhere = copy('ecc.grill-me', 'claude-code', { sources: [ECC], metadata: facts(path, '5064') });

test('an item declares a Catalog tool only by its own capability facts', () => {
  assert.equal(declaresTool(claude, 'claude-code'), true);
  assert.equal(declaresTool(kiro, 'claude-code'), false);
  assert.equal(declaresTool(undeclared, 'claude-code'), false);
  assert.equal(declaresTool(claude, ''), false);
});

test('two chosen items from the same declared source file are named together, never called equivalent', () => {
  assert.deepEqual(sameSourceGroups([claude, kiro]).map(group => group.map(item => item.id)), [['extensions.matt.grill-me', 'extensions.kiro.matt.grill-me']]);
  const warning = sameSourceWarning([kiro, claude]);
  assert.equal(warning, 'grill-me (kiro-ide) and grill-me (claude-code) come from the same source file.');
  assert.doesNotMatch(warning, /equivalent|same content|duplicate/i);
  assert.match(sameSourceWarning([claude, undeclared]), /^grill-me \(claude-code\) and Grill me \(no declared tool\) come from the same source file\.$/);
  assert.match(sameSourceWarning([claude, kiro, copilot]), /^grill-me \(claude-code\), grill-me \(kiro-ide\) and grill-me \(copilot-vscode\) come from the same source file\.$/);
});

test('no warning for one item, for the same item twice, or for a same-named file in another repository', () => {
  assert.equal(sameSourceWarning([claude]), '');
  assert.equal(sameSourceWarning([claude, { ...claude }]), '');
  assert.equal(sameSourceWarning([claude, elsewhere]), '');
  assert.equal(sameSourceWarning([]), '');
});

test('a recommendation moves to the copy from the same source file that declares the chosen tool, else stays', () => {
  const catalog = [undeclared, kiro, claude, copilot, elsewhere];
  assert.equal(preferredCopy(undeclared, catalog, 'claude-code').id, 'extensions.matt.grill-me');
  assert.equal(preferredCopy(undeclared, catalog, 'kiro-ide').id, 'extensions.kiro.matt.grill-me');
  assert.equal(preferredCopy(claude, catalog, 'claude-code').id, 'extensions.matt.grill-me', 'already for the tool');
  assert.equal(preferredCopy(undeclared, catalog, 'codex').id, 'mattpocock.grill-me', 'no copy declares it');
  assert.equal(preferredCopy(undeclared, catalog, '').id, 'mattpocock.grill-me', 'no tool chosen');
  assert.equal(preferredCopy(undeclared, [undeclared, elsewhere], 'claude-code').id, 'mattpocock.grill-me', 'another repository is not a copy');
});

test('the headless copy is the same source as the browser module, so the two cannot drift', async () => {
  const [page, headless] = await Promise.all(['../../src/app/source-copies.js', '../consumer/source-copies.mjs']
    .map(file => readFile(new URL(file, import.meta.url), 'utf8')));
  const lf = text => text.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
  assert.equal(lf(headless), lf(page));
  assert.doesNotMatch(page, /^\s*import\b|\bdocument\b|\bwindow\b|node:|\bprocess\b|\bBuffer\b/m);
});
