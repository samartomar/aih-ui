// Improvement suggestions and dismissals: why one Catalog item might help this policy, from fixed versioned rules,
// and what a person chose to do about it. Pure and bounded: it reads the saved envelope, the inventories and the
// declared clients it is handed, calls no model and reads no network, and writes only a new envelope revision through
// recordImprovement. Nothing is applied and nothing is sent anywhere.
import { isCheckedRelease } from '@aihq/catalog/reader';
import { releaseOrderProblem } from './release-order.mjs';
import { only } from './intake.mjs';
import { refuse } from './headless.mjs';
import { readJourneyEnvelope, writeJourneyEnvelope, projectJourneyEnvelope, DRAFT_RECORD_SCHEMA, JOURNEY_RECORD_KINDS } from './journey.mjs';
import { isUtcTimestamp } from './maintenance-record.mjs';
import { IMPROVEMENT_SUGGESTION_RECORD_SCHEMA, IMPROVEMENT_DISMISSAL_RECORD_SCHEMA, SUGGESTION_FIELDS, suggestionProblem, suggestionDerivedProblem, dismissalProblem, dismissalId } from './improvement-record.mjs';
import { TRIAL_RECORD_SCHEMA } from './trial-record.mjs';
import { IMPROVEMENT_RULES_VERSION, FRICTION_UNKNOWN, savedBaselines, suggestImprovements, classifyImprovement, lead, improvementPrompt, MAX_GOAL } from './improvement-rules.mjs';
export const IMPROVEMENT_SUGGESTION_SCHEMA = IMPROVEMENT_SUGGESTION_RECORD_SCHEMA;
export const IMPROVEMENT_DISMISSAL_SCHEMA = IMPROVEMENT_DISMISSAL_RECORD_SCHEMA;
export { IMPROVEMENT_RULES_VERSION, improvementPrompt };
const isSuggestion = record => record.schema === IMPROVEMENT_SUGGESTION_RECORD_SCHEMA;
const isDismissal = record => record.schema === IMPROVEMENT_DISMISSAL_RECORD_SCHEMA;
const CANDIDATE_SOURCES = ['configured', 'unconfigured'], CANDIDATE_COVERAGES = ['complete', 'partial'];
// What a check covered, in words: content changes depend on the host's update source; recurring friction has no published interface.
const CONTENT_COVERAGE = { checked: 'Content changes since this policy was saved were checked against the configured update source.',
  'no-configured-source': 'Content changes were not checked: no update source is configured.', 'sources-unavailable': 'Content changes were not checked: the update source could not be read.',
  'sources-partly-unavailable': 'Content changes were checked against only part of the update source: some sources could not be read.',
  'saved-release-not-supplied': 'Not every exact release this policy was saved from is supplied, so changes to the missing ones were not compared.' };
