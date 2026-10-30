// UI-owned Node host. The live prepared handles never leave this module: the UI
// receives a serializable review and an opaque session id, and approval is an
// explicit digest-bound decision against the retained handle. Review JSON is
// never deserialized back into executable work.
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { apply, prepare, prepareManagedRemoval, prepareUpdate, listManagedSelections } from '@aihq/core';
import { parsePolicy } from '@aihq/core/contracts';
import { composeAuthoring, freshAuthoring, inlineRecipelessSelections, unsuppliedInputs } from './headless.mjs';
import { pinSelectedRecipes } from './selected-recipe.mjs';
import { pageSource, readOrganization } from './authority-source.mjs';
import { previewPolicyAuthority } from './organization.mjs';
import { createInstallRecord, selectionKey } from './install-record.mjs';

/**
 * Core's update request, prepared exactly as an install is: each replacement is the execution policy selection the
 * composition produced (recipe-less, with its binding digest, Scan records and item materials), and the request names
 * that policy's version, Catalog releases and Scan evidence, so Core renders, binds and checks it as at install.
 * A replacement can require only other replacements; Core keeps the dependency edges recorded at install.
 */
export function updateRequest({ project, scope, updates }) {
  const replacementIds = new Set(updates.map(({ selection }) => selection.id));
  const schemas = new Set(updates.map(({ policy }) => policy.schema)), releases = new Map(), evidence = new Map();
  if (schemas.size !== 1) return { diagnostics: [{ code: 'INPUT_INVALID', reason: 'policy-version-conflict', message: 'The replacements were composed in different execution policy versions.' }] };
  for (const { policy } of updates) {
    for (const release of policy.catalogReleases ?? []) {
      if (releases.has(release.framework) && JSON.stringify(releases.get(release.framework)) !== JSON.stringify(release))
        return { diagnostics: [{ code: 'INPUT_INVALID', reason: 'catalog-release-conflict', message: `The replacements name different bytes for the ${release.framework} Catalog release.` }] };
      releases.set(release.framework, release);
    }
    for (const entry of policy.evidence ?? []) evidence.set(JSON.stringify(entry), entry);
  }
  const policy = { schema: [...schemas][0],
    ...(releases.size ? { catalogReleases: [...releases.values()].sort((a, b) => a.framework < b.framework ? -1 : a.framework > b.framework ? 1 : 0) } : {}),
    ...(evidence.size ? { evidence: [...evidence.values()] } : {}) };
  const replacements = updates.map(({ managementId, selection, origins }) => ({ managementId, replacement: JSON.parse(JSON.stringify({ ...selection, managementId,
    ...(Array.isArray(origins) ? { origins } : {}), requires: (selection.requires ?? []).filter(id => replacementIds.has(id)) })) }));
  return { request: { target: { project }, scope, updates: replacements, policy } };
}
// What the host sent Core for an update, without its bytes: the policy version and, per replacement, whether Core renders
// its recipe and whether it carries its binding digest, Scan records and item materials.
const sentShape = request => ({ policy: request.policy.schema, catalogReleases: request.policy.catalogReleases?.length ?? 0,
  replacements: request.updates.map(({ managementId, replacement }) => ({ managementId, recipe: replacement.recipe === undefined ? 'rendered-by-core' : 'inline',
    bindingDigest: replacement.bindingDigest !== undefined, scanRecords: replacement.scanRecords !== undefined, itemMaterials: replacement.itemMaterials !== undefined })) });

/**
 * The selections a replacement requires that an update cannot leave to Core. Core keeps the edges recorded at install,
 * so a requirement may be left out of the replacement only when the target required it at install and it is still
 * installed; another replacement in the same request is kept. Every other requirement, such as a document the newer
 * item newly requires, is returned with the Catalog item it names and whether something installed already provides it.
 */
