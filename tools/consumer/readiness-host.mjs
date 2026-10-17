// UI-owned machine-readiness host (Node only). It runs Core's read-only inspection and the
// host-configured npm repair. Like host.mjs, live prepared handles never leave this module:
// callers get serializable records and an opaque session id, approval is digest-bound and
// one-shot, and nothing here is built from browser-supplied paths or inputs.
import { createHash, randomUUID } from 'node:crypto';
import { apply, inspect, prepare } from '@aihq/core';
import { targets as coreTargets } from '@aihq/core/harness';
import { READINESS_RECORD_SCHEMA, readinessReport } from './claims.mjs';
import { projectConfigurationComparison, projectInspection, projectRepairOutcome, projectRepairPreparation, readinessGuidance } from './readiness.mjs';

const KNOWN_TARGETS = new Set(coreTargets.map(target => target.id));
const NETWORKS = ['declared', 'off'];
const MAX_SESSIONS = 8;
const MAX_RECORDS = 64;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const coreIdentity = inspection => inspection.package ? { name: inspection.package.name, version: inspection.package.version } : null;
const CONTROLS = Object.freeze({ logging: 'off' });
// Node reads NODE_EXTRA_CA_CERTS only when a process starts, so this long-running host cannot see the CA a
// repair persists. The machine check stays Core's default (this host's own trust) and is the machine's
// readiness; the same targets are also inspected with the trust Core's managed repairs persist for a new
// process, as evidence beside it. The post-repair recheck uses that persisted configuration.
const CONFIGURATION = 'persisted';
const persistedFailure = error => ({ status: 'incomplete', diagnostics: [{ code: 'PERSISTED_CHECK_FAILED', message: `Persisted-configuration check failed: ${error.message}` }] });
const failure = (code, message) => ({ status: 'error', diagnostics: [{ code, message }] });
const invalid = message => failure('INVALID_REQUEST', message);
const lost = () => ({ status: 'lost', diagnostics: [{ code: 'SESSION_LOST', reason: 'unknown-or-consumed-session',
  message: 'This preparation is no longer held by the host; prepare and approve again.' }] });
const rejected = (reason, message) => ({ status: 'rejected', diagnostics: [{ code: 'APPROVAL_REJECTED', reason, message }] });
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const targetsError = value => !Array.isArray(value) || value.length === 0 || new Set(value).size !== value.length
  || value.some(id => typeof id !== 'string' || !KNOWN_TARGETS.has(id)) ? 'targets must be a non-empty list of distinct Core target ids' : null;
const serialize = preparation => {
  const result = { status: preparation.status, diagnostics: preparation.diagnostics };
  if (preparation.review) result.review = JSON.parse(JSON.stringify(preparation.review));
  return result;
};

// Repairs are host configuration: { key, id, targets, inputs, network }. The `node` target
// writes the user's real environment on Windows, so the Workbench never offers it.
function normalizeRepairs(repairs) {
  const keys = new Set();
  return repairs.map(repair => {
    if (!isRecord(repair) || typeof repair.key !== 'string' || repair.key === '' || typeof repair.id !== 'string' || !isRecord(repair.inputs)
      || !NETWORKS.includes(repair.network) || targetsError(repair.targets)) throw new TypeError('A readiness repair needs key, id, targets, inputs and network');
    if (repair.targets.includes('node')) throw new TypeError('The node target is not offered by the readiness host');
    if (keys.has(repair.key)) throw new TypeError(`Duplicate readiness repair key ${repair.key}`);
    keys.add(repair.key);
    return Object.freeze({ key: repair.key, id: repair.id, targets: Object.freeze([...repair.targets]), inputs: structuredClone(repair.inputs), network: repair.network });
  });
}

