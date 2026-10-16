// Reset deletes a directory, so these prove what it will and will not delete. Every directory here is a mkdtemp area.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimDataDir, ensureLayout, resetDataDir } from '../candidate/data-dir.mjs';
import { DATA_MARKER_SCHEMA, candidateLayout } from '../candidate/layout.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const refused = code => error => { assert.equal(error.code, code, error.message); return true; };

function area(t) {
  const root = mkdtempSync(join(tmpdir(), 'aih-ui-data-dir-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
// A claimed data directory with content in several places, and a sibling file beside it.
function populated(t) {
  const root = area(t), data = join(root, 'candidate'), sibling = join(root, 'owner-notes.txt');
  writeFileSync(sibling, 'not part of the candidate');
  const { layout, marker } = claimDataDir(data);
  ensureLayout(layout);
  writeFileSync(join(layout.home, 'account-file'), 'candidate home content');
  writeFileSync(join(layout.samples, 'sample.txt'), 'sample');
  return { root, data, sibling, layout, marker };
}

test('claim makes a missing directory with a marker naming its own real path, and accepts it again', t => {
  const root = area(t), data = join(root, 'fresh');
  const first = claimDataDir(data);
  assert.equal(first.created, true);
  const written = JSON.parse(readFileSync(candidateLayout(data).marker, 'utf8'));
  assert.equal(written.schema, DATA_MARKER_SCHEMA);
  assert.match(written.instance, /^[0-9a-f-]{36}$/);
  assert.equal(written.root.toLowerCase(), resolve(data).toLowerCase());
  const second = claimDataDir(data);
  assert.equal(second.created, false);
  assert.equal(second.marker.instance, written.instance);
});

test('claim accepts an empty existing directory and refuses one the candidate did not make', t => {
  const root = area(t), empty = join(root, 'empty'), foreign = join(root, 'foreign');
  mkdirSync(empty); mkdirSync(foreign);
  claimDataDir(empty);
  assert.ok(existsSync(candidateLayout(empty).marker));
  writeFileSync(join(foreign, 'important.txt'), 'someone else');
  assert.throws(() => claimDataDir(foreign), refused('CANDIDATE_DATA_FOREIGN'));
  assert.deepEqual(readdirSync(foreign), ['important.txt']);
});

test('reset removes the data directory content, leaves a sibling untouched and claims it again', async t => {
  const { data, sibling, layout, marker } = populated(t);
  const result = await resetDataDir(data);
  assert.ok(result.entries >= 3);
  assert.equal(existsSync(join(layout.home, 'account-file')), false);
  assert.equal(existsSync(join(layout.samples, 'sample.txt')), false);
  assert.equal(readFileSync(sibling, 'utf8'), 'not part of the candidate');
  assert.deepEqual(readdirSync(data), ['candidate.json']);
  const after = JSON.parse(readFileSync(layout.marker, 'utf8'));
  assert.equal(after.root, marker.root);
  assert.notEqual(after.instance, marker.instance);
});

test('reset refuses a directory with no marker and deletes nothing', async t => {
  const root = area(t), data = join(root, 'plain');
  mkdirSync(data);
  writeFileSync(join(data, 'keep.txt'), 'keep');
  await assert.rejects(resetDataDir(data), refused('CANDIDATE_DATA_FOREIGN'));
  assert.equal(readFileSync(join(data, 'keep.txt'), 'utf8'), 'keep');
  await assert.rejects(resetDataDir(join(root, 'absent')), refused('CANDIDATE_DATA_FOREIGN'));
});

test('reset refuses a copied marker whose root points elsewhere', async t => {
  const { root, data } = populated(t), other = join(root, 'other');
  mkdirSync(other);
  copyFileSync(candidateLayout(data).marker, candidateLayout(other).marker);
  writeFileSync(join(other, 'keep.txt'), 'keep');
  await assert.rejects(resetDataDir(other), refused('CANDIDATE_DATA_FOREIGN'));
  assert.equal(readFileSync(join(other, 'keep.txt'), 'utf8'), 'keep');
  assert.ok(existsSync(join(data, 'samples', 'sample.txt')));
});

test('reset refuses a marker of another schema', async t => {
  const { data, layout } = populated(t);
  writeFileSync(layout.marker, JSON.stringify({ schema: 'urn:other:1', root: data, instance: 'x' }));
  await assert.rejects(resetDataDir(data), refused('CANDIDATE_DATA_FOREIGN'));
  assert.ok(existsSync(join(layout.samples, 'sample.txt')));
});

test('reset refuses a symlinked data directory and deletes nothing through it', async t => {
  const { root, data, layout } = populated(t), link = join(root, 'link');
  try { symlinkSync(data, link, 'junction'); } catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return t.skip('symbolic links are not permitted here'); throw error; }
  await assert.rejects(resetDataDir(link), refused('CANDIDATE_DATA_FOREIGN'));
  assert.throws(() => claimDataDir(link), refused('CANDIDATE_DATA_FOREIGN'));
  assert.ok(existsSync(join(layout.samples, 'sample.txt')));
});

test('reset refuses the real home, a filesystem root and the repository whatever they contain', async t => {
  await assert.rejects(resetDataDir(homedir()), refused('CANDIDATE_DATA_PROTECTED'));
  await assert.rejects(resetDataDir(parse(REPO_ROOT).root), refused('CANDIDATE_DATA_PROTECTED'));
  await assert.rejects(resetDataDir(REPO_ROOT), refused('CANDIDATE_DATA_PROTECTED'));
  await assert.rejects(resetDataDir(dirname(REPO_ROOT)), refused('CANDIDATE_DATA_PROTECTED'));
  assert.ok(existsSync(join(REPO_ROOT, 'package.json')));
});

test('reset refuses a home or repository stand-in even when the marker is valid', async t => {
  const { root, data, layout } = populated(t), inner = join(data, 'repo');
  mkdirSync(inner);
  await assert.rejects(resetDataDir(data, { home: data }), refused('CANDIDATE_DATA_PROTECTED'));
  await assert.rejects(resetDataDir(data, { home: join(layout.home) }), refused('CANDIDATE_DATA_PROTECTED'));
  await assert.rejects(resetDataDir(data, { repoRoot: inner }), refused('CANDIDATE_DATA_PROTECTED'));
  await assert.rejects(resetDataDir(data, { repoRoot: data }), refused('CANDIDATE_DATA_PROTECTED'));
  // A repository that contains the data directory is fine: the default location is inside the checkout.
  await resetDataDir(data, { repoRoot: root });
  assert.deepEqual(readdirSync(data), ['candidate.json']);
});

test('reset refuses while the recorded server process is alive', async t => {
  const { data, layout } = populated(t);
  writeFileSync(layout.server, JSON.stringify({ pid: process.pid }));
  await assert.rejects(resetDataDir(data), error => { assert.equal(error.code, 'CANDIDATE_RUNNING'); assert.match(error.message, /Stop it first/); return true; });
  assert.ok(existsSync(join(layout.samples, 'sample.txt')));
  writeFileSync(layout.server, JSON.stringify({ pid: 2 ** 22 + 12345 }));
  await resetDataDir(data);
  assert.equal(existsSync(join(layout.samples, 'sample.txt')), false);
});
