import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE_ORDER_TEXT } from './release-order.mjs';
import { createCatalogUpdateSource, validateCatalogRoots, UPDATE_SOURCE_RELEASE_EXPORTS } from './update-source.mjs';
import { orderRelation, MAX_ORDERED_SOURCES } from './release-order.mjs';
import { intakeDeclaration, digestBytes } from './intake.mjs';
import { noteFixture } from './note-fixture.mjs';
import { startConsumer } from './server.mjs';
const encode = value => new TextEncoder().encode(value), decode = bytes => new TextDecoder().decode(bytes);
async function revision(variant, tweak) {
  const snapshot = await noteFixture(variant);
  if (tweak) snapshot.declarationBytes = encode(JSON.stringify(tweak(JSON.parse(decode(snapshot.declarationBytes)))));
  const input = { id: 'notes', kind: 'local', locator: { input: 'notes' }, resolvedIdentity: { sha256: await digestBytes(snapshot.declarationBytes) } };
  const result = await intakeDeclaration({ input, ...snapshot, materialSource: { kind: 'local', input: 'notes' } });
  assert.equal(result.status, 'ok', JSON.stringify(result.diagnostics));
  return result.value;
}
const SOURCE = { kind: 'local', input: 'maintained' };
const EXPORTS = ['./main.json', './family.json'];
// A fake reader: `layout[root][export]` is a release (valid), a function to throw or answer, or absent (invalid).
const reader = (layout, calls = []) => async options => {
  calls.push(options);
  const entry = layout[options.root]?.[options.release];
  if (typeof entry === 'function') return entry();
  return entry ? { valid: true, release: entry.release, source: SOURCE } : { valid: false, diagnostics: [] };
};
const ROOTS = ['/catalog/one', '/catalog/two', '/catalog/three'].map(root => resolve(root));
const clock = (...times) => () => times.shift();

test('reads each root in order through the release reader only, and orders by position', async () => {
  const [oldMain, newMain] = [await revision('current'), await revision('updated')];
  const family = await revision('additional', declaration => ({ ...declaration, package: { name: oldMain.release.package.name, version: '1.0.0' } }));
  const calls = [];
  const source = createCatalogUpdateSource({ roots: ROOTS.slice(0, 2), installedPackage: oldMain.release.package, releaseExports: EXPORTS, now: () => '2026-10-16T10:00:00.000Z',
    readRelease: reader({ [ROOTS[0]]: { './main.json': oldMain, './family.json': family }, [ROOTS[1]]: { './main.json': newMain, './family.json': family } }, calls) });
  const result = await source.read();
  assert.deepEqual(calls.map(call => [call.root, call.release, call.sourceInput]), ROOTS.slice(0, 2).flatMap(root => EXPORTS.map(release => [root, release, 'maintained'])));
  assert.equal(result.kind, 'catalog-roots');
  // The shared family release appears once, at its first position; inventories carry no input member.
  assert.deepEqual(result.inventories.map(entry => entry.release.sha256), [oldMain, family, newMain].map(entry => entry.release.sha256));
  for (const entry of result.inventories) { assert.deepEqual(Object.keys(entry).sort(), ['materialSource', 'release']); assert.deepEqual(entry.materialSource, SOURCE); }
  assert.deepEqual(result.sources, [
    { position: 1, state: 'read', package: { name: oldMain.release.package.name, version: '1.0.0' }, releaseSha256: oldMain.release.sha256, readAt: '2026-10-16T10:00:00.000Z' },
    { position: 2, state: 'read', package: { name: newMain.release.package.name, version: '1.0.1' }, releaseSha256: newMain.release.sha256, readAt: '2026-10-16T10:00:00.000Z' }]);
  for (const root of ROOTS.slice(0, 2)) assert.equal(JSON.stringify(result.sources).includes(JSON.stringify(root).slice(1, -1)), false);
  assert.equal(orderRelation(result.releaseOrder, newMain.release.sha256, oldMain.release.sha256).relation, 'newer');
  assert.equal(orderRelation(result.releaseOrder, oldMain.release.sha256, newMain.release.sha256).relation, 'older');
  // A release listed at both positions is neither older nor newer than another that sits between its first and last.
  assert.deepEqual(result.releaseOrder.ranks[family.release.sha256], [1, 2]);
  assert.deepEqual(orderRelation(result.releaseOrder, family.release.sha256, newMain.release.sha256), { relation: 'unknown', basis: 'host-declared', reason: 'ambiguous' });
});

