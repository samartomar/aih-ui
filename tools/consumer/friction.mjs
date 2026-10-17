// Consumer adapter from the stored Core results a host already holds (file state, native verification and the Workbench's readiness journal:
// machine-check and repair records) to Core's normalized claims 1.1.0, and Core's recurrence method over them (@aihq/core/report). This module only
// states what each stored result says about a subject the draft ties to a selected item; whether a failure came back after it recovered is Core's
// answer, not recomputed here. It collects nothing and reads no clock, network or file: callers pass the results they already hold.
//
// Rules: a claim never carries a machine-local path or free text from a result (reasons are Core codes); an untied subject is never
// requested; a result of any other schema is counted as unread, never an error; unknown is never a value, and missing history is never zero.
import { CLAIMS_SCHEMA_1_1_0, projectClaims, validateClaimSet } from '@aihq/core/report';
import { READINESS_RECORD_SCHEMA, fingerprint, isLocalPath } from './claims.mjs';
import { only, object, hash } from './intake.mjs';
import { isUtcTimestamp, MAINTENANCE_CHECK_RECORD_SCHEMA } from './maintenance-record.mjs';

export const FILE_STATE_SCHEMA = 'urn:aihq:core:file-state-result:1.0.0';
export const NATIVE_SCHEMA = 'urn:aihq:core:native-verification-result:1.0.0';
export const FRICTION_PRODUCER = Object.freeze({ id: 'aih-ui/friction', version: '1.0.0' });
export const MAX_EVIDENCE = 256, MAX_CLAIMS = 4096;
const FILE_STATE = 'condition:file-state', NATIVE_USE = 'condition:native-use';

// A claim names things by stable identity, never by a location on this machine (the refusal and the content fingerprint are claims.mjs's own).
const local = value => typeof value === 'string' ? isLocalPath(value)
  : value !== null && typeof value === 'object' && Object.entries(value).some(([key, inner]) => isLocalPath(key) || local(inner));
const fit = text => text.length <= 240 ? text : `${text.slice(0, 200)}~${fingerprint(text)}`;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
// Core's own reason codes only; anything else (free text, a path) is the generic code.
const code = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value) ? value : undefined;
const list = value => Array.isArray(value) ? value : [];

