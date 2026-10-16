// Presentation of the machine-readiness projection (tools/consumer/readiness.mjs).
// No DOM and no fetch: the page renders these plain records, and headless tests
// check them against the projection, so the page can say nothing the projection
// did not. Only a verified state is toned as success; unknown never looks ready.
const STATES = ['failed', 'unknown', 'applied', 'configured', 'verified'];
const LABELS = { failed: 'Failed', unknown: 'Unknown', applied: 'Applied', configured: 'Configured', verified: 'Verified' };
const TONES = { failed: 'error', unknown: 'warning', applied: 'warning', configured: 'neutral', verified: 'success' };
const REASONS = {
  'changes-needed': 'Changes are needed on this machine.',
  'in-place-not-verified': 'In place, but not verified.',
  conflict: 'Existing content conflicts with the repair.',
  'not-observable': 'Cannot be observed.',
  unavailable: 'Could not be checked.',
  'application-failed': 'The change could not be applied.',
  'verification-failed': 'The change was applied but verification failed.',
  'not-attempted': 'Not attempted.',
  'verified-and-rechecked': 'Verified, and a fresh preparation finds this change in place.',
  'recheck-unavailable': 'Verification passed, but no fresh preparation was available.',
  'recheck-not-satisfied': 'Verification passed, but a fresh preparation still needs changes.',
  'loading-unverified': 'Installed or configured; loading was not verified.',
  'network-off': 'Skipped because the check ran offline.',
};

const known = state => STATES.includes(state) ? state : 'unknown';
export const stateLabel = state => LABELS[known(state)];
export const stateTone = state => TONES[known(state)];

const reasonText = reason => REASONS[reason]
  ?? (reason?.startsWith('verification-') ? `Applied, but verification was ${reason.slice('verification-'.length)}.` : reason ?? '');
const sourceRows = projection => ['machine-check', 'repair-recheck'].includes(projection?.kind) ? projection.items ?? [] : projection?.operations ?? [];

export function rowsFor(projection) {
  return sourceRows(projection).map(item => ({
    id: item.id, label: item.label ?? item.id, target: item.target ?? null, state: known(item.state), stateLabel: stateLabel(item.state),
    tone: stateTone(item.state), reason: item.reason ?? '', reasonText: reasonText(item.reason), detail: item.detail ?? '',
    guidance: item.guidance ?? null, purpose: item.purpose ?? null, effects: item.effects ?? null,
    application: item.application ?? null, verification: item.verification ?? null,
  }));
}

export function summaryCounts(projection) {
  const rows = rowsFor(projection);
  return STATES.map(state => ({ state, label: stateLabel(state), tone: stateTone(state), count: rows.filter(row => row.state === state).length }));
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

const targetList = targets => (targets ?? []).join(', ') || 'none';
// Which targets a scoped recheck left out, from the latest machine check.
// Browser assets cannot import tools/consumer/readiness.mjs; keep target/state wording in sync with notRecheckedText, preserving channel-specific instructions.
export function notRecheckedLine(projection) {
  if (!Array.isArray(projection?.notRechecked)) return 'Other targets were not re-checked; check this machine again before relying on it.';
  if (!projection.notRechecked.length) return 'Check this machine again to confirm machine readiness.';
  return `Not re-checked: ${projection.notRechecked.map(item => `${item.target} (${stateLabel(item.state).toLowerCase()} in the latest machine check)`).join(', ')}.`;
}

function countsText(projection) {
  const counts = Object.fromEntries(summaryCounts(projection).map(item => [item.state, item.count]));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const parts = [];
  if (counts.failed) parts.push(`${counts.failed} failed`);
  if (counts.unknown) parts.push(`${counts.unknown} unknown`);
  if (counts.applied) parts.push(`${counts.applied} applied but not verified`);
  if (counts.configured) parts.push(`${counts.configured} configured but not verified`);
  const detail = parts.length ? `${parts.join(', ')}.` : 'no condition is verified.';
  const checkDetail = projection.status !== 'complete'
    ? `the check was ${projection.status ?? 'not finished'}: ${parts.length ? parts.join(', ') : 'not every condition could be confirmed'}.`
    : total ? detail : 'nothing was checked.';
  return { counts, total, detail, checkDetail };
}

// Machine readiness ("Ready") is stated only for a machine check that says ready. A repair or
// a recheck of the repair's targets never claims it; other machine-check lines start "Not ready".
export function overallLine(projection) {
  if (!projection) return 'Not ready — no result yet.';
  if (projection.kind === 'machine-check' && projection.beforeRepair) return `Latest machine check, taken before this repair: ${overallLine({ ...projection, beforeRepair: false })}`;
  if (projection.kind === 'repair-recheck') {
    const scope = `Recheck of the repair's targets only (${targetList(projection.scope)})`;
    if (projection.scopeVerified === true) return `${scope}: every checked condition verified. This is not machine readiness. ${notRecheckedLine(projection)}`;
    return `${scope}: not verified — ${countsText(projection).checkDetail} ${notRecheckedLine(projection)}`;
  }
  if (projection.ready === true) return projection.kind === 'repair-outcome'
    ? `Repair verified — applied, verified and rechecked for ${targetList(projection.targets)}. This is not machine readiness.` : 'Ready — every condition was checked and verified.';
  const { counts, total, detail, checkDetail } = countsText(projection);
  const listed = `Not ready — ${detail}`;
  if (projection.kind === 'machine-check') return `Not ready — ${checkDetail}`;
  if (projection.kind === 'repair-condition') {
    if (!total) return `Not ready — the repair could not be prepared (${projection.preparationStatus ?? 'unavailable'}).`;
    return counts.failed ? `Not ready — the repair would make ${plural(counts.failed, 'change')}; nothing changes until you approve.` : listed;
  }
  if (projection.kind === 'repair-outcome') {
    // Every change can verify while the recheck of the repair's targets still disagrees.
    if (projection.unresolved?.length) return `Not ready — a fresh preparation still finds work outside this run: ${projection.unresolved.map(item => `${item.id} (${item.effects})`).join(', ')}.`;
    if (projection.condition?.state === 'failed' && !counts.failed) return "Not ready — the recheck of the repair's targets failed.";
    if (projection.state !== 'verified' && total && counts.verified === total) return "Not ready — the changes verified, but the recheck of the repair's targets did not confirm it.";
    if (!['complete', 'incomplete'].includes(projection.completion)) return `Not ready — the repair was ${projection.completion}; check this machine again before relying on it.`;
    return total ? listed : 'Not ready — the repair reported no operations.';
  }
  return listed;
}
