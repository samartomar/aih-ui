// The staged TLS-interception condition: staging and cleanup stay inside the data directory, the environment reaches only the processes
// it is given to, and the interceptor really breaks and then (with the sample CA) serves a handshake. Everything is local: the
// "registry" is a TLS server in this process with its own throwaway CA, so no test contacts the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { claimDataDir, ensureLayout, resetDataDir } from '../candidate/data-dir.mjs';
import { candidateLayout } from '../candidate/layout.mjs';
import { serverEnvironment } from '../candidate/process.mjs';
import { writeReport } from '../candidate/report.mjs';
import { forgetSample } from '../candidate/samples.mjs';
import { createSampleCa } from '../candidate/sample-ca.mjs';
import { STAGED_CONDITION_SCHEMA, STAGED_LABEL, TLS_ROUTE_MODULE, activateStagedCondition, rotateTlsInterception, stageTlsInterception, stagedEnvironment, stagedTlsCondition, startInterceptor, unstageTlsInterception, writeStagedRepairs }
  from '../candidate/tls-interception.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(REPO_ROOT, 'tools', 'candidate.mjs');
const until = async (check, ms = 10_000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { const value = check(); if (value) return value; await new Promise(done => setTimeout(done, 25)); }
  throw new Error('timed out waiting');
};

