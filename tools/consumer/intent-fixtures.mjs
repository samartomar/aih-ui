// Illustrative producer DATA for consumer acceptance, never an execution target.
import { createHash } from 'node:crypto';
import { readRelease } from '@aihq/catalog/reader';
import { indexReleases } from './saved-intent.mjs';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const source = { kind: 'local', input: 'illustrative-content' };
export function fixtureItem(id, dependencies = {}, extra = {}) {
  return { id, label: id, kind: 'illustrative-skill', scopes: ['project'], inputs: {}, sourceIds: ['fixture'], targets: [],
    recipe: { id, schema: 'urn:aihq:core:recipe:1.0.0', path: `recipes/${id}.json`, sha256: sha256(`recipe:${id}`), byteLength: 100 },
    materials: [{ id: 'content', path: `materials/${id}.md`, sha256: sha256(`content:${id}`), byteLength: 100 }],
    dependencies: { requires: [], optional: [], conflicts: [], ...dependencies }, ...extra };
}
export function fixtureRelease(name, items) {
  const document = { schema: 'urn:aihq:catalog:release:1.0.0', package: { name: `@example/${name}`, version: '1.0.0' },
    sources: [{ id: 'fixture', origin: { kind: 'authored' } }], items };
  const bytes = Buffer.from(JSON.stringify(document, (_key, value) => value && !Array.isArray(value) && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value) + '\n');
  const checked = readRelease(bytes, { expectedSha256: sha256(bytes) });
  if (!checked.valid) throw new Error(JSON.stringify(checked.diagnostics));
  return { release: checked.release, materialSource: source, bytes };
}
export function rootFor(entry, itemId, originIds = ['direct'], configuration = {}) {
  const item = entry.release.items.find(item => item.id === itemId);
  return { releaseSha256: entry.release.sha256, itemId, itemSha256: item.itemSha256, scope: 'project', configuration, originIds };
}
export function crossRef(entry, itemId) {
  const item = entry.release.items.find(item => item.id === itemId);
  return { release: { source: entry.materialSource, manifest: { path: 'release.json', sha256: entry.release.sha256, byteLength: entry.release.byteLength } }, itemId, itemSha256: item.itemSha256 };
}
export function journeyFixture() {
  const shared = fixtureRelease('shared', [fixtureItem('shared.base'), fixtureItem('shared.optional'), fixtureItem('shared.retired')]);
  const app = fixtureRelease('application', [
    fixtureItem('app.alpha', { requires: [crossRef(shared, 'shared.base')], optional: [crossRef(shared, 'shared.optional')] }),
    fixtureItem('app.beta', { requires: [crossRef(shared, 'shared.base')] }),
    fixtureItem('app.configured', {}, { inputs: { directory: { type: 'string', required: false } } })
  ]);
  const nextShared = fixtureRelease('shared', [fixtureItem('shared.base'), fixtureItem('shared.optional')]);
  const nextApp = fixtureRelease('application', [
    fixtureItem('app.alpha', { requires: [crossRef(nextShared, 'shared.base')], optional: [crossRef(nextShared, 'shared.optional')] }, { description: 'Explicitly changed producer content.' }),
    fixtureItem('app.beta', { requires: [crossRef(nextShared, 'shared.base')] }),
    fixtureItem('app.configured', {}, { inputs: { directory: { type: 'string', required: false } } })
  ]);
  const template = { id: 'example.starter', roots: [rootFor(app, 'app.alpha')] };
  delete template.roots[0].originIds;
  template.sha256 = sha256(JSON.stringify(template));
  return { entries: [shared, app], nextEntries: [nextShared, nextApp], index: indexReleases([shared, app]), nextIndex: indexReleases([nextShared, nextApp]),
    templates: [template], replacements: { [shared.release.sha256]: nextShared.release.sha256, [app.release.sha256]: nextApp.release.sha256 } };
}
export function scaleFixture(frameworks = 6, itemsPerFramework = 300) {
  return Array.from({ length: frameworks }, (_, framework) => fixtureRelease(`framework-${framework + 1}`,
    Array.from({ length: itemsPerFramework }, (_, item) => fixtureItem(`framework${framework + 1}.item${String(item + 1).padStart(3, '0')}`,
      item === 0 ? {} : { requires: [{ itemId: `framework${framework + 1}.item001` }] }))));
}
