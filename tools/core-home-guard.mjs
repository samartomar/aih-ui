// Workbench checks must leave the real account's Core records untouched.
import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

export function snapshotCoreHome(home) {
  const root = join(home, '.aih', 'core');
  const entries = new Map();
  let exists = true;

  function walk(path, relative) {
    let stat;
    try {
      stat = lstatSync(path);
    } catch (error) {
      if (relative === '' && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
        exists = false;
      } else {
        entries.set(relative, 'unreadable');
      }
      return;
    }
    const type = stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'dir' : stat.isFile() ? 'file' : 'other';
    // Root existence is compared separately; its directory metadata is not an entry.
    if (relative !== '' || type !== 'dir') {
      entries.set(relative, JSON.stringify({ type, size: stat.size, mtimeMs: stat.mtimeMs }));
    }
    if (type !== 'dir') return;
    let names;
    try {
      names = readdirSync(path);
    } catch {
      entries.set(relative, 'unreadable');
      return;
    }
    for (const name of names) walk(join(path, name), relative ? `${relative}/${name}` : name);
  }

  // A linked `.aih/core` is still the home Core writes to, so the walk starts at its target, which is recorded too.
  // Links inside are not followed. A target that cannot be resolved leaves `target` null: the listing is incomplete.
  let target = root;
  try { target = realpathSync(root); } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) target = null; }
  walk(target ?? root, '');
  return { root, exists, target, entries };
}

export function compareCoreHome(before, after) {
  let added = 0;
  let removed = 0;
  let changed = before.exists === after.exists && before.target === after.target ? 0 : 1;
  for (const [path, signature] of before.entries) {
    if (!after.entries.has(path)) removed++;
    else if (after.entries.get(path) !== signature) changed++;
  }
  // Anything that could not be read cannot prove itself unchanged, so it is counted on its own and fails the comparison.
  // Each path counts once, however many snapshots could not read it; an unresolved root is the root path `''`.
  const unreadablePaths = new Set();
  for (const { exists, target, entries } of [before, after]) {
    if (exists && target === null) unreadablePaths.add('');
    for (const [path, signature] of entries) if (signature === 'unreadable') unreadablePaths.add(path);
  }
  const unreadable = unreadablePaths.size;
  for (const path of after.entries.keys()) {
    if (!before.entries.has(path)) added++;
  }
  return { unchanged: added + removed + changed + unreadable === 0, added, removed, changed, unreadable };
}

export function describeCoreHomeChange({ added, removed, changed, unreadable }) {
  return `The real account home's .aih/core changed or could not be read: ${added} added, ${removed} removed, ${changed} changed, ${unreadable} unreadable.`;
}
