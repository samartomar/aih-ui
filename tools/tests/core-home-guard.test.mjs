// The check guard inspects metadata only, in disposable fixture homes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync,
  rmSync, symlinkSync, utimesSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotCoreHome, compareCoreHome, describeCoreHomeChange } from '../core-home-guard.mjs';

function fixture(t, create = true) {
  const home = mkdtempSync(join(tmpdir(), 'aih-ui-core-guard-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const root = join(home, '.aih', 'core');
  if (create) mkdirSync(root, { recursive: true });
  return { home, root };
}

const counts = (added = 0, removed = 0, changed = 0) => ({
  unchanged: added + removed + changed === 0, added, removed, changed,
});

test('missing root equals missing root', (t) => {
  const { home, root } = fixture(t, false);
  const before = snapshotCoreHome(home);
  assert.equal(before.root, root);
  assert.equal(before.exists, false);
  assert.deepEqual(before.entries, new Map());
  assert.deepEqual(compareCoreHome(before, snapshotCoreHome(home)), counts());
});

test('identical recursive trees are unchanged and paths use forward slashes', (t) => {
  const { home, root } = fixture(t);
  mkdirSync(join(root, 'records'));
  const file = join(root, 'records', 'private.json');
  writeFileSync(file, 'private contents');
  const before = snapshotCoreHome(home);
  assert.equal(before.exists, true);
  assert.deepEqual([...before.entries.keys()].sort(), ['records', 'records/private.json']);
  const stat = lstatSync(file);
  assert.deepEqual(JSON.parse(before.entries.get('records/private.json')), {
    type: 'file', size: stat.size, mtimeMs: stat.mtimeMs,
  });
  assert.equal(JSON.parse(before.entries.get('records')).type, 'dir');
  assert.deepEqual(compareCoreHome(before, snapshotCoreHome(home)), counts());
});

for (const [name, setup, mutate, expected] of [
  ['added file', () => {}, (root) => writeFileSync(join(root, 'private.json'), 'x'), counts(1)],
  ['removed file', (root) => writeFileSync(join(root, 'private.json'), 'x'),
    (root) => rmSync(join(root, 'private.json')), counts(0, 1)],
  ['size change', (root) => writeFileSync(join(root, 'private.json'), 'x'),
    (root) => writeFileSync(join(root, 'private.json'), 'longer'), counts(0, 0, 1)],
  ['mtime change', (root) => writeFileSync(join(root, 'private.json'), 'x'),
    (root) => utimesSync(join(root, 'private.json'), new Date(0), new Date(10000)), counts(0, 0, 1)],
  ['new directory', () => {}, (root) => mkdirSync(join(root, 'private-dir')), counts(1)],
]) {
  test(`${name} is counted`, (t) => {
    const { home, root } = fixture(t);
    setup(root);
    const before = snapshotCoreHome(home);
    mutate(root);
    assert.deepEqual(compareCoreHome(before, snapshotCoreHome(home)), expected);
  });
}

test('root appearance and disappearance each count as a change', (t) => {
  const { home, root } = fixture(t, false);
  const absent = snapshotCoreHome(home);
  mkdirSync(root, { recursive: true });
  const present = snapshotCoreHome(home);
  assert.deepEqual(compareCoreHome(absent, present), counts(0, 0, 1));
  rmSync(root, { recursive: true });
  assert.deepEqual(compareCoreHome(present, snapshotCoreHome(home)), counts(0, 0, 1));
});

test('description discloses counts only', (t) => {
  const { home, root } = fixture(t);
  const before = snapshotCoreHome(home);
  writeFileSync(join(root, 'private-name.json'), 'secret contents');
  const result = compareCoreHome(before, snapshotCoreHome(home));
  assert.deepEqual(result, counts(1));
  assert.equal(describeCoreHomeChange(result),
    "The real account home's .aih/core changed: 1 added, 0 removed, 0 changed.");
  assert.equal(describeCoreHomeChange(counts(3, 2, 1)),
    "The real account home's .aih/core changed: 3 added, 2 removed, 1 changed.");
});

test('symlinks, including a symlink root, are never traversed', { skip: process.platform === 'win32' }, (t) => {
  const { home, root } = fixture(t);
  const outside = join(home, 'outside');
  mkdirSync(outside);
  symlinkSync(outside, join(root, 'linked-dir'));
  symlinkSync(join(home, 'missing'), join(root, 'broken-link'));
  const before = snapshotCoreHome(home);
  assert.equal(JSON.parse(before.entries.get('linked-dir')).type, 'link');
  assert.equal(JSON.parse(before.entries.get('broken-link')).type, 'link');
  writeFileSync(join(outside, 'not-inspected'), 'secret');
  assert.deepEqual(compareCoreHome(before, snapshotCoreHome(home)), counts());
  rmSync(root, { recursive: true });
  symlinkSync(outside, root);
  const linked = snapshotCoreHome(home);
  assert.equal(linked.exists, true);
  assert.equal(linked.entries.size, 1);
  assert.equal(JSON.parse(linked.entries.get('')).type, 'link');
});

test('an unreadable file needs no content read', { skip: process.platform === 'win32' }, (t) => {
  const { home, root } = fixture(t);
  const file = join(root, 'private.json');
  writeFileSync(file, 'secret');
  chmodSync(file, 0);
  const snapshot = snapshotCoreHome(home);
  assert.equal(JSON.parse(snapshot.entries.get('private.json')).type, 'file');
});

test('unreadable directories are recorded rather than silently omitted', { skip: process.platform === 'win32' }, (t) => {
  const { home, root } = fixture(t);
  const dir = join(root, 'private-dir');
  mkdirSync(dir);
  chmodSync(dir, 0);
  try {
    try {
      readdirSync(dir);
      t.skip('account can read directories despite mode 000');
      return;
    } catch (error) {
      assert.equal(error.code, 'EACCES');
    }
    assert.equal(snapshotCoreHome(home).entries.get('private-dir'), 'unreadable');
    chmodSync(root, 0);
    const snapshot = snapshotCoreHome(home);
    assert.equal(snapshot.exists, true);
    assert.equal(snapshot.entries.get(''), 'unreadable');
  } finally {
    chmodSync(root, 0o700);
    chmodSync(dir, 0o700);
  }
});
