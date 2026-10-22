import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startConsumer } from './server.mjs';
import { homeEnvironment } from './home-environment.mjs';

// Core keeps its records under the account home, so the whole run uses a disposable one.
async function withConsumer(run, { hostDefault = true } = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'project-folder-switch-')));
  const home = homeEnvironment(join(base, 'account-home')), prior = Object.fromEntries(Object.keys(home).map(key => [key, process.env[key]]));
  Object.assign(process.env, home);
  const folderA = join(base, 'a'), folderB = join(base, 'b');
  await mkdir(folderA); await mkdir(folderB);
  let started;
  try {
    started = await startConsumer(hostDefault ? { projectRoot: folderA } : {});
    const headers = { 'x-aih-client': 'project-folder-test' };
    const call = async (operation, body = {}) => {
      const response = await fetch(`${started.origin}/api/authoring-${operation}`, { method: 'POST', headers: { ...headers, origin: started.origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { http: response.status, ...await response.json() };
    };
    const get = async path => (await fetch(`${started.origin}/api/authoring-${path}`, { headers })).json();
    await run({ call, get, folderA, folderB, home: home.HOME });
  } finally {
    if (started) await new Promise(resolve => started.server.close(resolve));
    for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(base, { recursive: true, force: true });
  }
}

test('a preparation made in folder A cannot be applied after switching to B, and nothing is written in either', () => withConsumer(async ({ call, get, folderA, folderB }) => {
  assert.deepEqual(await get('project'), { project: folderA, source: 'host-default' });
  const item = (await get('catalog')).items.find(value => value.id === 'extensions.matt.tdd');
  const fresh = await call('new'), selected = await call('edit', { policyBytes: fresh.value.policyBytes, operation: { type: 'select', root: item.root } });
  assert.equal(selected.status, 'ok', JSON.stringify(selected.diagnostics));
  const policyBytes = selected.value.policyBytes;
  const inA = await call('prepare', { policyBytes });
  assert.equal(inA.status, 'ready', JSON.stringify(inA.diagnostics));
  assert.equal(inA.review.target.project, folderA);

  const switched = await call('project', { path: folderB });
  assert.deepEqual(switched, { http: 200, status: 'ok', project: folderB, source: 'chosen' });
  assert.deepEqual(await get('project'), { project: folderB, source: 'chosen' });

  const applied = await call('apply', { sessionId: inA.sessionId, reviewDigest: inA.review.reviewDigest });
  assert.equal(applied.status, 'rejected');
  assert.equal(applied.diagnostics[0].code, 'FOLDER_CHANGED');
  assert.deepEqual(await readdir(folderA), []);
  assert.deepEqual(await readdir(folderB), []);

  // The new folder is the one the review and the installed list now name.
  const inB = await call('prepare', { policyBytes });
  assert.equal(inB.review.target.project, folderB);
  const managed = await call('managed');
  assert.notEqual(managed.http, 409);
}));

test('the page sees each refusal in words and the folder stays as it was', () => withConsumer(async ({ call, get, folderA, home }) => {
  await mkdir(join(home, '.aih', 'core'), { recursive: true });
  for (const [path, reason] of [['relative/path', /full path/], [join(folderA, 'missing'), /does not exist/], [home, /home folder/], [join(home, '.aih', 'core'), /Core keeps its own records/]]) {
    const result = await call('project', { path });
    assert.equal(result.status, 'refused'); assert.match(result.reason, reason);
  }
  assert.deepEqual(await get('project'), { project: folderA, source: 'host-default' });
}));

test('with no host default the page can choose the first project folder, and Install becomes available', () => withConsumer(async ({ call, get, folderB }) => {
  assert.deepEqual(await get('project'), { project: null, source: 'none' });
  assert.equal((await get('catalog')).executionAvailable, false);
  assert.equal((await call('managed')).http, 409);
  assert.equal((await call('project', { path: folderB })).status, 'ok');
  assert.equal((await get('catalog')).executionAvailable, true);
  const managed = await call('managed');
  assert.equal(managed.http, 200);
}, { hostDefault: false }));
