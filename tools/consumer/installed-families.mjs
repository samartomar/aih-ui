import { readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInstalledRelease } from '@aihq/catalog/node';
import { listItems } from '@aihq/catalog/reader';

// Presentation groups name package exports, never infer ownership from item IDs.
const families = [
  ['Extensions', './release-extensions.json'], ['ECC', './release-ecc.json'],
  ['Superpowers', './release-superpowers.json'], ['Anthropic', './release-anthropic.json']
];
// The four family release exports of a Catalog package root, beside its main ./release.json.
export const FAMILY_RELEASE_EXPORTS = families.map(([, releaseExport]) => releaseExport);
export async function installedReleaseInventory({ root, releaseExport = './release.json', sourceInput = 'maintained' }) {
  const installed = await readInstalledRelease({ root, release: releaseExport, sourceInput });
  if (!installed.valid) throw new Error(`${releaseExport}: ${JSON.stringify(installed.diagnostics)}`);
  const descriptors = new Map();
  for (const item of listItems(installed.release)) for (const descriptor of [item.recipe, ...item.materials]) descriptors.set(descriptor.path, descriptor);
  const materials = await Promise.all([...descriptors.values()].map(async descriptor => {
    const path = resolve(root, descriptor.path);
    if (!path.startsWith(root + sep)) throw new Error('Material escapes installed package.');
    return { ...descriptor, bytes: new Uint8Array(await readFile(path)) };
  }));
  return { release: installed.release, materialSource: installed.source, materials };
}
export async function installedFamilies({ root = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'))), sourceInput = 'maintained' } = {}) {
  const results = await Promise.allSettled(families.map(async ([family, releaseExport]) => ({ family, ...await installedReleaseInventory({ root, releaseExport, sourceInput }) })));
  const inventories = results.filter(result => result.status === 'fulfilled').map(result => result.value);
  inventories.failures = results.flatMap((result, index) => result.status === 'rejected' ? [{ state: 'failed', message: `Installed content source ${index + 1} failed. Other sources remain available.` }] : []);
  return inventories;
}
