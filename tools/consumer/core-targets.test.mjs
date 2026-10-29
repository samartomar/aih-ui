// The AI clients the Workbench offers are exactly the ids the packed Core publishes as
// `nativeClientIds` from @aihq/core/harness. This runs against the installed archives: the
// service worker, the package summary the preview serves, and the settings routes that
// validate a chosen client against that summary. The server and page modules under test come
// from the checkout AIH_REPO names (check-workbench sets it), as in readiness-browser.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
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
const { exportTarget } = await import(pathToFileURL(join(consumerDir, 'service', 'contract-check.mjs')).href);
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

// The start-up contract check: Core's own engine over the installed declarations, or "absent" for a Core without one.
test('the contractCheck service operation runs the installed Core checkContracts, or reports that Core has none', async () => {
  const { contractCheckSummary } = await load('tools/server/contract-check-summary.mjs');
  const contracts = await import('@aihq/core/contracts');
  const summary = contractCheckSummary(callService(consumerDir, { op: 'contractCheck' }));
  if (typeof contracts.checkContracts !== 'function') { assert.deepEqual(summary, { state: 'absent' }); return; }
  assert.equal(summary.state, 'ran', JSON.stringify(summary).slice(0, 500));
  assert.deepEqual(summary.packages.find(item => item.name === 'aih-ui'), { name: 'aih-ui', status: 'found', version: '0.0.0', schema: 'urn:aihq:package-support:1.1.0', from: 'aih-ui/package-support-1.1.json' });
  // Core reads what the Workbench writes for it, from the Workbench's own exported fixtures.
  const ofWorkbench = summary.checks.filter(row => row.fixturePackage === 'aih-ui');
  assert.ok(ofWorkbench.some(row => row.contractId === 'urn:aihq:core:execution-policy:1.3.0' && row.readerPackage === '@aihq/core'), JSON.stringify(ofWorkbench));
  // Core reads each format the Workbench writes for it; a format the Workbench only reads leaves Core nothing to read.
  const produced = new Set(JSON.parse(readFileSync(join(repo, 'package-support-1.1.json'), 'utf8')).contracts.filter(item => item.role === 'produces').map(item => item.id));
  for (const row of ofWorkbench.filter(item => item.readerPackage === '@aihq/core')) {
    if (produced.has(row.contractId)) assert.equal(row.status, 'passed', JSON.stringify(row));
    else assert.deepEqual([row.status, row.reason], ['unavailable', 'fixtures-missing'], JSON.stringify(row));
  }
  // The Workbench reads Core results through its own public readers (aih-ui/stored-results, Core's validators). With a Core that
  // publishes no file-state validator there is no file-state reader, so those checks cannot run and never pass. Every other
  // Core format the Workbench declares it accepts has no public reader to run, so its checks stay unavailable, never passed.
  const fileStateReader = typeof contracts.validateFileStateResult === 'function';
  const readable = new Set(['urn:aihq:core:native-verification-result:1.0.0', ...(fileStateReader ? ['urn:aihq:core:file-state-result:1.1.0'] : [])]);
  const accepted = new Set(JSON.parse(readFileSync(join(repo, 'package-support-1.1.json'), 'utf8')).contracts.filter(item => item.role === 'accepts').map(item => item.id));
  for (const row of summary.checks.filter(item => item.readerPackage === 'aih-ui')) {
    assert.ok(accepted.has(row.contractId), JSON.stringify(row));
    if (readable.has(row.contractId)) assert.equal(row.status, 'passed', JSON.stringify(row));
    else assert.deepEqual([row.status, row.reason], ['unavailable', 'reader-missing'], JSON.stringify(row));
  }
  // With Core's file-state validator, both file-state fixtures Core publishes are read by the Workbench's own reader.
  // Every fixture Core publishes for a result the Workbench reads is checked against the Workbench's reader, accept and refuse alike.
  for (const id of ['urn:aihq:core:native-verification-result:1.0.0', ...(fileStateReader ? ['urn:aihq:core:file-state-result:1.1.0'] : [])]) {
    const published = (contracts.contractSupport.contracts.find(item => item.id === id)?.fixtures ?? []).map(item => item.export).sort();
    assert.deepEqual(summary.checks.filter(row => row.readerPackage === 'aih-ui' && row.contractId === id).map(row => row.fixtureExport).sort(), published, id);
  }
  assert.ok(summary.checks.some(row => row.readerPackage === 'aih-ui' && row.contractId === 'urn:aihq:core:native-verification-result:1.0.0'), 'Core publishes a native-verification fixture the Workbench reads');
  for (const row of summary.checks.filter(item => item.status === 'passed')) assert.ok(['@aihq/core', 'aih-ui'].includes(row.readerPackage), 'only a reader the Workbench can run passes');
});

