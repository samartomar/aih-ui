// The candidate's server process: the exact environment it gets, the recorded starting state, and stopping it. Every process
// here is a stub script in a mkdtemp area, named serve.mjs so the command-line check recognises it as this candidate's server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimDataDir, ensureLayout } from '../candidate/data-dir.mjs';
import { candidateLayout } from '../candidate/layout.mjs';
import { isAlive, isCandidateProcess, readServerRecord, runSeedOnly, serverEnvironment, spawnServer, stopServer, waitForReady } from '../candidate/process.mjs';

const STUB = `
import { createServer } from 'node:http';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const data = process.argv[process.argv.indexOf('--data') + 1], mode = process.env.STUB_MODE;
const state = name => join(data, 'state', name);
if (mode === 'env') { writeFileSync(join(data, 'child-env.json'), JSON.stringify(process.env)); process.exit(0); }
if (mode === 'seed') setInterval(() => { if (existsSync(join(data, 'seed-done'))) process.exit(0); }, 50);
if (mode === 'ready') {
  const server = createServer((request, response) => response.end('{}'));
  server.listen(0, '127.0.0.1', () => writeFileSync(state('server.json'), JSON.stringify({ pid: process.pid, state: 'ready', url: 'http://127.0.0.1:' + server.address().port + '/', dataDir: data })));
}
setInterval(() => { if (mode !== 'hung' && existsSync(state('stop-request'))) process.exit(0); }, 100);
`;

const until = async (check, ms = 15_000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { const value = check(); if (value) return value; await new Promise(done => setTimeout(done, 50)); }
  throw new Error('timed out waiting');
};
const refused = code => error => { assert.equal(error.code, code, error.message); return true; };

function area(t) {
  const root = mkdtempSync(join(tmpdir(), 'aih-ui-process-'));
  const { layout } = claimDataDir(join(root, 'candidate'));
  ensureLayout(layout);
  const script = join(root, 'stub', 'serve.mjs');
  mkdirSync(join(root, 'stub'));
  writeFileSync(script, STUB);
  const started = [];
  t.after(() => { for (const pid of started) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } } rmSync(root, { recursive: true, force: true, maxRetries: 3 }); });
  const launch = mode => { const pid = spawnServer({ layout, port: 1, env: { ...serverEnvironment(layout), STUB_MODE: mode }, script }); started.push(pid); return pid; };
  return { root, layout, script, launch };
}

test('the server environment drops every AIH_* setting and adds the candidate home, temporary directory and manifest', t => {
  const { layout } = area(t);
  const env = serverEnvironment(layout, { PATH: '/bin', AIH_X: 'parent', aih_lower: 'parent', Aih_Mixed: 'parent', TEMP: '/real/tmp', Tmp: '/real/tmp2', KEEP: 'yes' });
  assert.equal(env.KEEP, 'yes');
  assert.equal(env.PATH, '/bin');
  assert.deepEqual(Object.keys(env).filter(name => name.toUpperCase().startsWith('AIH_')), ['AIH_CANDIDATE_MANIFEST']);
  assert.equal(env.AIH_CANDIDATE_MANIFEST, layout.manifest);
  for (const name of ['TEMP', 'TMP', 'TMPDIR']) assert.equal(env[name], layout.tmp, name);
  for (const name of ['HOME', 'USERPROFILE']) assert.equal(env[name], layout.home, name);
  assert.ok(existsSync(layout.tmp));
});

test('the server process gets exactly that environment: an AIH_* setting of the parent is absent, the candidate variables are present', async t => {
  const { layout, launch } = area(t);
  process.env.AIH_PARENT_SETTING = 'from the parent';
  t.after(() => { delete process.env.AIH_PARENT_SETTING; });
  const pid = launch('env');
  const starting = readServerRecord(layout);
  assert.deepEqual(Object.keys(starting).sort(), ['dataDir', 'pid', 'startedAt', 'state']);
  assert.equal(starting.pid, pid);
  assert.equal(starting.state, 'starting');
  assert.equal(starting.dataDir, layout.root);
  const child = JSON.parse(await until(() => existsSync(join(layout.root, 'child-env.json')) && readFileSync(join(layout.root, 'child-env.json'), 'utf8')));
  assert.equal(child.AIH_PARENT_SETTING, undefined);
  assert.equal(child.AIH_CANDIDATE_MANIFEST, layout.manifest);
  for (const name of ['TEMP', 'TMP', 'TMPDIR']) assert.equal(child[name], layout.tmp, name);
  assert.equal(child.HOME, layout.home);
});

