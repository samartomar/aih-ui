import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { composeAuthoring, freshAuthoring, stable, openDraft, editDraft } from './headless.mjs';
import * as journey from './journey.mjs';
import { readJourneyEnvelope, writeJourneyEnvelope, JOURNEY_RECORD_KINDS } from './journey.mjs';
import { checkMaintenance, recordMaintenance, projectDispositions, MAINTENANCE_DISPOSITION_SCHEMA, MAINTENANCE_CHECK_SCHEMA, UPDATE_CATEGORIES } from './maintenance.mjs';
import { createMixedService } from './mixed-service.mjs';
import { mixedInventories } from './authoring-v3.test.mjs';
import { intakeDeclaration, digestBytes } from './intake.mjs';
import { noteFixture } from './note-fixture.mjs';
import { declareReleaseOrder, RELEASE_ORDER_TEXT } from './release-order.mjs';
const encode = value => new TextEncoder().encode(value), decode = bytes => new TextDecoder().decode(bytes);
const NOW = '2026-10-15T12:00:00Z';
const rootOf = (entry, itemId, extra = {}) => {
  const item = entry.release.items.find(i => i.id === itemId);
  return { releaseSha256: entry.release.sha256, itemId, itemSha256: item.itemSha256, scope: 'project', configuration: {}, originIds: ['direct'], ...extra };
};
// A revision of the same `notes` input: same id and locator, so it matches the saved release as a newer revision.
async function notesRevision(variant, tweak) {
  const snapshot = await noteFixture(variant);
  if (tweak) snapshot.declarationBytes = encode(JSON.stringify(tweak(JSON.parse(decode(snapshot.declarationBytes)))));
  const input = { id: 'notes', kind: 'local', locator: { input: 'notes' }, resolvedIdentity: { sha256: await digestBytes(snapshot.declarationBytes) } };
  const result = await intakeDeclaration({ input, ...snapshot, materialSource: { kind: 'local', input: 'notes' } });
  assert.equal(result.status, 'ok', JSON.stringify(result.diagnostics));
  return result.value;
}
async function scenario(intentEdit) {
  const inventories = await mixedInventories(), [maintained, notes] = inventories;
  const intent = freshAuthoring();
  intent.roots.push(rootOf(notes, notes.release.items[0].id), rootOf(maintained, 'mattpocock.code-review'));
  intentEdit?.(intent, { maintained, notes });
  const saved = await composeAuthoring({ intent, inventories });
  assert.equal(saved.status, 'ok', JSON.stringify(saved.diagnostics));
  const open = await openDraft({ bytes: saved.value.policyBytes, inventories });
  assert.equal(open.status, 'ok', JSON.stringify(open.diagnostics));
  const updated = await notesRevision('updated'), newer = await notesRevision('updated', declaration => ({ ...declaration, package: { ...declaration.package, version: '1.0.2' } }));
  const noteId = notes.release.items[0].id;
  const subject = { kind: 'selection', releaseSha256: notes.release.sha256, itemId: noteId, itemSha256: notes.release.items[0].itemSha256 };
  const candidateOf = entry => ({ kind: 'content-revision', releaseSha256: entry.release.sha256, itemId: noteId, itemSha256: entry.release.items.find(i => i.id === noteId).itemSha256 });
  return { inventories, maintained, notes, updated, newer, noteId, subject, candidateOf, policyBytes: saved.value.policyBytes, envelopeBytes: open.value.envelopeBytes, open: open.value };
}
const check = async options => {
  const result = await checkMaintenance({ now: NOW, ...options });
  assert.equal(result.status, 'ok', JSON.stringify(result.diagnostics));
  return result.value;
};
const record = async (envelopeBytes, operation, now = NOW) => {
  const result = await recordMaintenance({ envelopeBytes, operation, now });
  assert.equal(result.status, 'ok', JSON.stringify(result.diagnostics));
  return result.value;
};
const setOp = (s, candidate, disposition, extra = {}) => ({ type: 'set', category: 'content', subject: s.subject, scope: 'project', candidate: s.candidateOf(candidate), disposition, ...extra });
const NO_FETCH = { fetch: globalThis.fetch };
const noNetwork = () => { globalThis.fetch = () => { throw new Error('maintenance must not use the network'); }; };
test.afterEach(() => { globalThis.fetch = NO_FETCH.fetch; });

test('a first check lists the newer revision as new and promoted, and changes nothing', async () => {
  noNetwork();
  const s = await scenario();
  const before = s.envelopeBytes.slice();
  const value = await check({ envelopeBytes: s.envelopeBytes, inventories: s.inventories, candidateInventories: [...s.inventories, s.updated] });
  assert.deepEqual(s.envelopeBytes, before);
  assert.deepEqual(value.mutations, []);
  assert.equal(value.checkedAt, NOW);
  assert.deepEqual(value.reads, ['envelope', 'supplied-inventories', 'candidate-inventories']);
  assert.deepEqual(value.categories, [{ category: 'content', selected: true, state: 'checked' }, { category: 'software', selected: false, state: 'not-selected' },
    { category: 'client', selected: false, state: 'not-selected' }, { category: 'environment', selected: false, state: 'not-selected' }]);
  assert.equal(value.updates.length, 1);
  const [update] = value.updates;
  assert.deepEqual(update.subject, s.subject); assert.deepEqual(update.candidate, s.candidateOf(s.updated));
  assert.equal(update.scope, 'project'); assert.equal(update.category, 'content');
  assert.equal(update.disposition, null); assert.equal(update.attention, 'new'); assert.equal(update.promoted, true);
  assert.match(update.id, /^disposition-[a-f0-9]{32}$/);
  assert.equal(update.package.name, s.updated.release.package.name); assert.equal(update.package.version, '1.0.1');
  assert.deepEqual(value.preserved, []);
  // The maintained root has no newer revision offered, so only the notes choice appears.
  assert.deepEqual(value.updates.map(u => u.subject.itemId), [s.noteId]);
});

test('record kind round-trips: set replaces by exact candidate, clear removes, draft and saved intent stay byte-identical', async () => {
  const s = await scenario();
  const first = await record(s.envelopeBytes, setOp(s, s.updated, 'keep-current'));
  assert.equal(first.envelope.revision.sequence, 2); assert.equal(first.envelope.revision.previousSha256, s.open.envelope.revision.sha256);
  const read = await readJourneyEnvelope(first.envelopeBytes);
  assert.equal(read.status, 'ok', JSON.stringify(read.diagnostics)); assert.equal(read.value.supported, true);
  assert.deepEqual(read.value.savedIntentBytes, s.policyBytes);
  assert.deepEqual(first.envelope.records.find(r => r.id === 'draft'), s.open.envelope.records[0]);
  assert.equal(first.envelope.savedIntent.base64, s.open.envelope.savedIntent.base64);
  assert.equal(first.record.schema, MAINTENANCE_DISPOSITION_SCHEMA);
  assert.equal(first.record.required, false); assert.equal(first.record.recordedAt, NOW); assert.equal(first.record.disposition, 'keep-current');
  assert.match(first.record.id, /^disposition-[a-f0-9]{32}$/);
  assert.deepEqual(first.dispositions.map(d => d.id), [first.record.id]);
  assert.deepEqual(first.projection.records.map(r => [r.id, r.required, r.supported]), [['draft', true, true], [first.record.id, false, true]]);
  assert.deepEqual(projectDispositions(first.envelope), first.dispositions);
  assert.equal(JSON.stringify(projectDispositions(first.envelope)).includes('base64'), false);
  // The same exact candidate replaces the record (same id), with the new choice and reason.
  const second = await record(first.envelopeBytes, setOp(s, s.updated, 'skip', { reason: 'Not needed this quarter.' }), '2026-10-16T08:00:00Z');
  assert.equal(second.record.id, first.record.id); assert.equal(second.dispositions.length, 1);
  assert.equal(second.dispositions[0].disposition, 'skip'); assert.equal(second.dispositions[0].reason, 'Not needed this quarter.');
  assert.equal(second.dispositions[0].recordedAt, '2026-10-16T08:00:00Z'); assert.equal(second.envelope.revision.sequence, 3);
  // A different candidate is its own record.
  const other = await record(second.envelopeBytes, setOp(s, s.newer, 'defer', { deferUntil: '2026-12-01' }));
  assert.equal(other.dispositions.length, 2); assert.notEqual(other.record.id, first.record.id);
  assert.equal(other.record.deferUntil, '2026-12-01');
  // Deliberate revisit clears exactly one.
  const cleared = await record(other.envelopeBytes, { type: 'clear', id: first.record.id });
  assert.deepEqual(cleared.dispositions.map(d => d.id), [other.record.id]);
  assert.deepEqual(cleared.envelope.records.find(r => r.id === 'draft'), s.open.envelope.records[0]);
  const none = await record(cleared.envelopeBytes, { type: 'clear', id: other.record.id });
  assert.deepEqual(none.dispositions, []);
  assert.deepEqual(none.envelope.records, s.open.envelope.records);
  assert.deepEqual(none.envelope.savedIntent, s.open.envelope.savedIntent);
  // Written output is deterministic.
  const again = await record(s.envelopeBytes, setOp(s, s.updated, 'keep-current'));
  assert.deepEqual(again.envelopeBytes, first.envelopeBytes);
});

