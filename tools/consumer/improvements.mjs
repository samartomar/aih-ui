// Improvement suggestions and dismissals: why one Catalog item might help this policy, from fixed versioned rules,
// and what a person chose to do about it. Pure and bounded: it reads the saved envelope, the inventories and the
// declared clients it is handed, calls no model and reads no network, and writes only a new envelope revision through
// recordImprovement. Nothing is applied and nothing is sent anywhere.
import { isCheckedRelease } from '@aihq/catalog/reader';
import { only } from './intake.mjs';
import { refuse } from './headless.mjs';
import { readJourneyEnvelope, writeJourneyEnvelope, projectJourneyEnvelope, DRAFT_RECORD_SCHEMA, JOURNEY_RECORD_KINDS } from './journey.mjs';
import { isUtcTimestamp } from './maintenance-record.mjs';
import { IMPROVEMENT_SUGGESTION_RECORD_SCHEMA, IMPROVEMENT_DISMISSAL_RECORD_SCHEMA, SUGGESTION_FIELDS, suggestionProblem, suggestionDerivedProblem, dismissalProblem, dismissalId } from './improvement-record.mjs';
import { IMPROVEMENT_RULES_VERSION, suggestImprovements, classifyImprovement, lead, improvementPrompt, MAX_GOAL } from './improvement-rules.mjs';
export const IMPROVEMENT_SUGGESTION_SCHEMA = IMPROVEMENT_SUGGESTION_RECORD_SCHEMA;
export const IMPROVEMENT_DISMISSAL_SCHEMA = IMPROVEMENT_DISMISSAL_RECORD_SCHEMA;
export { IMPROVEMENT_RULES_VERSION, improvementPrompt };
const isSuggestion = record => record.schema === IMPROVEMENT_SUGGESTION_RECORD_SCHEMA;
const isDismissal = record => record.schema === IMPROVEMENT_DISMISSAL_RECORD_SCHEMA;
const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const checkedEntries = value => {
  try { return Array.isArray(value) && value.length <= 32 && value.every(entry => entry && isCheckedRelease(entry.release)) && new Set(value.map(entry => entry.release.sha256)).size === value.length; }
  catch { return false; }
};
async function load(envelopeBytes) {
  if (!(envelopeBytes instanceof Uint8Array)) return refuse('INPUT_INVALID', '/envelopeBytes', 'Supply original journey envelope bytes.');
  const read = await readJourneyEnvelope(envelopeBytes);
  if (read.status !== 'ok') return read;
  const draft = read.value.records.find(record => record.schema === DRAFT_RECORD_SCHEMA);
  if (!draft) return refuse('INPUT_INVALID', '/records', 'Envelope has no unresolved-draft record.', envelopeBytes);
  return { status: 'ok', value: { read: read.value, draft }, diagnostics: read.diagnostics };
}
// Display list of the recorded dismissals; never carries saved-intent bytes.
export function projectDismissals(envelope) {
  return (Array.isArray(envelope?.records) ? envelope.records : []).filter(isDismissal).map(record => structuredClone(record));
}
// Bounded read: no scan, native check, model call, host prepare/apply or write. The host supplies `now`, the
// checked inventories and the AI clients the person declared in Workbench setup, with the labels Harness publishes for
// them; `goal` is an optional request.
export async function checkImprovements({ envelopeBytes, inventories, clients = [], labels = {}, goal, now } = {}) {
  const loaded = await load(envelopeBytes);
  if (loaded.status !== 'ok') return loaded;
  const { read, draft } = loaded.value;
  const fail = (path, message) => refuse('INPUT_INVALID', path, message, envelopeBytes);
  if (!isUtcTimestamp(now)) return fail('/now', 'Supply the check time as an ISO UTC timestamp.');
  if (!checkedEntries(inventories)) return fail('/inventories', 'Supply at most 32 unique checked inventories.');
  if (!Array.isArray(clients) || clients.length > 32 || clients.some(client => typeof client !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(client))) return fail('/clients', 'Supply at most 32 AI client ids.');
  if (!labels || typeof labels !== 'object' || Array.isArray(labels) || Object.keys(labels).length > 32
    || Object.entries(labels).some(([id, label]) => !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || typeof label !== 'string' || label.length < 1 || label.length > 128)) return fail('/labels', 'Supply at most 32 client labels of 1 to 128 characters.');
  if (goal !== undefined && (typeof goal !== 'string' || goal.length > MAX_GOAL)) return fail('/goal', `Supply a goal of at most ${MAX_GOAL} characters.`);
  const requested = goal !== undefined && goal.trim() !== '';
  const items = inventories.flatMap(entry => entry.release.items.map(item => ({ ...item, root: { releaseSha256: entry.release.sha256 } })));
  const current = await suggestImprovements({ intent: draft.intent, items, clients, labels, goal });
  const savedBy = new Map(read.records.filter(isSuggestion).map(record => [record.id, record]));
  const dismissals = new Map(read.records.filter(isDismissal).map(record => [record.suggestion.id, record]));
  const shown = (suggestion, dismissal, reasons = []) => ({ ...suggestion, prompt: improvementPrompt(suggestion), dismissal: dismissal ? structuredClone(dismissal) : null,
    ...(reasons.length ? { promotion: { reasons } } : {}) });
  const active = [], dismissed = [], matched = new Set();
  for (const suggestion of current) {
    const dismissal = dismissals.get(suggestion.id);
    if (!dismissal) { active.push(shown(suggestion, null)); continue; }
    matched.add(dismissal.id);
    const { dismissed: stays, reasons } = classifyImprovement(suggestion, savedBy.get(dismissal.suggestion.id));
    (stays ? dismissed : active).push(shown(suggestion, dismissal, reasons));
  }
  const preserved = [...dismissals.values()].filter(dismissal => !matched.has(dismissal.id)).sort(byId)
    .map(dismissal => ({ dismissal: structuredClone(dismissal), suggestion: structuredClone(savedBy.get(dismissal.suggestion.id)), state: 'not-current' }));
  return { status: 'ok', diagnostics: loaded.diagnostics, value: { rulesVersion: IMPROVEMENT_RULES_VERSION, checkedAt: now,
    reads: ['envelope', 'supplied-inventories', 'declared-clients', ...(requested ? ['request-goal'] : [])], mutations: [], ...lead(active), dismissed, preserved } };
}
// Dismissing a suggestion, or showing it again on request, becomes a new envelope revision; the saved intent and the
// draft are untouched. A dismissal binds the exact suggestion revision it dismissed.
export async function recordImprovement({ envelopeBytes, operation, now } = {}) {
  const loaded = await load(envelopeBytes);
  if (loaded.status !== 'ok') return loaded;
  const { read } = loaded.value;
  const fail = (path, message) => refuse('INPUT_INVALID', path, message, envelopeBytes);
  if (!read.supported) return refuse('JOURNEY_RECORD_UNSUPPORTED', '/records', 'The envelope has required records this version cannot change; it is read-only.', envelopeBytes);
  if (!isUtcTimestamp(now)) return fail('/now', 'Supply the record time as an ISO UTC timestamp.');
  if (!operation || typeof operation !== 'object' || !['dismiss', 'restore'].includes(operation.type)) return fail('/operation/type', 'Supply a dismiss or restore operation.');
  const suggestions = read.records.filter(isSuggestion), dismissals = read.records.filter(isDismissal);
  let nextSuggestions = suggestions, nextDismissals = dismissals, record;
  if (operation.type === 'restore') {
    if (!only(operation, ['type', 'id'])) return fail('/operation', 'Supply {type,id}.');
    record = dismissals.find(r => r.suggestion.id === operation.id);
    if (!record) return fail('/operation/id', 'No recorded dismissal is for that suggestion.');
    nextDismissals = dismissals.filter(r => r !== record);
    nextSuggestions = suggestions.filter(r => r.id !== operation.id);
  } else {
    if (!only(operation, ['type', 'suggestion'], ['reason'])) return fail('/operation', 'Supply {type,suggestion,reason?}.');
    const { suggestion } = operation;
    if (!only(suggestion, SUGGESTION_FIELDS)) return fail('/operation/suggestion', `Supply only the suggestion's ${SUGGESTION_FIELDS.join(', ')}.`);
    const saved = { id: suggestion.id, schema: IMPROVEMENT_SUGGESTION_RECORD_SCHEMA, required: false, rulesVersion: suggestion.rulesVersion, revision: suggestion.revision, scope: suggestion.scope,
      change: suggestion.change, triggers: suggestion.triggers, goal: suggestion.goal, references: suggestion.references, facts: suggestion.facts,
      unknowns: suggestion.unknowns, recordedAt: now };
    const problem = suggestionProblem(saved) ?? await suggestionDerivedProblem(saved);
    if (problem !== null) return fail(`/operation/suggestion${problem}`, 'Supply a valid improvement suggestion.');
    record = { id: '', schema: IMPROVEMENT_DISMISSAL_RECORD_SCHEMA, required: false, suggestion: { id: saved.id, revision: saved.revision }, recordedAt: now,
      ...(operation.reason !== undefined ? { reason: operation.reason } : {}) };
    record.id = await dismissalId(record);
    if (dismissalProblem(record) !== null) return fail('/operation/reason', 'Supply a reason of 1 to 1000 characters.');
    nextSuggestions = [...suggestions.filter(r => r.id !== saved.id), saved];
    nextDismissals = [...dismissals.filter(r => r.id !== record.id), record];
  }
  const records = [...read.records.filter(r => Object.hasOwn(JOURNEY_RECORD_KINDS, r.schema) && !isSuggestion(r) && !isDismissal(r)), ...[...nextSuggestions].sort(byId), ...[...nextDismissals].sort(byId)];
  const written = await writeJourneyEnvelope({ savedIntentBytes: read.savedIntentBytes, records, previous: read });
  if (written.status !== 'ok') return { ...written, originalBytes: envelopeBytes.slice() };
  const { envelope, envelopeBytes: bytes } = written.value;
  return { status: 'ok', diagnostics: [], value: { envelopeBytes: bytes, envelope, projection: projectJourneyEnvelope(envelope), record: structuredClone(record), dismissals: projectDismissals(envelope) } };
}
