// Pure machine-readiness projection. It reads Core's public result records
// (InspectResult, repair PreparationResult and RunResult) and states each
// condition as failed, unknown, applied, configured or verified. No filesystem,
// network, browser or package access: the host acquires the records, and the
// page and headless callers render the same projection.
//
// docs/readiness.md owns the status mapping; a result is ready only when it is complete,
// non-empty and every condition is verified.

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
  // An incomplete inspection is never ready, but a failure it did observe still leads.
  const state = worst([...sorted.map(item => item.state), ...(complete ? [] : ['unknown'])]);
  return { kind: 'machine-check', status: result.status, state, ready: complete && sorted.length > 0 && state === 'verified',
    summary: summarize(sorted), items: sorted,
    tools: (result.tools ?? []).filter(tool => tool.selection !== 'unselected').map(({ id, label, state: presence, selection }) => ({ id, label, presence, selection })),
    options: { targets: result.effectiveOptions?.targets?.value ?? null, network: result.effectiveOptions?.network?.value ?? null,
      configuration: result.effectiveOptions?.configuration?.value ?? null },
    persisted: persistedOf(result), diagnostics: diagnosticsOf(result), followUp: [...(result.followUp ?? [])] };
}

// What Core reported for each persisted value a `configuration: 'persisted'` inspection found
// (null for a process-configuration inspection). Its material and member paths are machine-local, so they are dropped.
function persistedOf(result) {
  if (!Array.isArray(result.persisted?.values)) return null;
  return result.persisted.values.map(({ id, repair, managementId, state, certificates, materialSha256 }) =>
    ({ id, repair, managementId, state, ...(state === 'applied' ? { certificates, materialSha256 } : {}) }));
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

// A post-repair inspection covers only the repair's targets, so it is never machine readiness.
// `scopeVerified` says whether those targets verified; `notRechecked` lists every other target of
// the latest machine check with its state there (null when no machine check was supplied).
function projectRecheck(inspection, { targets, latestCheck = null }) {
  const base = projectInspection(inspection);
  const scope = new Set(targets);
  let notRechecked = null;
  if (latestCheck) {
    const states = new Map((Array.isArray(latestCheck.options?.targets) ? latestCheck.options.targets : []).map(target => [target, []]));
    for (const tool of latestCheck.tools ?? []) if (!states.has(tool.id)) states.set(tool.id, []);
    for (const item of latestCheck.items ?? []) states.set(item.target, [...(states.get(item.target) ?? []), item.state]);
    notRechecked = [...states].filter(([target]) => !scope.has(target)).map(([target, found]) => ({ target, state: worst(found) }));
  }
  return { ...base, kind: 'repair-recheck', ready: false, scopeVerified: base.ready, scope: [...targets], notRechecked };
}

export function projectRepairOutcome({ run, recheck, inspection, repair, latestCheck = null }) {
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
  // Fresh-preparation work the run did not cover still needs changes.
  const covered = new Set(operations.map(item => item.id));
  const unresolved = [...rechecked].filter(([id, effects]) => !covered.has(id) && effects !== 'already-satisfied')
    .map(([id, effects]) => ({ id, effects, state: EFFECT_STATES[effects] ?? 'unknown', reason: EFFECT_REASONS[effects] ?? 'unrecognized' }));
  // The same condition, inspected after apply, governs the claim: a failure is failure, and
  // an unchecked or unavailable condition leaves the repair applied rather than verified.
  const condition = inspection ? projectRecheck(inspection, { targets: repair.targets, latestCheck }) : null;
  const complete = run?.completion === 'complete' || run?.completion === 'incomplete';
  let state = complete ? worst([...operations.map(item => item.state), ...unresolved.map(item => item.state)]) : 'unknown';
  if (complete && condition?.state === 'failed') state = 'failed';
  else if (state === 'verified' && !condition?.scopeVerified) state = 'applied';
  return { kind: 'repair-outcome', repairId: repair.id, targets: [...repair.targets], completion: run?.completion ?? 'unavailable', state,
    ready: run?.completion === 'complete' && operations.length > 0 && state === 'verified', operations: failureFirst(operations),
    recheck: recheck ? projectRepairPreparation(recheck, repair) : null, unresolved, condition, diagnostics: diagnosticsOf(run), followUp: [...(run?.followUp ?? [])] };
}

// Browser assets cannot import this module; keep target/state wording in sync with notRecheckedLine in src/app/readiness-view.js, preserving channel-specific instructions.
const notRecheckedText = projection => projection.notRechecked === null
  ? 'Other targets were not re-checked; run the machine check again before claiming machine readiness.'
  : projection.notRechecked.length ? `Not re-checked: ${projection.notRechecked.map(item => `${item.target} (${item.state} in the latest machine check)`).join(', ')}.`
    : 'Run the machine check again before claiming machine readiness.';

const persistedText = values => `Checked with the configuration Core's managed repairs persist for a new process: ${values.length
  ? values.map(value => `${value.id} ${value.state}${value.state === 'applied' ? ` (${value.repair}, ${value.certificates} certificate${value.certificates === 1 ? '' : 's'})` : ''}`).join(', ')
  : 'none found'}.`;

// Plain text for the developer's existing AI client. Producing or copying it executes nothing.
// A machine check marked `beforeRepair` is the latest full check, taken before the repair ran.
export function readinessGuidance(projections) {
  const lines = ['Machine readiness from AIH Workbench. Producing or copying this text executes nothing; any repair listed below was separately approved.', ''];
  for (const projection of projections) {
    if (projection.kind === 'machine-check' || projection.kind === 'repair-recheck') {
      const network = `${projection.status}, network ${projection.options.network ?? 'unknown'}`;
      if (projection.kind === 'repair-recheck') {
        lines.push(`Recheck of the repair's targets only: ${projection.scope.join(', ')} (${network}): ${projection.scopeVerified ? 'every checked condition verified for these targets' : 'not verified'}. This is not a machine readiness result.`);
        lines.push(notRecheckedText(projection));
      } else lines.push(`${projection.beforeRepair ? 'Latest machine check, taken before this repair' : 'Machine check'} (${network}): ${projection.ready ? 'ready' : 'not ready'}.`);
      if (projection.persisted) lines.push(persistedText(projection.persisted));
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
