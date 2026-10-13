// Exact repository-backed material snapshots. Declarations remain independent
// local authoring data; the source pin attributes recipe/material bytes only.
import { readFile } from 'node:fs/promises';
export const NOTE_SOURCE_REVISION = '4878543b94c81fbc836ca136150c22c9a9615bfb';
const prefix = 'tools/consumer/fixtures/review-note/';
export async function noteFixture(variant = 'current') {
  const declaration = JSON.parse(await readFile(new URL('./fixtures/review-note/declaration.json', import.meta.url), 'utf8'));
  declaration.sources[0].repository = 'samartomar/aih-ui';
  declaration.sources[0].licensePath = `${prefix}LICENSE`;
  const item = declaration.items[0];
  item.recipePath = `${prefix}${variant === 'additional' ? 'additional-recipe.json' : 'recipe.json'}`;
  for (const material of item.materials) material.path = `${prefix}${variant === 'updated' && material.id === 'note' ? 'next-note.md' : material.path}`;
  if (variant === 'updated') declaration.package.version = '1.0.1';
  if (variant === 'additional') { declaration.package = { name: 'additional-notes', version: '1.0.0' }; item.id = 'independent.additional-note'; item.requires = []; }
  const names = [...new Set([declaration.sources[0].licensePath, item.recipePath, ...item.materials.map(m => m.path)])];
  const files = Object.fromEntries(await Promise.all(names.map(async path => [path, new Uint8Array(await readFile(new URL(`./fixtures/review-note/${path.slice(prefix.length)}`, import.meta.url)))])));
  return { declarationBytes: new TextEncoder().encode(JSON.stringify(declaration)), sourceFiles: [{ source: 'notes', revision: NOTE_SOURCE_REVISION, files }] };
}
