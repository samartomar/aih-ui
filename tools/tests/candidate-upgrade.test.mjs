import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// The candidate refuses any Node outside its declared range before it reads a manifest, so the archive check is
// reachable only on a supported runtime.
const [major, minor] = process.versions.node.split('.').map(Number);
const unsupported = major !== 24 || minor < 15 ? `the Workbench candidate requires Node >=24.15 and <25; this is Node ${process.versions.node}` : false;

test('preflight refuses changed archives before creating candidate state or stopping anything', { skip: unsupported }, t => {
  const root = mkdtempSync(join(tmpdir(), 'candidate-upgrade-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const entry = { tarball: join(root, 'changed.tgz'), sha256: 'a'.repeat(64), commit: 'abcdef0' };
  writeFileSync(entry.tarball, 'changed');
  const manifest = join(root, 'manifest.json'), data = join(root, 'untouched');
  writeFileSync(manifest, JSON.stringify({ schema: 'urn:aih-ui:candidate-manifest:1.0.0', ui: entry, packages: {core: entry, catalog: entry, scan: entry} }));
  const result = spawnSync(process.execPath, [resolve('tools/candidate.mjs'), 'preflight', '--manifest', manifest, '--data', data, '--port', '4899'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /has sha256/);
  assert.equal(existsSync(data), false);
});