// What the draft ties to a selected item, by the key each result names it with.
function tiesOf(subjects) {
  const ties = { selections: new Map(), clients: new Map(), targets: new Map() };
  for (const tie of subjects) {
    if (tie.kind === 'managed-selection') ties.selections.set(tie.selectionId, tie);
    else if (tie.kind === 'client') ties.clients.set(tie.key, tie);
    else if (tie.kind === 'target') ties.targets.set(tie.key, tie);
  }
  return ties;
}
// One reading per subject and condition in one capture: { tie, subject, condition, outcome: passed|failed|unknown, reason?, scopeKind, complete }.
// A selection's targets fold to one outcome, so a passed and a failed target at one instant never tie in Core's order.
function fileStateReadings(result, ties) {
  const folds = new Map();
  for (const target of list(result.targets)) {
    const owners = new Set();
    for (const operationId of list(target?.operationIds)) {
      if (typeof operationId !== 'string') continue;
      for (let at = operationId.indexOf('/'); at > 0; at = operationId.indexOf('/', at + 1)) { const tie = ties.selections.get(operationId.slice(0, at)); if (tie) owners.add(tie); }
    }
    for (const tie of owners) {
      const fold = folds.get(tie) ?? { failed: 0, matched: 0, other: 0, reason: undefined };
      if (target.outcome === 'changed' || target.outcome === 'absent') fold.failed += 1;
      else if (target.outcome === 'match') fold.matched += 1;
      else { fold.other += 1; fold.reason ??= code(target.reason); }
      folds.set(tie, fold);
    }
  }
  return [...folds].map(([tie, fold]) => ({ tie, subject: { kind: 'managed-selection', id: tie.key }, condition: FILE_STATE, scopeKind: tie.scope === 'user' ? 'user-content' : 'repository', complete: result.status === 'complete',
    ...(fold.failed ? { outcome: 'failed' } : fold.other === 0 && fold.matched > 0 ? { outcome: 'passed' } : { outcome: 'unknown', reason: fold.reason ?? 'unavailable' }) }));
}
function nativeReadings(result, ties) {
  const client = result.client?.id, { os, execution } = result.platform ?? {};
  const tie = typeof client === 'string' ? ties.clients.get(client) : undefined, id = `${client}@${os}-${execution}`;
  if (!tie || !/^[a-z][a-z0-9-]*@[a-z0-9]+-[a-z0-9]+$/.test(id)) return [];
  const outcome = result.verdict === 'verified' ? { outcome: 'passed' } : result.verdict === 'failed' ? { outcome: 'failed' } : { outcome: 'unknown', reason: 'unverified' };
  return [{ tie, subject: { kind: 'client', id }, condition: NATIVE_USE, scopeKind: 'machine', complete: result.status === 'complete', ...outcome }];
}
// A published check id is kept whole, including the `/` Workbench readiness ids use (`claude/version`); Core takes any non-empty measure.
const checkId = id => typeof id === 'string' && id.length >= 1 && id.length <= 128 && !/[\u0000-\u001f\u007f]/.test(id) && !isLocalPath(id);
// A check is read with one of two trusts, each its own timeline. `condition:<id>` is this host's own trust. `persisted-condition:<id>` is the trust Core's
// repairs persist for a program started later, which a long-running host never loads: after a verified repair its own readings keep failing, so one timeline would
// call fail -> persisted pass -> fail a recurrence. A reading is a persisted one only when its projection reports that configuration.
const HOST_TRUST = id => `condition:${id}`, PERSISTED_TRUST = id => `persisted-condition:${id}`;
const persisted = projection => projection?.options?.configuration === 'persisted';
// The check rows of one stored projection (the host's check, its persisted check or a repair's recheck), `within` the targets it covers when given.
function checkReadings(projection, ties, conditionOf, within) {
  const readings = [];
  for (const item of list(projection?.items)) {
    const tie = item?.kind === 'check' && typeof item.target === 'string' && (within === undefined || within.includes(item.target)) ? ties.targets.get(item.target) : undefined;
    if (!tie || !checkId(item.id)) continue;
    const outcome = item.outcome === 'passed' || item.outcome === 'failed' ? { outcome: item.outcome } : { outcome: 'unknown', reason: code(item.reason) ?? code(item.outcome) ?? 'unavailable' };
    readings.push({ tie, subject: { kind: 'target', id: item.target }, condition: conditionOf(item.id), scopeKind: 'machine', complete: projection.status === 'complete', ...outcome });
  }
  return readings;
}
// A machine check is the host's trust beside the same check made with the persisted trust; a repair record's recheck was made with the persisted trust.
function readinessReadings(record, ties) {
  if (record.kind === 'machine-check') return [...checkReadings(record.check, ties, HOST_TRUST), ...(persisted(record.persistedCheck) ? checkReadings(record.persistedCheck, ties, PERSISTED_TRUST) : [])];
  const recheck = record.repair?.outcome?.condition;
  return persisted(recheck) ? checkReadings(recheck, ties, PERSISTED_TRUST, list(record.repair?.targets)) : [];
}
// The Workbench's maintenance-check note holds only { id: 'maintenance-check', checkedAt, categories: [{ category, state, reason? }] }. Recurrence needs a
// subject, a passed or failed outcome per check and more than the latest check, and the note has none of them (its id is the constant 'maintenance-check' and
// each save replaces it), so it is a known record that makes no claim, not an unread one.
// undefined when this module does not read the result.
function readingsOf(result, ties) {
  if (result.schema === FILE_STATE_SCHEMA) return fileStateReadings(result, ties);
  if (result.schema === NATIVE_SCHEMA) return nativeReadings(result, ties);
  if (result.schema === READINESS_RECORD_SCHEMA && (result.kind === 'machine-check' || result.kind === 'repair')) return readinessReadings(result, ties);
  if (result.schema === MAINTENANCE_CHECK_RECORD_SCHEMA) return [];
  return undefined;
}

// The stored results are the host's input, validated like the other check inputs; the message names the entry, never its content.
function checkEvidence(evidence) {
  if (!Array.isArray(evidence)) throw new TypeError('Supply the stored Core results as an array.');
  if (evidence.length > MAX_EVIDENCE) throw new TypeError(`Supply at most ${MAX_EVIDENCE} stored Core results.`);
  evidence.forEach((entry, index) => {
    const at = `evidence[${index}]`;
    if (!only(entry, ['id', 'capturedAt', 'result'], ['sha256', 'fixture']) || typeof entry.id !== 'string' || entry.id.length < 1 || entry.id.length > 128 || /[\u0000-\u001f\u007f]/.test(entry.id)
      || !isUtcTimestamp(entry.capturedAt) || !object(entry.result) || (entry.sha256 !== undefined && !hash(entry.sha256)) || (entry.fixture !== undefined && typeof entry.fixture !== 'boolean'))
      throw new TypeError(`${at} must be {id, capturedAt, result} with an optional sha256 and fixture flag.`);
    if (isLocalPath(entry.id)) throw new TypeError(`${at}.id looks like a machine-local path; supply a stable identifier instead.`);
  });
}