test('reopening the saved envelope preserves the exact skip, defer and keep-current choices', async () => {
  noNetwork();
  const s = await scenario(), candidates = [...s.inventories, s.updated, s.newer];
  let value = (await record(s.envelopeBytes, setOp(s, s.updated, 'skip'))).envelopeBytes;
  value = (await record(value, setOp(s, s.newer, 'defer', { deferUntil: '2026-11-01' }))).envelopeBytes;
  const reopened = await openDraft({ bytes: value, inventories: s.inventories });
  assert.equal(reopened.status, 'ok', JSON.stringify(reopened.diagnostics));
  assert.deepEqual(reopened.value.envelopeBytes, value);
  assert.equal(reopened.value.projection.records.filter(r => r.schema === MAINTENANCE_DISPOSITION_SCHEMA).length, 2);
  const result = await check({ envelopeBytes: reopened.value.envelopeBytes, inventories: s.inventories, candidateInventories: candidates });
  const byVersion = Object.fromEntries(result.updates.map(u => [u.package.version, u]));
  assert.equal(byVersion['1.0.1'].disposition.disposition, 'skip'); assert.equal(byVersion['1.0.1'].promoted, false); assert.equal(byVersion['1.0.1'].attention, null);
  assert.equal(byVersion['1.0.2'].disposition.disposition, 'defer'); assert.equal(byVersion['1.0.2'].promoted, false); assert.equal(byVersion['1.0.2'].attention, null);
  assert.deepEqual(result.preserved, []);
  assert.equal(result.updates.some(u => u.promoted), false);
  // Keep current is listed, not promoted.
  const kept = await record(value, setOp(s, s.updated, 'keep-current'));
  const listed = await check({ envelopeBytes: kept.envelopeBytes, inventories: s.inventories, candidateInventories: [...s.inventories, s.updated] });
  assert.equal(listed.updates.length, 1); assert.equal(listed.updates[0].disposition.disposition, 'keep-current');
  assert.equal(listed.updates[0].promoted, false); assert.equal(listed.updates[0].attention, null);
  // The deferred record on an unoffered candidate is preserved, never dropped.
  assert.deepEqual(listed.preserved.map(p => [p.record.disposition, p.state]), [['defer', 'not-offered']]);
});

test('a newer revision appears separately while the skip on the older one stays', async () => {
  const s = await scenario();
  const skipped = await record(s.envelopeBytes, setOp(s, s.updated, 'skip'));
  const both = await check({ envelopeBytes: skipped.envelopeBytes, inventories: s.inventories, candidateInventories: [...s.inventories, s.updated, s.newer] });
  assert.equal(both.updates.length, 2);
  const older = both.updates.find(u => u.package.version === '1.0.1'), newer = both.updates.find(u => u.package.version === '1.0.2');
  assert.equal(older.promoted, false); assert.equal(older.disposition.disposition, 'skip');
  assert.equal(newer.promoted, true); assert.equal(newer.attention, 'new'); assert.equal(newer.disposition, null);
  assert.notEqual(older.id, newer.id);
  // Only the newer one is offered later: the skip on the old revision is preserved as not offered, the new one is promoted.
  const later = await check({ envelopeBytes: skipped.envelopeBytes, inventories: s.inventories, candidateInventories: [...s.inventories, s.newer] });
  assert.deepEqual(later.updates.map(u => [u.package.version, u.attention, u.promoted]), [['1.0.2', 'new', true]]);
  assert.deepEqual(later.preserved.map(p => [p.record.id, p.state]), [[skipped.record.id, 'not-offered']]);
  // Updates are ordered deterministically (item id, then candidate release).
  const order = [...both.updates].sort((a, b) => a.subject.itemId < b.subject.itemId ? -1 : a.subject.itemId > b.subject.itemId ? 1 : a.candidate.releaseSha256 < b.candidate.releaseSha256 ? -1 : 1);
  assert.deepEqual(both.updates.map(u => u.id), order.map(u => u.id));
});

test('authority and evidence facts stay visible whatever the disposition', async () => {
  const s = await scenario(intent => {
    intent.origins.push({ id: 'team', kind: 'organization', organizationPolicySha256: 'a'.repeat(64), organizationSelectionId: 'notes' });
    intent.roots[0].originIds = ['direct', 'team'];
  });
  const review = {
    id: 'review-1', owner: { kind: 'individual', id: 'reviewer' }, actor: 'reviewer', recordedAt: '2026-09-01T00:00:00Z', disposition: 'accepted-risk', reason: 'Reviewed.',
    subject: { releaseSha256: s.subject.releaseSha256, itemId: s.noteId, itemSha256: s.subject.itemSha256, recipeIdentity: 'recipe-1', materials: [] },
    finding: { detectorId: 'd', ruleId: 'r', findingId: 'f' },
    evidence: Object.fromEntries(['observationIdentity', 'detectorIdentity', 'rulesIdentity', 'configurationIdentity', 'profileIdentity', 'scopeIdentity', 'coverageIdentity'].map(k => [k, `${k}-1`])),
    state: 'current' };
  // Hand-write the draft with a review record; facts come from the recorded intent, not from new evidence.
  const read = (await readJourneyEnvelope(s.envelopeBytes)).value, intent = structuredClone(read.records[0].intent);
  intent.reviews.records.push(review);
  const written = await writeJourneyEnvelope({ savedIntentBytes: read.savedIntentBytes, previous: read, records: [{ id: 'draft', schema: read.records[0].schema, required: true, intent }] });
  assert.equal(written.status, 'ok', JSON.stringify(written.diagnostics));
  const candidates = [...s.inventories, s.updated];
  const factCodes = update => update.facts.map(f => `${f.kind}:${f.code}`).sort();
  const plain = await check({ envelopeBytes: written.value.envelopeBytes, inventories: s.inventories, candidateInventories: candidates });
  assert.deepEqual(factCodes(plain.updates[0]), ['authority:organization-origin', 'evidence:review-current']);
  assert.equal(plain.updates[0].facts.find(f => f.code === 'review-current').recordId, 'review-1');
  for (const disposition of ['keep-current', 'skip', 'defer']) {
    const after = await record(written.value.envelopeBytes, setOp(s, s.updated, disposition));
    const value = await check({ envelopeBytes: after.envelopeBytes, inventories: s.inventories, candidateInventories: candidates });
    assert.deepEqual(factCodes(value.updates[0]), factCodes(plain.updates[0]), disposition);
    assert.equal(value.updates[0].promoted, false);
  }
  // An unsupplied subject release is itself a fact.
  const unavailable = await check({ envelopeBytes: written.value.envelopeBytes, inventories: [s.maintained], candidateInventories: candidates });
  assert.ok(factCodes(unavailable.updates[0]).includes('availability:source-unavailable'));
  // A reconsider decision bound to the candidate is reported as such.
  const reconsider = structuredClone(intent);
  reconsider.reviews.records = [{ ...review, id: 'reconsider-1', state: 'reconsider', supersedes: 'review-1',
    subject: { ...review.subject, releaseSha256: s.updated.release.sha256, itemSha256: s.candidateOf(s.updated).itemSha256 } }];
  reconsider.reviews.history = [{ ...review, state: 'current' }];
  const rewritten = await writeJourneyEnvelope({ savedIntentBytes: read.savedIntentBytes, previous: (await readJourneyEnvelope(written.value.envelopeBytes)).value, records: [{ id: 'draft', schema: read.records[0].schema, required: true, intent: reconsider }] });
  assert.equal(rewritten.status, 'ok', JSON.stringify(rewritten.diagnostics));
  const marked = await check({ envelopeBytes: rewritten.value.envelopeBytes, inventories: s.inventories, candidateInventories: candidates });
  assert.ok(marked.updates[0].facts.some(f => f.code === 'review-reconsider' && f.recordId === 'reconsider-1'));
});