test('an offline root keeps its position and the last time it was read, and says why', async () => {
  const [main, other] = [await revision('current'), await revision('updated')];
  const foreign = await revision('additional');
  const layout = { [ROOTS[0]]: { './main.json': main }, [ROOTS[1]]: { './main.json': other }, [ROOTS[2]]: { './main.json': main } };
  const failures = [];
  const source = createCatalogUpdateSource({ roots: ROOTS, installedPackage: main.release.package, releaseExports: ['./main.json'], now: clock('T1', 'T2', 'T3'),
    readRelease: async options => { const failure = failures.find(([root]) => root === options.root); return failure ? failure[1]() : reader(layout)(options); } });
  const first = await source.read();
  assert.deepEqual(first.sources.map(row => [row.position, row.state, row.readAt, row.lastReadAt]), [[1, 'read', 'T1', undefined], [2, 'read', 'T1', undefined], [3, 'read', 'T1', undefined]]);
  failures.push([ROOTS[0], () => { throw new Error('gone'); }], [ROOTS[1], () => ({ valid: false, diagnostics: [] })], [ROOTS[2], () => ({ valid: true, release: foreign.release, source: SOURCE })]);
  const second = await source.read();
  assert.deepEqual(second.sources, [{ position: 1, state: 'offline', reason: 'unreadable', export: './main.json', lastReadAt: 'T1' }, { position: 2, state: 'offline', reason: 'invalid', export: './main.json', lastReadAt: 'T1' },
    { position: 3, state: 'offline', reason: 'package-mismatch', export: './main.json', lastReadAt: 'T1' }]);
  assert.equal(second.inventories, null);
  assert.deepEqual(second.releaseOrder.ranks, {});
  // One root back keeps the others offline at their own positions, so the order is still by position.
  failures.splice(1, 1);
  const third = await source.read();
  assert.deepEqual(third.sources.map(row => [row.position, row.state, row.reason, row.lastReadAt, row.readAt]), [[1, 'offline', 'unreadable', 'T1', undefined], [2, 'read', undefined, undefined, 'T3'], [3, 'offline', 'package-mismatch', 'T1', undefined]]);
  assert.deepEqual(third.inventories.map(entry => entry.release.sha256), [other.release.sha256]);
  assert.deepEqual(third.releaseOrder.ranks[other.release.sha256], [2, 2]);
});

test('a root that was never read has no last read time', async () => {
  const main = await revision('current');
  const source = createCatalogUpdateSource({ roots: ROOTS.slice(0, 1), installedPackage: main.release.package, releaseExports: ['./main.json'], now: () => 'T1', readRelease: reader({}) });
  assert.deepEqual((await source.read()).sources, [{ position: 1, state: 'offline', reason: 'invalid', export: './main.json' }]);
});

test('a root with any invalid export is offline as a whole', async () => {
  const main = await revision('current');
  const source = createCatalogUpdateSource({ roots: ROOTS.slice(0, 1), installedPackage: main.release.package, releaseExports: EXPORTS, now: () => 'T1', readRelease: reader({ [ROOTS[0]]: { './main.json': main } }) });
  const result = await source.read();
  assert.equal(result.inventories, null); assert.equal(result.sources[0].reason, 'invalid');
  // The failing export is named, so a root missing one of the five exports can be fixed.
  assert.equal(result.sources[0].export, './family.json');
});

