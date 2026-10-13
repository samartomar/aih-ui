import { intakeDeclaration, digestBytes } from './intake.mjs';
import { composeAuthoring, readAuthoring, reconcileAuthoring, editAuthoring, freshAuthoring, stable, refuse, inspectReviewEvidence, recordReview, reconsiderReviews } from './headless.mjs';
import { noteFixture } from './note-fixture.mjs';
const encode = value => new TextEncoder().encode(value);
export async function createMixedService(maintained, { suppliedInventories } = {}) {
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
  const current = [maintained, notes], all = [maintained, notes, changed];
  const candidates = mode => mode === 'missing' ? [maintained] : mode === 'updated' ? [maintained, changed] : current;
  return {
    inventories: all,
    catalog() { return { executionAvailable: false, description: 'Real maintained Catalog content and independently authored review-note. Template is an authored demonstration.',
      items: current.flatMap(entry => entry.release.items.map(item => ({ ...item, root: root(entry, item), package: entry.release.package }))),
      templates: notes.templates.map(t => ({ ...t, releaseSha256: notes.release.sha256 })) }; },
    async run(operation, body) {
      const policyBytes = body.policyBytes ? Uint8Array.from(body.policyBytes) : undefined;
      const reviewEvidence = (body.reviewEvidence ?? []).map(bytes => Uint8Array.from(bytes)), comparisons = body.comparisons ?? [];
      const reviewContext = { reviewEvidence, comparisons };
      const evidenceBytes = Number.isSafeInteger(body.evidenceIndex) ? reviewEvidence[body.evidenceIndex] : Uint8Array.from(body.evidenceBytes ?? []);
      if (operation === 'new') return composeAuthoring({ intent: freshAuthoring(), inventories: all,
        ...(body.mode === 'enterprise' ? { basePolicyBytes: encode(JSON.stringify({ schema: 'urn:aihq:core:execution-policy:1.3.0', mode: 'enterprise', selections: [], metadata: { 'aih.workbench': freshAuthoring() } })) } : {}) });
      if (operation === 'read') return readAuthoring({ policyBytes, inventories: body.availability === 'missing' ? [maintained] : all, ...reviewContext });
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