// A claimed data directory inside a temporary area, next to a stand-in for the account home.
function area(t) {
  const root = mkdtempSync(join(tmpdir(), 'aih-ui-tls-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fakeHome = join(root, 'home');
  mkdirSync(fakeHome);
  writeFileSync(join(fakeHome, '.npmrc'), 'registry=https://registry.npmjs.org/\n');
  const data = join(root, 'candidate'), { layout } = claimDataDir(data);
  ensureLayout(layout);
  return { root, data, fakeHome, layout };
}
// A readiness sample already made, as a start would have left it.
function seedReadiness(layout) {
  mkdirSync(join(layout.readiness, 'home'), { recursive: true });
  writeFileSync(join(layout.readiness, 'SAMPLE.md'), 'made earlier');
  writeFileSync(join(layout.samples, '.seeded.json'), JSON.stringify({ schema: 'urn:aih-ui:candidate-seeded:1.0.0', samples: { readiness: { seededAt: 'earlier' }, organization: { seededAt: 'earlier' } } }));
}
const seeded = layout => Object.keys(JSON.parse(readFileSync(join(layout.samples, '.seeded.json'), 'utf8')).samples).sort();
function listing(root) {
  const found = [];
  const walk = directory => { for (const entry of readdirSync(directory, { withFileTypes: true })) { const path = join(directory, entry.name); found.push(relative(root, path)); if (entry.isDirectory()) walk(path); } };
  walk(root);
  return found.sort();
}
const cli = (data, ...args) => spawnSync(process.execPath, [CLI, 'tls-interception', ...args, '--data', data], { encoding: 'utf8', windowsHide: true, cwd: REPO_ROOT });

test('staging writes only under the data directory, matches its CA, and makes the readiness sample again', t => {
  const { root, data, fakeHome, layout } = area(t);
  seedReadiness(layout);
  const outsideBefore = { root: listing(root).filter(path => !path.startsWith('candidate')), home: listing(fakeHome), homeNpmrc: readFileSync(join(fakeHome, '.npmrc'), 'utf8') };
  const condition = stageTlsInterception(layout, { now: new Date('2026-10-16T12:00:00Z') });
  assert.equal(condition.schema, STAGED_CONDITION_SCHEMA);
  assert.equal(condition.schema, 'urn:aih-ui:candidate-staged-condition:1.0.0');
  assert.equal(condition.condition, 'tls-interception');
  assert.equal(condition.stagedAt, '2026-10-16T12:00:00.000Z');
  assert.deepEqual(condition.hosts, ['registry.npmjs.org']);
  assert.deepEqual(listing(layout.stagedTls), ['STAGED.md', 'condition.json', 'interceptor-key.pem', 'interceptor.pem', 'sample-ca.pem']);
  const ca = new X509Certificate(readFileSync(join(layout.stagedTls, 'sample-ca.pem')));
  assert.equal(condition.caSha256, ca.fingerprint256.replaceAll(':', '').toLowerCase());
  assert.deepEqual(JSON.parse(readFileSync(join(layout.stagedTls, 'condition.json'), 'utf8')), condition);
  assert.deepEqual(stagedTlsCondition(layout), condition);
  const notice = readFileSync(join(layout.stagedTls, 'STAGED.md'), 'utf8');
  assert.match(notice, /staged sample condition/i);
  assert.match(notice, /tls-interception off/);
  assert.ok(!notice.includes('PRIVATE KEY'));
  assert.equal(existsSync(layout.readiness), false);
  assert.deepEqual(seeded(layout), ['organization']);
  // Nothing outside the data directory moved, and the stand-in account home is as it was.
  assert.deepEqual({ root: listing(root).filter(path => !path.startsWith('candidate')), home: listing(fakeHome), homeNpmrc: readFileSync(join(fakeHome, '.npmrc'), 'utf8') }, outsideBefore);
  assert.ok(existsSync(data));
});

test('a staged condition with a missing file or a different CA is not staged', t => {
  const { layout } = area(t);
  assert.equal(stagedTlsCondition(layout), null);
  stageTlsInterception(layout);
  assert.ok(stagedTlsCondition(layout));
  const other = createSampleCa({ hosts: ['registry.npmjs.org'] });
  writeFileSync(join(layout.stagedTls, 'sample-ca.pem'), other.caPem);
  assert.equal(stagedTlsCondition(layout), null);
  stageTlsInterception(layout);
  rmSync(join(layout.stagedTls, 'interceptor-key.pem'));
  assert.equal(stagedTlsCondition(layout), null);
});

test('rotation requires a staged condition and preserves old trust and the readiness sample', t => {
  const { layout } = area(t);
  assert.throws(() => rotateTlsInterception(layout), error => error.code === 'CANDIDATE_NOT_STAGED');
  const before = stageTlsInterception(layout), oldCa = join(layout.stagedTls, 'sample-ca.pem'), oldBytes = readFileSync(oldCa, 'utf8');
  seedReadiness(layout);
  const sample = readFileSync(join(layout.samples, '.seeded.json'), 'utf8');
  const after = rotateTlsInterception(layout);
  assert.notEqual(after.caSha256, before.caSha256);
  assert.equal(after.stagedAt, before.stagedAt);
  assert.deepEqual(stagedTlsCondition(layout), after);
  assert.equal(readFileSync(oldCa, 'utf8'), oldBytes);
  assert.equal(readFileSync(join(layout.readiness, 'SAMPLE.md'), 'utf8'), 'made earlier');
  assert.equal(readFileSync(join(layout.samples, '.seeded.json'), 'utf8'), sample);
  const offer = JSON.parse(readFileSync(layout.stagedRepairs, 'utf8')).repairs[0].inputs.caFile;
  assert.notEqual(offer, oldCa);
  assert.equal(new X509Certificate(readFileSync(offer)).fingerprint256.replaceAll(':', '').toLowerCase(), after.caSha256);
  const bytes = readFileSync(offer, 'utf8');
  rotateTlsInterception(layout);
  assert.equal(readFileSync(offer, 'utf8'), bytes, 'every earlier repair input stays untouched');
  unstageTlsInterception(layout);
  assert.equal(existsSync(layout.stagedTls), false);
  assert.equal(existsSync(layout.stagedRepairs), false);
});

test('CLI rotation is refused unstaged and works with a live candidate record', t => {
  const { data, layout } = area(t);
  const refused = cli(data, 'rotate');
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /not staged/i);
  const before = stageTlsInterception(layout);
  seedReadiness(layout);
  writeFileSync(layout.server, JSON.stringify({ pid: process.pid, state: 'ready', url: 'http://127.0.0.1:1/' }));
  const rotated = cli(data, 'rotate');
  assert.equal(rotated.status, 0, rotated.stderr);
  assert.match(rotated.stdout, /staged sample rotation/i);
  assert.match(rotated.stdout, /only the candidate's.*services/i);
  assert.match(rotated.stdout, /earlier repair stays as it was/i);
  assert.match(rotated.stdout, /Node certificate check.*fails again.*repair.*again/i);
  assert.match(rotated.stdout, /offers the new sample CA after the next start/);
  assert.notEqual(stagedTlsCondition(layout).caSha256, before.caSha256);
  assert.ok(existsSync(layout.readiness));
});

test('the command stages, reports status and turns off, and refuses while a recorded process is alive', t => {
  const { data, layout } = area(t);
  seedReadiness(layout);
  assert.match(cli(data, 'status').stdout, /not staged/i);
  const on = cli(data, 'on');
  assert.equal(on.status, 0, on.stderr);
  assert.match(on.stdout, /next start/i);
  const condition = stagedTlsCondition(layout);
  assert.ok(condition);
  const status = cli(data, 'status');
  assert.equal(status.status, 0, status.stderr);
  assert.ok(status.stdout.includes(condition.caSha256), status.stdout);
  assert.match(status.stdout, /staged/i);
  // A recorded live process (this one) blocks both directions.
  writeFileSync(layout.server, JSON.stringify({ pid: process.pid, state: 'ready', url: 'http://127.0.0.1:1/' }));
  for (const word of ['on', 'off']) {
    const refused = cli(data, word);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /already|running|Stop it first/i);
  }
  assert.ok(stagedTlsCondition(layout), 'the refused off left the condition in place');
  rmSync(layout.server);
  const off = cli(data, 'off');
  assert.equal(off.status, 0, off.stderr);
  assert.match(off.stdout, /next start/i);
  assert.equal(stagedTlsCondition(layout), null);
  assert.match(cli(data, 'status').stdout, /not staged/i);
});

test('the command refuses a directory the candidate did not make and a missing or unknown mode', t => {
  const { root, data } = area(t);
  const foreign = join(root, 'foreign');
  mkdirSync(foreign);
  writeFileSync(join(foreign, 'keep.txt'), 'keep');
  const refused = cli(foreign, 'on');
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /not (empty|a plain|used)|candidate marker|does not exist/i);
  assert.deepEqual(readdirSync(foreign), ['keep.txt']);
  assert.notEqual(cli(data).status, 0);
  assert.match(cli(data, 'sideways').stderr, /usage/i);
});

