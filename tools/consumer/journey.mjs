// Portable journey envelope. Pure data: bytes in, bytes out. It carries the exact
// saved-intent (policy) bytes by reference and is never an execution policy.
// Digests use the shared Web Crypto; no host, filesystem or network is touched.
import { checkIntentShape } from './intent-shape.mjs';
import { digestBytes, hash, object, only } from './intake.mjs';
export const JOURNEY_SCHEMA_PREFIX = 'urn:aihq:workbench:journey-envelope:';
export const JOURNEY_SCHEMA = `${JOURNEY_SCHEMA_PREFIX}1.0.0`;
export const JOURNEY_ACCEPTED_SCHEMAS = [JOURNEY_SCHEMA];
export const SAVED_INTENT_TYPE = 'urn:aihq:core:execution-policy-bytes';
export const DRAFT_RECORD_SCHEMA = 'urn:aihq:workbench:journey-record:unresolved-draft:1.0.0';
export const JOURNEY_RECORD_SCHEMAS = { [DRAFT_RECORD_SCHEMA]: { kind: 'unresolved-draft', version: '1.0.0' } };
export const MAX_SAVED_INTENT_BYTES = 1_000_000;
export const MAX_ENVELOPE_BYTES = 2_000_000;
// True for an envelope of any version, so an unsupported one is refused as such rather than read as a policy.
export function isJourneyEnvelope(bytesOrText) {
  try {
    const schema = JSON.parse(typeof bytesOrText === 'string' ? bytesOrText : new TextDecoder('utf-8', { fatal: true }).decode(bytesOrText))?.schema;
    return typeof schema === 'string' && schema.startsWith(JOURNEY_SCHEMA_PREFIX);
  } catch { return false; }
}
const recordSchemaUrn = /^urn:aihq:workbench:journey-record:[a-z0-9-]+:\d+\.\d+\.\d+$/;
const idPattern = /^[\w.-]{1,180}$/;
// Same canonical JSON as headless `stable`; kept local so this module has no host dependency.
const stable = value => JSON.stringify(value, (_key, member) => member && typeof member === 'object' && !Array.isArray(member)
  ? Object.fromEntries(Object.entries(member).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : member);
const ok = (value, diagnostics = []) => ({ status: 'ok', value, diagnostics });
const refuse = (code, path, message, originalBytes) => ({ status: 'refused', diagnostics: [{ code, path, message }], ...(originalBytes ? { originalBytes: originalBytes.slice() } : {}) });
const encode = value => new TextEncoder().encode(value);
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function encodeBase64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2], n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    text += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + (b === undefined ? '=' : ALPHABET[(n >> 6) & 63]) + (c === undefined ? '=' : ALPHABET[n & 63]);
  }
  return text;
}
// Strict and canonical: anything encodeBase64 would not emit is rejected.
export function decodeBase64(text) {
  if (typeof text !== 'string' || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0, bytes = new Uint8Array(text.length / 4 * 3 - padding);
  let at = 0;
  for (let i = 0; i < text.length; i += 4) {
    const n = [0, 1, 2, 3].reduce((sum, k) => (sum << 6) | Math.max(ALPHABET.indexOf(text[i + k]), 0), 0);
    for (const shift of [16, 8, 0]) if (at < bytes.length) bytes[at++] = (n >> shift) & 255;
  }
  return encodeBase64(bytes) === text ? bytes : null;
}
async function revisionDigest(envelope) {
  const { sha256: _omitted, ...revision } = envelope.revision;
  return digestBytes(encode(stable({ ...envelope, revision })));
}
// Returns the JSON pointer of the first violation of the closed envelope shape.
function shapeProblem(envelope) {
  if (!only(envelope, ['schema', 'id', 'revision', 'executable', 'savedIntent', 'records'])) return '';
  if (typeof envelope.id !== 'string' || !/^journey-[a-f0-9]{32}$/.test(envelope.id)) return '/id';
  const { revision, savedIntent, records } = envelope;
  if (!only(revision, ['sequence', 'sha256'], ['previousSha256']) || !Number.isSafeInteger(revision.sequence) || revision.sequence < 1 || !hash(revision.sha256)
    || (revision.sequence === 1 ? 'previousSha256' in revision : !hash(revision.previousSha256))) return '/revision';
  if (typeof envelope.executable !== 'boolean') return '/executable';
  if (!only(savedIntent, ['type', 'mediaType', 'sha256', 'byteLength', 'base64']) || typeof savedIntent.type !== 'string' || typeof savedIntent.mediaType !== 'string'
    || !hash(savedIntent.sha256) || !Number.isSafeInteger(savedIntent.byteLength) || savedIntent.byteLength < 0 || typeof savedIntent.base64 !== 'string') return '/savedIntent';
  if (!Array.isArray(records) || records.length > 4096) return '/records';
  for (const [index, record] of records.entries()) {
    const path = `/records/${index}`;
    if (!object(record) || typeof record.id !== 'string' || !idPattern.test(record.id) || typeof record.schema !== 'string' || !recordSchemaUrn.test(record.schema) || typeof record.required !== 'boolean') return path;
    if (record.schema === DRAFT_RECORD_SCHEMA && (!only(record, ['id', 'schema', 'required', 'savedIntentSha256', 'intent']) || record.required !== true || !hash(record.savedIntentSha256) || !object(record.intent))) return path;
  }
  return null;
}
export async function readJourneyEnvelope(bytes) {
  if (!(bytes instanceof Uint8Array)) return refuse('INPUT_INVALID', '', 'Supply original UTF-8 envelope bytes.');
  const originalBytes = bytes.slice();
  if (bytes.length > MAX_ENVELOPE_BYTES) return refuse('INPUT_INVALID', '', `Envelope exceeds ${MAX_ENVELOPE_BYTES} bytes.`, originalBytes);
  let envelope;
  try { envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { return refuse('INPUT_INVALID', '', 'Envelope is not UTF-8 JSON.', originalBytes); }
  if (!object(envelope) || typeof envelope.schema !== 'string') return refuse('INPUT_INVALID', '/schema', 'Envelope must be a JSON object with a schema URN.', originalBytes);
  if (!JOURNEY_ACCEPTED_SCHEMAS.includes(envelope.schema)) return refuse('JOURNEY_VERSION_UNSUPPORTED', '/schema', `Unsupported journey envelope version; supported: ${JOURNEY_ACCEPTED_SCHEMAS.join(', ')}. Original bytes are unchanged.`, originalBytes);
  const problem = shapeProblem(envelope);
  if (problem !== null) return refuse('INPUT_INVALID', problem, 'Envelope violates the closed journey shape.', originalBytes);
  if (envelope.executable !== false) return refuse('FIELD_SEMANTICS_UNSUPPORTED', '/executable', 'A journey envelope is never executable.', originalBytes);
  const { savedIntent } = envelope;
  if (savedIntent.type !== SAVED_INTENT_TYPE || savedIntent.mediaType !== 'application/json') return refuse('FIELD_SEMANTICS_UNSUPPORTED', '/savedIntent', 'Unsupported saved-intent reference type.', originalBytes);
  if (savedIntent.byteLength > MAX_SAVED_INTENT_BYTES) return refuse('INPUT_INVALID', '/savedIntent/byteLength', `Saved intent exceeds ${MAX_SAVED_INTENT_BYTES} bytes.`, originalBytes);
  const savedIntentBytes = decodeBase64(savedIntent.base64);
  if (!savedIntentBytes) return refuse('INPUT_INVALID', '/savedIntent/base64', 'Saved-intent bytes are not canonical base64.', originalBytes);
  if (savedIntentBytes.length !== savedIntent.byteLength || await digestBytes(savedIntentBytes) !== savedIntent.sha256) return refuse('JOURNEY_REFERENCE_MISMATCH', '/savedIntent', 'Saved-intent bytes do not match their recorded length and digest.', originalBytes);
  const ids = new Set(), diagnostics = [];
  for (const [index, record] of envelope.records.entries()) {
    if (ids.has(record.id)) return refuse('INPUT_INVALID', `/records/${index}/id`, 'Record ids must be unique.', originalBytes);
    ids.add(record.id);
    if (record.schema === DRAFT_RECORD_SCHEMA && record.savedIntentSha256 !== savedIntent.sha256) return refuse('JOURNEY_REFERENCE_MISMATCH', `/records/${index}/savedIntentSha256`, 'Record references different saved-intent bytes.', originalBytes);
  }
  if (envelope.revision.sequence === 1 && envelope.id !== `journey-${savedIntent.sha256.slice(0, 32)}`) return refuse('JOURNEY_REFERENCE_MISMATCH', '/id', 'First revision id must derive from its saved-intent digest.', originalBytes);
  if (await revisionDigest(envelope) !== envelope.revision.sha256) return refuse('JOURNEY_REVISION_MISMATCH', '/revision/sha256', 'Revision digest does not match the envelope content.', originalBytes);
  let supported = true;
  for (const [index, record] of envelope.records.entries()) {
    if (record.schema === DRAFT_RECORD_SCHEMA) {
      if (!checkIntentShape(record.intent)) return refuse('FIELD_SEMANTICS_UNSUPPORTED', `/records/${index}/intent`, 'Draft intent violates the supported saved-intent shape.', originalBytes);
    } else if (record.required) {
      supported = false;
      diagnostics.push({ code: 'JOURNEY_RECORD_UNSUPPORTED', path: `/records/${index}`, message: `Required record ${record.id} has unsupported schema ${record.schema}; it can be read but not changed.` });
    } else diagnostics.push({ code: 'JOURNEY_RECORD_PRESERVED', severity: 'info', path: `/records/${index}`, message: `Optional record ${record.id} has unknown schema ${record.schema}; it is preserved unchanged.` });
  }
  return ok({ envelope, savedIntentBytes, records: envelope.records, supported, originalBytes }, diagnostics);
}
// `records` are the known records to write; unknown optional records from `previous`
// are carried over verbatim. A previous envelope with unsupported required records
// cannot be rewritten.
export async function writeJourneyEnvelope({ savedIntentBytes, records, previous } = {}) {
  if (!(savedIntentBytes instanceof Uint8Array) || savedIntentBytes.length > MAX_SAVED_INTENT_BYTES) return refuse('INPUT_INVALID', '/savedIntentBytes', `Supply saved-intent bytes of at most ${MAX_SAVED_INTENT_BYTES}.`);
  if (!Array.isArray(records) || records.length > 4096) return refuse('INPUT_INVALID', '/records', 'Supply a bounded list of records.');
  if (previous && (!object(previous.envelope) || previous.supported !== true)) return refuse('JOURNEY_RECORD_UNSUPPORTED', '/previous', 'The previous envelope has unsupported required records and cannot be rewritten.', previous.originalBytes);
  const sha256 = await digestBytes(savedIntentBytes), written = [];
  for (const [index, record] of records.entries()) {
    const path = `/records/${index}`;
    if (!only(record, ['id', 'schema', 'required', 'intent'], ['savedIntentSha256']) || typeof record.id !== 'string' || !idPattern.test(record.id)) return refuse('INPUT_INVALID', path, 'Supply {id,schema,required,intent} records.');
    if (!(record.schema in JOURNEY_RECORD_SCHEMAS)) return refuse('JOURNEY_RECORD_UNSUPPORTED', `${path}/schema`, 'Only supported record schemas can be written.');
    if (record.required !== true) return refuse('INPUT_INVALID', `${path}/required`, 'The unresolved-draft record is required.');
    if (record.savedIntentSha256 !== undefined && record.savedIntentSha256 !== sha256) return refuse('JOURNEY_REFERENCE_MISMATCH', `${path}/savedIntentSha256`, 'Record references different saved-intent bytes.');
    if (!checkIntentShape(record.intent)) return refuse('FIELD_SEMANTICS_UNSUPPORTED', `${path}/intent`, 'Draft intent violates the supported saved-intent shape.');
    written.push({ id: record.id, schema: record.schema, required: true, savedIntentSha256: sha256, intent: structuredClone(record.intent) });
  }
  const preserved = (previous?.envelope.records ?? []).filter(record => !(record.schema in JOURNEY_RECORD_SCHEMAS)).map(record => structuredClone(record));
  const all = [...written, ...preserved];
  if (new Set(all.map(record => record.id)).size !== all.length) return refuse('INPUT_INVALID', '/records', 'Record ids must be unique.');
  const sequence = previous ? previous.envelope.revision.sequence + 1 : 1;
  const envelope = { schema: JOURNEY_SCHEMA, id: previous?.envelope.id ?? `journey-${sha256.slice(0, 32)}`,
    revision: { sequence, ...(previous ? { previousSha256: previous.envelope.revision.sha256 } : {}) }, executable: false,
    savedIntent: { type: SAVED_INTENT_TYPE, mediaType: 'application/json', sha256, byteLength: savedIntentBytes.length, base64: encodeBase64(savedIntentBytes) }, records: all };
  envelope.revision = { sequence, sha256: await revisionDigest(envelope), ...(previous ? { previousSha256: previous.envelope.revision.sha256 } : {}) };
  const envelopeBytes = encode(JSON.stringify(envelope, null, 2) + '\n');
  if (envelopeBytes.length > MAX_ENVELOPE_BYTES) return refuse('POLICY_BOUND_EXCEEDED', '', `Envelope exceeds ${MAX_ENVELOPE_BYTES} bytes; reduce selected state.`);
  return ok({ envelope, envelopeBytes });
}
// Display summary only; never contains saved-intent bytes or choice contents.
export function projectJourneyEnvelope(envelope) {
  return { id: envelope.id, schema: envelope.schema, revision: { ...envelope.revision }, executable: false,
    savedIntent: { sha256: envelope.savedIntent.sha256, byteLength: envelope.savedIntent.byteLength },
    records: envelope.records.map(record => ({ id: record.id, schema: record.schema, required: record.required, supported: record.schema in JOURNEY_RECORD_SCHEMAS })) };
}
