// Consumer-owned descriptive choice metadata. It grants no execution authority.
// Catalog alone expands sets, options, exclusions and qualified origins.
import { resolveSelections } from '@aihq/catalog/reader';
import { stable } from './primitives.mjs';
import { checkIntentShape } from './intent-shape.mjs';
import { pinSelectedRecipes } from './selected-recipe.mjs';
export const SET_CHOICES_KEY = 'workbenchSetChoices';
export const setChoicesOf = intent => (intent?.provenance ?? []).flatMap(source => source.materialSource?.[SET_CHOICES_KEY]?.choices ?? []);
export const setChoiceSources = intent => (intent?.provenance ?? []).filter(source => source.materialSource?.[SET_CHOICES_KEY]?.choices?.length).map(source => source.releaseSha256);
export function selectSetChoices({ intent, inventories, sets, tool, releaseSha256 }) {
  if (!Array.isArray(sets) || sets.length > 128) throw new Error('Supply at most 128 exact set choices.');
  const releases = Object.fromEntries(inventories.map(entry => [entry.release.sha256, entry.release]));
  const resolved = resolveSelections({ releases, roots: [], skips: [], sets });
  if (resolved.status !== 'ok') return resolved;
  const previous = setChoicesOf(intent);
  const affected = new Set([...sets.map(request => request.release.releaseSha256), ...(releaseSha256 ? [releaseSha256] : [])]);
  const removed = previous.filter(choice => affected.has(choice.request.release.releaseSha256));
  const removedIds = new Set(removed.map(choice => choice.originId));
  intent.roots = intent.roots.map(root => ({ ...root, originIds: root.originIds.filter(id => !removedIds.has(id)) })).filter(root => root.originIds.length);
  intent.origins = intent.origins.filter(origin => !removedIds.has(origin.id));
  intent.exclusions = intent.exclusions.filter(value => !removedIds.has(value.originId));
  const choices = previous.filter(choice => !removedIds.has(choice.originId));
  for (const request of sets) {
    const release = releases[request.release.releaseSha256];
    const originId = `set-${request.release.releaseSha256.slice(0,16)}-${request.setId}`;
    if (originId.length > 180 || intent.origins.some(origin => origin.id === originId)) throw new Error('Set choice identity is duplicate or exceeds the saved format.');
    intent.origins.push({ id: originId, kind: 'direct' });
    const matches = selection => selection.origins.filter(origin => origin.reasonIncluded === 'in-set' && origin.set.framework === release.framework.id && origin.set.setId === request.setId && origin.set.setSha256 === request.setSha256);
    const origins = [];
    for (const selection of resolved.value.selections) {
      const reasons = matches(selection); if (!reasons.length) continue;
      const entry = inventories.find(entry => entry.release.sha256 === selection.item.releaseSha256);
      const item = entry.release.items.find(item => item.id === selection.item.itemId);
      const root = { ...selection.item, itemSha256: item.itemSha256, scope: selection.scope, configuration: selection.configuration, originIds: [originId] };
      pinSelectedRecipes(intent, inventories, root, tool);
      const existing = intent.roots.find(value => value.itemId === root.itemId && value.releaseSha256 === root.releaseSha256 && value.scope === root.scope);
      if (existing) { if (stable(existing.configuration) !== stable(root.configuration)) throw new Error('Set choice conflicts with existing configuration.'); existing.originIds = [...new Set([...existing.originIds, originId])]; }
      else intent.roots.push(root);
      origins.push({ item: selection.item, scope: selection.scope, origins: reasons });
    }
    // Keep exact exclusions beside the set that authored them, even if no hook
    // is selected. The public request remains the authority for expansion.
    for (const member of request.members ?? []) if (!member.include) {
      // Cross-framework exclusions stay qualified in the exact saved request.
      // Catalog enforces them together with configured roots during composition;
      // an excluded member need never configure successfully or gain a guessed pin.
      if (member.item.framework === release.framework.id) intent.exclusions.push({ originId, releaseSha256: request.release.releaseSha256, itemId: member.item.itemId, scope: request.release.scope });
    }
    choices.push({ originId, request, tool, origins });
  }
  for (const sha of affected) {
    let source = intent.provenance.find(source => source.releaseSha256 === sha);
    const entry = inventories.find(entry => entry.release.sha256 === sha);
    if (!source && entry) { source = { releaseSha256: sha, package: entry.release.package, sources: entry.release.sources, materialSource: { ...entry.materialSource, ...(entry.internalContent ? { internalContent: entry.internalContent } : {}) } }; intent.provenance.push(source); }
    if (!source) throw new Error('Exact set source unavailable.');
    const { [SET_CHOICES_KEY]: old, ...materialSource } = source.materialSource;
    const held = choices.filter(choice => choice.request.release.releaseSha256 === sha);
    source.materialSource = { ...materialSource, ...(held.length ? { [SET_CHOICES_KEY]: { version: 1, choices: held } } : {}) };
  }
  return { status: 'ok', value: { intent } };

}
export function checkRecordedSetChoices(intent, inventories) {
  if (!Array.isArray(intent?.provenance)) return;
  const records = intent.provenance.filter(source => source.materialSource?.[SET_CHOICES_KEY] !== undefined);
  if (records.length && !checkIntentShape(intent)) return 'Set choices require a valid saved intent.';
  for (const source of records) {
    const record = source.materialSource[SET_CHOICES_KEY];
    if (record?.version !== 1 || Object.keys(record).sort().join(',') !== 'choices,version' || !Array.isArray(record.choices) || record.choices.length > 128) return 'Unsupported set-choice metadata. Original bytes retained.';
    if (record.choices.some(choice => choice?.request?.release?.releaseSha256 !== source.releaseSha256)) return 'Set choices must name their exact source.';
  }
  for (const choice of setChoicesOf(intent)) {
    if (!choice || typeof choice.originId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(choice.tool ?? '') || !choice.request || !Array.isArray(choice.origins) || !intent?.origins?.some(origin => origin.id === choice.originId)) return 'Set choice has no corresponding saved origin.';
    const entry = inventories.find(entry => entry.release.sha256 === choice.request.release?.releaseSha256);
    if (!entry) continue; // Existing unresolved-source handling keeps its exact bytes and other choices.
    const releases = Object.fromEntries(inventories.map(entry => [entry.release.sha256, entry.release]));
    const read = resolveSelections({ releases, roots: [], skips: [], sets: [choice.request] });
    if (read.status !== 'ok') { if (read.diagnostics?.every(diagnostic => ['RELEASE_UNAVAILABLE', 'ITEM_UNAVAILABLE'].includes(diagnostic.code))) continue; return 'Catalog refused the saved exact set choice.'; }
    const actual = read.value.selections.filter(selection => selection.origins.some(origin => origin.reasonIncluded === 'in-set' && origin.set.framework === entry.release.framework.id && origin.set.setId === choice.request.setId))
      .map(selection => ({ item: selection.item, scope: selection.scope, origins: selection.origins.filter(origin => origin.reasonIncluded === 'in-set' && origin.set.framework === entry.release.framework.id && origin.set.setId === choice.request.setId) }));
    if (stable(actual) !== stable(choice.origins)) return 'Saved qualified set origins differ from Catalog resolution.';
    if (choice.origins.some(value => !intent.roots.some(root => root.releaseSha256 === value.item.releaseSha256 && root.itemId === value.item.itemId && root.scope === value.scope && root.originIds.includes(choice.originId)))) return 'Saved set members differ from their recorded roots; update or remove the set explicitly.';
  }
}
