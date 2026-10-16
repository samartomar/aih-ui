// Presentation of Core's claims projection (claims-projection 1.0.0). No DOM, Node built-ins,
// fetch or clock: the page renders reportPanels(), and reportText() prints the same strings,
// so the headless text can say nothing the panels did not. Every number comes from the
// projection; unknown is "Unavailable", never 0.
//
// A panel is { id, title, summary, tone, items: [{ id, tone, text, details }], sections? }.
// The score and repairs panels also carry a short `value` for the page's headline.
const KIND_LABELS = { measured: 'Measured', estimated: 'Estimated', declared: 'Declared', unknown: 'Unknown' };
const STATE_LABELS = { current: 'Current', 'recheck-needed': 'Recheck needed', unknown: 'Unknown', complete: 'Complete', partial: 'Partial' };
const CATEGORY_LABELS = { blocker: 'Blocker', 'urgent-review': 'Urgent review', 'important-unknown': 'Important unknown', 'optional-improvement': 'Optional improvement' };
const ATTEMPT_REASONS = {
  verified: 'the check failed, the repair was applied, and the same check then passed.',
  'already-healthy': 'already passed before any repair.',
  'unknown-cause': 'failed and later passed, but no repair was applied, so the cause is unknown.',
  'unknown-precondition': 'it was not known to have failed before the repair.',
  'external-repair': 'the change was made outside the Workbench.',
  'applied-unverified': 'the repair was applied but the same check has not passed afterwards.',
  'repair-not-verified': 'the repair was applied but the same check still failed afterwards.',
  'no-recovery': 'the condition did not recover.',
  uncorrelated: 'the records do not describe the same condition, subject and operation in order.',
  'conflicting-evidence': 'a record for this attempt conflicts with another record of the same event.',
};
const COMPARE_REASONS = {
  'unknown-value': 'one of the values is unknown', 'incomparable-measure': 'the values measure different things',
  'incomparable-kind': 'one value is measured and the other estimated', 'incomparable-unit': 'the units differ',
  'incomparable-method': 'the estimates use different methods', 'unsupported-kind': 'this kind of value cannot be compared',
  'unsupported-unit': 'this unit cannot be compared', 'invalid-amount': 'a value is not a usable amount',
};
const SERIES = [['file-size', 'Measured file size'], ['configured-context', 'Estimated configured context'], ['observed-usage', 'Observed usage']];
const SERIES_EMPTY = { 'file-size': 'No Scan report has been read.', 'configured-context': 'No estimate was supplied.',
  'observed-usage': 'Unavailable — no usage observation was supplied.' };
const ROLES = { check: 'check', condition: 'condition', postcheck: 'condition after repair', repair: 'repair' };

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const sentence = text => /[.!?]$/.test(text) ? text : `${text}.`;
const keyOf = ref => `${ref?.id}\u0000${ref?.revision}`;
const list = value => Array.isArray(value) ? value : [];
const item = (id, tone, text, details = []) => ({ id, tone, text, details });
const panel = (id, title, summary, tone, items = [], extra = {}) => ({ id, title, summary, tone, items, ...extra });

// Claim ids from the Workbench adapter read "<record>/<role>/<check id>"; any other id is shown by its measure.
const checkOf = id => { const [, role, ...rest] = String(id).split('/'); return ROLES[role] && rest.length ? rest.join('/') : null; };
const CONDITION = /^condition:/;
const conditionKey = measure => String(measure).replace(CONDITION, '');

