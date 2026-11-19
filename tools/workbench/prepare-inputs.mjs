import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const [consumer, catalogDirectory] = process.argv.slice(2);
if (!consumer || !catalogDirectory) {
  throw Error('Supply the installed consumer directory and the matching unpacked Catalog data directory.');
}
const root = resolve(catalogDirectory);
const { data } = JSON.parse(await readFile(join(consumer, 'public', 'catalog.json'), 'utf8'));
const { repository, commit } = data;
const recipe = JSON.parse(await readFile(join(root, 'port-report', 'ai-setup.json'), 'utf8'));
const qualifications = {};
for (const name of await readdir(join(root, 'data', 'qualifications'))) {
  if (!/^[0-9a-f]{64}\.json$/.test(name)) continue;
  const bytes = await readFile(join(root, 'data', 'qualifications', name));
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (name !== digest + '.json') throw Error('Qualification bytes differ from their published digest.');
  qualifications[digest] = JSON.parse(bytes);
}
const dest = join(consumer, 'public', 'workbench');
await mkdir(dest, { recursive: true });
await writeFile(join(dest, 'tool-setup-data.json'), JSON.stringify({ source: { repository, commit }, recipe, qualifications }));