export function updateRequirements({ selection, policySelections, replacementIds, recordedRequires, installed }) {
  const byId = new Map(policySelections.map(candidate => [candidate.id, candidate]));
  return (selection.requires ?? []).filter(id => !replacementIds.has(id)).flatMap(id => {
    const required = byId.get(id), key = required && selectionKey(required.scope, required.managementId);
    if (key && recordedRequires?.includes(key) && installed.has(key)) return [];
    return [{ item: required?.item ? { framework: required.item.framework, itemId: required.item.itemId } : { itemId: id }, installed: Boolean(key && installed.has(key)) }];
  });
}
/** The root an update composes: the page's item and scope, with the configuration recorded when it was installed. */
export function updateRoot({ update, install, scope }) {
  const { configuration: _sent, ...replacement } = update.replacement;
  return { ...replacement, scope: replacement.scope ?? scope, configuration: structuredClone(install.configuration ?? {}), originIds: ['direct'] };
}
// What the install record keeps of each selection in a policy Core is asked to apply.
const installEntries = document => {
  const byId = new Map(document.selections.map(selection => [selection.id, selection]));
  return document.selections.map(selection => ({ id: selection.id, managementId: selection.managementId, scope: selection.scope,
    configuration: structuredClone(selection.configuration ?? {}),
    requires: (selection.requires ?? []).map(id => byId.get(id)).filter(Boolean).map(required => selectionKey(required.scope, required.managementId)) }));
};

const lostResult = () => ({
  status: 'lost',
  diagnostics: [{
    code: 'SESSION_LOST', reason: 'unknown-or-consumed-session',
    message: 'This preparation is no longer held by the host; prepare and approve again.'
  }]
});

