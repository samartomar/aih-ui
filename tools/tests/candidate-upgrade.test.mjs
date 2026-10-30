import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertSupportedNode } from '../candidate/upgrade.mjs';

// The candidate refuses any Node outside its declared range before it reads a manifest, so the archive check is
// reachable only on a supported runtime.
const unsupported = (() => { try { assertSupportedNode(process.versions.node); return false; } catch (error) { return error.message; } })();

test('the candidate accepts the producer archives\' Node range, 26.12.1 through 26.x, and nothing else', () => {
  for (const version of ['26.12.1', '26.12.9', '26.13.0', '26.99.0']) assert.doesNotThrow(() => assertSupportedNode(version), version);
  for (const version of ['24.15.0', '24.22.2', '25.9.0', '26.0.0', '26.12.0', '26.11.5', '27.0.0', '28.1.0']) {
    assert.throws(() => assertSupportedNode(version), error => {
      assert.match(error.message, />=26\.12\.1 <27/, `${version}: the refusal names the required range`);
      assert.match(error.message, new RegExp(`Node ${version.replaceAll('.', '\\.')}`), `${version}: the refusal names the running Node`);
      return true;
    }, version);
  }
});

test('preflight refuses an unsupported Node before it reads the manifest', { skip: unsupported ? false : 'this Node is supported' }, () => {
  const result = spawnSync(process.execPath, [resolve('tools/candidate.mjs'), 'preflight', '--manifest', 'missing.json', '--data', 'unused', '--port', '4899'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, />=26\.12\.1 <27/);
});

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