test('defer until a date: not promoted before it, defer-date-reached on or after it, nothing else changes', async () => {
  const s = await scenario(), candidates = [...s.inventories, s.updated];
  const open = await record(s.envelopeBytes, setOp(s, s.updated, 'defer', { deferUntil: '2026-11-01' }));
  const before = await check({ envelopeBytes: open.envelopeBytes, inventories: s.inventories, candidateInventories: candidates, now: '2026-10-31T23:59:59Z' });
  assert.equal(before.updates[0].promoted, false); assert.equal(before.updates[0].attention, null);
  const on = await check({ envelopeBytes: open.envelopeBytes, inventories: s.inventories, candidateInventories: candidates, now: '2026-11-01T00:00:00Z' });
  assert.equal(on.updates[0].promoted, true); assert.equal(on.updates[0].attention, 'defer-date-reached');
  assert.equal(on.updates[0].disposition.disposition, 'defer'); assert.equal(on.updates[0].disposition.deferUntil, '2026-11-01');
  const after = await check({ envelopeBytes: open.envelopeBytes, inventories: s.inventories, candidateInventories: candidates, now: '2027-01-01T10:00:00Z' });
  assert.equal(after.updates[0].attention, 'defer-date-reached');
  // The envelope is read-only to the check: reaching the date records and schedules nothing.
  assert.deepEqual(on.mutations, []);
  // A defer without a date is never promoted by a check.
  const open2 = await record(s.envelopeBytes, setOp(s, s.updated, 'defer'));
  const undated = await check({ envelopeBytes: open2.envelopeBytes, inventories: s.inventories, candidateInventories: candidates, now: '2099-01-01T00:00:00Z' });
  assert.equal(undated.updates[0].promoted, false); assert.equal(undated.updates[0].attention, null);
});

test('categories: only content is read by default; others are unknown without a reader; unselected is never evaluated', async () => {
  const s = await scenario(), candidates = [...s.inventories, s.updated];
  const kept = await record(s.envelopeBytes, setOp(s, s.updated, 'skip'));
  const software = await record(kept.envelopeBytes, { ...setOp(s, s.updated, 'keep-current'), category: 'software' });
  assert.equal(software.dispositions.length, 2);
  const base = { envelopeBytes: software.envelopeBytes, inventories: s.inventories, candidateInventories: candidates };
  const byDefault = await check(base);
  assert.deepEqual(byDefault.categories.map(c => [c.category, c.state]), [['content', 'checked'], ['software', 'not-selected'], ['client', 'not-selected'], ['environment', 'not-selected']]);
  assert.equal(byDefault.updates.every(u => u.category === 'content'), true);
  // The software disposition is preserved as unknown, not evaluated.
  assert.deepEqual(byDefault.preserved.map(p => [p.record.category, p.state]), [['software', 'unknown']]);
  const selected = await check({ ...base, categories: ['content', 'software', 'client'] });
  assert.deepEqual(selected.categories, [{ category: 'content', selected: true, state: 'checked' },
    { category: 'software', selected: true, state: 'unknown', reason: 'no-supported-reader' },
    { category: 'client', selected: true, state: 'unknown', reason: 'no-supported-reader' },
    { category: 'environment', selected: false, state: 'not-selected' }]);
  assert.equal(selected.updates.every(u => u.category === 'content'), true);
  // Content unselected: not evaluated at all, no candidate inventories read, and dispositions are preserved as unknown.
  const none = await check({ ...base, categories: ['environment'] });
  assert.deepEqual(none.updates, []);
  assert.deepEqual(none.categories.find(c => c.category === 'content'), { category: 'content', selected: false, state: 'not-selected' });
  assert.deepEqual(none.categories.find(c => c.category === 'environment'), { category: 'environment', selected: true, state: 'unknown', reason: 'no-supported-reader' });
  assert.deepEqual(none.preserved.map(p => p.state).sort(), ['unknown', 'unknown']);
  assert.equal(none.reads.includes('candidate-inventories'), false);
  for (const bad of [['hardware'], [], 'content', null, [1], ['content', 'nope']]) {
    const refused = await checkMaintenance({ ...base, categories: bad, now: NOW });
    assert.equal(refused.status, 'refused', JSON.stringify(bad)); assert.equal(refused.diagnostics[0].code, 'INPUT_INVALID'); assert.equal(refused.diagnostics[0].path, '/categories');
    assert.deepEqual(refused.originalBytes, software.envelopeBytes);
  }
  assert.deepEqual(UPDATE_CATEGORIES, ['content', 'software', 'client', 'environment']);
});

test('offline: content is unknown for a stated reason, no updates are claimed, dispositions are preserved', async () => {
  noNetwork();
  const s = await scenario();
  const skipped = await record(s.envelopeBytes, setOp(s, s.updated, 'skip'));
  for (const offline of [null, undefined]) {
    const value = await check({ envelopeBytes: skipped.envelopeBytes, inventories: s.inventories, candidateInventories: offline });
    assert.deepEqual(value.categories[0], { category: 'content', selected: true, state: 'unknown', reason: 'sources-unavailable' });
    assert.deepEqual(value.updates, []);
    assert.deepEqual(value.preserved.map(p => [p.record.id, p.state]), [[skipped.record.id, 'unknown']]);
    assert.deepEqual(value.reads, ['envelope', 'supplied-inventories']);
    assert.equal(value.checkedAt, NOW); assert.deepEqual(value.mutations, []);
  }
});

test('a disposition whose subject left the draft is reported orphaned, never dropped', async () => {
  const s = await scenario();
  const skipped = await record(s.envelopeBytes, setOp(s, s.updated, 'skip'));
  const removed = await editDraft({ envelopeBytes: skipped.envelopeBytes, inventories: s.inventories,
    operation: { type: 'remove-root', root: { releaseSha256: s.subject.releaseSha256, itemId: s.noteId, scope: 'project' } } });
  assert.equal(removed.status, 'ok', JSON.stringify(removed.diagnostics));
  const value = await check({ envelopeBytes: removed.value.envelopeBytes, inventories: s.inventories, candidateInventories: [...s.inventories, s.updated] });
  assert.deepEqual(value.updates, []);
  assert.deepEqual(value.preserved.map(p => [p.record.id, p.state]), [[skipped.record.id, 'orphaned']]);
  // And recording against a subject that is not a root is refused with the original bytes.
  const refused = await recordMaintenance({ envelopeBytes: removed.value.envelopeBytes, operation: setOp(s, s.updated, 'skip'), now: NOW });
  assert.equal(refused.status, 'refused'); assert.equal(refused.diagnostics[0].code, 'INPUT_INVALID'); assert.equal(refused.diagnostics[0].path, '/operation/subject');
  assert.deepEqual(refused.originalBytes, removed.value.envelopeBytes);
});