test('off removes the staged folder and repairs, makes readiness again, and a second off changes nothing', t => {
  const { layout } = area(t);
  stageTlsInterception(layout);
  writeStagedRepairs(layout, stagedTlsCondition(layout));
  seedReadiness(layout);
  assert.ok(existsSync(layout.stagedRepairs));
  assert.equal(unstageTlsInterception(layout).changed, true);
  assert.equal(existsSync(layout.stagedTls), false);
  assert.equal(existsSync(join(layout.root, 'staged')), false);
  assert.equal(existsSync(layout.stagedRepairs), false);
  assert.equal(existsSync(layout.readiness), false);
  assert.deepEqual(seeded(layout), ['organization']);
  // Idempotent, and a readiness sample made since is not thrown away by a second off.
  seedReadiness(layout);
  assert.equal(unstageTlsInterception(layout).changed, false);
  assert.ok(existsSync(layout.readiness));
  assert.deepEqual(seeded(layout), ['organization', 'readiness']);
});

test('reset removes the whole data directory, so the condition is no longer staged', async t => {
  const { data, layout } = area(t);
  stageTlsInterception(layout);
  assert.ok(stagedTlsCondition(layout));
  await resetDataDir(data);
  assert.equal(stagedTlsCondition(candidateLayout(data)), null);
  assert.equal(existsSync(layout.stagedTls), false);
});

test('the staged repair file offers the one CA repair, and carries exactly the two banner strings', t => {
  const { layout } = area(t);
  const condition = stageTlsInterception(layout);
  writeStagedRepairs(layout, condition);
  const written = JSON.parse(readFileSync(layout.stagedRepairs, 'utf8'));
  assert.deepEqual(Object.keys(written).sort(), ['repairs', 'staged']);
  assert.deepEqual(Object.keys(written.staged).sort(), ['detail', 'label']);
  assert.equal(written.staged.label, STAGED_LABEL);
  assert.equal(STAGED_LABEL, 'Staged condition: TLS interception (sample)');
  assert.match(written.staged.detail, /tls-interception off/);
  assert.deepEqual(written.repairs, [{ key: 'npm-ca', id: 'node-npm-ca', targets: ['npm'], inputs: { caFile: join(layout.stagedTls, 'sample-ca.pem') }, network: 'declared' }]);
});

