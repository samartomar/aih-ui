import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readAuthoring, editAuthoring, composeAuthoring, freshAuthoring, stable, openDraft, editDraft, compileDraft } from './headless.mjs';
import { readJourneyEnvelope, writeJourneyEnvelope, projectJourneyEnvelope, isJourneyEnvelope, JOURNEY_SCHEMA, JOURNEY_SCHEMA_PREFIX, JOURNEY_ACCEPTED_SCHEMAS, JOURNEY_RECORD_SCHEMAS, DRAFT_RECORD_SCHEMA, SAVED_INTENT_TYPE } from './journey.mjs';
import { mixedInventories } from './authoring-v3.test.mjs';
import { intakeDeclaration, digestBytes } from './intake.mjs';
import { noteFixture } from './note-fixture.mjs';
import { fixtureRelease, fixtureItem, crossRef, rootFor } from './intent-fixtures.mjs';
const encode = value => new TextEncoder().encode(value), decode = bytes => new TextDecoder().decode(bytes);
const rootOf = (entry, itemId, extra = {}) => {
  const item = entry.release.items.find(i => i.id === itemId);
  return { releaseSha256: entry.release.sha256, itemId, itemSha256: item.itemSha256, scope: 'project', configuration: {}, originIds: ['direct'], ...extra };
};
const ref = root => ({ releaseSha256: root.releaseSha256, itemId: root.itemId, scope: root.scope });
// Notes (supplied declaration) and a code-review root; notes depend on maintained content.
async function savedMixed({ crlf = false } = {}) {
  const inventories = await mixedInventories(), [maintained, notes] = inventories;
  const intent = freshAuthoring();
  intent.roots.push(rootOf(notes, notes.release.items[0].id), rootOf(maintained, 'mattpocock.code-review'));
  const saved = await composeAuthoring({ intent, inventories });
  assert.equal(saved.status, 'ok', JSON.stringify(saved.diagnostics));
  const policyBytes = crlf ? encode(JSON.stringify(JSON.parse(decode(saved.value.policyBytes)), null, 2).replaceAll('\n', '\r\n') + '\r\n') : saved.value.policyBytes;
  return { inventories, maintained, notes, saved, policyBytes };
}
async function updatedNotes() {
  const snapshot = await noteFixture('updated');
  const input = { id: 'notes-next', kind: 'local', locator: { input: 'notes-next' }, resolvedIdentity: { sha256: await digestBytes(snapshot.declarationBytes) } };
  const result = await intakeDeclaration({ input, ...snapshot, materialSource: { kind: 'local', input: 'notes-next' } });
  assert.equal(result.status, 'ok', JSON.stringify(result.diagnostics));
  return result.value;
}
// Unknown records are only ever read or preserved, so build them by hand and re-digest.
async function withRecords(envelopeBytes, extra) {
  const doc = JSON.parse(decode(envelopeBytes));
  doc.records.push(...extra);
  const { sha256: _omitted, ...revision } = doc.revision;
  doc.revision.sha256 = await digestBytes(encode(stable({ ...doc, revision })));
  return encode(JSON.stringify(doc, null, 2) + '\n');
}
const opened = async (options) => {
  const result = await openDraft(options);
  assert.equal(result.status, 'ok', JSON.stringify(result.diagnostics));
  return result.value;
};
const edited = async (options) => {
  const result = await editDraft(options);
  assert.equal(result.status, 'ok', JSON.stringify(result.diagnostics));
  return result.value;
};

test('unavailable source reopens as an unresolved draft with every choice kept and nothing substituted', async () => {
  const { maintained, notes, saved, policyBytes } = await savedMixed();
  const read = await readAuthoring({ policyBytes, inventories: [maintained] });
  assert.equal(read.status, 'ok');
  assert.equal(read.value.editing, 'unresolved', JSON.stringify(read.value.diagnostics));
  assert.deepEqual(read.value.intent, saved.value.intent);
  assert.deepEqual(read.value.originalBytes, policyBytes);
  assert.equal(read.value.diagnostics[0].code, 'SOURCE_REVISION_UNAVAILABLE');
  const noteRoot = read.value.roots.find(r => r.itemId === notes.release.items[0].id), reviewRoot = read.value.roots.find(r => r.itemId === 'mattpocock.code-review');
  assert.equal(noteRoot.status, 'unresolved'); assert.equal(reviewRoot.status, 'resolved');
  assert.deepEqual(read.value.unresolved.map(u => [u.kind, u.reason, u.ref.releaseSha256]), [['root', 'source-unavailable', notes.release.sha256], ['input', 'source-unavailable', notes.release.sha256]]);
  // A changed revision of the same declaration is a different exact source and is never used.
  const next = await updatedNotes();
  const changed = await opened({ bytes: policyBytes, inventories: [maintained, next] });
  assert.equal(changed.editing, 'unresolved');
  assert.deepEqual(changed.unresolved.map(u => [u.kind, u.reason]), [['root', 'revision-unavailable'], ['input', 'revision-unavailable']]);
  assert.deepEqual(changed.intent, saved.value.intent);
  assert.equal(changed.intent.roots.some(r => r.releaseSha256 === next.release.sha256), false);
  assert.equal(changed.intent.pins.some(p => p.releaseSha256 === next.release.sha256), false);
  assert.equal(changed.compile.status, 'refused');
  assert.equal(changed.envelope.executable, false);
  assert.equal(changed.projection.records[0].id, 'draft');
});

test('ordinary editing and composition of an unresolved document refuse and point to the draft operations', async () => {
  const { maintained, policyBytes } = await savedMixed();
  const edit = await editAuthoring({ policyBytes, inventories: [maintained], operation: { type: 'remove-root', root: { releaseSha256: maintained.release.sha256, itemId: 'mattpocock.code-review', scope: 'project' } } });
  assert.equal(edit.status, 'refused'); assert.deepEqual(edit.originalBytes, policyBytes);
  assert.match(edit.diagnostics.map(d => d.message).join(' '), /openDraft/);
  const compose = await composeAuthoring({ basePolicyBytes: policyBytes, intent: freshAuthoring(), inventories: [maintained] });
  assert.equal(compose.status, 'refused'); assert.deepEqual(compose.originalBytes, policyBytes);
});

test('ordinary select fills an omitted item hash from the checked inventory and still refuses a wrong one', async () => {
  const { maintained, saved } = await savedMixed();
  const inventories = [maintained], root = { releaseSha256: maintained.release.sha256, itemId: 'mattpocock.grilling', scope: 'project', configuration: {} };
  const policyBytes = (await composeAuthoring({ intent: freshAuthoring(), inventories })).value.policyBytes;
  const filled = await editAuthoring({ policyBytes, inventories, operation: { type: 'select', root } });
  assert.equal(filled.status, 'ok', JSON.stringify(filled.diagnostics));
  assert.equal(filled.value.intent.roots[0].itemSha256, maintained.release.items.find(i => i.id === root.itemId).itemSha256);
  const wrong = await editAuthoring({ policyBytes, inventories, operation: { type: 'select', root: { ...root, itemSha256: '0'.repeat(64) } } });
  assert.equal(wrong.status, 'refused'); assert.equal(wrong.diagnostics[0].code, 'SOURCE_IDENTITY_MISMATCH');
  assert.equal(saved.status, 'ok');
});