test('a server that rewrites its record as ready is waited for; one that stays starting times out with an accurate message', async t => {
  const { layout, launch } = area(t);
  const pid = launch('ready');
  const record = await waitForReady(layout, pid, 15_000);
  assert.equal(record.state, 'ready');
  assert.match(record.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  await stopServer(layout, { graceMs: 15_000 });
  const slow = launch('starting');
  await assert.rejects(waitForReady(layout, slow, 600), error => {
    assert.equal(error.code, 'CANDIDATE_START_TIMEOUT');
    assert.match(error.message, /still starting/);
    assert.match(error.message, /candidate\.mjs stop/);
    return true;
  });
  assert.equal(readServerRecord(layout).state, 'starting');
});

test('stop ends a ready server through its stop request and removes the record', async t => {
  const { layout, launch } = area(t);
  const pid = launch('ready');
  await waitForReady(layout, pid, 15_000);
  const stopped = await stopServer(layout, { graceMs: 15_000 });
  assert.equal(stopped.running, true);
  assert.match(stopped.message, /stopped/);
  assert.equal(isAlive(pid), false);
  assert.equal(existsSync(layout.server), false);
  assert.equal(existsSync(layout.stopRequest), false);
  assert.equal((await stopServer(layout)).running, false);
});

test('a server that is still starting (installing, so it cannot read a request) is ended at once after its command line is checked', async t => {
  const { layout, launch } = area(t);
  const pid = launch('starting');
  assert.equal(readServerRecord(layout).state, 'starting');
  await until(() => isCandidateProcess(layout, pid), 30_000);
  const begun = Date.now();
  const stopped = await stopServer(layout, { graceMs: 60_000 });
  assert.ok(Date.now() - begun < 30_000, 'no request grace while starting');
  assert.match(stopped.message, /still starting\) ended/);
  assert.equal(existsSync(layout.stopRequest), false);
  assert.equal(isAlive(pid), false);
  assert.equal(existsSync(layout.server), false);
});

test('a server that ignores the stop request is ended by force, but only after its command line names this candidate', async t => {
  const { layout, script, launch } = area(t);
  const pid = launch('hung');
  assert.equal(await until(() => isCandidateProcess(layout, pid), 30_000), true);
  writeFileSync(layout.server, JSON.stringify({ ...readServerRecord(layout), state: 'ready' }));
  const stopped = await stopServer(layout, { graceMs: 500 });
  assert.match(stopped.message, /ended after it did not stop on request/);
  assert.equal(isAlive(pid), false);
  assert.ok(existsSync(script));
});

test('a pid that is not this candidate is never ended: stop refuses and leaves it alone', async t => {
  const { layout } = area(t);
  assert.equal(isCandidateProcess(layout, process.pid), false);
  writeFileSync(layout.server, JSON.stringify({ pid: process.pid, state: 'starting', dataDir: layout.root }));
  await assert.rejects(stopServer(layout, { graceMs: 300 }), refused('CANDIDATE_STOP_REFUSED'));
  assert.equal(isAlive(process.pid), true);
  assert.equal(existsSync(layout.stopRequest), false);
});

test("reset's seeding run is recorded while it runs, so status, stop, start and reset see it, and its record goes when it exits", async t => {
  const { layout, script } = area(t);
  const seeding = runSeedOnly({ layout, env: { ...serverEnvironment(layout), STUB_MODE: 'seed' }, timeoutMs: 15_000, script });
  const record = await until(() => readServerRecord(layout));
  assert.equal(record.state, 'seeding');
  assert.ok(isAlive(record.pid));
  writeFileSync(join(layout.root, 'seed-done'), '');
  assert.deepEqual(await seeding, { complete: true });
  assert.equal(existsSync(layout.server), false);
});

test("stop ends reset's seeding run at once, naming it", async t => {
  const { layout, script } = area(t);
  const seeding = runSeedOnly({ layout, env: { ...serverEnvironment(layout), STUB_MODE: 'seed' }, timeoutMs: 30_000, script });
  const record = await until(() => readServerRecord(layout));
  await until(() => isCandidateProcess(layout, record.pid), 30_000);
  const stopped = await stopServer(layout, { graceMs: 60_000 });
  assert.match(stopped.message, /still making the sample data\) ended/);
  assert.equal(isAlive(record.pid), false);
  await assert.rejects(seeding, refused('CANDIDATE_SEED_FAILED'));
});
