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

const lostResult = () => ({
  status: 'lost',
  diagnostics: [{
    code: 'SESSION_LOST', reason: 'unknown-or-consumed-session',
    message: 'This preparation is no longer held by the host; prepare and approve again.'
  }]
});

// organizationSource (Enterprise only) is host configuration, never browser input.
export function createHost({ projectRoot, materialRoots, organizationSource, recipeMaterials = [], controls: hostControls, inventories, timingStore } = {}) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new TypeError('createHost requires a host-configured projectRoot');
  }
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

  const retain = preparation => {
    const result = { status: preparation.status, runId: preparation.runId, diagnostics: preparation.diagnostics,
      ...(preparation.resolutionInputs ? { resolutionInputs: preparation.resolutionInputs } : {}),
      ...(preparation.operationSelections ? { operationSelections: JSON.parse(JSON.stringify(preparation.operationSelections)) } : {}) };
    if (preparation.review) result.review = JSON.parse(JSON.stringify(preparation.review));
    if (preparation.prepared) {
      const sessionId = randomUUID();
      sessions.set(sessionId, { handle: preparation.prepared, reviewDigest: preparation.review.reviewDigest, runId: preparation.runId });
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
      const replacements = [];
      for (const update of updates) {
        const recordedTool = update.tool ?? tool;
        const root = { ...update.replacement, scope: update.replacement.scope ?? scope,
          configuration: update.configuration ?? update.replacement.configuration ?? {}, originIds: ['direct'] };
        const intent = freshAuthoring(); intent.roots.push(root);
        pinSelectedRecipes(intent, inventories, root, recordedTool);
        const grantApproval = update.approval === 'granted-by-aih' && update.item?.framework && update.item?.itemId
          ? { framework: update.item.framework, itemId: update.item.itemId } : undefined;
        const composed = await composeAuthoring({ intent, inventories, tool: recordedTool, ...(grantApproval ? { grantApproval } : {}) });
        if (composed.status !== 'ok') return { disposition: 'invalid', diagnostics: composed.diagnostics };
        // An update request names no Catalog release, so the replacement carries its rendered recipe inline.
        const selection = inlineRecipelessSelections({ policy: composed.value.policy, inventories }).selections.find(candidate => candidate.item?.itemId === root.itemId);
        if (!selection) return { disposition: 'invalid', diagnostics: [{ code: 'REPLACEMENT_UNAVAILABLE', message: `Catalog did not compose the explicit replacement ${root.itemId}.` }] };
        replacements.push({ managementId: update.managementId, replacement: { ...selection, managementId: update.managementId,
          ...(Array.isArray(update.origins) ? { origins: structuredClone(update.origins) } : {}) } });
      }
      const result = await prepareUpdate({ target: { project: projectRoot }, scope, updates: replacements }, controlsFor(controls));
      return { ...result, ...(result.preparation ? { preparation: retain(result.preparation) } : {}) };
    },
    async prepareFinishSession({ policyText, managementId, controls } = {}) {
      const parsed = parsePolicy(policyText);
      if (!parsed.valid) return { status: 'invalid', diagnostics: parsed.diagnostics };
      // Rendered within the whole setup, so a supporting document finished alone keeps its place beside the items requiring it.
      const selection = inlineRecipelessSelections({ policy: parsed.document, inventories }).selections.find(candidate => candidate.managementId === managementId);
      if (!selection) return { status: 'invalid', diagnostics: [{ code: 'SELECTION_UNAVAILABLE', message: 'Finish is available only while the interrupted selection is in the current setup.' }] };
      return this.prepareSession({ policyText: JSON.stringify({ ...parsed.document, selections: [{ ...selection, requires: [] }] }), controls });
    },
    async prepareSession({ policyText, resolutions, controls } = {}) {
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
      return { ...retain(preparation), authority };
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
      return result;
    }
  };
}
