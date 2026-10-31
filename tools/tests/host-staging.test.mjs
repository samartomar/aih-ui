// A Workbench host's staged Catalog material: removed when the host stops, and what a killed host left is removed by the
// next start, while nothing else in the temporary folder is touched. Each test uses its own folder as the temporary
// folder, so no real host's staging is involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { STAGING_MARKER, UNMARKED_AGE_MS, createStaging, releaseStaging, sweepStaging } from '../consumer/host-staging.mjs';

const module = pathToFileURL(join(import.meta.dirname, '../consumer/host-staging.mjs')).href;
const scratch = async t => { const root = await mkdtemp(join(tmpdir(), 'host-staging-test-')); t.after(() => rm(root, { recursive: true, force: true })); return root; };
// A process that is certainly gone: a child that has already exited.
const deadPid = () => spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout * 1;

test('a staging folder is marked with the host process and removed when the host releases it', async t => {
  const root = await scratch(t);
  const directory = await createStaging('aih-authoring-materials-', { root });
  assert.match(directory, /aih-authoring-materials-[A-Za-z0-9]{6}$/);
  await writeFile(join(directory, 'material.md'), 'text');
  assert.ok(existsSync(join(directory, STAGING_MARKER)));
  releaseStaging(directory);
  assert.equal(existsSync(directory), false);
  await assert.rejects(createStaging('other-', { root }), /Unknown host staging prefix/);
});

test('a host process that exits without closing its server leaves no staging folder', async t => {
  const root = await scratch(t);
  const run = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const { createStaging } = await import(${JSON.stringify(module)}); const d = await createStaging('aih-personal-grant-', { root: ${JSON.stringify(root)} }); process.stdout.write(d);`], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stdout.includes('aih-personal-grant-'));
  assert.deepEqual(await readdir(root), []);
});

test('a start removes what a killed host left, and keeps a live host\'s, its own, and everything that is not its staging', async t => {
  const root = await scratch(t);
  const folder = async (name, marker) => { const path = join(root, name); await mkdir(path); await writeFile(join(path, 'material.md'), 'text');
    if (marker !== undefined) await writeFile(join(path, STAGING_MARKER), JSON.stringify(marker)); return path; };
  const killed = await folder('aih-authoring-materials-Kill01', { pid: deadPid() });
  const killedGrant = await folder('aih-personal-grant-Kill02', { pid: deadPid() });
  const running = await folder('aih-authoring-materials-Live01', { pid: process.ppid });
  const old = await folder('aih-authoring-materials-Old001');
  const recent = await folder('aih-authoring-materials-New001');
  const day = (Date.now() - UNMARKED_AGE_MS - 60_000) / 1000;
  await utimes(old, day, day);
  // Not this Workbench's: another prefix, a near-miss name, a plain file, and a link to a folder elsewhere.
  const other = await folder('aih-readiness-Kill03', { pid: deadPid() });
  const longer = await folder('aih-authoring-materials-Kill0004', { pid: deadPid() });
  await writeFile(join(root, 'aih-authoring-materials-File01'), 'not a folder');
  const target = await scratch(t);
  await writeFile(join(target, STAGING_MARKER), JSON.stringify({ pid: deadPid() }));
  await symlink(target, join(root, 'aih-authoring-materials-Link01'), 'dir').catch(() => {});
  const mine = await createStaging('aih-authoring-materials-', { root });

  const removed = await sweepStaging({ root });
  assert.deepEqual(removed.sort(), [killed, killedGrant, old].sort());
  for (const kept of [running, recent, other, longer, target, mine]) assert.ok(existsSync(kept), kept);
  assert.ok(existsSync(join(root, 'aih-authoring-materials-File01')));
  releaseStaging(mine);
});

test('another account\'s staging folder is never removed', { skip: process.getuid === undefined && 'this platform reports no folder owners' }, async t => {
  const root = await scratch(t);
  const path = join(root, 'aih-authoring-materials-Kill05'); await mkdir(path);
  await writeFile(join(path, STAGING_MARKER), JSON.stringify({ pid: deadPid() }));
  assert.deepEqual(await sweepStaging({ root, uid: process.getuid() + 1 }), []);
  assert.ok(existsSync(path));
});