test('unsupported semantics and identity mismatches keep editing unavailable and produce no draft', async () => {
  const { maintained, notes, policyBytes } = await savedMixed();
  const policy = JSON.parse(decode(policyBytes));
  policy.metadata['aih.workbench'].overlay = { unsafe: true };
  const unknown = encode(JSON.stringify(policy));
  const read = await readAuthoring({ policyBytes: unknown, inventories: [maintained] });
  assert.equal(read.value.editing, 'unavailable');
  const draft = await openDraft({ bytes: unknown, inventories: [maintained] });
  assert.equal(draft.status, 'refused'); assert.deepEqual(draft.originalBytes, unknown); assert.equal(draft.value, undefined);
  const mismatch = JSON.parse(decode(policyBytes));
  mismatch.metadata['aih.workbench'].roots[1].itemSha256 = '0'.repeat(64);
  const bytes = encode(JSON.stringify(mismatch));
  const refused = await openDraft({ bytes, inventories: [maintained, notes] });
  assert.equal(refused.status, 'refused'); assert.deepEqual(refused.originalBytes, bytes);
});

test('removing a choice, selecting and replacing record exact identities and preserve ownership', async () => {
  const { maintained, notes, saved, policyBytes } = await savedMixed();
  const inventories = [maintained], noteId = notes.release.items[0].id;
  const open = await opened({ bytes: policyBytes, inventories });
  const removed = await edited({ envelopeBytes: open.envelopeBytes, inventories, operation: { type: 'remove-root', root: { releaseSha256: maintained.release.sha256, itemId: 'mattpocock.code-review', scope: 'project' } } });
  assert.deepEqual(removed.intent.roots.map(r => r.itemId), [noteId]);
  assert.equal(removed.intent.pins.some(p => p.itemId === 'mattpocock.code-review'), false);
  assert.equal(removed.editing, 'unresolved');
  // Explicit replacement fills identities from the checked inventory and keeps the original ownership fields.
  const withTeam = structuredClone(open.intent); withTeam.origins.push({ id: 'team', kind: 'organization', organizationPolicySha256: 'a'.repeat(64), organizationSelectionId: 'notes' });
  const noteRoot = withTeam.roots.find(r => r.itemId === noteId); noteRoot.originIds = ['direct', 'team']; noteRoot.reason = 'Needed for review notes.';
  const seeded = await composeAuthoring({ intent: withTeam, inventories: [maintained, notes] });
  assert.equal(seeded.status, 'ok', JSON.stringify(seeded.diagnostics));
  const second = await opened({ bytes: seeded.value.policyBytes, inventories });
  const replacement = maintained.release.items.find(i => i.id === 'mattpocock.domain-modeling');
  const replaced = await edited({ envelopeBytes: second.envelopeBytes, inventories, operation: { type: 'replace', root: { releaseSha256: notes.release.sha256, itemId: noteId, scope: 'project' },
    replacement: { releaseSha256: maintained.release.sha256, itemId: replacement.id } } });
  const root = replaced.intent.roots.find(r => r.itemId === replacement.id);
  assert.equal(root.itemSha256, replacement.itemSha256);
  assert.deepEqual(root.originIds, ['direct', 'team']); assert.equal(root.reason, 'Needed for review notes.');
  assert.equal(replaced.intent.roots.some(r => r.itemId === noteId), false);
  assert.equal(replaced.editing, 'available'); assert.equal(replaced.compile.status, 'available');
  assert.equal(replaced.envelope.revision.sequence, 2);
  // Select fills the exact item identity automatically; a conflicting hash is refused, not corrected.
  const filled = await edited({ envelopeBytes: second.envelopeBytes, inventories, operation: { type: 'select', root: { releaseSha256: maintained.release.sha256, itemId: 'mattpocock.grilling', scope: 'project', configuration: {} } } });
  const grilling = maintained.release.items.find(i => i.id === 'mattpocock.grilling');
  assert.equal(filled.intent.roots.find(r => r.itemId === 'mattpocock.grilling').itemSha256, grilling.itemSha256);
  assert.deepEqual(filled.intent.roots.find(r => r.itemId === 'mattpocock.grilling').originIds, ['direct']);
  const wrong = await editDraft({ envelopeBytes: second.envelopeBytes, inventories, operation: { type: 'select', root: { releaseSha256: maintained.release.sha256, itemId: 'mattpocock.grilling', itemSha256: '0'.repeat(64), scope: 'project', configuration: {} } } });
  assert.equal(wrong.status, 'refused'); assert.equal(wrong.diagnostics[0].code, 'SOURCE_IDENTITY_MISMATCH'); assert.deepEqual(wrong.originalBytes, second.envelopeBytes);
  const missing = await editDraft({ envelopeBytes: second.envelopeBytes, inventories, operation: { type: 'select', root: { releaseSha256: notes.release.sha256, itemId: noteId, scope: 'project', configuration: {} } } });
  assert.equal(missing.status, 'refused'); assert.equal(missing.diagnostics[0].code, 'SOURCE_REVISION_UNAVAILABLE');
  const unknown = await editDraft({ envelopeBytes: second.envelopeBytes, inventories, operation: { type: 'rewrite-everything' } });
  assert.equal(unknown.status, 'refused'); assert.equal(unknown.diagnostics[0].code, 'INPUT_INVALID');
  // The original saved choices remain byte-for-byte in the envelope.
  assert.deepEqual(removed.savedIntentBytes, policyBytes);
  assert.deepEqual(JSON.parse(decode(removed.savedIntentBytes)).metadata['aih.workbench'], saved.value.intent);
});

