// Reviewed batch: one multi-scope change described as a durable record in the journey envelope. Pure and bounded: it reads the saved
// envelope and writes only a new envelope revision. It holds no prepared handle, session or outcome; the Node host (batch-host)
// prepares fresh work every time. There is no atomic multi-scope promise.
import { digestBytes } from './intake.mjs';
import { refuse, stable } from './headless.mjs';
import { readJourneyEnvelope, writeJourneyEnvelope, JOURNEY_RECORD_KINDS } from './journey.mjs';
import { isUtcTimestamp, UPDATE_CATEGORIES } from './maintenance-record.mjs';
import { batchProblem, batchDerivedProblem, batchId, deriveChecks, BATCH_RECORD_SCHEMA, CONTINUATIONS } from './batch-record.mjs';
export const BATCH_SCHEMA = BATCH_RECORD_SCHEMA;
export { CONTINUATIONS, UPDATE_CATEGORIES };
const isBatch = record => record.schema === BATCH_RECORD_SCHEMA;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sameBytes = (a, b) => a instanceof Uint8Array && a.length === b.length && a.every((byte, index) => byte === b[index]);
const unique = value => Array.isArray(value) ? [...new Set(value)].sort(compare) : value;
// Display projection: ids, labels and counts only; never bytes, sessions or outcomes.
export function projectBatch(record) {
  return { id: record.id, ...(record.supersedes !== undefined ? { supersedes: record.supersedes } : {}), recordedAt: record.recordedAt, categories: [...record.categories], continuation: record.continuation,
    scopes: record.scopes.map(scope => ({ id: scope.id, role: scope.role, client: scope.client, root: scope.target.root })),
    inputs: record.inputs.map(input => ({ id: input.id, sha256: input.sha256, byteLength: input.byteLength })),
    actions: record.actions.map(action => ({ id: action.id, scope: action.scope, category: action.category, selection: { ...action.selection }, inputs: [...action.inputs], requires: [...action.requires], retain: action.retain === true })),
    checks: record.checks.map(check => ({ ...check })) };
}
// The selections of the saved policy bytes, or null when they are not a policy object with a selection list.
function selectionsOf(policyBytes) {
  try {
    const policy = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(policyBytes));
    return Array.isArray(policy?.selections) ? policy.selections : null;
  } catch { return null; }
}
// {path,message} of the first disagreement between the record and the saved policy it binds, else null.
async function policyProblem(record, policyBytes) {
  const selections = selectionsOf(policyBytes);
  if (!selections) return { path: '', message: 'The saved intent is not an execution policy with a selection list.' };
  for (const [index, action] of record.actions.entries()) {
    const selection = selections.find(candidate => candidate?.id === action.selection.id);
    if (!selection || await digestBytes(new TextEncoder().encode(stable(selection))) !== action.selection.sha256)
      return { path: `/actions/${index}/selection`, message: 'The action must bind a selection of the saved policy by id and digest.' };
    // Core `requires` between selections of the same scope are mirrored as action requires, so the reviewed order cannot hide them.
    for (const required of Array.isArray(selection.requires) ? selection.requires : []) {
      const needed = record.actions.find(other => other.scope === action.scope && other.selection.id === required);
      if (needed && !action.requires.includes(needed.id)) return { path: `/actions/${index}/requires`, message: `The selection requires ${required}, so the action must require ${needed.id}.` };
    }
  }
  return null;
}
async function load(envelopeBytes) {
  if (!(envelopeBytes instanceof Uint8Array)) return refuse('INPUT_INVALID', '/envelopeBytes', 'Supply original journey envelope bytes.');
  const read = await readJourneyEnvelope(envelopeBytes);
  return read.status === 'ok' ? { status: 'ok', value: read.value, diagnostics: read.diagnostics } : read;
}
// Batches not superseded by another batch in the same envelope.
const currentOf = batches => batches.filter(record => !batches.some(other => other.supersedes === record.id));
// Builds, validates and writes one batch record as a new envelope revision. `replaces` ids leave the envelope; other batches stay.
async function assemble({ read, policyBytes, fields, replaces = [], envelopeBytes }) {
  const fail = (path, message, code = 'INPUT_INVALID') => refuse(code, path, message, envelopeBytes);
  const { scopes, inputs, actions, continuation, categories, now, supersedes } = fields;
  if (!isUtcTimestamp(now)) return fail('/now', 'Supply the record time as an ISO UTC timestamp.');
  if (![scopes, inputs, actions].every(Array.isArray)) return fail('/scopes', 'Supply scopes, inputs and actions as lists.');
  const byId = (a, b) => compare(a?.id, b?.id), copy = value => structuredClone(value);
  const record = { id: `batch-${'0'.repeat(32)}`, schema: BATCH_RECORD_SCHEMA, required: false, recordedAt: now, categories: unique(categories), continuation, scopes: copy(scopes).sort(byId), inputs: copy(inputs).sort(byId),
    actions: copy(actions).map(action => action && typeof action === 'object' ? { ...action, inputs: unique(action.inputs), requires: unique(action.requires) } : action), checks: [],
    ...(supersedes !== undefined ? { supersedes } : {}) };
  let problem = batchProblem(record);
  if (problem !== null) return fail(problem, 'Supply a valid reviewed batch.');
  record.checks = await deriveChecks(record);
  record.id = await batchId(record);
  problem = batchProblem(record) ?? await batchDerivedProblem(record);
  if (problem !== null) return fail(problem, 'Supply a valid reviewed batch.');
  const bound = await policyProblem(record, policyBytes);
  if (bound) return fail(bound.path, bound.message);
  const batches = read.records.filter(isBatch);
  if (supersedes !== undefined && !batches.some(other => other.id === supersedes)) return fail('/supersedes', 'A superseded batch must be in the same envelope.');
  const records = [...read.records.filter(other => Object.hasOwn(JOURNEY_RECORD_KINDS, other.schema) && !(isBatch(other) && (other.id === record.id || replaces.includes(other.id)))), record];
  const written = await writeJourneyEnvelope({ savedIntentBytes: policyBytes, records, previous: read.envelope ? read : undefined });
  if (written.status !== 'ok') return { ...written, ...(envelopeBytes ? { originalBytes: envelopeBytes.slice() } : {}) };
  const { envelope, envelopeBytes: bytes } = written.value;
  return { status: 'ok', diagnostics: [], value: { envelopeBytes: bytes, envelope, record: copy(record), projection: projectBatch(record) } };
}
const emptyRead = { records: [], savedIntentBytes: null };
// A person's plan. With `envelopeBytes` the batch is added to that envelope (its saved policy is the one the actions bind); without
// them a first envelope is written around `savedPolicyBytes`. A batch with the same content replaces itself.
export async function planBatch({ envelopeBytes, savedPolicyBytes, scopes, inputs, actions, continuation, categories, now, supersedes } = {}) {
  let read = emptyRead, policyBytes = savedPolicyBytes;
  if (envelopeBytes !== undefined) {
    const loaded = await load(envelopeBytes);
    if (loaded.status !== 'ok') return loaded;
    read = loaded.value;
    if (savedPolicyBytes !== undefined && !sameBytes(savedPolicyBytes, read.savedIntentBytes)) return refuse('JOURNEY_REFERENCE_MISMATCH', '/savedPolicyBytes', 'The batch binds the envelope\'s own saved policy; these bytes differ.', envelopeBytes);
    policyBytes = read.savedIntentBytes;
  }
  if (!(policyBytes instanceof Uint8Array)) return refuse('INPUT_INVALID', '/savedPolicyBytes', 'Supply the saved execution policy bytes.', envelopeBytes);
  return assemble({ read, policyBytes, fields: { scopes, inputs, actions, continuation, categories, now, supersedes }, envelopeBytes });
}
// The record (latest unless `batchId` names one), its projection and whether another batch has superseded it.
export async function readBatch({ envelopeBytes, batchId: wanted } = {}) {
  const loaded = await load(envelopeBytes);
  if (loaded.status !== 'ok') return loaded;
  const batches = loaded.value.records.filter(isBatch), current = currentOf(batches);
  const record = wanted !== undefined ? batches.find(other => other.id === wanted) : current[current.length - 1];
  if (!record) return refuse('BATCH_NOT_FOUND', '/batchId', wanted !== undefined ? 'No recorded batch has that id.' : 'The envelope records no reviewed batch.', envelopeBytes);
  const bound = await policyProblem(record, loaded.value.savedIntentBytes);
  if (bound) return refuse('INPUT_INVALID', bound.path, bound.message, envelopeBytes);
  return { status: 'ok', diagnostics: loaded.diagnostics, value: { record: structuredClone(record), projection: projectBatch(record), current: current.includes(record), savedPolicyBytes: loaded.value.savedIntentBytes.slice(),
    batches: batches.map(other => ({ id: other.id, ...(other.supersedes !== undefined ? { supersedes: other.supersedes } : {}), current: current.includes(other) })) } };
}
// The person's independent-continuation choice. Content derives the id, so this writes a new record in place of the old one
// (an edit, not history); only a batch no other batch has superseded can be edited.
export async function setContinuation({ envelopeBytes, batchId: id, continuation, now } = {}) {
  const read = await readBatch({ envelopeBytes, batchId: id });
  if (read.status !== 'ok') return read;
  if (!read.value.current) return refuse('BATCH_SUPERSEDED', '/batchId', 'Only the current batch can be edited; a later batch superseded this one.', envelopeBytes);
  if (!CONTINUATIONS.includes(continuation)) return refuse('INPUT_INVALID', '/continuation', `Supply one of: ${CONTINUATIONS.join(', ')}.`, envelopeBytes);
  const loaded = await load(envelopeBytes), { record } = read.value;
  return assemble({ read: loaded.value, policyBytes: loaded.value.savedIntentBytes, replaces: [record.id], envelopeBytes,
    fields: { scopes: record.scopes, inputs: record.inputs, actions: record.actions, categories: record.categories, continuation, now, supersedes: record.supersedes } });
}
