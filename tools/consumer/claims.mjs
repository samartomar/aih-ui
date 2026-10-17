// Consumer adapter from the Workbench's readiness records (and Scan report reads, estimates and
// usage) to Core's normalized claim set. Core validates and projects it (@aihq/core/report); this
// module only states what each record says, with its exact producer identity. It reads no clock,
// network or filesystem: callers pass the records and the reads they already hold.
//
// Rules: a claim never carries a machine-local path or free text from a check (reasons are Core
// codes); a claim's revision is its source record's sha256, so a re-import is the same claim and
// a same-id record with other content is a Core-visible conflict; unknown is never a value.
// A supplied estimate or usage entry never carries a machine-local path.
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

// A Core that reported its options but no configuration predates the option and checked with the process's
// trust; only an inspection that failed before Core answered (no effective option reported) is unknown.
const configurationOf = check => check?.options?.configuration
  ?? (Object.values(check?.options ?? {}).some(value => value !== null) ? 'process' : null);
const sameConfiguration = (a, b) => configurationOf(a) === null || configurationOf(b) === null || configurationOf(a) === configurationOf(b);

// The condition was broken before a repair only if it failed both for this host and with the persisted
// configuration; the persisted failure is then the precheck, the same configuration as the recheck. A pass in
// either is the precheck (already healthy); otherwise an unknown one is (unknown precondition). A record without
// the persisted inspection, from an older Workbench or Core, never pairs.
function precheckOf({ item, twin, condition, persisted }) {
  if (!persisted) return null;
  if (item.outcome === 'failed' && twin.outcome === 'failed') return persisted;
  if (item.outcome === 'passed') return condition;
  if (twin.outcome === 'passed') return persisted;
  return item.outcome === 'failed' ? persisted : condition;
}

const said = item => item.outcome === 'passed' || item.outcome === 'failed' ? item.outcome : `could not be confirmed (${item.reason || item.outcome})`;

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