test('a draft edit after recording keeps the dispositions; unknown optional records still round-trip', async () => {
  const s = await scenario();
  const skipped = await record(s.envelopeBytes, setOp(s, s.updated, 'defer', { deferUntil: '2026-11-01', reason: 'Wait for the release notes.' }));
  const optional = { id: 'notes', schema: 'urn:aihq:workbench:journey-record:annotation:1.0.0', required: false, text: 'kept verbatim', nested: { b: 1, a: [true, null] } };
  const doc = JSON.parse(decode(skipped.envelopeBytes));
  doc.records.push(optional);
  const { sha256: _omitted, ...revision } = doc.revision;
  doc.revision.sha256 = await digestBytes(encode(stable({ ...doc, revision })));
  const withOptional = encode(JSON.stringify(doc, null, 2) + '\n');
  const edited = await editDraft({ envelopeBytes: withOptional, inventories: s.inventories,
    operation: { type: 'remove-root', root: { releaseSha256: s.maintained.release.sha256, itemId: 'mattpocock.code-review', scope: 'project' } } });
  assert.equal(edited.status, 'ok', JSON.stringify(edited.diagnostics));
  const records = edited.value.envelope.records;
  assert.deepEqual(records.find(r => r.id === skipped.record.id), skipped.record);
  assert.deepEqual(records.find(r => r.id === 'notes'), optional);
  assert.equal(records.find(r => r.id === 'draft').intent.roots.length, 1);
  assert.equal(edited.value.envelope.revision.sequence, 3);
  // Recording over an envelope that also carries an unknown optional record keeps it too.
  const again = await record(withOptional, setOp(s, s.newer, 'keep-current'));
  assert.deepEqual(again.envelope.records.find(r => r.id === 'notes'), optional);
  assert.equal(again.dispositions.length, 2);
  // An unsupported required record makes the envelope read-only: refused with its original bytes.
  const required = { id: 'workspace', schema: 'urn:aihq:workbench:journey-record:workspace:1.0.0', required: true, declarations: [] };
  const doc2 = JSON.parse(decode(s.envelopeBytes)); doc2.records.push(required);
  const { sha256: _o2, ...revision2 } = doc2.revision;
  doc2.revision.sha256 = await digestBytes(encode(stable({ ...doc2, revision: revision2 })));
  const readOnly = encode(JSON.stringify(doc2, null, 2) + '\n');
  const refused = await recordMaintenance({ envelopeBytes: readOnly, operation: setOp(s, s.updated, 'skip'), now: NOW });
  assert.equal(refused.status, 'refused'); assert.equal(refused.diagnostics[0].code, 'JOURNEY_RECORD_UNSUPPORTED'); assert.deepEqual(refused.originalBytes, readOnly);
  // Checking is a read: it still works on that envelope.
  const checked = await check({ envelopeBytes: readOnly, inventories: s.inventories, candidateInventories: [...s.inventories, s.updated] });
  assert.equal(checked.updates.length, 1);
});

test('malformed disposition records and operations are refused with the path', async () => {
  const s = await scenario();
  const good = await record(s.envelopeBytes, setOp(s, s.updated, 'skip'));
  const resign = async mutate => {
    const doc = JSON.parse(decode(good.envelopeBytes));
    mutate(doc.records.find(r => r.id === good.record.id));
    const { sha256: _omitted, ...revision } = doc.revision;
    doc.revision.sha256 = await digestBytes(encode(stable({ ...doc, revision })));
    return encode(JSON.stringify(doc, null, 2) + '\n');
  };
  const malformed = [
    d => { d.required = true; }, d => { d.extra = 1; }, d => { d.category = 'hardware'; }, d => { d.disposition = 'later'; }, d => { d.scope = 'machine'; },
    d => { d.recordedAt = '2026-10-15'; }, d => { d.recordedAt = '2026-02-30T00:00:00Z'; }, d => { d.reason = ''; }, d => { d.reason = 'x'.repeat(1001); },
    d => { d.deferUntil = '2026-11-01'; }, d => { d.disposition = 'defer'; d.deferUntil = '2026-02-30'; }, d => { d.disposition = 'defer'; d.deferUntil = 'tomorrow'; },
    d => { d.subject.kind = 'root'; }, d => { d.candidate.kind = 'release'; }, d => { d.candidate = { ...d.subject, kind: 'content-revision' }; },
    d => { d.subject.releaseSha256 = 'xyz'; }, d => { delete d.candidate; }, d => { d.id = `disposition-${'0'.repeat(32)}`; }
  ];
  const index = (await readJourneyEnvelope(good.envelopeBytes)).value.records.findIndex(r => r.id === good.record.id);
  for (const [n, mutate] of malformed.entries()) {
    const bytes = await resign(mutate);
    const result = await readJourneyEnvelope(bytes);
    assert.equal(result.status, 'refused', `mutation ${n}`);
    assert.equal(result.diagnostics[0].code, 'INPUT_INVALID', `mutation ${n}`);
    assert.equal(result.diagnostics[0].path, `/records/${index}${n === malformed.length - 1 ? '/id' : ''}`, `mutation ${n}`);
    assert.deepEqual(result.originalBytes, bytes);
    const opened = await openDraft({ bytes, inventories: s.inventories });
    assert.equal(opened.status, 'refused'); assert.deepEqual(opened.originalBytes, bytes);
    const checked = await checkMaintenance({ envelopeBytes: bytes, inventories: s.inventories, candidateInventories: null, now: NOW });
    assert.equal(checked.status, 'refused'); assert.deepEqual(checked.originalBytes, bytes);
  }
  const op = (extra, base = setOp(s, s.updated, 'skip')) => ({ ...base, ...extra });
  const bad = [
    [{ type: 'rewrite' }, '/operation/type'], [{ category: 'hardware' }, '/operation/category'], [{ disposition: 'later' }, '/operation/disposition'],
    [{ scope: 'machine' }, '/operation/scope'], [{ deferUntil: '2026-11-01' }, '/operation/deferUntil'], [{ disposition: 'defer', deferUntil: '2026-13-01' }, '/operation/deferUntil'],
    [{ candidate: { ...s.candidateOf(s.updated), releaseSha256: s.subject.releaseSha256, itemSha256: s.subject.itemSha256 } }, '/operation/candidate'],
    [{ subject: { ...s.subject, itemSha256: '0'.repeat(64) } }, '/operation/subject'], [{ reason: '' }, '/operation/reason'], [{ extra: true }, '/operation']
  ];
  for (const [extra, path] of bad) {
    const refused = await recordMaintenance({ envelopeBytes: good.envelopeBytes, operation: op(extra), now: NOW });
    assert.equal(refused.status, 'refused', JSON.stringify(extra)); assert.equal(refused.diagnostics[0].code, 'INPUT_INVALID', JSON.stringify(extra));
    assert.equal(refused.diagnostics[0].path, path, JSON.stringify(extra)); assert.deepEqual(refused.originalBytes, good.envelopeBytes);
  }
  const unknown = await recordMaintenance({ envelopeBytes: good.envelopeBytes, operation: { type: 'clear', id: `disposition-${'1'.repeat(32)}` }, now: NOW });
  assert.equal(unknown.status, 'refused'); assert.equal(unknown.diagnostics[0].code, 'INPUT_INVALID'); assert.equal(unknown.diagnostics[0].path, '/operation/id');
  for (const now of [undefined, 'today', '2026-10-15', '2026-02-30T00:00:00Z']) {
    const refused = await recordMaintenance({ envelopeBytes: good.envelopeBytes, operation: setOp(s, s.updated, 'skip'), now });
    assert.equal(refused.status, 'refused'); assert.equal(refused.diagnostics[0].path, '/now');
    const checked = await checkMaintenance({ envelopeBytes: good.envelopeBytes, inventories: s.inventories, candidateInventories: null, now });
    assert.equal(checked.status, 'refused'); assert.equal(checked.diagnostics[0].path, '/now');
  }
  const notBytes = await recordMaintenance({ envelopeBytes: 'text', operation: { type: 'clear', id: 'x' }, now: NOW });
  assert.equal(notBytes.status, 'refused'); assert.equal(notBytes.diagnostics[0].code, 'INPUT_INVALID');
  // A policy (not an envelope) has no draft record to attach a disposition to.
  const policy = await checkMaintenance({ envelopeBytes: s.policyBytes, inventories: s.inventories, candidateInventories: null, now: NOW });
  assert.equal(policy.status, 'refused');
});