const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const checkedEntries = (value, max = 32) => {
  try { return Array.isArray(value) && value.length <= max && value.every(entry => entry && isCheckedRelease(entry.release)) && new Set(value.map(entry => entry.release.sha256)).size === value.length; }
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
// them; `goal` is an optional request. `candidateInventories` is null/undefined when the host's update source could not be
// read, and `candidateSource` says whether the host has one at all ('unconfigured' is unknown, never checked). A caller that
// supplies neither has no update source, so earlier callers keep their meaning.
// `candidateCoverage` is 'partial' when only some of the update source's roots could be read: suggestions from those are still made, but content
// changes are unknown, not checked. A policy none of whose saved releases can be found is likewise unknown, not "nothing changed".
// `releaseOrder` (optional) is the host's declared source order; unknown relations keep semver precedence.
// `coreClients` (optional) is the host's own reading of Core's nativeClientIds, never a request field; it only fills the `client` facts of an adapter suggestion, a display field a recorded suggestion never carries.
export async function checkImprovements({ envelopeBytes, inventories, candidateInventories, candidateSource = candidateInventories === undefined ? 'unconfigured' : 'configured', candidateCoverage = 'complete', clients = [], labels = {}, coreClients, goal, now, releaseOrder } = {}) {
  const loaded = await load(envelopeBytes);
  if (loaded.status !== 'ok') return loaded;
  const { read, draft } = loaded.value;
  const fail = (path, message) => refuse('INPUT_INVALID', path, message, envelopeBytes);
  if (!isUtcTimestamp(now)) return fail('/now', 'Supply the check time as an ISO UTC timestamp.');
  if (releaseOrder !== undefined && releaseOrderProblem(releaseOrder) !== null) return fail('/releaseOrder', 'Supply a valid host-declared release order.');
  if (!CANDIDATE_SOURCES.includes(candidateSource)) return fail('/candidateSource', `Supply one of: ${CANDIDATE_SOURCES.join(', ')}.`);
  if (!CANDIDATE_COVERAGES.includes(candidateCoverage)) return fail('/candidateCoverage', `Supply one of: ${CANDIDATE_COVERAGES.join(', ')}.`);
  if (!checkedEntries(inventories)) return fail('/inventories', 'Supply at most 32 unique checked inventories.');
  // `unread`: nothing came from the update source. `reason`: why content changes are not a complete check, if they are not.
  const unread = candidateSource === 'unconfigured' ? 'no-configured-source' : candidateInventories === null || candidateInventories === undefined ? 'sources-unavailable' : undefined;
  if (unread === undefined && !checkedEntries(candidateInventories, 40)) return fail('/candidateInventories', 'Supply at most 40 unique checked candidate inventories.');
  if (!Array.isArray(clients) || clients.length > 32 || clients.some(client => typeof client !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(client))) return fail('/clients', 'Supply at most 32 AI client ids.');
  if (!labels || typeof labels !== 'object' || Array.isArray(labels) || Object.keys(labels).length > 32
    || Object.entries(labels).some(([id, label]) => !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || typeof label !== 'string' || label.length < 1 || label.length > 128 || /[\u0000-\u001f\u007f]/.test(label))) return fail('/labels', 'Supply at most 32 client labels of 1 to 128 characters, without control characters.');
  if (goal !== undefined && (typeof goal !== 'string' || goal.length > MAX_GOAL)) return fail('/goal', `Supply a goal of at most ${MAX_GOAL} characters.`);
  const baselines = unread === undefined ? savedBaselines(draft.intent, inventories, candidateInventories) : undefined;
  const reason = unread ?? (candidateCoverage === 'partial' ? 'sources-partly-unavailable' : baselines.resolved.length < baselines.saved ? 'saved-release-not-supplied' : undefined);
  const requested = goal !== undefined && goal.trim() !== '';
  const items = inventories.flatMap(entry => entry.release.items.map(item => ({ ...item, root: { releaseSha256: entry.release.sha256 } })));
  const text = reason === undefined && releaseOrder !== undefined
    ? "Content changes since this policy was saved were checked against the configured update source using the release order declared by this host's update source." : CONTENT_COVERAGE[reason ?? 'checked'], coverage = [{ trigger: 'content-change', state: reason === undefined ? 'checked' : 'unknown', ...(reason !== undefined ? { reason } : {}), text },
    { trigger: 'recurring-friction', state: 'unknown', reason: 'no-published-interface', text: FRICTION_UNKNOWN }];
  // Unchecked content changes are said on each suggestion too; unknowns are not part of its identity.
  const suggested = await suggestImprovements({ intent: draft.intent, items, inventories, candidates: unread === undefined ? candidateInventories : [], clients, labels, goal, coreClients, releaseOrder });
  const current = reason === undefined ? suggested : suggested.map(suggestion => ({ ...suggestion, unknowns: [...suggestion.unknowns, text] }));
  const savedBy = new Map(read.records.filter(isSuggestion).map(record => [record.id, record]));
  const dismissals = new Map(read.records.filter(isDismissal).map(record => [record.suggestion.id, record]));
  const shown = (suggestion, dismissal, reasons = []) => ({ ...suggestion, prompt: improvementPrompt(suggestion), dismissal: dismissal ? structuredClone(dismissal) : null,
    ...(reasons.length ? { promotion: { reasons } } : {}) });
  // Package versions of every supplied release, so a dismissed change can tell older content from newer.
  const versions = new Map([...inventories, ...(unread === undefined ? candidateInventories : [])].map(entry => [entry.release.sha256, entry.release.package?.version]));
  const active = [], dismissed = [], matched = new Set();
  for (const suggestion of current) {
    const dismissal = dismissals.get(suggestion.id);
    if (!dismissal) { active.push(shown(suggestion, null)); continue; }
    matched.add(dismissal.id);
    const { dismissed: stays, reasons } = classifyImprovement(suggestion, savedBy.get(dismissal.suggestion.id), sha => versions.get(sha));
    (stays ? dismissed : active).push(shown(suggestion, dismissal, reasons));
  }
  const preserved = [...dismissals.values()].filter(dismissal => !matched.has(dismissal.id)).sort(byId)
    .map(dismissal => ({ dismissal: structuredClone(dismissal), suggestion: structuredClone(savedBy.get(dismissal.suggestion.id)), state: 'not-current' }));
  return { status: 'ok', diagnostics: loaded.diagnostics, value: { rulesVersion: IMPROVEMENT_RULES_VERSION, checkedAt: now,
    reads: ['envelope', 'supplied-inventories', ...(unread === undefined ? ['candidate-inventories'] : []), 'declared-clients', ...(requested ? ['request-goal'] : [])], mutations: [], coverage, ...lead(active), dismissed, preserved } };
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
    // A trial still needs the suggestion it was planned from, so only the dismissal goes then.
    const planned = read.records.some(r => r.schema === TRIAL_RECORD_SCHEMA && r.suggestion?.id === operation.id);
    nextSuggestions = suggestions.filter(r => r.id !== operation.id || planned);
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
