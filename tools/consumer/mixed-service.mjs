import { intakeDeclaration, digestBytes } from './intake.mjs';
import { composeAuthoring, readAuthoring, reconcileAuthoring, editAuthoring, freshAuthoring, stable, refuse, inspectReviewEvidence, recordReview, reconsiderReviews, openDraft, editDraft, compileDraft } from './headless.mjs';
import { checkMaintenance, recordMaintenance } from './maintenance.mjs';
import { noteFixture } from './note-fixture.mjs';
const encode = value => new TextEncoder().encode(value);
const bytesOf = value => Array.isArray(value) ? Uint8Array.from(value) : undefined;
export async function createMixedService(maintained, { suppliedInventories, familyInventories = [], maintenanceSource } = {}) {
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
      const policyBytes = body.policyBytes ? Uint8Array.from(body.policyBytes) : undefined;
      const reviewEvidence = (body.reviewEvidence ?? []).map(bytes => Uint8Array.from(bytes)), comparisons = body.comparisons ?? [];
      const reviewContext = { reviewEvidence, comparisons };
      const evidenceBytes = Number.isSafeInteger(body.evidenceIndex) ? reviewEvidence[body.evidenceIndex] : Uint8Array.from(body.evidenceBytes ?? []);
      if (operation === 'new') return composeAuthoring({ intent: freshAuthoring(), inventories: all,
        ...(body.mode === 'enterprise' ? { basePolicyBytes: encode(JSON.stringify({ schema: 'urn:aihq:core:execution-policy:1.3.0', mode: 'enterprise', selections: [], metadata: { 'aih.workbench': freshAuthoring() } })) } : {}) });
      const available = body.availability === 'missing' ? maintainedInventories : all;
      if (operation === 'read') return readAuthoring({ policyBytes, inventories: available, ...reviewContext });
      // Unresolved drafts travel as a journey envelope; bytes stay arrays of numbers over JSON.
      if (operation === 'draft-open') return openDraft({ bytes: bytesOf(body.bytes), inventories: available, ...reviewContext });
      if (operation === 'draft-edit') return editDraft({ envelopeBytes: bytesOf(body.envelopeBytes), inventories: available, operation: body.operation, ...reviewContext });
      if (operation === 'draft-compile') return compileDraft({ envelopeBytes: bytesOf(body.envelopeBytes), inventories: available, ...(Array.isArray(body.roots) ? { roots: body.roots } : {}), ...reviewContext });
      if (operation === 'maintenance-check' || operation === 'maintenance-record') {
        // With no draft open the saved policy is wrapped by the same pure open path (a sequence-1 envelope); a check writes nothing.
        let envelopeBytes = bytesOf(body.envelopeBytes);
        if (body.envelopeBytes === undefined) {
          if (!Array.isArray(body.bytes)) return refuse('INPUT_INVALID', '/envelopeBytes', 'Supply envelopeBytes, or the saved policy bytes when no draft is open.');
          const wrapped = await openDraft({ bytes: bytesOf(body.bytes), inventories: available, ...reviewContext });
          if (wrapped.status !== 'ok') return wrapped;
          envelopeBytes = wrapped.value.envelopeBytes;
        }
        const now = new Date().toISOString();
        if (operation === 'maintenance-record') {
          const recorded = await recordMaintenance({ envelopeBytes, operation: body.operation, now });
          if (recorded.status !== 'ok') return recorded;
          // The client adopts the new envelope exactly as an opened draft, so a recorded policy becomes a saved draft.
          const opened = await openDraft({ bytes: recorded.value.envelopeBytes, inventories: available, ...reviewContext });
          return opened.status === 'ok' ? { ...recorded, value: { ...recorded.value, draft: opened.value } } : { ...opened, originalBytes: (bytesOf(body.bytes) ?? envelopeBytes)?.slice() };
        }
        // Host-configured source only, and only when content is selected. Unreachable (null or a failure) is offline and
        // an unconfigured source is its own unknown: neither is an empty update list.
        const categories = body.categories ?? ['content'];
        const read = Array.isArray(categories) && categories.includes('content') && maintenanceSource;
        const candidateInventories = read ? await Promise.resolve().then(() => maintenanceSource()).catch(() => null) : null;
        return checkMaintenance({ envelopeBytes, inventories: all, candidateInventories: candidateInventories ?? null,
          candidateSource: maintenanceSource ? 'configured' : 'unconfigured', ...(body.categories !== undefined ? { categories: body.categories } : {}), now });
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
