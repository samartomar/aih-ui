// The preload that reroutes one host's TLS connections: argument forms, what it leaves alone, and that it stays silent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installRoute, parseRoutes } from '../candidate/tls-route.mjs';

const ROUTE = fileURLToPath(new URL('../candidate/tls-route.mjs', import.meta.url));
const routes = parseRoutes('registry.npmjs.org=127.0.0.1:5555');
const probe = () => { const calls = []; const target = { connect: (...args) => { calls.push(args); return 'socket'; } }; installRoute(routes, target); return { target, calls }; };

test('parses host=address:port lists and keeps only loopback targets with valid ports', () => {
  assert.deepEqual([...parseRoutes('A.example=127.0.0.1:1234, b.example=localhost:2').entries()], [['a.example', { host: '127.0.0.1', port: 1234 }], ['b.example', { host: 'localhost', port: 2 }]]);
  assert.equal(parseRoutes('x=10.0.0.1:443').size, 0);
  assert.equal(parseRoutes('x=127.0.0.1:0,y=127.0.0.1:70000,=127.0.0.1:1,z').size, 0);
  assert.equal(parseRoutes(undefined).size, 0);
});
test('reroutes the options form and keeps the server name', () => {
  const { target, calls } = probe(), callback = () => {};
  assert.equal(target.connect({ host: 'registry.npmjs.org', port: 443, rejectUnauthorized: true }, callback), 'socket');
  assert.deepEqual(calls[0], [{ host: '127.0.0.1', port: 5555, servername: 'registry.npmjs.org', rejectUnauthorized: true }, callback]);
  target.connect({ host: 'Registry.npmjs.org', port: '443', servername: 'sni.example' });
  assert.equal(calls[1][0].servername, 'sni.example');
});
test('reroutes the (port, host, options, callback) form', () => {
  const { target, calls } = probe(), callback = () => {};
  target.connect(443, 'registry.npmjs.org', { ca: 'x' }, callback);
  assert.deepEqual(calls[0], [{ ca: 'x', host: '127.0.0.1', port: 5555, servername: 'registry.npmjs.org' }, callback]);
  target.connect(443, 'registry.npmjs.org', callback);
  assert.equal(calls[1][0].host, '127.0.0.1');
  assert.equal(calls[1][1], callback);
});
test('leaves other hosts, other ports, caller sockets and paths alone', () => {
  const { target, calls } = probe(), socket = {};
  const untouched = [[{ host: 'example.org', port: 443 }], [{ host: 'registry.npmjs.org', port: 8443 }], [{ host: 'registry.npmjs.org', port: 443, socket }],
    [{ path: '/tmp/x' }], [443, 'example.org'], [8443, 'registry.npmjs.org'], [443], [{ port: 443 }]];
  for (const args of untouched) target.connect(...args);
  assert.deepEqual(calls, untouched);
  assert.equal(calls[2][0].socket, socket);
});
test('an empty route list installs nothing', () => {
  const target = { connect() {} }, original = target.connect;
  installRoute(new Map(), target);
  assert.equal(target.connect, original);
});

const run = (env, code) => spawnSync(process.execPath, ['--import', pathToFileURL(ROUTE).href, '-e', code], { env: { ...process.env, AIH_CANDIDATE_TLS_ROUTE: '', ...env }, encoding: 'utf8', windowsHide: true });
test('as a preload it wraps tls.connect, also for named ESM imports, only when the variable is set, and writes nothing', () => {
  const code = "import('node:tls').then(m => process.stdout.write(JSON.stringify([m.connect.name, require('node:tls').connect.name])))";
  const on = run({ AIH_CANDIDATE_TLS_ROUTE: 'registry.npmjs.org=127.0.0.1:5555' }, code);
  assert.equal(on.status, 0, on.stderr);
  assert.equal(on.stdout, '["aihCandidateTlsConnect","aihCandidateTlsConnect"]');
  assert.equal(on.stderr, '');
  const off = run({}, code);
  assert.equal(off.stdout, '["connect","connect"]');
  assert.equal(off.stderr, '');
  const silent = run({ AIH_CANDIDATE_TLS_ROUTE: 'registry.npmjs.org=127.0.0.1:5555' }, '0');
  assert.equal(silent.stdout + silent.stderr, '');
});