test('an unavailable item still required by a retained choice is refused and names the dependents', async () => {
  const { notes, policyBytes } = await savedMixed();
  // Maintained content is unavailable; the notes source remains and requires it.
  const intent = freshAuthoring(), inventories = await mixedInventories(), [maintained] = inventories;
  intent.roots.push(rootOf(maintained, 'mattpocock.grill-with-docs'), rootOf(notes, notes.release.items[0].id));
  const saved = await composeAuthoring({ intent, inventories });
  assert.equal(saved.status, 'ok', JSON.stringify(saved.diagnostics));
  const open = await opened({ bytes: saved.value.policyBytes, inventories: [notes] });
  assert.equal(open.editing, 'unresolved');
  const blocked = open.unresolved.find(u => u.ref.itemId === 'mattpocock.grill-with-docs');
  assert.deepEqual(blocked.dependents.map(d => d.itemId), [notes.release.items[0].id]);
  const refused = await editDraft({ envelopeBytes: open.envelopeBytes, inventories: [notes], operation: { type: 'remove-root', root: { releaseSha256: maintained.release.sha256, itemId: 'mattpocock.grill-with-docs', scope: 'project' } } });
  assert.equal(refused.status, 'refused'); assert.equal(refused.diagnostics[0].code, 'DEPENDENCY_RETAINED');
  assert.deepEqual(refused.diagnostics[0].details.dependents.map(d => d.itemId), [notes.release.items[0].id]);
  assert.match(refused.diagnostics[0].message, new RegExp(notes.release.items[0].id));
  assert.deepEqual(refused.originalBytes, open.envelopeBytes);
  // A missing transitive dependency that is not itself a choice is named the same way.
  const transitive = await editDraft({ envelopeBytes: open.envelopeBytes, inventories: [notes], operation: { type: 'remove-root', root: { releaseSha256: maintained.release.sha256, itemId: 'mattpocock.domain-modeling', scope: 'project' } } });
  assert.equal(transitive.status, 'refused'); assert.equal(transitive.diagnostics[0].code, 'DEPENDENCY_RETAINED');
  // Removing the dependent first clears the dependency; nothing else is dropped.
  const clear = await edited({ envelopeBytes: open.envelopeBytes, inventories: [notes], operation: { type: 'remove-root', root: { releaseSha256: notes.release.sha256, itemId: notes.release.items[0].id, scope: 'project' } } });
  assert.deepEqual(clear.intent.roots.map(r => r.itemId), ['mattpocock.grill-with-docs']);
  assert.equal(clear.editing, 'unresolved');
  const then = await edited({ envelopeBytes: clear.envelopeBytes, inventories: [notes], operation: { type: 'remove-root', root: { releaseSha256: maintained.release.sha256, itemId: 'mattpocock.grill-with-docs', scope: 'project' } } });
  assert.deepEqual(then.intent.roots, []); assert.deepEqual(then.intent.pins, []); assert.equal(then.editing, 'available');
});

test('saved envelope is versioned, not executable, reopens with the same meaning and keeps exact original bytes', async () => {
  const { maintained, policyBytes, notes } = await savedMixed({ crlf: true });
  assert.ok(decode(policyBytes).includes('\r\n'));
  const inventories = [maintained];
  const first = await opened({ bytes: policyBytes, inventories });
  assert.deepEqual(first.savedIntentBytes, policyBytes);
  const read = await readJourneyEnvelope(first.envelopeBytes);
  assert.equal(read.status, 'ok', JSON.stringify(read.diagnostics));
  assert.equal(read.value.supported, true);
  assert.deepEqual(read.value.savedIntentBytes, policyBytes);
  assert.deepEqual(read.value.envelope, first.envelope);
  assert.equal(first.envelope.schema, JOURNEY_SCHEMA); assert.equal(first.envelope.executable, false);
  assert.equal(first.envelope.savedIntent.type, 'urn:aihq:core:execution-policy-bytes');
  assert.equal(first.envelope.savedIntent.sha256, await digestBytes(policyBytes));
  assert.equal(first.envelope.savedIntent.byteLength, policyBytes.length);
  assert.match(first.envelope.id, /^journey-[a-f0-9]{32}$/);
  assert.equal(first.envelope.id, `journey-${first.envelope.savedIntent.sha256.slice(0, 32)}`);
  assert.equal(first.envelope.records[0].savedIntentSha256, first.envelope.savedIntent.sha256);
  assert.equal(first.envelope.revision.sequence, 1); assert.equal('previousSha256' in first.envelope.revision, false);
  // Fresh page / headless reopen from the envelope alone.
  const again = await opened({ bytes: first.envelopeBytes, inventories });
  assert.deepEqual(again.projection, first.projection);
  assert.deepEqual(again.intent, first.intent);
  assert.deepEqual(again.unresolved, first.unresolved);
  assert.deepEqual(again.roots, first.roots);
  assert.deepEqual(again.envelopeBytes, first.envelopeBytes);
  assert.deepEqual(again.savedIntentBytes, policyBytes);
  // Revisions chain and the stable record identity does not change.
  const second = await edited({ envelopeBytes: first.envelopeBytes, inventories, operation: { type: 'remove-root', root: { releaseSha256: maintained.release.sha256, itemId: 'mattpocock.code-review', scope: 'project' } } });
  assert.equal(second.envelope.id, first.envelope.id);
  assert.equal(second.envelope.revision.sequence, 2);
  assert.equal(second.envelope.revision.previousSha256, first.envelope.revision.sha256);
  assert.notEqual(second.envelope.revision.sha256, first.envelope.revision.sha256);
  assert.deepEqual(second.savedIntentBytes, policyBytes);
  assert.equal(second.envelope.savedIntent.sha256, first.envelope.savedIntent.sha256);
  const third = await edited({ envelopeBytes: second.envelopeBytes, inventories, operation: { type: 'select', root: { releaseSha256: maintained.release.sha256, itemId: 'mattpocock.grilling', scope: 'project', configuration: {} } } });
  assert.equal(third.envelope.revision.sequence, 3); assert.equal(third.envelope.revision.previousSha256, second.envelope.revision.sha256);
  assert.equal(third.envelope.id, first.envelope.id);
  // The envelope is never an execution policy and Core does not accept it as one.
  const asPolicy = await readAuthoring({ policyBytes: first.envelopeBytes, inventories });
  assert.equal(asPolicy.status, 'refused');
  // Reopened with the source available again, the same original choices resolve without changing meaning.
  const resolved = await opened({ bytes: second.envelopeBytes, inventories: [maintained, notes] });
  assert.equal(resolved.editing, 'available'); assert.deepEqual(resolved.unresolved, []);
  assert.deepEqual(resolved.intent.roots, second.intent.roots);
});

test('compile is offered only for a resolved dependency-correct scope', async () => {
  const { maintained, notes, policyBytes } = await savedMixed();
  const noteId = notes.release.items[0].id, inventories = [maintained];
  const open = await opened({ bytes: policyBytes, inventories });
  assert.equal(open.compile.status, 'refused');
  assert.equal(open.compile.reasons[0].code, 'SCOPE_UNRESOLVED');
  const whole = await compileDraft({ envelopeBytes: open.envelopeBytes, inventories });
  assert.equal(whole.status, 'refused'); assert.equal(whole.diagnostics[0].code, 'SCOPE_UNRESOLVED');
  assert.equal(whole.value, undefined);
  assert.deepEqual(whole.diagnostics[0].details.unresolved.filter(u => u.kind === 'root').map(u => u.ref.itemId), [noteId]);
  assert.deepEqual(whole.diagnostics[0].details.blocked.map(b => b.root.itemId), [noteId]);
  assert.deepEqual(whole.originalBytes, open.envelopeBytes);
  const scoped = await compileDraft({ envelopeBytes: open.envelopeBytes, inventories, roots: [{ releaseSha256: maintained.release.sha256, itemId: 'mattpocock.code-review', scope: 'project' }] });
  assert.equal(scoped.status, 'ok', JSON.stringify(scoped.diagnostics));
  assert.deepEqual(scoped.value.scope.map(r => r.itemId), ['mattpocock.code-review']);
  const reread = await readAuthoring({ policyBytes: scoped.value.policyBytes, inventories });
  assert.equal(reread.value.editing, 'available', JSON.stringify(reread.value.diagnostics));
  assert.deepEqual(reread.value.intent.roots.map(r => r.itemId), ['mattpocock.code-review']);
  assert.deepEqual(reread.value.policy.selections.map(s => s.managementId).sort(), scoped.value.policy.selections.map(s => s.managementId).sort());
  // The scoped output keeps unrelated policy fields from the original base.
  const original = JSON.parse(decode(policyBytes));
  assert.equal(scoped.value.policy.mode, original.mode);
  const unknownScope = await compileDraft({ envelopeBytes: open.envelopeBytes, inventories, roots: [{ releaseSha256: maintained.release.sha256, itemId: 'mattpocock.grilling', scope: 'project' }] });
  assert.equal(unknownScope.status, 'refused'); assert.equal(unknownScope.diagnostics[0].code, 'INPUT_INVALID');
  // Fully available whole-draft compile equals ordinary composition of the same choices.
  const complete = await opened({ bytes: policyBytes, inventories: [maintained, notes] });
  assert.equal(complete.compile.status, 'available');
  const compiled = await compileDraft({ envelopeBytes: complete.envelopeBytes, inventories: [maintained, notes] });
  assert.equal(compiled.status, 'ok', JSON.stringify(compiled.diagnostics));
  assert.deepEqual(compiled.value.policyBytes, policyBytes);
});

