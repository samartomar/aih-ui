// Catalog's dependency and update facts for the improvement rules (improvement-rules.mjs, `closures` and `compare`). Pure: it calls only Catalog's
// public reader.
import { resolveSelections, compareReleases } from '@aihq/catalog/reader';
const UNAVAILABLE = new Set(['RELEASE_UNAVAILABLE', 'ITEM_UNAVAILABLE']);
const keyOf = ref => `${ref.releaseSha256}/${ref.itemId}`;
// For checked `releases` keyed by digest and the policy's own `roots`: Catalog's answer for `item` from release `releaseSha256` at `scope`, or undefined
// when that release is not supplied. `required` is its required closure as plain items and `complete` true when Catalog resolves it. When Catalog
// refuses it, `required` is the available items its refusal names as declaring what it could not resolve (`declaredBy`, a lower bound), `unavailable` the
// item ids it could not resolve (`reference`), and `complete` false. `conflicts` are the ids of items Catalog reports in conflict with the item or what it
// needs, resolved beside those of the policy's roots whose releases are supplied, whichever side declares the conflict; `conflictsComplete` is false when
// a root's release is not supplied, so conflicts with it are unknown.
// Known limitation: a closure holding two items with one id (from different releases) keeps the first of each id and is not complete, because a
// suggestion record's content lists required items by id alone and cannot tell them apart.
export const catalogClosures = (releases, roots = []) => {
  const seen = new Map();
  return (item, releaseSha256, scope) => {
    if (!Object.hasOwn(releases, releaseSha256) || typeof scope !== 'string') return undefined;
    const slot = `${releaseSha256}/${item.id}/${scope}`;
    if (!seen.has(slot)) seen.set(slot, answer(releases, roots, item, releaseSha256, scope));
    return seen.get(slot);
  };
};
function answer(releases, roots, item, releaseSha256, scope) {
  const root = { releaseSha256, itemId: item.id, scope, configuration: {} };
  const resolved = resolveSelections({ releases, roots: [root], skips: [] });
  const closure = new Set([keyOf(root)]), found = new Map(), result = { complete: resolved.status === 'ok' };
  const add = needed => {
    closure.add(keyOf(needed));
    if (needed.itemId === item.id && needed.releaseSha256 === releaseSha256) return;
    const entry = releases[needed.releaseSha256]?.items.find(candidate => candidate.id === needed.itemId);
    if (!found.has(keyOf(needed)) && entry) found.set(keyOf(needed), { ...entry, root: { releaseSha256: needed.releaseSha256 } });
  };
  if (resolved.status === 'ok') for (const { item: needed } of resolved.value.inclusions) add(needed);
  else {
    const named = resolved.diagnostics.filter(d => UNAVAILABLE.has(d.code) && d.declaredBy && typeof d.reference?.itemId === 'string');
    for (const { declaredBy } of named) add(declaredBy);
    result.unavailable = named.map(d => d.reference.itemId);
  }
  const byId = new Map();
  for (const needed of found.values()) if (!byId.has(needed.id)) byId.set(needed.id, needed); else result.complete = false;
  result.required = [...byId.values()];
  const supplied = roots.filter(other => Object.hasOwn(releases, other.releaseSha256));
  result.conflictsComplete = supplied.length === roots.length;
  const together = resolveSelections({ releases, roots: [root, ...supplied.map(({ releaseSha256: sha, itemId, scope: at, configuration }) => ({ releaseSha256: sha, itemId, scope: at, configuration }))], skips: [] });
  result.conflicts = together.status === 'ok' ? [] : together.diagnostics.filter(d => d.code === 'ITEM_CONFLICT' && d.reference && d.declaredBy).flatMap(({ reference, declaredBy }) =>
    closure.has(keyOf(declaredBy)) && !closure.has(keyOf(reference)) ? [reference.itemId] : closure.has(keyOf(reference)) && !closure.has(keyOf(declaredBy)) ? [declaredBy.itemId] : []);
  return result;
}
// Catalog's comparison of two checked releases (compareReleases), or undefined when it refuses them.
export const catalogComparison = () => {
  const seen = new Map();
  return (first, second) => {
    const key = `${first?.sha256}\u0000${second?.sha256}`;
    if (!seen.has(key)) { const compared = compareReleases({ first, second }); seen.set(key, compared.status === 'ok' ? compared.value : undefined); }
    return seen.get(key);
  };
};