// organizationSource (Enterprise only) is host configuration, never browser input.
export function createHost({ projectRoot, materialRoots, organizationSource, recipeMaterials = [], controls: hostControls, inventories, timingStore, installRecordRoot } = {}) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new TypeError('createHost requires a host-configured projectRoot');
  }
  // installRecordRoot is host configuration beside the setup store, never browser input. Without it nothing is recorded,
  // and an update cannot be checked against what was installed.
  const installRecord = installRecordRoot ? createInstallRecord({ root: installRecordRoot, project: projectRoot }) : null;
  const sessions = new Map(), awaitingInventory = new Set();
  const timings = timingStore ?? new Map(), pending = { resolve: 0, compatibility: 0, render: 0 };
  const addTiming = (runId, phase, elapsed) => {
    if (!runId) return;
    const record = timings.get(runId) ?? { runId, resolve: 0, compatibility: 0, render: 0, prepare: 0, apply: 0, inventory: 0 };
    record[phase] += elapsed;
    timings.set(runId, record);
  };
  const measure = async (phase, work) => {
    const started = performance.now();
    try { return await work(); }
    finally {
      const elapsed = performance.now() - started;
      if (Object.hasOwn(pending, phase)) pending[phase] += elapsed;
    }
  };

  const controlsFor = controls => ({
    ...hostControls, ...controls,
    materialRoots: controls?.materialRoots ?? materialRoots
  });

  const retain = (preparation, installs) => {
    const result = { status: preparation.status, runId: preparation.runId, diagnostics: preparation.diagnostics,
      ...(preparation.resolutionInputs ? { resolutionInputs: preparation.resolutionInputs } : {}),
      ...(preparation.operationSelections ? { operationSelections: JSON.parse(JSON.stringify(preparation.operationSelections)) } : {}) };
    if (preparation.review) result.review = JSON.parse(JSON.stringify(preparation.review));
    if (preparation.prepared) {
      const sessionId = randomUUID();
      sessions.set(sessionId, { handle: preparation.prepared, reviewDigest: preparation.review.reviewDigest, runId: preparation.runId, ...(installs ? { installs } : {}) });
      result.sessionId = sessionId;
    }
    return result;
  };
  const currentIndex = () => {
    if (inventories === undefined) return undefined;
    if (!inventories.length) return { offered: [] };
    const candidates = inventories.filter(entry => entry.release.framework?.id);
    if (!candidates.length || !candidates.every(entry => entry.release.items.every(item =>
      typeof item.contentSha256 === 'string' && item.contentSha256 && typeof item.behaviourSha256 === 'string' && item.behaviourSha256))) return undefined;
    const offered = candidates.flatMap(entry => entry.release.items.map(item => ({
      framework: entry.release.framework.id, itemId: item.id, contentSha256: item.contentSha256, behaviourSha256: item.behaviourSha256,
    })));
    const superseded = candidates.flatMap(entry => entry.release.items.flatMap(item => (item.supersedes ?? [])
      .filter(earlier => typeof earlier.itemId === 'string')
      .map(earlier => ({ item: { framework: entry.release.framework.id, itemId: earlier.itemId }, by: { framework: entry.release.framework.id, itemId: item.id } }))));
    return { offered, ...(superseded.length ? { superseded } : {}) };
  };
  async function inspectAuthority({ policyText, controls } = {}) {
    const parsed = parsePolicy(policyText);
    if (!parsed.valid) return { status: 'refused', diagnostics: parsed.diagnostics };
    if (parsed.document.mode === 'vibe') return { status: 'ok', value: { mode: 'vibe', advisory: true, authority: null, affectedChoices: [], stillValidChoices: [] }, diagnostics: [] };
    const read = await readOrganization({ organizationSource, controls: controlsFor(controls) });
    if (read.status === 'unreadable') return { status: 'refused', diagnostics: read.diagnostics, authority: { source: pageSource(read.read.source), helper: read.read.helper, accounting: read.read.accounting } };
    if (read.status === 'invalid') return { status: 'refused', diagnostics: read.diagnostics };
    // The organization permits recipes: a recipe-less selection is judged by the recipe Core renders for it.
    const result = await previewPolicyAuthority({ policy: inlineRecipelessSelections({ policy: parsed.document, inventories }), organization: read.organization, recipeMaterials, privateInputs: controlsFor(controls).privateInputs });
    return result.status === 'ok' ? { ...result, value: { ...result.value, authority: read.authority } } : { ...result, authority: read.authority };
  }
  return {
    inspectAuthority,
    measure,
    installTimings(runId) { const record = timings.get(runId); return record ? structuredClone(record) : null; },
    // Session ids still held, so a host replaced for another project folder can name what it discarded.
    heldSessions: () => [...sessions.keys()],
    // The redacted 1.1 projection is requested explicitly; without the format the 1.0 default would silently
    // drop recorded names/origins and the per-selection states the installed list renders (UI167). Core derives
    // update state only from this host's complete current index; absent/incomplete input remains unknown.
    async managedInventory() {
      const index = currentIndex(), started = performance.now();
      try { return await listManagedSelections({ target: { project: projectRoot }, scope: 'both', format: 'urn:aihq:core:managed-inventory-result:1.1.0', ...(index ? { index } : {}) }); }
      finally {
        const runId = awaitingInventory.values().next().value;
        if (runId) { addTiming(runId, 'inventory', performance.now() - started); awaitingInventory.delete(runId); }
      }
    },
    async prepareRemovalSession({ managementId, removals, scope, mode, controls } = {}) {
      // Removal reads Core's retained custody; it does not acquire recipe material. The array form is removal 1.2:
      // every selected item or exact set origin is prepared in one review and applied with one digest.
      const { authentication, signal, logging } = controlsFor(controls);
      const removalControls = { ...(authentication ? { authentication } : {}), ...(signal ? { signal } : {}), ...(logging ? { logging } : {}) };
      // Core accepts a local organization source only in the array form, so one managementId is sent as a one-entry array then.
      const local = mode === 'enterprise' && organizationSource?.provider === 'local' && managementId !== undefined;
      const request = removals || local
        ? { target: { project: projectRoot }, removals: removals ?? [{ managementId }], scope, mode, ...(mode === 'enterprise' ? { organizationSource } : {}) }
        : { target: { project: projectRoot }, managementId, scope, mode, ...(mode === 'enterprise' ? { organizationSource } : {}) };
      const result = await prepareManagedRemoval(request, removalControls);
      return { ...result, ...(result.preparation ? { preparation: retain(result.preparation) } : {}) };
    },
    async prepareUpdateSession({ updates = [], scope, tool, controls } = {}) {
      if (!inventories) return { disposition: 'unavailable', diagnostics: [{ code: 'SOURCE_UNAVAILABLE', message: 'The current Catalog inventories are unavailable.' }] };
      let recorded;
      try { recorded = installRecord?.read(); }
      catch (error) { return { disposition: 'unavailable', diagnostics: [{ code: 'RECORD_UNAVAILABLE', message: `This Workbench's record of what it installed cannot be read: ${error.message}` }] }; }
      const inventory = await listManagedSelections({ target: { project: projectRoot }, scope: 'both', format: 'urn:aihq:core:managed-inventory-result:1.1.0' });
      const installed = new Set((inventory.selections ?? []).map(selection => selectionKey(selection.scope, selection.managementId)));
      const composedUpdates = [];
      for (const update of updates) {
        const updateScope = update.replacement.scope ?? scope, install = recorded?.get(selectionKey(updateScope, update.managementId));
        if (!install) return { disposition: 'invalid', diagnostics: [{ code: 'INPUT_INVALID', reason: 'install-not-recorded', managementId: update.managementId,
          message: `${update.managementId} has no record of how this Workbench installed it.` }] };
        const recordedTool = update.tool ?? tool;
        const root = updateRoot({ update, install, scope: updateScope });
        const intent = freshAuthoring(); intent.roots.push(root);
        pinSelectedRecipes(intent, inventories, root, recordedTool);
        const grantApproval = update.approval === 'granted-by-aih' && update.item?.framework && update.item?.itemId
          ? { framework: update.item.framework, itemId: update.item.itemId } : undefined;
        const composed = await composeAuthoring({ intent, inventories, tool: recordedTool, ...(grantApproval ? { grantApproval } : {}) });
        if (composed.status !== 'ok') return { disposition: 'invalid', diagnostics: composed.diagnostics };
        // The replacement is the selection exactly as an install of it is composed, naming its Catalog release.
        const selection = composed.value.policy.selections.find(candidate => candidate.item?.itemId === root.itemId);
        if (!selection) return { disposition: 'invalid', diagnostics: [{ code: 'REPLACEMENT_UNAVAILABLE', message: `Catalog did not compose the explicit replacement ${root.itemId}.` }] };
        composedUpdates.push({ update, install, selection, policy: composed.value.policy });
      }
      const replacementIds = new Set(composedUpdates.map(({ selection }) => selection.id));
      // Nothing the newer item requires is dropped without a word: what Core does not already keep stops the update here.
      // Core does not check a requirement the newer item adds against what is installed.
      const missing = composedUpdates.flatMap(({ update, install, selection, policy }) =>
        updateRequirements({ selection, policySelections: policy.selections, replacementIds, recordedRequires: install.requires, installed }).map(requirement => ({
          code: 'INPUT_INVALID', reason: requirement.installed ? 'requirement-not-recorded' : 'requirement-not-installed', managementId: update.managementId, item: requirement.item,
          message: requirement.installed ? `${requirement.item.itemId} was not required when ${update.managementId} was installed.` : `${requirement.item.itemId} is not installed.` })));
      if (missing.length) return { disposition: 'invalid', diagnostics: missing };
      const sent = updateRequest({ project: projectRoot, scope, updates: composedUpdates.map(({ update, selection, policy }) => ({ managementId: update.managementId, selection, policy,
        ...(Array.isArray(update.origins) ? { origins: structuredClone(update.origins) } : {}) })) });
      if (!sent.request) return { disposition: 'invalid', diagnostics: sent.diagnostics };
      const installs = composedUpdates.map(({ update, install, selection }) => ({ ...install, id: selection.id,
        requires: [...new Set([...install.requires, ...(selection.requires ?? []).filter(id => replacementIds.has(id))
          .map(id => composedUpdates.find(other => other.selection.id === id)).map(other => selectionKey(other.selection.scope, other.update.managementId))])] }));
      // The Scan evidence and release index an install's checks read, and Apply reads again.
      const result = await prepareUpdate(sent.request, { ...controlsFor(controls), ...(currentIndex() ? { index: currentIndex() } : {}) });
      return { ...result, request: sentShape(sent.request), ...(result.preparation ? { preparation: retain(result.preparation, installs) } : {}) };
    },
    async prepareFinishSession({ policyText, managementId, controls } = {}) {
      const parsed = parsePolicy(policyText);
      if (!parsed.valid) return { status: 'invalid', diagnostics: parsed.diagnostics };
      // Rendered within the whole setup, so a supporting document finished alone keeps its place beside the items requiring it.
      const selection = inlineRecipelessSelections({ policy: parsed.document, inventories }).selections.find(candidate => candidate.managementId === managementId);
      if (!selection) return { status: 'invalid', diagnostics: [{ code: 'SELECTION_UNAVAILABLE', message: 'Finish is available only while the interrupted selection is in the current setup.' }] };
      return this.prepareSession({ policyText: JSON.stringify({ ...parsed.document, selections: [{ ...selection, requires: [] }] }), controls,
        installs: installEntries(parsed.document).filter(entry => entry.managementId === managementId) });
    },
    async prepareSession({ policyText, resolutions, controls, installs } = {}) {
      const parsed = parsePolicy(policyText);
      if (!parsed.valid) return { status: 'invalid', diagnostics: parsed.diagnostics };
      // The host's private inputs are offered for the selections of this policy only, so a narrower setup or one finished
      // selection is not refused for values it does not use.
      const held = controlsFor(controls).privateInputs ?? {};
      const privateInputs = Object.fromEntries(Object.entries(held).filter(([id]) => parsed.document.selections.some(selection => selection.id === id)));
      // An item whose required inputs cannot be supplied is named before Core is asked, and nothing is prepared or written.
      const needs = unsuppliedInputs({ policy: parsed.document, inventories, privateInputs });
      if (needs.length) return { status: 'invalid', needs, diagnostics: needs.map(entry => ({ code: 'INPUT_INVALID', reason: 'input-needed',
        path: `/selections/${parsed.document.selections.findIndex(selection => selection.id === entry.selectionId)}`,
        message: `${entry.name}: ${entry.inputs.map(input => `Needs ${input}`).join(', ')}` })) };
      const authority = await inspectAuthority({ policyText, controls });
      const started = performance.now(), preparation = await prepare(
        { useCase: 'policy', policy: parsed.document, target: { project: projectRoot },
          ...(resolutions ? { resolutions } : {}),
          ...(parsed.document.mode === 'enterprise' ? { organizationSource } : {}) },
        { ...controlsFor(controls), privateInputs, ...(currentIndex() ? { index: currentIndex() } : {}) }
      );
      for (const phase of Object.keys(pending)) { addTiming(preparation.runId, phase, pending[phase]); pending[phase] = 0; }
      addTiming(preparation.runId, 'prepare', performance.now() - started);
      return { ...retain(preparation, installs ?? installEntries(parsed.document)), authority };
    },

    async applyApproved({ sessionId, reviewDigest, origin = 'interactive', allowPartial = false, controls } = {}) {
      const session = sessions.get(sessionId);
      if (!session) return lostResult();
      if (reviewDigest !== session.reviewDigest) {
        return {
          status: 'rejected',
          reason: 'digest-mismatch',
          diagnostics: [{
            code: 'APPROVAL_REJECTED', reason: 'digest-mismatch',
            message: 'Approval must name the exact review digest returned by preparation.'
          }]
        };
      }
      sessions.delete(sessionId);
      const started = performance.now(), result = await apply(
        session.handle,
        { approved: true, origin, reviewDigest, ...(allowPartial ? { allowPartial: true } : {}) },
        { ...controlsFor(controls), ...(currentIndex() ? { index: currentIndex() } : {}) }
      );
      addTiming(session.runId, 'apply', performance.now() - started);
      awaitingInventory.add(session.runId);
      // A selection Core applied, in full or in part, is recorded as installed with what it was installed with.
      const applied = new Set([...(result.operations ?? []).filter(operation => ['applied', 'already-satisfied'].includes(operation.application)).map(operation => operation.id.split('/')[0]),
        ...(result.members ?? []).map(member => member.selectionId)]);
      const installs = (session.installs ?? []).filter(entry => applied.has(entry.id)).map(({ id: _id, ...entry }) => entry);
      if (installRecord && installs.length) {
        try { installRecord.record(installs); }
        catch (error) { return { ...result, diagnostics: [...(result.diagnostics ?? []), { code: 'RECORD_UNAVAILABLE', message: `Installed, but this Workbench could not record it, so it cannot be updated from here: ${error.message}` }] }; }
      }
      return result;
    }
  };
}
