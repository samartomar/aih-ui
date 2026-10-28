import { readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInstalledRelease, readInstalledPreparedContent } from '@aihq/catalog/node';
import { listItems } from '@aihq/catalog/reader';

// Presentation groups name package exports, never infer ownership from item IDs. Families whose package ships
// prepared content (the current release-content documents) read it: only that public reader exposes the release
// 1.6/1.7 item identities (content/behaviour digests, framework) the review's named rows are recorded from. The
// plain release exports are legacy documents without those identities; families (or older package roots) without
// prepared content keep the plain reader, and their items stay explicitly metadata-unavailable rather than
// inventing names or origins.
const families = [
  ['Extensions', './release-extensions.json', 'extensions'], ['ECC', './release-ecc.json', 'ecc'],
  ['Superpowers', './release-superpowers.json', 'superpowers'], ['Anthropic', './release-anthropic.json', null]
];
// The four family release exports of a Catalog package root, beside its main ./release.json.
export const FAMILY_RELEASE_EXPORTS = families.map(([, releaseExport]) => releaseExport);
const materialsOf = async (root, release) => {
  const descriptors = new Map();
  for (const item of listItems(release)) for (const descriptor of [item.recipe, ...Object.values(item.recipes ?? {}), ...item.materials].filter(Boolean))
    descriptors.set(descriptor.path ?? descriptor.packagePath, descriptor);
  return Promise.all([...descriptors.values()].map(async descriptor => {
    const path = descriptor.path ?? descriptor.packagePath;
    const location = resolve(root, path);
    if (!location.startsWith(root + sep)) throw new Error('Material escapes installed package.');
    return { ...descriptor, path, bytes: new Uint8Array(await readFile(location)) };
  }));
};
export async function installedReleaseInventory({ root, releaseExport = './release.json', sourceInput = 'maintained' }) {
  const installed = await readInstalledRelease({ root, release: releaseExport, sourceInput });
  if (!installed.valid) throw new Error(`${releaseExport}: ${JSON.stringify(installed.diagnostics)}`);
  return { release: installed.release, materialSource: installed.source, materials: await materialsOf(root, installed.release) };
}
export async function installedFamilies({ root = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'))), sourceInput = 'maintained' } = {}) {
  return Promise.all(families.map(async ([family, releaseExport, frameworkId]) => {
    if (frameworkId) {
      const prepared = await readInstalledPreparedContent({ root, frameworkId }).catch(() => null);
      if (prepared?.valid) return { family, release: prepared.release, materialSource: prepared.source, materials: await materialsOf(root, prepared.release) };
    }
    return { family, ...await installedReleaseInventory({ root, releaseExport, sourceInput }) };
  }));
}