test('confinement: the server environment carries nothing of the condition, and the staged environment changes exactly its own keys', t => {
  const { data, layout } = area(t);
  const before = JSON.stringify(process.env);
  stageTlsInterception(layout);
  const server = serverEnvironment(layout, { PATH: '/bin', NODE_OPTIONS: '--max-old-space-size=1024' });
  assert.equal(server.NODE_OPTIONS, '--max-old-space-size=1024', 'the base value is passed on, with nothing added');
  assert.ok(!('AIH_CANDIDATE_TLS_ROUTE' in server));
  assert.deepEqual(Object.keys(server).filter(name => /proxy/i.test(name)), [], 'no proxy setting of any spelling');
  assert.ok(!server.NODE_OPTIONS.includes('tls-route'));

  const base = Object.freeze({ PATH: '/bin', NODE_OPTIONS: '--max-old-space-size=1024', KEEP: 'yes' });
  const staged = stagedEnvironment({ base, routeModule: TLS_ROUTE_MODULE, tlsPort: 1111, proxyPort: 2222, repairsFile: layout.stagedRepairs });
  assert.deepEqual(Object.keys(base).sort(), ['KEEP', 'NODE_OPTIONS', 'PATH'], 'base is not mutated');
  assert.equal(base.NODE_OPTIONS, '--max-old-space-size=1024');
  const changed = Object.keys(staged).filter(name => staged[name] !== base[name]).sort();
  assert.deepEqual(changed, ['AIH_CANDIDATE_TLS_ROUTE', 'AIH_READINESS_REPAIRS', 'NODE_OPTIONS', 'npm_config_https_proxy', 'npm_config_proxy']);
  assert.match(staged.NODE_OPTIONS, /^--max-old-space-size=1024 --import=file:\/\/\/.*tls-route\.mjs$/);
  assert.equal(staged.AIH_CANDIDATE_TLS_ROUTE, 'registry.npmjs.org=127.0.0.1:1111');
  assert.equal(staged.npm_config_https_proxy, 'http://127.0.0.1:2222');
  assert.equal(staged.npm_config_proxy, 'http://127.0.0.1:2222');
  assert.equal(staged.AIH_READINESS_REPAIRS, layout.stagedRepairs);
  assert.equal(staged.KEEP, 'yes');
  for (const name of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'NODE_EXTRA_CA_CERTS', 'npm_config_cafile', 'npm_config_registry']) assert.ok(!(name in staged), name);
  assert.equal(stagedEnvironment({ base: { PATH: '/bin' }, routeModule: TLS_ROUTE_MODULE, tlsPort: 1, proxyPort: 2, repairsFile: 'x' }).NODE_OPTIONS.startsWith('--import='), true);

  // The launcher's own environment is the same after staging, turning off and building the staged environment.
  stageTlsInterception(layout);
  stagedEnvironment({ base: process.env, routeModule: TLS_ROUTE_MODULE, tlsPort: 1, proxyPort: 2, repairsFile: layout.stagedRepairs });
  unstageTlsInterception(layout);
  assert.equal(JSON.stringify(process.env), before);
  assert.ok(data);
});

// ---- the interceptor, end to end -----------------------------------------------------------------------------------------------

