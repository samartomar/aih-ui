// Supported consumer boundary. No host acquisition or execution authority.
import { parsePolicy, deriveRecipeIdentity } from '@aihq/core/contracts';
import { isCheckedRelease, listItems, configureItem, resolveSelections, validateSelectionSet } from '@aihq/catalog/reader';
import { checkIntentShape, rootKey, pinKey } from './intent-shape.mjs';
import { migrateIntent } from './migrate-intent.mjs';
import { inspectReviewEvidence, compareReviewBindings, reviewDiagnostics } from './review-bindings.mjs';
import { checkReview } from './intent-shape.mjs';
import { readJourneyEnvelope, writeJourneyEnvelope, projectJourneyEnvelope, isJourneyEnvelope, DRAFT_RECORD_SCHEMA, JOURNEY_RECORD_KINDS } from './journey.mjs';
export { inspectReviewEvidence, compareReviewBindings } from './review-bindings.mjs';
export const AUTHORING_SCHEMA = 'urn:aihq:workbench:saved-intent:3.0.0';
export const REVIEW_SCHEMA = 'urn:aihq:workbench:review-decisions:1.0.0';
export const stable = value => JSON.stringify(value, (_key, member) => member && typeof member === 'object' && !Array.isArray(member)
  ? Object.fromEntries(Object.entries(member).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : member);
export const ok = value => ({ status: 'ok', value, diagnostics: [] });
export const refuse = (code, path, message, originalBytes, details) => ({ status: 'refused', diagnostics: [{ code, path, message, ...(details ? { details } : {}) }], ...(originalBytes ? { originalBytes: originalBytes.slice() } : {}) });
// The id ordinary Enterprise composition gives an item at a scope; also names an organization entry that is never composed.
export const managementIdOf = ({ scope, packageName, itemId }) => `${scope}--${packageName.replace(/^@/, '').replaceAll('/', '.')}--${itemId}`;
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
  if (intent?.reviews?.schema && intent.reviews.schema !== REVIEW_SCHEMA) return refuse('INTENT_VERSION_UNSUPPORTED', '/metadata/aih.workbench/reviews/schema', 'Unsupported review document version.');
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
    // An organization's root provenance identifies that exact selection only.
    // Dependencies retain their own prior/default admission identities.
    const organizationIds = new Set(intent.roots.filter(r => rootKey(r) === rootKey({ ...selection.item, scope: selection.scope }))
      .flatMap(r => r.originIds)
      .map(id => intent.origins.find(o => o.id === id)).filter(o => o?.kind === 'organization').map(o => o.organizationSelectionId));
    if (organizationIds.size > 1) return refuse('INTENT_POLICY_CONTRADICTION', '/origins', 'Conflicting organization selection identities.');
    const managementId = prior?.managementId ?? managementIdOf({ scope: selection.scope, packageName: entry.release.package.name, itemId: item.id });
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
export async function readAuthoring({ policyBytes, inventories, reviewEvidence = [], comparisons = [] }) {
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
  // Only availability of exact recorded sources can leave the choices intact but
  // unresolved. Identity mismatches and unsupported semantics fall through as before.
  if (checkIntentShape(intent) && (!intent.reviews?.schema || intent.reviews.schema === REVIEW_SCHEMA)) {
    let analysis;
    try { analysis = analyzeDraft({ intent, policy, inventories, live: false }); } catch { /* invalid inventories are reported by build */ }
    const note = migration ? { migration: { from: policy.metadata['aih.workbench'].schema, to: AUTHORING_SCHEMA } } : {};
    if (analysis?.mismatches.length) return ok({ policy, intent, editing: 'unavailable', originalBytes, diagnostics: analysis.mismatches, ...note });
    if (analysis?.unresolved.length) {
      const diagnostics = availabilityDiagnostics(analysis.unresolved), scope = availableReviewScope({ intent, inventories, comparisons });
      diagnostics.push(...await reviewDiagnostics({ intent: scope.intent, inventories, reviewEvidence, comparisons: scope.comparisons }));
      const review = diagnostics.some(d => !['SOURCE_REVISION_UNAVAILABLE', 'ORIGIN_UNAVAILABLE'].includes(d.code));
      return ok({ policy, intent, editing: review ? 'unavailable' : 'unresolved', originalBytes, diagnostics,
        ...(review ? {} : { unresolved: analysis.unresolved, roots: analysis.roots }), ...note });
    }
  }
  const rebuilt = await build({ intent, inventories, base: policy, capture: migration?.capture === true, historicalV2: migration?.historicalV2 === true });
  const diagnostics = rebuilt.status === 'refused' ? rebuilt.diagnostics : stable(projected(rebuilt.value.policy.selections)) !== stable(projected(policy.selections))
    ? [{ code: 'INTENT_POLICY_CONTRADICTION', path: '/selections', message: 'Intent contradicts executable selections.' }] : [];
  if (!diagnostics.length) diagnostics.push(...await reviewDiagnostics({ intent, inventories, reviewEvidence, comparisons }));
  return ok({ policy, intent: rebuilt.status === 'ok' ? rebuilt.value.intent : intent, editing: diagnostics.length ? 'unavailable' : 'available', originalBytes, diagnostics,
    ...(rebuilt.status === 'ok' ? { inclusions: rebuilt.value.inclusions, optional: rebuilt.value.optional } : {}),
    ...(migration ? { migration: { from: policy.metadata['aih.workbench'].schema, to: AUTHORING_SCHEMA } } : {}) });
}
export async function reconcileAuthoring({ savedPolicyBytes, inventories, candidateInventories, reviewEvidence = [], comparisons = [] }) {
  const read = await readAuthoring({ policyBytes: savedPolicyBytes, inventories, reviewEvidence, comparisons });
  if (read.status === 'refused') return read;
  if (read.value.editing !== 'available') return { status: 'refused', diagnostics: refusalDiagnostics(read.value), originalBytes: savedPolicyBytes.slice() };
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
export async function composeAuthoring(options) { return composeReviewed(options); }
async function composeReviewed({ basePolicyBytes, intent, inventories, reviewEvidence = [], comparisons = [] }, reviewTransition = false) {
  if (intent && new TextEncoder().encode(JSON.stringify(intent)).length > 850_000) return refuse('POLICY_BOUND_EXCEEDED', '/metadata/aih.workbench', 'Intent exceeds 850,000 UTF-8 bytes; reduce selected state.', basePolicyBytes);
  if (intent?.reviews?.schema && intent.reviews.schema !== REVIEW_SCHEMA) return refuse('INTENT_VERSION_UNSUPPORTED', '/metadata/aih.workbench/reviews/schema', 'Unsupported review document version.', basePolicyBytes);
  if (!checkIntentShape(intent)) return refuse('FIELD_SEMANTICS_UNSUPPORTED', '/metadata/aih.workbench', 'Malformed or unknown authoring semantics.', basePolicyBytes);
  let base;
  if (basePolicyBytes) {
    let original = await readAuthoring({ policyBytes: basePolicyBytes, inventories, reviewEvidence, comparisons });
    // A comparison may name the proposed new release. Validate the original
    // against its own still-selected subject before evaluating the candidate.
    if (original.status === 'ok' && original.value.editing !== 'available' && comparisons.length) {
      const prior = await readAuthoring({ policyBytes: basePolicyBytes, inventories, reviewEvidence });
      if (prior.status === 'ok' && prior.value.editing === 'available') original = prior;
    }
    if (original.status === 'refused') return original;
    if (original.value.editing !== 'available' && !(reviewTransition && original.value.diagnostics.every(d => ['REVIEW_BINDING_UNAVAILABLE', 'REVIEW_RECONSIDER_REQUIRED'].includes(d.code)))) return { status: 'refused', diagnostics: refusalDiagnostics(original.value), originalBytes: basePolicyBytes.slice() };
    base = original.value.policy;
    if (!reviewTransition && stable(intent.reviews) !== stable(original.value.intent.reviews)) return refuse('REVIEW_BINDING_UNAVAILABLE', '/reviews', 'Use the checked evidence review workflow to change decisions.', basePolicyBytes);
  }
  return buildReviewed({ intent, inventories, base, originalBytes: basePolicyBytes, reviewEvidence, comparisons, reviewTransition });
}
async function buildReviewed({ intent, inventories, base, originalBytes, reviewEvidence, comparisons, reviewTransition = false }) {
  let result = await build({ intent, inventories, base, capture: true });
  if (result.status === 'ok') {
    const compared = await compareReviewBindings({ intent: result.value.intent, inventories, reviewEvidence, comparisons });
    if (compared.status !== 'ok') return { ...compared, ...(originalBytes ? { originalBytes: originalBytes.slice() } : {}) };
    const changed = compared.value.filter(comparison => comparison.state === 'changed');
    if (changed.length && base && !reviewTransition) {
      const reconsidered = structuredClone(result.value.intent);
      preserveReconsideration(reconsidered.reviews, changed);
      result = await build({ intent: reconsidered, inventories, base, capture: true });
    } else if (compared.value.some(comparison => comparison.state !== 'unchanged')) return { status: 'refused', diagnostics: await reviewDiagnostics({ intent: result.value.intent, inventories, reviewEvidence, comparisons }), ...(originalBytes ? { originalBytes: originalBytes.slice() } : {}) };
  }
  // A changed subject can coexist with an unavailable binding on another
  // record. Revalidate every surviving current decision after rebuilding.
  if (result.status === 'ok') {
    const diagnostics = await reviewDiagnostics({ intent: result.value.intent, inventories, reviewEvidence, comparisons });
    if (diagnostics.length) return { status: 'refused', diagnostics, ...(originalBytes ? { originalBytes: originalBytes.slice() } : {}) };
  }
  return result.status === 'refused' && originalBytes ? { ...result, originalBytes: originalBytes.slice() } : result;
}
// Use Core's public identity semantics for exact supplied recipe snapshots.
// This describes content, not human approval or observation custody.
export async function describeAuthoringSubject({ inventory, itemId }) {
  if (!inventory || !isCheckedRelease(inventory.release)) return refuse('SOURCE_IDENTITY_MISMATCH', '/inventory', 'Supply an actual checked Catalog reader value.');
  const item = listItems(inventory.release).find(item => item.id === itemId);
  if (!item) return refuse('SOURCE_REVISION_UNAVAILABLE', '/itemId', 'Exact item unavailable.');
  const recipeBytes = inventory.materials?.find(material => material.path === item.recipe.path)?.bytes;
  if (!recipeBytes) return refuse('SOURCE_REVISION_UNAVAILABLE', '/recipeBytes', 'Exact recipe bytes are required for identity derivation.');
  // Identity describes the checked recipe declaration, independent of the
  // authored values for its required inputs. Core validates this public shape.
  const reference = { source: inventory.materialSource, path: item.recipe.path, sha256: item.recipe.sha256, byteLength: item.recipe.byteLength,
    materials: item.materials.map(({ id, path, sha256, byteLength }) => ({ id, path, sha256, byteLength })) };
  const identity = await deriveRecipeIdentity({ recipeBytes, reference });
  if (identity.status !== 'ok') return identity;
  return ok({ releaseSha256: inventory.release.sha256, itemId, itemSha256: item.itemSha256, recipeIdentity: identity.value.recipeIdentity, materials: identity.value.materials });
}
export async function editAuthoring({ policyBytes, inventories, operation, reviewEvidence = [], comparisons = [] }) {
  const original = await readAuthoring({ policyBytes, inventories, reviewEvidence, comparisons });
  if (original.status !== 'ok') return original;
  if (original.value.editing !== 'available') return { status: 'refused', diagnostics: refusalDiagnostics(original.value), originalBytes: policyBytes.slice() };
  // An omitted hash is filled from the checked inventory; a supplied one is verified by composition.
  if (operation?.type === 'select' && operation.root && operation.root.itemSha256 === undefined) {
    const item = inventories.find(e => e.release.sha256 === operation.root.releaseSha256)?.release.items.find(i => i.id === operation.root.itemId);
    if (item) operation = { ...operation, root: { ...operation.root, itemSha256: item.itemSha256 } };
  }
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
  return composeAuthoring({ basePolicyBytes: policyBytes, intent, inventories, reviewEvidence, comparisons });
}

// These are the only mutation paths for reviews on an existing document.
// Portable human records describe a decision; they do not authenticate a person.
export async function recordReview({ policyBytes, inventories, evidenceBytes, target, finding, decision, reviewEvidence = [], comparisons = [] }) {
  if (!Array.isArray(reviewEvidence) || reviewEvidence.length > 32 || reviewEvidence.some(bytes => !(bytes instanceof Uint8Array))) return refuse('REVIEW_BINDING_UNAVAILABLE', '/reviewEvidence', 'Supply at most 32 original evidence byte arrays.', policyBytes);
  const read = await readAuthoring({ policyBytes, inventories, reviewEvidence, comparisons });
  if (read.status !== 'ok') return read;
  if (read.value.diagnostics.some(d => !['REVIEW_BINDING_UNAVAILABLE', 'REVIEW_RECONSIDER_REQUIRED'].includes(d.code))) return { status: 'refused', diagnostics: read.value.diagnostics, originalBytes: policyBytes.slice() };
  const intent = structuredClone(read.value.intent), inventory = inventories.find(entry => entry.release.sha256 === target?.releaseSha256);
  if (!inventory || !intent.pins.some(pin => pin.releaseSha256 === target.releaseSha256 && pin.itemId === target.itemId)) return refuse('REVIEW_BINDING_UNAVAILABLE', '/target', 'Review target must be an exact selected item.', policyBytes);
  const inspected = await inspectReviewEvidence({ evidenceBytes, inventory, itemId: target.itemId });
  const binding = inspected.status === 'ok' ? inspected.value.bindings.find(binding => stable(binding.finding) === stable(finding)) : undefined;
  if (!binding) return refuse('REVIEW_BINDING_UNAVAILABLE', '/finding', 'Checked report cannot establish the complete subject/finding/evidence binding.', policyBytes);
  if (!decision || Object.keys(decision).some(key => !['id', 'owner', 'actor', 'recordedAt', 'disposition', 'reason', 'supersedes'].includes(key))) return refuse('FIELD_SEMANTICS_UNSUPPORTED', '/decision', 'Supply supported review fields only.', policyBytes);
  if (decision.supersedes) {
    const prior = intent.reviews.records.find(record => record.id === decision.supersedes);
    if (prior) { intent.reviews.records = intent.reviews.records.filter(record => record !== prior); intent.reviews.history.push(prior); }
  }
  intent.reviews.records.push({ ...structuredClone(decision), subject: inspected.value.subject, finding: binding.finding, evidence: binding.evidence, state: 'current' });
  if (!checkReview(intent.reviews)) return refuse('FIELD_SEMANTICS_UNSUPPORTED', '/decision', 'Invalid review fields, identity, UTC timestamp or supersession.', policyBytes);
  const otherEvidence = reviewEvidence.filter(bytes => bytes.length !== evidenceBytes.length || bytes.some((byte, index) => byte !== evidenceBytes[index]));
  return composeReviewed({ basePolicyBytes: policyBytes, intent, inventories, reviewEvidence: [evidenceBytes, ...otherEvidence], comparisons }, true);
}

function preserveReconsideration(reviews, changed) {
  for (const comparison of changed) {
    const record = reviews.records.find(record => record.id === comparison.recordId);
    reviews.records = reviews.records.filter(value => value !== record);
    reviews.history.push(record);
    let ordinal = 1;
    while ([...reviews.records, ...reviews.history].some(record => record.id === `reconsider-${ordinal}`)) ordinal++;
    reviews.records.push({ ...record, id: `reconsider-${ordinal}`, state: 'reconsider', supersedes: record.id });
  }
}
export async function reconsiderReviews({ policyBytes, inventories, reviewEvidence = [], comparisons = [] }) {
  const read = await readAuthoring({ policyBytes, inventories, reviewEvidence, comparisons });
  if (read.status !== 'ok') return read;
  if (read.value.diagnostics.some(d => !['REVIEW_BINDING_UNAVAILABLE', 'REVIEW_RECONSIDER_REQUIRED'].includes(d.code))) return { status: 'refused', diagnostics: read.value.diagnostics, originalBytes: policyBytes.slice() };
  const intent = structuredClone(read.value.intent);
  const compared = await compareReviewBindings({ intent, inventories, reviewEvidence, comparisons });
  if (compared.status !== 'ok') return { ...compared, originalBytes: policyBytes.slice() };
  preserveReconsideration(intent.reviews, compared.value.filter(result => result.state !== 'unchanged'));
  const result = await composeReviewed({ basePolicyBytes: policyBytes, intent, inventories, reviewEvidence, comparisons }, true);
  return result.status === 'ok' ? { ...result, value: { ...result.value, comparisons: compared.value }, originalBytes: policyBytes.slice() } : result;
}

// ---- Unresolved drafts -------------------------------------------------------
// A draft keeps every recorded choice exactly as saved. Availability is a fact
// about the supplied inventories; no newer or candidate revision is substituted.
const rootRef = value => ({ releaseSha256: value.releaseSha256, itemId: value.itemId, scope: value.scope });
const isRef = value => !!value && typeof value === 'object' && typeof value.releaseSha256 === 'string' && typeof value.itemId === 'string' && ['project', 'user'].includes(value.scope);
const label = value => `${value.itemId} (${value.scope})`;
const describeRef = ref => `${ref.releaseSha256 ?? ''}/${ref.itemId ?? ref.templateId ?? ref.id ?? ''}`;
function refusalDiagnostics(value) {
  return value.editing === 'unresolved' ? [...value.diagnostics, { code: 'SOURCE_REVISION_UNAVAILABLE', path: '/policyBytes',
    message: 'Exact sources are unresolved, so ordinary authoring cannot produce an executable policy. Use openDraft, editDraft and compileDraft to keep, edit and compile the exact choices.' }] : value.diagnostics;
}
function availabilityDiagnostics(unresolved) {
  const paths = { root: '/roots', dependency: '/pins', origin: '/origins', exclusion: '/exclusions', input: '/inputs' };
  const what = { origin: 'template snapshot', input: 'input release' };
  const suffix = { 'revision-unavailable': ' (a different revision is supplied and is not substituted)' };
  return unresolved.map(({ kind, ref, reason }) => ({ code: kind === 'origin' ? 'ORIGIN_UNAVAILABLE' : 'SOURCE_REVISION_UNAVAILABLE', path: paths[kind],
    message: `Exact ${what[kind] ?? 'source/item'} unavailable: ${describeRef(ref)}${suffix[reason] ?? ''}` }));
}
// Current decisions on subjects whose release is not supplied cannot be compared
// and are reported through their unresolved choices, not as binding failures.
function availableReviewScope({ intent, inventories, comparisons }) {
  const supplied = new Set(inventories.map(e => e.release.sha256));
  const subject = record => (comparisons.find(c => c?.recordId === record.id)?.target ?? record.subject).releaseSha256;
  const dropped = new Set(intent.reviews.records.filter(r => r.state === 'current' && !supplied.has(subject(r))).map(r => r.id));
  if (!dropped.size) return { intent, comparisons };
  return { intent: { ...intent, reviews: { ...intent.reviews, records: intent.reviews.records.filter(r => !dropped.has(r.id)) } }, comparisons: comparisons.filter(c => !dropped.has(c?.recordId)) };
}
// Recorded dependency graph: policy selections joined to saved pins by recipe digest and scope.
function recordedGraph(policy, pins) {
  const byRecipe = new Map(), nodes = new Map(), edges = new Map(), bySelection = new Map();
  for (const pin of pins) byRecipe.set(pin.recipe.sha256, [...(byRecipe.get(pin.recipe.sha256) ?? []), pin]);
  for (const selection of policy.selections ?? []) bySelection.set(selection.id, (byRecipe.get(selection.recipe?.reference?.sha256) ?? []).map(pin => {
    const node = { releaseSha256: pin.releaseSha256, itemId: pin.itemId, itemSha256: pin.itemSha256, scope: selection.scope };
    nodes.set(rootKey(node), node);
    return rootKey(node);
  }));
  for (const selection of policy.selections ?? []) for (const from of bySelection.get(selection.id)) {
    const out = edges.get(from) ?? new Set();
    edges.set(from, out);
    for (const id of selection.requires ?? []) for (const to of bySelection.get(id) ?? []) out.add(to);
  }
  return { nodes, edges };
}
function reach(graph, start) {
  const seen = new Set([start]), queue = [start];
  while (queue.length) for (const next of graph.edges.get(queue.shift()) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  return seen;
}
// What ordinary authoring would decide about one choice: its required closure, or Catalog's refusal.
function liveClosure(index, root, skips) {
  const resolved = resolveSelections({ releases: index.releases, roots: [{ releaseSha256: root.releaseSha256, itemId: root.itemId, scope: root.scope, configuration: root.configuration }], skips });
  if (resolved.status !== 'ok') return { diagnostics: resolved.diagnostics };
  const refusal = (path, message, diagnostics) => ({ diagnostics: [{ code: 'INPUT_INVALID', path, message, details: { owner: 'catalog', diagnostics } }] });
  for (const selection of resolved.value.selections) {
    const found = index.items.get(pinKey(selection.item));
    if (!found) continue;
    const configured = configureItem({ release: found.entry.release, itemId: found.item.id, configuration: selection.configuration, materialSource: found.entry.materialSource });
    if (!configured.valid) return refusal('/roots/configuration', 'Catalog refused item configuration.', configured.diagnostics);
  }
  const validation = validateSelectionSet({ releases: index.releases, selections: resolved.value.selections });
  if (!validation.valid) return refusal('/selections', 'Catalog refused the resolved set.', validation.diagnostics);
  return { closure: new Set(resolved.value.inclusions.filter(i => rootKey(i.root) === rootKey(root)).map(i => rootKey(i.item))) };
}
// Required items of `root` that live in releases the supplied inventories do not include.
function missingRequirements(index, root) {
  const missing = new Map(), seen = new Set([pinKey(root)]), queue = [pinKey(root)];
  while (queue.length) {
    const found = index.items.get(queue.shift());
    if (!found) continue;
    for (const dependency of found.item.dependencies.requires) {
      const releaseSha256 = 'release' in dependency ? dependency.release.manifest.sha256 : found.entry.release.sha256, key = pinKey({ releaseSha256, itemId: dependency.itemId });
      if (seen.has(key)) continue;
      seen.add(key);
      if (index.items.has(key)) queue.push(key);
      else missing.set(key, { releaseSha256, itemId: dependency.itemId, ...(dependency.itemSha256 !== undefined ? { itemSha256: dependency.itemSha256 } : {}) });
    }
  }
  return [...missing.values()];
}
// Pure classification of a saved intent against supplied exact inventories.
function analyzeDraft({ intent, policy, inventories, live = true }) {
  const index = inventoryIndex(inventories), graph = recordedGraph(policy, intent.pins), entryOf = sha => inventories.find(e => e.release.sha256 === sha);
  const reasonFor = sha => {
    const name = intent.provenance.find(p => p.releaseSha256 === sha)?.package?.name, input = intent.inputs.find(i => i.releaseSha256 === sha);
    return inventories.some(e => e.release.sha256 !== sha && ((name !== undefined && e.release.package?.name === name)
      || (input && e.input && e.input.kind === input.kind && stable(e.input.locator) === stable(input.locator)))) ? 'revision-unavailable' : 'source-unavailable';
  };
  const mismatches = [], nodeEntries = new Map(), originEntries = new Map(), exclusionEntries = [], inputEntries = [], unavailableNodes = new Set(), undeterminedRoots = new Set(), resolvable = new Set(), closures = new Map(), refusals = new Map();
  const check = (value, path) => {
    const found = index.items.get(pinKey(value));
    if (found && value.itemSha256 !== undefined && found.item.itemSha256 !== value.itemSha256) mismatches.push({ code: 'SOURCE_IDENTITY_MISMATCH', path, message: 'Recorded item differs from the checked item.' });
  };
  const rootKeys = new Set(intent.roots.map(rootKey));
  const skips = intent.exclusions.filter(e => index.items.has(pinKey(e))).map(({ releaseSha256, itemId, scope }) => ({ releaseSha256, itemId, scope }));
  for (const root of intent.roots) {
    const key = rootKey(root), nodes = reach(graph, key);
    check(root, '/roots');
    let complete = true;
    for (const node of nodes) {
      const value = graph.nodes.get(node) ?? (node === key ? root : undefined);
      if (!value) continue;
      check(value, '/pins');
      if (index.items.has(pinKey(value))) continue;
      complete = false; unavailableNodes.add(node);
      if (!nodeEntries.has(node)) nodeEntries.set(node, { kind: rootKeys.has(node) ? 'root' : 'dependency',
        ref: { releaseSha256: value.releaseSha256, itemId: value.itemId, itemSha256: value.itemSha256, scope: value.scope }, reason: reasonFor(value.releaseSha256) });
    }
    // A root added after the policy was saved is not in the recorded graph, so its live closure is the
    // only evidence of what it needs. A root is never treated as resolved while that is unknown. An
    // unknown closure is an availability gap only when required content is missing from the supplied
    // inventories; any other refusal is a contradiction and keeps Catalog's own diagnostics.
    const evidence = live && complete ? liveClosure(index, root, skips) : undefined;
    if (evidence?.closure) for (const node of evidence.closure) nodes.add(node);
    else if (evidence) {
      complete = false; undeterminedRoots.add(key);
      const missing = missingRequirements(index, root);
      if (!missing.length) refusals.set(key, evidence.diagnostics);
      for (const need of missing) {
        const node = rootKey({ ...need, scope: root.scope });
        nodes.add(node); unavailableNodes.add(node);
        if (!nodeEntries.has(node)) nodeEntries.set(node, { kind: 'dependency',
          ref: { releaseSha256: need.releaseSha256, itemId: need.itemId, itemSha256: need.itemSha256, scope: root.scope }, reason: reasonFor(need.releaseSha256) });
      }
    }
    if (complete) resolvable.add(key);
    closures.set(key, nodes);
  }
  for (const origin of intent.origins) if (origin.kind === 'template') {
    const entry = entryOf(origin.releaseSha256);
    if (!entry?.templates?.some(t => t.id === origin.templateId && t.sha256 === origin.templateSha256)) originEntries.set(origin.id, { kind: 'origin',
      ref: { originId: origin.id, releaseSha256: origin.releaseSha256, templateId: origin.templateId, templateSha256: origin.templateSha256 },
      reason: entry ? 'source-unavailable' : reasonFor(origin.releaseSha256) });
  }
  for (const exclusion of intent.exclusions) if (!index.items.has(pinKey(exclusion))) exclusionEntries.push({ kind: 'exclusion',
    ref: { originId: exclusion.originId, releaseSha256: exclusion.releaseSha256, itemId: exclusion.itemId, scope: exclusion.scope }, reason: reasonFor(exclusion.releaseSha256) });
  for (const input of intent.inputs) {
    const entry = entryOf(input.releaseSha256);
    if (!entry) inputEntries.push({ kind: 'input', ref: { id: input.id, kind: input.kind, locator: input.locator, releaseSha256: input.releaseSha256 }, reason: reasonFor(input.releaseSha256) });
    else if (stable(entry.input) !== stable(input)) mismatches.push({ code: 'SOURCE_IDENTITY_MISMATCH', path: '/inputs', message: 'Acquired input identity differs from the saved snapshot.' });
  }
  const rootsWhere = test => intent.roots.filter(test).map(rootRef);
  const order = [...[...nodeEntries.keys()].filter(k => rootKeys.has(k)), ...[...nodeEntries.keys()].filter(k => !rootKeys.has(k)).sort()];
  for (const key of order) nodeEntries.get(key).dependents = rootsWhere(r => rootKey(r) !== key && closures.get(rootKey(r)).has(key));
  for (const [id, entry] of originEntries) entry.dependents = rootsWhere(r => r.originIds.includes(id));
  for (const entry of exclusionEntries) entry.dependents = rootsWhere(r => r.originIds.includes(entry.ref.originId));
  for (const entry of inputEntries) entry.dependents = rootsWhere(r => [...closures.get(rootKey(r))].some(k => k.startsWith(`${entry.ref.releaseSha256}/`)));
  const unresolved = [...order.map(k => nodeEntries.get(k)), ...originEntries.values(), ...exclusionEntries, ...inputEntries];
  const roots = intent.roots.map(root => {
    const blockers = [...[...closures.get(rootKey(root))].filter(k => nodeEntries.has(k)).map(k => nodeEntries.get(k)),
      ...root.originIds.filter(id => originEntries.has(id)).map(id => originEntries.get(id)),
      ...exclusionEntries.filter(e => root.originIds.includes(e.ref.originId))];
    const refusal = refusals.get(rootKey(root));
    if (!blockers.length && refusal) return { ...structuredClone(root), status: 'refused', refusal: { owner: 'catalog', diagnostics: structuredClone(refusal) } };
    return { ...structuredClone(root), status: blockers.length ? 'unresolved' : 'resolved',
      ...(blockers.length ? { blockedBy: blockers.map(({ kind, ref, reason }) => ({ kind, ref, reason })) } : {}) };
  });
  return { index, graph, closures, resolvable, skips, unavailableNodes, undeterminedRoots, refusals, mismatches, unresolved, roots };
}

async function loadDraft(envelopeBytes) {
  if (!(envelopeBytes instanceof Uint8Array)) return refuse('INPUT_INVALID', '/envelopeBytes', 'Supply original journey envelope bytes.');
  const read = await readJourneyEnvelope(envelopeBytes);
  if (read.status !== 'ok') return read;
  const record = read.value.records.find(r => r.schema === DRAFT_RECORD_SCHEMA);
  if (!record) return refuse('INPUT_INVALID', '/records', 'Envelope has no unresolved-draft record.', envelopeBytes);
  let parsed;
  try { parsed = parsePolicy(new TextDecoder('utf-8', { fatal: true }).decode(read.value.savedIntentBytes)); } catch { /* refused below */ }
  if (!parsed?.valid) return refuse('INPUT_INVALID', '/savedIntent', 'Core refused the saved execution policy bytes.', envelopeBytes, parsed ? { owner: 'core', diagnostics: parsed.diagnostics } : undefined);
  return { status: 'ok', value: { read: read.value, record, policy: parsed.document }, diagnostics: read.diagnostics };
}
// Compose and Core-validate an executable policy for the requested roots only.
async function compileScope({ policy, intent, inventories, analysis, roots, reviewEvidence, comparisons, originalBytes }) {
  const requested = roots ?? intent.roots.map(rootRef), keys = new Set(intent.roots.map(rootKey));
  if (!Array.isArray(requested) || requested.some(r => !isRef(r) || !keys.has(rootKey(r)))) return refuse('INPUT_INVALID', '/roots', 'Requested scope must name choices that exist in the draft.', originalBytes);
  const want = new Set(requested.map(rootKey)), whole = intent.roots.every(r => want.has(rootKey(r)));
  const refused = analysis.roots.filter(r => want.has(rootKey(r)) && r.status === 'refused');
  if (refused.length) return { status: 'refused', diagnostics: refused.flatMap(r => r.refusal.diagnostics), originalBytes: originalBytes.slice() };
  const blocked = analysis.roots.filter(r => want.has(rootKey(r)) && r.status === 'unresolved');
  const entries = whole ? analysis.unresolved : analysis.unresolved.filter(u => blocked.some(r => r.blockedBy.some(b => b.kind === u.kind && stable(b.ref) === stable(u.ref))));
  if (entries.length) return refuse('SCOPE_UNRESOLVED', '/roots', `Requested scope is unresolved: ${entries.map(u => `${u.kind} ${describeRef(u.ref)} (${u.reason})`).join('; ')}. Resolve, replace or remove it before compiling.`,
    originalBytes, { unresolved: entries, blocked: blocked.map(r => ({ root: rootRef(r), blockedBy: r.blockedBy })) });
  let scoped = structuredClone(intent);
  if (!whole) {
    const kept = intent.roots.filter(r => want.has(rootKey(r))), originIds = new Set(kept.flatMap(r => r.originIds));
    if (intent.origins.some(o => o.id === 'direct')) originIds.add('direct');
    const origins = intent.origins.filter(o => originIds.has(o.id)), exclusions = intent.exclusions.filter(e => originIds.has(e.originId));
    const pinKeys = new Set(kept.flatMap(r => [...analysis.closures.get(rootKey(r))].map(k => k.split('/').slice(0, 2).join('/'))));
    const releases = new Set([...pinKeys].map(k => k.split('/')[0]));
    for (const ref of [...exclusions, ...origins.filter(o => o.kind === 'template')]) releases.add(ref.releaseSha256);
    scoped = { ...scoped, origins, roots: structuredClone(kept), exclusions, pins: intent.pins.filter(p => pinKeys.has(pinKey(p))),
      provenance: intent.provenance.filter(p => releases.has(p.releaseSha256)), inputs: intent.inputs.filter(i => releases.has(i.releaseSha256)) };
  }
  const result = await buildReviewed({ intent: scoped, inventories, base: policy, originalBytes, reviewEvidence, comparisons });
  if (result.status !== 'ok') return result;
  const before = new Set(scoped.reviews.records.filter(r => r.state === 'reconsider').map(r => r.id));
  return ok({ policyBytes: result.value.policyBytes, intent: result.value.intent, policy: result.value.policy, scope: requested.map(rootRef),
    reviewsReconsidered: result.value.intent.reviews.records.filter(r => r.state === 'reconsider' && !before.has(r.id)).map(r => r.id) });
}
async function presentDraft({ envelopeBytes, envelope, savedIntentBytes, supported, policy, intent, inventories, reviewEvidence, comparisons, journeyDiagnostics = [], changes }) {
  let analysis;
  try { analysis = analyzeDraft({ intent, policy, inventories }); }
  catch (error) { return refuse('SOURCE_IDENTITY_MISMATCH', '/inventories', error.message, envelopeBytes); }
  if (analysis.mismatches.length) return { status: 'refused', diagnostics: analysis.mismatches, originalBytes: envelopeBytes.slice() };
  const scope = availableReviewScope({ intent, inventories, comparisons });
  const review = await reviewDiagnostics({ intent: scope.intent, inventories, reviewEvidence, comparisons: scope.comparisons });
  if (review.length) return { status: 'refused', diagnostics: review, originalBytes: envelopeBytes.slice() };
  // Unsupported required records cannot be interpreted, so nothing may be compiled from this envelope.
  const unsupported = journeyDiagnostics.filter(d => d.code === 'JOURNEY_RECORD_UNSUPPORTED');
  const compiled = supported ? await compileScope({ policy, intent, inventories, analysis, reviewEvidence, comparisons, originalBytes: envelopeBytes })
    : { status: 'refused', diagnostics: unsupported.length ? unsupported : [{ code: 'JOURNEY_RECORD_UNSUPPORTED', path: '/records', message: 'The envelope has required records this version cannot interpret; compile is unavailable.' }] };
  return ok({ envelopeBytes: envelopeBytes.slice(), envelope, projection: projectJourneyEnvelope(envelope), supported, intent, editing: analysis.unresolved.length ? 'unresolved' : 'available',
    unresolved: analysis.unresolved, roots: analysis.roots, savedIntentBytes: savedIntentBytes.slice(),
    compile: compiled.status === 'ok' ? { status: 'available' } : { status: 'refused', reasons: compiled.diagnostics },
    diagnostics: [...availabilityDiagnostics(analysis.unresolved), ...journeyDiagnostics], ...(changes ? { changes } : {}) });
}
// `bytes` is a saved policy or a journey envelope; either reopens every recorded choice.
export async function openDraft({ bytes, inventories, reviewEvidence = [], comparisons = [] } = {}) {
  if (!(bytes instanceof Uint8Array)) return refuse('INPUT_INVALID', '/bytes', 'Supply original policy or journey envelope bytes.');
  const context = { inventories, reviewEvidence, comparisons };
  if (isJourneyEnvelope(bytes)) {
    const loaded = await loadDraft(bytes);
    if (loaded.status !== 'ok') return loaded;
    const { read, record, policy } = loaded.value;
    return presentDraft({ ...context, envelopeBytes: bytes, envelope: read.envelope, savedIntentBytes: read.savedIntentBytes, supported: read.supported, policy, intent: record.intent, journeyDiagnostics: loaded.diagnostics });
  }
  const read = await readAuthoring({ policyBytes: bytes, ...context });
  if (read.status !== 'ok') return read;
  if (read.value.editing === 'unavailable') return { status: 'refused', diagnostics: read.value.diagnostics, originalBytes: bytes.slice() };
  const written = await writeJourneyEnvelope({ savedIntentBytes: bytes, records: [{ id: 'draft', schema: DRAFT_RECORD_SCHEMA, required: true, intent: read.value.intent }] });
  if (written.status !== 'ok') return { ...written, originalBytes: bytes.slice() };
  return presentDraft({ ...context, envelopeBytes: written.value.envelopeBytes, envelope: written.value.envelope, savedIntentBytes: bytes, supported: true, policy: read.value.policy, intent: read.value.intent });
}
// The only executable output of a draft. Unresolved or dependency-incorrect scopes refuse.
export async function compileDraft({ envelopeBytes, inventories, roots, reviewEvidence = [], comparisons = [] } = {}) {
  const loaded = await loadDraft(envelopeBytes);
  if (loaded.status !== 'ok') return loaded;
  const { read, record, policy } = loaded.value;
  if (!read.supported) return refuse('JOURNEY_RECORD_UNSUPPORTED', '/records', 'The envelope has required records this version cannot interpret; compile is unavailable.', envelopeBytes);
  let analysis;
  try { analysis = analyzeDraft({ intent: record.intent, policy, inventories }); }
  catch (error) { return refuse('SOURCE_IDENTITY_MISMATCH', '/inventories', error.message, envelopeBytes); }
  if (analysis.mismatches.length) return { status: 'refused', diagnostics: analysis.mismatches, originalBytes: envelopeBytes.slice() };
  return compileScope({ policy, intent: record.intent, inventories, analysis, roots, reviewEvidence, comparisons, originalBytes: envelopeBytes });
}
// Safe edits of the recorded choices; each success is a new envelope revision.
export async function editDraft({ envelopeBytes, inventories, operation, reviewEvidence = [], comparisons = [] } = {}) {
  const loaded = await loadDraft(envelopeBytes);
  if (loaded.status !== 'ok') return loaded;
  const { read, record, policy } = loaded.value;
  const fail = (code, path, message, details) => refuse(code, path, message, envelopeBytes, details);
  const unchanged = refusal => ({ ...refusal, originalBytes: envelopeBytes.slice() });
  if (!read.supported) return fail('JOURNEY_RECORD_UNSUPPORTED', '/records', 'The envelope has required records this version cannot change; it is read-only.');
  if (!operation || typeof operation !== 'object') return fail('INPUT_INVALID', '/operation', 'Supply an edit operation.');
  let before;
  try { before = analyzeDraft({ intent: record.intent, policy, inventories }); }
  catch (error) { return fail('SOURCE_IDENTITY_MISMATCH', '/inventories', error.message); }
  if (before.mismatches.length) return unchanged({ status: 'refused', diagnostics: before.mismatches });
  const { index } = before, intent = structuredClone(record.intent);
  const changes = { removedRoots: [], removedOrigins: [], removedExclusions: [], addedRoots: [], removedPins: [], reviewsReconsidered: [] };
  const closureOf = root => before.closures.get(rootKey(root)) ?? reach(before.graph, rootKey(root));
  const dependentsOf = (key, retained) => retained.filter(r => rootKey(r) !== key && closureOf(r).has(key));
  const required = (target, dependents) => fail('DEPENDENCY_RETAINED', '/operation/root',
    `Cannot remove ${label(target)}: it is still required by ${dependents.map(label).join(', ')}. Remove or replace those choices first.`,
    { target: rootRef(target), dependents: dependents.map(rootRef) });
  const pruneOrigin = id => {
    changes.removedExclusions.push(...intent.exclusions.filter(e => e.originId === id));
    intent.exclusions = intent.exclusions.filter(e => e.originId !== id);
    intent.origins = intent.origins.filter(o => o.id !== id);
    changes.removedOrigins.push(id);
  };
  const directOrigin = () => { if (!intent.origins.some(o => o.id === 'direct')) intent.origins.push({ id: 'direct', kind: 'direct' }); };
  const mergeRoot = root => {
    const prior = intent.roots.find(r => rootKey(r) === rootKey(root));
    if (prior && stable(prior.configuration) !== stable(root.configuration)) throw new Error('Conflicting root configuration.');
    if (prior) prior.originIds = [...new Set([...prior.originIds, ...root.originIds])].sort();
    else intent.roots.push(structuredClone(root));
  };
  // The item must come from a supplied checked inventory and resolve with its dependencies.
  const checkResolvable = root => {
    const found = index.items.get(pinKey(root));
    if (!found) return fail('SOURCE_REVISION_UNAVAILABLE', '/operation/root', `Exact source/item unavailable in the supplied inventories: ${pinKey(root)}`);
    if (root.itemSha256 !== undefined && root.itemSha256 !== found.item.itemSha256) return fail('SOURCE_IDENTITY_MISMATCH', '/operation/root/itemSha256', 'Supplied item identity differs from the checked item.');
    const resolution = resolveSelections({ releases: index.releases, roots: [{ releaseSha256: root.releaseSha256, itemId: root.itemId, scope: root.scope, configuration: root.configuration }], skips: before.skips });
    if (resolution.status !== 'ok') return unchanged(resolution);
    const configured = configureItem({ release: found.entry.release, itemId: found.item.id, configuration: root.configuration, materialSource: found.entry.materialSource });
    if (!configured.valid) return fail('INPUT_INVALID', '/operation/root/configuration', 'Catalog refused item configuration.', { owner: 'catalog', diagnostics: configured.diagnostics });
    return { found };
  };
  const draftRoot = (value, prior) => ({ releaseSha256: value.releaseSha256, itemId: value.itemId, itemSha256: index.items.get(pinKey(value)).item.itemSha256, scope: value.scope,
    configuration: structuredClone(value.configuration ?? {}), originIds: prior?.originIds ?? ['direct'], ...(prior?.reason !== undefined ? { reason: prior.reason } : {}) });
  try {
    if (operation.type === 'remove-root') {
      if (!isRef(operation.root)) return fail('INPUT_INVALID', '/operation/root', 'Supply {releaseSha256,itemId,scope}.');
      const target = operation.root, key = rootKey(target), found = intent.roots.find(r => rootKey(r) === key), retained = intent.roots.filter(r => r !== found);
      const dependents = dependentsOf(key, retained);
      if (!found) return dependents.length ? required(target, dependents) : fail('INPUT_INVALID', '/operation/root', 'That item is not a choice in this draft.');
      // A resolvable root that is also a dependency is simply no longer a direct choice, as in ordinary
      // authoring. An unavailable one would silently remain as an unresolved requirement, so it is refused.
      if (before.unavailableNodes.has(key) && dependents.length) return required(target, dependents);
      intent.roots = retained; changes.removedRoots.push(rootRef(found));
      for (const id of found.originIds) if (id !== 'direct' && !retained.some(r => r.originIds.includes(id))) pruneOrigin(id);
    } else if (operation.type === 'remove-origin') {
      const id = operation.originId;
      if (!intent.origins.some(o => o.id === id)) return fail('INPUT_INVALID', '/operation/originId', 'Origin is not recorded in this draft.');
      const dropped = intent.roots.filter(r => r.originIds.every(origin => origin === id));
      intent.roots = intent.roots.map(r => ({ ...r, originIds: r.originIds.filter(origin => origin !== id) })).filter(r => r.originIds.length);
      changes.removedRoots.push(...dropped.map(rootRef));
      pruneOrigin(id);
      for (const keep of operation.keep ?? []) {
        const pin = intent.pins.find(p => pinKey(p) === pinKey(keep));
        const selection = policy.selections.find(s => s.scope === keep.scope && s.recipe?.reference?.sha256 === pin?.recipe.sha256);
        if (!pin || !selection) throw new Error('Keep requires an exact previously selected item and scope.');
        directOrigin();
        mergeRoot({ releaseSha256: keep.releaseSha256, itemId: keep.itemId, scope: keep.scope, itemSha256: pin.itemSha256, configuration: selection.configuration, originIds: ['direct'] });
      }
      for (const root of dropped) {
        const key = rootKey(root), dependents = dependentsOf(key, intent.roots);
        if (before.unavailableNodes.has(key) && dependents.length && !intent.roots.some(r => rootKey(r) === key)) return required(root, dependents);
      }
    } else if (operation.type === 'select') {
      if (!isRef(operation.root) || (operation.root.configuration !== undefined && (typeof operation.root.configuration !== 'object' || operation.root.configuration === null || Array.isArray(operation.root.configuration))))
        return fail('INPUT_INVALID', '/operation/root', 'Supply {releaseSha256,itemId,scope,configuration?}.');
      const checked = checkResolvable({ ...operation.root, configuration: operation.root.configuration ?? {} });
      if (!checked.found) return checked;
      directOrigin();
      const root = draftRoot(operation.root), prior = intent.roots.find(r => rootKey(r) === rootKey(root));
      if (prior?.originIds.length === 1 && prior.originIds[0] === 'direct') prior.configuration = structuredClone(root.configuration);
      mergeRoot(root);
      if (!prior) changes.addedRoots.push(rootRef(root));
    } else if (operation.type === 'replace') {
      const replacement = operation.replacement;
      if (!isRef(operation.root) || !replacement || typeof replacement.releaseSha256 !== 'string' || typeof replacement.itemId !== 'string') return fail('INPUT_INVALID', '/operation', 'Supply {root,replacement:{releaseSha256,itemId}}.');
      const prior = intent.roots.find(r => rootKey(r) === rootKey(operation.root));
      if (!prior) return fail('INPUT_INVALID', '/operation/root', 'That item is not a choice in this draft.');
      const target = { releaseSha256: replacement.releaseSha256, itemId: replacement.itemId, scope: prior.scope, configuration: prior.configuration };
      const checked = checkResolvable(target);
      if (!checked.found) return checked;
      intent.roots = intent.roots.filter(r => r !== prior);
      mergeRoot(draftRoot(target, prior));
      changes.removedRoots.push(rootRef(prior)); changes.addedRoots.push(rootRef(target));
      for (const id of prior.originIds) if (id !== 'direct' && !intent.roots.some(r => r.originIds.includes(id))) pruneOrigin(id);
    } else if (operation.type === 'skip' || operation.type === 'unskip') {
      const exclusion = operation.exclusion;
      if (!isRef(exclusion) || typeof exclusion.originId !== 'string' || (exclusion.reason !== undefined && typeof exclusion.reason !== 'string')) return fail('INPUT_INVALID', '/operation/exclusion', 'Supply {originId,releaseSha256,itemId,scope,reason?}.');
      if (!intent.origins.some(o => o.id === exclusion.originId)) return fail('INPUT_INVALID', '/operation/exclusion/originId', 'Origin is not recorded in this draft.');
      const at = intent.exclusions.findIndex(e => e.originId === exclusion.originId && rootKey(e) === rootKey(exclusion));
      if (operation.type === 'skip') {
        if (!index.items.has(pinKey(exclusion))) return fail('SOURCE_REVISION_UNAVAILABLE', '/operation/exclusion', 'Optionality cannot be checked for unavailable content; supply the exact inventory that declares it.');
        if (at >= 0) return fail('INPUT_INVALID', '/operation/exclusion', 'That skip is already recorded.');
        intent.exclusions.push({ originId: exclusion.originId, releaseSha256: exclusion.releaseSha256, itemId: exclusion.itemId, scope: exclusion.scope, ...(exclusion.reason !== undefined ? { reason: exclusion.reason } : {}) });
      } else {
        // Removing a recorded skip needs no availability check: it only stops suppressing a suggestion.
        if (at < 0) return fail('INPUT_INVALID', '/operation/exclusion', 'That skip is not recorded in this draft.');
        changes.removedExclusions.push(intent.exclusions[at]); intent.exclusions.splice(at, 1);
      }
    } else return fail('INPUT_INVALID', '/operation', 'Unsupported draft operation.');
  } catch (error) { return fail('INTENT_POLICY_CONTRADICTION', '/operation', error.message); }
  // Re-analyse the edited choices with the recorded pins still in place, then prune.
  let after;
  try { after = analyzeDraft({ intent, policy, inventories }); }
  catch (error) { return fail('SOURCE_IDENTITY_MISMATCH', '/inventories', error.message); }
  // Availability gaps stay editable; a contradiction on content that is fully supplied is refused as ordinary authoring would.
  // An already refused choice stays fixable, but must not take on a further diagnostic.
  const priorDiagnostics = r => new Set((before.refusals.get(rootKey(r)) ?? []).map(stable));
  const introduced = intent.roots.filter(r => (after.refusals.get(rootKey(r)) ?? []).some(d => !priorDiagnostics(r).has(stable(d))));
  if (introduced.length) return unchanged({ status: 'refused', diagnostics: introduced.flatMap(r => after.refusals.get(rootKey(r))) });
  const resolveAvailableRoots = (analysis, value) => resolveSelections({ releases: index.releases, skips: analysis.skips,
    roots: value.roots.filter(r => analysis.resolvable.has(rootKey(r))).map(({ releaseSha256, itemId, scope, configuration }) => ({ releaseSha256, itemId, scope, configuration })) });
  const settled = resolveAvailableRoots(after, intent);
  if (settled.status !== 'ok' && resolveAvailableRoots(before, record.intent).status === 'ok') return unchanged(settled);
  const reached = new Set(intent.roots.flatMap(r => [...after.closures.get(rootKey(r))].map(k => k.split('/').slice(0, 2).join('/'))));
  // While any choice's required closure is undetermined, nothing recorded can be known to be unneeded
  // (an item behind a missing one is invisible), so every recorded pin is retained until it resolves again.
  if (after.undeterminedRoots.size) for (const pin of record.intent.pins) reached.add(pinKey(pin));
  const pins = [...reached].flatMap(key => {
    const existing = record.intent.pins.find(p => pinKey(p) === key), found = index.items.get(key);
    return existing ? [existing] : found ? [{ releaseSha256: found.entry.release.sha256, itemId: found.item.id, itemSha256: found.item.itemSha256, recipe: found.item.recipe, materials: found.item.materials }] : [];
  });
  const releases = new Set([...pins.map(p => p.releaseSha256), ...intent.exclusions.map(e => e.releaseSha256), ...intent.origins.filter(o => o.kind === 'template').map(o => o.releaseSha256)]);
  const entryOf = sha => inventories.find(e => e.release.sha256 === sha);
  intent.pins = sorted(pins);
  intent.provenance = sorted([...releases].flatMap(sha => {
    const existing = record.intent.provenance.find(p => p.releaseSha256 === sha), entry = entryOf(sha);
    return existing ? [existing] : entry ? [{ releaseSha256: sha, package: entry.release.package, sources: entry.release.sources, materialSource: entry.materialSource }] : [];
  }));
  intent.inputs = sorted([...releases].flatMap(sha => {
    const existing = record.intent.inputs.find(i => i.releaseSha256 === sha), entry = entryOf(sha);
    return existing ? [existing] : entry?.input ? [entry.input] : [];
  }));
  changes.removedPins = record.intent.pins.filter(p => !reached.has(pinKey(p))).map(p => ({ releaseSha256: p.releaseSha256, itemId: p.itemId }));
  // Decisions about content that left the draft keep their history and ask for reconsideration.
  const orphaned = intent.reviews.records.filter(r => r.state === 'current' && !reached.has(pinKey(r.subject)) && record.intent.pins.some(p => pinKey(p) === pinKey(r.subject)));
  if (orphaned.length) { preserveReconsideration(intent.reviews, orphaned.map(r => ({ recordId: r.id }))); changes.reviewsReconsidered = orphaned.map(r => r.id); }
  if (!checkIntentShape(intent)) return fail('FIELD_SEMANTICS_UNSUPPORTED', '/records/0/intent', 'Edited draft violates the supported saved-intent shape.');
  const known = read.records.filter(r => Object.hasOwn(JOURNEY_RECORD_KINDS, r.schema)).map(r => r === record ? { id: r.id, schema: r.schema, required: true, intent } : r);
  const written = await writeJourneyEnvelope({ savedIntentBytes: read.savedIntentBytes, records: known, previous: read });
  if (written.status !== 'ok') return unchanged(written);
  const presented = await presentDraft({ inventories, reviewEvidence, comparisons, envelopeBytes: written.value.envelopeBytes, envelope: written.value.envelope,
    savedIntentBytes: read.savedIntentBytes, supported: true, policy, intent, changes });
  return presented.status === 'ok' ? presented : unchanged(presented);
}
