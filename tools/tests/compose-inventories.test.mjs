import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeFamilyInventories } from '../consumer/compose-inventories.mjs';

const entry = (fw, version, sha, tag = `installed-${fw}`) => ({ tag, release: { sha256: sha, framework: { id: fw, version } } });
const shas = list => list.map(e => e.release.sha256);
const tags = list => list.map(e => e.tag);

test('a distinct-sha fixture replaces the installed default for the same framework+version exactly once', () => {
  const installed = [entry('superpowers', '1.0.0', 'sha-installed'), entry('extensions', '1.0.0', 'sha-ext')];
  const fixtures = [entry('superpowers', '1.0.0', 'sha-golden', 'fixture')];
  const out = composeFamilyInventories({ installed, catalog: [...fixtures], fixtures });
  assert.deepEqual(tags(out), ['installed-extensions', 'fixture'], 'the installed twin is replaced, the fixture wins, others stay');
});

test('a same-sha explicit fixture stays exactly once - the replacement must not drop the release twice', () => {
  const installed = [entry('superpowers', '1.0.0', 'sha-same'), entry('ecc', '1.0.0', 'sha-ecc')];
  const fixtures = [entry('superpowers', '1.0.0', 'sha-same', 'fixture-same-sha')];
  const out = composeFamilyInventories({ installed, catalog: [...fixtures], fixtures });
  assert.deepEqual(shas(out), ['sha-ecc', 'sha-same'], 'order: kept installed first, then the fixture side');
  assert.equal(out.filter(e => e.release.sha256 === 'sha-same').length, 1, 'exactly one copy of the shared release');
});

test('unrelated installed families and the version999 alternate both remain', () => {
  const installed = [entry('superpowers', '1.0.0', 'sha-installed'), entry('ecc', '1.0.0', 'sha-ecc')];
  const fixtures = [entry('superpowers', '999.0.0', 'sha-999', 'alternate'), entry('project-basics', '1.0.0', 'sha-basics', 'basics')];
  const out = composeFamilyInventories({ installed, catalog: [...fixtures], fixtures });
  assert.deepEqual(shas(out).sort(), ['sha-999', 'sha-basics', 'sha-ecc', 'sha-installed'].sort());
});

test('a catalog entry duplicating a KEPT installed sha is deduplicated to one', () => {
  const installed = [entry('ecc', '1.0.0', 'sha-ecc')];
  const catalog = [entry('ecc', '1.0.0', 'sha-ecc', 'catalog-dup'), entry('extensions', '1.0.0', 'sha-ext', 'ext')];
  const out = composeFamilyInventories({ installed, catalog, fixtures: [] });
  assert.equal(out.filter(e => e.release.sha256 === 'sha-ecc').length, 1);
  assert.deepEqual(tags(out), ['installed-ecc', 'ext']);
});

test('a deduplicated internal-content twin hands its archive identity to the kept installed entry', () => {
  const internalContent = { archiveSha256: 'archive-sha' };
  const installed = [entry('ecc', '1.0.0', 'sha-ecc'), entry('extensions', '1.0.0', 'sha-ext')];
  const catalog = [{ ...entry('ecc', '1.0.0', 'sha-ecc', 'catalog-dup'), internalContent }];
  const out = composeFamilyInventories({ installed, catalog, fixtures: [] });
  assert.deepEqual(tags(out), ['installed-ecc', 'installed-extensions']);
  assert.deepEqual(out[0].internalContent, internalContent);
  assert.equal(out[1].internalContent, undefined, 'a release without a configured twin gains no identity');
});

test('two non-fixture releases sharing a framework+version are BOTH kept - genuine ambiguity is never hidden', () => {
  const installed = [entry('ecc', '1.0.0', 'sha-ecc-a')];
  const catalog = [entry('ecc', '1.0.0', 'sha-ecc-b', 'second')];
  const out = composeFamilyInventories({ installed, catalog, fixtures: [] });
  assert.deepEqual(shas(out).sort(), ['sha-ecc-a', 'sha-ecc-b']);
});

test('no fixtures and no duplicates leaves everything untouched', () => {
  const installed = [entry('a', '1', 's1'), entry('b', '2', 's2')];
  const out = composeFamilyInventories({ installed, catalog: [], fixtures: [] });
  assert.deepEqual(shas(out), ['s1', 's2']);
});