test('unknown envelope versions and required records are refused with the original bytes; optional records survive', async () => {
  const { maintained, policyBytes } = await savedMixed();
  const inventories = [maintained];
  const open = await opened({ bytes: policyBytes, inventories });
  const document = JSON.parse(decode(open.envelopeBytes));
  const future = encode(JSON.stringify({ ...document, schema: 'urn:aihq:workbench:journey-envelope:2.0.0' }));
  const version = await readJourneyEnvelope(future);
  assert.equal(version.status, 'refused'); assert.equal(version.diagnostics[0].code, 'JOURNEY_VERSION_UNSUPPORTED'); assert.deepEqual(version.originalBytes, future);
  const reopened = await openDraft({ bytes: future, inventories });
  assert.equal(reopened.status, 'refused'); assert.equal(reopened.diagnostics[0].code, 'JOURNEY_VERSION_UNSUPPORTED'); assert.deepEqual(reopened.originalBytes, future);
  // Records must be digest-bound; rewrite through the public writer rather than hand-editing hashes.
  const base = await readJourneyEnvelope(open.envelopeBytes);
  const required = { id: 'workspace', schema: 'urn:aihq:workbench:journey-record:workspace:1.0.0', required: true, declarations: [{ id: 'future' }] };
  const optional = { id: 'notes', schema: 'urn:aihq:workbench:journey-record:annotation:1.0.0', required: false, text: 'kept verbatim', nested: { b: 1, a: [true, null] } };
  const draft = open.envelope.records[0];
  const withRequired = { value: { envelopeBytes: await withRecords(open.envelopeBytes, [required]) } };
  const readRequired = await readJourneyEnvelope(withRequired.value.envelopeBytes);
  assert.equal(readRequired.status, 'ok'); assert.equal(readRequired.value.supported, false);
  assert.ok(readRequired.diagnostics.some(d => d.code === 'JOURNEY_RECORD_UNSUPPORTED' && d.path === '/records/1'));
  const mutation = await editDraft({ envelopeBytes: withRequired.value.envelopeBytes, inventories, operation: { type: 'remove-root', root: { releaseSha256: maintained.release.sha256, itemId: 'mattpocock.code-review', scope: 'project' } } });
  assert.equal(mutation.status, 'refused'); assert.equal(mutation.diagnostics[0].code, 'JOURNEY_RECORD_UNSUPPORTED'); assert.deepEqual(mutation.originalBytes, withRequired.value.envelopeBytes);
  const shown = await openDraft({ bytes: withRequired.value.envelopeBytes, inventories });
  assert.equal(shown.status, 'ok'); assert.equal(shown.value.supported, false); assert.equal(shown.value.projection.records[1].supported, false);
  const rewrite = await writeJourneyEnvelope({ savedIntentBytes: policyBytes, records: [draft], previous: readRequired.value });
  assert.equal(rewrite.status, 'refused'); assert.equal(rewrite.diagnostics[0].code, 'JOURNEY_RECORD_UNSUPPORTED');
  const withOptional = { value: { envelopeBytes: await withRecords(open.envelopeBytes, [optional]) } };
  const readOptional = await readJourneyEnvelope(withOptional.value.envelopeBytes);
  assert.equal(readOptional.value.supported, true);
  assert.ok(readOptional.diagnostics.some(d => d.code === 'JOURNEY_RECORD_PRESERVED' && d.severity === 'info'));
  const after = await edited({ envelopeBytes: withOptional.value.envelopeBytes, inventories, operation: { type: 'remove-root', root: { releaseSha256: maintained.release.sha256, itemId: 'mattpocock.code-review', scope: 'project' } } });
  assert.deepEqual(after.envelope.records.find(r => r.id === 'notes'), optional);
  assert.equal(after.envelope.records.find(r => r.id === 'draft').intent.roots.length, 1);
  assert.equal(base.status, 'ok');
  const direct = await writeJourneyEnvelope({ savedIntentBytes: policyBytes, records: [draft, optional] });
  assert.equal(direct.status, 'refused'); assert.equal(direct.diagnostics[0].code, 'INPUT_INVALID');
});

test('tampered digests, references, flags and duplicate records are refused', async () => {
  const { maintained, policyBytes } = await savedMixed();
  const open = await opened({ bytes: policyBytes, inventories: [maintained] });
  const document = JSON.parse(decode(open.envelopeBytes));
  const attempt = async mutate => { const copy = structuredClone(document); mutate(copy); const bytes = encode(JSON.stringify(copy)); const result = await readJourneyEnvelope(bytes); assert.equal(result.status, 'refused'); assert.deepEqual(result.originalBytes, bytes); return result.diagnostics[0].code; };
  assert.equal(await attempt(d => { d.revision.sequence = 7; d.revision.previousSha256 = '3'.repeat(64); }), 'JOURNEY_REVISION_MISMATCH');
  assert.equal(await attempt(d => { d.records[0].intent.roots.pop(); }), 'JOURNEY_REVISION_MISMATCH');
  assert.equal(await attempt(d => { d.savedIntent.sha256 = '0'.repeat(64); }), 'JOURNEY_REFERENCE_MISMATCH');
  assert.equal(await attempt(d => { d.savedIntent.byteLength += 1; }), 'JOURNEY_REFERENCE_MISMATCH');
  assert.equal(await attempt(d => { d.records[0].savedIntentSha256 = '1'.repeat(64); }), 'JOURNEY_REFERENCE_MISMATCH');
  assert.equal(await attempt(d => { d.executable = true; }), 'FIELD_SEMANTICS_UNSUPPORTED');
  assert.equal(await attempt(d => { d.extra = true; }), 'INPUT_INVALID');
  assert.equal(await attempt(d => { delete d.savedIntent; }), 'INPUT_INVALID');
  assert.equal(await attempt(d => { d.savedIntent.base64 = '!!!'; }), 'INPUT_INVALID');
  assert.equal((await readJourneyEnvelope(encode('not json'))).diagnostics[0].code, 'INPUT_INVALID');
  assert.equal((await readJourneyEnvelope(new Uint8Array([0xff, 0xfe]))).diagnostics[0].code, 'INPUT_INVALID');
  assert.equal((await readJourneyEnvelope('text')).diagnostics[0].code, 'INPUT_INVALID');
  const duplicate = await writeJourneyEnvelope({ savedIntentBytes: policyBytes, records: [document.records[0], document.records[0]] });
  assert.equal(duplicate.status, 'refused');
  // Tampered intent inside a record must satisfy the saved-intent shape even if re-digested by the writer.
  const bad = structuredClone(document.records[0]); bad.intent.overlay = true;
  const invalid = await writeJourneyEnvelope({ savedIntentBytes: policyBytes, records: [bad] });
  assert.equal(invalid.status, 'refused'); assert.equal(invalid.diagnostics[0].code, 'FIELD_SEMANTICS_UNSUPPORTED');
  assert.deepEqual(JOURNEY_ACCEPTED_SCHEMAS, [JOURNEY_SCHEMA]);
  assert.deepEqual(Object.keys(JOURNEY_RECORD_SCHEMAS), ['urn:aihq:workbench:journey-record:unresolved-draft:1.0.0']);
});

