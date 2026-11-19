import { readFile } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

// Resolve only the installed package's declared public import entries.
export async function loadPublic(consumer, name, subpath) {
  if (!['@aihq/core', '@aihq/catalog', '@aihq/scan'].includes(name)) throw Error('Unknown package');
  const root = resolve(consumer, 'node_modules', ...name.split('/'));
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (manifest.name !== name || manifest.version !== '0.0.0-dev.1') throw Error('Expected pinned dev.1 consumer');
  const entry = manifest.exports?.[subpath];
  const target = typeof entry === 'string' ? entry : entry?.import;
  if (typeof target !== 'string' || !target.startsWith('./')) throw Error(`No public export ${name}${subpath}`);
  const file = resolve(root, target), rel = relative(root, file);
  if (isAbsolute(rel) || rel.startsWith('..')) throw Error('Export outside package');
  return { api: await import(pathToFileURL(file).href), version: manifest.version };
}
