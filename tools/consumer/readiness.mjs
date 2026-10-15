// Pure machine-readiness projection. It reads Core's public result records
// (InspectResult, repair PreparationResult and RunResult) and states each
// condition as failed, unknown, applied, configured or verified. No filesystem,
// network, browser or package access: the host acquires the records, and the
// page and headless callers render the same projection.
//
// Mapping (see docs/readiness.md):
// - Inspect check: passed -> verified; failed -> failed; unavailable or skipped -> unknown.
// - A client whose installation was observed but whose loading was not checked -> configured.
// - Repair preparation: already-satisfied -> configured (files alone are not verification);
//   create/replace/remove or conflict -> failed; unavailable, opaque or not prepared -> unknown.
// - Repair run: application failed or verification failed -> failed; not attempted -> unknown;
//   applied without passing verification -> applied; already-satisfied without it -> configured;
//   passing verification -> verified only when a fresh preparation finds the operation satisfied.
// A result is ready only when it is complete, non-empty and every condition is verified.

export const READINESS_STATES = Object.freeze(['failed', 'unknown', 'applied', 'configured', 'verified']);
const rank = state => READINESS_STATES.indexOf(state);
const worst = states => states.length ? states.reduce((a, b) => rank(b) < rank(a) ? b : a) : 'unknown';
const failureFirst = items => items.map((item, index) => [item, index])
  .sort(([a, i], [b, j]) => rank(a.state) - rank(b.state) || i - j).map(([item]) => item);
const summarize = items => Object.fromEntries(READINESS_STATES.map(state => [state, items.filter(item => item.state === state).length]));
const CHECK_STATES = { passed: 'verified', failed: 'failed', unavailable: 'unknown', skipped: 'unknown' };
const EFFECT_STATES = { 'already-satisfied': 'configured', 'create-file': 'failed', 'replace-file': 'failed', 'remove-file': 'failed',
  conflict: 'failed', 'opaque-process': 'unknown', unavailable: 'unknown' };
const EFFECT_REASONS = { 'already-satisfied': 'in-place-not-verified', 'create-file': 'changes-needed', 'replace-file': 'changes-needed',
  'remove-file': 'changes-needed', conflict: 'conflict', 'opaque-process': 'not-observable', unavailable: 'unavailable' };
const diagnosticsOf = record => (record?.diagnostics ?? []).map(({ code, reason, message }) => ({ code, reason, message }));

export function projectInspection(result) {
  const guidanceFor = (target, reason) => result.repairChoices?.find(choice => choice.kind === 'manual-guidance'
    && choice.target === target && choice.reason === reason)?.guidance ?? null;
  const labels = new Map((result.tools ?? []).map(tool => [tool.id, tool.label]));
  const items = (result.checks ?? []).map(check => ({ id: check.id, kind: 'check', target: check.target, label: labels.get(check.target) ?? check.target,
    state: CHECK_STATES[check.outcome] ?? 'unknown', outcome: check.outcome, reason: check.reason, detail: check.detail ?? '',
    guidance: guidanceFor(check.target, check.reason) }));
  for (const observation of result.observations ?? []) if (observation.id.endsWith('/loading')) items.push({ id: observation.id, kind: 'observation',
    target: observation.target, label: labels.get(observation.target) ?? observation.target, state: 'configured', outcome: null,
    reason: 'loading-unverified', detail: observation.detail, guidance: guidanceFor(observation.target, 'loading-unverified') });
  const sorted = failureFirst(items);
  const complete = result.status === 'complete';
  const state = complete ? worst(sorted.map(item => item.state)) : 'unknown';
  return { kind: 'machine-check', status: result.status, state, ready: complete && sorted.length > 0 && state === 'verified',
    summary: summarize(sorted), items: sorted,
    tools: (result.tools ?? []).filter(tool => tool.selection !== 'unselected').map(({ id, label, state: presence, selection }) => ({ id, label, presence, selection })),
    options: { targets: result.effectiveOptions?.targets?.value ?? null, network: result.effectiveOptions?.network?.value ?? null },
    diagnostics: diagnosticsOf(result), followUp: [...(result.followUp ?? [])] };
}