test('writer output is deterministic and the projection is a plain display summary', async () => {
  const { maintained, policyBytes } = await savedMixed();
  const open = await opened({ bytes: policyBytes, inventories: [maintained] });
  const written = await writeJourneyEnvelope({ savedIntentBytes: policyBytes, records: [open.envelope.records[0]] });
  assert.equal(written.status, 'ok');
  assert.deepEqual(written.value.envelopeBytes, open.envelopeBytes);
  assert.equal(decode(open.envelopeBytes).endsWith('}\n'), true);
  const projection = projectJourneyEnvelope(open.envelope);
  assert.deepEqual(Object.keys(projection), ['id', 'schema', 'revision', 'executable', 'savedIntent', 'records']);
  assert.deepEqual(projection.savedIntent, { sha256: open.envelope.savedIntent.sha256, byteLength: policyBytes.length });
  assert.deepEqual(projection.records, [{ id: 'draft', schema: 'urn:aihq:workbench:journey-record:unresolved-draft:1.0.0', required: true, supported: true }]);
  assert.equal(stable(JSON.parse(JSON.stringify(projection))), stable(projection));
  assert.equal(JSON.stringify(projection).includes(open.envelope.savedIntent.base64), false);
});

test('scoped compile never silently drops review decisions and unrelated synthetic content resolves normally', async () => {
  // Synthetic two-release content: app.alpha requires shared.base, with an optional that stays skipped.
  const shared = fixtureRelease('journey-shared', [fixtureItem('shared.base'), fixtureItem('shared.optional'), fixtureItem('shared.other')]);
  const app = fixtureRelease('journey-app', [fixtureItem('app.alpha', { requires: [crossRef(shared, 'shared.base')], optional: [crossRef(shared, 'shared.optional')] })]);
  const intent = freshAuthoring();
  intent.roots.push(rootFor(app, 'app.alpha'), rootFor(shared, 'shared.other'));
  intent.exclusions.push({ originId: 'direct', releaseSha256: shared.release.sha256, itemId: 'shared.optional', scope: 'project' });
  const saved = await composeAuthoring({ intent, inventories: [shared, app] });
  assert.equal(saved.status, 'ok', JSON.stringify(saved.diagnostics));
  // The app source is unavailable: replace its choice; the skip and the sibling choice survive.
  const open = await opened({ bytes: saved.value.policyBytes, inventories: [shared] });
  assert.equal(open.editing, 'unresolved');
  assert.deepEqual(open.unresolved.map(u => [u.kind, u.ref.itemId, u.reason]), [['root', 'app.alpha', 'source-unavailable']]);
  const swapped = await edited({ envelopeBytes: open.envelopeBytes, inventories: [shared], operation: { type: 'replace', root: ref(rootFor(app, 'app.alpha')), replacement: { releaseSha256: shared.release.sha256, itemId: 'shared.base' } } });
  assert.deepEqual(swapped.intent.exclusions, intent.exclusions);
  assert.deepEqual(swapped.intent.roots.map(r => r.itemId).sort(), ['shared.base', 'shared.other']);
  assert.equal(swapped.editing, 'available');
  const compiled = await compileDraft({ envelopeBytes: swapped.envelopeBytes, inventories: [shared] });
  assert.equal(compiled.status, 'ok', JSON.stringify(compiled.diagnostics));
  assert.deepEqual(compiled.value.policy.selections.map(s => s.recipe.reference.path ?? s.managementId).length, 2);
  // Skips are only recorded for exact resolvable references.
  const skipped = await editDraft({ envelopeBytes: open.envelopeBytes, inventories: [shared], operation: { type: 'skip', exclusion: { originId: 'direct', releaseSha256: app.release.sha256, itemId: 'app.optional', scope: 'project' } } });
  assert.equal(skipped.status, 'refused'); assert.equal(skipped.diagnostics[0].code, 'SOURCE_REVISION_UNAVAILABLE');
  const unskipped = await edited({ envelopeBytes: open.envelopeBytes, inventories: [shared], operation: { type: 'unskip', exclusion: intent.exclusions[0] } });
  assert.deepEqual(unskipped.intent.exclusions, []);
  // A recorded skip on unavailable content can still be removed; it only stops suppressing a suggestion.
  const gone = await opened({ bytes: saved.value.policyBytes, inventories: [app] });
  assert.deepEqual(gone.unresolved.filter(u => u.kind === 'exclusion').map(u => u.ref.itemId), ['shared.optional']);
  const released = await edited({ envelopeBytes: gone.envelopeBytes, inventories: [app], operation: { type: 'unskip', exclusion: intent.exclusions[0] } });
  assert.deepEqual(released.intent.exclusions, []);
  assert.equal(released.unresolved.some(u => u.kind === 'exclusion'), false);
});

test('the journey module is pure: no browser globals, filesystem, network or Node Buffer', async () => {
  const source = await readFile(new URL('./journey.mjs', import.meta.url), 'utf8');
  for (const forbidden of [/\bwindow\b/, /\bdocument\b/, /\bfetch\b/, /node:fs/, /\bbtoa\b/, /\batob\b/, /\bBuffer\b/, /\bprocess\b/, /node:/]) assert.doesNotMatch(source, forbidden);
});

