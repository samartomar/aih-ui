// The AI clients the Workbench offers are exactly the ids the packed Core publishes as
// `nativeClientIds` from @aihq/core/harness. This runs against the installed archives: the
// service worker, the package summary the preview serves, and the settings routes that
// validate a chosen client against that summary. The server and page modules under test come
// from the checkout AIH_REPO names (check-workbench sets it), as in readiness-browser.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { nativeClientIds, targets as harnessTargets } from '@aihq/core/harness';

const repo = resolve(process.env.AIH_REPO ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const load = path => import(pathToFileURL(join(repo, path)).href);
const { callService } = await load('tools/server/service-client.mjs');
const { coreTargetsSummary } = await load('tools/server/core-targets-summary.mjs');
const { createApi } = await load('tools/server/api.mjs');
const { createStaticServer, listen } = await load('tools/server/static.mjs');
const { emptySettings } = await load('src/app/setup-model.js');
const { publishedClients } = await load('src/app/core-targets.js');

const consumerDir = process.cwd();
const vibe = clients => ({ ...emptySettings(), experience: 'vibe', clients });
const labelsFor = ids => Object.fromEntries(harnessTargets.filter(target => ids.includes(target.id)).map(target => [target.id, target.label]));

test('the coreTargets service operation returns nativeClientIds in Core order, labelled from Harness targets', () => {
  const answer = callService(consumerDir, { op: 'coreTargets' });
  assert.equal(answer.ok, true, JSON.stringify(answer));
  assert.deepEqual(answer.targets, [...nativeClientIds]);
  assert.deepEqual(answer.labels, labelsFor(nativeClientIds));
  assert.equal(answer.labels.claude, 'Claude Code');
  assert.ok(Object.keys(answer.labels).every(id => nativeClientIds.includes(id)), 'no label for an id Core does not list');
});

async function workbench(t) {
  const directory = mkdtempSync(join(tmpdir(), 'aih-core-targets-'));
  const summary = { packages: [], coreTargets: coreTargetsSummary(callService(consumerDir, { op: 'coreTargets' })) };
  const api = createApi({ consumerDir, runDir: directory, summary, settingsPath: join(directory, 'settings.v1.json') });
  const server = createStaticServer(directory, api);
  const address = await listen(server, 0);
  t.after(() => new Promise(resolveClose => { server.closeAllConnections(); server.close(resolveClose); }));
  return `http://127.0.0.1:${address.port}`;
}

test('GET /api/packages reports coreTargets published with exactly Core\'s nativeClientIds', async t => {
  const base = await workbench(t);
  const { coreTargets } = await fetch(`${base}/api/packages`).then(response => response.json());
  assert.equal(coreTargets.state, 'published');
  assert.equal(coreTargets.source, '@aihq/core/harness nativeClientIds');
  assert.deepEqual(coreTargets.targets, [...nativeClientIds]);
  assert.deepEqual(coreTargets.labels, labelsFor(nativeClientIds));
  // The page reads the same summary: the list it offers is that list, with those labels.
  const offered = publishedClients(coreTargets);
  assert.deepEqual(offered.ids, [...nativeClientIds]);
  assert.deepEqual(offered.labels, labelsFor(nativeClientIds));
});

test('setup accepts a client from the published list and refuses one outside it', async t => {
  const base = await workbench(t);
  const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) });
  const refused = await post('/api/workbench-settings', vibe(['not-a-client']));
  assert.equal(refused.status, 422);
  assert.match((await refused.json()).error, /published list/);
  const accepted = await post('/api/workbench-settings', vibe([nativeClientIds[0]]));
  assert.equal(accepted.status, 200);
  assert.deepEqual((await accepted.json()).settings.clients, [nativeClientIds[0]]);
  const outside = await post('/api/workbench-settings/clients', { clients: [nativeClientIds[0], 'not-a-client'] });
  assert.equal(outside.status, 422);
  const inside = await post('/api/workbench-settings/clients', { clients: nativeClientIds.slice(0, 2) });
  assert.equal(inside.status, 200);
});
