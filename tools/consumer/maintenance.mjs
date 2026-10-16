// Maintenance dispositions: what a person chose to do about an available update, kept in the journey
// envelope with the time and states of the last successful check. Pure and bounded: it reads the saved
// envelope and the inventories it is handed, and writes only a new envelope revision through
// recordMaintenance. A date never schedules anything.
import { isCheckedRelease } from '@aihq/catalog/reader';
import { rootKey, pinKey } from './intent-shape.mjs';
import { only } from './intake.mjs';
import { refuse, stable } from './headless.mjs';
import { releaseOrderProblem, orderRelation } from './release-order.mjs';
import { readJourneyEnvelope, writeJourneyEnvelope, projectJourneyEnvelope, DRAFT_RECORD_SCHEMA, JOURNEY_RECORD_KINDS } from './journey.mjs';
import { isUtcTimestamp, dispositionProblem, dispositionId, checkProblem, MAINTENANCE_DISPOSITION_RECORD_SCHEMA, MAINTENANCE_CHECK_RECORD_SCHEMA,
  MAINTENANCE_CHECK_RECORD_ID, UPDATE_CATEGORIES } from './maintenance-record.mjs';
export const MAINTENANCE_DISPOSITION_SCHEMA = MAINTENANCE_DISPOSITION_RECORD_SCHEMA;
export const MAINTENANCE_CHECK_SCHEMA = MAINTENANCE_CHECK_RECORD_SCHEMA;
export { UPDATE_CATEGORIES };
const isDisposition = record => record.schema === MAINTENANCE_DISPOSITION_RECORD_SCHEMA;
const isCheck = record => record.schema === MAINTENANCE_CHECK_RECORD_SCHEMA;
const CANDIDATE_SOURCES = ['configured', 'unconfigured'];
const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const checkedEntries = (value, most = 32) => {
  try { return Array.isArray(value) && value.length <= most && value.every(entry => entry && isCheckedRelease(entry.release)) && new Set(value.map(entry => entry.release.sha256)).size === value.length; }
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
// Display list of the recorded dispositions; never carries saved-intent bytes.
export function projectDispositions(envelope) {
  return (Array.isArray(envelope?.records) ? envelope.records : []).filter(isDisposition).map(record => structuredClone(record));
}
// Bounded read: no scan, native check, model call, host prepare/apply or write. The host supplies
// `now`; `candidateInventories` is null/undefined when the maintenance source could not be read, and
// `candidateSource` says whether the host has one at all ('unconfigured' is unknown, never checked). A `releaseOrder` the
// host's update source declares says, per offered update, whether it is newer or of unknown order; an older one is not offered.
export async function checkMaintenance({ envelopeBytes, inventories, candidateInventories, candidateSource = 'configured', releaseOrder, categories = ['content'], now } = {}) {
  const loaded = await load(envelopeBytes);
  if (loaded.status !== 'ok') return loaded;
  const { read, draft } = loaded.value, { intent } = draft;
  const fail = (path, message) => refuse('INPUT_INVALID', path, message, envelopeBytes);
  if (!isUtcTimestamp(now)) return fail('/now', 'Supply the check time as an ISO UTC timestamp.');
  if (!Array.isArray(categories) || !categories.length || categories.some(category => !UPDATE_CATEGORIES.includes(category))) return fail('/categories', `Supply one or more of: ${UPDATE_CATEGORIES.join(', ')}.`);
  if (!CANDIDATE_SOURCES.includes(candidateSource)) return fail('/candidateSource', `Supply one of: ${CANDIDATE_SOURCES.join(', ')}.`);
  const orderProblem = releaseOrder === undefined || releaseOrder === null ? null : releaseOrderProblem(releaseOrder);
  if (orderProblem !== null) return fail(`/releaseOrder${orderProblem}`, 'Supply the release order a host update source declares.');
  if (!checkedEntries(inventories)) return fail('/inventories', 'Supply at most 32 unique checked inventories.');
  const selected = new Set(categories), unconfigured = candidateSource === 'unconfigured', offline = candidateInventories === null || candidateInventories === undefined;
  const states = UPDATE_CATEGORIES.map(category => !selected.has(category) ? { category, selected: false, state: 'not-selected' }
    : category !== 'content' ? { category, selected: true, state: 'unknown', reason: 'no-supported-reader' }
    : unconfigured ? { category, selected: true, state: 'unknown', reason: 'no-configured-source' }
    : offline ? { category, selected: true, state: 'unknown', reason: 'sources-unavailable' } : { category, selected: true, state: 'checked' });
  const contentChecked = states.find(state => state.category === 'content').state === 'checked';
  if (contentChecked && !checkedEntries(candidateInventories, 40)) return fail('/candidateInventories', 'Supply at most 40 unique checked candidate inventories.');
  const recorded = read.records.filter(isDisposition), today = now.slice(0, 10), matched = new Set(), updates = [];
  for (const root of contentChecked ? intent.roots : []) {
    const entry = inventories.find(e => e.release.sha256 === root.releaseSha256);
    const current = intent.provenance.find(p => p.releaseSha256 === root.releaseSha256)?.package ?? entry?.release.package;
    const input = intent.inputs.find(i => i.releaseSha256 === root.releaseSha256) ?? entry?.input;
    if (current?.name === undefined) continue;
    const subject = { kind: 'selection', releaseSha256: root.releaseSha256, itemId: root.itemId, itemSha256: root.itemSha256 };
    for (const offered of candidateInventories) {
      if (offered.release.sha256 === root.releaseSha256 || offered.release.package?.name !== current.name) continue;
      if (input ? offered.input?.kind !== input.kind || stable(offered.input?.locator) !== stable(input.locator) : offered.input) continue;
      const order = orderRelation(releaseOrder ?? undefined, offered.release.sha256, root.releaseSha256);
      if (order?.relation === 'older') continue;
      for (const item of offered.release.items.filter(i => i.id === root.itemId)) {
        const candidate = { kind: 'content-revision', releaseSha256: offered.release.sha256, itemId: item.id, itemSha256: item.itemSha256 };
        const id = await dispositionId({ category: 'content', subject, scope: root.scope, candidate }), disposition = recorded.find(r => r.id === id) ?? null;
        if (disposition) matched.add(id);
        const attention = !disposition ? 'new' : disposition.disposition === 'defer' && disposition.deferUntil !== undefined && disposition.deferUntil <= today ? 'defer-date-reached' : null;
        const facts = [];
        if (root.originIds.some(origin => intent.origins.find(o => o.id === origin)?.kind === 'organization'))
          facts.push({ kind: 'authority', code: 'organization-origin', message: `${root.itemId} is selected through an organization origin; this update does not change that authority.` });
        if (!entry) facts.push({ kind: 'availability', code: 'source-unavailable', message: `The exact selected release of ${root.itemId} is not supplied to this check.` });
        for (const review of intent.reviews.records) if ([subject, candidate].some(ref => pinKey(ref) === pinKey(review.subject)))
          facts.push({ kind: 'evidence', code: review.state === 'reconsider' ? 'review-reconsider' : 'review-current', recordId: review.id,
            message: `Review decision ${review.id} (${review.disposition}) is bound to ${pinKey(review.subject) === pinKey(subject) ? 'the selected' : 'the offered'} revision and is ${review.state === 'reconsider' ? 'awaiting reconsideration' : 'current'}.` });
        updates.push({ id, category: 'content', subject, scope: root.scope, candidate, disposition, attention, promoted: attention !== null,
          package: { name: offered.release.package.name, ...(offered.release.package.version !== undefined ? { version: offered.release.package.version } : {}) },
          currentPackage: structuredClone(current), ...(order ? { order } : {}), facts });
      }
    }
  }
  updates.sort((a, b) => compare(a.subject.itemId, b.subject.itemId) || compare(a.candidate.releaseSha256, b.candidate.releaseSha256)
    || compare(a.subject.releaseSha256, b.subject.releaseSha256) || compare(a.scope, b.scope));
  const roots = new Set(intent.roots.map(rootKey));
  const preserved = recorded.filter(record => !matched.has(record.id)).sort(byId).map(record => ({ record: structuredClone(record),
    state: !roots.has(rootKey({ ...record.subject, scope: record.scope })) ? 'orphaned' : record.category !== 'content' || !contentChecked ? 'unknown' : 'not-offered' }));
  // The last successful check the envelope recorded, if any; this check itself writes nothing.
  const note = read.records.find(isCheck);
  return { status: 'ok', diagnostics: loaded.diagnostics, value: { checkedAt: now,
    reads: ['envelope', 'supplied-inventories', ...(contentChecked ? ['candidate-inventories'] : [])], mutations: [], categories: states, updates, preserved,
    ...(note ? { lastCheck: { checkedAt: note.checkedAt, categories: structuredClone(note.categories) } } : {}) } };
}
// A deliberate choice, or the note of a successful check, becomes a new envelope revision; the saved intent
// and the draft are untouched.
export async function recordMaintenance({ envelopeBytes, operation, now } = {}) {
  const loaded = await load(envelopeBytes);
  if (loaded.status !== 'ok') return loaded;
  const { read, draft } = loaded.value;
  const fail = (path, message) => refuse('INPUT_INVALID', path, message, envelopeBytes);
  if (!read.supported) return refuse('JOURNEY_RECORD_UNSUPPORTED', '/records', 'The envelope has required records this version cannot change; it is read-only.', envelopeBytes);
  if (!isUtcTimestamp(now)) return fail('/now', 'Supply the record time as an ISO UTC timestamp.');
  if (!operation || typeof operation !== 'object' || !['set', 'clear', 'note-check'].includes(operation.type)) return fail('/operation/type', 'Supply a set, clear or note-check operation.');
  const dispositions = read.records.filter(isDisposition);
  let next = dispositions, note = read.records.find(isCheck), record;
  if (operation.type === 'note-check') {
    if (!only(operation, ['type', 'checkedAt', 'categories'])) return fail('/operation', 'Supply {type,checkedAt,categories}.');
    record = { id: MAINTENANCE_CHECK_RECORD_ID, schema: MAINTENANCE_CHECK_RECORD_SCHEMA, required: false, checkedAt: operation.checkedAt, categories: operation.categories };
    const problem = checkProblem(record);
    if (problem !== null) return fail(`/operation${problem}`, 'Supply a valid maintenance check.');
    if (Date.parse(record.checkedAt) > Date.parse(now)) return fail('/operation/checkedAt', 'A check cannot be recorded as made later than the record time.');
    note = structuredClone(record);
  } else if (operation.type === 'clear') {
    if (!only(operation, ['type', 'id'])) return fail('/operation', 'Supply {type,id}.');
    record = dispositions.find(r => r.id === operation.id);
    if (!record) return fail('/operation/id', 'No recorded disposition has that id.');
    next = dispositions.filter(r => r !== record);
  } else {
    if (!only(operation, ['type', 'category', 'subject', 'scope', 'candidate', 'disposition'], ['reason', 'deferUntil']))
      return fail('/operation', 'Supply {type,category,subject,scope,candidate,disposition,reason?,deferUntil?}.');
    const { type: _type, ...fields } = operation;
    record = { id: await dispositionId(fields), schema: MAINTENANCE_DISPOSITION_RECORD_SCHEMA, required: false, ...fields, recordedAt: now };
    const problem = dispositionProblem(record);
    if (problem !== null) return fail(`/operation${problem}`, 'Supply a valid maintenance disposition.');
    const { subject } = record;
    if (!draft.intent.roots.some(r => r.releaseSha256 === subject.releaseSha256 && r.itemId === subject.itemId && r.itemSha256 === subject.itemSha256 && r.scope === record.scope))
      return fail('/operation/subject', 'The subject must be a choice in this draft.');
    next = [...dispositions.filter(r => r.id !== record.id), record];
  }
  const records = [...read.records.filter(r => Object.hasOwn(JOURNEY_RECORD_KINDS, r.schema) && !isDisposition(r) && !isCheck(r)), ...[...next].sort(byId), ...(note ? [note] : [])];
  const written = await writeJourneyEnvelope({ savedIntentBytes: read.savedIntentBytes, records, previous: read });
  if (written.status !== 'ok') return { ...written, originalBytes: envelopeBytes.slice() };
  const { envelope, envelopeBytes: bytes } = written.value;
  return { status: 'ok', diagnostics: [], value: { envelopeBytes: bytes, envelope, projection: projectJourneyEnvelope(envelope), record: structuredClone(record), dispositions: projectDispositions(envelope) } };
}
