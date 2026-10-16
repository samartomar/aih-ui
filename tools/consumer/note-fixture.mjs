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
  if (variant === 'expanded') {
    declaration.package.version = '1.1.0';
    for (const [name, label, description] of [
      ['test-plan-note', 'Test plan note', 'An independently authored note on planning tests before a change; no AIHQ curation or admission is implied.'],
      ['style-note', 'Style note', 'An independently authored note on naming and formatting; no AIHQ curation or admission is implied.'],
    ]) declaration.items.push({ ...structuredClone(item), id: `consumer-proof.${name}`, label, description,
      recipePath: `${prefix}${name}-recipe.json`, materials: [{ id: 'license', path: `${prefix}LICENSE` }, { id: 'note', path: `${prefix}${name}.md` }], requires: [] });
  }
  const names = [...new Set([declaration.sources[0].licensePath, ...declaration.items.flatMap(item => [item.recipePath, ...item.materials.map(m => m.path)])])];
  const files = Object.fromEntries(await Promise.all(names.map(async path => [path, new Uint8Array(await readFile(new URL(`./fixtures/review-note/${path.slice(prefix.length)}`, import.meta.url)))])));
  return { declarationBytes: new TextEncoder().encode(JSON.stringify(declaration)), sourceFiles: [{ source: 'notes', revision: NOTE_SOURCE_REVISION, files }] };
}
