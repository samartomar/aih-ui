// Exact repository-backed material snapshots. Declarations remain independent
// local authoring data; the source pin attributes recipe/material bytes only.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
export const NOTE_SOURCE_REVISION = '4878543b94c81fbc836ca136150c22c9a9615bfb';
const prefix = 'tools/consumer/fixtures/review-note/';
// The note requires an item of the installed maintained release. Its exact pin is read from that package's public
// release export each time, so moving to another Catalog changes the pin with it. Without an installed Catalog the
// pin stays incomplete and Catalog refuses the declaration.
async function pinMaintained(requirement) {
  let release;
  try { release = fileURLToPath(import.meta.resolve('@aihq/catalog/release.json')); } catch { return; }
  const [{ readRelease, getItem }, bytes] = await Promise.all([import('@aihq/catalog/reader'), readFile(release)]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const read = readRelease(new Uint8Array(bytes), { expectedSha256: sha256 });
  const found = read.valid ? getItem(read.release, requirement.itemId) : undefined;
  if (!found?.found) throw new Error(`The installed @aihq/catalog release.json does not offer ${requirement.itemId}.`);
  Object.assign(requirement.release.manifest, { sha256, byteLength: bytes.length });
  requirement.itemSha256 = found.item.itemSha256;
}
export async function noteFixture(variant = 'current') {
  const declaration = JSON.parse(await readFile(new URL('./fixtures/review-note/declaration.json', import.meta.url), 'utf8'));
  for (const requirement of declaration.items[0].requires) if (requirement.release?.source?.input === 'maintained') await pinMaintained(requirement);
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