test('writeJourneyEnvelope validates disposition records and the registry names both kinds', async () => {
  const s = await scenario();
  const good = await record(s.envelopeBytes, setOp(s, s.updated, 'skip'));
  const read = (await readJourneyEnvelope(s.envelopeBytes)).value, draft = read.records[0];
  assert.deepEqual(Object.keys(JOURNEY_RECORD_KINDS).sort(), ['urn:aihq:workbench:journey-record:improvement-dismissal:1.0.0', 'urn:aihq:workbench:journey-record:improvement-suggestion:1.0.0',
    'urn:aihq:workbench:journey-record:improvement-trial:1.0.0', 'urn:aihq:workbench:journey-record:local-binding:1.0.0', 'urn:aihq:workbench:journey-record:maintenance-check:1.0.0', 'urn:aihq:workbench:journey-record:maintenance-disposition:1.0.0', 'urn:aihq:workbench:journey-record:organization-draft:1.0.0',
    'urn:aihq:workbench:journey-record:reviewed-batch:1.0.0', 'urn:aihq:workbench:journey-record:unresolved-draft:1.0.0', 'urn:aihq:workbench:journey-record:workspace-declaration:1.0.0']);
  assert.equal(MAINTENANCE_DISPOSITION_SCHEMA, 'urn:aihq:workbench:journey-record:maintenance-disposition:1.0.0');
  assert.equal(JOURNEY_RECORD_KINDS[MAINTENANCE_DISPOSITION_SCHEMA].required, false);
  const accepted = await writeJourneyEnvelope({ savedIntentBytes: read.savedIntentBytes, records: [draft, good.record] });
  assert.equal(accepted.status, 'ok', JSON.stringify(accepted.diagnostics));
  for (const bad of [{ ...good.record, required: true }, { ...good.record, disposition: 'maybe' }, { ...good.record, id: `disposition-${'2'.repeat(32)}` }, { ...good.record, extra: 1 }]) {
    const refused = await writeJourneyEnvelope({ savedIntentBytes: read.savedIntentBytes, records: [draft, bad] });
    assert.equal(refused.status, 'refused'); assert.equal(refused.diagnostics[0].code, 'INPUT_INVALID'); assert.match(refused.diagnostics[0].path, /^\/records\/1/);
  }
});

test('Check now is a bounded read: input bytes unchanged, no mutations, no network, and the module is pure', async () => {
  noNetwork();
  const s = await scenario();
  const withRecord = await record(s.envelopeBytes, setOp(s, s.updated, 'skip'));
  const snapshot = withRecord.envelopeBytes.slice(), inventories = [...s.inventories], candidates = [...s.inventories, s.updated];
  const result = await checkMaintenance({ envelopeBytes: withRecord.envelopeBytes, inventories, candidateInventories: candidates, now: NOW });
  assert.equal(result.status, 'ok');
  assert.deepEqual(withRecord.envelopeBytes, snapshot);
  assert.equal(result.value.envelopeBytes, undefined);
  assert.deepEqual(result.value.mutations, []);
  assert.deepEqual(inventories, [...s.inventories]); assert.equal(candidates.length, 3);
  const source = await readFile(new URL('./maintenance.mjs', import.meta.url), 'utf8');
  for (const forbidden of [/\bwindow\b/, /\bdocument\b/, /\bfetch\b/, /node:/, /\bprocess\b/, /\bBuffer\b/, /\bsetTimeout\b/, /\bsetInterval\b/, /Date\.now/, /new Date\(\)/, /\bXMLHttpRequest\b/, /\blocalStorage\b/]) assert.doesNotMatch(source, forbidden);
  // A malformed inventory is an input problem, reported without reading further.
  const broken = await checkMaintenance({ envelopeBytes: withRecord.envelopeBytes, inventories, candidateInventories: [{ release: {} }], now: NOW });
  assert.equal(broken.status, 'refused'); assert.equal(broken.diagnostics[0].path, '/candidateInventories'); assert.deepEqual(broken.originalBytes, withRecord.envelopeBytes);
});

test('host route: maintenance-check and maintenance-record through the mixed service, with a configured source', async () => {
  const s = await scenario();
  const [maintained] = s.inventories;
  let offline = false;
  const calls = [];
  const service = await createMixedService({ release: maintained.release, materials: maintained.materials, materialSource: maintained.materialSource },
    { maintenanceSource: async (...args) => { calls.push(args); return offline ? null : [s.updated]; } });
  const bytes = [...s.envelopeBytes];
  // The service's own notes inventory is the same exact release as the scenario's, so the saved draft matches.
  assert.equal(service.inventories.some(e => e.release.sha256 === s.notes.release.sha256), true);
  const checked = await service.run('maintenance-check', { envelopeBytes: bytes });
  assert.equal(checked.status, 'ok', JSON.stringify(checked.diagnostics));
  assert.deepEqual(calls, [[]]);
  assert.equal(checked.value.updates.length, 1); assert.equal(checked.value.updates[0].candidate.releaseSha256, s.updated.release.sha256);
  assert.equal(checked.value.updates[0].attention, 'new');
  assert.match(checked.value.checkedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/);
  assert.deepEqual(checked.value.mutations, []);
  assert.deepEqual(bytes, [...s.envelopeBytes]);
  // The bytes come back as a plain byte array over JSON transport.
  const recorded = await service.run('maintenance-record', { envelopeBytes: bytes, operation: setOp(s, s.updated, 'skip') });
  assert.equal(recorded.status, 'ok', JSON.stringify(recorded.diagnostics));
  assert.equal(recorded.value.record.disposition, 'skip'); assert.equal(recorded.value.envelope.revision.sequence, 2);
  assert.match(recorded.value.record.recordedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/);
  const roundTrip = JSON.parse(JSON.stringify(recorded, (_key, value) => value instanceof Uint8Array ? [...value] : value));
  const after = await service.run('maintenance-check', { envelopeBytes: roundTrip.value.envelopeBytes });
  assert.equal(after.value.updates[0].promoted, false); assert.equal(after.value.updates[0].disposition.disposition, 'skip');
  // A source that cannot be reached is offline: unknown, never "no updates".
  offline = true;
  const down = await service.run('maintenance-check', { envelopeBytes: roundTrip.value.envelopeBytes, categories: ['content'] });
  assert.equal(down.status, 'ok');
  assert.deepEqual(down.value.updates, []);
  assert.deepEqual(down.value.categories[0], { category: 'content', selected: true, state: 'unknown', reason: 'sources-unavailable' });
  assert.equal(down.value.preserved[0].state, 'unknown');
  // Invalid host input is a refusal, not a crash.
  const refused = await service.run('maintenance-check', { envelopeBytes: 'nope' });
  assert.equal(refused.status, 'refused');
  const badCategory = await service.run('maintenance-check', { envelopeBytes: bytes, categories: ['hardware'] });
  assert.equal(badCategory.status, 'refused'); assert.equal(badCategory.diagnostics[0].path, '/categories');
  // Without a configured source nothing is checked: content is unknown for its own reason, never an all-clear.
  const plain = await createMixedService({ release: maintained.release, materials: maintained.materials, materialSource: maintained.materialSource });
  const unconfigured = await plain.run('maintenance-check', { envelopeBytes: bytes });
  assert.equal(unconfigured.status, 'ok'); assert.deepEqual(unconfigured.value.updates, []);
  assert.deepEqual(unconfigured.value.categories[0], { category: 'content', selected: true, state: 'unknown', reason: 'no-configured-source' });
  assert.deepEqual(unconfigured.value.reads, ['envelope', 'supplied-inventories']);
  // A source that throws is configured but unreachable.
  const throwing = await createMixedService({ release: maintained.release, materials: maintained.materials, materialSource: maintained.materialSource },
    { maintenanceSource: async () => { throw new Error('unreachable'); } });
  const failed = await throwing.run('maintenance-check', { envelopeBytes: bytes });
  assert.equal(failed.value.categories[0].reason, 'sources-unavailable');
});