test('configuration is validated: at most 8 absolute, non-empty roots', () => {
  const installedPackage = { name: 'x' };
  const refuse = (roots, pattern) => assert.throws(() => createCatalogUpdateSource({ roots, installedPackage }), pattern);
  refuse(Array.from({ length: MAX_ORDERED_SOURCES + 1 }, (_, i) => resolve(`/c/${i}`)), /at most 8/);
  refuse(['relative/root'], /entry 1 is not an absolute path/);
  refuse([ROOTS[0], ''], /entry 2 is empty/);
  refuse([], /one or more/);
  refuse('/catalog/one', /list of one or more/);
  assert.deepEqual(validateCatalogRoots(ROOTS), ROOTS);
  assert.equal(validateCatalogRoots(Array.from({ length: 8 }, (_, i) => resolve(`/c/${i}`))).length, 8);
  assert.throws(() => createCatalogUpdateSource({ roots: ROOTS }), /installed Catalog package/);
});

test('the real installed Catalog root reads its five releases; a missing root is offline', async () => {
  const root = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
  const missing = join(await mkdtemp(join(tmpdir(), 'aih-update-source-')), 'no-such-catalog');
  try {
    const installed = (await import('@aihq/catalog/node')).readInstalledRelease;
    const main = await installed({ root, release: './release.json', sourceInput: 'maintained' });
    const source = createCatalogUpdateSource({ roots: [root, missing], installedPackage: main.release.package });
    const first = await source.read(), second = await source.read();
    assert.equal(first.sources.length, 2);
    assert.deepEqual([first.sources[0].state, first.sources[0].package, first.sources[0].releaseSha256], ['read', main.release.package, main.release.sha256]);
    assert.deepEqual([first.sources[1].state, first.sources[1].reason, first.sources[1].export, 'lastReadAt' in first.sources[1]], ['offline', 'invalid', './release.json', false]);
    assert.equal(first.inventories.length, UPDATE_SOURCE_RELEASE_EXPORTS.length);
    assert.equal(first.inventories[0].release.sha256, main.release.sha256);
    assert.deepEqual(first.inventories[0].materialSource, { kind: 'local', input: 'maintained' });
    assert.equal(second.sources[0].readAt >= first.sources[0].readAt, true);
    assert.equal(second.releaseOrder.ranks[main.release.sha256].join(), '1,1');
  } finally { await rm(dirname(missing), { recursive: true, force: true }); }
});

test('a host started with Catalog roots answers a maintenance check with the source description; ambiguous or invalid configuration is refused', async () => {
  const root = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
  const scratch = await mkdtemp(join(tmpdir(), 'aih-update-source-')), missing = join(scratch, 'no-such-catalog');
  const [{ server, origin }] = [await startConsumer({ updateSourceCatalogRoots: [root, missing] })];
  try {
    const post = async (operation, body) => (await fetch(`${origin}/api/authoring-${operation}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
    const policy = await post('new', {});
    assert.equal(policy.status, 'ok', JSON.stringify(policy.diagnostics));
    const checked = await post('maintenance-check', { bytes: policy.value.policyBytes, categories: ['content'] });
    assert.equal(checked.status, 'ok', JSON.stringify(checked.diagnostics));
    const { updateSource } = checked.value;
    assert.deepEqual([updateSource.kind, updateSource.order, updateSource.orderText], ['catalog-roots', 'host-declared', RELEASE_ORDER_TEXT]);
    assert.deepEqual(updateSource.sources.map(row => [row.position, row.state, row.reason, row.export]), [[1, 'read', undefined, undefined], [2, 'offline', 'invalid', './release.json']]);
    assert.equal(JSON.stringify(updateSource).includes(JSON.stringify(scratch).slice(1, -1)), false);
    // One root read and one offline is a partial check: unknown, never a complete one.
    assert.deepEqual(checked.value.categories[0], { category: 'content', selected: true, state: 'unknown', reason: 'sources-partly-unavailable' });
    assert.deepEqual(checked.value.updates, []);
  } finally { server.close(); await rm(scratch, { recursive: true, force: true }); }
  await assert.rejects(startConsumer({ updateSourceCatalogRoots: [root], maintenanceSource: async () => [] }), /not both/);
  await assert.rejects(startConsumer({ updateSourceCatalogRoots: ['relative'] }), /absolute/);
  await assert.rejects(startConsumer({ updateSourceCatalogRoots: Array.from({ length: 9 }, () => root) }), /at most 8/);
});
