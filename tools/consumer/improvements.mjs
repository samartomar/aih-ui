// Improvement suggestions and dismissals: why one Catalog item might help this policy, from fixed versioned rules,
// and what a person chose to do about it. Pure and bounded: it reads the saved envelope, the inventories and the
// declared clients it is handed, calls no model and reads no network, and writes only a new envelope revision through
// recordImprovement. Nothing is applied and nothing is sent anywhere.
import { isCheckedRelease } from '@aihq/catalog/reader';
import { only } from './intake.mjs';
import { refuse, managementIdOf } from './headless.mjs';
import { readJourneyEnvelope, writeJourneyEnvelope, projectJourneyEnvelope, DRAFT_RECORD_SCHEMA, JOURNEY_RECORD_KINDS } from './journey.mjs';
import { isUtcTimestamp } from './maintenance-record.mjs';
import { IMPROVEMENT_SUGGESTION_RECORD_SCHEMA, IMPROVEMENT_DISMISSAL_RECORD_SCHEMA, SUGGESTION_FIELDS, suggestionProblem, suggestionDerivedProblem, dismissalProblem, dismissalId } from './improvement-record.mjs';
import { TRIAL_RECORD_SCHEMA } from './trial-record.mjs';
import { IMPROVEMENT_RULES_VERSION, FRICTION_COVERAGE, FRICTION_UNREADABLE, FIXTURE_LABEL, suggestImprovements, classifyImprovement, lead, improvementPrompt, unorderedSources, savedGoalOf, MAX_GOAL } from './improvement-rules.mjs';
import { adapterTargetOf } from './client-identity.mjs';
import { frictionRecurrence } from './friction.mjs';
export const IMPROVEMENT_SUGGESTION_SCHEMA = IMPROVEMENT_SUGGESTION_RECORD_SCHEMA;
export const IMPROVEMENT_DISMISSAL_SCHEMA = IMPROVEMENT_DISMISSAL_RECORD_SCHEMA;
export { IMPROVEMENT_RULES_VERSION, improvementPrompt };
const isSuggestion = record => record.schema === IMPROVEMENT_SUGGESTION_RECORD_SCHEMA;
const isDismissal = record => record.schema === IMPROVEMENT_DISMISSAL_RECORD_SCHEMA;
const CANDIDATE_SOURCES = ['configured', 'unconfigured'];
// What a check covered, in words: content changes depend on the host's update source (and on knowing which release is later); recurring friction on the
// stored Core results the host holds.
const CONTENT_COVERAGE = { checked: 'Content changes since this policy was saved were checked against the configured update source.',
  'no-configured-source': 'Content changes were not checked: no update source is configured.', 'sources-unavailable': 'Content changes were not checked: the update source could not be read.' };