test('a host-declared release order: newer and unknown candidates are offered with their relation, an older one is not offered', async () => {
  const s = await scenario(), sha = entry => entry.release.sha256;
  const run = positions => check({ envelopeBytes: s.envelopeBytes, inventories: s.inventories, candidateInventories: [s.updated, s.newer], releaseOrder: declareReleaseOrder(positions) });
  const orders = value => Object.fromEntries(value.updates.map(u => [u.candidate.releaseSha256, u.order]));
  const basis = 'host-declared';
  // Without an order nothing is ranked and nothing is hidden.
  const plain = await check({ envelopeBytes: s.envelopeBytes, inventories: s.inventories, candidateInventories: [s.updated, s.newer] });
  assert.equal(plain.updates.length, 2); assert.equal(plain.updates.every(u => !('order' in u)), true);
  assert.deepEqual(orders(await run([[sha(s.notes)], [sha(s.updated)], [sha(s.newer)]])), { [sha(s.updated)]: { relation: 'newer', basis }, [sha(s.newer)]: { relation: 'newer', basis } });
  // Listed before the selected revision, a candidate is not an update under this order; the later one still is.
  const older = await run([[sha(s.updated)], [sha(s.notes)], [sha(s.newer)]]);
  assert.deepEqual(orders(older), { [sha(s.newer)]: { relation: 'newer', basis } });
  assert.deepEqual((await run([[sha(s.newer)], [sha(s.updated)], [sha(s.notes)]])).updates, []);
  // The selected revision is not in the source: offered, but its order is unknown.
  assert.deepEqual(orders(await run([[sha(s.updated)], [sha(s.newer)]])), { [sha(s.updated)]: { relation: 'unknown', basis, reason: 'not-in-source' }, [sha(s.newer)]: { relation: 'unknown', basis, reason: 'not-in-source' } });
  // A revision listed on both sides of the selected one is never called older or newer.
  assert.deepEqual(orders(await run([[sha(s.notes)], [sha(s.updated)], [sha(s.notes)]])), { [sha(s.updated)]: { relation: 'unknown', basis, reason: 'ambiguous' }, [sha(s.newer)]: { relation: 'unknown', basis, reason: 'not-in-source' } });
  // An earlier choice about a candidate the order no longer offers is kept, as one not offered in this check.
  const skipped = await record(s.envelopeBytes, setOp(s, s.updated, 'skip'));
  const kept = await check({ envelopeBytes: skipped.envelopeBytes, inventories: s.inventories, candidateInventories: [s.updated], releaseOrder: declareReleaseOrder([[sha(s.updated)], [sha(s.notes)]]) });
  assert.deepEqual(kept.updates, []); assert.deepEqual(kept.preserved.map(p => [p.record.disposition, p.state]), [['skip', 'not-offered']]);
});

test('a release order that is not the closed host-declared shape is refused', async () => {
  const s = await scenario();
  const base = { envelopeBytes: s.envelopeBytes, inventories: s.inventories, candidateInventories: [s.updated], now: NOW };
  for (const [releaseOrder, path] of [['newest-first', '/releaseOrder'], [{ basis: 'producer', ranks: {} }, '/releaseOrder/basis'], [{ basis: 'host-declared' }, '/releaseOrder/ranks'],
    [{ basis: 'host-declared', ranks: { nope: [1, 1] } }, '/releaseOrder/ranks'], [{ basis: 'host-declared', ranks: {}, extra: 1 }, '/releaseOrder']]) {
    const refused = await checkMaintenance({ ...base, releaseOrder });
    assert.equal(refused.status, 'refused', JSON.stringify(releaseOrder)); assert.equal(refused.diagnostics[0].path, path); assert.deepEqual(refused.originalBytes, s.envelopeBytes);
  }
  assert.equal((await checkMaintenance({ ...base, releaseOrder: null })).status, 'ok');
});

test('host route: an update source object brings its description and the order of each update; a fixture list stays labelled as one', async () => {
  const s = await scenario();
  const [maintained] = s.inventories, base = { release: maintained.release, materials: maintained.materials, materialSource: maintained.materialSource };
  const sha = entry => entry.release.sha256;
  const sources = [{ position: 1, state: 'read', package: { name: 'notes', version: '1.0.0' }, releaseSha256: sha(s.notes), readAt: NOW }, { position: 2, state: 'offline', reason: 'unreadable' }];
  let read = { kind: 'catalog-roots', inventories: [s.updated], releaseOrder: declareReleaseOrder([[sha(s.notes)], [sha(s.updated)]]), sources };
  const service = await createMixedService(base, { maintenanceSource: async () => read });
  const bytes = [...s.envelopeBytes];
  const checked = await service.run('maintenance-check', { envelopeBytes: bytes });
  assert.equal(checked.status, 'ok', JSON.stringify(checked.diagnostics));
  assert.deepEqual(checked.value.updateSource, { kind: 'catalog-roots', order: 'host-declared', orderText: RELEASE_ORDER_TEXT, sources });
  assert.deepEqual(checked.value.updates.map(u => [u.candidate.releaseSha256, u.order]), [[sha(s.updated), { relation: 'newer', basis: 'host-declared' }]]);
  // A candidate listed before the selected revision is not an update under the host's order.
  read = { ...read, releaseOrder: declareReleaseOrder([[sha(s.updated)], [sha(s.notes)]]) };
  assert.deepEqual((await service.run('maintenance-check', { envelopeBytes: bytes })).value.updates, []);
  // Every root unreadable is offline, not "no updates"; the sources are still reported.
  read = { kind: 'catalog-roots', inventories: null, releaseOrder: declareReleaseOrder([[], []]), sources: [{ position: 1, state: 'offline', reason: 'invalid', lastReadAt: NOW }] };
  const down = await service.run('maintenance-check', { envelopeBytes: bytes });
  assert.deepEqual(down.value.categories[0], { category: 'content', selected: true, state: 'unknown', reason: 'sources-unavailable' });
  assert.deepEqual(down.value.updateSource.sources, read.sources); assert.deepEqual(down.value.updates, []);
  // A fixture list is its own kind: no order and no sources, so nothing is ranked.
  const fixture = await createMixedService(base, { maintenanceSource: async () => [s.updated] });
  const listed = await fixture.run('maintenance-check', { envelopeBytes: bytes });
  assert.deepEqual(listed.value.updateSource, { kind: 'test-fixture', sources: [] }); assert.equal('order' in listed.value.updates[0], false);
  // No source, an unreachable one, or content not selected: no source description at all.
  const plain = await createMixedService(base);
  assert.equal('updateSource' in (await plain.run('maintenance-check', { envelopeBytes: bytes })).value, false);
  assert.equal('updateSource' in (await service.run('maintenance-check', { envelopeBytes: bytes, categories: ['software'] })).value, false);
  const failing = await createMixedService(base, { maintenanceSource: async () => { throw new Error('unreachable'); } });
  assert.equal('updateSource' in (await failing.run('maintenance-check', { envelopeBytes: bytes })).value, false);
});

