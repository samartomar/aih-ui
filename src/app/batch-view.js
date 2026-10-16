// Plain presentation facts only. The host observes effects; this module never infers them.
export const CLIENT_NOTE = 'Listed by Core; not checked as installed or connected';
export const ATOMIC_NOTE = 'Each scope is applied separately; there is no all-or-nothing promise.';
export const RERUN_NOTE = 'Core cannot confirm whether this earlier process ran; run it again only if you know it is safe.';
export const STALE_CHOICE_NOTE = 'The batch changed since Run again was chosen, so the choice was dropped. Review the batch and choose again.';
export const UNSUPPORTED_NOTE = 'This envelope holds a required record this Workbench does not support. You can review the batch, but not run, recover or change it.';
const OUTCOMES = ['completed', 'failed', 'untouched', 'cancelled', 'unknown'];
// What a state means when the host gave no reason: said plainly, never left blank or guessed.
const DEFAULT_REASON = { completed: 'Core reported the work complete', untouched: 'No change observed' };
const knownOutcome = outcome => OUTCOMES.includes(outcome) ? outcome : 'unknown';
export const outcomeTone = outcome => ({ completed: 'success', failed: 'error', untouched: 'neutral', cancelled: 'neutral' })[outcome] ?? 'warning';
export const scopeRows = (projection, clients) => (projection?.scopes ?? []).map(scope => ({ ...scope,
  label: clients?.labels?.[scope.client] ?? scope.client, note: clients?.targets?.includes(scope.client) === false
    ? 'Not listed by Core; not checked as installed or connected' : CLIENT_NOTE }));
// `runAgain`: the choice is offered for every kept action Core cannot confirm (an opaque process). It is a choice for one run and is
// never read from the saved batch, so there is no "checked" fact here: the page renders every box unticked.
export const actionRows = projection => (projection?.actions ?? []).map(action => ({ ...action,
  dependencies: action.requires?.length ? action.requires.map(id => `${id} → ${action.id}`).join(', ') : 'No dependencies', retained: action.retain === true,
  runAgain: action.retain === true && action.unverifiable === true }));
// A Run again choice names the stored revision of the batch it was made against; it is sent with a review or a run and nowhere else.
export const rerunChoice = (ids, revision) => ids.length ? { rerun: ids, rerunRevision: revision } : {};
// The host refused a choice made before the last attempt on the batch.
export const isStaleChoice = result => (result?.diagnostics ?? []).some(item => item?.code === 'BATCH_RERUN_STALE');
// What the host said when it refused or failed, code first, as one line.
export const diagnosticsText = result => (result?.diagnostics ?? []).map(item => [item.code, item.message].filter(Boolean).join(': ')).join(' ') || 'The batch host gave no reason.';
export const canApply = (review, batchId) => Boolean(batchId && review?.batchId === batchId && review.ready === true
  && Array.isArray(review.conflicts) && review.conflicts.length === 0);
export function outcomeRows(report) {
  return [...(report?.actions ?? []).map(action => ({ ...action, label: action.id, outcome: knownOutcome(action.outcome), reason: action.reason ?? DEFAULT_REASON[knownOutcome(action.outcome)] ?? 'Not reported' })),
    ...(report?.scopes ?? []).map(scope => ({ id: `unrelated-${scope.id}`, scope: scope.id, label: 'Unrelated state',
      outcome: knownOutcome(scope.unrelated?.outcome), reason: scope.unrelated?.reason ?? DEFAULT_REASON[knownOutcome(scope.unrelated?.outcome)] ?? 'Not reported', files: scope.unrelated?.files }))];
}
export const outcomeCounts = report => OUTCOMES.map(outcome => ({ outcome,
  count: (report?.actions ?? []).filter(action => knownOutcome(action.outcome) === outcome).length }));
const coreCode = conflict => conflict.code ? `${conflict.code}${conflict.reason ? `:${conflict.reason}` : ''}` : 'no Core code reported';
// One readable sentence per host-reported conflict; a kind this view does not know is shown as reported, never hidden.
export function conflictText(conflict) {
  switch (conflict?.kind) {
    case 'core-conflict': return `Scope ${conflict.scope}: action ${conflict.action} cannot write ${conflict.target}; Core reports ${coreCode(conflict)}.`;
    case 'core-review': return `Scope ${conflict.scope}: Core could not prepare this scope (${conflict.status}; ${coreCode(conflict)}).`;
    case 'client-not-listed': return `Scope ${conflict.scope}: client ${conflict.client} is not in Core's published client list.`;
    case 'target-in-other-scope': return `Scope ${conflict.scope}: action ${conflict.action} targets ${conflict.target}, inside scope ${conflict.other}.`;
    case 'same-target': return `Scope ${conflict.scope}: actions ${conflict.other} and ${conflict.action} both target ${conflict.target}.`;
    case 'nested-roots': return `Scopes ${(conflict.scopes ?? []).join(' and ')} have overlapping folders.`;
    case 'shared-input': return `Shared input ${conflict.input} is ${conflict.reason ?? 'not as reviewed'}.`;
    case 'duplicate-selection': return `Scope ${conflict.scope}: action ${conflict.action} repeats a selection already in this review.`;
    default: return typeof conflict === 'string' ? conflict : JSON.stringify(conflict);
  }
}
