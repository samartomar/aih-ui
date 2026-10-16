// Workbench checks must leave the real account's Core records untouched.
import { lstatSync, readdirSync } from 'node:fs';
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

  walk(root, '');
  return { root, exists, entries };
}

export function compareCoreHome(before, after) {
  let added = 0;
  let removed = 0;
  let changed = before.exists === after.exists ? 0 : 1;
  for (const [path, signature] of before.entries) {
    if (!after.entries.has(path)) removed++;
    else if (after.entries.get(path) !== signature) changed++;
  }
  for (const path of after.entries.keys()) {
    if (!before.entries.has(path)) added++;
  }
  return { unchanged: added + removed + changed === 0, added, removed, changed };
}

export function describeCoreHomeChange({ added, removed, changed }) {
  return `The real account home's .aih/core changed: ${added} added, ${removed} removed, ${changed} changed.`;
}