// `evidence`: the host's stored Core results, at most 256 of { id, sha256?, capturedAt, fixture?, result }. `subjects`: what the draft ties to a selected
// item, { kind: 'managed-selection' | 'client' | 'target', key, selectionId?, itemId, rootItemId, label, scope, goal? }. Returns the claim set, Core's
// projection, `results` (one per tied subject and condition with any claim: { tie, subject, condition, result: Core's recurrence result, stored: distinct
// stored results read, fixture }) and `unread` (stored results of a schema this module does not read).
export function frictionRecurrence({ evidence, subjects }) {
  checkEvidence(evidence);
  const ties = tiesOf(subjects), claims = new Map(), groups = new Map();
  let unread = 0;
  for (const entry of evidence) {
    const readings = readingsOf(entry.result, ties);
    if (readings === undefined) { unread += 1; continue; }
    for (const reading of readings) {
      const body = { producer: { ...FRICTION_PRODUCER }, recordSchema: entry.result.schema, subject: { ...reading.subject }, scope: { kind: reading.scopeKind, targets: [reading.subject.id] },
        sources: [{ id: entry.id, schema: entry.result.schema, ...(entry.sha256 ? { sha256: entry.sha256 } : {}) }], observation: fit(`${entry.id}/${reading.subject.id}/${reading.condition}`),
        capturedAt: entry.capturedAt, measure: reading.condition,
        ...(reading.outcome === 'unknown' ? { kind: 'unknown', unknownReason: reading.reason } : { kind: 'measured', value: { amount: reading.outcome, unit: 'outcome' } }),
        coverage: reading.complete ? { state: 'complete', reason: 'The stored Core result covers every selected check.' } : { state: 'partial', reason: 'The stored Core result was not complete.' },
        authentication: { status: 'not-authenticated' }, applicability: { state: 'unknown', reason: 'No later observation was compared with this one.', inputs: [] } };
      if (local(body)) continue;
      // The digest the host gives names the revision; otherwise the content does. A repeat of one claim is one claim; the same id and revision
      // with other content stays separate, which Core reports as a conflict.
      const print = fingerprint(body), claim = { id: body.observation, revision: entry.sha256 ?? print, ...body }, key = `${claim.id}\u0000${claim.revision}`;
      if (claims.has(key) && claims.get(key).print !== print) claim.revision = `${claim.revision}~${print}`;
      const stored = claims.get(`${claim.id}\u0000${claim.revision}`);
      if (!stored) claims.set(`${claim.id}\u0000${claim.revision}`, { claim, print });
      const groupKey = `${reading.subject.kind}\u0000${reading.subject.id}\u0000${reading.condition}`;
      const group = groups.get(groupKey) ?? { tie: reading.tie, subject: reading.subject, condition: reading.condition, refs: new Map(), entries: new Set(), fixture: false };
      group.refs.set(`${claim.id}\u0000${claim.revision}`, { id: claim.id, revision: claim.revision });
      group.entries.add(entry.id);
      group.fixture ||= entry.fixture === true;
      groups.set(groupKey, group);
    }
  }
  if (claims.size > MAX_CLAIMS) throw new TypeError(`The stored Core results make more than ${MAX_CLAIMS} claims; supply fewer.`);
  const ordered = [...groups.values()].map(group => ({ ...group, id: fit(`recurrence/${group.subject.kind}/${group.subject.id}/${group.condition}`) })).sort((a, b) => compare(a.id, b.id));
  const claimSet = { schema: CLAIMS_SCHEMA_1_1_0, claims: [...claims.values()].map(entry => entry.claim).sort((a, b) => compare(a.id, b.id) || compare(a.revision, b.revision)),
    calculations: ordered.map(group => ({ id: group.id, method: 'recurrence', version: '1.0.0', subject: { ...group.subject }, condition: group.condition,
      observations: [...group.refs.values()].sort((a, b) => compare(a.id, b.id) || compare(a.revision, b.revision)) })) };
  const validation = validateClaimSet(claimSet);
  if (!validation.valid) throw new TypeError(`The friction claim set is not valid: ${validation.errors.join('; ')}`);
  const projection = projectClaims(claimSet);
  return { claimSet, projection, unread, results: ordered.map((group, index) => ({ tie: group.tie, subject: { ...group.subject }, condition: group.condition,
    result: projection.calculations[index], stored: group.entries.size, fixture: group.fixture })) };
}