test('shipped disposition schema agrees structurally with the runtime record', async t => {
  let schema, journey, checkSchema;
  for (const base of ['../../schemas/', '../schemas/']) {
    try {
      schema = JSON.parse(await readFile(new URL(`${base}journey-record-maintenance-disposition-1.0.0.json`, import.meta.url), 'utf8'));
      journey = JSON.parse(await readFile(new URL(`${base}journey-envelope-1.0.0.json`, import.meta.url), 'utf8'));
      checkSchema = JSON.parse(await readFile(new URL(`${base}journey-record-maintenance-check-1.0.0.json`, import.meta.url), 'utf8'));
      break;
    } catch { /* try next layout */ }
  }
  if (!schema) return t.skip('schema file is not present in this consumer layout; tools/write-authoring-schemas.mjs --check verifies it');
  const s = await scenario();
  const { record: written } = await record(s.envelopeBytes, setOp(s, s.updated, 'defer', { deferUntil: '2026-11-01', reason: 'Wait.' }));
  assert.equal(schema.$id, MAINTENANCE_DISPOSITION_SCHEMA);
  assert.equal(schema.properties.schema.const, MAINTENANCE_DISPOSITION_SCHEMA);
  assert.equal(schema.properties.required.const, false);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.properties).sort(), Object.keys(written).sort());
  assert.deepEqual([...schema.required].sort(), Object.keys(written).filter(k => !['reason', 'deferUntil'].includes(k)).sort());
  assert.deepEqual(schema.properties.category.enum, UPDATE_CATEGORIES);
  assert.deepEqual(schema.properties.disposition.enum, ['keep-current', 'skip', 'defer']);
  for (const key of ['subject', 'candidate']) assert.deepEqual([...schema.properties[key].required].sort(), Object.keys(written[key]).sort());
  assert.match(written.id, new RegExp(schema.properties.id.pattern));
  assert.match(written.recordedAt, new RegExp(schema.properties.recordedAt.pattern));
  assert.match(written.deferUntil, new RegExp(schema.properties.deferUntil.pattern));
  // The envelope schema validates the record by reference and leaves the draft and open rules unchanged.
  const items = journey.properties.records.items;
  assert.deepEqual(items.allOf.map(rule => [rule.if.properties.schema.const, rule.then.$ref]),
    [[MAINTENANCE_DISPOSITION_SCHEMA, MAINTENANCE_DISPOSITION_SCHEMA], [MAINTENANCE_CHECK_SCHEMA, MAINTENANCE_CHECK_SCHEMA],
      ['urn:aihq:workbench:journey-record:organization-draft:1.0.0', 'urn:aihq:workbench:journey-record:organization-draft:1.0.0'],
      ['urn:aihq:workbench:journey-record:improvement-suggestion:1.0.0', 'urn:aihq:workbench:journey-record:improvement-suggestion:1.0.0'],
      ['urn:aihq:workbench:journey-record:improvement-dismissal:1.0.0', 'urn:aihq:workbench:journey-record:improvement-dismissal:1.0.0'],
      ['urn:aihq:workbench:journey-record:workspace-declaration:1.0.0', 'urn:aihq:workbench:journey-record:workspace-declaration:1.0.0'],
      ['urn:aihq:workbench:journey-record:local-binding:1.0.0', 'urn:aihq:workbench:journey-record:local-binding:1.0.0'],
      ['urn:aihq:workbench:journey-record:reviewed-batch:1.0.0', 'urn:aihq:workbench:journey-record:reviewed-batch:1.0.0'],
      ['urn:aihq:workbench:journey-record:improvement-trial:1.0.0', 'urn:aihq:workbench:journey-record:improvement-trial:1.0.0']]);
  // The check note: closed, fixed id, optional, categories drawn from the same registry.
  const note = (await record(s.envelopeBytes, { type: 'note-check', checkedAt: '2026-10-14T09:30:00Z',
    categories: [{ category: 'content', state: 'checked' }, { category: 'software', state: 'unknown', reason: 'no-supported-reader' }] })).envelope.records.find(r => r.id === 'maintenance-check');
  assert.equal(checkSchema.$id, MAINTENANCE_CHECK_SCHEMA); assert.equal(checkSchema.properties.schema.const, MAINTENANCE_CHECK_SCHEMA);
  assert.equal(checkSchema.properties.id.const, 'maintenance-check'); assert.equal(checkSchema.properties.required.const, false);
  assert.equal(checkSchema.additionalProperties, false);
  assert.deepEqual([...checkSchema.required].sort(), Object.keys(note).sort()); assert.deepEqual(Object.keys(checkSchema.properties).sort(), Object.keys(note).sort());
  assert.match(note.checkedAt, new RegExp(checkSchema.properties.checkedAt.pattern));
  assert.deepEqual(checkSchema.properties.categories.items.properties.category.enum, UPDATE_CATEGORIES);
  assert.deepEqual(checkSchema.properties.categories.items.properties.state.enum, ['checked', 'unknown', 'not-selected']);
  assert.match(note.categories[1].reason, new RegExp(checkSchema.properties.categories.items.properties.reason.pattern));
  assert.equal(items.else.additionalProperties, true);
});

test('the source is read only when content is selected, and no configured source is unknown, not checked', async () => {
  const s = await scenario(), [maintained] = s.inventories;
  let reads = 0;
  const base = { release: maintained.release, materials: maintained.materials, materialSource: maintained.materialSource };
  const service = await createMixedService(base, { maintenanceSource: async () => { reads++; return [s.updated]; } });
  for (const categories of [['software'], ['client', 'environment']]) {
    const value = (await service.run('maintenance-check', { envelopeBytes: [...s.envelopeBytes], categories })).value;
    assert.deepEqual(value.categories.find(c => c.category === 'content'), { category: 'content', selected: false, state: 'not-selected' });
    assert.equal(value.reads.includes('candidate-inventories'), false);
  }
  assert.equal(reads, 0, 'the content source is not read when Content is not selected');
  const withContent = await service.run('maintenance-check', { envelopeBytes: [...s.envelopeBytes], categories: ['content', 'software'] });
  assert.equal(reads, 1); assert.equal(withContent.value.reads.includes('candidate-inventories'), true);
  assert.equal((await service.run('maintenance-check', { envelopeBytes: [...s.envelopeBytes] })).status, 'ok'); assert.equal(reads, 2);
  // Headless: the unconfigured and unreachable cases are told apart, and neither lists candidate inventories as read.
  const unconfigured = await check({ envelopeBytes: s.envelopeBytes, inventories: s.inventories, candidateInventories: null, candidateSource: 'unconfigured' });
  assert.deepEqual(unconfigured.categories[0], { category: 'content', selected: true, state: 'unknown', reason: 'no-configured-source' });
  assert.deepEqual(unconfigured.reads, ['envelope', 'supplied-inventories']);
  const unreachable = await check({ envelopeBytes: s.envelopeBytes, inventories: s.inventories, candidateInventories: null, candidateSource: 'configured' });
  assert.equal(unreachable.categories[0].reason, 'sources-unavailable');
  const refused = await checkMaintenance({ envelopeBytes: s.envelopeBytes, inventories: s.inventories, candidateInventories: null, candidateSource: 'elsewhere', now: NOW });
  assert.equal(refused.status, 'refused'); assert.equal(refused.diagnostics[0].path, '/candidateSource');
});

test('host route: a saved policy gets the update check and recording becomes a saved draft', async () => {
  const s = await scenario(), [maintained] = s.inventories;
  const service = await createMixedService({ release: maintained.release, materials: maintained.materials, materialSource: maintained.materialSource },
    { maintenanceSource: async () => [s.updated] });
  const policy = [...s.policyBytes], before = policy.slice();
  const checked = await service.run('maintenance-check', { bytes: policy, categories: ['content'] });
  assert.equal(checked.status, 'ok', JSON.stringify(checked.diagnostics));
  assert.deepEqual(checked.value.updates.map(u => [u.subject.itemId, u.attention, u.promoted]), [[s.noteId, 'new', true]]);
  assert.deepEqual(checked.value.mutations, []); assert.deepEqual(policy, before);
  assert.equal('lastCheck' in checked.value, false);
  const refused = await service.run('maintenance-check', { categories: ['content'] });
  assert.equal(refused.status, 'refused');
  const recorded = await service.run('maintenance-record', { bytes: policy, operation: setOp(s, s.updated, 'skip') });
  assert.equal(recorded.status, 'ok', JSON.stringify(recorded.diagnostics));
  assert.equal(recorded.value.envelope.revision.sequence, 2); assert.equal(recorded.value.record.disposition, 'skip');
  // The returned draft is exactly what opening the new envelope presents, so the client adopts it as an opened draft.
  const opened = await openDraft({ bytes: recorded.value.envelopeBytes, inventories: service.inventories });
  assert.equal(opened.status, 'ok', JSON.stringify(opened.diagnostics));
  assert.deepEqual(recorded.value.draft, opened.value);
  assert.deepEqual(recorded.value.draft.savedIntentBytes, s.policyBytes);
  assert.equal(recorded.value.draft.projection.records.filter(r => r.schema === MAINTENANCE_DISPOSITION_SCHEMA).length, 1);
  // Envelope input keeps its own path and also returns the draft.
  const again = await service.run('maintenance-record', { envelopeBytes: [...recorded.value.envelopeBytes], operation: { type: 'clear', id: recorded.value.record.id } });
  assert.equal(again.status, 'ok'); assert.equal(again.value.draft.projection.revision.sequence, 3);
});

