// Plain presentation facts only. The host observes effects; this module never infers them.
export const CLIENT_NOTE = 'Listed by Core; not checked as installed or connected';
export const ATOMIC_NOTE = 'Each scope is applied separately; there is no all-or-nothing promise.';
const OUTCOMES = ['completed', 'failed', 'untouched', 'cancelled', 'unknown'];
const knownOutcome = outcome => OUTCOMES.includes(outcome) ? outcome : 'unknown';
export const outcomeTone = outcome => ({ completed: 'success', failed: 'error', untouched: 'neutral', cancelled: 'neutral' })[outcome] ?? 'warning';
export const scopeRows = (projection, clients) => (projection?.scopes ?? []).map(scope => ({ ...scope,
  label: clients?.labels?.[scope.client] ?? scope.client, note: clients?.targets?.includes(scope.client) === false
    ? 'Not listed by Core; not checked as installed or connected' : CLIENT_NOTE }));
export const actionRows = projection => (projection?.actions ?? []).map(action => ({ ...action,
  dependencies: action.requires?.length ? action.requires.map(id => `${id} → ${action.id}`).join(', ') : 'No dependencies', retained: action.retain === true }));
export const canApply = (review, batchId) => Boolean(batchId && review?.batchId === batchId && review.ready === true
  && Array.isArray(review.conflicts) && review.conflicts.length === 0);
export function outcomeRows(report) {
  return [...(report?.actions ?? []).map(action => ({ ...action, label: action.id, outcome: knownOutcome(action.outcome), reason: action.reason ?? 'Not reported' })),
    ...(report?.scopes ?? []).map(scope => ({ id: `unrelated-${scope.id}`, scope: scope.id, label: 'Unrelated state',
      outcome: knownOutcome(scope.unrelated?.outcome), reason: scope.unrelated?.reason ?? 'Not reported', files: scope.unrelated?.files }))];
}
export const outcomeCounts = report => OUTCOMES.map(outcome => ({ outcome,
  count: (report?.actions ?? []).filter(action => knownOutcome(action.outcome) === outcome).length }));