// A claim names things by stable identity, never by a location on this machine: absolute POSIX
// and Windows paths, UNC shares, `~` and file: URLs are refused before any claim is built.
const LOCAL_PATH = /^(?:file:|~(?:[\\/]|$)|[\\/][^\\/]|[\\/]{2})|(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]|[\s=,;([:](?:~?\/|\\\\)[^\s\\/]/i;
export const isLocalPath = value => LOCAL_PATH.test(value);
function assertNoLocalPath(value, what) {
  if (typeof value === 'string' && isLocalPath(value)) throw new TypeError(`${what} looks like a machine-local path; supply a stable identifier instead.`);
}
// Every supplied string a claim keeps (ids, unit, amount, method, coverage) is checked, not a chosen few.
function assertSupplied(list, name) {
  // Keys are checked too, and never echoed: the label names only the entry.
  const walk = (value, at) => {
    if (typeof value === 'string') assertNoLocalPath(value, at);
    else if (value && typeof value === 'object') for (const [key, inner] of Object.entries(value)) { assertNoLocalPath(key, at); walk(inner, at); }
  };
  list.forEach((entry, index) => walk(entry, `${name}[${index}]`));
}

// A supplied claim's revision names its content, so an entry that repeats collapses and one that
// differs from another of the same event stays a separate claim, which Core reports as a conflict.
// FNV-1a over canonical JSON: deterministic, with no clock, randomness or crypto.
const canonical = value => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export function fingerprint(value) {
  let hash = 0xcbf29ce484222325n;
  for (const char of JSON.stringify(canonical(value))) hash = BigInt.asUintN(64, (hash ^ BigInt(char.codePointAt(0))) * 0x100000001b3n);
  return hash.toString(16).padStart(16, '0');
}

// Builds the validated claim set and its Core projection together, so a report projects once
// unless an urgent review has to be ranked by Core as well.
function assemble({ records = [], scanReports = [], estimates = [], usage = [], generatedAt = null } = {}) {
  assertSupplied(estimates, 'estimates');
  assertSupplied(usage, 'usage');
  const ordered = admit(records);
  const machines = ordered.filter(record => record.kind === 'machine-check');
  const repairs = ordered.filter(record => record.kind === 'repair');
  const latest = machines.at(-1) ?? null;
  // A repair taken after the latest machine check rechecked its targets: that check no longer describes them.
  const rechecked = new Set(latest ? repairs.filter(record => instant(record.capturedAt) > instant(latest.capturedAt))
    .flatMap(record => record.repair?.targets ?? []) : []);
  const claims = new Map();
  const add = claim => { const key = `${claim.id}\u0000${claim.revision}`; if (!claims.has(key)) claims.set(key, claim); return claim; };
  const recordSource = record => ({ id: record.id, schema: READINESS_RECORD_SCHEMA, sha256: record.sha256 });
  const machineClaim = (record, { id, observation, role, item, measure, applicability, status = record.check?.status }) => add({
    id, revision: record.sha256, producer: producer(), recordSchema: READINESS_RECORD_SCHEMA, subject: target(item.target),
    scope: { kind: 'machine', targets: [item.target] }, sources: [recordSource(record)], observation, capturedAt: record.capturedAt, measure,
    ...(role === 'check' ? { method: { ...CHECK_SET } } : {}), ...outcomeFields(item), coverage: coverageOf(status),
    authentication: unauthenticated(), applicability });

  // Machine checks: a configuration-check claim and a separate condition claim per Core check item, plus a condition
  // claim for the same check made with the persisted configuration when the record carries that inspection.
  const byMachine = new Map();
  for (const record of machines) {
    const base = record === latest ? current('This is the latest machine check.') : stale('A later machine check exists.');
    const found = [];
    const persisted = configurationOf(record.persistedCheck) === 'persisted' ? record.persistedCheck : null;
    const twins = new Map((persisted?.items ?? []).filter(item => item.kind === 'check').map(item => [item.id, item]));
    for (const item of record.check?.items ?? []) {
      const applicability = record === latest && rechecked.has(item.target)
        ? stale('A later repair recheck covered this target; run the machine check again.') : base;
      const loading = item.kind === 'observation';
      const checkClaim = machineClaim(record, { id: `${record.id}/check/${item.id}`, observation: `${record.id}/${item.id}/check`, role: 'check', item,
        measure: 'configuration-check', applicability: applicability() });
      const conditionClaim = loading ? null : machineClaim(record, { id: `${record.id}/condition/${item.id}`, observation: `${record.id}/${item.id}/condition`,
        role: 'condition', item, measure: `condition:${item.id}`, applicability: applicability() });
      const twin = conditionClaim && configurationOf(record.check) === 'process' ? twins.get(item.id) ?? null : null;
      const persistedClaim = twin ? machineClaim(record, { id: `${record.id}/persisted-condition/${item.id}`, observation: `${record.id}/${item.id}/persisted-condition`,
        role: 'condition', item: twin, measure: `condition:${item.id}`, applicability: applicability(), status: persisted.status }) : null;
      found.push({ item, check: checkClaim, condition: conditionClaim, twin, persisted: persistedClaim });
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

    // Core reported each applied, removed, modified or unowned persisted value the recheck found; its state is the value.
    for (const value of recheck?.persisted ?? []) add({
      id: `${record.id}/persisted/${value.id}`, revision: record.sha256, producer: producer(), recordSchema: READINESS_RECORD_SCHEMA,
      subject: { kind: 'persisted-configuration', id: value.id }, scope: { kind: 'machine', targets: [...repair.targets] }, sources: sources.map(source => ({ ...source })),
      observation: `${record.id}/${value.id}/persisted`, capturedAt: repair.recheckedAt, measure: 'persisted-configuration', kind: 'measured',
      value: { amount: value.state, unit: 'state' }, coverage: coverageOf(recheck.status), authentication: unauthenticated(), applicability: applicability() });

    // Only a persisted recheck can show the trust a repair persisted; a recheck that failed before Core answered has
    // no postcheck, so its precheck stays and the repair is reviewed.
    const beforeRecord = machineById.get(repair.before);
    const beforeFound = beforeRecord && configurationOf(recheck) !== 'process' ? byMachine.get(beforeRecord) ?? [] : [];
    const before = new Map(beforeFound.filter(entry => entry.condition && repair.targets.includes(entry.item.target)).map(entry => [entry.item.id, entry]));
    const conditions = new Map();
    for (const [id, entry] of before) conditions.set(id, entry.item.target);
    for (const [id, claim] of post) if (!conditions.has(id)) conditions.set(id, claim.subject.id);
    for (const [id, name] of conditions) attempts.push({ operation: repair.repairId, subject: target(name), condition: `condition:${id}`,
      precheck: before.has(id) && precheckOf(before.get(id)) ? ref(precheckOf(before.get(id))) : null, repair: ofTarget.has(name) ? ref(ofTarget.get(name)) : null,
      postcheck: post.has(id) ? ref(post.get(id)) : null });
  }

  // Consecutive machine checks with no repair of the target between them: a failure that later passed has an unknown cause.
  for (let index = 1; index < machines.length; index += 1) {
    const [older, newer] = [machines[index - 1], machines[index]];
    if (!sameConfiguration(older.check, newer.check)) continue;
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
    assertNoLocalPath(read.scanId, 'scan report id');
    assertNoLocalPath(read.report.schema, 'scan report schema');
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
  const supplied = (entry, index, measure, kind) => {
    const claim = { id: `${measure}/${entry.source.id}/${entry.subject.kind}:${entry.subject.id}/${entry.observation ?? `#${index}`}`,
      revision: entry.source.sha256 ?? entry.capturedAt, producer: producer(), recordSchema: entry.source.schema, subject: { ...entry.subject },
      scope: entry.scope ? { kind: entry.scope.kind, targets: [...entry.scope.targets] } : { kind: 'workspace', targets: [entry.subject.id] },
      sources: [{ ...entry.source }], observation: entry.observation ?? null, capturedAt: entry.capturedAt, measure, kind,
      value: { amount: entry.amount, unit: entry.unit }, ...(entry.method ? { method: { ...entry.method } } : {}),
      coverage: entry.coverage ? { ...entry.coverage } : { state: 'unknown', reason: 'Coverage was not reported.' }, authentication: unauthenticated(), applicability: noComparison() };
    const { revision, ...body } = claim;
    return { ...claim, revision: `${revision}~${fingerprint(body)}` };
  };
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
    if (rechecked.has(item.target)) continue; // reported once per target below
    if (item.outcome === 'failed') actions.push({ id: `blocker/${latest.id}/${item.id}`, category: 'blocker', subjects: [target(item.target)], evidence,
      reason: `The check ${item.id} failed on ${item.target} (${item.reason}).`, prerequisites: [], route: guidance(item.target, item.reason) });
    else if (item.outcome !== 'passed') actions.push({ id: `important-unknown/${latest.id}/${item.id}`, category: 'important-unknown', subjects: [target(item.target)], evidence,
      reason: item.kind === 'observation' ? `Loading of ${item.target} was observed but not verified.` : `The check ${item.id} on ${item.target} could not be confirmed (${item.reason}).`,
      prerequisites: [], route: guidance(item.target, item.reason) });
    // The two configurations disagree: say so, and keep this host's result as the machine's readiness. Unreadable
    // persisted configuration is already said once by the comparison, so it adds no action per check.
    if (entry.persisted && entry.twin.outcome !== item.outcome && entry.twin.reason !== 'persisted-configuration-unavailable') actions.push({ id: `important-unknown/${latest.id}/${item.id}/configuration`,
      category: 'important-unknown', subjects: [target(item.target)], evidence: [ref(entry.condition), ref(entry.persisted)],
      reason: `The check ${item.id} on ${item.target} ${said(item)} for this host but ${said(entry.twin)} with the configuration Core's managed repairs persist for a new process; the score uses this host's result.`,
      prerequisites: [], route: guidance(item.target, 'configuration-disagreement') });
  }
  for (const name of latest ? [...rechecked].filter(id => byMachine.get(latest).some(entry => entry.item.target === id)) : [])
    actions.push({ id: `important-unknown/${latest.id}/${name}/recheck`, category: 'important-unknown', subjects: [target(name)],
      evidence: byMachine.get(latest).filter(entry => entry.item.target === name).map(entry => ref(entry.check)),
      reason: `A repair rechecked ${name} after the latest machine check, so that check no longer describes it; run the machine check again.`,
      prerequisites: [], route: guidance(name, 'run-the-machine-check-again') });
  if (!usage.length) actions.push({ id: 'important-unknown/observed-usage', category: 'important-unknown', subjects: [{ kind: 'workbench', id: 'client-usage' }],
    evidence: [{ id: 'observed-usage/unavailable', revision: '1' }], reason: 'No client usage was observed, so usage is unknown rather than zero.',
    prerequisites: [], route: guidance('workbench', 'usage-unavailable') });
  const claimSet = { schema: CLAIMS_SCHEMA, claims: [...claims.values()], calculations, actions };
  const projectValid = candidate => {
    const validation = validateClaimSet(candidate);
    if (!validation.valid) throw new Error(`The readiness claim set is not valid: ${validation.errors.join('; ')}`);
    return projectClaims(candidate);
  };
  let projection = projectValid(claimSet);
  const ranked = actions.length;
  const urgent = { 'applied-unverified': 'was applied but the same check has not passed since', 'repair-not-verified': 'was applied but the same check still failed' };
  for (const result of projection.calculations.find(entry => entry.id === 'verified-repairs').attempts) {
    if (!urgent[result.reason]) continue;
    actions.push({ id: `urgent-review/${result.repair.id}/${result.condition}`, category: 'urgent-review', subjects: [{ ...result.subject }],
      evidence: [result.precheck, result.repair, result.postcheck].filter(Boolean).map(entry => ({ ...entry })),
      reason: `The repair ${result.operation} for ${result.subject.id} ${urgent[result.reason]}; check it again.`,
      prerequisites: [], route: guidance(result.subject.id, result.reason) });
  }
  // Urgent reviews join the set, so Core ranks it again; with none, the first projection stands.
  if (actions.length > ranked) projection = projectValid(claimSet);
  return { claimSet, projection };
}

export function readinessClaimSet(input = {}) {
  return assemble(input).claimSet;
}

export function readinessReport(input = {}) {
  return assemble(input);
}
