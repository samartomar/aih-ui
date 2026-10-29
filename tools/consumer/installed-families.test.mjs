import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listItems } from '@aihq/catalog/reader';
import { installedFamilies } from './installed-families.mjs';

// Runs inside the installed consumer, where @aihq/catalog resolves (the owning suite for installed-families).
const root = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));

test('prepared-content families carry the release identities the named review rows record', async () => {
  const families = await installedFamilies({ root });
  const extensions = families.find(family => family.family === 'Extensions');
  assert.ok(extensions, 'Extensions family present');
  assert.equal(extensions.release.framework?.id, 'extensions', 'the prepared release publishes its framework identity');
  const grill = listItems(extensions.release).find(item => item.id === 'extensions.matt.grill-me');
  assert.ok(grill.contentSha256 && grill.behaviourSha256, 'release 1.6 item identities are present for the metadata bundle');
  assert.ok(grill.recipes && Object.keys(grill.recipes).length > 1, 'per-client recipes are exposed');
  assert.ok(extensions.materials.some(material => material.bytes?.length > 0 && String(material.path).includes('recipes')),
    'recipe files are part of the readable material custody');
});

test('custody keeps the caller host-bound input, and materials resolve from the package root', async () => {
  const families = await installedFamilies({ root, sourceInput: 'custom-bound-input' });
  for (const family of families) assert.equal(family.materialSource.input, 'custom-bound-input');
  const extensions = families.find(family => family.family === 'Extensions');
  assert.ok(extensions.materials.length > 0, 'materials exist');
  for (const material of extensions.materials.slice(0, 25)) assert.ok(material.bytes.length > 0, `${material.path} is readable`);
});

test('an invalid package root fails truthfully instead of masking invalid content', async () => {
  await assert.rejects(() => installedFamilies({ root: '/nonexistent-catalog-package-root' }));
});

test('corrupt or removed prepared content fails loudly; it is never masked by the legacy export', async t => {
  const { cp, rm, mkdtemp, readFile, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const contentPath = join('release', 'release-extensions.content.json');
  const makeVariant = async mutate => {
    const copy = await mkdtemp(join(tmpdir(), 'aih-families-'));
    await cp(root, copy, { recursive: true }); // real copy: the corruption must not touch the installed package
    await mutate(join(copy, contentPath));
    return copy;
  };
  const corrupt = await makeVariant(async path => {
    const bytes = await readFile(path);
    const broken = Buffer.from(bytes); broken[100] ^= 0xff;
    await rm(path); await writeFile(path, broken); // replace, never mutate a shared inode
  });
  await assert.rejects(() => installedFamilies({ root: corrupt }), /prepared content is present but unreadable/);
  const removed = await makeVariant(path => rm(path));
  await assert.rejects(() => installedFamilies({ root: removed }), /prepared content is present but unreadable|member-missing/);
  t.after(async () => { await rm(corrupt, { recursive: true, force: true }); await rm(removed, { recursive: true, force: true }); });
});
