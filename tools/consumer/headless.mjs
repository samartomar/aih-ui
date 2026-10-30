// Supported consumer boundary. No host acquisition or execution authority.
import { selectSetChoices, checkRecordedSetChoices, setChoicesOf, setChoiceSources, setOwnedOrigins, SET_CHOICES_KEY } from './set-choices.mjs';
import { configurePinned, pinSelectedRecipes, recipeDescriptor } from './selected-recipe.mjs';
import { parsePolicy } from '@aihq/core/contracts';
import * as harness from '@aihq/core/harness';
import { isCheckedRelease, listItems, configureItem, resolveSelections, validateSelectionSet, compareReleases } from '@aihq/catalog/reader';
import { checkIntentShape, checkReview, rootKey, pinKey, managementIdOf, AUTHORING_SCHEMA, REVIEW_SCHEMA } from './intent-shape.mjs';
import { migrateIntent } from './migrate-intent.mjs';
import { inspectReviewEvidence, compareReviewBindings, describeReviewJudgments, summarizeReviewJudgments } from './review-bindings.mjs';
import { approvalRecipeStands } from './approval-recipe.mjs';
import { stable, ok, refuse, digestJson } from './primitives.mjs';
import { readJourneyEnvelope, writeJourneyEnvelope, projectJourneyEnvelope, isJourneyEnvelope, DRAFT_RECORD_SCHEMA, JOURNEY_RECORD_KINDS } from './journey.mjs';
// The ./authoring entry: these names and the operations below. inspectReviewEvidence builds the review identities from Scan's readContentCoverage.
export { inspectReviewEvidence } from './review-bindings.mjs';
export { AUTHORING_SCHEMA, REVIEW_SCHEMA, freshAuthoring } from './intent-shape.mjs';
const POLICY_SCHEMA = 'urn:aihq:core:execution-policy:1.6.0';
const pinMaterials = item => item.materials.map(material => material.path ? material : ({ id: material.id, path: material.packagePath, sha256: material.sha256, byteLength: material.byteLength }));
const sorted = values => [...values].sort((a, b) => stable(a) < stable(b) ? -1 : stable(a) > stable(b) ? 1 : 0);
// One item's recipe as Core renders it for a recipe-less selection: one rendering, or for a supporting document one beside each
// requiring item, combined with each rendering's operation and check ids suffixed by its position.
// An inventory's material texts, decoded once: a release is rendered item by item and, with several tools, once per tool.
const materialTexts = new WeakMap();
const contentsOf = entry => {
  if (!materialTexts.has(entry)) materialTexts.set(entry, Object.fromEntries((entry.materials ?? []).filter(material => material.id && material.bytes)
    .map(material => [material.id, new TextDecoder().decode(material.bytes)])));
  return materialTexts.get(entry);
};
export function renderRecipe({ tool, entry, item, scope, requirers = [], grantApproval }) {
  const binding = harness.toolBindings.find(candidate => candidate.tool === tool);
  const contents = contentsOf(entry);
  const deliveries = (requirers.length ? requirers : [undefined]).map(requiredBy =>
    harness.renderDelivery({ tool, item, binding, scope, contents, ...(grantApproval ? { grantApproval } : {}), ...(requiredBy ? { requiredBy } : {}) }));
  const refused = deliveries.find(delivery => delivery.status !== 'rendered');
  if (refused) return { refused };
  const rendered = deliveries[0];
  const unique = deliveries.map((delivery, index) => ({ ...delivery, recipe: { ...delivery.recipe,
    operations: delivery.recipe.operations.map(operation => ({ ...operation, id: `${operation.id}-${index + 1}`,
      requires: (operation.requires ?? []).map(required => `${required}-${index + 1}`), checks: (operation.checks ?? []).map(check => `${check}-${index + 1}`) })),
    checks: delivery.recipe.checks.map(check => ({ ...check, id: `${check.id}-${index + 1}` })) } }));
  const combined = deliveries.length === 1 ? rendered.recipe : { ...rendered.recipe,
    materials: [...new Map(unique.flatMap(delivery => delivery.recipe.materials).map(material => [`${material.id}/${material.path}/${material.sha256}`, material])).values()],
    targets: [...new Set(unique.flatMap(delivery => delivery.recipe.targets))], prerequisites: [...new Set(unique.flatMap(delivery => delivery.recipe.prerequisites))],
    operations: unique.flatMap(delivery => delivery.recipe.operations), checks: unique.flatMap(delivery => delivery.recipe.checks) };
  return { rendered, recipe: { inline: combined } };
}
const supportingDocument = item => item.kind === 'document' && item.payload?.placement !== 'project-folder';
// Execution policy 1.6.0 names the Catalog release content document a recipe-less selection is rendered from. Only an
// inventory read from an installed Catalog package carries one, at that package's `catalog` material root.
const catalogReleaseOf = entry => entry?.catalogRelease && entry.release.framework?.id ? { framework: entry.release.framework.id,
  source: { kind: 'local', input: harness.deliveryMaterialRoot ?? 'catalog' }, ...entry.catalogRelease } : undefined;
// The recipe each recipe-less selection of a composed policy is rendered to, by selection id, so a saved policy that still
// carries the same recipe inline reads as the same setup.
const renderedRecipes = new WeakMap();
const itemFor = (inventories, ref) => {
  for (const entry of inventories ?? []) {
    if (entry?.release?.framework?.id !== ref?.framework) continue;
    const item = entry.release.items.find(candidate => candidate.id === ref.itemId);
    if (item && item.contentSha256 === ref.contentSha256 && item.behaviourSha256 === ref.behaviourSha256) return { entry, item };
  }
  return undefined;
};
// The required inputs Core cannot be given for each selection, by Catalog's `requirements.inputs`. The host supplies a secret
// as a private input by selection id; any other value could only be the selection's configuration, which Catalog accepts
// for the item inputs it declares and the selection then carries. Names only: a value is never read or returned here.
export function unsuppliedInputs({ policy, inventories, privateInputs = {} }) {
  return (policy?.selections ?? []).flatMap(selection => {
    const item = selection.item && itemFor(inventories, selection.item)?.item;
    const missing = Object.entries(item?.requirements?.inputs ?? {}).filter(([name, input]) => input?.required !== false
      && !(input?.sensitive ? Object.hasOwn(privateInputs[selection.id] ?? {}, name) : Object.hasOwn(selection.configuration ?? {}, name))).map(([name]) => name);
    return missing.length ? [{ selectionId: selection.id, managementId: selection.managementId, itemId: selection.item.itemId,
      framework: selection.item.framework, name: selection.name ?? selection.item.itemId, inputs: missing }] : [];
  });
}
// A policy whose recipe-less selections carry the recipes Core renders for them, from the same inventories they were composed
// from. Core's update and organization admission read inline recipes, and a single selection finished on its own keeps a
// supporting document's rendering beside items that are not in its policy. A selection that cannot be rendered stays as it is.
export function inlineRecipelessSelections({ policy, inventories }) {
  if (!policy?.selections?.some(selection => selection.recipe === undefined) || !inventories?.length) return policy;
  const selections = policy.selections.map(selection => {
    if (selection.recipe !== undefined || !selection.item || !selection.tool) return selection;
    const found = itemFor(inventories, selection.item);
    if (!found) return selection;
    const requirers = supportingDocument(found.item) ? (selection.origins ?? []).filter(origin => origin.reasonIncluded === 'required-by').map(origin => {
      const other = policy.selections.find(candidate => candidate.item?.framework === (origin.requiredBy?.framework ?? selection.item.framework) && candidate.item.itemId === origin.requiredBy?.itemId);
      return other && itemFor(inventories, other.item)?.item;
    }) : [];
    if (requirers.some(required => !required)) return selection;
    const rendered = renderRecipe({ tool: selection.tool, entry: found.entry, item: found.item, scope: selection.scope, requirers });
    return rendered.refused ? selection : { ...selection, recipe: rendered.recipe };
  });
  return { ...policy, selections };
}
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
const projected = selections => sorted(selections.map(({ id, managementId, organizationSelectionId, scope, configuration, requires, recipe, item, tool, name, kind, origins, bindingDigest, scanRecords, itemMaterials, projectFacts }) =>
  ({ id, managementId, ...(organizationSelectionId !== undefined ? { organizationSelectionId } : {}), scope, configuration, requires: [...requires].sort(), recipe,
    ...(item !== undefined ? { item, tool, name, kind, origins, bindingDigest,
      ...(scanRecords !== undefined ? { scanRecords } : {}), ...(itemMaterials !== undefined ? { itemMaterials } : {}),
      ...(projectFacts !== undefined ? { projectFacts } : {}) } : {}) })));

