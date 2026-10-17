import { digestBytes, stable, refuse } from './primitives.mjs';
import { intakeDeclaration } from './intake.mjs';
import { composeAuthoring, readAuthoring, reconcileAuthoring, editAuthoring, freshAuthoring, inspectReviewEvidence, recordReview, reconsiderReviews, openDraft, editDraft, compileDraft } from './headless.mjs';
import { checkMaintenance, recordMaintenance } from './maintenance.mjs';
import { checkImprovements, recordImprovement } from './improvements.mjs';
import { readTrials, recordTrial, TRIAL_MECHANISMS_NONE } from './trials.mjs';
import { readWorkspace, editWorkspace, planBinding, bindCheckout, unbindCheckout, verifyBindings, exportWorkspace } from './workspace.mjs';
import { noteFixture } from './note-fixture.mjs';
import { runOrganizationAuthor } from './organization-author.mjs';
import { nativeClientIds } from '@aihq/core/harness';
import { RELEASE_ORDER_BASIS, RELEASE_ORDER_TEXT } from './release-order.mjs';
const encode = value => new TextEncoder().encode(value);
const bytesOf = value => Array.isArray(value) ? Uint8Array.from(value) : undefined;
const WORKSPACE_OPERATIONS = ['workspace-read', 'workspace-edit', 'workspace-plan', 'workspace-bind', 'workspace-unbind', 'workspace-verify', 'workspace-export'];
// `observeCheckout(root)` is the host's read of one local checkout (see ./workspace-host.mjs); a service made without one cannot inspect folders.
export async function createMixedService(maintained, { suppliedInventories, familyInventories = [], maintenanceSource, frictionEvidence, observeCheckout } = {}) {
  async function supplied(snapshot, id = 'notes') {
    const input = { id, kind: 'local', locator: { input: id }, resolvedIdentity: { sha256: await digestBytes(snapshot.declarationBytes) } };
    const result = await intakeDeclaration({ input, ...snapshot, materialSource: { kind: 'local', input: id } });
    if (result.status !== 'ok') throw new Error(JSON.stringify(result.diagnostics));
    return result.value;
  }
  const notes = suppliedInventories?.[0] ?? await supplied(await noteFixture());
  // Explicit authored demonstration template, not a maintained Catalog offering.
  const root = (entry, item) => ({ releaseSha256: entry.release.sha256, itemId: item.id, itemSha256: item.itemSha256, scope: item.scopes[0], configuration: {}, originIds: ['direct'] });
  async function template(entry) {
    const value = { id: 'authored.mixed-example', roots: entry.release.items.map(item => { const value = root(entry, item); delete value.originIds; return value; }) };
    return { ...value, sha256: await digestBytes(encode(stable(value))) };
  }
  notes.templates = [await template(notes)];
  const changed = suppliedInventories?.[1] ?? await supplied(await noteFixture('updated'), 'notes-next');
  changed.templates = [await template(changed)];
  const maintainedInventories = [maintained, ...familyInventories];
  const current = [...maintainedInventories, notes], all = [...current, changed];
  const candidates = mode => mode === 'missing' ? maintainedInventories : mode === 'updated' ? [...maintainedInventories, changed] : current;
  // The host's source is a fixture list of inventories or an update source's read; one that cannot be read at all is null.
  const readSource = async () => {
    const read = await Promise.resolve().then(() => maintenanceSource()).catch(() => null);
    return Array.isArray(read) ? { kind: 'test-fixture', inventories: read } : read && typeof read === 'object' ? read : null;
  };
  // Some roots read and some offline: what was read is used, but it is not a complete check of the source.
  const coverageOf = source => source?.inventories && source.sources?.some(entry => entry.state === 'offline') ? 'partial' : 'complete';
  const describeSource = source => ({ kind: source.kind, ...(source.releaseOrder ? { order: RELEASE_ORDER_BASIS, orderText: RELEASE_ORDER_TEXT } : {}), sources: source.sources ?? [] });
  // The host observes a folder only when asked, and a bind or verify always observes it again: nothing observed earlier is trusted.
  const observe = async root => typeof root !== 'string' ? refuse('INPUT_INVALID', '/root', 'Supply the checkout folder.')
    : observeCheckout ? Promise.resolve().then(() => observeCheckout(root)).catch(() => refuse('CHECKOUT_UNAVAILABLE', '/root', 'The checkout could not be observed.'))
    : refuse('CHECKOUT_UNAVAILABLE', '/root', 'This host does not inspect local checkouts.');
  async function runWorkspace(operation, body, { envelopeBytes, now, adopt }) {
    // A write is reopened as a draft so the client adopts it exactly like an opened draft; a read or export is not adopted.
    const adopted = async result => {
      if (result.status !== 'ok') return result;
      const opened = await adopt(result.value.envelopeBytes);
      return opened.status === 'ok' ? { status: 'ok', diagnostics: [], value: { draft: opened.value, projection: result.value.workspace, ...(result.value.binding ? { binding: result.value.binding } : {}) } } : { ...opened, originalBytes: envelopeBytes.slice() };
    };
    if (operation === 'workspace-read') return readWorkspace({ envelopeBytes });
    if (operation === 'workspace-edit') return adopted(await editWorkspace({ envelopeBytes, operation: body.operation, now }));
    if (operation === 'workspace-unbind') return adopted(await unbindCheckout({ envelopeBytes, bindingId: body.bindingId, now }));
    if (operation === 'workspace-export') {
      const exported = await exportWorkspace({ envelopeBytes });
      return exported.status === 'ok' ? { status: 'ok', diagnostics: [], value: { envelopeBytes: exported.value.envelopeBytes, excluded: exported.value.excluded } } : exported;
    }
    if (operation === 'workspace-verify') {
      const read = await readWorkspace({ envelopeBytes });
      if (read.status !== 'ok') return read;
      const observations = {};
      for (const binding of [...read.value.members.flatMap(member => member.bindings), ...read.value.detached]) {
        const observed = await observe(binding.checkout.root);
        observations[binding.id] = observed.status === 'ok' ? observed.value : observed;
      }
      return verifyBindings({ envelopeBytes, observations });
    }
    const observed = await observe(body.root);
    if (observed.status !== 'ok') return { ...observed, originalBytes: envelopeBytes.slice() };
    const input = { envelopeBytes, memberId: body.memberId, observation: observed.value, ...(body.replaces !== undefined ? { replaces: body.replaces } : {}) };
    return operation === 'workspace-plan' ? planBinding(input) : adopted(await bindCheckout({ ...input, ...(body.confirmation !== undefined ? { confirmation: body.confirmation } : {}), now }));
  }
  return {
    inventories: all,
    addInventory(inventory) {
      if (!all.some(entry => entry.release.sha256 === inventory.release.sha256)) all.push(inventory);
      if (!current.some(entry => entry.release.sha256 === inventory.release.sha256)) current.push(inventory);
    },
    catalog() { return { executionAvailable: false, description: 'Installed Catalog families and independently authored review-note. Template is an authored demonstration. Family grouping preserves upstream origins and exact identities.',
      items: current.flatMap(entry => entry.release.items.map(item => ({ ...item, root: root(entry, item), package: entry.release.package,
        family: entry.family ?? (entry === maintained ? 'Catalog' : 'Independent'),
        sources: entry.release.sources.filter(source => item.sourceIds.includes(source.id)) }))),
      templates: notes.templates.map(t => ({ ...t, releaseSha256: notes.release.sha256 })) }; },
    async run(operation, body) {
      if (typeof operation === 'string' && operation.startsWith('organization-')) return runOrganizationAuthor(operation, body, { inventories: all });
      const policyBytes = body.policyBytes ? Uint8Array.from(body.policyBytes) : undefined;
      const reviewEvidence = (body.reviewEvidence ?? []).map(bytes => Uint8Array.from(bytes)), comparisons = body.comparisons ?? [];
      const reviewContext = { reviewEvidence, comparisons, ...(body.recipient !== undefined ? { recipient: body.recipient } : {}) };
      const evidenceBytes = Number.isSafeInteger(body.evidenceIndex) ? reviewEvidence[body.evidenceIndex] : Uint8Array.from(body.evidenceBytes ?? []);
      if (operation === 'new') return composeAuthoring({ intent: freshAuthoring(), inventories: all,
        ...(body.mode === 'enterprise' ? { basePolicyBytes: encode(JSON.stringify({ schema: 'urn:aihq:core:execution-policy:1.3.0', mode: 'enterprise', selections: [], metadata: { 'aih.workbench': freshAuthoring() } })) } : {}) });
      const available = body.availability === 'missing' ? maintainedInventories : all;
      if (operation === 'read') return readAuthoring({ policyBytes, inventories: available, ...reviewContext });
      // Unresolved drafts travel as a journey envelope; bytes stay arrays of numbers over JSON.
      if (operation === 'draft-open') return openDraft({ bytes: bytesOf(body.bytes), inventories: available, ...reviewContext });
      if (operation === 'draft-edit') return editDraft({ envelopeBytes: bytesOf(body.envelopeBytes), inventories: available, operation: body.operation, ...reviewContext });
      if (operation === 'draft-compile') return compileDraft({ envelopeBytes: bytesOf(body.envelopeBytes), inventories: available, ...(Array.isArray(body.roots) ? { roots: body.roots } : {}), ...reviewContext });
      if (['maintenance-check', 'maintenance-record', 'improvements-check', 'improvements-record', 'trials-read', 'trials-record', ...WORKSPACE_OPERATIONS].includes(operation)) {
        // With no draft open the saved policy is wrapped by the same pure open path (a sequence-1 envelope); a check writes nothing.
        // Improvements share this branch, so recording on an ordinary saved policy saves it as a draft.
        let envelopeBytes = bytesOf(body.envelopeBytes);
        if (body.envelopeBytes === undefined) {
          if (!Array.isArray(body.bytes)) return refuse('INPUT_INVALID', '/envelopeBytes', 'Supply envelopeBytes, or the saved policy bytes when no draft is open.');
          const wrapped = await openDraft({ bytes: bytesOf(body.bytes), inventories: available, ...reviewContext });
          if (wrapped.status !== 'ok') return wrapped;
          envelopeBytes = wrapped.value.envelopeBytes;
        }
        const now = new Date().toISOString();
        if (WORKSPACE_OPERATIONS.includes(operation)) return runWorkspace(operation, body, { envelopeBytes, now, adopt: bytes => openDraft({ bytes, inventories: available, ...reviewContext }) });
        if (operation === 'improvements-check') {
          // The same host-configured source as the maintenance check; unreachable (null or a failure) is unknown, never "nothing changed".
          const source = maintenanceSource ? await readSource() : null;
          // Core's support list is the installed Core's own, read here; nothing the request carries can state it.
          return checkImprovements({ envelopeBytes, inventories: all, candidateInventories: source?.inventories ?? null, ...(source?.releaseOrder ? { releaseOrder: source.releaseOrder } : {}),
            candidateSource: maintenanceSource ? 'configured' : 'unconfigured', candidateCoverage: coverageOf(source),
            evidence: frictionEvidence ? await Promise.resolve().then(frictionEvidence).catch(() => null) : undefined,
            clients: body.clients ?? [], labels: body.labels ?? {}, coreClients: [...nativeClientIds], goal: body.goal, now });
        }
        // Reading trials writes nothing. This host can enforce no bound, so it has no mechanisms and every bound is advisory.
        if (operation === 'trials-read') return readTrials({ envelopeBytes, mechanisms: TRIAL_MECHANISMS_NONE });
        if (operation === 'maintenance-record' || operation === 'improvements-record' || operation === 'trials-record') {
          const recorded = await (operation === 'trials-record' ? recordTrial({ envelopeBytes, operation: body.operation, inventories: all, mechanisms: TRIAL_MECHANISMS_NONE, now })
            : (operation === 'maintenance-record' ? recordMaintenance : recordImprovement)({ envelopeBytes, operation: body.operation, now }));
          if (recorded.status !== 'ok') return recorded;
          // The client adopts the new envelope exactly as an opened draft, so a recorded policy becomes a saved draft.
          const opened = await openDraft({ bytes: recorded.value.envelopeBytes, inventories: available, ...reviewContext });
          return opened.status === 'ok' ? { ...recorded, value: { ...recorded.value, draft: opened.value } } : { ...opened, originalBytes: (bytesOf(body.bytes) ?? envelopeBytes)?.slice() };
        }
        // Host-configured source only, and only when content is selected. Unreachable (null or a failure) is offline and
        // an unconfigured source is its own unknown: neither is an empty update list.
        const categories = body.categories ?? ['content'];
        const read = Array.isArray(categories) && categories.includes('content') && maintenanceSource;
        const source = read ? await readSource() : null;
        const checked = await checkMaintenance({ envelopeBytes, inventories: all, candidateInventories: source?.inventories ?? null, ...(source?.releaseOrder ? { releaseOrder: source.releaseOrder } : {}),
          candidateSource: maintenanceSource ? 'configured' : 'unconfigured', candidateCoverage: coverageOf(source), ...(body.categories !== undefined ? { categories: body.categories } : {}), now });
        return checked.status === 'ok' && source ? { ...checked, value: { ...checked.value, updateSource: describeSource(source) } } : checked;
      }
      if (operation === 'compose') return composeAuthoring({ basePolicyBytes: policyBytes, intent: body.intent, inventories: all, ...reviewContext });
      if (operation === 'edit') return editAuthoring({ policyBytes, inventories: all, operation: body.operation, ...reviewContext });
      if (operation === 'reconcile') return reconcileAuthoring({ savedPolicyBytes: policyBytes, inventories: all, candidateInventories: candidates(body.candidateMode), ...reviewContext });
      if (operation === 'inspect-review') return inspectReviewEvidence({ evidenceBytes, inventory: all.find(entry => entry.release.sha256 === body.target?.releaseSha256), itemId: body.target?.itemId });
      if (operation === 'record-review') return recordReview({ policyBytes, inventories: all, evidenceBytes, target: body.target, finding: body.finding, decision: body.decision, ...reviewContext });
      if (operation === 'reconsider-reviews') return reconsiderReviews({ policyBytes, inventories: all, ...reviewContext });
      if (operation === 'intake') {
        const result = await intakeDeclaration({ ...body.snapshot, declarationBytes: Uint8Array.from(body.snapshot.declarationBytes),
          ...(body.snapshot.archiveBytes ? { archiveBytes: Uint8Array.from(body.snapshot.archiveBytes) } : {}),
          sourceFiles: body.snapshot.sourceFiles.map(source => ({ ...source, files: Object.fromEntries(Object.entries(source.files).map(([name, bytes]) => [name, Uint8Array.from(bytes)])) })) });
        if (result.status === 'ok') {
          if (!all.some(e => e.release.sha256 === result.value.release.sha256)) all.push(result.value);
          if (!current.some(e => e.release.sha256 === result.value.release.sha256)) current.push(result.value);
        }
        return result;
      }
      return refuse('INPUT_INVALID', '/operation', 'Unsupported authoring operation.', policyBytes);
    }
  };
}
