// The real-home guard: a fixture home in a mkdtemp area stands in for the real account home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRealHome, recordRealHome } from '../candidate/guard.mjs';
import { candidateLayout } from '../candidate/layout.mjs';

const descriptor = { base: 'userHome', segments: ['fixture-state', 'records'] };

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'aih-ui-candidate-guard-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const layout = candidateLayout(join(root, 'data')), home = join(root, 'real-home');
  mkdirSync(layout.state, { recursive: true });
  mkdirSync(join(home, 'fixture-state', 'records', 'records'), { recursive: true });
  writeFileSync(join(home, 'fixture-state', 'records', 'records', 'existing.json'), '{}');
  return { layout, home };
}

test('a home left alone is unchanged', t => {
  const { layout, home } = fixture(t);
  recordRealHome(layout, home, descriptor);
  const result = checkRealHome(layout, home);
  assert.deepEqual(result, { checked: true, unchanged: true, counts: { unchanged: true, added: 0, removed: 0, changed: 0, unreadable: 0 }, message: 'unchanged' });
});

test('a file added under Core state is reported, with the counts', t => {
  const { layout, home } = fixture(t);
  recordRealHome(layout, home, descriptor);
  writeFileSync(join(home, 'fixture-state', 'records', 'records', 'added.json'), '{}');
  const result = checkRealHome(layout, home);
  assert.equal(result.unchanged, false);
  assert.equal(result.counts.added, 1);
  // The directory that gained the file counts as changed too.
  assert.match(result.message, /Core state changed.*1 added, 0 removed, \d+ changed, 0 unreadable/);
});

test('a removed or changed record is reported too', t => {
  const { layout, home } = fixture(t);
  recordRealHome(layout, home, descriptor);
  writeFileSync(join(home, 'fixture-state', 'records', 'records', 'existing.json'), '{"changed":true}');
  assert.equal(checkRealHome(layout, home).counts.changed, 1);
  rmSync(join(home, 'fixture-state', 'records', 'records', 'existing.json'));
  assert.equal(checkRealHome(layout, home).counts.removed, 1);
});

test('the snapshot round-trips through its file, including a home with no Core directory', t => {
  const { layout, home } = fixture(t);
  const recorded = recordRealHome(layout, home, descriptor);
  assert.equal(recorded.exists, true);
  const file = JSON.parse(readFileSync(layout.realHomeGuard, 'utf8'));
  assert.equal(file.home, home);
  assert.ok(Array.isArray(file.snapshot.entries) && file.snapshot.entries.length >= 1);
  assert.equal(checkRealHome(layout).unchanged, true, 'the recorded home is used when none is named');
  rmSync(join(home, 'fixture-state'), { recursive: true });
  recordRealHome(layout, home, descriptor);
  assert.equal(checkRealHome(layout, home).unchanged, true);
  mkdirSync(join(home, 'fixture-state', 'records'), { recursive: true });
  assert.equal(checkRealHome(layout, home).unchanged, false);
});

test('without a recorded snapshot nothing is claimed', t => {
  const { layout, home } = fixture(t);
  const result = checkRealHome(layout, home);
  assert.equal(result.checked, false);
  assert.equal(result.unchanged, null);
  assert.match(result.message, /not checked/);
});