test('shipped JSON Schema describes the envelope the writer produces', async t => {
  let schema;
  for (const path of ['../../schemas/journey-envelope-1.0.0.json', '../schemas/journey-envelope-1.0.0.json']) {
    try { schema = JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8')); break; } catch { /* try next layout */ }
  }
  if (!schema) return t.skip('schema file is not present in this consumer layout; tools/write-authoring-schemas.mjs --check verifies it');
  const { maintained, policyBytes } = await savedMixed();
  const open = await opened({ bytes: policyBytes, inventories: [maintained] });
  assert.equal(schema.$id, JOURNEY_SCHEMA);
  assert.equal(schema.properties.schema.const, JOURNEY_SCHEMA);
  assert.equal(schema.properties.executable.const, false);
  assert.deepEqual([...schema.required].sort(), Object.keys(open.envelope).sort());
  assert.deepEqual(Object.keys(schema.properties).sort(), Object.keys(open.envelope).sort());
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual([...schema.properties.savedIntent.required].sort(), Object.keys(open.envelope.savedIntent).sort());
  assert.deepEqual([...schema.properties.revision.required].sort(), ['sequence', 'sha256']);
  assert.equal(schema.properties.savedIntent.properties.type.const, open.envelope.savedIntent.type);
  assert.equal(schema.properties.savedIntent.properties.mediaType.const, open.envelope.savedIntent.mediaType);
  const known = schema.properties.records.items;
  assert.equal(known.if.properties.schema.const, Object.keys(JOURNEY_RECORD_SCHEMAS)[0]);
  assert.deepEqual([...known.then.required].sort(), Object.keys(open.envelope.records[0]).sort());
  assert.equal(known.then.properties.intent.$ref, 'urn:aihq:workbench:saved-intent:3.0.0');
  assert.equal(known.else.additionalProperties, true);
});

// Reads the shipped schema in either consumer layout, or returns undefined where it is not shipped.
async function shippedJourneySchema() {
  for (const path of ['../../schemas/journey-envelope-1.0.0.json', '../schemas/journey-envelope-1.0.0.json']) {
    try { return JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8')); } catch { /* try next layout */ }
  }
  return undefined;
}
const patternsOf = (value, path = '') => value && typeof value === 'object'
  ? Object.entries(value).flatMap(([key, member]) => key === 'pattern' && typeof member === 'string' ? [[path, member]] : patternsOf(member, `${path}/${key}`)) : [];

test('every pattern in the shipped schema keeps its escapes and accepts what the runtime accepts', async t => {
  const schema = await shippedJourneySchema();
  if (!schema) return t.skip('schema file is not present in this consumer layout; tools/write-authoring-schemas.mjs --check verifies it');
  const patterns = patternsOf(schema);
  const samples = {
    '/properties/id': { accept: [`journey-${'a'.repeat(32)}`], reject: ['journey-xyz', `journey-${'A'.repeat(32)}`] },
    '/properties/savedIntent/properties/base64': { accept: ['', 'QUJD', 'QQ=='], reject: ['QU*D'] },
    'record id': { accept: ['draft', 'draft-1.a_b'], reject: ['has space', ''] },
    'hash': { accept: ['0123456789abcdef'.repeat(4)], reject: ['0'.repeat(63), 'G'.repeat(64)] },
    'record schema': { accept: [], reject: ['urn:aihq:workbench:journey-record:Annotation:1.0.0', 'urn:aihq:workbench:journey-record:annotation:1.0',
      'urn:aihq:workbench:journey-record:annotation:dd.d.d', 'urn:aihq:workbench:journey-record:annotation:1x0x0', 'urn:aihq:workbench:journey-record:annotation:1.0.0\n'] }
  };
  const kindOf = path => path in samples ? path : path.endsWith('/schema') ? 'record schema' : /sha256$/i.test(path) ? 'hash' : /\/id$/.test(path) ? 'record id' : undefined;
  assert.ok(patterns.length >= 8);
  // The same URNs the runtime accepts for records it does not interpret, optional and required.
  const { maintained, policyBytes } = await savedMixed();
  const open = await opened({ bytes: policyBytes, inventories: [maintained] });
  const foreign = [{ id: 'notes', schema: 'urn:aihq:workbench:journey-record:annotation:1.0.0', required: false },
    { id: 'workspace', schema: 'urn:aihq:workbench:journey-record:workspace:12.30.4', required: true }];
  const read = await readJourneyEnvelope(await withRecords(open.envelopeBytes, foreign));
  assert.equal(read.status, 'ok', JSON.stringify(read.diagnostics));
  samples['record schema'].accept.push(...foreign.map(record => record.schema));
  for (const [path, pattern] of patterns) {
    const kind = kindOf(path), regex = new RegExp(pattern);
    assert.ok(kind, `unreviewed pattern at ${path}`);
    for (const value of samples[kind].accept) assert.equal(regex.test(value), true, `${path} should accept ${JSON.stringify(value)} (${pattern})`);
    for (const value of samples[kind].reject) assert.equal(regex.test(value), false, `${path} should reject ${JSON.stringify(value)} (${pattern})`);
  }
});

test('the journey envelope helper and constants agree with the shipped schema', async t => {
  assert.equal(JOURNEY_SCHEMA.startsWith(JOURNEY_SCHEMA_PREFIX), true);
  assert.equal(isJourneyEnvelope(encode(JSON.stringify({ schema: JOURNEY_SCHEMA }))), true);
  assert.equal(isJourneyEnvelope(encode(JSON.stringify({ schema: `${JOURNEY_SCHEMA_PREFIX}9.0.0` }))), true);
  assert.equal(isJourneyEnvelope(encode(JSON.stringify({ schema: 'urn:aihq:core:execution-policy:1.3.0' }))), false);
  assert.equal(isJourneyEnvelope(encode('not json')), false);
  assert.equal(isJourneyEnvelope(Uint8Array.of(0xff, 0xfe)), false);
  assert.equal(isJourneyEnvelope(encode('null')), false);
  assert.equal(isJourneyEnvelope(undefined), false);
  const schema = await shippedJourneySchema();
  if (!schema) return t.skip('schema file is not present in this consumer layout; tools/write-authoring-schemas.mjs --check verifies it');
  assert.equal(schema.$id, JOURNEY_SCHEMA);
  assert.equal(schema.properties.records.items.if.properties.schema.const, DRAFT_RECORD_SCHEMA);
  assert.equal(schema.properties.savedIntent.properties.type.const, SAVED_INTENT_TYPE);
});

test('a choice added in a draft whose dependency later disappears reopens unresolved and keeps what it needs', async () => {
  const base = fixtureRelease('journey-dep-base', [fixtureItem('base.dep')]);
  const app = fixtureRelease('journey-dep-app', [fixtureItem('app.added', { requires: [crossRef(base, 'base.dep')] })]);
  const solo = fixtureRelease('journey-dep-solo', [fixtureItem('solo.one')]);
  const extra = fixtureRelease('journey-dep-extra', [fixtureItem('extra.one')]);
  const intent = freshAuthoring();
  intent.roots.push(rootFor(solo, 'solo.one'));
  const saved = await composeAuthoring({ intent, inventories: [solo] });
  assert.equal(saved.status, 'ok', JSON.stringify(saved.diagnostics));
  const everything = [solo, app, base], without = [solo, app];
  const open = await opened({ bytes: saved.value.policyBytes, inventories: everything });
  const added = await edited({ envelopeBytes: open.envelopeBytes, inventories: everything, operation: { type: 'select', root: { releaseSha256: app.release.sha256, itemId: 'app.added', scope: 'project', configuration: {} } } });
  assert.equal(added.compile.status, 'available');
  assert.equal(added.intent.pins.some(p => p.itemId === 'base.dep'), true);
  // Reopened without the dependency's inventory, nothing is treated as resolved.
  const reopened = await opened({ bytes: added.envelopeBytes, inventories: without });
  const root = reopened.roots.find(r => r.itemId === 'app.added');
  assert.equal(reopened.editing, 'unresolved');
  assert.equal(root.status, 'unresolved');
  assert.deepEqual(root.blockedBy.map(b => [b.kind, b.ref.itemId, b.reason]), [['dependency', 'base.dep', 'source-unavailable']]);
  assert.equal(reopened.roots.find(r => r.itemId === 'solo.one').status, 'resolved');
  assert.deepEqual(reopened.unresolved.map(u => [u.kind, u.ref.itemId, u.reason, u.dependents.map(d => d.itemId)]), [['dependency', 'base.dep', 'source-unavailable', ['app.added']]]);
  assert.equal(reopened.compile.status, 'refused'); assert.equal(reopened.compile.reasons[0].code, 'SCOPE_UNRESOLVED');
  const refused = await compileDraft({ envelopeBytes: added.envelopeBytes, inventories: without, roots: [ref(rootFor(app, 'app.added'))] });
  assert.equal(refused.status, 'refused'); assert.equal(refused.diagnostics[0].code, 'SCOPE_UNRESOLVED');
  assert.deepEqual(refused.diagnostics[0].details.blocked.map(b => b.root.itemId), ['app.added']);
  const whole = await compileDraft({ envelopeBytes: added.envelopeBytes, inventories: without });
  assert.equal(whole.status, 'refused'); assert.equal(whole.diagnostics[0].code, 'SCOPE_UNRESOLVED');
  // The other resolved choice still compiles, alone.
  const alone = await compileDraft({ envelopeBytes: added.envelopeBytes, inventories: without, roots: [ref(rootFor(solo, 'solo.one'))] });
  assert.equal(alone.status, 'ok', JSON.stringify(alone.diagnostics));
  assert.deepEqual(alone.value.scope.map(r => r.itemId), ['solo.one']);
  // An unrelated edit while the dependency is missing prunes nothing the unresolved choice needs.
  const further = await edited({ envelopeBytes: added.envelopeBytes, inventories: [...without, extra], operation: { type: 'select', root: { releaseSha256: extra.release.sha256, itemId: 'extra.one', scope: 'project', configuration: {} } } });
  assert.equal(further.intent.pins.some(p => p.itemId === 'base.dep'), true);
  assert.deepEqual(further.changes.removedPins, []);
  assert.equal(further.intent.provenance.some(p => p.releaseSha256 === base.release.sha256), true);
  assert.equal(further.roots.find(r => r.itemId === 'app.added').status, 'unresolved');
  // Supplied again, the same exact choice resolves with its dependency.
  const restored = await opened({ bytes: further.envelopeBytes, inventories: [...everything, extra] });
  assert.equal(restored.editing, 'available'); assert.equal(restored.compile.status, 'available');
});

test('an envelope with an unsupported required record advertises a refused compile with that reason', async () => {
  const { policyBytes, inventories } = await savedMixed();
  const open = await opened({ bytes: policyBytes, inventories });
  assert.equal(open.compile.status, 'available');
  const required = { id: 'workspace', schema: 'urn:aihq:workbench:journey-record:workspace:1.0.0', required: true, declarations: [] };
  const bytes = await withRecords(open.envelopeBytes, [required]);
  const shown = await opened({ bytes, inventories });
  assert.equal(shown.supported, false);
  assert.equal(shown.compile.status, 'refused');
  assert.equal(shown.compile.reasons[0].code, 'JOURNEY_RECORD_UNSUPPORTED');
  assert.match(shown.compile.reasons[0].message, /workspace/);
  const compiled = await compileDraft({ envelopeBytes: bytes, inventories });
  assert.equal(compiled.status, 'refused'); assert.equal(compiled.diagnostics[0].code, 'JOURNEY_RECORD_UNSUPPORTED');
});

// Rewrites the draft record of an envelope with an intent the page could not itself have produced.
async function rewritten(envelopeBytes, savedIntentBytes, intent) {
  const previous = (await readJourneyEnvelope(envelopeBytes)).value;
  const result = await writeJourneyEnvelope({ savedIntentBytes, previous, records: [{ id: 'draft', schema: DRAFT_RECORD_SCHEMA, required: true, intent }] });
  assert.equal(result.status, 'ok', JSON.stringify(result.diagnostics));
  return result.value.envelopeBytes;
}
const codes = diagnostics => diagnostics.map(d => d.code);

test('a choice that Catalog refuses with everything supplied is reported with Catalog diagnostics, not as missing sources', async () => {
  const base = fixtureRelease('journey-skip-base', [fixtureItem('base.dep')]);
  const app = fixtureRelease('journey-skip-app', [fixtureItem('app.added', { requires: [crossRef(base, 'base.dep')] })]);
  const solo = fixtureRelease('journey-skip-solo', [fixtureItem('solo.one')]);
  const inventories = [solo, app, base];
  const intent = freshAuthoring();
  intent.roots.push(rootFor(solo, 'solo.one'));
  const saved = await composeAuthoring({ intent, inventories: [solo] });
  const open = await opened({ bytes: saved.value.policyBytes, inventories });
  const added = await edited({ envelopeBytes: open.envelopeBytes, inventories, operation: { type: 'select', root: { releaseSha256: app.release.sha256, itemId: 'app.added', scope: 'project', configuration: {} } } });
  // A recorded skip of a required item contradicts the closure although every item is supplied.
  const skipped = structuredClone(added.intent);
  skipped.exclusions.push({ originId: 'direct', releaseSha256: base.release.sha256, itemId: 'base.dep', scope: 'project' });
  const ordinary = await composeAuthoring({ intent: skipped, inventories });
  assert.equal(ordinary.status, 'refused');
  const bytes = await rewritten(added.envelopeBytes, saved.value.policyBytes, skipped);
  const reopened = await opened({ bytes, inventories });
  const root = reopened.roots.find(r => r.itemId === 'app.added');
  assert.equal(root.status, 'refused');
  assert.equal(root.blockedBy, undefined);
  assert.equal(root.refusal.owner, 'catalog');
  assert.deepEqual(root.refusal.diagnostics, ordinary.diagnostics);
  assert.deepEqual(reopened.unresolved, []);
  assert.equal(reopened.diagnostics.some(d => /unavailable/i.test(d.code)), false);
  assert.equal(JSON.stringify(reopened).includes('closure-unavailable'), false);
  assert.equal(reopened.roots.find(r => r.itemId === 'solo.one').status, 'resolved');
  assert.equal(reopened.compile.status, 'refused');
  assert.deepEqual(reopened.compile.reasons, ordinary.diagnostics);
  const refused = await compileDraft({ envelopeBytes: bytes, inventories, roots: [ref(rootFor(app, 'app.added'))] });
  assert.equal(refused.status, 'refused'); assert.deepEqual(refused.diagnostics, ordinary.diagnostics);
  assert.equal((await compileDraft({ envelopeBytes: bytes, inventories })).status, 'refused');
  assert.equal((await compileDraft({ envelopeBytes: bytes, inventories, roots: [ref(rootFor(solo, 'solo.one'))] })).status, 'ok');
});

test('an invalid configuration on an available choice is a Catalog refusal, and the draft stays fixable', async () => {
  const release = fixtureRelease('journey-config', [fixtureItem('cfg.one', {}, { inputs: { directory: { type: 'string', required: false } } }), fixtureItem('solo.one')]);
  const inventories = [release];
  const intent = freshAuthoring();
  intent.roots.push(rootFor(release, 'solo.one'));
  const saved = await composeAuthoring({ intent, inventories });
  const open = await opened({ bytes: saved.value.policyBytes, inventories });
  const added = await edited({ envelopeBytes: open.envelopeBytes, inventories, operation: { type: 'select', root: { releaseSha256: release.release.sha256, itemId: 'cfg.one', scope: 'project', configuration: {} } } });
  const invalid = structuredClone(added.intent);
  invalid.roots.find(r => r.itemId === 'cfg.one').configuration = { directory: 7, bogus: true };
  const ordinary = await composeAuthoring({ intent: invalid, inventories });
  assert.equal(ordinary.status, 'refused', 'the configuration must be refused by ordinary authoring');
  const bytes = await rewritten(added.envelopeBytes, saved.value.policyBytes, invalid);
  const reopened = await opened({ bytes, inventories });
  const root = reopened.roots.find(r => r.itemId === 'cfg.one');
  assert.equal(root.status, 'refused');
  assert.equal(root.refusal.owner, 'catalog');
  assert.deepEqual(codes(root.refusal.diagnostics), codes(ordinary.diagnostics));
  assert.equal(root.refusal.diagnostics[0].details.owner, 'catalog');
  assert.deepEqual(reopened.unresolved, []);
  assert.equal(JSON.stringify(reopened).includes('closure-unavailable'), false);
  assert.equal(reopened.compile.status, 'refused'); assert.deepEqual(codes(reopened.compile.reasons), codes(ordinary.diagnostics));
  // A new choice with an invalid configuration is refused with the original bytes and no revision.
  const other = await editDraft({ envelopeBytes: bytes, inventories, operation: { type: 'select', root: { releaseSha256: release.release.sha256, itemId: 'cfg.one', scope: 'user', configuration: { bogus: true } } } });
  assert.equal(other.status, 'refused'); assert.deepEqual(other.originalBytes, bytes);
  // Correcting the configuration through the draft resolves the choice.
  const fixed = await edited({ envelopeBytes: bytes, inventories, operation: { type: 'select', root: { releaseSha256: release.release.sha256, itemId: 'cfg.one', scope: 'project', configuration: {} } } });
  assert.equal(fixed.roots.find(r => r.itemId === 'cfg.one').status, 'resolved');
  assert.equal(fixed.compile.status, 'available');
});

test('a skip of a required dependency is refused with Catalog diagnostics and the original bytes', async () => {
  const base = fixtureRelease('journey-edit-base', [fixtureItem('base.dep')]);
  const app = fixtureRelease('journey-edit-app', [fixtureItem('app.added', { requires: [crossRef(base, 'base.dep')] })]);
  const solo = fixtureRelease('journey-edit-solo', [fixtureItem('solo.one')]);
  const inventories = [solo, app, base];
  const intent = freshAuthoring();
  intent.roots.push(rootFor(solo, 'solo.one'));
  const saved = await composeAuthoring({ intent, inventories: [solo] });
  const open = await opened({ bytes: saved.value.policyBytes, inventories });
  const added = await edited({ envelopeBytes: open.envelopeBytes, inventories, operation: { type: 'select', root: { releaseSha256: app.release.sha256, itemId: 'app.added', scope: 'project', configuration: {} } } });
  const operation = { type: 'skip', exclusion: { originId: 'direct', releaseSha256: base.release.sha256, itemId: 'base.dep', scope: 'project' } };
  const result = await editDraft({ envelopeBytes: added.envelopeBytes, inventories, operation });
  assert.equal(result.status, 'refused');
  assert.deepEqual(result.originalBytes, added.envelopeBytes);
  assert.equal(result.value, undefined);
  const skipped = structuredClone(added.intent);
  skipped.exclusions.push(operation.exclusion);
  const ordinary = await composeAuthoring({ intent: skipped, inventories });
  assert.deepEqual(result.diagnostics, ordinary.diagnostics);
  // Content that is merely not supplied cannot be checked, so that edit stays an availability matter.
  const unsupplied = await editDraft({ envelopeBytes: added.envelopeBytes, inventories: [solo, app], operation });
  assert.equal(unsupplied.status, 'refused'); assert.equal(unsupplied.diagnostics[0].code, 'SOURCE_REVISION_UNAVAILABLE');
});

test('an unrelated edit keeps every recorded pin while any choice closure is undetermined', async () => {
  const c = fixtureRelease('journey-chain-c', [fixtureItem('chain.c')]);
  const b = fixtureRelease('journey-chain-b', [fixtureItem('chain.b', { requires: [crossRef(c, 'chain.c')] })]);
  const a = fixtureRelease('journey-chain-a', [fixtureItem('chain.a', { requires: [crossRef(b, 'chain.b')] })]);
  const solo = fixtureRelease('journey-chain-solo', [fixtureItem('solo.one')]);
  const extra = fixtureRelease('journey-chain-extra', [fixtureItem('extra.one')]);
  const everything = [solo, a, b, c], withoutB = [solo, a, c];
  const intent = freshAuthoring();
  intent.roots.push(rootFor(solo, 'solo.one'));
  const saved = await composeAuthoring({ intent, inventories: [solo] });
  const open = await opened({ bytes: saved.value.policyBytes, inventories: everything });
  const added = await edited({ envelopeBytes: open.envelopeBytes, inventories: everything, operation: { type: 'select', root: { releaseSha256: a.release.sha256, itemId: 'chain.a', scope: 'project', configuration: {} } } });
  assert.deepEqual(added.intent.pins.map(p => p.itemId).sort(), ['chain.a', 'chain.b', 'chain.c', 'solo.one']);
  const further = await edited({ envelopeBytes: added.envelopeBytes, inventories: [...withoutB, extra], operation: { type: 'select', root: { releaseSha256: extra.release.sha256, itemId: 'extra.one', scope: 'project', configuration: {} } } });
  assert.equal(further.roots.find(r => r.itemId === 'chain.a').status, 'unresolved');
  assert.deepEqual(further.intent.pins.map(p => p.itemId).sort(), ['chain.a', 'chain.b', 'chain.c', 'extra.one', 'solo.one']);
  assert.deepEqual(further.changes.removedPins, []);
  for (const release of [a, b, c]) assert.equal(further.intent.provenance.some(p => p.releaseSha256 === release.release.sha256), true);
  // Everything supplied again: the same choices resolve and compile with their recorded pins.
  const restored = await opened({ bytes: further.envelopeBytes, inventories: [...everything, extra] });
  assert.equal(restored.editing, 'available'); assert.equal(restored.compile.status, 'available', JSON.stringify(restored.compile));
});