// The "registry": a TLS server with its own throwaway CA that answers a fixed body.
async function fakeRegistry(t) {
  const { caPem, leafPem, leafKeyPem } = createSampleCa({ hosts: ['registry.npmjs.org'] });
  const server = tls.createServer({ key: leafKeyPem, cert: leafPem }, socket => { socket.on('error', () => {}); socket.end('upstream-body'); });
  server.on('tlsClientError', () => {});
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => server.close());
  return { port: server.address().port, caPem };
}
async function interceptor(t) {
  const context = area(t), registry = await fakeRegistry(t);
  stageTlsInterception(context.layout);
  writeStagedRepairs(context.layout, stagedTlsCondition(context.layout));
  const running = await startInterceptor({ layout: context.layout, upstream: { host: '127.0.0.1', port: registry.port }, upstreamCa: registry.caPem });
  t.after(() => running.close());
  const base = Object.fromEntries(Object.entries(process.env).filter(([name]) => !['NODE_EXTRA_CA_CERTS', 'NODE_USE_SYSTEM_CA', 'NODE_OPTIONS'].includes(name.toUpperCase())));
  const env = stagedEnvironment({ base, routeModule: TLS_ROUTE_MODULE, tlsPort: running.tlsPort, proxyPort: running.proxyPort, repairsFile: context.layout.stagedRepairs });
  return { ...context, running, registry, base, env, stagedCa: readFileSync(join(context.layout.stagedTls, 'sample-ca.pem'), 'utf8') };
}
// A child that connects to the registry name. It refuses to connect at all unless the reroute hook is present, so a failed hook can
// never reach the real registry.
const CLIENT = `
import tls from 'node:tls';
import { readFileSync } from 'node:fs';
if (tls.connect.name !== 'aihCandidateTlsConnect') { console.log(JSON.stringify({ hook: tls.connect.name })); process.exit(0); }
const ca = process.env.CA_FILE ? readFileSync(process.env.CA_FILE) : undefined;
const socket = tls.connect({ host: 'registry.npmjs.org', port: 443, servername: 'registry.npmjs.org', ...(ca ? { ca } : {}) });
let body = '';
socket.on('data', chunk => { body += chunk; });
socket.on('end', () => console.log(JSON.stringify({ body })));
socket.on('error', error => { console.log(JSON.stringify({ error: error.code })); process.exit(0); });
`;
const PROBE = 'import tls from "node:tls"; console.log(JSON.stringify({ hook: tls.connect.name }));';
const runNode = (code, env) => new Promise((done, fail) => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', chunk => { out += chunk; });
  child.stderr.on('data', chunk => { err += chunk; });
  child.on('error', fail);
  child.on('close', status => done({ status, out: out.trim(), err }));
});

test('a staged process cannot verify the interceptor without the sample CA, and reads the upstream body with it', async t => {
  const { env, stagedCa, layout, running } = await interceptor(t);
  const without = await runNode(CLIENT, env);
  assert.equal(without.status, 0, without.err);
  assert.match(JSON.parse(without.out).error, /UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_GET_ISSUER_CERT/);
  const caFile = join(layout.stagedTls, 'sample-ca.pem');
  assert.equal(readFileSync(caFile, 'utf8'), stagedCa);
  const trusted = await runNode(CLIENT, { ...env, CA_FILE: caFile });
  assert.equal(trusted.status, 0, trusted.err);
  assert.deepEqual(JSON.parse(trusted.out), { body: 'upstream-body' });
  assert.equal(trusted.err, '', 'the preload writes nothing');
  await until(() => running.counts().refusedByClient >= 1 && running.counts().intercepted >= 1);
  const log = readFileSync(layout.tlsLog, 'utf8');
  assert.match(log, /intercepted registry\.npmjs\.org/);
  assert.match(log, /handshake ended by the client/);
});