// Another chosen tool's copy of a selection: the same item, its own selection and management identity.
export const toolCopyId = (id, tool) => `${id}--${tool}`;
// The paths a rendered recipe writes, as Core names them in its operations.
const targetsOf = recipe => (recipe?.inline?.operations ?? []).filter(operation => operation.target).map(operation => JSON.stringify(operation.target));
const isToolCopy = selection => Boolean(selection.tool && selection.managementId?.endsWith(`--${selection.tool}`));
async function build({ intent, inventories, base, capture = false, historicalV2 = false, tool = undefined, tools = undefined, grantApproval = undefined, revokeApproval = undefined, strictOrigins = true, projectFacts = undefined }) {
  if (intent && new TextEncoder().encode(JSON.stringify(intent)).length > 850_000) return refuse('POLICY_BOUND_EXCEEDED', '/metadata/aih.workbench', 'Intent exceeds 850,000 UTF-8 bytes; reduce selected state.');
  if (intent?.reviews?.schema && intent.reviews.schema !== REVIEW_SCHEMA) return refuse('INTENT_VERSION_UNSUPPORTED', '/metadata/aih.workbench/reviews/schema', 'Unsupported review document version.');
  if (!checkIntentShape(intent)) return refuse('FIELD_SEMANTICS_UNSUPPORTED', '/metadata/aih.workbench', 'Malformed, oversized or unknown authoring semantics.');
  // The composing tool is explicit page context, canonicalized through Harness; there is no default or
  // inferred client. Saved selections keep their recorded tool identity — the current header never rebinds.
  let canonicalTool;
  if (tool !== undefined) {
    const selected = typeof harness.selectTool === 'function' ? harness.selectTool(tool) : null;
    if (!selected || selected.status !== 'selected') return refuse('TOOL_UNAVAILABLE', '/tool', 'Choose your tool before composing this setup; no tool is silently selected.');
    canonicalTool = selected.tool.id;
  }
  // Several chosen tools: each new item goes to the first of them Core renders it for, and a copy to each other one Core
  // renders it for. A tool Core does not select gets nothing. Saved selections keep the tools they were installed for.
  const chosenTools = [];
  for (const value of Array.isArray(tools) ? tools : []) {
    const selected = typeof harness.selectTool === 'function' ? harness.selectTool(value) : null;
    if (selected?.status === 'selected' && !chosenTools.includes(selected.tool.id)) chosenTools.push(selected.tool.id);
  }
  if (!canonicalTool && chosenTools.length) canonicalTool = chosenTools[0];
  if (canonicalTool && chosenTools.length && !chosenTools.includes(canonicalTool)) chosenTools.unshift(canonicalTool);
  const copies = [];
  // The one-server approval opt-in is exactly { framework, itemId }, ephemeral and explicit. `false`-less
  // revocation uses revokeApproval with the same shape; both never carry a value.
  const approvalShape = value => value !== undefined && (!value || typeof value.framework !== 'string' || typeof value.itemId !== 'string' || Object.keys(value).length !== 2);
  if (approvalShape(grantApproval)) return refuse('INPUT_INVALID', '/grantApproval', 'Name the one MCP server to allow as { framework, itemId }; there is no list or approve-all.');
  if (approvalShape(revokeApproval)) return refuse('INPUT_INVALID', '/revokeApproval', 'Name the one MCP server to un-allow as { framework, itemId }; there is no list.');
  if ((grantApproval || revokeApproval) && !canonicalTool) return refuse('TOOL_UNAVAILABLE', '/tool', 'Choose your tool before changing an MCP server approval.');
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
    sets: setChoicesOf(intent).map(choice => choice.request),
    roots: intent.roots.map(({ releaseSha256, itemId, scope, configuration }) => ({ releaseSha256, itemId, scope, configuration })),
    skips: intent.exclusions.map(({ releaseSha256, itemId, scope }) => ({ releaseSha256, itemId, scope })) });
  if (resolution.status !== 'ok') return resolution;
  // Every root reaches Catalog, so a set member keeps its configuration; a root that only saved sets put there is
  // owned by those sets, not chosen directly, so it records only their origins and leaves with them.
  const resolved = { ...resolution.value, selections: resolution.value.selections.map(selection => ({ ...selection, origins: setOwnedOrigins(intent, selection) })) };
  // Preserve existing selection identity for unchanged recipe/source/scope; a
  // historical v1 selection id is not a reason to rewrite execution semantics.
  const selections = [], pins = new Map(), sourceIds = new Set([...setChoiceSources(intent), ...intent.exclusions.map(r => r.releaseSha256), ...intent.origins.filter(o => o.kind === 'template').map(o => o.releaseSha256)]);
  let approvalRendered = false, approvalRevoked = false;
  const catalogReleases = new Map(), recipelessRecipes = new Map();
  // One release per framework: a selection whose framework already names another release keeps its recipe inline.
  const nameReleases = entries => {
    const named = entries.map(catalogReleaseOf);
    if (named.some(release => !release || (catalogReleases.has(release.framework) && stable(catalogReleases.get(release.framework)) !== stable(release)))) return false;
    for (const release of named) catalogReleases.set(release.framework, release);
    return true;
  };
  for (const selection of resolved.selections) {
    const found = index.items.get(pinKey(selection.item)), { entry, item } = found;
    const identityPrior = base?.selections.find(candidate => !isToolCopy(candidate) && candidate.scope === selection.scope && candidate.item?.itemId === item.id
      && candidate.item.framework === entry.release.framework?.id && candidate.item.contentSha256 === item.contentSha256 && candidate.item.behaviourSha256 === item.behaviourSha256);
    const renderable = Boolean(entry.release.framework?.id && item.contentSha256 && item.behaviourSha256 && typeof harness.renderDelivery === 'function');
    // The items requiring a supporting document, rendered beside it; undefined where Catalog could not name one.
    const requirerFound = supportingDocument(item)
      ? selection.origins.filter(origin => origin.reasonIncluded === 'required-by').map(origin => {
        const other = resolved.selections.find(candidate => candidate.item.itemId === origin.requiredBy?.itemId
          && index.releases[candidate.item.releaseSha256]?.framework?.id === origin.requiredBy?.framework);
        return other ? index.items.get(pinKey(other.item)) : undefined;
      }) : [];
    const rendersFor = value => renderable && !requirerFound.some(required => !required)
      && !renderRecipe({ tool: value, entry, item, scope: selection.scope, requirers: requirerFound.map(required => required.item) }).refused;
    const renderTool = identityPrior?.tool ?? (chosenTools.length > 1 && renderable ? chosenTools.find(rendersFor) ?? canonicalTool : canonicalTool);
    const canRender = Boolean(renderable && renderTool);
    const configured = canRender ? { valid: true, selection: { configuration: selection.configuration } } : configurePinned(entry, item, selection.configuration, intent.pins);
    if (!configured.valid) return refuse('INPUT_INVALID', '/roots/configuration', 'Catalog refused item configuration.', undefined, { owner: 'catalog', diagnostics: configured.diagnostics });
    const prior = identityPrior ?? base?.selections.find(candidate => !isToolCopy(candidate) && candidate.scope === selection.scope && ((configured.selection.recipe !== undefined && stable(candidate.recipe) === stable(configured.selection.recipe))
      || (candidate.recipe?.inline && candidate.tool && candidate.recipe.inline.id === `${candidate.tool}.${item.id}`)));
    const organizationIds = new Set(intent.roots.filter(r => rootKey(r) === rootKey({ ...selection.item, scope: selection.scope }))
      .flatMap(r => r.originIds)
      .map(id => intent.origins.find(o => o.id === id)).filter(o => o?.kind === 'organization').map(o => o.organizationSelectionId));
    if (organizationIds.size > 1) return refuse('INTENT_POLICY_CONTRADICTION', '/origins', 'Conflicting organization selection identities.');
    const managementId = prior?.managementId ?? managementIdOf({ scope: selection.scope, packageName: entry.release.package.name, itemId: item.id });
    const checkedBundle = entry.release.framework?.id && item.contentSha256 && item.behaviourSha256
      ? { item: { framework: entry.release.framework.id, itemId: item.id, contentSha256: item.contentSha256, behaviourSha256: item.behaviourSha256 },
          name: item.name ?? item.label, kind: item.kind, origins: structuredClone(selection.origins) } : undefined;
    if (prior?.item) {
      const identityMismatch = !checkedBundle
        || prior.item.itemId !== checkedBundle.item.itemId || prior.item.framework !== checkedBundle.item.framework
        || prior.item.contentSha256 !== checkedBundle.item.contentSha256 || prior.item.behaviourSha256 !== checkedBundle.item.behaviourSha256
        || prior.kind !== checkedBundle.kind || prior.name !== checkedBundle.name;
      if (identityMismatch) return refuse('INTENT_POLICY_CONTRADICTION', '/selections',
        `Saved selection metadata for ${item.id} no longer matches the checked source and its resolved origins.`, undefined, { owner: 'core' });
      if (strictOrigins && stable(prior.origins ?? null) !== stable(selection.origins)) return refuse('INTENT_POLICY_CONTRADICTION', '/selections',
        `Saved selection origins for ${item.id} no longer match the checked source and its resolved origins.`, undefined, { owner: 'core' });
    }
    const bundle = prior?.item ? { item: prior.item, tool: prior.tool, name: prior.name, kind: prior.kind, origins: structuredClone(selection.origins) }
      : renderTool && checkedBundle ? { ...checkedBundle, tool: renderTool } : undefined;
    const ticked = Boolean(grantApproval && bundle && grantApproval.framework === bundle.item.framework && grantApproval.itemId === item.id && (item.kind === 'mcp-server' || item.kind === 'mcp'));
    const approvalRecorded = Boolean(prior?.recipe?.inline && prior.tool && prior.recipe.inline.id === `${prior.tool}.${item.id}`);
    const revoked = Boolean(revokeApproval && bundle && revokeApproval.framework === bundle.item.framework && revokeApproval.itemId === item.id);
    if (revoked) approvalRevoked = true;
    let recipe = configured.selection.recipe, rendered, renderedRecipe, requirerEntries = [];
    if (canRender) {
      if (ticked && bundle.tool !== canonicalTool) return refuse('INPUT_INVALID', '/grantApproval',
        `The server's recorded tool ${bundle.tool} does not match the requested tool ${canonicalTool}; remove and reselect it explicitly before changing approval.`);
      const requirers = requirerFound;
      if (requirers.some(required => !required)) return refuse('PREREQUISITE_UNAVAILABLE', '/selections', 'Catalog could not name the item requiring this document.');
      const delivered = renderRecipe({ tool: renderTool, entry, item, scope: selection.scope, requirers: requirers.map(required => required.item), ...(ticked ? { grantApproval } : {}) });
      const { refused } = delivered;
      if (refused) return refuse('PREREQUISITE_UNAVAILABLE', ticked ? '/grantApproval' : '/selections',
        refused.guidance ?? refused.message ?? refused.reason ?? 'Core refused the content delivery.', undefined,
        { owner: 'core', diagnostics: refused.diagnostics ?? (refused.code ? [{ code: refused.code, message: refused.reason ?? refused.message }] : []) });
      rendered = delivered.rendered;
      recipe = renderedRecipe = delivered.recipe;
      requirerEntries = requirers.map(required => required.entry);
      if (ticked) approvalRendered = true;
    }
    if (approvalRecorded && !ticked && !revoked && approvalRecipeStands({ prior, item, scope: selection.scope, renderDelivery: harness.renderDelivery, toolBindings: harness.toolBindings })) recipe = prior.recipe;
    if (revokeApproval && revokeApproval.itemId === item.id && !revoked)
      return refuse('INPUT_INVALID', '/revokeApproval', 'Only the one MCP server being un-allowed may be named, and it must be part of this setup.');
    if (ticked && !canRender) {
      approvalRendered = true;
      const binding = harness.toolBindings.find(candidate => candidate.tool === canonicalTool);
      const approval = harness.renderDelivery({ tool: canonicalTool, item, binding, scope: selection.scope, grantApproval });
      if (approval.status !== 'rendered') return refuse('PREREQUISITE_UNAVAILABLE', '/grantApproval',
        approval.guidance ?? approval.message ?? approval.reason ?? 'Core refused the one-server approval.', undefined,
        { owner: 'core', diagnostics: approval.diagnostics ?? (approval.code ? [{ code: approval.code, message: approval.reason ?? approval.message }] : []) });
      recipe = { inline: approval.recipe };
    }
    // projectFacts is optional metadata of at least one fact. Facts read from the project now decide it alone: a project
    // with none found carries no field, even if an earlier read recorded some. Without a read (no folder) the record stays.
    const factsRead = bundle?.item.framework === 'project-basics' && Array.isArray(projectFacts?.facts);
    const { projectFacts: _recordedFacts, ...priorWithoutFacts } = prior ?? {};
    selections.push({ ...(factsRead ? priorWithoutFacts : prior), id: prior?.id ?? selection.id, managementId, scope: selection.scope, configuration: configured.selection.configuration,
      ...(bundle ? { item: bundle.item, tool: bundle.tool, name: bundle.name, kind: bundle.kind, origins: bundle.origins } : {}),
      ...(factsRead && projectFacts.facts.length ? { projectFacts: structuredClone(projectFacts.facts) } : {}),
      ...(rendered ? { bindingDigest: rendered.bindingDigest,
        ...(item.scan?.length ? { scanRecords: structuredClone(item.scan), itemMaterials: item.materials.map(material => ({ materialId: material.id, relPath: material.relPath, path: material.packagePath,
          sha256: material.sha256, byteLength: material.byteLength, role: material.role })) } : {}) } : {}),
      ...(base?.mode === 'enterprise' ? { organizationSelectionId: [...organizationIds][0] ?? prior?.organizationSelectionId ?? managementId } : {}),
      requires: [], recipe });
    // Execution policy 1.6.0: the plain rendering Core reproduces at Prepare is left out of the policy when its release (and each
    // requiring item's) can be named. A one-server approval is not a recipe-less input, so it stays inline.
    if (rendered && recipe === renderedRecipe && !ticked && nameReleases([entry, ...requirerEntries])) {
      delete selections.at(-1).recipe;
      recipelessRecipes.set(selections.at(-1).id, recipe);
    }
    // The tools this item is also installed for: those its saved copies name, or for a new item each other chosen tool
    // Core renders it for.
    if (canRender && bundle) {
      const lead = selections.at(-1);
      const recorded = identityPrior ? (base?.selections ?? []).filter(candidate => candidate.managementId?.startsWith(`${lead.managementId}--`)
        && candidate.scope === selection.scope && candidate.item?.itemId === item.id && candidate.tool && candidate.tool !== lead.tool).map(candidate => candidate.tool) : null;
      // Tools that share a project location (Core renders the same target paths) get the one installation already there.
      const written = new Set(targetsOf(renderedRecipe));
      for (const other of recorded ?? chosenTools.filter(value => value !== lead.tool && rendersFor(value))) {
        const delivered = renderRecipe({ tool: other, entry, item, scope: selection.scope, requirers: requirerFound.map(required => required.item) });
        if (delivered.refused) return refuse('PREREQUISITE_UNAVAILABLE', '/selections', delivered.refused.guidance ?? delivered.refused.message ?? delivered.refused.reason ?? 'Core refused the content delivery.', undefined,
          { owner: 'core', diagnostics: delivered.refused.diagnostics ?? (delivered.refused.code ? [{ code: delivered.refused.code, message: delivered.refused.reason ?? delivered.refused.message }] : []) });
        const targets = targetsOf(delivered.recipe);
        if (!recorded && targets.some(target => written.has(target))) continue;
        for (const target of targets) written.add(target);
        copies.push({ lead, tool: other, delivered, recipeless: recipelessRecipes.has(lead.id) });
      }
    }
    const pinRecipe = rendered ? recipeDescriptor({ id: recipe.inline.id, path: `inline:${recipe.inline.id}`,
      sha256: await digestJson(recipe.inline), byteLength: new TextEncoder().encode(stable(recipe.inline)).byteLength, schema: recipe.inline.schema })
      : item.recipe ?? recipeDescriptor(Object.values(item.recipes).find(recipe => recipe.sha256 === configured.selection.recipe.reference.sha256));
    pins.set(pinKey(selection.item), { releaseSha256: entry.release.sha256, itemId: item.id, itemSha256: item.itemSha256, recipe: pinRecipe, materials: pinMaterials(item) });
    sourceIds.add(entry.release.sha256);
  }
  const validation = validateSelectionSet({ releases: index.releases, selections: resolved.selections.map((s, i) => ({ ...s, id: selections[i].id })) });
  if (!validation.valid) return refuse('INPUT_INVALID', '/selections', 'Catalog refused the resolved set.', undefined, { owner: 'catalog', diagnostics: validation.diagnostics });
  if (grantApproval && !approvalRendered) return refuse('INPUT_INVALID', '/grantApproval', 'The server being allowed is not part of this setup; the opt-in was not applied.');
  if (revokeApproval && !approvalRevoked) return refuse('INPUT_INVALID', '/revokeApproval', 'The server being un-allowed is not part of this setup; nothing was removed.');
  for (const selection of selections) selection.requires = validation.requiresBySelectionId[selection.id];
  // Each copy requires the same tool's copy of what its lead requires, where there is one, else the lead itself.
  const copyIds = new Set(copies.map(copy => toolCopyId(copy.lead.id, copy.tool)));
  for (const { lead, tool: other, delivered, recipeless } of copies) {
    const { recipe: _leadRecipe, ...rest } = lead;
    const copy = { ...structuredClone(rest), id: toolCopyId(lead.id, other), managementId: toolCopyId(lead.managementId, other), tool: other,
      ...(lead.organizationSelectionId !== undefined ? { organizationSelectionId: toolCopyId(lead.organizationSelectionId, other) } : {}),
      bindingDigest: delivered.rendered.bindingDigest, requires: lead.requires.map(id => copyIds.has(toolCopyId(id, other)) ? toolCopyId(id, other) : id) };
    if (recipeless) recipelessRecipes.set(copy.id, delivered.recipe); else copy.recipe = delivered.recipe;
    selections.push(copy);
  }
  const provenance = inventories.filter(e => sourceIds.has(e.release.sha256)).map(e => ({ releaseSha256: e.release.sha256, package: e.release.package, sources: e.release.sources, materialSource: { ...e.materialSource, ...(e.internalContent ? { internalContent: e.internalContent } : {}), ...(intent.provenance.find(source => source.releaseSha256 === e.release.sha256)?.materialSource?.[SET_CHOICES_KEY] ? { [SET_CHOICES_KEY]: intent.provenance.find(source => source.releaseSha256 === e.release.sha256).materialSource[SET_CHOICES_KEY] } : {}) } }));
  const inputs = inventories.filter(e => sourceIds.has(e.release.sha256) && e.input).map(e => e.input);
  const next = { ...structuredClone(intent), pins: sorted([...pins.values()]), provenance: sorted(provenance), inputs: sorted(inputs) };
  if (new TextEncoder().encode(JSON.stringify(next)).length > 850_000) return refuse('POLICY_BOUND_EXCEEDED', '/metadata/aih.workbench', 'The captured choices exceed the 850,000-byte saved-intent bound. Choose fewer sets or members.');
  if (!checkIntentShape(next)) return refuse('FIELD_SEMANTICS_UNSUPPORTED', '/metadata/aih.workbench', 'Captured authoring state violates the supported shape.');
  // v2 captured source provenance from resolved pins/exclusions only. Validate
  // that frozen projection before enriching migrated v3 template provenance.
  const historicalSources = new Set([...pins.values(), ...intent.exclusions].map(ref => ref.releaseSha256));
  const comparisonProvenance = historicalV2 ? next.provenance.filter(p => historicalSources.has(p.releaseSha256)) : next.provenance;
  if (!capture && (stable(sorted(intent.pins)) !== stable(next.pins) || stable(sorted(intent.provenance)) !== stable(comparisonProvenance) || stable(sorted(intent.inputs)) !== stable(next.inputs)))
    return refuse('INTENT_POLICY_CONTRADICTION', '/metadata/aih.workbench', 'Pins, provenance or inputs contradict the checked closure.');
  // Execution policy 1.6 carries the rendered binding and exact Catalog identity, origins and exclusions.
  // A release without published framework identity keeps its legacy recipe and cannot name an exclusion;
  // the skip still stands. ExcludedItems name current intent exclusions and false members retained only
  // in exact set requests.
  // An unskip/reinclusion removes the record; any actual resolved inclusion wins over a false member elsewhere.
  const excludedItems = [];
  for (const exclusion of intent.exclusions) {
    const found = index.items.get(pinKey(exclusion));
    const framework = found?.entry.release.framework?.id;
    if (framework) excludedItems.push({ framework, itemId: exclusion.itemId });
  }
  for (const choice of setChoicesOf(intent)) for (const member of choice.request.members ?? []) {
    if (member.include === false && member.item?.framework) excludedItems.push({ framework: member.item.framework, itemId: member.item.itemId });
  }
  const included = new Set(resolved.selections.map(selection => {
    const framework = index.releases[selection.item.releaseSha256]?.framework?.id;
    return framework ? `${framework}/${selection.item.itemId}` : null;
  }).filter(Boolean));
  const effectiveExclusions = new Map();
  for (const ref of excludedItems) if (!included.has(`${ref.framework}/${ref.itemId}`)) effectiveExclusions.set(`${ref.framework}/${ref.itemId}`, ref);
  const { catalogReleases: _previousReleases, ...rest } = base ?? { schema: POLICY_SCHEMA, mode: 'vibe' };
  const policy = { ...rest,
    schema: POLICY_SCHEMA,
    ...(catalogReleases.size ? { catalogReleases: sorted([...catalogReleases.values()]) } : {}),
    selections,
    excludedItems: [...effectiveExclusions.values()],
    metadata: { ...base?.metadata, 'aih.workbench': next } };
  renderedRecipes.set(policy, recipelessRecipes);
  const setProblem = checkRecordedSetChoices(policy.metadata?.['aih.workbench'], inventories);
  if (setProblem) return refuse('INTENT_POLICY_CONTRADICTION', '/metadata/aih.workbench/provenance', setProblem);
  const policyBytes = new TextEncoder().encode(JSON.stringify(policy) + '\n');
  if (policyBytes.length > 1_000_000 || new TextEncoder().encode(JSON.stringify(next)).length > 850_000) return refuse('POLICY_BOUND_EXCEEDED', '', 'Policy exceeds the Core or consumer byte bound; reduce selected state.');
  const parsed = parsePolicy(new TextDecoder().decode(policyBytes));
  if (!parsed.valid) return refuse('INPUT_INVALID', '', 'Core refused the composed execution policy.', undefined, { owner: 'core', diagnostics: parsed.diagnostics });
  return ok({ policyBytes, intent: next, policy, inclusions: resolved.inclusions, optional: resolved.optional });
}
// Saved judgments are always reported as derived applicability; a failure to describe them never gates editing.
async function reviewView({ intent, inventories, reviewEvidence, comparisons, recipient }) {
  if (!checkIntentShape(intent)) return {};
  const described = await describeReviewJudgments({ intent, inventories, reviewEvidence, comparisons, recipient });
  return described.status === 'ok' ? { reviewJudgments: described.value, reviewSummary: summarizeReviewJudgments(described.value) } : { reviewJudgmentDiagnostics: described.diagnostics };
}
export async function readAuthoring({ policyBytes, inventories, reviewEvidence = [], comparisons = [], recipient }) {
  if (!(policyBytes instanceof Uint8Array)) return refuse('INPUT_INVALID', '/policyBytes', 'Supply original UTF-8 bytes.');
  const originalBytes = policyBytes.slice();
  let parsed;
  try { parsed = parsePolicy(new TextDecoder('utf-8', { fatal: true }).decode(policyBytes)); }
  catch { return refuse('INPUT_INVALID', '/policyBytes', 'Invalid UTF-8 policy.', originalBytes); }
  if (!parsed.valid) return refuse('INPUT_INVALID', '', 'Core refused the execution policy.', originalBytes, { owner: 'core', diagnostics: parsed.diagnostics });
  const policy = parsed.document;
  const setError = checkRecordedSetChoices(policy.metadata?.['aih.workbench'], inventories);
  if (setError) return refuse('INTENT_POLICY_CONTRADICTION', '/metadata/aih.workbench/provenance', setError, originalBytes);
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
    if (analysis?.unresolved.length) return ok({ policy, intent, editing: 'unresolved', originalBytes, diagnostics: availabilityDiagnostics(analysis.unresolved),
      unresolved: analysis.unresolved, roots: analysis.roots, ...await reviewView({ intent, inventories, reviewEvidence, comparisons, recipient }), ...note });
  }
  const rebuilt = await build({ intent, inventories, base: policy, capture: migration?.capture === true, historicalV2: migration?.historicalV2 === true, strictOrigins: true });
  // A policy saved with the inline recipe Core now renders from the item is the same setup.
  const recipeless = rebuilt.status === 'ok' ? renderedRecipes.get(rebuilt.value.policy) : undefined;
  const saved = policy.selections.map(selection => recipeless?.has(selection.id) && stable(selection.recipe) === stable(recipeless.get(selection.id))
    ? (({ recipe: _recipe, ...rest }) => rest)(selection) : selection);
  const diagnostics = rebuilt.status === 'refused' ? rebuilt.diagnostics : stable(projected(rebuilt.value.policy.selections)) !== stable(projected(saved))
    ? [{ code: 'INTENT_POLICY_CONTRADICTION', path: '/selections', message: 'Intent contradicts executable selections.' }] : [];
  const current = rebuilt.status === 'ok' ? rebuilt.value.intent : intent;
  return ok({ policy, intent: current, editing: diagnostics.length ? 'unavailable' : 'available', originalBytes, diagnostics,
    ...(rebuilt.status === 'ok' ? { inclusions: rebuilt.value.inclusions, optional: rebuilt.value.optional } : {}),
    ...await reviewView({ intent: current, inventories, reviewEvidence, comparisons, recipient }),
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
    // A candidate update is the same content item (Catalog's compareReleases: same package, the item in the candidate release) from the same
    // acquired input; the input match is the saved intent's own acquisition identity.
    const updates = candidateInventories.filter(e => e.release.sha256 !== root.releaseSha256
      && (oldEntry.input ? e.input?.kind === oldEntry.input.kind && stable(e.input?.locator) === stable(oldEntry.input.locator) : !e.input)).flatMap(e => {
      const compared = compareReleases({ first: oldEntry.release, second: e.release });
      if (compared.status !== 'ok' || compared.value.package !== 'same-package') return [];
      return compared.value.items.filter(i => i.itemId === root.itemId && i.presence !== 'only-in-first').map(i => ({ releaseSha256: e.release.sha256, itemId: i.itemId, itemSha256: i.second.itemSha256, scope: root.scope }));
    });
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
async function composeReviewed({ basePolicyBytes, intent, inventories, reviewEvidence = [], comparisons = [], recipient, tool = undefined, tools = undefined, grantApproval = undefined, revokeApproval = undefined, strictOrigins = false, projectFacts = undefined }, reviewTransition = false) {
  if (intent && new TextEncoder().encode(JSON.stringify(intent)).length > 850_000) return refuse('POLICY_BOUND_EXCEEDED', '/metadata/aih.workbench', 'Intent exceeds 850,000 UTF-8 bytes; reduce selected state.', basePolicyBytes);
  if (intent?.reviews?.schema && intent.reviews.schema !== REVIEW_SCHEMA) return refuse('INTENT_VERSION_UNSUPPORTED', '/metadata/aih.workbench/reviews/schema', 'Unsupported review document version.', basePolicyBytes);
  if (!checkIntentShape(intent)) return refuse('FIELD_SEMANTICS_UNSUPPORTED', '/metadata/aih.workbench', 'Malformed or unknown authoring semantics.', basePolicyBytes);
  let base;
  if (basePolicyBytes) {
    const original = await readAuthoring({ policyBytes: basePolicyBytes, inventories });
    if (original.status === 'refused') return original;
    if (original.value.editing !== 'available') return { status: 'refused', diagnostics: refusalDiagnostics(original.value), originalBytes: basePolicyBytes.slice() };
    base = original.value.policy;
    if (!reviewTransition && stable(intent.reviews) !== stable(original.value.intent.reviews)) return refuse('REVIEW_BINDING_UNAVAILABLE', '/reviews', 'Use the checked evidence review workflow to change decisions.', basePolicyBytes);
  }
  return buildReviewed({ intent, inventories, base, originalBytes: basePolicyBytes, reviewEvidence, comparisons, recipient, tool, tools, grantApproval, revokeApproval, strictOrigins, projectFacts });
}
// Saved judgments are never refused or converted here: their applicability is reported beside the result.
async function buildReviewed({ intent, inventories, base, originalBytes, reviewEvidence, comparisons, recipient, tool = undefined, tools = undefined, grantApproval = undefined, revokeApproval = undefined, strictOrigins = false, projectFacts = undefined }) {
  const result = await build({ intent, inventories, base, capture: true, tool, tools, grantApproval, revokeApproval, strictOrigins, projectFacts });
  if (result.status === 'ok') return ok({ ...result.value, ...await reviewView({ intent: result.value.intent, inventories, reviewEvidence, comparisons, recipient }) });
  return originalBytes ? { ...result, originalBytes: originalBytes.slice() } : result;
}
export async function editAuthoring({ policyBytes, inventories, operation, reviewEvidence = [], comparisons = [], recipient, tool = undefined, tools = operation?.tools, grantApproval = undefined, revokeApproval = undefined, projectFacts = undefined }) {
  const original = await readAuthoring({ policyBytes, inventories });
  if (original.status !== 'ok') return original;
  if (original.value.editing !== 'available') return { status: 'refused', diagnostics: refusalDiagnostics(original.value), originalBytes: policyBytes.slice() };
  // The one-server tick re-composes unchanged choices with the approval rendered for exactly that server.
  // Unticking re-composes without it, restoring the recorded recipe. Neither writes an input value.
  if (operation?.type === 'mcp-approval') {
    const root = original.value.intent.roots.find(candidate => rootKey(candidate) === rootKey(operation.root));
    if (!root) return refuse('INPUT_INVALID', '/operation/root', 'The server is not part of this setup.', policyBytes);
    const entry = inventories.find(candidate => candidate.release.sha256 === root.releaseSha256);
    const item = entry?.release.items.find(candidate => candidate.id === root.itemId);
    if (!item || (item.kind !== 'mcp-server' && item.kind !== 'mcp')) return refuse('INPUT_INVALID', '/operation/root', 'Only an MCP server can be allowed this way.', policyBytes);
    if (!entry.release.framework?.id) return refuse('SOURCE_REVISION_UNAVAILABLE', '/operation/root', 'This exact source publishes no framework identity to name the approval.', policyBytes);
    return composeAuthoring({ basePolicyBytes: policyBytes, intent: original.value.intent, inventories, reviewEvidence, comparisons, recipient, tool, projectFacts,
      ...(operation.granted ? { grantApproval: { framework: entry.release.framework.id, itemId: item.id } } : { revokeApproval: { framework: entry.release.framework.id, itemId: item.id } }) });
  }
  // An omitted hash is filled from the checked inventory; a supplied one is verified by composition.
  if (operation?.type === 'select' && operation.root && operation.root.itemSha256 === undefined) {
    const item = inventories.find(e => e.release.sha256 === operation.root.releaseSha256)?.release.items.find(i => i.id === operation.root.itemId);
    if (item) operation = { ...operation, root: { ...operation.root, itemSha256: item.itemSha256 } };
  }
  const intent = structuredClone(original.value.intent), before = intent.roots;
  if (operation?.type === 'select-sets') {
    try {
      const selected = selectSetChoices({ intent, policy: original.value.policy, inventories, sets: operation.sets, tool: operation.tool, releaseSha256: operation.releaseSha256, configurations: operation.configurations });
      if (selected.status !== 'ok') return { ...selected, originalBytes: policyBytes.slice() };
      return buildReviewed({ intent: selected.value.intent, inventories, base: original.value.policy, originalBytes: policyBytes, reviewEvidence, comparisons, recipient, tool, tools, projectFacts });
    } catch (error) { return refuse('INPUT_INVALID', '/operation/sets', error.message, policyBytes); }
  }
  const add = root => {
    const prior = intent.roots.find(r => rootKey(r) === rootKey(root));
    if (prior && stable(prior.configuration) !== stable(root.configuration)) throw new Error('Conflicting root configuration.');
    if (prior) prior.originIds = [...new Set([...prior.originIds, ...root.originIds])].sort();
    else intent.roots.push(structuredClone(root));
  };
  try {
    if (operation.type === 'select') {
      if (operation.tool) pinSelectedRecipes(intent, inventories, operation.root, operation.tool);
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
    } else if (operation.type === 'remove-root' && before.find(root => rootKey(root) === rootKey(operation.root))?.originIds.some(id => setChoicesOf(original.value.intent).some(choice => choice.originId === id))) return refuse('SET_MEMBER_REQUIRED', '/operation/root', 'This choice belongs to a saved set. Change its member ticks or remove the set explicitly.', policyBytes);
    else if (operation.type === 'remove-root') intent.roots = before.filter(r => rootKey(r) !== rootKey(operation.root));
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
  return composeAuthoring({ basePolicyBytes: policyBytes, intent, inventories, reviewEvidence, comparisons, recipient, tool, tools, revokeApproval, projectFacts });
}

// These are the only mutation paths for reviews on an existing document.
// Portable human records describe a decision; they do not authenticate a person.
export async function recordReview({ policyBytes, inventories, evidenceBytes, target, finding, decision, reviewEvidence = [], comparisons = [], recipient }) {
  if (!Array.isArray(reviewEvidence) || reviewEvidence.length > 32 || reviewEvidence.some(bytes => !(bytes instanceof Uint8Array))) return refuse('REVIEW_BINDING_UNAVAILABLE', '/reviewEvidence', 'Supply at most 32 original evidence byte arrays.', policyBytes);
  const read = await readAuthoring({ policyBytes, inventories });
  if (read.status !== 'ok') return read;
  if (read.value.editing !== 'available') return { status: 'refused', diagnostics: refusalDiagnostics(read.value), originalBytes: policyBytes.slice() };
  const intent = structuredClone(read.value.intent), inventory = inventories.find(entry => entry.release.sha256 === target?.releaseSha256);
  if (!inventory || !intent.pins.some(pin => pin.releaseSha256 === target.releaseSha256 && pin.itemId === target.itemId)) return refuse('REVIEW_BINDING_UNAVAILABLE', '/target', 'Review target must be an exact selected item.', policyBytes);
  const pin = intent.pins.find(pin => pin.releaseSha256 === target.releaseSha256 && pin.itemId === target.itemId);
  const inspected = await inspectReviewEvidence({ evidenceBytes, inventory, itemId: target.itemId, recipe: pin.recipe, configuration: intent.roots.find(root => root.releaseSha256 === target.releaseSha256 && root.itemId === target.itemId)?.configuration });
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
  return composeReviewed({ basePolicyBytes: policyBytes, intent, inventories, reviewEvidence: [evidenceBytes, ...otherEvidence], comparisons, recipient }, true);
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
// Optional and explicit: an organization may require review. Nothing invokes it implicitly.
export async function reconsiderReviews({ policyBytes, inventories, reviewEvidence = [], comparisons = [], recipient }) {
  const read = await readAuthoring({ policyBytes, inventories });
  if (read.status !== 'ok') return read;
  if (read.value.editing !== 'available') return { status: 'refused', diagnostics: refusalDiagnostics(read.value), originalBytes: policyBytes.slice() };
  const intent = structuredClone(read.value.intent);
  const compared = await compareReviewBindings({ intent, inventories, reviewEvidence, comparisons });
  if (compared.status !== 'ok') return { ...compared, originalBytes: policyBytes.slice() };
  preserveReconsideration(intent.reviews, compared.value.filter(result => result.state !== 'unchanged'));
  const result = await composeReviewed({ basePolicyBytes: policyBytes, intent, inventories, reviewEvidence, comparisons, recipient }, true);
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
function liveClosure(index, root, skips, pins) {
  const resolved = resolveSelections({ releases: index.releases, roots: [{ releaseSha256: root.releaseSha256, itemId: root.itemId, scope: root.scope, configuration: root.configuration }], skips });
  if (resolved.status !== 'ok') return { diagnostics: resolved.diagnostics };
  const refusal = (path, message, diagnostics) => ({ diagnostics: [{ code: 'INPUT_INVALID', path, message, details: { owner: 'catalog', diagnostics } }] });
  for (const selection of resolved.value.selections) {
    const found = index.items.get(pinKey(selection.item));
    if (!found) continue;
    const configured = configurePinned(found.entry, found.item, selection.configuration, pins);
    if (!configured.valid) return refusal('/roots/configuration', 'Catalog refused item configuration.', configured.diagnostics);
  }
  const validation = validateSelectionSet({ releases: index.releases, selections: resolved.value.selections });
  if (!validation.valid) return refusal('/selections', 'Catalog refused the resolved set.', validation.diagnostics);
  return { closure: new Set(resolved.value.inclusions.filter(i => rootKey(i.root) === rootKey(root)).map(i => rootKey(i.item))) };
}
// Required items Catalog could not resolve from the supplied inventories: the references its refusal names on each unavailable release or item a
// dependency declaration requires (`reference`, with the declaring item as `declaredBy`), once each, in Catalog's order. The item digest a
// declaration pins is read from the declaration Catalog points at (`path`, a JSON pointer into the request), since `reference` does not carry it (temporary until samartomar/aih-catalog#105 adds it).
const UNAVAILABLE = new Set(['RELEASE_UNAVAILABLE', 'ITEM_UNAVAILABLE']);
const pointed = (root, path) => typeof path === 'string' && path.startsWith('/')
  ? path.slice(1).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~')).reduce((value, key) => value != null && typeof value === 'object' && Object.hasOwn(value, key) ? value[key] : undefined, root) : undefined;
function missingRequirements(diagnostics, releases) {
  const missing = new Map();
  for (const { code, path, reference, declaredBy } of diagnostics ?? []) {
    if (!UNAVAILABLE.has(code) || !declaredBy || !isRef(reference)) continue;
    const key = pinKey(reference), itemSha256 = pointed({ releases }, path)?.itemSha256;
    if (!missing.has(key)) missing.set(key, { releaseSha256: reference.releaseSha256, itemId: reference.itemId, ...(typeof itemSha256 === 'string' ? { itemSha256 } : {}) });
  }
  return [...missing.values()];
}
// Pure classification of a saved intent against supplied exact inventories.
function analyzeDraft({ intent, policy, inventories, live = true }) {
  const index = inventoryIndex(inventories), graph = recordedGraph(policy, intent.pins), entryOf = sha => inventories.find(e => e.release.sha256 === sha);
  // The saved release is not supplied here, so there is no checked release to compare: the saved intent's recorded package name and acquired
  // input are the only identity left, and a supplied release of either is another revision (reported, never substituted).
  const reasonFor = sha => {
    const name = intent.provenance.find(p => p.releaseSha256 === sha)?.package?.name, input = intent.inputs.find(i => i.releaseSha256 === sha);
    return inventories.some(e => e.release.sha256 !== sha && ((name !== undefined && e.release.package?.name === name)
      || (input && e.input && e.input.kind === input.kind && stable(e.input.locator) === stable(input.locator)))) ? 'revision-unavailable' : 'source-unavailable';
  };
  const mismatches = [], nodeEntries = new Map(), originEntries = new Map(), exclusionEntries = [], inputEntries = [], unavailableNodes = new Set(), undeterminedRoots = new Set(), resolvable = new Set(), closures = new Map(), refusals = new Map();
  const setProblem = checkRecordedSetChoices(intent, inventories);
  if (setProblem) mismatches.push({ code: 'INTENT_POLICY_CONTRADICTION', path: '/provenance', message: setProblem });
  for (const source of intent.provenance) {
    const entry = entryOf(source.releaseSha256); if (!entry) continue;
    const { [SET_CHOICES_KEY]: descriptiveChoices, ...savedSource } = source.materialSource;
    const expected = { ...entry.materialSource, ...(entry.internalContent ? { internalContent: entry.internalContent } : {}) };
    if (stable(savedSource) !== stable(expected) || stable(source.sources) !== stable(entry.release.sources) || source.package && stable(source.package) !== stable(entry.release.package)) mismatches.push({ code: 'SOURCE_IDENTITY_MISMATCH', path: '/provenance', message: 'Exact saved source, package or internal provenance differs from the checked source.' });
  }
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
    const evidence = live && complete ? liveClosure(index, root, skips, intent.pins) : undefined;
    if (evidence?.closure) for (const node of evidence.closure) nodes.add(node);
    else if (evidence) {
      complete = false; undeterminedRoots.add(key);
      const missing = missingRequirements(evidence.diagnostics, index.releases);
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
    // Closure keys are rootKey values; the displayed dependency set is the root's required closure.
    const dependencies = [...closures.get(rootKey(root))].filter(k => k !== rootKey(root)).map(k => { const [releaseSha256, itemId, scope] = k.split('/'); return { releaseSha256, itemId, scope }; });
    return { ...structuredClone(root), status: blockers.length ? 'unresolved' : 'resolved', dependencies,
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
async function compileScope({ policy, intent, inventories, analysis, roots, reviewEvidence, comparisons, recipient, originalBytes, tool = undefined, tools = undefined }) {
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
  const result = await buildReviewed({ intent: scoped, inventories, base: policy, originalBytes, reviewEvidence, comparisons, recipient, tool, tools });
  if (result.status !== 'ok') return result;
  const { policyBytes, intent: compiled, policy: composed, reviewJudgments, reviewSummary, reviewJudgmentDiagnostics } = result.value;
  return ok({ policyBytes, intent: compiled, policy: composed, scope: requested.map(rootRef),
    ...(reviewJudgments ? { reviewJudgments, reviewSummary } : { reviewJudgmentDiagnostics }) });
}
async function presentDraft({ envelopeBytes, envelope, savedIntentBytes, supported, policy, intent, inventories, reviewEvidence, comparisons, recipient, journeyDiagnostics = [], changes }) {
  let analysis;
  try { analysis = analyzeDraft({ intent, policy, inventories }); }
  catch (error) { return refuse('SOURCE_IDENTITY_MISMATCH', '/inventories', error.message, envelopeBytes); }
  if (analysis.mismatches.length) return { status: 'refused', diagnostics: analysis.mismatches, originalBytes: envelopeBytes.slice() };
  // Unsupported required records cannot be interpreted, so nothing may be compiled from this envelope.
  const unsupported = journeyDiagnostics.filter(d => d.code === 'JOURNEY_RECORD_UNSUPPORTED');
  const compiled = supported ? await compileScope({ policy, intent, inventories, analysis, reviewEvidence, comparisons, recipient, originalBytes: envelopeBytes })
    : { status: 'refused', diagnostics: unsupported.length ? unsupported : [{ code: 'JOURNEY_RECORD_UNSUPPORTED', path: '/records', message: 'The envelope has required records this version cannot interpret; compile is unavailable.' }] };
  return ok({ envelopeBytes: envelopeBytes.slice(), envelope, projection: projectJourneyEnvelope(envelope), supported, intent, editing: analysis.unresolved.length ? 'unresolved' : 'available',
    unresolved: analysis.unresolved, roots: analysis.roots, savedIntentBytes: savedIntentBytes.slice(),
    compile: compiled.status === 'ok' ? { status: 'available' } : { status: 'refused', reasons: compiled.diagnostics },
    diagnostics: [...availabilityDiagnostics(analysis.unresolved), ...journeyDiagnostics],
    ...(compiled.status === 'ok' && compiled.value.reviewJudgments ? { reviewJudgments: compiled.value.reviewJudgments, reviewSummary: compiled.value.reviewSummary } : await reviewView({ intent, inventories, reviewEvidence, comparisons, recipient })),
    ...(changes ? { changes } : {}) });
}
// `bytes` is a saved policy or a journey envelope; either reopens every recorded choice.
export async function openDraft({ bytes, inventories, reviewEvidence = [], comparisons = [], recipient } = {}) {
  if (!(bytes instanceof Uint8Array)) return refuse('INPUT_INVALID', '/bytes', 'Supply original policy or journey envelope bytes.');
  const context = { inventories, reviewEvidence, comparisons, recipient };
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
export async function compileDraft({ envelopeBytes, inventories, roots, reviewEvidence = [], comparisons = [], recipient, tool = undefined, tools = undefined } = {}) {
  const loaded = await loadDraft(envelopeBytes);
  if (loaded.status !== 'ok') return loaded;
  const { read, record, policy } = loaded.value;
  if (!read.supported) return refuse('JOURNEY_RECORD_UNSUPPORTED', '/records', 'The envelope has required records this version cannot interpret; compile is unavailable.', envelopeBytes);
  let analysis;
  try { analysis = analyzeDraft({ intent: record.intent, policy, inventories }); }
  catch (error) { return refuse('SOURCE_IDENTITY_MISMATCH', '/inventories', error.message, envelopeBytes); }
  if (analysis.mismatches.length) return { status: 'refused', diagnostics: analysis.mismatches, originalBytes: envelopeBytes.slice() };
  return compileScope({ policy, intent: record.intent, inventories, analysis, roots, reviewEvidence, comparisons, recipient, originalBytes: envelopeBytes, tool, tools });
}
// Safe edits of the recorded choices; each success is a new envelope revision.
export async function editDraft({ envelopeBytes, inventories, operation, reviewEvidence = [], comparisons = [], recipient, tool = undefined, tools = operation?.tools } = {}) {
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
  const changes = { removedRoots: [], removedOrigins: [], removedExclusions: [], addedRoots: [], removedPins: [] };
  const closureOf = root => before.closures.get(rootKey(root)) ?? reach(before.graph, rootKey(root));
  // Whether `root` still requires the choice `target`: Catalog's removal impact for a choice whose content is supplied, else the
  // recorded graph, since Catalog cannot resolve content it is not given (or a reference it refuses, such as one in an unavailable release).
  const requires = (root, target) => {
    if (before.resolvable.has(rootKey(root))) {
      const impact = resolveSelections({ releases: index.releases, roots: [{ releaseSha256: root.releaseSha256, itemId: root.itemId, scope: root.scope, configuration: root.configuration }],
        skips: before.skips, remove: [{ releaseSha256: target.releaseSha256, itemId: target.itemId, scope: target.scope }] });
      if (impact.status === 'ok') return impact.value.removalImpact.some(entry => entry.affectedRoots.some(affected => rootKey(affected) === rootKey(root)));
    }
    return closureOf(root).has(rootKey(target));
  };
  const dependentsOf = (target, retained) => retained.filter(r => rootKey(r) !== rootKey(target) && requires(r, target));
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
    if (operation.tool) pinSelectedRecipes(intent, inventories, root, operation.tool);
    const configured = configurePinned(found.entry, found.item, root.configuration, intent.pins);
    if (!configured.valid) return fail('INPUT_INVALID', '/operation/root/configuration', 'Catalog refused item configuration.', { owner: 'catalog', diagnostics: configured.diagnostics });
    return { found };
  };
  const draftRoot = (value, prior) => ({ releaseSha256: value.releaseSha256, itemId: value.itemId, itemSha256: index.items.get(pinKey(value)).item.itemSha256, scope: value.scope,
    configuration: structuredClone(value.configuration ?? {}), originIds: prior?.originIds ?? ['direct'], ...(prior?.reason !== undefined ? { reason: prior.reason } : {}) });
  try {
    if (operation.type === 'select-sets') {
      const selected = selectSetChoices({ intent, policy, inventories, sets: operation.sets, tool: operation.tool, releaseSha256: operation.releaseSha256, configurations: operation.configurations });
      if (selected.status !== 'ok') return unchanged(selected);
    } else if (operation.type === 'remove-root') {
      if (!isRef(operation.root)) return fail('INPUT_INVALID', '/operation/root', 'Supply {releaseSha256,itemId,scope}.');
      const target = operation.root, key = rootKey(target), found = intent.roots.find(r => rootKey(r) === key), retained = intent.roots.filter(r => r !== found);
      const dependents = dependentsOf(target, retained);
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
        const key = rootKey(root), dependents = dependentsOf(root, intent.roots);
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
    } else if (operation.type === 'mcp-approval') {
      // The one-server tick inside an open draft. The draft's pending choices live in its live intent
      // (the saved base is stale by design), so the approval recomposes THAT intent, renders exactly this
      // server, and rewrites the envelope with every recorded choice preserved.
      const target = intent.roots.find(candidate => rootKey(candidate) === rootKey(operation.root));
      if (!target) return fail('INPUT_INVALID', '/operation/root', 'The server is not part of this draft.');
      const entry = inventories.find(candidate => candidate.release.sha256 === target.releaseSha256);
      const item = entry?.release.items.find(candidate => candidate.id === target.itemId);
      if (!item || (item.kind !== 'mcp-server' && item.kind !== 'mcp')) return fail('INPUT_INVALID', '/operation/root', 'Only an MCP server can be allowed this way.');
      if (!entry.release.framework?.id) return fail('SOURCE_REVISION_UNAVAILABLE', '/operation/root', 'This exact source publishes no framework identity to name the approval.');
      const approval = { framework: entry.release.framework.id, itemId: item.id };
      // Base-aware: the draft's current saved policy is the retention base, so OTHER servers' recorded
      // approvals, selection identities and management metadata survive byte-for-byte where unchanged;
      // only this server's approval is rendered/removed. The base was already loaded and analyzed above
      // (mismatches refused), so build runs directly instead of re-reading through the editing-availability
      // gate - a draft may legitimately hold choices its saved base cannot resolve.
      const composed = await buildReviewed({ intent, inventories, base: policy, originalBytes: read.savedIntentBytes, reviewEvidence, comparisons, recipient, tool, tools,
        ...(operation.granted ? { grantApproval: approval } : { revokeApproval: approval }) });
      if (composed.status !== 'ok') return unchanged(composed);
      const known = read.records.filter(r => Object.hasOwn(JOURNEY_RECORD_KINDS, r.schema)).map(r => r === record ? { id: r.id, schema: r.schema, required: true, intent } : r);
      const written = await writeJourneyEnvelope({ savedIntentBytes: composed.value.policyBytes, records: known, previous: read });
      if (written.status !== 'ok') return unchanged(written);
      const presented = await presentDraft({ inventories, reviewEvidence, comparisons, recipient, envelopeBytes: written.value.envelopeBytes, envelope: written.value.envelope,
        savedIntentBytes: composed.value.policyBytes, supported: true, policy: composed.value.policy, intent, changes });
      return presented.status === 'ok' ? presented : unchanged(presented);
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
    const existing = intent.pins.find(p => pinKey(p) === key), found = index.items.get(key);
    return existing ? [existing] : found ? [{ releaseSha256: found.entry.release.sha256, itemId: found.item.id, itemSha256: found.item.itemSha256, recipe: found.item.recipe, materials: pinMaterials(found.item) }] : [];
  });
  const releases = new Set([...setChoiceSources(intent), ...pins.map(p => p.releaseSha256), ...intent.exclusions.map(e => e.releaseSha256), ...intent.origins.filter(o => o.kind === 'template').map(o => o.releaseSha256)]);
  const entryOf = sha => inventories.find(e => e.release.sha256 === sha);
  intent.pins = sorted(pins);
  intent.provenance = sorted([...releases].flatMap(sha => {
    const existing = intent.provenance.find(p => p.releaseSha256 === sha), entry = entryOf(sha);
    return existing ? [existing] : entry ? [{ releaseSha256: sha, package: entry.release.package, sources: entry.release.sources, materialSource: { ...entry.materialSource, ...(entry.internalContent ? { internalContent: entry.internalContent } : {}) } }] : [];
  }));
  intent.inputs = sorted([...releases].flatMap(sha => {
    const existing = record.intent.inputs.find(i => i.releaseSha256 === sha), entry = entryOf(sha);
    return existing ? [existing] : entry?.input ? [entry.input] : [];
  }));
  changes.removedPins = record.intent.pins.filter(p => !reached.has(pinKey(p))).map(p => ({ releaseSha256: p.releaseSha256, itemId: p.itemId }));
  const setProblem = checkRecordedSetChoices(intent, inventories);
  if (setProblem) return fail('INTENT_POLICY_CONTRADICTION', '/intent/provenance', setProblem);
  if (!checkIntentShape(intent)) return fail('FIELD_SEMANTICS_UNSUPPORTED', '/records/0/intent', 'Edited draft violates the supported saved-intent shape.');
  const known = read.records.filter(r => Object.hasOwn(JOURNEY_RECORD_KINDS, r.schema)).map(r => r === record ? { id: r.id, schema: r.schema, required: true, intent } : r);
  const written = await writeJourneyEnvelope({ savedIntentBytes: read.savedIntentBytes, records: known, previous: read });
  if (written.status !== 'ok') return unchanged(written);
  const presented = await presentDraft({ inventories, reviewEvidence, comparisons, recipient, envelopeBytes: written.value.envelopeBytes, envelope: written.value.envelope,
    savedIntentBytes: read.savedIntentBytes, supported: true, policy, intent, changes });
  return presented.status === 'ok' ? presented : unchanged(presented);
}
