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
export async function installedFamilies() {
  const root = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
  return Promise.all(families.map(async ([family, releaseExport]) => {
    const installed = await readInstalledRelease({ root, release: releaseExport, sourceInput: 'maintained' });
    if (!installed.valid) throw new Error(`${family} (${releaseExport}): ${JSON.stringify(installed.diagnostics)}`);
    const descriptors = new Map();
    for (const item of listItems(installed.release)) {
      for (const descriptor of [item.recipe, ...item.materials]) descriptors.set(descriptor.path, descriptor);
    }
    const materials = await Promise.all([...descriptors.values()].map(async descriptor => {
      const path = resolve(root, descriptor.path);
      if (!path.startsWith(root + sep)) throw new Error(`${family}: material escapes installed package.`);
      return { ...descriptor, bytes: new Uint8Array(await readFile(path)) };
    }));
    return { family, release: installed.release, materialSource: installed.source, materials };
  }));
}
