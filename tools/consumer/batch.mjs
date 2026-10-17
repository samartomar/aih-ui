// Reviewed batch: one multi-scope change described as a durable record in the journey envelope. Pure and bounded: it reads the saved
// envelope and writes only a new envelope revision. It holds no prepared handle, session or outcome; the Node host (batch-host)
// prepares fresh work every time. There is no atomic multi-scope promise.
// Every operation takes `parsePolicy`, Core's policy reader, from the caller (batch-policy.mjs supplies it), and reads the exact saved
// policy bytes it binds and stores with it, so the binding always holds against those bytes while this module imports no package.
import { digestBytes, refuse, stable } from './primitives.mjs';
import { readJourneyEnvelope, writeJourneyEnvelope, JOURNEY_RECORD_KINDS } from './journey.mjs';
import { isUtcTimestamp } from './maintenance-record.mjs';
import { batchProblem, batchDerivedProblem, batchId, deriveChecks, BATCH_RECORD_SCHEMA, CONTINUATIONS } from './batch-record.mjs';
export const BATCH_SCHEMA = BATCH_RECORD_SCHEMA;
const isBatch = record => record.schema === BATCH_RECORD_SCHEMA;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sameBytes = (a, b) => a instanceof Uint8Array && a.length === b.length && a.every((byte, index) => byte === b[index]);
const unique = value => Array.isArray(value) ? [...new Set(value)].sort(compare) : value;
// Operations whose result a fresh Prepare can show as already in place (gap K-2: Core publishes no such list, so this mirrors it by hand). A `process.run` is opaque: Core's published interface cannot
// establish that an earlier process ran, so an action holding one is never judged by inspection. The list mirrors Core's recipe 1.3.0 operation kinds; any kind not
// listed here is treated as opaque.
const FILE_LIKE = ['file.write', 'config.entries', 'text.block', 'file.remove', 'hook.group'];
const inlineRecipe = selection => {
  const recipe = selection?.recipe, inline = recipe?.inline;
  return recipe && Object.keys(recipe).length === 1 && inline && typeof inline === 'object' && !Array.isArray(inline) ? inline : null;
};
// Whether a fresh Prepare can tell if this selection's result stands (false when its recipe cannot be inspected).
export const isVerifiable = selection => {
  const operations = inlineRecipe(selection)?.operations;
  return Array.isArray(operations) && operations.length > 0 && operations.every(operation => FILE_LIKE.includes(operation?.kind));
};
// The shared inputs a selection reads: the local sources of the materials its inline recipe declares (an archive is pinned by its own
// digest). Null when the recipe cannot be inspected through its declared fields.
function recipeInputs(selection) {
  const materials = inlineRecipe(selection)?.materials, found = new Set();
  if (!Array.isArray(materials)) return null;
  for (const material of materials) {
    const source = material?.source;
    if (source?.kind === 'local' && typeof source.input === 'string') found.add(source.input);
    else if (source?.kind !== 'archive') return null;
  }
  return [...found].sort(compare);
}
// Display projection: ids, labels and counts only; never bytes, sessions or outcomes. `unverifiable` names the actions
// whose result Core cannot confirm (see isVerifiable); it needs the saved policy, so only the readers that hold it supply it.
export function projectBatch(record, unverifiable = []) {
  return { id: record.id, ...(record.supersedes !== undefined ? { supersedes: record.supersedes } : {}), recordedAt: record.recordedAt, categories: [...record.categories], continuation: record.continuation,
    scopes: record.scopes.map(scope => ({ id: scope.id, role: scope.role, client: scope.client, root: scope.target.root })),
    inputs: record.inputs.map(input => ({ id: input.id, sha256: input.sha256, byteLength: input.byteLength })),
    actions: record.actions.map(action => ({ id: action.id, scope: action.scope, category: action.category, selection: { ...action.selection }, inputs: [...action.inputs], requires: [...action.requires], retain: action.retain === true, unverifiable: unverifiable.includes(action.id) })),
    checks: record.checks.map(check => ({ ...check })) };
}
// Core's reading of the saved policy bytes through the caller's `parsePolicy`: { policy } or { refusal } with Core's own diagnostics.
function readPolicy(policyBytes, parsePolicy, path) {
  if (typeof parsePolicy !== 'function') return { refusal: { path: '/parsePolicy', message: "Supply the saved-policy reader (Core's parsePolicy)." } };
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(policyBytes); }
  catch (error) { if (error instanceof TypeError) return { refusal: { path, message: 'The saved execution policy bytes are not UTF-8.' } }; throw error; }
  const parsed = parsePolicy(text);
  return parsed?.valid ? { policy: parsed.document }
    : { refusal: { path, message: 'Core refused the saved execution policy bytes.', details: { owner: 'core', diagnostics: structuredClone(parsed?.diagnostics ?? []) } } };
}
// The selections of Core's reading of the saved policy.
const selectionsOf = policy => policy && typeof policy === 'object' && Array.isArray(policy.selections) ? policy.selections : null;
const unverifiableOf = (record, policy) => { const selections = selectionsOf(policy) ?? []; return record.actions.filter(action => !isVerifiable(selections.find(selection => selection?.id === action.selection.id))).map(action => action.id); };
// {path,message} of the first disagreement between the record and the saved policy it binds, else null.
async function policyProblem(record, policy) {
  const selections = selectionsOf(policy);
  if (!selections) return { path: '', message: 'The saved intent is not an execution policy with a selection list.' };
  for (const [index, action] of record.actions.entries()) {
    const selection = selections.find(candidate => candidate?.id === action.selection.id);
    if (!selection || await digestBytes(new TextEncoder().encode(stable(selection))) !== action.selection.sha256)
      return { path: `/actions/${index}/selection`, message: 'The action must bind a selection of the saved policy by id and digest.' };
    const inputs = recipeInputs(selection);
    if (!inputs) return { path: `/actions/${index}/selection`, message: 'The recipe of this selection cannot be inspected through its declared fields, so a batch cannot check its shared inputs.' };
    if (JSON.stringify(inputs) !== JSON.stringify(action.inputs)) return { path: `/actions/${index}/inputs`, message: `The action's inputs must be exactly the shared material its recipe reads: ${inputs.join(', ') || 'none'}.` };
    // The host prepares one action at a time without Core's `requires`, so each must be carried by an action of the same scope that the action requires.
    for (const required of Array.isArray(selection.requires) ? selection.requires : []) {
      const needed = record.actions.find(other => other.scope === action.scope && other.selection.id === required);
      if (!needed) return { path: `/actions/${index}/requires`, message: `The selection requires ${required}, which no action of scope ${action.scope} carries.` };
      if (!action.requires.includes(needed.id)) return { path: `/actions/${index}/requires`, message: `The selection requires ${required}, so the action must require ${needed.id}.` };
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
async function assemble({ read, policyBytes, parsePolicy, policyPath, fields, replaces = [], envelopeBytes }) {
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
  const { policy, refusal } = readPolicy(policyBytes, parsePolicy, policyPath);
  if (refusal) return refuse('INPUT_INVALID', refusal.path, refusal.message, envelopeBytes, refusal.details);
  const bound = await policyProblem(record, policy);
  if (bound) return fail(bound.path, bound.message);
  const batches = read.records.filter(isBatch);
  if (supersedes !== undefined && !batches.some(other => other.id === supersedes)) return fail('/supersedes', 'A superseded batch must be in the same envelope.');
  const records = [...read.records.filter(other => Object.hasOwn(JOURNEY_RECORD_KINDS, other.schema) && !(isBatch(other) && (other.id === record.id || replaces.includes(other.id)))), record];
  const written = await writeJourneyEnvelope({ savedIntentBytes: policyBytes, records, previous: read.envelope ? read : undefined });
  if (written.status !== 'ok') return { ...written, ...(envelopeBytes ? { originalBytes: envelopeBytes.slice() } : {}) };
  const { envelope, envelopeBytes: bytes } = written.value;
  return { status: 'ok', diagnostics: [], value: { envelopeBytes: bytes, envelope, record: copy(record), projection: projectBatch(record, unverifiableOf(record, policy)) } };
}
const emptyRead = { records: [], savedIntentBytes: null };
// A person's plan. With `envelopeBytes` the batch is added to that envelope (its saved policy is the one the actions bind); without
// them a first envelope is written around `savedPolicyBytes`. A batch with the same content replaces itself.
export async function planBatch({ envelopeBytes, savedPolicyBytes, parsePolicy, scopes, inputs, actions, continuation, categories, now, supersedes } = {}) {
  let read = emptyRead, policyBytes = savedPolicyBytes;
  if (envelopeBytes !== undefined) {
    const loaded = await load(envelopeBytes);
    if (loaded.status !== 'ok') return loaded;
    read = loaded.value;
    if (savedPolicyBytes !== undefined && !sameBytes(savedPolicyBytes, read.savedIntentBytes)) return refuse('JOURNEY_REFERENCE_MISMATCH', '/savedPolicyBytes', 'The batch binds the envelope\'s own saved policy; these bytes differ.', envelopeBytes);
    policyBytes = read.savedIntentBytes;
  }
  if (!(policyBytes instanceof Uint8Array)) return refuse('INPUT_INVALID', '/savedPolicyBytes', 'Supply the saved execution policy bytes.', envelopeBytes);
  return assemble({ read, policyBytes, parsePolicy, policyPath: envelopeBytes !== undefined ? '/savedIntent' : '/savedPolicyBytes', fields: { scopes, inputs, actions, continuation, categories, now, supersedes }, envelopeBytes });
}
// The record (latest unless `batchId` names one), its projection, whether another batch has superseded it and whether the
// envelope is `supported` (an unknown required record makes it read-only: it can be reviewed, never run, recovered or changed), with
// Core's reading of the saved policy (`policy`) for the host that prepares it.
export async function readBatch({ envelopeBytes, batchId: wanted, parsePolicy } = {}) {
  const loaded = await load(envelopeBytes);
  if (loaded.status !== 'ok') return loaded;
  const batches = loaded.value.records.filter(isBatch), current = currentOf(batches);
  const record = wanted !== undefined ? batches.find(other => other.id === wanted) : current[current.length - 1];
  if (!record) return refuse('BATCH_NOT_FOUND', '/batchId', wanted !== undefined ? 'No recorded batch has that id.' : 'The envelope records no reviewed batch.', envelopeBytes);
  const { policy, refusal } = readPolicy(loaded.value.savedIntentBytes, parsePolicy, '/savedIntent');
  if (refusal) return refuse('INPUT_INVALID', refusal.path, refusal.message, envelopeBytes, refusal.details);
  const bound = await policyProblem(record, policy);
  if (bound) return refuse('INPUT_INVALID', bound.path, bound.message, envelopeBytes);
  return { status: 'ok', diagnostics: loaded.diagnostics, value: { record: structuredClone(record), projection: projectBatch(record, unverifiableOf(record, policy)), current: current.includes(record), supported: loaded.value.supported, savedPolicyBytes: loaded.value.savedIntentBytes.slice(), policy: structuredClone(policy),
    batches: batches.map(other => ({ id: other.id, ...(other.supersedes !== undefined ? { supersedes: other.supersedes } : {}), current: current.includes(other) })) } };
}
// The person's independent-continuation choice. Content derives the id, so this writes a new record in place of the old one
// (an edit, not history); only a batch no other batch has superseded can be edited.
export async function setContinuation({ envelopeBytes, batchId: id, parsePolicy, continuation, now } = {}) {
  const read = await readBatch({ envelopeBytes, batchId: id, parsePolicy });
  if (read.status !== 'ok') return read;
  if (!read.value.current) return refuse('BATCH_SUPERSEDED', '/batchId', 'Only the current batch can be edited; a later batch superseded this one.', envelopeBytes);
  if (!CONTINUATIONS.includes(continuation)) return refuse('INPUT_INVALID', '/continuation', `Supply one of: ${CONTINUATIONS.join(', ')}.`, envelopeBytes);
  const loaded = await load(envelopeBytes), { record } = read.value;
  return assemble({ read: loaded.value, policyBytes: loaded.value.savedIntentBytes, parsePolicy, policyPath: '/savedIntent', replaces: [record.id], envelopeBytes,
    fields: { scopes: record.scopes, inputs: record.inputs, actions: record.actions, categories: record.categories, continuation, now, supersedes: record.supersedes } });
}