// The Workbench's package-support declaration (package-support-1.1.json), checked where the packages are installed: valid by
// Core's own validator when this Core has one; every schema and fixture it names resolves through the export map that
// declares it; every schema this package exports is one of its formats; and each fixture of its own formats is read by
// the Workbench's own reader exactly as declared.
const workbenchManifest = () => JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
const workbenchSupport = () => JSON.parse(readFileSync(join(repo, 'package-support-1.1.json'), 'utf8'));

test('the Workbench pins Core dev.46 and declares the execution policy 1.6 it produces', () => {
  assert.equal(workbenchManifest().peerDependencies['@aihq/core'], '1.0.0-dev.46');
  assert.ok(workbenchSupport().contracts.some(record => record.id === 'urn:aihq:core:execution-policy:1.6.0' && record.role === 'produces'));
});

const own = (manifest, specifier) => {
  const target = exportTarget(manifest, `.${specifier.slice(manifest.name.length)}`);
  return target ? JSON.parse(readFileSync(join(repo, target), 'utf8')) : null;
};

test('the Workbench package-support declaration is valid for the installed Core and resolves through its export map', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(join(consumerDir, 'package.json'));
  const manifest = workbenchManifest(), declared = workbenchSupport();
  assert.equal(manifest.exports['./package-support-1.1.json'], './package-support-1.1.json');
  assert.deepEqual(declared.package, { name: manifest.name, version: manifest.version });
  const contracts = await import('@aihq/core/contracts');
  if (typeof contracts.validatePackageSupport === 'function') {
    const checked = contracts.validatePackageSupport(declared);
    assert.equal(checked.valid, true, JSON.stringify(checked.diagnostics));
  } else assert.equal(declared.schema, 'urn:aihq:package-support:1.1.0');
  for (const record of declared.contracts) {
    assert.deepEqual(record.versions, [record.id.split(':').at(-1)], record.id);
    if (record.schemaExport.startsWith('@aihq/')) {
      let path;
      try { path = require.resolve(record.schemaExport); } catch { path = fileURLToPath(import.meta.resolve(record.schemaExport)); }
      assert.equal(JSON.parse(readFileSync(path, 'utf8')).$id, record.id, record.schemaExport);
    } else assert.equal(own(manifest, record.schemaExport)?.$id, record.id, record.schemaExport);
    for (const fixture of record.fixtures) {
      const value = own(manifest, fixture.export);
      assert.ok(value, `${fixture.export} resolves through the export map`);
      if (fixture.expect === 'accept') assert.equal(value.schema, record.id, fixture.export);
      assert.doesNotMatch(JSON.stringify(value), /\/(tmp|home|Users)\/|[A-Z]:\\\\/, `${fixture.export} carries no machine path`);
    }
    // A produced format carries the Workbench's own written example; a format it only reads needs none.
    if (record.role === 'produces') assert.ok(record.fixtures.length > 0, record.id);
  }
  const schemaExports = Object.keys(manifest.exports).filter(key => key.startsWith('./schemas/'));
  assert.deepEqual(declared.contracts.filter(record => record.schemaExport.startsWith('aih-ui/')).map(record => record.schemaExport).sort(),
    schemaExports.map(key => `aih-ui${key.slice(1)}`).sort(), 'each exported schema is declared once');
  const entries = Object.keys(manifest.exports).filter(key => !key.startsWith('./schemas/') && !key.startsWith('./fixtures/') && !key.endsWith('.json'));
  assert.deepEqual(declared.entries.map(entry => entry.export).sort(), entries.map(key => `aih-ui${key.slice(1)}`).sort());
  // Runtime expansion is limited to the stored-result readers used by the contract check.
  assert.deepEqual(declared.entries.filter(entry => entry.runtime === 'node').map(entry => [entry.export, entry.nodeRange]), [
    ['aih-ui/authoring', '>=24.15.0 <25'],
    ['aih-ui/intake', '>=24.15.0 <25'],
    ['aih-ui/maintenance', '>=24.15.0 <25'],
    ['aih-ui/improvements', '>=24.15.0 <25'],
    ['aih-ui/stored-results', '>=24.15.0 <25 || >=26.12.1 <27'],
    ['aih-ui/trials', '>=24.15.0 <25'],
    ['aih-ui/organization-author', '>=24.15.0 <25'],
    ['aih-ui/scan-evidence', '>=24.15.0 <25'],
  ]);
  assert.deepEqual(declared.entries.filter(entry => entry.runtime === 'portable'), [
    { export: 'aih-ui/journey', runtime: 'portable' },
    { export: 'aih-ui/workspace', runtime: 'portable' },
    { export: 'aih-ui/batch', runtime: 'portable' },
  ]);
});