const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const orderText = names => `Content changes were only partly checked: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''} offers a different release than the one this policy was saved from, but which is newer is unknown (it is unversioned, not a semantic version, or the same version with other content), so it is not suggested as an update.`;
// What the draft ties friction to: the policy selections of its selected roots and pins (a pin carries no scope, so either scope's selection is looked for), and the
// clients and checks its client adapters name. Roots come first, so a root's saved goal wins over the pin of the same item.
function tiedSubjects({ intent, items, inventories, savedBytes }) {
  let selections = [];
  try { const policy = JSON.parse(new TextDecoder().decode(savedBytes)); if (Array.isArray(policy?.selections)) selections = policy.selections.filter(s => typeof s?.id === 'string' && typeof s.managementId === 'string'); } catch { /* an unreadable policy ties no selection */ }
  const packages = new Map(inventories.map(entry => [entry.release.sha256, entry.release.package?.name])), catalog = new Map(items.map(item => [`${item.root.releaseSha256}/${item.id}`, item]));
  const managed = new Map(selections.map(s => [s.managementId, s])), ties = new Map(), order = (a, b) => compare(a.itemId, b.itemId) || compare(a.scope ?? '', b.scope ?? '');
  for (const entry of [...[...intent.roots].sort(order), ...[...intent.pins].sort(order)]) {
    const item = catalog.get(`${entry.releaseSha256}/${entry.itemId}`), name = packages.get(entry.releaseSha256);
    if (!item) continue;
    const goal = savedGoalOf(entry.reason), base = { itemId: entry.itemId, rootItemId: entry.itemId, label: item.label ?? item.id, ...(goal !== undefined ? { goal } : {}) };
    const tie = (kind, key, extra) => { if (!ties.has(`${kind}/${key}`)) ties.set(`${kind}/${key}`, { kind, key, ...base, ...extra }); };
    for (const scope of entry.scope ? [entry.scope] : ['project', 'user']) {
      const selection = typeof name === 'string' ? managed.get(managementIdOf({ scope, packageName: name, itemId: entry.itemId })) : undefined;
      if (selection) tie('managed-selection', selection.managementId, { selectionId: selection.id, scope });
    }
    const clientId = adapterTargetOf(item)?.clientId;
    if (clientId) for (const kind of ['client', 'target']) tie(kind, clientId, entry.scope ? { scope: entry.scope } : {});
  }
  return [...ties.values()];
}
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
// them; `goal` is an optional request. `candidateInventories` is null/undefined when the host's update source could not be
// read, and `candidateSource` says whether the host has one at all ('unconfigured' is unknown, never checked). A caller that
// supplies neither has no update source, so earlier callers keep their meaning. `evidence` (optional) is the host's own stored Core results
// (see friction.mjs), never a request field. `undefined` means the host holds none and `null` means its configured store could not be read; both are unknown
// (`history-unavailable`), never "no friction", and the coverage text says which.
// `coreClients` (optional) is the host's own reading of Core's nativeClientIds, never a request field; it only fills the `client` facts of an adapter suggestion, a display field a recorded suggestion never carries.
export async function checkImprovements({ envelopeBytes, inventories, candidateInventories, candidateSource = candidateInventories === undefined ? 'unconfigured' : 'configured', clients = [], labels = {}, coreClients, goal, evidence, now } = {}) {
  const loaded = await load(envelopeBytes);
  if (loaded.status !== 'ok') return loaded;
  const { read, draft } = loaded.value;
  const fail = (path, message) => refuse('INPUT_INVALID', path, message, envelopeBytes);
  if (!isUtcTimestamp(now)) return fail('/now', 'Supply the check time as an ISO UTC timestamp.');
  if (!CANDIDATE_SOURCES.includes(candidateSource)) return fail('/candidateSource', `Supply one of: ${CANDIDATE_SOURCES.join(', ')}.`);
  if (!checkedEntries(inventories)) return fail('/inventories', 'Supply at most 32 unique checked inventories.');
  const reason = candidateSource === 'unconfigured' ? 'no-configured-source' : candidateInventories === null || candidateInventories === undefined ? 'sources-unavailable' : undefined;
  if (reason === undefined && !checkedEntries(candidateInventories)) return fail('/candidateInventories', 'Supply at most 32 unique checked candidate inventories.');
  if (!Array.isArray(clients) || clients.length > 32 || clients.some(client => typeof client !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(client))) return fail('/clients', 'Supply at most 32 AI client ids.');
  if (!labels || typeof labels !== 'object' || Array.isArray(labels) || Object.keys(labels).length > 32
    || Object.entries(labels).some(([id, label]) => !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || typeof label !== 'string' || label.length < 1 || label.length > 128 || /[\u0000-\u001f\u007f]/.test(label))) return fail('/labels', 'Supply at most 32 client labels of 1 to 128 characters, without control characters.');
  if (goal !== undefined && (typeof goal !== 'string' || goal.length > MAX_GOAL)) return fail('/goal', `Supply a goal of at most ${MAX_GOAL} characters.`);
  const requested = goal !== undefined && goal.trim() !== '';
  const items = inventories.flatMap(entry => entry.release.items.map(item => ({ ...item, root: { releaseSha256: entry.release.sha256 } })));
  const stored = evidence !== undefined && evidence !== null;
  let friction;
  if (stored) {
    try { friction = frictionRecurrence({ evidence, subjects: tiedSubjects({ intent: draft.intent, items, inventories, savedBytes: read.savedIntentBytes }) }); }
    catch (error) { if (error instanceof TypeError) return fail('/evidence', error.message); throw error; }
  }
  // A different release of a saved package whose order is unknown cannot be called newer: the check says so instead of "checked".
  const unordered = reason === undefined ? unorderedSources(draft.intent, inventories, candidateInventories) : [], contentReason = reason ?? (unordered.length ? 'version-order-unknown' : undefined);
  const fixture = stored && evidence.some(entry => entry.fixture === true), frictionReason = !stored ? 'history-unavailable' : friction.results.some(found => found.result.status === 'available') ? undefined : 'no-recurrence-evidence';
  const coverage = [{ trigger: 'content-change', state: contentReason === undefined ? 'checked' : 'unknown', ...(contentReason !== undefined ? { reason: contentReason } : {}),
      text: contentReason === 'version-order-unknown' ? orderText(unordered) : CONTENT_COVERAGE[contentReason ?? 'checked'] },
    { trigger: 'recurring-friction', state: frictionReason === undefined ? 'checked' : 'unknown', ...(frictionReason !== undefined ? { reason: frictionReason } : {}),
      text: `${evidence === null ? FRICTION_UNREADABLE : FRICTION_COVERAGE[frictionReason ?? 'checked']}${fixture ? ` (${FIXTURE_LABEL})` : ''}` }];
  // What was not checked is said on each suggestion too; unknowns are not part of its identity.
  const suggested = await suggestImprovements({ intent: draft.intent, items, inventories, candidates: reason === undefined ? candidateInventories : [], clients, labels, goal, coreClients, friction: friction?.results });
  const unchecked = coverage.filter(entry => entry.state === 'unknown').map(entry => entry.text);
  const current = suggested.map(suggestion => ({ ...suggestion, unknowns: [...suggestion.unknowns, ...unchecked] }));
  const savedBy = new Map(read.records.filter(isSuggestion).map(record => [record.id, record]));
  const dismissals = new Map(read.records.filter(isDismissal).map(record => [record.suggestion.id, record]));
  const shown = (suggestion, dismissal, reasons = []) => ({ ...suggestion, prompt: improvementPrompt(suggestion), dismissal: dismissal ? structuredClone(dismissal) : null,
    ...(reasons.length ? { promotion: { reasons } } : {}) });
  // Package versions of every supplied release, so a dismissed change can tell older content from newer.
  const versions = new Map([...inventories, ...(reason === undefined ? candidateInventories : [])].map(entry => [entry.release.sha256, entry.release.package?.version]));
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
    reads: ['envelope', 'supplied-inventories', ...(reason === undefined ? ['candidate-inventories'] : []), ...(stored ? ['core-evidence'] : []), 'declared-clients', ...(requested ? ['request-goal'] : [])], mutations: [], coverage, ...lead(active), dismissed, preserved } };
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
