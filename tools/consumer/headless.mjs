// Supported consumer boundary. No host acquisition or execution authority.
import { parsePolicy, deriveRecipeIdentity } from '@aihq/core/contracts';
import { isCheckedRelease, listItems, configureItem, resolveSelections, validateSelectionSet } from '@aihq/catalog/reader';
import { checkIntentShape, rootKey, pinKey } from './intent-shape.mjs';
import { migrateIntent } from './migrate-intent.mjs';
export const AUTHORING_SCHEMA = 'urn:aihq:workbench:saved-intent:3.0.0';
export const REVIEW_SCHEMA = 'urn:aihq:workbench:review-decisions:1.0.0';
export const stable = value => JSON.stringify(value, (_key, member) => member && typeof member === 'object' && !Array.isArray(member)
  ? Object.fromEntries(Object.entries(member).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : member);
export const ok = value => ({ status: 'ok', value, diagnostics: [] });
export const refuse = (code, path, message, originalBytes, details) => ({ status: 'refused', diagnostics: [{ code, path, message, ...(details ? { details } : {}) }], ...(originalBytes ? { originalBytes: originalBytes.slice() } : {}) });
export function freshAuthoring() {
  return { schema: AUTHORING_SCHEMA, origins: [{ id: 'direct', kind: 'direct' }], roots: [], exclusions: [], pins: [], provenance: [], inputs: [], reviews: { schema: REVIEW_SCHEMA, records: [], history: [] } };
}
const sorted = values => [...values].sort((a, b) => stable(a) < stable(b) ? -1 : stable(a) > stable(b) ? 1 : 0);
function inventoryIndex(inventories) {
  if (!Array.isArray(inventories) || inventories.length > 32) throw new Error('Supply at most 32 exact checked inventories.');
  const releases = Object.create(null), items = new Map();
  for (const entry of inventories) {
    if (!entry || !isCheckedRelease(entry.release) || releases[entry.release.sha256]) throw new Error('Inventories must be unique checked Catalog reader values.');
    releases[entry.release.sha256] = entry.release;
    for (const item of listItems(entry.release)) items.set(pinKey({ releaseSha256: entry.release.sha256, itemId: item.id }), { entry, item });
  }
  return { releases, items };
}
const projected = selections => sorted(selections.map(({ id, managementId, organizationSelectionId, scope, configuration, requires, recipe }) =>
  ({ id, managementId, ...(organizationSelectionId !== undefined ? { organizationSelectionId } : {}), scope, configuration, requires: [...requires].sort(), recipe })));

async function build({ intent, inventories, base, capture = false, historicalV2 = false }) {
  if (intent && new TextEncoder().encode(JSON.stringify(intent)).length > 850_000) return refuse('POLICY_BOUND_EXCEEDED', '/metadata/aih.workbench', 'Intent exceeds 850,000 UTF-8 bytes; reduce selected state.');
  if (!checkIntentShape(intent)) return refuse('FIELD_SEMANTICS_UNSUPPORTED', '/metadata/aih.workbench', 'Malformed, oversized or unknown authoring semantics.');
  let index;
  try { index = inventoryIndex(inventories); }
  catch (error) { return refuse('SOURCE_IDENTITY_MISMATCH', '/inventories', error.message); }
  for (const root of intent.roots) {
    const found = index.items.get(pinKey(root));
    if (!found) return refuse('SOURCE_REVISION_UNAVAILABLE', '/roots', `Exact source/item unavailable: ${pinKey(root)}`);
    if (found.item.itemSha256 !== root.itemSha256) return refuse('SOURCE_IDENTITY_MISMATCH', '/roots', 'Root differs from the checked item.');
  }
  for (const origin of intent.origins) if (origin.kind === 'template') {
    const entry = inventories.find(e => e.release.sha256 === origin.releaseSha256);
    if (!entry?.templates?.some(t => t.id === origin.templateId && t.sha256 === origin.templateSha256)) return refuse('ORIGIN_UNAVAILABLE', '/origins', 'Exact template snapshot unavailable.');
  }
  for (const input of intent.inputs) {
    const entry = inventories.find(e => e.release.sha256 === input.releaseSha256);
    if (!entry) return refuse('SOURCE_REVISION_UNAVAILABLE', '/inputs', 'Exact input release unavailable.');
    if (stable(entry.input) !== stable(input)) return refuse('SOURCE_IDENTITY_MISMATCH', '/inputs', 'Acquired input identity differs from the saved snapshot.');
  }
  const resolution = resolveSelections({ releases: index.releases,
    roots: intent.roots.map(({ releaseSha256, itemId, scope, configuration }) => ({ releaseSha256, itemId, scope, configuration })),
    skips: intent.exclusions.map(({ releaseSha256, itemId, scope }) => ({ releaseSha256, itemId, scope })) });
  if (resolution.status !== 'ok') return resolution;
  const resolved = resolution.value;
  // Preserve existing selection identity for unchanged recipe/source/scope; a
  // historical v1 selection id is not a reason to rewrite execution semantics.
  const selections = [], pins = new Map(), sourceIds = new Set([...intent.exclusions.map(r => r.releaseSha256), ...intent.origins.filter(o => o.kind === 'template').map(o => o.releaseSha256)]);
  for (const selection of resolved.selections) {
    const found = index.items.get(pinKey(selection.item)), { entry, item } = found;
    const configured = configureItem({ release: entry.release, itemId: item.id, configuration: selection.configuration, materialSource: entry.materialSource });
    if (!configured.valid) return refuse('INPUT_INVALID', '/roots/configuration', 'Catalog refused item configuration.', undefined, { owner: 'catalog', diagnostics: configured.diagnostics });
    const prior = base?.selections.find(s => s.scope === selection.scope && stable(s.recipe) === stable(configured.selection.recipe));
    const organizationIds = new Set(resolved.inclusions.filter(i => rootKey(i.item) === rootKey({ ...selection.item, scope: selection.scope }))
      .flatMap(i => intent.roots.find(r => rootKey(r) === rootKey(i.root))?.originIds ?? [])
      .map(id => intent.origins.find(o => o.id === id)).filter(o => o?.kind === 'organization').map(o => o.organizationSelectionId));
    if (organizationIds.size > 1) return refuse('INTENT_POLICY_CONTRADICTION', '/origins', 'Conflicting organization selection identities.');
    const managementId = prior?.managementId ?? `${selection.scope}--${entry.release.package.name.replace(/^@/, '').replaceAll('/', '.')}--${item.id}`;
    selections.push({ ...prior, id: prior?.id ?? selection.id, managementId, scope: selection.scope, configuration: configured.selection.configuration,
      ...(base?.mode === 'enterprise' ? { organizationSelectionId: [...organizationIds][0] ?? prior?.organizationSelectionId ?? managementId } : {}),
      requires: [], recipe: configured.selection.recipe });
    pins.set(pinKey(selection.item), { releaseSha256: entry.release.sha256, itemId: item.id, itemSha256: item.itemSha256, recipe: item.recipe, materials: item.materials });
    sourceIds.add(entry.release.sha256);
  }
  const validation = validateSelectionSet({ releases: index.releases, selections: resolved.selections.map((s, i) => ({ ...s, id: selections[i].id })) });
  if (!validation.valid) return refuse('INPUT_INVALID', '/selections', 'Catalog refused the resolved set.', undefined, { owner: 'catalog', diagnostics: validation.diagnostics });
  for (const selection of selections) selection.requires = validation.requiresBySelectionId[selection.id];
  const provenance = inventories.filter(e => sourceIds.has(e.release.sha256)).map(e => ({ releaseSha256: e.release.sha256, package: e.release.package, sources: e.release.sources, materialSource: e.materialSource }));
  const inputs = inventories.filter(e => sourceIds.has(e.release.sha256) && e.input).map(e => e.input);
  const next = { ...structuredClone(intent), pins: sorted([...pins.values()]), provenance: sorted(provenance), inputs: sorted(inputs) };
  if (!checkIntentShape(next)) return refuse('FIELD_SEMANTICS_UNSUPPORTED', '/metadata/aih.workbench', 'Captured authoring state violates the supported shape.');
  // v2 captured source provenance from resolved pins/exclusions only. Validate
  // that frozen projection before enriching migrated v3 template provenance.
  const historicalSources = new Set([...pins.values(), ...intent.exclusions].map(ref => ref.releaseSha256));
  const comparisonProvenance = historicalV2 ? next.provenance.filter(p => historicalSources.has(p.releaseSha256)) : next.provenance;
  if (!capture && (stable(sorted(intent.pins)) !== stable(next.pins) || stable(sorted(intent.provenance)) !== stable(comparisonProvenance) || stable(sorted(intent.inputs)) !== stable(next.inputs)))
    return refuse('INTENT_POLICY_CONTRADICTION', '/metadata/aih.workbench', 'Pins, provenance or inputs contradict the checked closure.');
  const policy = { ...(base ?? { schema: 'urn:aihq:core:execution-policy:1.3.0', mode: 'vibe' }), selections,
    metadata: { ...base?.metadata, 'aih.workbench': next } };
  const policyBytes = new TextEncoder().encode(JSON.stringify(policy) + '\n');
  if (policyBytes.length > 1_000_000 || new TextEncoder().encode(JSON.stringify(next)).length > 850_000) return refuse('POLICY_BOUND_EXCEEDED', '', 'Policy exceeds the Core or consumer byte bound; reduce selected state.');
  const parsed = parsePolicy(new TextDecoder().decode(policyBytes));
  if (!parsed.valid) return refuse('INPUT_INVALID', '', 'Core refused the composed execution policy.', undefined, { owner: 'core', diagnostics: parsed.diagnostics });
  return ok({ policyBytes, intent: next, policy, inclusions: resolved.inclusions, optional: resolved.optional });
}
export async function readAuthoring({ policyBytes, inventories }) {
  if (!(policyBytes instanceof Uint8Array)) return refuse('INPUT_INVALID', '/policyBytes', 'Supply original UTF-8 bytes.');
  const originalBytes = policyBytes.slice();
  let parsed;
  try { parsed = parsePolicy(new TextDecoder('utf-8', { fatal: true }).decode(policyBytes)); }
  catch { return refuse('INPUT_INVALID', '/policyBytes', 'Invalid UTF-8 policy.', originalBytes); }
  if (!parsed.valid) return refuse('INPUT_INVALID', '', 'Core refused the execution policy.', originalBytes, { owner: 'core', diagnostics: parsed.diagnostics });
  const policy = parsed.document;
  let intent = policy.metadata?.['aih.workbench'], migration;
  if (intent?.schema !== AUTHORING_SCHEMA) {
    try { migration = migrateIntent(intent, inventories); }
    catch { migration = refuse('FIELD_SEMANTICS_UNSUPPORTED', '/metadata/aih.workbench', 'Malformed historical intent.'); }
    if (migration.status === 'refused') return ok({ policy, intent, editing: 'unavailable', originalBytes, diagnostics: migration.diagnostics });
    intent = migration.value;
  }
  const rebuilt = await build({ intent, inventories, base: policy, capture: migration?.capture === true, historicalV2: migration?.historicalV2 === true });
  const diagnostics = rebuilt.status === 'refused' ? rebuilt.diagnostics : stable(projected(rebuilt.value.policy.selections)) !== stable(projected(policy.selections))
    ? [{ code: 'INTENT_POLICY_CONTRADICTION', path: '/selections', message: 'Intent contradicts executable selections.' }] : [];
  if (!diagnostics.length && intent.reviews.records.some(r => r.state === 'current')) diagnostics.push({ code: 'REVIEW_BINDING_UNAVAILABLE', path: '/reviews/records', message: 'Current decision custody must be established by the evidence review workflow; original records remain readable.' });
  return ok({ policy, intent: rebuilt.status === 'ok' ? rebuilt.value.intent : intent, editing: diagnostics.length ? 'unavailable' : 'available', originalBytes, diagnostics,
    ...(rebuilt.status === 'ok' ? { inclusions: rebuilt.value.inclusions, optional: rebuilt.value.optional } : {}),
    ...(migration ? { migration: { from: policy.metadata['aih.workbench'].schema, to: AUTHORING_SCHEMA } } : {}) });
}
export async function reconcileAuthoring({ savedPolicyBytes, inventories, candidateInventories }) {
  const read = await readAuthoring({ policyBytes: savedPolicyBytes, inventories });
  if (read.status === 'refused') return read;
  if (read.value.editing !== 'available') return { status: 'refused', diagnostics: read.value.diagnostics, originalBytes: savedPolicyBytes.slice() };
  let candidate, previous;
  try { candidate = inventoryIndex(candidateInventories); previous = inventoryIndex(inventories); }
  catch (error) { return refuse('SOURCE_IDENTITY_MISMATCH', '/candidateInventories', error.message, savedPolicyBytes); }
  const { intent } = read.value, affectedRoots = [], retainedRoots = [], choices = [];
  const changedRelease = releaseSha256 => {
    const before = previous.releases[releaseSha256], after = candidate.releases[releaseSha256];
    const oldEntry = inventories.find(e => e.release.sha256 === releaseSha256), nextEntry = candidateInventories.find(e => e.release.sha256 === releaseSha256);
    return !before || !after || stable(oldEntry?.input) !== stable(nextEntry?.input) || stable(oldEntry?.materialSource) !== stable(nextEntry?.materialSource);
  };
  const changedSource = ref => changedRelease(ref.releaseSha256) || !candidate.items.has(pinKey(ref));
  const missingExclusions = intent.exclusions.filter(changedSource);
  const missingOrigins = intent.origins.filter(o => o.kind === 'template' && (changedRelease(o.releaseSha256) || !candidateInventories.some(e => e.release.sha256 === o.releaseSha256 && e.templates?.some(t => t.id === o.templateId && t.sha256 === o.templateSha256))));
  const resolution = resolveSelections({ releases: previous.releases, roots: intent.roots.map(({ releaseSha256, itemId, scope, configuration }) => ({ releaseSha256, itemId, scope, configuration })), skips: [] });
  if (resolution.status !== 'ok') return { ...resolution, originalBytes: savedPolicyBytes.slice() };
  for (const root of intent.roots) {
    const closure = resolution.value.inclusions.filter(i => rootKey(i.root) === rootKey(root));
    const unavailable = closure.filter(i => changedSource(i.item));
    const exclusions = missingExclusions.filter(e => root.originIds.includes(e.originId));
    const origins = missingOrigins.filter(o => root.originIds.includes(o.id));
    const oldEntry = previous.items.get(pinKey(root)).entry;
    const updates = candidateInventories.filter(e => e.release.sha256 !== root.releaseSha256 && e.release.package.name === oldEntry.release.package.name
      && (oldEntry.input ? e.input?.kind === oldEntry.input.kind && stable(e.input?.locator) === stable(oldEntry.input.locator) : !e.input)).flatMap(e => e.release.items.filter(i => i.id === root.itemId).map(i => ({ releaseSha256: e.release.sha256, itemId: i.id, itemSha256: i.itemSha256, scope: root.scope })));
    if (unavailable.length || exclusions.length || origins.length || updates.length) {
      affectedRoots.push(root);
      choices.push({ root, reason: unavailable.length || exclusions.length || origins.length ? 'source-unavailable' : 'source-changed', candidates: updates, options: ['keep-exact', 'remove', ...(updates.length ? ['accept-candidate'] : [])], affectedItems: [...unavailable.map(i => i.item), ...exclusions], affectedOrigins: origins });
    } else retainedRoots.push(root);
  }
  for (const exclusion of missingExclusions) if (!intent.roots.some(root => root.originIds.includes(exclusion.originId))) choices.push({ exclusion, reason: 'source-unavailable', options: ['keep-exact', 'remove-exclusion'] });
  for (const origin of missingOrigins) if (!intent.roots.some(root => root.originIds.includes(origin.id))) choices.push({ origin, reason: 'source-unavailable', options: ['keep-exact', 'remove-origin'] });
  return { ...ok({ status: choices.length ? 'needs-decisions' : 'unchanged', affectedRoots, retainedRoots, choices }), originalBytes: savedPolicyBytes.slice() };
}
export async function composeAuthoring({ basePolicyBytes, intent, inventories }) {
  if (intent && new TextEncoder().encode(JSON.stringify(intent)).length > 850_000) return refuse('POLICY_BOUND_EXCEEDED', '/metadata/aih.workbench', 'Intent exceeds 850,000 UTF-8 bytes; reduce selected state.', basePolicyBytes);
  if (!checkIntentShape(intent)) return refuse('FIELD_SEMANTICS_UNSUPPORTED', '/metadata/aih.workbench', 'Malformed or unknown authoring semantics.', basePolicyBytes);
  let base;
  if (basePolicyBytes) {
    const original = await readAuthoring({ policyBytes: basePolicyBytes, inventories });
    if (original.status === 'refused') return original;
    if (original.value.editing !== 'available') return { status: 'refused', diagnostics: original.value.diagnostics, originalBytes: basePolicyBytes.slice() };
    base = original.value.policy;
    if (stable(intent.reviews) !== stable(original.value.intent.reviews)) return refuse('REVIEW_BINDING_UNAVAILABLE', '/reviews', 'Review records are preserved here; new decisions require the evidence review workflow.', basePolicyBytes);
  }
  if (intent?.reviews?.records?.some(record => record.state === 'current')) return refuse('REVIEW_BINDING_UNAVAILABLE', '/reviews/records', 'A checked observation binding is required for a current reusable decision.', basePolicyBytes);
  const result = await build({ intent, inventories, base, capture: true });
  return result.status === 'refused' && basePolicyBytes ? { ...result, originalBytes: basePolicyBytes.slice() } : result;
}
// Use Core's public identity semantics for exact supplied recipe snapshots.
// This describes content, not human approval or observation custody.
export async function describeAuthoringSubject({ inventory, itemId }) {
  const item = listItems(inventory.release).find(item => item.id === itemId);
  if (!item) return refuse('SOURCE_REVISION_UNAVAILABLE', '/itemId', 'Exact item unavailable.');
  const configured = configureItem({ release: inventory.release, itemId, configuration: {}, materialSource: inventory.materialSource });
  if (!configured.valid) return refuse('INPUT_INVALID', '/itemId', 'Catalog refused recipe configuration.', undefined, { owner: 'catalog', diagnostics: configured.diagnostics });
  const recipeBytes = inventory.materials?.find(material => material.path === item.recipe.path)?.bytes;
  if (!recipeBytes) return refuse('SOURCE_REVISION_UNAVAILABLE', '/recipeBytes', 'Exact recipe bytes are required for identity derivation.');
  const identity = await deriveRecipeIdentity({ recipeBytes, reference: configured.selection.recipe.reference });
  if (identity.status !== 'ok') return identity;
  return ok({ releaseSha256: inventory.release.sha256, itemId, itemSha256: item.itemSha256, recipeIdentity: identity.value.recipeIdentity, materials: identity.value.materials });
}
export async function editAuthoring({ policyBytes, inventories, operation }) {
  const original = await readAuthoring({ policyBytes, inventories });
  if (original.status !== 'ok') return original;
  if (original.value.editing !== 'available') return { status: 'refused', diagnostics: original.value.diagnostics, originalBytes: policyBytes.slice() };
  const intent = structuredClone(original.value.intent), before = intent.roots;
  const add = root => {
    const prior = intent.roots.find(r => rootKey(r) === rootKey(root));
    if (prior && stable(prior.configuration) !== stable(root.configuration)) throw new Error('Conflicting root configuration.');
    if (prior) prior.originIds = [...new Set([...prior.originIds, ...root.originIds])].sort();
    else intent.roots.push(structuredClone(root));
  };
  try {
    if (operation.type === 'select') {
      if (!intent.origins.some(o => o.id === 'direct')) intent.origins.push({ id: 'direct', kind: 'direct' });
      const prior = intent.roots.find(r => rootKey(r) === rootKey(operation.root));
      if (prior?.originIds.length === 1 && prior.originIds[0] === 'direct') prior.configuration = structuredClone(operation.root.configuration);
      add({ ...operation.root, originIds: ['direct'] });
    } else if (operation.type === 'template') {
      const entry = inventories.find(e => e.release.sha256 === operation.releaseSha256), template = entry?.templates?.find(t => t.id === operation.templateId && t.sha256 === operation.templateSha256);
      if (!template) return refuse('ORIGIN_UNAVAILABLE', '/operation', 'Exact template unavailable.', policyBytes);
      if (intent.origins.some(o => o.id === operation.originId)) throw new Error('Duplicate origin id.');
      intent.origins.push({ id: operation.originId, kind: 'template', releaseSha256: entry.release.sha256, templateId: template.id, templateSha256: template.sha256 });
      for (const root of template.roots) add({ ...root, originIds: [operation.originId] });
    } else if (operation.type === 'remove-origin') {
      intent.roots = before.map(r => ({ ...r, originIds: r.originIds.filter(id => id !== operation.originId) })).filter(r => r.originIds.length);
      intent.exclusions = intent.exclusions.filter(e => e.originId !== operation.originId);
      intent.origins = intent.origins.filter(o => o.id !== operation.originId);
    } else if (operation.type === 'remove-root') intent.roots = before.filter(r => rootKey(r) !== rootKey(operation.root));
    else if (operation.type === 'skip') intent.exclusions.push(operation.exclusion);
    else if (operation.type === 'unskip') intent.exclusions = intent.exclusions.filter(e => stable(e) !== stable(operation.exclusion));
    else return refuse('INPUT_INVALID', '/operation', 'Unsupported edit operation.', policyBytes);
    for (const ref of operation.keep ?? []) {
      const pin = intent.pins.find(p => pinKey(p) === pinKey(ref));
      const selection = original.value.policy.selections.find(s => s.scope === ref.scope && s.recipe.reference?.sha256 === pin?.recipe.sha256);
      if (!pin || !selection) throw new Error('Keep requires an exact previously selected item and scope.');
      if (!intent.origins.some(o => o.id === 'direct')) intent.origins.push({ id: 'direct', kind: 'direct' });
      add({ ...ref, itemSha256: pin.itemSha256, configuration: selection.configuration, originIds: ['direct'] });
    }
  } catch (error) { return refuse('INTENT_POLICY_CONTRADICTION', '/operation', error.message, policyBytes); }
  return composeAuthoring({ basePolicyBytes: policyBytes, intent, inventories });
}
