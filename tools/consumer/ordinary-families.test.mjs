import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startConsumer } from './server.mjs';
import { readAuthoring } from './headless.mjs';
import { installedFamilies } from './installed-families.mjs';
import { isolatedConsumer } from './isolated-consumer.mjs';
import { homeEnvironment } from './home-environment.mjs';

test('a configured previous full package resolves exact historical family pins without adding them to current browsing', async () => {
  const { mkdtemp, mkdir, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { dirname } = await import('node:path');
  const { noteFixture } = await import('./note-fixture.mjs');
  const { compileProducerDeclaration } = await import('@aihq/catalog/producer');
  const { composeAuthoring, freshAuthoring } = await import('./headless.mjs');
  const { readInstalledRelease } = await import('@aihq/catalog/node');
  const folder = await mkdtemp(join(tmpdir(), 'historical-catalog-'));
  const isolatedHome = homeEnvironment(join(folder, 'account-home'));
  const priorEnvironment = Object.fromEntries(Object.keys(isolatedHome).map(key => [key, process.env[key]]));
  Object.assign(process.env, isolatedHome);
  let started;
  try {
    const snapshot = await noteFixture('updated'), declaration = JSON.parse(new TextDecoder().decode(snapshot.declarationBytes));
    declaration.package = { name: '@aihq/catalog', version: '0.1.0' };
    for (const item of declaration.items) item.requires = [];
    snapshot.declarationBytes = new TextEncoder().encode(JSON.stringify(declaration));
    const historical = compileProducerDeclaration({ declaration, sourceFiles: snapshot.sourceFiles });
    assert.equal(historical.status, 'ok', JSON.stringify(historical.diagnostics));
    const exports = Object.fromEntries(['./release.json', './release-extensions.json', './release-ecc.json', './release-superpowers.json', './release-anthropic.json'].map(name => [name, './release.json']));
    await writeFile(join(folder, 'package.json'), JSON.stringify({ name: '@aihq/catalog', version: '0.1.0', exports }));
    await writeFile(join(folder, 'release.json'), historical.value.releaseBytes);
    for (const material of historical.value.materials) { const path = join(folder, material.path); await mkdir(dirname(path), { recursive: true }); await writeFile(path, material.bytes); }
    // Save with the ordinary pre-upgrade logical input, before this package is history.
    const checked = await readInstalledRelease({ root: folder, release: './release-ecc.json', sourceInput: 'maintained' }); assert.equal(checked.valid, true);
    const item = checked.release.items[0], intent = freshAuthoring();
    intent.roots = [{ releaseSha256: checked.release.sha256, itemId: item.id, itemSha256: item.itemSha256, scope: 'project', configuration: {}, originIds: ['direct'] }];
    const saved = await composeAuthoring({ intent, inventories: [{ release: checked.release, materialSource: checked.source, materials: historical.value.materials }] }); assert.equal(saved.status, 'ok', JSON.stringify(saved.diagnostics));
    started = await startConsumer({ previousCatalogRoot: folder, projectRoot: folder });
    const catalog = await (await fetch(started.origin + '/api/authoring-catalog')).json();
    assert.ok(catalog.items.every(value => value.root.releaseSha256 !== checked.release.sha256));
    const read = await (await fetch(started.origin + '/api/authoring-read', { method: 'POST', headers: { origin: started.origin, 'content-type': 'application/json' }, body: JSON.stringify({ policyBytes: [...saved.value.policyBytes] }) })).json();
    assert.equal(read.status, 'ok'); assert.equal(read.value.editing, 'available');
    assert.deepEqual(read.value.intent.pins, saved.value.intent.pins);
    assert.deepEqual(read.value.originalBytes, [...saved.value.policyBytes]);
    const call = async (operation, body) => (await fetch(started.origin + '/api/authoring-' + operation, { method: 'POST', headers: { origin: started.origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
    const refused = await call('prepare', { policyBytes: [...saved.value.policyBytes] });
    assert.equal(refused.status, 'refused');
    assert.equal(refused.diagnostics[0].code, 'HISTORICAL_SOURCE_UPDATE_REQUIRED');
    // Current selections still reach Core's ordinary preparation boundary.
    const fresh = await call('new', {}), current = catalog.items.find(value => value.id === 'extensions.matt.tdd');
    const selected = await call('edit', { policyBytes: fresh.value.policyBytes, operation: { type: 'select', root: current.root } });
    assert.equal(selected.status, 'ok');
    const prepared = await call('prepare', { policyBytes: selected.value.policyBytes });
    assert.ok(!prepared.diagnostics?.some(value => value.code === 'HISTORICAL_SOURCE_UPDATE_REQUIRED'));
    assert.ok(prepared.status);
  } finally {
    if (started) await new Promise(resolve => started.server.close(resolve));
    for (const [key, value] of Object.entries(priorEnvironment)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(folder, { recursive: true, force: true });
  }
});

// Tests may rewrite only a disposable copy; the shared installed Catalog stays byte-identical.
const sharedManifest = fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'));
const digest = async () => createHash('sha256').update(await readFile(sharedManifest)).digest('hex');
const sharedDigest = await digest();
after(async () => assert.equal(await digest(), sharedDigest, 'Shared installed Catalog manifest was modified'));

test('ordinary authoring exposes all four packaged families with empty initial choices', async () => {
  const started = await startConsumer();
  try {
    const catalog = await (await fetch(`${started.origin}/api/authoring-catalog`)).json();
    for (const family of ['Extensions', 'ECC', 'Superpowers', 'Anthropic']) {
      assert.ok(catalog.items.some(item => item.family === family), `Missing required family: ${family}`);
    }
    const result = await (await fetch(`${started.origin}/api/authoring-new`, {
      method: 'POST', headers: { origin: started.origin, 'content-type': 'application/json' }, body: '{}'
    })).json();
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.value.intent.roots, []);
    assert.deepEqual(result.value.intent.pins, []);
  } finally { await new Promise(resolve => started.server.close(resolve)); }
});

test('an ordinary host does not browse the review-note test fixture; a test host enables it explicitly', async () => {
  const ordinary = await startConsumer(), testHost = await startConsumer({ reviewNoteFixture: true });
  try {
    const read = async host => (await fetch(`${host.origin}/api/authoring-catalog`)).json();
    const plain = await read(ordinary), fixture = await read(testHost);
    assert.equal(plain.items.some(item => item.id === 'consumer-proof.review-note'), false);
    assert.equal(plain.items.some(item => item.family === 'Independent'), false);
    assert.deepEqual(plain.templates, []);
    assert.ok(fixture.items.some(item => item.id === 'consumer-proof.review-note' && item.family === 'Independent'));
    assert.equal(fixture.templates.length, 1);
    // Nothing else changes: the default release and every family are browsed on both.
    assert.equal(plain.items.length, fixture.items.length - 1);
  } finally {
    await new Promise(resolve => ordinary.server.close(resolve)); await new Promise(resolve => testHost.server.close(resolve));
  }
});

test('ordinary launch refuses a package that omits a required family export', async () => {
  const copy = await isolatedConsumer();
  try {
    const value = JSON.parse(await readFile(copy.catalogManifest));
    delete value.exports['./release-anthropic.json'];
    await writeFile(copy.catalogManifest, JSON.stringify(value));
    // The copied server must resolve the copied Catalog, never the shared install.
    const probe = join(copy.root, 'consumer', 'resolved-catalog.mjs');
    await writeFile(probe, "export default import.meta.resolve('@aihq/catalog/package.json');\n");
    const resolved = (await import(pathToFileURL(probe).href)).default;
    assert.equal(fileURLToPath(resolved), await realpath(copy.catalogManifest));
    assert.notEqual(await realpath(copy.catalogManifest), await realpath(sharedManifest));
    const { startConsumer: startCopied } = await import(copy.serverUrl);
    assert.notEqual(startCopied, startConsumer);
    await assert.rejects(async () => {
      const started = await startCopied();
      await new Promise(resolve => started.server.close(resolve));
    }, /anthropic/i);
    assert.equal(await digest(), sharedDigest, 'Refusal test modified the shared installed Catalog manifest');
  } finally { await copy.dispose(); }
  await assert.rejects(access(copy.root), { code: 'ENOENT' });
  await access(sharedManifest);
});

test('four-family choices retain exact pins, required dependencies and Matt origin on fresh reopen', async () => {
  const started = await startConsumer();
  const call = async (operation, body = {}) => (await fetch(`${started.origin}/api/authoring-${operation}`, {
    method: 'POST', headers: { origin: started.origin, 'content-type': 'application/json' }, body: JSON.stringify(body)
  })).json();
  try {
    const catalog = await (await fetch(`${started.origin}/api/authoring-catalog`)).json();
    let result = await call('new');
    const expected = [
      ['Extensions', 'extensions.matt.ask-matt'], ['ECC', 'ecc.skill.accessibility'],
      ['Superpowers', 'superpowers.skill.brainstorming'], ['Anthropic', 'anthropic.skill.academy-guide']
    ];
    for (const [family, id] of expected) {
      const item = catalog.items.find(item => item.id === id && item.family === family);
      assert.ok(item, `${family}: missing representative ${id}`);
      result = await call('edit', { policyBytes: result.value.policyBytes, operation: { type: 'select', root: item.root } });
      assert.equal(result.status, 'ok', JSON.stringify(result.diagnostics));
    }
    const saved = result.value;
    const matt = catalog.items.find(item => item.id === 'extensions.matt.ask-matt');
    assert.equal(matt.sources[0].origin.repository, 'https://github.com/mattpocock/skills');
    for (const id of ['extensions.notices', 'ecc.notices', 'superpowers.notices']) {
      assert.ok(saved.intent.pins.some(pin => pin.itemId === id), `Required dependency missing: ${id}`);
      assert.ok(!saved.intent.roots.some(root => root.itemId === id), 'Dependency must remain an implicit selection');
    }
    // A fresh ordinary host and the headless consumer read the downloaded bytes.
    const fresh = await startConsumer();
    try {
      const reopened = await (await fetch(`${fresh.origin}/api/authoring-read`, {
        method: 'POST', headers: { origin: fresh.origin, 'content-type': 'application/json' },
        body: JSON.stringify({ policyBytes: saved.policyBytes })
      })).json();
      assert.equal(reopened.value.editing, 'available', JSON.stringify(reopened));
      assert.deepEqual(reopened.value.intent, saved.intent);
      const headless = await readAuthoring({ policyBytes: Uint8Array.from(saved.policyBytes), inventories: await installedFamilies() });
      assert.equal(headless.value.editing, 'available');
      assert.deepEqual(headless.value.intent, saved.intent);
      const provenance = saved.intent.provenance.find(entry => entry.releaseSha256 === matt.root.releaseSha256);
      assert.deepEqual(provenance.sources.find(source => source.id === 'matt'), matt.sources[0]);
    } finally { await new Promise(resolve => fresh.server.close(resolve)); }
  } finally { await new Promise(resolve => started.server.close(resolve)); }
});
