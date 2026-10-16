// Consumer adapter from the Workbench's readiness records (and Scan report reads, estimates and
// usage) to Core's normalized claim set. Core validates and projects it (@aihq/core/report); this
// module only states what each record says, with its exact producer identity. It reads no clock,
// network or filesystem: callers pass the records and the reads they already hold.
//
// Rules: a claim never carries a machine-local path or free text from a check (reasons are Core
// codes); a claim's revision is its source record's sha256, so a re-import is the same claim and
// a same-id record with other content is a Core-visible conflict; unknown is never a value.
import { CLAIMS_SCHEMA, projectClaims, validateClaimSet } from '@aihq/core/report';

export const READINESS_RECORD_SCHEMA = 'urn:aih-ui:readiness-record:1.0.0';
export const CLAIMS_PRODUCER = Object.freeze({ id: 'aih-ui/readiness', version: '1.0.0' });
export const CHECK_SET = Object.freeze({ id: 'aih-ui/machine-check', version: '1.0.0' });
const USAGE_COLLECTION = { id: 'aih-ui/usage-collection', schema: 'urn:aih-ui:usage-collection:1.0.0' };
const EPOCH = '1970-01-01T00:00:00.000Z';

// Core rejects shared object references, so every claim gets fresh copies of these.
const producer = () => ({ ...CLAIMS_PRODUCER });
const unauthenticated = () => ({ status: 'not-authenticated' });
const ref = claim => ({ id: claim.id, revision: claim.revision });
const instant = value => Date.parse(value);
const target = id => ({ kind: 'target', id });
const coverageOf = status => status === 'complete' ? { state: 'complete', reason: 'Every selected check ran.' }
  : { state: 'partial', reason: `The check was ${status ?? 'not finished'}.` };
// Factories, not values: every claim needs its own `inputs` array.
const current = reason => () => ({ state: 'current', reason, inputs: [] });
const stale = reason => () => ({ state: 'recheck-needed', reason, inputs: [] });
const noComparison = () => ({ state: 'unknown', reason: 'No later observation was compared with this one.', inputs: [] });

// A claim from a check-like fact: Core outcome passed/failed is a measured value; anything else is unknown with the Core reason.
function outcomeFields(item) {
  if (item.outcome === 'passed' || item.outcome === 'failed') return { kind: 'measured', value: { amount: item.outcome, unit: 'outcome' } };
  return { kind: 'unknown', unknownReason: item.reason || item.outcome || 'unavailable' };
}

function admit(records) {
  const seen = new Set(), unique = [];
  for (const record of records) {
    if (record?.schema !== READINESS_RECORD_SCHEMA || !['machine-check', 'repair'].includes(record.kind) || typeof record.id !== 'string')
      throw new TypeError('Unsupported readiness record: expected schema, kind and id from the Workbench readiness host.');
    const key = `${record.id}\u0000${record.sha256}`;
    if (!seen.has(key)) { seen.add(key); unique.push(record); }
  }
  // Stable order by capture instant; input order breaks ties.
  return unique.map((record, index) => [record, index]).sort(([a, i], [b, j]) => instant(a.capturedAt) - instant(b.capturedAt) || i - j).map(([record]) => record);
}