test('a note-check record keeps the last successful check inside the envelope and only recordMaintenance writes it', async () => {
  noNetwork();
  const s = await scenario(), candidates = [...s.inventories, s.updated];
  const categories = [{ category: 'content', state: 'checked' }, { category: 'software', state: 'unknown', reason: 'no-supported-reader' },
    { category: 'client', state: 'not-selected' }, { category: 'environment', state: 'not-selected' }];
  const checkedAt = '2026-10-14T09:30:00Z';
  // A check alone never writes a note; with none recorded there is no lastCheck.
  const none = await check({ envelopeBytes: s.envelopeBytes, inventories: s.inventories, candidateInventories: candidates });
  assert.equal('lastCheck' in none, false);
  const noted = await record(s.envelopeBytes, { type: 'note-check', checkedAt, categories });
  assert.equal(noted.envelope.revision.sequence, 2);
  const note = noted.envelope.records.find(r => r.schema === MAINTENANCE_CHECK_SCHEMA);
  assert.deepEqual(note, { id: 'maintenance-check', schema: MAINTENANCE_CHECK_SCHEMA, required: false, checkedAt, categories });
  assert.equal(noted.envelope.records.find(r => r.id === 'draft').required, true);
  assert.deepEqual(noted.envelope.savedIntent, s.open.envelope.savedIntent);
  assert.deepEqual(noted.dispositions, []);
  assert.deepEqual(noted.projection.records.map(r => [r.id, r.required, r.supported]), [['draft', true, true], ['maintenance-check', false, true]]);
  // Reopening and an offline check both report the recorded time and per-category states.
  const reopened = await openDraft({ bytes: noted.envelopeBytes, inventories: s.inventories });
  assert.equal(reopened.status, 'ok', JSON.stringify(reopened.diagnostics)); assert.deepEqual(reopened.value.envelopeBytes, noted.envelopeBytes);
  const offline = await check({ envelopeBytes: noted.envelopeBytes, inventories: s.inventories, candidateInventories: null });
  assert.deepEqual(offline.lastCheck, { checkedAt, categories });
  assert.equal(offline.checkedAt, NOW); assert.deepEqual(offline.categories[0], { category: 'content', selected: true, state: 'unknown', reason: 'sources-unavailable' });
  assert.deepEqual(noted.envelopeBytes, (await record(s.envelopeBytes, { type: 'note-check', checkedAt, categories })).envelopeBytes);
  // A later note replaces it (one record, fixed id); dispositions and the draft survive both ways.
  const skipped = await record(noted.envelopeBytes, setOp(s, s.updated, 'skip'));
  assert.deepEqual(skipped.envelope.records.find(r => r.id === 'maintenance-check'), note);
  const later = await record(skipped.envelopeBytes, { type: 'note-check', checkedAt: '2026-10-15T08:00:00Z', categories: categories.slice(0, 1) });
  assert.equal(later.envelope.records.filter(r => r.schema === MAINTENANCE_CHECK_SCHEMA).length, 1);
  assert.equal(later.envelope.records.find(r => r.id === 'maintenance-check').checkedAt, '2026-10-15T08:00:00Z');
  assert.deepEqual(later.dispositions.map(d => d.id), [skipped.record.id]);
  const cleared = await record(later.envelopeBytes, { type: 'clear', id: skipped.record.id });
  assert.equal(cleared.envelope.records.some(r => r.schema === MAINTENANCE_CHECK_SCHEMA), true);
  // A draft edit passes the note through.
  const edited = await editDraft({ envelopeBytes: later.envelopeBytes, inventories: s.inventories,
    operation: { type: 'remove-root', root: { releaseSha256: s.maintained.release.sha256, itemId: 'mattpocock.code-review', scope: 'project' } } });
  assert.equal(edited.status, 'ok', JSON.stringify(edited.diagnostics));
  assert.deepEqual(edited.value.envelope.records.find(r => r.id === 'maintenance-check'), later.envelope.records.find(r => r.id === 'maintenance-check'));
  // The mixed service reports it too.
  const [maintained] = s.inventories;
  const service = await createMixedService({ release: maintained.release, materials: maintained.materials, materialSource: maintained.materialSource });
  const viaHost = await service.run('maintenance-check', { envelopeBytes: [...noted.envelopeBytes] });
  assert.deepEqual(viaHost.value.lastCheck, { checkedAt, categories });
});

test('malformed note-check records and operations are refused with the path', async () => {
  const s = await scenario();
  const categories = [{ category: 'content', state: 'checked' }];
  const good = await record(s.envelopeBytes, { type: 'note-check', checkedAt: '2026-10-14T09:30:00Z', categories });
  const resign = async mutate => {
    const doc = JSON.parse(decode(good.envelopeBytes));
    mutate(doc.records.find(r => r.id === 'maintenance-check'));
    const { sha256: _omitted, ...revision } = doc.revision;
    doc.revision.sha256 = await digestBytes(encode(stable({ ...doc, revision })));
    return encode(JSON.stringify(doc, null, 2) + '\n');
  };
  const index = (await readJourneyEnvelope(good.envelopeBytes)).value.records.findIndex(r => r.id === 'maintenance-check');
  const malformed = [r => { r.required = true; }, r => { r.extra = 1; }, r => { r.checkedAt = '2026-10-14'; }, r => { r.checkedAt = '2026-02-30T00:00:00Z'; },
    r => { r.categories = []; }, r => { r.categories = [{ category: 'hardware', state: 'checked' }]; }, r => { r.categories = [{ category: 'content', state: 'fine' }]; },
    r => { r.categories = [{ category: 'content', state: 'checked' }, { category: 'content', state: 'unknown' }]; },
    r => { r.categories = [{ category: 'content', state: 'checked', extra: 1 }]; }, r => { delete r.checkedAt; }];
  for (const [n, mutate] of malformed.entries()) {
    const bytes = await resign(mutate);
    const result = await readJourneyEnvelope(bytes);
    assert.equal(result.status, 'refused', `mutation ${n}`); assert.equal(result.diagnostics[0].code, 'INPUT_INVALID', `mutation ${n}`);
    assert.equal(result.diagnostics[0].path, `/records/${index}`, `mutation ${n}`); assert.deepEqual(result.originalBytes, bytes);
  }
  const at = '2026-10-14T09:30:00Z';
  const bad = [{ type: 'note-check', checkedAt: 'now', categories }, { type: 'note-check', checkedAt: at }, { type: 'note-check', checkedAt: at, categories: [] },
    { type: 'note-check', checkedAt: at, categories: [{ category: 'x', state: 'checked' }] }, { type: 'note-check', checkedAt: at, categories, extra: 1 }];
  for (const operation of bad) {
    const refused = await recordMaintenance({ envelopeBytes: s.envelopeBytes, operation, now: NOW });
    assert.equal(refused.status, 'refused', JSON.stringify(operation)); assert.equal(refused.diagnostics[0].code, 'INPUT_INVALID');
    assert.match(refused.diagnostics[0].path, /^\/operation/); assert.deepEqual(refused.originalBytes, s.envelopeBytes);
  }
});

test('a check time later than the record time is refused, an equal or earlier one is recorded', async () => {
  const s = await scenario(), categories = [{ category: 'content', state: 'checked' }];
  for (const checkedAt of ['2026-10-15T12:00:01Z', '2026-10-15T12:00:00.5Z', '2099-01-01T00:00:00Z']) {
    const refused = await recordMaintenance({ envelopeBytes: s.envelopeBytes, operation: { type: 'note-check', checkedAt, categories }, now: NOW });
    assert.equal(refused.status, 'refused', checkedAt); assert.equal(refused.diagnostics[0].code, 'INPUT_INVALID');
    assert.equal(refused.diagnostics[0].path, '/operation/checkedAt'); assert.deepEqual(refused.originalBytes, s.envelopeBytes);
  }
  for (const checkedAt of [NOW, '2026-10-15T11:59:59.9Z']) assert.equal((await record(s.envelopeBytes, { type: 'note-check', checkedAt, categories })).envelope.records.find(r => r.id === 'maintenance-check').checkedAt, checkedAt);
});

test('validator internals are not part of the public journey entry', () => {
  for (const name of ['isUtcTimestamp', 'dispositionProblem', 'dispositionId', 'DISPOSITION_CATEGORIES', 'DISPOSITION_SUBJECT_KINDS', 'DISPOSITION_CANDIDATE_KINDS', 'DISPOSITIONS'])
    assert.equal(name in journey, false, name);
});