// The Workbench's own reader for each of its formats. A record is read where the Workbench reads it: written into a
// journey envelope (with the suggestion a dismissal or trial names, and an unresolved draft referring to that envelope's
// saved intent) and read back; a saved intent and its reviews through an unresolved draft; a workspace declaration and a
// local binding through the workspace validators; an earlier saved or setup intent through the migration that reopens it,
// against the Catalog release installed here.
async function readOwn(id, value) {
  const { readJourneyEnvelope, writeJourneyEnvelope } = await import('./journey.mjs');
  const { validateDeclaration, validateBinding } = await import('./workspace.mjs');
  const { migrateIntent } = await import('./migrate-intent.mjs');
  const encode = text => new TextEncoder().encode(text);
  if (id === 'urn:aihq:workbench:journey-envelope:1.0.0') return readJourneyEnvelope(encode(JSON.stringify(value)));
  const validator = { 'urn:aihq:workbench:journey-record:workspace-declaration:1.0.0': validateDeclaration, 'urn:aihq:workbench:journey-record:local-binding:1.0.0': validateBinding }[id];
  if (validator) { const checked = await validator(value); return checked.valid ? { status: 'ok' } : { status: 'refused', diagnostics: [] }; }
  if (id === 'urn:aihq:workbench:saved-intent:2.0.0' || id === 'urn:aihq:workbench:setup-intent:1.0.0') {
    const { readInstalledRelease } = await import('@aihq/catalog/node');
    const { dirname } = await import('node:path');
    const installed = await readInstalledRelease({ root: dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'))), sourceInput: 'catalog' });
    return migrateIntent(value, [{ release: installed.release }]);
  }
  const savedIntentBytes = encode(JSON.stringify({ schema: 'urn:aihq:core:execution-policy:1.3.0', mode: 'personal', selections: [] }));
  const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', savedIntentBytes)).toString('hex');
  const fixture = path => JSON.parse(readFileSync(join(repo, 'fixtures/contracts', path), 'utf8'));
  const draft = intent => ({ id: 'draft', schema: 'urn:aihq:workbench:journey-record:unresolved-draft:1.0.0', required: true, savedIntentSha256: sha256, intent });
  const records = id.endsWith(':saved-intent:3.0.0') ? [draft(value)]
    : id.endsWith(':review-decisions:1.0.0') ? [draft({ ...fixture('saved-intent/3.0.0/accept.json'), reviews: value })]
    : id.endsWith(':unresolved-draft:1.0.0') ? [{ ...value, savedIntentSha256: sha256 }]
    : /improvement-(dismissal|trial)/.test(id) ? [fixture('journey-record-improvement-suggestion/1.0.0/accept.json'), value] : [value];
  const written = await writeJourneyEnvelope({ savedIntentBytes, records });
  return written.status === 'ok' ? readJourneyEnvelope(written.value.envelopeBytes) : written;
}

test('each fixture of the Workbench\'s own formats is read by its own reader exactly as declared', async () => {
  const manifest = workbenchManifest();
  const { readInstalledRelease } = await import('@aihq/catalog/node');
  const { dirname } = await import('node:path');
  const installedSha = (await readInstalledRelease({ root: dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'))), sourceInput: 'catalog' })).release.sha256;
  for (const record of workbenchSupport().contracts.filter(item => item.schemaExport.startsWith('aih-ui/'))) {
    assert.ok(record.fixtures.some(item => item.expect === 'accept') && record.fixtures.some(item => item.expect === 'refuse'), record.id);
    for (const fixture of record.fixtures) {
      const value = own(manifest, fixture.export);
      const result = await readOwn(record.id, value);
      // A setup intent names the exact Catalog release it was made from; under another installed release it cannot be read.
      const otherRelease = record.id.endsWith(':setup-intent:1.0.0') && fixture.expect === 'accept' && value.source.releaseSha256 !== installedSha;
      if (otherRelease) { assert.equal(result.diagnostics?.[0]?.code, 'SOURCE_REVISION_UNAVAILABLE', fixture.export); continue; }
      const accepted = result.status === 'ok' && result.value?.supported !== false;
      assert.equal(accepted, fixture.expect === 'accept', `${fixture.export}: ${JSON.stringify(result.diagnostics?.[0] ?? '')}`);
      if (fixture.code) assert.equal(result.diagnostics?.[0]?.code, fixture.code, fixture.export);
    }
  }
});