export function readinessClaimSet({ records = [], scanReports = [], estimates = [], usage = [], generatedAt = null } = {}) {
  const ordered = admit(records);
  const machines = ordered.filter(record => record.kind === 'machine-check');
  const repairs = ordered.filter(record => record.kind === 'repair');
  const latest = machines.at(-1) ?? null;
  const claims = new Map();
  const add = claim => { const key = `${claim.id}\u0000${claim.revision}`; if (!claims.has(key)) claims.set(key, claim); return claim; };
  const recordSource = record => ({ id: record.id, schema: READINESS_RECORD_SCHEMA, sha256: record.sha256 });
  const machineClaim = (record, { id, observation, role, item, measure, applicability }) => add({
    id, revision: record.sha256, producer: producer(), recordSchema: READINESS_RECORD_SCHEMA, subject: target(item.target),
    scope: { kind: 'machine', targets: [item.target] }, sources: [recordSource(record)], observation, capturedAt: record.capturedAt, measure,
    ...(role === 'check' ? { method: { ...CHECK_SET } } : {}), ...outcomeFields(item), coverage: coverageOf(record.check?.status),
    authentication: unauthenticated(), applicability });

  // Machine checks: a configuration-check claim and a separate condition claim per Core check item.
  const byMachine = new Map();
  for (const record of machines) {
    const applicability = record === latest ? current('This is the latest machine check.') : stale('A later machine check exists.');
    const found = [];
    for (const item of record.check?.items ?? []) {
      const loading = item.kind === 'observation';
      const checkClaim = machineClaim(record, { id: `${record.id}/check/${item.id}`, observation: `${record.id}/${item.id}/check`, role: 'check', item,
        measure: 'configuration-check', applicability: applicability() });
      const conditionClaim = loading ? null : machineClaim(record, { id: `${record.id}/condition/${item.id}`, observation: `${record.id}/${item.id}/condition`,
        role: 'condition', item, measure: `condition:${item.id}`, applicability: applicability() });
      found.push({ item, check: checkClaim, condition: conditionClaim });
    }
    byMachine.set(record, found);
  }
  const machineById = new Map(machines.map(record => [record.id, record]));

  // Repairs: a repair claim per target when an operation was applied, and the post-repair condition claims.
  const attempts = [];
  const repairClaims = new Map();
  for (const record of repairs) {
    const { repair } = record;
    const applicability = machines.some(machine => instant(machine.capturedAt) > instant(record.capturedAt))
      ? stale('A later machine check exists.') : current('Taken after the latest machine check.');
    const sources = [recordSource(record), ...(repair.run ? [{ id: repair.run.id, schema: repair.run.schema }] : [])];
    const applied = (repair.outcome?.operations ?? []).some(operation => operation.application === 'applied');
    const completion = repair.outcome?.completion;
    const ofTarget = new Map();
    if (applied) for (const name of repair.targets) ofTarget.set(name, add({
      id: `${record.id}/repair/${name}`, revision: record.sha256, producer: producer(), recordSchema: READINESS_RECORD_SCHEMA, subject: target(name),
      scope: { kind: 'machine', targets: [name] }, sources: sources.map(source => ({ ...source })), observation: `${record.id}/${name}/repair`,
      capturedAt: repair.appliedAt, measure: 'repair', kind: 'measured', value: { amount: repair.repairId, unit: 'operation' },
      coverage: completion === 'complete' ? { state: 'complete', reason: 'The repair run completed.' } : { state: 'partial', reason: `The repair run was ${completion ?? 'unavailable'}.` },
      authentication: unauthenticated(), applicability: applicability() }));
    repairClaims.set(record, ofTarget);

    const recheck = repair.outcome?.condition;
    const post = new Map();
    for (const item of recheck?.items ?? []) if (item.kind === 'check' && repair.targets.includes(item.target)) post.set(item.id, add({
      id: `${record.id}/postcheck/${item.id}`, revision: record.sha256, producer: producer(), recordSchema: READINESS_RECORD_SCHEMA, subject: target(item.target),
      scope: { kind: 'machine', targets: [item.target] }, sources: sources.map(source => ({ ...source })), observation: `${record.id}/${item.id}/postcheck`,
      capturedAt: repair.recheckedAt, measure: `condition:${item.id}`, ...outcomeFields(item), coverage: coverageOf(recheck.status),
      authentication: unauthenticated(), applicability: applicability() }));

    const beforeFound = byMachine.get(machineById.get(repair.before)) ?? [];
    const before = new Map(beforeFound.filter(entry => entry.condition && repair.targets.includes(entry.item.target)).map(entry => [entry.item.id, entry]));
    const conditions = new Map();
    for (const [id, entry] of before) conditions.set(id, entry.item.target);
    for (const [id, claim] of post) if (!conditions.has(id)) conditions.set(id, claim.subject.id);
    for (const [id, name] of conditions) attempts.push({ operation: repair.repairId, subject: target(name), condition: `condition:${id}`,
      precheck: before.has(id) ? ref(before.get(id).condition) : null, repair: ofTarget.has(name) ? ref(ofTarget.get(name)) : null,
      postcheck: post.has(id) ? ref(post.get(id)) : null });
  }

  // Consecutive machine checks with no repair of the target between them: a failure that later passed has an unknown cause.
  for (let index = 1; index < machines.length; index += 1) {
    const [older, newer] = [machines[index - 1], machines[index]];
    const newerById = new Map(byMachine.get(newer).filter(entry => entry.condition).map(entry => [entry.item.id, entry]));
    for (const entry of byMachine.get(older)) {
      if (!entry.condition || entry.item.outcome !== 'failed' || !newerById.has(entry.item.id)) continue;
      const between = repairs.some(record => instant(record.capturedAt) > instant(older.capturedAt) && instant(record.capturedAt) < instant(newer.capturedAt)
        && record.repair.targets.includes(entry.item.target));
      if (between) continue;
      attempts.push({ operation: 'none', subject: target(entry.item.target), condition: `condition:${entry.item.id}`, precheck: ref(entry.condition),
        repair: null, postcheck: ref(newerById.get(entry.item.id).condition) });
    }
  }

  // Context: file size is measured from a supported Scan read; estimates and usage stay separate series.
  const scanned = new Set();
  for (const read of scanReports) {
    if (read?.status !== 'read' || !read.report?.source?.capture || scanned.has(read.scanId)) continue;
    scanned.add(read.scanId);
    const bytes = read.report.source.capture.entries.filter(entry => entry.kind === 'file' || entry.kind === 'file-link')
      .reduce((total, entry) => total + entry.byteLength, 0);
    const sha256 = /^scan:sha256:([0-9a-f]{64})$/.exec(read.scanId)?.[1];
    add({ id: `${read.scanId}/file-size`, revision: sha256 ?? read.scanId, producer: producer(), recordSchema: read.report.schema, subject: { kind: 'source', id: read.scanId },
      scope: { kind: 'repository', targets: [read.scanId] }, sources: [{ id: read.scanId, schema: read.report.schema, ...(sha256 ? { sha256 } : {}) }],
      observation: `${read.scanId}/file-size`, capturedAt: read.report.createdAt, measure: 'file-size', kind: 'measured', value: { amount: bytes, unit: 'bytes' },
      coverage: read.report.completion === 'complete' ? { state: 'complete', reason: 'The Scan report covers every selected file.' }
        : { state: 'partial', reason: `The Scan report was ${read.report.completion}.` },
      authentication: unauthenticated(), applicability: noComparison() });
  }
  const supplied = (entry, index, measure, kind) => ({ id: `${measure}/${entry.source.id}/${entry.subject.kind}:${entry.subject.id}/${entry.observation ?? `#${index}`}`,
    revision: entry.source.sha256 ?? entry.capturedAt, producer: producer(), recordSchema: entry.source.schema, subject: { ...entry.subject },
    scope: entry.scope ? { kind: entry.scope.kind, targets: [...entry.scope.targets] } : { kind: 'workspace', targets: [entry.subject.id] },
    sources: [{ ...entry.source }], observation: entry.observation ?? null, capturedAt: entry.capturedAt, measure, kind,
    value: { amount: entry.amount, unit: entry.unit }, ...(entry.method ? { method: { ...entry.method } } : {}),
    coverage: entry.coverage ? { ...entry.coverage } : { state: 'unknown', reason: 'Coverage was not reported.' }, authentication: unauthenticated(), applicability: noComparison() });
  estimates.forEach((entry, index) => add(supplied(entry, index, 'configured-context', 'estimated')));
  usage.forEach((entry, index) => add(supplied(entry, index, 'observed-usage', 'measured')));
  if (!usage.length) {
    const instants = [...claims.values()].map(claim => instant(claim.capturedAt)).filter(Number.isFinite);
    add({ id: 'observed-usage/unavailable', revision: '1', producer: producer(), recordSchema: USAGE_COLLECTION.schema, subject: { kind: 'workbench', id: 'client-usage' },
      scope: { kind: 'workspace', targets: ['workbench'] }, sources: [{ ...USAGE_COLLECTION }], observation: 'observed-usage/unavailable',
      capturedAt: generatedAt ?? (instants.length ? new Date(Math.max(...instants)).toISOString() : EPOCH), measure: 'observed-usage', kind: 'unknown',
      unknownReason: 'The Workbench collects no client usage.', coverage: { state: 'unknown', reason: 'No usage source is connected.' },
      authentication: unauthenticated(), applicability: noComparison() });
  }

  const calculations = [];
  if (latest) calculations.push({ id: 'configuration-check-score', method: 'configuration-check-score', version: '1.0.0', checkSet: { ...CHECK_SET },
    selected: byMachine.get(latest).map(entry => ref(entry.check)), inapplicable: [] });
  calculations.push({ id: 'verified-repairs', method: 'verified-repair-count', version: '1.0.0', attempts });

  // Actions. Blockers and unknowns come from the latest machine check; urgent reviews from Core's own attempt reasons.
  const actions = [];
  const guidance = (name, reason) => ({ kind: 'guidance', id: `${name}/${reason}` });
  for (const entry of latest ? byMachine.get(latest) : []) {
    const { item } = entry, evidence = [ref(entry.check)];
    if (item.outcome === 'failed') actions.push({ id: `blocker/${latest.id}/${item.id}`, category: 'blocker', subjects: [target(item.target)], evidence,
      reason: `The check ${item.id} failed on ${item.target} (${item.reason}).`, prerequisites: [], route: guidance(item.target, item.reason) });
    else if (item.outcome !== 'passed') actions.push({ id: `important-unknown/${latest.id}/${item.id}`, category: 'important-unknown', subjects: [target(item.target)], evidence,
      reason: item.kind === 'observation' ? `Loading of ${item.target} was observed but not verified.` : `The check ${item.id} on ${item.target} could not be confirmed (${item.reason}).`,
      prerequisites: [], route: guidance(item.target, item.reason) });
  }
  if (!usage.length) actions.push({ id: 'important-unknown/observed-usage', category: 'important-unknown', subjects: [{ kind: 'workbench', id: 'client-usage' }],
    evidence: [{ id: 'observed-usage/unavailable', revision: '1' }], reason: 'No client usage was observed, so usage is unknown rather than zero.',
    prerequisites: [], route: guidance('workbench', 'usage-unavailable') });
  const claimSet = { schema: CLAIMS_SCHEMA, claims: [...claims.values()], calculations, actions };
  let projected;
  try { projected = projectClaims(claimSet); } catch { return claimSet; } // readinessReport reports why the set is invalid.
  const urgent = { 'applied-unverified': 'was applied but the same check has not passed since', 'repair-not-verified': 'was applied but the same check still failed' };
  for (const result of projected.calculations.find(entry => entry.id === 'verified-repairs').attempts) {
    if (!urgent[result.reason]) continue;
    actions.push({ id: `urgent-review/${result.repair.id}/${result.condition}`, category: 'urgent-review', subjects: [{ ...result.subject }],
      evidence: [result.precheck, result.repair, result.postcheck].filter(Boolean).map(entry => ({ ...entry })),
      reason: `The repair ${result.operation} for ${result.subject.id} ${urgent[result.reason]}; check it again.`,
      prerequisites: [], route: guidance(result.subject.id, result.reason) });
  }
  return claimSet;
}

export function readinessReport(input = {}) {
  const claimSet = readinessClaimSet(input);
  const validation = validateClaimSet(claimSet);
  if (!validation.valid) throw new Error(`The readiness claim set is not valid: ${validation.errors.join('; ')}`);
  return { claimSet, projection: projectClaims(claimSet) };
}