export function createReadinessHost({ repairs = [], staged } = {}) {
  if (!Array.isArray(repairs)) throw new TypeError('repairs must be a list');
  if (staged !== undefined && (!isRecord(staged) || Object.keys(staged).some(key => !['label', 'detail'].includes(key))
    || typeof staged.label !== 'string' || !staged.label.trim() || staged.label.length > 200
    || (Object.hasOwn(staged, 'detail') && (typeof staged.detail !== 'string' || staged.detail.length > 1000)))) {
    throw new TypeError('staged needs a non-empty label (at most 200 characters) and optional detail (at most 1000 characters)');
  }
  const staging = staged === undefined ? undefined : Object.freeze({ label: staged.label, ...(Object.hasOwn(staged, 'detail') ? { detail: staged.detail } : {}) });
  const configured = normalizeRepairs(repairs);
  const sessions = new Map();
  // The latest machine check lets a repair outcome say which targets its recheck did not cover.
  let latestCheck = null;
  let latestCheckId = null;
  let latestComparison = null;
  const journal = [];
  let lastStamp = 0;
  const stamp = () => {
    lastStamp = Math.max(Date.now(), lastStamp + 1);
    return new Date(lastStamp).toISOString();
  };
  const append = record => {
    journal.push(structuredClone(record));
    if (journal.length > MAX_RECORDS) journal.shift();
  };
  const request = repair => ({ useCase: 'repair', repairs: [{ id: repair.id, targets: [...repair.targets], inputs: structuredClone(repair.inputs) }], network: repair.network });
  const operationView = operation => ({ id: operation.id, purpose: operation.purpose, kind: operation.kind, scope: operation.scope,
    effects: operation.effects, target: operation.details?.target ?? null });

  return {
    records() { return structuredClone(journal); },

    async report() {
      try {
        const records = structuredClone(journal);
        // The host clock, never earlier than the latest journaled instant.
        const generatedAt = new Date(Math.max(Date.now(), lastStamp)).toISOString();
        const { claimSet, projection } = readinessReport({ records, generatedAt });
        return { status: 'ok', value: { records: records.length, claimSet, projection } };
      } catch (error) { return failure('REPORT_FAILED', error.message); }
    },

    async check(body = {}) {
      if (!isRecord(body)) return invalid('The request must be an object');
      const { targets, network } = body;
      if (targets !== undefined && targetsError(targets)) return invalid(targetsError(targets));
      if (network !== undefined && !NETWORKS.includes(network)) return invalid('network must be declared or off');
      try {
        const scope = { ...(targets ? { targets } : {}), ...(network ? { network } : {}) };
        const result = await inspect(scope);
        // Same targets and network authority, one after the other; a failure here leaves the comparison unavailable.
        const persistedResult = await inspect({ ...scope, configuration: CONFIGURATION }).catch(persistedFailure);
        const capturedAt = stamp();
        const projection = projectInspection(result);
        const persistedCheck = projectInspection(persistedResult);
        const comparison = projectConfigurationComparison(projection, persistedCheck);
        const id = randomUUID();
        append({ schema: READINESS_RECORD_SCHEMA, id, kind: 'machine-check', capturedAt, sha256: digest({ result, persistedResult }), core: coreIdentity(result),
          check: projection, persistedCheck });
        latestCheck = projection;
        latestCheckId = id;
        latestComparison = comparison;
        return { status: 'ok', value: { projection, persistedCheck, comparison, guidance: readinessGuidance([projection, comparison]) } };
      } catch (error) { return failure('CHECK_FAILED', `Machine check failed: ${error.message}`); }
    },

    repairs() {
      return { status: 'ok', value: { repairs: configured.map(({ key, id, targets, network }) => ({ key, id, targets: [...targets], network })), ...(staging === undefined ? {} : { staged: staging }) } };
    },

    async prepareRepair(body = {}) {
      const repair = isRecord(body) && typeof body.key === 'string' ? configured.find(item => item.key === body.key) : undefined;
      if (!repair) return invalid('key must name a configured repair');
      try {
        const preparation = await prepare(request(repair), CONTROLS);
        const result = serialize(preparation);
        if (preparation.prepared && preparation.review) {
          result.sessionId = randomUUID();
          sessions.set(result.sessionId, { handle: preparation.prepared, reviewDigest: preparation.review.reviewDigest, repair });
          while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
        }
        return { status: 'ok', value: { ...(result.sessionId ? { sessionId: result.sessionId } : {}),
          ...(result.review ? { reviewDigest: result.review.reviewDigest } : {}),
          operations: (result.review?.operations ?? []).map(operationView), projection: projectRepairPreparation(result, repair) } };
      } catch (error) { return failure('PREPARE_FAILED', `Repair preparation failed: ${error.message}`); }
    },

    async applyRepair(body = {}) {
      if (!isRecord(body) || typeof body.sessionId !== 'string' || typeof body.reviewDigest !== 'string') return invalid('sessionId and reviewDigest are required');
      const session = sessions.get(body.sessionId);
      if (!session) return lost();
      if (body.approved !== true) return rejected('not-approved', 'Applying requires explicit approval.');
      if (body.reviewDigest !== session.reviewDigest) return rejected('digest-mismatch', 'Approval must name the exact review digest returned by preparation.');
      sessions.delete(body.sessionId);
      const { handle, repair } = session;
      // Taken now, so a check that finishes while the repair runs is never labelled as before it.
      const before = latestCheck;
      const beforeId = latestCheckId;
      const beforeComparison = latestComparison;
      try {
        const run = await apply(handle, { approved: true, origin: 'interactive', reviewDigest: session.reviewDigest }, CONTROLS);
        const appliedAt = stamp();
        // The same condition is checked again by a fresh preparation (its handle is discarded)
        // and by inspecting the repair's targets; either may be unavailable without hiding the run.
        const fresh = await prepare(request(repair), CONTROLS).then(serialize, () => undefined);
        const inspection = await inspect({ targets: [...repair.targets], network: repair.network, configuration: CONFIGURATION }).catch(error => ({ status: 'incomplete',
          diagnostics: [{ code: 'RECHECK_FAILED', message: `Recheck failed: ${error.message}` }] }));
        const recheckedAt = stamp();
        const outcome = projectRepairOutcome({ run, recheck: fresh, inspection, repair, latestCheck: before });
        // The recheck covers only the repair's targets; machine readiness stays with the latest
        // machine check, which predates this repair and is labelled so.
        append({ schema: READINESS_RECORD_SCHEMA, id: randomUUID(), kind: 'repair', capturedAt: recheckedAt,
          sha256: digest({ run, recheck: fresh, inspection }), core: coreIdentity(inspection),
          repair: { repairId: repair.id, targets: [...repair.targets], before: beforeId,
            run: typeof run.runId === 'string' && typeof run.schema === 'string' ? { id: run.runId, schema: run.schema } : null,
            appliedAt, recheckedAt, outcome } });
        const recheck = outcome.condition;
        const machine = before ? { ...before, beforeRepair: true } : null;
        return { status: 'ok', value: { outcome, recheck, machine,
          guidance: readinessGuidance([...(machine ? [machine, beforeComparison] : []), outcome, recheck]) } };
      } catch (error) { return failure('APPLY_FAILED', `Repair apply failed: ${error.message}`); }
    },
  };
}