test('a running interceptor rotates its chain and keeps its previous context when new material is invalid', async t => {
  const { layout, running, env } = await interceptor(t), oldCa = join(layout.stagedTls, 'sample-ca.pem');
  assert.deepEqual(JSON.parse((await runNode(CLIENT, { ...env, CA_FILE: oldCa })).out), { body: 'upstream-body' });
  const after = rotateTlsInterception(layout);
  const newCa = JSON.parse(readFileSync(layout.stagedRepairs, 'utf8')).repairs[0].inputs.caFile;
  const stale = await runNode(CLIENT, { ...env, CA_FILE: oldCa });
  assert.match(JSON.parse(stale.out).error, /UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_GET_ISSUER_CERT/);
  assert.deepEqual(JSON.parse((await runNode(CLIENT, { ...env, CA_FILE: newCa })).out), { body: 'upstream-body' });
  assert.equal(readFileSync(layout.tlsLog, 'utf8').split('TLS sample CA rotated to').length - 1, 1);
  assert.ok(readFileSync(layout.tlsLog, 'utf8').includes(after.caSha256));
  rotateTlsInterception(layout);
  const brokenCa = JSON.parse(readFileSync(layout.stagedRepairs, 'utf8')).repairs[0].inputs.caFile;
  writeFileSync(brokenCa, readFileSync(oldCa));
  assert.equal(stagedTlsCondition(layout), null);
  assert.deepEqual(JSON.parse((await runNode(CLIENT, { ...env, CA_FILE: newCa })).out), { body: 'upstream-body' });
  assert.match(readFileSync(layout.tlsLog, 'utf8'), /TLS sample rotation refused.*digest|TLS sample rotation refused.*incomplete/);
});

test('a process without the staged environment is not rerouted', async t => {
  const { base, env } = await interceptor(t);
  const unstaged = await runNode(CLIENT, base);
  assert.deepEqual(JSON.parse(unstaged.out), { hook: 'connect' }, 'it stopped before any connection');
  assert.deepEqual(JSON.parse((await runNode(PROBE, base)).out), { hook: 'connect' });
  assert.deepEqual(JSON.parse((await runNode(PROBE, env)).out), { hook: 'aihCandidateTlsConnect' });
});

// Sends a CONNECT line and returns the socket and the status line of the answer.
function connectThrough(port, target) {
  return new Promise((done, fail) => {
    const socket = net.connect(port, '127.0.0.1');
    let head = '';
    socket.on('error', fail);
    socket.on('connect', () => socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    const onData = chunk => {
      head += chunk;
      if (!head.includes('\r\n\r\n')) return;
      socket.off('data', onData);
      done({ socket, status: head.split('\r\n')[0] });
    };
    socket.on('data', onData);
  });
}

test('the proxy answers CONNECT for the listed host, relays the upstream body, and refuses anything else with 403', async t => {
  const { running, stagedCa, layout } = await interceptor(t);
  const { socket, status } = await connectThrough(running.proxyPort, 'registry.npmjs.org:443');
  assert.equal(status, 'HTTP/1.1 200 Connection Established');
  const body = await new Promise((done, fail) => {
    const secure = tls.connect({ socket, servername: 'registry.npmjs.org', ca: stagedCa });
    let text = '';
    secure.on('data', chunk => { text += chunk; });
    secure.on('end', () => done(text));
    secure.on('error', fail);
  });
  assert.equal(body, 'upstream-body');
  for (const target of ['example.org:443', 'registry.npmjs.org:80', 'registry.npmjs.org.evil.example:443']) {
    const refused = await connectThrough(running.proxyPort, target);
    assert.equal(refused.status, 'HTTP/1.1 403 Forbidden', target);
    refused.socket.destroy();
  }
  // An ordinary request is refused as well.
  const plain = await fetch(`http://127.0.0.1:${running.proxyPort}/anything`);
  assert.equal(plain.status, 403);
  const counts = running.counts();
  assert.deepEqual([counts.connectAccepted, counts.connectRefused, counts.intercepted], [1, 4, 1]);
  assert.match(readFileSync(layout.tlsLog, 'utf8'), /refused CONNECT example\.org:443/);
});

test('an upstream that cannot be reached is logged and the client connection is closed', async t => {
  const { layout } = area(t);
  stageTlsInterception(layout);
  const dead = net.createServer().listen(0, '127.0.0.1');
  await new Promise(done => dead.once('listening', done));
  const port = dead.address().port;
  await new Promise(done => dead.close(done));
  const running = await startInterceptor({ layout, upstream: { host: '127.0.0.1', port } });
  t.after(() => running.close());
  const stagedCa = readFileSync(join(layout.stagedTls, 'sample-ca.pem'), 'utf8');
  const result = await new Promise(done => {
    const socket = tls.connect({ host: '127.0.0.1', port: running.tlsPort, servername: 'registry.npmjs.org', ca: stagedCa });
    socket.on('error', error => done({ error: error.code }));
    socket.on('close', () => done({ closed: true }));
    socket.on('data', () => {});
  });
  assert.ok(result.closed || result.error);
  await until(() => running.counts().upstreamErrors >= 1);
  assert.match(readFileSync(layout.tlsLog, 'utf8'), /upstream error/);
});

test('startInterceptor refuses when the condition is not staged', async t => {
  const { layout } = area(t);
  await assert.rejects(startInterceptor({ layout }), error => error.code === 'CANDIDATE_NOT_STAGED');
});

// ---- the report ------------------------------------------------------------------------------------------------------------------

const readBundle = (dir, base = dir) => Object.fromEntries(readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? Object.entries(readBundle(path, base)) : [[relative(base, path).split('\\').join('/'), readFileSync(path, 'utf8')]];
}));

