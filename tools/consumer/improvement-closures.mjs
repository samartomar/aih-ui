// Catalog's required closure for the improvement rules (improvement-rules.mjs, `closures`). Pure: it calls only Catalog's public reader.
import { resolveSelections } from '@aihq/catalog/reader';
// For checked `releases` keyed by digest: Catalog's required closure of `item` from release `releaseSha256` at `scope`, as plain items, or
// undefined when Catalog refuses it. A refusal is an unavailable required release, an input the item needs or a scope it does not admit;
// Catalog does not yet name the reference it could not resolve (gap G-1), so the rules then walk the declared requirements instead.
// Known limitation: a closure holding two items with one id (from different releases) is also left to the walk, because a suggestion
// record's content lists required items by id alone and cannot tell them apart.
export const catalogClosures = releases => (item, releaseSha256, scope) => {
  if (!Object.hasOwn(releases, releaseSha256) || typeof scope !== 'string') return undefined;
  const resolved = resolveSelections({ releases, roots: [{ releaseSha256, itemId: item.id, scope, configuration: {} }], skips: [] });
  if (resolved.status !== 'ok') return undefined;
  const found = new Map();
  for (const { item: needed } of resolved.value.inclusions) {
    if (needed.itemId === item.id) continue;
    const key = `${needed.releaseSha256}/${needed.itemId}`, entry = releases[needed.releaseSha256].items.find(candidate => candidate.id === needed.itemId);
    if (!found.has(key) && entry) found.set(key, { ...entry, root: { releaseSha256: needed.releaseSha256 } });
  }
  const required = [...found.values()];
  return new Set(required.map(needed => needed.id)).size === required.length ? required : undefined;
};