export function reportPanels(projection) {
  const claims = list(projection?.claims);
  const byRef = new Map(claims.map(claim => [keyOf(claim), claim]));
  const label = ref => {
    const claim = byRef.get(keyOf(ref));
    if (!claim) return checkOf(ref?.id) ?? String(ref?.id ?? '');
    return `${checkOf(claim.id) ?? claim.measure} on ${claim.subject.id}`;
  };
  const calculation = method => list(projection?.calculations).find(result => result.method?.id === method);
  const valueText = claim => claim.kind === 'unknown' ? `Unavailable — ${claim.unknownReason}`
    : claim.value.unit === 'outcome' ? String(claim.value.amount) : `${claim.value.amount} ${claim.value.unit}`;
  const dedupText = claim => {
    const { status, canonical } = claim.dedup ?? { status: 'unique' };
    if (status === 'canonical') return 'Canonical record of an event imported more than once';
    if (status === 'duplicate') return `Duplicate of ${canonical ? label(canonical) : 'another record'}; counted once`;
    if (status === 'conflict') return 'Conflicts with another record of the same event; counted as unknown';
    if (status === 'unidentified') return 'No event identity; a re-import cannot be recognised';
    return 'Unique';
  };
  const claimTone = claim => claim.kind === 'unknown' ? 'warning' : claim.value.unit === 'outcome'
    ? ({ passed: 'success', failed: 'error' })[claim.value.amount] ?? 'neutral' : 'neutral';
  const claimItem = (claim, text) => item(`${claim.id}@${claim.revision}`, claimTone(claim), text, [
    `Kind: ${KIND_LABELS[claim.kind] ?? 'Unknown'}`,
    `Value: ${valueText(claim)}`,
    `Coverage: ${STATE_LABELS[claim.coverage?.state] ?? 'Unknown'} — ${sentence(claim.coverage?.reason ?? '')}`,
    `Freshness: ${STATE_LABELS[claim.applicability?.state] ?? 'Unknown'} — ${sentence(claim.applicability?.reason ?? '')} Captured ${claim.capturedAt}`,
    `De-duplication: ${dedupText(claim)}`,
    `Sources: ${list(claim.sources).map(source => `${source.id} (${source.schema}${source.sha256 ? `, sha256 ${source.sha256.slice(0, 12)}…` : ''})`).join('; ')}`,
  ]);

  // Score: unknown checks stay in the denominator; failed checks stay listed whatever the score.
  const scoreResult = calculation('configuration-check-score');
  let score;
  if (!scoreResult) score = panel('score', 'Configuration-check score', 'No machine check has been run, so there is no score.', 'warning', [], { value: 'Unavailable' });
  else if (scoreResult.status !== 'available' || scoreResult.score === null) score = panel('score', 'Configuration-check score',
    scoreResult.reason === 'no-applicable-checks' ? 'No applicable check was run, so there is no score.' : `The score is unavailable: ${scoreResult.reason}.`,
    'warning', [], { value: 'Unavailable' });
  else {
    // Truncate, never round up: 99.96 must not read as 100.
    const shown = `${Math.floor(scoreResult.score * 10) / 10}%`;
    const { failed, unknown } = scoreResult.counts;
    score = panel('score', 'Configuration-check score',
      `${scoreResult.numerator} of ${scoreResult.denominator} checks passed (${failed} failed, ${unknown} unknown). Unknown checks stay in the total.`,
      failed ? 'error' : unknown ? 'warning' : 'success', [], { value: shown });
  }
  if (scoreResult) {
    for (const ref of list(scoreResult.failed)) score.items.push(item(`failed:${keyOf(ref)}`, 'error', `Failed: ${label(ref)}`));
    for (const ref of list(scoreResult.conflicts)) score.items.push(item(`conflict:${keyOf(ref)}`, 'warning', `Conflicting record counted as unknown: ${label(ref)}`));
    for (const { claim, reason } of list(scoreResult.excluded)) score.items.push(item(`excluded:${keyOf(claim)}`, 'neutral', `Excluded: ${label(claim)}`, [`Reason: ${sentence(reason)}`]));
    if (scoreResult.deduplication?.status === 'not-established') score.items.push(item('dedup', 'warning',
      `Duplicate imports cannot be recognised for ${plural(list(scoreResult.deduplication.unidentified).length, 'check')} without an event identity.`));
  }

  // Repairs: Core's count; every attempt shows its own Core reason.
  const repairResult = calculation('verified-repair-count');
  const attempts = list(repairResult?.attempts);
  const repairItems = attempts.map((attempt, index) => {
    const condition = `${attempt.subject.id} ${conditionKey(attempt.condition)}`;
    const reason = ATTEMPT_REASONS[attempt.reason] ?? `see the Core reason.`;
    const text = attempt.counted ? `Counted — ${condition}: ${reason}` : `Not counted — ${condition}: ${reason}`;
    return item(`attempt:${index}`, attempt.counted ? 'success' : attempt.reason === 'applied-unverified' || attempt.reason === 'repair-not-verified' ? 'error' : 'neutral',
      text, [`Core reason: ${attempt.reason}`, `Operation: ${attempt.operation}`]);
  });
  const repairs = !repairResult
    ? panel('repairs', 'Verified repairs', 'No repair calculation is available.', 'neutral', [], { value: 'Unavailable' })
    : repairResult.status !== 'available'
      ? panel('repairs', 'Verified repairs', `The repair count is unavailable: ${repairResult.reason}.`, 'warning', [], { value: 'Unavailable' })
      : panel('repairs', 'Verified repairs', `${plural(repairResult.count, 'verified repair')}.${repairResult.count === 1
        ? ' A failed check, an applied repair and a passing recheck of the same check.' : ''}${attempts.length ? '' : ' No repair attempt has been recorded.'}`,
      repairResult.count ? 'success' : 'neutral', repairItems, { value: String(repairResult.count) });

  // Actions arrive ordered by Core; the view only labels them.
  const actions = list(projection?.actions);
  const actionPanel = panel('actions', 'Suggested actions', actions.length ? `${plural(actions.length, 'action')}, most urgent first.` : 'No action is suggested.',
    actions.some(action => action.category === 'blocker') ? 'error' : actions.length ? 'warning' : 'neutral',
    actions.map(action => item(action.id, action.category === 'blocker' ? 'error' : 'warning',
      `${action.order?.rank ?? ''}${action.order ? '. ' : ''}${CATEGORY_LABELS[action.category] ?? action.category} — ${action.reason}`,
      [`Route: ${action.route.kind} ${action.route.id}`, ...(list(action.evidence).length ? [`Evidence: ${action.evidence.map(label).join(', ')}`] : []),
        ...list(action.prerequisites).map(text => `Prerequisite: ${text}`)])));

  // Claims: the checks, conditions and repairs. Context claims have their own panel.
  const isContext = claim => !['configuration-check', 'repair', 'external-repair'].includes(claim.measure) && !CONDITION.test(claim.measure);
  const evidence = claims.filter(claim => !isContext(claim));
  const claimsPanel = panel('claims', 'Claims', evidence.length ? `${plural(evidence.length, 'claim')} behind the score and repairs.` : 'No check or repair claim has been recorded.',
    'neutral', evidence.map(claim => claimItem(claim, label(claim))));

  // Context: measured file size, estimated context and observed usage are never merged or compared here.
  const context = claims.filter(isContext);
  const measures = [...SERIES.map(([id]) => id), ...new Set(context.map(claim => claim.measure).filter(id => !SERIES.some(([known]) => known === id)))];
  const sections = measures.map(measure => {
    const title = SERIES.find(([id]) => id === measure)?.[1] ?? measure;
    const found = context.filter(claim => claim.measure === measure);
    const items = found.map(claim => claimItem(claim, `${KIND_LABELS[claim.kind]} — ${claim.subject.id}`));
    const known = found.filter(claim => claim.kind !== 'unknown').length;
    const summary = !found.length ? SERIES_EMPTY[measure] ?? 'No claim was supplied.'
      : known ? plural(known, 'value') + (known === found.length ? '.' : `, ${found.length - known} unavailable.`)
        : `Unavailable — ${found[0].unknownReason}`;
    return panel(measure, title, summary, known ? 'neutral' : 'warning', items);
  });
  const changes = list(projection?.calculations).filter(result => result.method?.id === 'context-change').map(result => {
    if (result.status !== 'available') return item(result.id, 'warning',
      `Context change ${result.id}: Unavailable — ${COMPARE_REASONS[result.reason] ?? 'the values cannot be compared'} (${result.reason}).`);
    const move = result.direction === 'unchanged' ? `unchanged at ${result.after} ${result.unit}`
      : `${result.direction} of ${result.absoluteDifference} ${result.unit}`;
    const percent = result.percentage === null ? 'no percentage: zero baseline'
      : `${Math.abs(result.percentage)}% ${result.direction === 'increase' ? 'increase' : result.direction === 'decrease' ? 'reduction' : 'change'}`;
    return item(result.id, 'neutral', `Context change ${result.id}: ${move} (${result.before} to ${result.after}${result.direction === 'unchanged' ? '' : `, ${percent}`}).`);
  });
  const contextPanel = panel('context', 'Context and usage', 'Estimated context and observed usage are separate; neither is compared with the other here.',
    'neutral', changes, { sections });

  // Observations: what was counted once, what conflicts, what has no event identity.
  const observed = projection?.observations ?? {};
  const observationItems = [
    ...list(observed.duplicates).map(entry => item(`duplicate:${entry.observation}`, 'neutral',
      `Counted once: ${label(entry.claim)} was imported ${entry.imports} times.`, [`Merged: ${list(entry.merged).map(label).join(', ')}`])),
    ...list(observed.conflicts).map(entry => item(`conflict:${entry.observation}`, 'warning',
      `Conflicting records for one event: ${list(entry.claims).map(label).join(', ')}. They are counted as unknown.`, [`Reason: ${entry.reason}`])),
    ...list(observed.unidentified).map(ref => item(`unidentified:${keyOf(ref)}`, 'warning', `No event identity: ${label(ref)}. A re-import cannot be recognised.`)),
  ];
  const observations = panel('observations', 'De-duplication', observationItems.length ? `${plural(observationItems.length, 'note')}.` : 'No duplicate, conflicting or unidentified event.',
    observationItems.some(entry => entry.tone === 'warning') ? 'warning' : 'neutral', observationItems);

  return { score, repairs, actions: actionPanel, claims: claimsPanel, context: contextPanel, observations };
}

// Headless rendering: panel strings only, plus list markers and indentation.
export function reportText(projection) {
  const lines = [];
  const write = (panelValue, depth) => {
    const pad = '  '.repeat(depth);
    lines.push(`${pad}${panelValue.title}`, `${pad}${panelValue.summary}`);
    for (const entry of panelValue.items) {
      lines.push(`${pad}- ${entry.text}`);
      for (const detail of entry.details) lines.push(`${pad}  ${detail}`);
    }
    for (const section of panelValue.sections ?? []) write(section, depth + 1);
  };
  Object.values(reportPanels(projection)).forEach((entry, index) => { if (index) lines.push(''); write(entry, 0); });
  return lines.join('\n');
}
