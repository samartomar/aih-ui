import { freshAuthoring, ok, refuse } from './headless.mjs';
import { only, hash } from './intake.mjs';
export function migrateIntent(old, inventories) {
  const next = freshAuthoring();
  const find = ref => inventories.find(e => e.release.sha256 === ref.releaseSha256)?.release.items.find(i => i.id === ref.itemId);
  if (old?.schema === 'urn:aihq:workbench:saved-intent:2.0.0') {
    if (!only(old, ['schema', 'origins', 'roots', 'exclusions', 'pins', 'provenance'])) return refuse('FIELD_SEMANTICS_UNSUPPORTED', '/metadata/aih.workbench', 'Unknown historical semantics.');
    next.origins = structuredClone(old.origins);
    next.roots = structuredClone(old.roots);
    next.pins = structuredClone(old.pins);
    next.provenance = structuredClone(old.provenance);
    for (const origin of next.origins) if (origin.kind === 'template') {
      const entries = inventories.filter(e => e.templates?.some(t => t.id === origin.templateId && t.sha256 === origin.templateSha256));
      if (entries.length !== 1) return refuse('ORIGIN_UNAVAILABLE', '/origins', 'Historical template has no unambiguous exact release.');
      origin.releaseSha256 = entries[0].release.sha256;
    }
    for (const exclusion of old.exclusions) {
      if (!only(exclusion, ['releaseSha256', 'itemId', 'itemSha256', 'originIds']) || !hash(exclusion.itemSha256)
        || !Array.isArray(exclusion.originIds) || !exclusion.originIds.length || new Set(exclusion.originIds).size !== exclusion.originIds.length
        || exclusion.originIds.some(id => !next.origins.some(origin => origin.id === id))) return refuse('FIELD_SEMANTICS_UNSUPPORTED', '/exclusions', 'Unknown or malformed historical exclusion semantics.');
      const item = find(exclusion);
      if (!item || item.scopes.length !== 1) return refuse('SOURCE_REVISION_UNAVAILABLE', '/exclusions', 'Historical exclusion scope is unresolved.');
      if (item.itemSha256 !== exclusion.itemSha256) return refuse('INTENT_POLICY_CONTRADICTION', '/exclusions', 'Historical exclusion identity contradicts the exact checked item.');
      for (const originId of exclusion.originIds ?? []) next.exclusions.push({ originId, releaseSha256: exclusion.releaseSha256, itemId: exclusion.itemId, scope: item.scopes[0] });
    }
    // A checked release does not establish the original declaration snapshot.
    // Historical BYO acquisition identity must be resolved, never retrofitted.
    if (inventories.some(e => e.input && old.provenance.some(p => p.releaseSha256 === e.release.sha256))) return refuse('SOURCE_IDENTITY_MISMATCH', '/inputs', 'Historical source declaration identity was not recorded; retain original and explicitly recover acquisition.');
    return ok(next);
  }
  if (old?.schema === 'urn:aihq:workbench:setup-intent:1.0.0') {
    if (!only(old, ['schema', 'source', 'roots', 'excludedItemIds']) || !only(old.source, ['releaseSha256'])) return refuse('FIELD_SEMANTICS_UNSUPPORTED', '/metadata/aih.workbench', 'Unknown historical semantics.');
    const entry = inventories.find(e => e.release.sha256 === old.source.releaseSha256);
    if (!entry) return refuse('SOURCE_REVISION_UNAVAILABLE', '/source', 'Historical exact inventory unavailable.');
    for (const root of old.roots) {
      if (!only(root, ['itemId', 'scope', 'configuration'])) return refuse('FIELD_SEMANTICS_UNSUPPORTED', '/roots', 'Unknown historical root semantics.');
      const item = entry.release.items.find(i => i.id === root.itemId);
      if (!item) return refuse('SOURCE_REVISION_UNAVAILABLE', '/roots', 'Historical exact item unavailable.');
      // v1 roots are explicitly chosen individual items by definition.
      next.roots.push({ ...root, releaseSha256: entry.release.sha256, itemSha256: item.itemSha256, originIds: ['direct'] });
    }
    for (const itemId of old.excludedItemIds) {
      const item = entry.release.items.find(i => i.id === itemId);
      if (!item || item.scopes.length !== 1) return refuse('SOURCE_REVISION_UNAVAILABLE', '/excludedItemIds', 'Historical exclusion is unresolved.');
      next.exclusions.push({ originId: 'direct', releaseSha256: entry.release.sha256, itemId, scope: item.scopes[0] });
    }
    return { ...ok(next), capture: true };
  }
  return refuse('INTENT_VERSION_UNSUPPORTED', '/metadata/aih.workbench/schema', 'Supported intent is unavailable; execution validity is unchanged.');
}
