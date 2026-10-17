// The manifest is the whole definition of a candidate: three pinned tarballs, read and verified before anything is written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { MANIFEST_SCHEMA } from '../candidate/layout.mjs';
import { absoluteManifest, candidateIdentity, readManifest, verifyManifest } from '../candidate/manifest.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const COMMIT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

function area(t) {
  const root = mkdtempSync(join(tmpdir(), 'aih-ui-manifest-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'tarballs'));
  const entry = (name, version = '1.0.0') => {
    const bytes = Buffer.from(`${name} ${version} tarball bytes`);
    writeFileSync(join(root, 'tarballs', `aihq-${name}-${version}.tgz`), bytes);
    return { tarball: `tarballs/aihq-${name}-${version}.tgz`, sha256: sha(bytes), commit: COMMIT };
  };
  const manifest = (change = value => value) => {
    const value = change({ schema: MANIFEST_SCHEMA, candidate: 'owner test', packages: { core: entry('core'), catalog: entry('catalog'), scan: entry('scan') } });
    writeFileSync(join(root, 'manifest.json'), JSON.stringify(value));
    return join(root, 'manifest.json');
  };
  return { root, entry, manifest };
}
const refused = (code, pattern) => error => { assert.equal(error.code, code); if (pattern) assert.match(error.message, pattern); return true; };

test('a good manifest reads, verifies and has a stable identity in core, scan, catalog order', async t => {
  const { manifest } = area(t);
  const read = readManifest(manifest());
  await verifyManifest(read);
  assert.deepEqual(candidateIdentity(read), { candidate: 'owner test', packages: [
    { name: '@aihq/core', sha256: read.packages.core.sha256, commit: COMMIT, tarball: 'aihq-core-1.0.0.tgz' },
    { name: '@aihq/scan', sha256: read.packages.scan.sha256, commit: COMMIT, tarball: 'aihq-scan-1.0.0.tgz' },
    { name: '@aihq/catalog', sha256: read.packages.catalog.sha256, commit: COMMIT, tarball: 'aihq-catalog-1.0.0.tgz' }] });
  assert.equal(read.packages.previousCatalog, undefined);
});

test('relative tarball paths resolve against the manifest file, not the working directory', t => {
  const { root, manifest } = area(t);
  const read = readManifest(manifest());
  for (const name of ['core', 'catalog', 'scan']) {
    assert.ok(isAbsolute(read.packages[name].tarball));
    assert.ok(read.packages[name].tarball.startsWith(root));
  }
  const kept = absoluteManifest(read);
  assert.equal(kept.packages.core.tarball, read.packages.core.tarball);
  assert.equal(kept.schema, MANIFEST_SCHEMA);
});

test('a previous Catalog is optional, read the same way, and does not depend on its version', async t => {
  const { entry, manifest } = area(t);
  const read = readManifest(manifest(value => ({ ...value, previousCatalog: entry('catalog', '0.0.1') })));
  await verifyManifest(read);
  assert.match(read.packages.previousCatalog.tarball, /aihq-catalog-0\.0\.1\.tgz$/);
  assert.equal(candidateIdentity(read).packages.length, 3);
  assert.equal(absoluteManifest(read).previousCatalog.tarball, read.packages.previousCatalog.tarball);
});

test('a tarball whose bytes differ is refused with the package and both digests', async t => {
  const { root, manifest } = area(t);
  const read = readManifest(manifest());
  writeFileSync(join(root, 'tarballs', 'aihq-scan-1.0.0.tgz'), 'changed bytes');
  await assert.rejects(verifyManifest(read), refused('CANDIDATE_DIGEST_MISMATCH', new RegExp(`scan.*${sha('changed bytes')}.*${read.packages.scan.sha256}`)));
});

test('a missing tarball is refused as missing, not as a mismatch', async t => {
  const { root, manifest } = area(t);
  const read = readManifest(manifest());
  rmSync(join(root, 'tarballs', 'aihq-core-1.0.0.tgz'));
  await assert.rejects(verifyManifest(read), refused('CANDIDATE_TARBALL_MISSING', /core/));
});

test('a wrong schema, unknown keys, a missing package and malformed digests are refused', t => {
  const { entry, manifest } = area(t);
  const invalid = pattern => refused('CANDIDATE_MANIFEST_INVALID', pattern);
  const withCore = change => manifest(value => ({ ...value, packages: { ...value.packages, core: { ...value.packages.core, ...change } } }));
  assert.throws(() => readManifest(manifest(value => ({ ...value, schema: 'urn:aih-ui:candidate-manifest:2.0.0' }))), invalid(/schema/));
  assert.throws(() => readManifest(manifest(value => ({ ...value, extra: true }))), invalid(/unknown key: extra/));
  assert.throws(() => readManifest(manifest(value => ({ ...value, packages: { ...value.packages, extra: entry('core') } }))), invalid(/packages has unknown key: extra/));
  assert.throws(() => readManifest(withCore({ note: 'x' })), invalid(/core has unknown key: note/));
  assert.throws(() => readManifest(manifest(value => { delete value.packages.scan; return value; })), invalid(/no scan package/));
  assert.throws(() => readManifest(withCore({ sha256: 'ABC' })), invalid(/core\.sha256/));
  assert.throws(() => readManifest(withCore({ sha256: sha('x').toUpperCase() })), invalid(/core\.sha256/));
});

test('a malformed commit is refused', t => {
  const { manifest } = area(t);
  for (const commit of ['abc', 'g'.repeat(40), 'A1B2C3D4E5F6', `${COMMIT}0`, 12345]) {
    const path = manifest(value => ({ ...value, packages: { ...value.packages, core: { ...value.packages.core, commit } } }));
    assert.throws(() => readManifest(path), refused('CANDIDATE_MANIFEST_INVALID', /core\.commit/), String(commit));
  }
});

test('bad JSON and a missing manifest file are refused with the file named', t => {
  const { root } = area(t);
  writeFileSync(join(root, 'bad.json'), '{ not json');
  assert.throws(() => readManifest(join(root, 'bad.json')), refused('CANDIDATE_MANIFEST_INVALID', /bad\.json.*JSON/));
  assert.throws(() => readManifest(join(root, 'absent.json')), refused('CANDIDATE_MANIFEST_INVALID', /absent\.json does not exist/));
});

test('update-source Catalogs are optional and leave the identity shape unchanged when absent', t => {
  const { manifest } = area(t);
  const read = readManifest(manifest());
  assert.equal(read.packages.updateSourceCatalogs, undefined);
  assert.equal('updateSource' in candidateIdentity(read), false);
  assert.equal('updateSourceCatalogs' in absoluteManifest(read), false);
});

test('update-source Catalogs read in the declared order, resolve against the manifest, verify and appear in the identity', async t => {
  const { root, entry, manifest } = area(t);
  const list = [entry('catalog', '0.0.1'), entry('catalog', '0.0.2')];
  const read = readManifest(manifest(value => ({ ...value, updateSourceCatalogs: list })));
  await verifyManifest(read);
  assert.equal(read.packages.updateSourceCatalogs.length, 2);
  for (const item of read.packages.updateSourceCatalogs) { assert.ok(isAbsolute(item.tarball)); assert.ok(item.tarball.startsWith(root)); }
  assert.match(read.packages.updateSourceCatalogs[1].tarball, /aihq-catalog-0\.0\.2\.tgz$/);
  const identity = candidateIdentity(read);
  assert.equal(identity.packages.length, 3);
  assert.deepEqual(identity.updateSource, [
    { position: 1, sha256: list[0].sha256, commit: COMMIT, tarball: 'aihq-catalog-0.0.1.tgz' },
    { position: 2, sha256: list[1].sha256, commit: COMMIT, tarball: 'aihq-catalog-0.0.2.tgz' }]);
  const kept = absoluteManifest(read);
  assert.deepEqual(kept.updateSourceCatalogs.map(item => item.tarball), read.packages.updateSourceCatalogs.map(item => item.tarball));
  assert.equal(readManifest(manifest(() => kept)).packages.updateSourceCatalogs.length, 2);
});

test('up to 8 update-source Catalogs are accepted', t => {
  const { entry, manifest } = area(t);
  const read = readManifest(manifest(value => ({ ...value, updateSourceCatalogs: Array.from({ length: 8 }, (_, index) => entry('catalog', `0.0.${index}`)) })));
  assert.equal(read.packages.updateSourceCatalogs.length, 8);
});

test('update-source Catalogs that are not a list of 1 to 8 valid entries are refused naming the entry', t => {
  const { entry, manifest } = area(t);
  const invalid = pattern => refused('CANDIDATE_MANIFEST_INVALID', pattern);
  const read = list => () => readManifest(manifest(value => ({ ...value, updateSourceCatalogs: list })));
  assert.throws(read(entry('catalog', '0.0.1')), invalid(/updateSourceCatalogs must be a list/));
  assert.throws(read('x'), invalid(/updateSourceCatalogs must be a list/));
  assert.throws(read(null), invalid(/updateSourceCatalogs must be a list/));
  assert.throws(read([]), invalid(/updateSourceCatalogs.*1 to 8/));
  assert.throws(read(Array.from({ length: 9 }, (_, index) => entry('catalog', `0.0.${index}`))), invalid(/updateSourceCatalogs.*1 to 8.*9/));
  assert.throws(read([entry('catalog', '0.0.1'), 'tarball.tgz']), invalid(/updateSourceCatalogs\[1\] must be an object/));
  assert.throws(read([{ ...entry('catalog', '0.0.1'), sha256: 'ABC' }]), invalid(/updateSourceCatalogs\[0\]\.sha256/));
  assert.throws(read([entry('catalog', '0.0.1'), { ...entry('catalog', '0.0.2'), commit: 'zz' }]), invalid(/updateSourceCatalogs\[1\]\.commit/));
  assert.throws(read([{ ...entry('catalog', '0.0.1'), extra: 1 }]), invalid(/updateSourceCatalogs\[0\] has unknown key: extra/));
});

test('an update-source Catalog whose bytes differ or are missing is refused naming its position', async t => {
  const { root, entry, manifest } = area(t);
  const read = readManifest(manifest(value => ({ ...value, updateSourceCatalogs: [entry('catalog', '0.0.1'), entry('catalog', '0.0.2')] })));
  writeFileSync(join(root, 'tarballs', 'aihq-catalog-0.0.2.tgz'), 'changed bytes');
  await assert.rejects(verifyManifest(read), refused('CANDIDATE_DIGEST_MISMATCH', new RegExp(`updateSourceCatalogs\\[1\\].*${sha('changed bytes')}`)));
  rmSync(join(root, 'tarballs', 'aihq-catalog-0.0.1.tgz'));
  await assert.rejects(verifyManifest(read), refused('CANDIDATE_TARBALL_MISSING', /updateSourceCatalogs\[0\]/));
});