test('a staged bundle names the condition and includes its record and notice, never the key; an unstaged bundle says nothing', async t => {
  const { data, layout } = area(t);
  const plain = readBundle((await writeReport({ dataDir: data, now: new Date('2026-01-01T00:00:00Z') })).bundleDir);
  assert.ok(!Object.keys(plain).some(path => path.startsWith('staged/')));
  assert.ok(!Object.values(plain).join('\n').match(/staged condition|tls interception|tls-interception/i));

  stageTlsInterception(layout);
  writeFileSync(layout.tlsLog, `${new Date().toISOString()} intercepted registry.npmjs.org\n`);
  const bundle = readBundle((await writeReport({ dataDir: data, now: new Date('2026-01-02T00:00:00Z') })).bundleDir);
  const text = Object.values(bundle).join('\n');
  assert.ok('staged/condition.json' in bundle);
  assert.ok('staged/STAGED.md' in bundle);
  assert.equal(JSON.parse(bundle['staged/condition.json']).caSha256, stagedTlsCondition(layout).caSha256);
  assert.ok(!Object.keys(bundle).some(path => /interceptor|sample-ca/.test(path)));
  assert.ok(!text.includes('PRIVATE KEY'));
  assert.ok(text.includes(STAGED_LABEL));
  assert.match(bundle['ISSUE.md'], new RegExp(STAGED_LABEL.replace(/[()]/g, '\\$&')));
  assert.equal(JSON.parse(bundle['identity.json']).stagedCondition, STAGED_LABEL);
  assert.match(bundle['logs/tls-interception.log'], /intercepted registry\.npmjs\.org/);
});

// The server's start boundary (serve.mjs): its installs and samples run with the environment it started with; activation then sets
// the condition on that environment only, so a process started before activation is not rerouted and one started after is.
test('start boundary: activation changes only the environment it is given, and only processes started after it are rerouted', async t => {
  const { root, data, layout } = area(t), registry = await fakeRegistry(t);
  stageTlsInterception(layout);
  const outside = () => listing(root).filter(path => !path.startsWith(relative(root, data)));
  const outsideBefore = outside(), processEnvBefore = { ...process.env };
  // A controlled input: an inherited proxy or trust setting in this shell is not what the test is about.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(NODE_EXTRA_CA_CERTS|NODE_USE_SYSTEM_CA|NODE_OPTIONS|HTTPS?_PROXY|NO_PROXY|NPM_CONFIG_(HTTPS_)?PROXY|NPM_CONFIG_NOPROXY)$/i.test(name)));
  const atInstall = { ...env }, said = [];
  const running = await activateStagedCondition({ layout, seededEnv: { AIH_READINESS_HOME: join(layout.readiness, 'home') }, env, say: line => said.push(line),
    start: options => startInterceptor({ ...options, upstream: { host: '127.0.0.1', port: registry.port }, upstreamCa: registry.caPem }) });
  t.after(() => running.close());
  assert.match(said.join('\n'), new RegExp(`proxy 127\.0\.0\.1:${running.proxyPort}, tls 127\.0\.0\.1:${running.tlsPort}`));
  assert.equal(env.AIH_CANDIDATE_TLS_ROUTE, `registry.npmjs.org=127.0.0.1:${running.tlsPort}`);
  assert.equal(env.npm_config_https_proxy, `http://127.0.0.1:${running.proxyPort}`);
  assert.equal(env.AIH_READINESS_REPAIRS, layout.stagedRepairs);
  assert.ok(existsSync(layout.stagedRepairs) && !relative(layout.root, layout.stagedRepairs).startsWith('..'));
  assert.deepEqual(outside(), outsideBefore, 'nothing is written outside the data directory');
  assert.deepEqual({ ...process.env }, processEnvBefore, "this process's own environment is not changed");
  for (const name of ['AIH_CANDIDATE_TLS_ROUTE', 'npm_config_https_proxy', 'npm_config_proxy', 'HTTPS_PROXY', 'HTTP_PROXY']) assert.equal(atInstall[name], undefined, name);
  assert.deepEqual(JSON.parse((await runNode(PROBE, atInstall)).out), { hook: 'connect' }, 'a process started before activation is not rerouted');
  const after = await runNode(CLIENT, { ...env, CA_FILE: join(layout.stagedTls, 'sample-ca.pem') });
  assert.deepEqual(JSON.parse(after.out), { body: 'upstream-body' }, after.err);
});