export function projectRepairPreparation(preparation, repair) {
  const operations = (preparation?.review?.operations ?? []).map(operation => ({ id: operation.id, purpose: operation.purpose,
    effects: operation.effects, state: EFFECT_STATES[operation.effects] ?? 'unknown', reason: EFFECT_REASONS[operation.effects] ?? 'unrecognized' }));
  const prepared = ['ready', 'partial'].includes(preparation?.status) && operations.length > 0;
  const state = prepared ? worst(operations.map(item => item.state)) : 'unknown';
  return { kind: 'repair-condition', repairId: repair.id, targets: [...repair.targets], preparationStatus: preparation?.status ?? 'unavailable',
    state, ready: false, approvable: prepared && typeof preparation.sessionId === 'string' && typeof preparation.review?.reviewDigest === 'string',
    operations: failureFirst(operations), diagnostics: diagnosticsOf(preparation) };
}

export function projectRepairOutcome({ run, recheck, repair }) {
  const rechecked = new Map((['ready', 'partial'].includes(recheck?.status) ? recheck.review?.operations ?? [] : []).map(item => [item.id, item.effects]));
  const operations = (run?.operations ?? []).map(result => {
    const verification = result.verification?.status ?? 'unverified';
    let state, reason;
    if (result.application === 'failed' || verification === 'failed') [state, reason] = ['failed', result.application === 'failed' ? 'application-failed' : 'verification-failed'];
    else if (result.application === 'not-attempted') [state, reason] = ['unknown', 'not-attempted'];
    else if (verification !== 'passed') [state, reason] = result.application === 'applied' ? ['applied', `verification-${verification}`] : ['configured', `verification-${verification}`];
    else if (!rechecked.has(result.id)) [state, reason] = ['applied', 'recheck-unavailable'];
    else if (rechecked.get(result.id) === 'already-satisfied') [state, reason] = ['verified', 'verified-and-rechecked'];
    else [state, reason] = ['failed', 'recheck-not-satisfied'];
    return { id: result.id, application: result.application, verification, state, reason };
  });
  const complete = run?.completion === 'complete' || run?.completion === 'incomplete';
  const state = complete ? worst(operations.map(item => item.state)) : 'unknown';
  return { kind: 'repair-outcome', repairId: repair.id, targets: [...repair.targets], completion: run?.completion ?? 'unavailable', state,
    ready: run?.completion === 'complete' && operations.length > 0 && state === 'verified', operations: failureFirst(operations),
    recheck: recheck ? projectRepairPreparation(recheck, repair) : null, diagnostics: diagnosticsOf(run), followUp: [...(run?.followUp ?? [])] };
}

// Plain text for the developer's existing AI client. Producing it changes nothing.
export function readinessGuidance(projections) {
  const lines = ['Machine readiness from AIH Workbench. This is diagnostic context only; nothing has been changed or executed.', ''];
  for (const projection of projections) {
    if (projection.kind === 'machine-check') {
      lines.push(`Machine check (${projection.status}, network ${projection.options.network ?? 'unknown'}): ${projection.ready ? 'ready' : 'not ready'}.`);
      for (const item of projection.items) {
        lines.push(`- [${item.state}] ${item.id}: ${item.reason}${item.detail ? ` (${item.detail})` : ''}`);
        if (item.guidance) lines.push(`  Guidance: ${item.guidance}`);
      }
    } else {
      lines.push(`Repair ${projection.repairId} for ${projection.targets.join(', ')}: ${projection.state}.`);
      for (const item of projection.operations) lines.push(`- [${item.state}] ${item.id}: ${item.reason}`);
    }
    for (const diagnostic of projection.diagnostics ?? []) lines.push(`- diagnostic ${diagnostic.code}: ${diagnostic.message}`);
    lines.push('');
  }
  lines.push('Please explain the failures and propose steps I can run myself. Do not assume any condition is fixed until it is checked again.');
  return lines.join('\n');
}