test('activation changes nothing when the condition is not staged, or the readiness sample is missing', async t => {
  const { layout } = area(t), env = { KEEP: '1' }, said = [];
  const refuse = () => { throw new Error('the interceptor must not start'); };
  assert.equal(await activateStagedCondition({ layout, seededEnv: { AIH_READINESS_HOME: 'x' }, env, say: line => said.push(line), start: refuse }), null);
  stageTlsInterception(layout);
  assert.equal(await activateStagedCondition({ layout, seededEnv: {}, env, say: line => said.push(line), start: refuse }), null);
  assert.deepEqual(env, { KEEP: '1' });
  assert.equal(existsSync(layout.stagedRepairs), false);
  assert.deepEqual(said, ['staged condition: TLS interception is staged but the readiness sample is missing, so it stays inactive']);
});

test('activation closes the interceptor when the repair offer cannot be written, and changes no environment', async t => {
  const { layout } = area(t), env = { KEEP: '1' };
  stageTlsInterception(layout);
  mkdirSync(layout.stagedRepairs, { recursive: true });
  let closed = 0;
  const start = async () => ({ tlsPort: 1, proxyPort: 2, close: async () => { closed++; } });
  await assert.rejects(activateStagedCondition({ layout, seededEnv: { AIH_READINESS_HOME: 'x' }, env, start }));
  assert.equal(closed, 1);
  assert.deepEqual(env, { KEEP: '1' });
});

test('a bundle lists a staged record that is no longer complete under missing inputs, and does not call it active', async t => {
  const { data, layout } = area(t);
  stageTlsInterception(layout);
  rmSync(join(layout.stagedTls, 'interceptor-key.pem'));
  const bundle = readBundle((await writeReport({ dataDir: data, now: new Date('2026-01-03T00:00:00Z') })).bundleDir);
  assert.match(bundle['README.md'], /staged\/tls-interception\/condition\.json: present but incomplete or for a different CA/);
  assert.ok(!Object.keys(bundle).some(path => path.startsWith('staged/')));
  assert.ok(!bundle['ISSUE.md'].includes(STAGED_LABEL));
});

test('forgetSample removes one recorded sample and its paths, and leaves a record in another format or without that sample alone', t => {
  const { layout } = area(t), recordPath = join(layout.samples, '.seeded.json');
  seedReadiness(layout);
  forgetSample(layout, 'readiness', [layout.readiness]);
  assert.equal(existsSync(layout.readiness), false);
  assert.deepEqual(seeded(layout), ['organization']);
  const before = readFileSync(recordPath, 'utf8');
  forgetSample(layout, 'readiness', []);
  assert.equal(readFileSync(recordPath, 'utf8'), before, 'a sample that is not recorded changes nothing');
  const foreign = JSON.stringify({ schema: 'urn:example:other', samples: { readiness: {} } });
  writeFileSync(recordPath, foreign);
  forgetSample(layout, 'readiness', []);
  assert.equal(readFileSync(recordPath, 'utf8'), foreign, 'a record in another format is left alone');
});
