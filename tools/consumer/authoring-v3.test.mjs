import test from 'node:test';
import assert from 'node:assert/strict';
import { digestBytes } from './primitives.mjs';
import { readAuthoring, composeAuthoring, reconcileAuthoring, freshAuthoring, editAuthoring } from './headless.mjs';
import { describeAuthoringSubject } from './review-bindings.mjs';
import { composeIntent, indexReleases, freshIntent } from './saved-intent.mjs';
import { composeSetup } from './setup.mjs';
import { fixtureRelease, fixtureItem, rootFor, crossRef } from './intent-fixtures.mjs';
import { noteFixture, NOTE_SOURCE_REVISION } from './note-fixture.mjs';
import { intakeDeclaration } from './intake.mjs';
import { readInstalledRelease } from '@aihq/catalog/node';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const encode = value => new TextEncoder().encode(value);
export async function mixedInventories() {
  const maintained = await readInstalledRelease({ root: dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'))), sourceInput: 'maintained' });
  assert.equal(maintained.valid, true);
  const { declarationBytes, sourceFiles } = await noteFixture();
  const declarationSha = await digestBytes(declarationBytes);
  const input = { id: 'notes', kind: 'local', locator: { input: 'notes' }, resolvedIdentity: { sha256: declarationSha } };
  const notes = await intakeDeclaration({ input, declarationBytes, sourceFiles, materialSource: { kind: 'local', input: 'notes' } });
  assert.equal(notes.status, 'ok', JSON.stringify(notes.diagnostics));
  return [{ release: maintained.release, materialSource: maintained.source }, notes.value];
}
test('independent supplied declaration composes beside maintained content and freshly reopens', async () => {
  const inventories = await mixedInventories();
  const note = inventories[1].release.items[0];
  const intent = freshAuthoring();
  intent.roots.push({ releaseSha256: inventories[1].release.sha256, itemId: note.id, itemSha256: note.itemSha256, scope: 'project', configuration: {}, originIds: ['direct'] });
  const result = await composeAuthoring({ intent, inventories });
  assert.equal(result.status, 'ok', JSON.stringify(result.diagnostics));
  assert.equal(result.value.intent.pins.length, 4);
  assert.equal(result.value.intent.inputs[0].locator.input, 'notes');
  const reopened = await readAuthoring({ policyBytes: result.value.policyBytes, inventories });
  assert.equal(reopened.value.editing, 'available', JSON.stringify(reopened.value.diagnostics));
  assert.deepEqual(reopened.value.intent, result.value.intent);
});

test('valid execution remains available and exact CRLF original survives unsupported authoring', async () => {
  const policyBytes = new TextEncoder().encode('{\r\n"schema":"urn:aihq:core:execution-policy:1.3.0","mode":"vibe","selections":[],"metadata":{"aih.workbench":{"schema":"future"}}\r\n}\r\n');
  const result = await readAuthoring({ policyBytes, inventories: [] });
  assert.equal(result.status, 'ok');
  assert.equal(result.value.editing, 'unavailable');
  assert.deepEqual(result.value.originalBytes, policyBytes);
  assert.equal(result.value.diagnostics[0].code, 'INTENT_VERSION_UNSUPPORTED');
  const edit = await composeAuthoring({ basePolicyBytes: policyBytes, intent: freshAuthoring(), inventories: [] });
  assert.equal(edit.status, 'refused');
  assert.deepEqual(edit.originalBytes, policyBytes);
});
test('v2 explicit origins migrate with CRLF originals and contradictory projections refuse editing', async () => {
  const inventories = await mixedInventories();
  const intent = freshIntent(), entry = inventories[0], item = entry.release.items.find(i => i.id === 'mattpocock.grill-with-docs');
  intent.roots.push({ releaseSha256: entry.release.sha256, itemId: item.id, itemSha256: item.itemSha256, scope: 'project', configuration: {}, originIds: ['direct'] });
  const old = composeIntent({ index: indexReleases(inventories), intent, capture: true });
  assert.equal(old.valid, true);
  const policyBytes = encode(JSON.stringify(old.policy, null, 2).replaceAll('\n', '\r\n') + '\r\n');
  const read = await readAuthoring({ policyBytes, inventories });
  assert.equal(read.value.editing, 'available', JSON.stringify(read.value.diagnostics));
  assert.equal(read.value.intent.schema, freshAuthoring().schema);
  assert.deepEqual(read.value.originalBytes, policyBytes);
  assert.deepEqual(read.value.intent.origins, [{ id: 'direct', kind: 'direct' }]);
  assert.deepEqual(read.value.intent.reviews.records, []);
  const wrong = structuredClone(old.policy);
  wrong.selections[0].configuration.unrecorded = true;
  const contradictory = await readAuthoring({ policyBytes: encode(JSON.stringify(wrong)), inventories });
  assert.equal(contradictory.value.editing, 'unavailable');
  assert.equal(contradictory.value.diagnostics[0].code, 'INTENT_POLICY_CONTRADICTION');
});
test('missing exact revision does not silently use a candidate; reconciliation retains original', async () => {
  const inventories = await mixedInventories(), intent = freshAuthoring(), item = inventories[1].release.items[0];
  intent.roots.push({ releaseSha256: inventories[1].release.sha256, itemId: item.id, itemSha256: item.itemSha256, scope: 'project', configuration: {}, originIds: ['direct'] });
  const saved = await composeAuthoring({ intent, inventories });
  const read = await readAuthoring({ policyBytes: saved.value.policyBytes, inventories: [inventories[0]] });
  // Source unavailability keeps every exact choice as unresolved; nothing is dropped or substituted.
  assert.equal(read.value.editing, 'unresolved');
  assert.equal(read.value.diagnostics[0].code, 'SOURCE_REVISION_UNAVAILABLE');
  assert.deepEqual(read.value.intent, saved.value.intent);
  assert.deepEqual(read.value.originalBytes, saved.value.policyBytes);
  assert.deepEqual(read.value.unresolved.map(u => [u.kind, u.ref.itemId, u.reason]), [['root', item.id, 'source-unavailable'], ['input', undefined, 'source-unavailable']]);
  assert.equal(read.value.roots[0].status, 'unresolved');
  const reconciliation = await reconcileAuthoring({ savedPolicyBytes: saved.value.policyBytes, inventories, candidateInventories: [inventories[0]] });
  assert.equal(reconciliation.value.status, 'needs-decisions');
  assert.equal(reconciliation.value.affectedRoots.length, 1);
  assert.deepEqual(reconciliation.originalBytes, saved.value.policyBytes);
});
test('removing one origin preserves shared ownership; Keep makes an orphan a direct root', async () => {
  const inventories = await mixedInventories(), intent = freshAuthoring(), entry = inventories[1], item = entry.release.items[0];
  intent.origins.push({ id: 'team', kind: 'organization', organizationPolicySha256: 'a'.repeat(64), organizationSelectionId: 'notes' });
  intent.roots.push({ releaseSha256: entry.release.sha256, itemId: item.id, itemSha256: item.itemSha256, scope: 'project', configuration: {}, originIds: ['direct', 'team'] });
  const saved = await composeAuthoring({ intent, inventories });
  const removed = await editAuthoring({ policyBytes: saved.value.policyBytes, inventories, operation: { type: 'remove-origin', originId: 'team' } });
  assert.equal(removed.status, 'ok');
  assert.deepEqual(removed.value.intent.roots[0].originIds, ['direct']);
  assert.equal(removed.value.intent.pins.length, 4);
  const maintained = inventories[0], dependency = maintained.release.items.find(i => i.id === 'mattpocock.domain-modeling');
  const kept = await editAuthoring({ policyBytes: removed.value.policyBytes, inventories, operation: { type: 'remove-origin', originId: 'direct', keep: [{ releaseSha256: maintained.release.sha256, itemId: dependency.id, scope: 'project' }] } });
  assert.equal(kept.status, 'ok', JSON.stringify(kept.diagnostics));
  assert.equal(kept.value.intent.roots.length, 1);
  assert.deepEqual(kept.value.intent.roots[0].originIds, ['direct']);
  assert.equal(kept.value.intent.roots[0].itemId, 'mattpocock.domain-modeling');
});
test('known policy evidence/lifecycle and metadata survive, unknown intent semantics refuse', async () => {
  const inventories = await mixedInventories();
  const saved = await composeAuthoring({ intent: freshAuthoring(), inventories });
  const policy = JSON.parse(new TextDecoder().decode(saved.value.policyBytes));
  policy.metadata.note = { preserved: 'unrelated' };
  policy.evidence = [];
  policy.managedSelections = [];
  policy.removals = [{ managementId: 'retired', scope: 'project' }];
  const originalBytes = encode(JSON.stringify(policy, null, 2).replaceAll('\n', '\r\n'));
  const edited = await composeAuthoring({ basePolicyBytes: originalBytes, intent: saved.value.intent, inventories });
  assert.equal(edited.status, 'ok', JSON.stringify(edited.diagnostics));
  const output = JSON.parse(new TextDecoder().decode(edited.value.policyBytes));
  assert.deepEqual(output.removals, policy.removals);
  assert.deepEqual(output.evidence, []);
  assert.deepEqual(output.metadata.note, { preserved: 'unrelated' });
  policy.metadata['aih.workbench'].overlay = { unsafe: true };
  const unknownBytes = encode(JSON.stringify(policy));
  const read = await readAuthoring({ policyBytes: unknownBytes, inventories });
  assert.equal(read.value.editing, 'unavailable');
  const refused = await composeAuthoring({ basePolicyBytes: unknownBytes, intent: saved.value.intent, inventories });
  assert.equal(refused.status, 'refused');
  assert.deepEqual(refused.originalBytes, unknownBytes);
});
test('local, Git, npm and organization snapshots require exact declaration identities and source bytes', async () => {
  const inventories = await mixedInventories(), original = inventories[1];
  const declarationBytes = original.declarationBytes, sha256 = await digestBytes(declarationBytes);
  const { sourceFiles } = await noteFixture();
  const archiveBytes = encode('Synthetic acquired package envelope for integrity refusal/acceptance tests.'), integrity = `sha256-${Buffer.from(await crypto.subtle.digest('SHA-256', archiveBytes)).toString('base64')}`;
  const records = [
    { id: 'local', kind: 'local', locator: { input: 'notes' }, resolvedIdentity: { sha256 } },
    { id: 'git', kind: 'git', locator: { repository: 'samartomar/aih-ui', ref: 'main' }, resolvedIdentity: { revision: NOTE_SOURCE_REVISION, sha256 } },
    { id: 'npm', kind: 'npm', locator: { name: '@example/notes', range: '^1.0.0' }, resolvedIdentity: { version: '1.0.0', integrity, sha256 } },
    { id: 'organization', kind: 'organization', locator: { authorityId: 'team', sourceId: 'notes' }, resolvedIdentity: { revision: NOTE_SOURCE_REVISION, sha256 } }
  ];
  for (const input of records) {
    const args = { input, declarationBytes, sourceFiles, materialSource: { kind: 'local', input: 'notes' }, archiveBytes };
    const accepted = await intakeDeclaration(args);
    assert.equal(accepted.status, 'ok', JSON.stringify(accepted.diagnostics));
    assert.equal(accepted.value.input.releaseSha256, original.release.sha256);
    const mismatch = await intakeDeclaration({ ...args, input: { ...input, resolvedIdentity: { ...input.resolvedIdentity, sha256: '0'.repeat(64) } } });
    assert.equal(mismatch.status, 'refused');
    const missing = await intakeDeclaration({ ...args, sourceFiles: [{ source: 'notes', revision: NOTE_SOURCE_REVISION, files: {} }] });
    assert.equal(missing.status, 'refused');
  }
  assert.equal((await intakeDeclaration({ input: { ...records[0], locator: { input: 'D:/untrusted' } }, declarationBytes })).status, 'refused');
  const subject = await describeAuthoringSubject({ inventory: original, itemId: 'consumer-proof.review-note' });
  assert.equal(subject.status, 'ok', JSON.stringify(subject.diagnostics));
  assert.equal(subject.value.materials.length, 2);
});
test('review history is preserved without inventing current evidence decisions', async () => {
  const inventories = await mixedInventories(), intent = freshAuthoring(), entry = inventories[1], item = entry.release.items[0];
  intent.roots.push({ releaseSha256: entry.release.sha256, itemId: item.id, itemSha256: item.itemSha256, scope: 'project', configuration: {}, originIds: ['direct'] });
  const subject = await describeAuthoringSubject({ inventory: entry, itemId: item.id });
  const record = { id: 'historical', owner: { kind: 'individual', id: 'fixture-owner' }, actor: 'fixture-actor', recordedAt: '2026-10-13T12:00:00Z', disposition: 'accepted-risk', reason: 'Synthetic preservation fixture; no current decision claimed.', subject: subject.value,
    finding: { detectorId: 'synthetic', ruleId: 'synthetic', findingId: 'synthetic' }, evidence: Object.fromEntries(['observationIdentity', 'detectorIdentity', 'rulesIdentity', 'configurationIdentity', 'profileIdentity', 'scopeIdentity', 'coverageIdentity'].map(key => [key, `synthetic-${key}`])), state: 'reconsider' };
  intent.reviews.history.push(record);
  const saved = await composeAuthoring({ intent, inventories });
  assert.equal(saved.status, 'ok', JSON.stringify(saved.diagnostics));
  const edited = await editAuthoring({ policyBytes: saved.value.policyBytes, inventories, operation: { type: 'remove-origin', originId: 'direct' } });
  assert.equal(edited.status, 'ok');
  assert.deepEqual(edited.value.intent.reviews.history, [record]);
  const forged = structuredClone(saved.value.intent); forged.reviews.records.push({ ...record, id: 'current', state: 'current' });
  const refused = await composeAuthoring({ basePolicyBytes: saved.value.policyBytes, intent: forged, inventories });
  assert.equal(refused.status, 'refused'); assert.equal(refused.diagnostics[0].code, 'REVIEW_BINDING_UNAVAILABLE');
  const policy = JSON.parse(new TextDecoder().decode(saved.value.policyBytes)); policy.metadata['aih.workbench'] = forged;
  const originalBytes = encode(JSON.stringify(policy));
  const reopened = await readAuthoring({ policyBytes: originalBytes, inventories });
  // #24: an unverifiable historical judgment no longer makes the saved policy uneditable; it is reported as unverified and imported.
  assert.equal(reopened.value.editing, 'available'); assert.deepEqual(reopened.value.diagnostics, []);
  assert.equal(reopened.value.reviewJudgments[0].applicability, 'unverified'); assert.equal(reopened.value.reviewJudgments[0].applicabilityReason, 'evidence-not-supplied');
  assert.equal(reopened.value.reviewJudgments[0].origin, 'imported');
  assert.deepEqual(reopened.value.originalBytes, originalBytes);
});
test('malformed/oversized authoring and serialized reader handles refuse without partial policies', async () => {
  const malformed = freshAuthoring(); malformed.roots = [null];
  assert.equal((await composeAuthoring({ intent: malformed, inventories: [] })).status, 'refused');
  const oversized = freshAuthoring(); oversized.roots.push({ reason: 'x'.repeat(850_000) });
  const bound = await composeAuthoring({ intent: oversized, inventories: [] });
  assert.equal(bound.diagnostics[0].code, 'POLICY_BOUND_EXCEEDED'); assert.equal(bound.value, undefined);
  const inventories = await mixedInventories();
  const cloned = inventories.map(entry => ({ ...entry, release: JSON.parse(JSON.stringify(entry.release)) }));
  const refused = await composeAuthoring({ intent: freshAuthoring(), inventories: cloned });
  assert.equal(refused.status, 'refused'); assert.equal(refused.diagnostics[0].code, 'SOURCE_IDENTITY_MISMATCH');
});
test('v1 explicit roots migrate with original CRLF bytes and no invented template ownership', async () => {
  const inventories = await mixedInventories(), entry = inventories[0];
  const old = composeSetup({ release: entry.release, materialSource: entry.materialSource, roots: [{ itemId: 'mattpocock.grill-with-docs', scope: 'project', configuration: {} }], excludedItemIds: ['mattpocock.code-review'] });
  assert.equal(old.valid, true);
  const policyBytes = encode(JSON.stringify(old.policy, null, 2).replaceAll('\n', '\r\n'));
  const migrated = await readAuthoring({ policyBytes, inventories });
  assert.equal(migrated.value.editing, 'available', JSON.stringify(migrated.value.diagnostics));
  assert.deepEqual(migrated.value.originalBytes, policyBytes);
  assert.equal(migrated.value.intent.pins.length, 3);
  assert.deepEqual(migrated.value.intent.origins, [{ id: 'direct', kind: 'direct' }]);
  assert.equal(migrated.value.intent.exclusions[0].itemId, 'mattpocock.code-review');
  const updated = await composeAuthoring({ basePolicyBytes: policyBytes, intent: migrated.value.intent, inventories });
  assert.equal(updated.status, 'ok');
  assert.equal((await readAuthoring({ policyBytes: updated.value.policyBytes, inventories })).value.editing, 'available');
});
test('labelled synthetic required/optional/collision fixtures use public Catalog resolution', async () => {
  const entry = fixtureRelease('synthetic-relations', [fixtureItem('base'), fixtureItem('conflict', { conflicts: [{ itemId: 'root' }] }), fixtureItem('extra'), fixtureItem('root', { requires: [{ itemId: 'base' }], optional: [{ itemId: 'extra' }] })]);
  const intent = freshAuthoring(); intent.roots.push(rootFor(entry, 'root')); intent.exclusions.push({ originId: 'direct', releaseSha256: entry.release.sha256, itemId: 'extra', scope: 'project' });
  const saved = await composeAuthoring({ intent, inventories: [entry] });
  assert.equal(saved.status, 'ok'); assert.equal(saved.value.intent.pins.length, 2); assert.equal(saved.value.optional[0].skipped, true);
  const reopened = await readAuthoring({ policyBytes: saved.value.policyBytes, inventories: [entry] });
  assert.equal(reopened.value.intent.exclusions[0].itemId, 'extra');
  const requiredSkip = structuredClone(intent); requiredSkip.exclusions[0].itemId = 'base';
  assert.equal((await composeAuthoring({ intent: requiredSkip, inventories: [entry] })).diagnostics[0].code, 'REQUIRED_ITEM_SKIPPED');
  const collision = structuredClone(intent); collision.roots.push(rootFor(entry, 'conflict'));
  assert.equal((await composeAuthoring({ intent: collision, inventories: [entry] })).diagnostics[0].code, 'ITEM_CONFLICT');
  assert.throws(() => fixtureRelease('synthetic-cycle', [fixtureItem('a', { requires: [{ itemId: 'b' }] }), fixtureItem('b', { requires: [{ itemId: 'a' }] })]), /dependency-cycle/);
});
test('v2 exclusions with unknown semantics or contradictory item identity refuse migration and preserve originals', async () => {
  const inventories = await mixedInventories(), entry = inventories[0], oldIntent = freshIntent();
  oldIntent.roots.push(rootFor(entry, 'mattpocock.grill-with-docs'));
  const item = entry.release.items.find(i => i.id === 'mattpocock.code-review');
  oldIntent.exclusions.push({ releaseSha256: entry.release.sha256, itemId: item.id, itemSha256: item.itemSha256, originIds: ['direct'] });
  const old = composeIntent({ index: indexReleases(inventories), intent: oldIntent, capture: true }); assert.equal(old.valid, true);
  for (const mutation of [{ futureSemantics: { denyExecution: true } }, { itemSha256: '0'.repeat(64) }]) {
    const policy = structuredClone(old.policy); Object.assign(policy.metadata['aih.workbench'].exclusions[0], mutation);
    const policyBytes = encode(JSON.stringify(policy, null, 2).replaceAll('\n', '\r\n'));
    const read = await readAuthoring({ policyBytes, inventories });
    assert.equal(read.value.editing, 'unavailable'); assert.deepEqual(read.value.originalBytes, policyBytes);
    const result = await composeAuthoring({ basePolicyBytes: policyBytes, intent: freshAuthoring(), inventories });
    assert.equal(result.status, 'refused'); assert.deepEqual(result.originalBytes, policyBytes);
  }
});
test('missing excluded optional source and changed material bindings require reconciliation decisions', async () => {
  const optional = fixtureRelease('synthetic-optional', [fixtureItem('extra')]);
  const main = fixtureRelease('synthetic-main', [fixtureItem('root', { optional: [crossRef(optional, 'extra')] })]);
  const intent = freshAuthoring(); intent.roots.push(rootFor(main, 'root')); intent.exclusions.push({ originId: 'direct', releaseSha256: optional.release.sha256, itemId: 'extra', scope: 'project' });
  const inventories = [main, optional], saved = await composeAuthoring({ intent, inventories }); assert.equal(saved.status, 'ok');
  const missing = await reconcileAuthoring({ savedPolicyBytes: saved.value.policyBytes, inventories, candidateInventories: [main] });
  assert.equal(missing.value.status, 'needs-decisions'); assert.equal(missing.value.affectedRoots.length, 1);
  assert.equal(missing.value.choices[0].affectedItems[0].itemId, 'extra');
  const changed = await reconcileAuthoring({ savedPolicyBytes: saved.value.policyBytes, inventories, candidateInventories: [{ ...main, materialSource: { kind: 'local', input: 'changed-binding' } }, optional] });
  assert.equal(changed.value.status, 'needs-decisions');
});
test('trimmed template retains source provenance and rootless missing origin requires a decision', async () => {
  const entry = fixtureRelease('synthetic-template', [fixtureItem('root')]);
  entry.templates = [{ id: 'starter', sha256: 'a'.repeat(64), roots: [rootFor(entry, 'root')] }];
  const intent = freshAuthoring(); intent.origins.push({ id: 'template', kind: 'template', releaseSha256: entry.release.sha256, templateId: 'starter', templateSha256: 'a'.repeat(64) });
  const saved = await composeAuthoring({ intent, inventories: [entry] }); assert.equal(saved.status, 'ok');
  assert.equal(saved.value.intent.provenance[0].releaseSha256, entry.release.sha256);
  const result = await reconcileAuthoring({ savedPolicyBytes: saved.value.policyBytes, inventories: [entry], candidateInventories: [] });
  assert.equal(result.value.status, 'needs-decisions'); assert.equal(result.value.choices[0].origin.id, 'template');
  const removed = await editAuthoring({ policyBytes: saved.value.policyBytes, inventories: [entry], operation: { type: 'remove-origin', originId: 'template' } });
  assert.equal(removed.status, 'ok'); assert.deepEqual(removed.value.intent.provenance, []);
});
test('v2 trimmed template validates frozen old provenance before adding v3 template-source provenance', async () => {
  const entry = fixtureRelease('synthetic-template-migration', [fixtureItem('root')]);
  entry.templates = [{ id: 'starter', sha256: 'a'.repeat(64), roots: [] }];
  const intent = freshIntent(); intent.origins.push({ id: 'template', kind: 'template', templateId: 'starter', templateSha256: 'a'.repeat(64) });
  const old = composeIntent({ index: indexReleases([entry]), templates: entry.templates, intent, capture: true }); assert.equal(old.valid, true); assert.deepEqual(old.intent.provenance, []);
  const policyBytes = encode(JSON.stringify(old.policy, null, 2).replaceAll('\n', '\r\n'));
  const migrated = await readAuthoring({ policyBytes, inventories: [entry] });
  assert.equal(migrated.value.editing, 'available', JSON.stringify(migrated.value.diagnostics));
  assert.deepEqual(migrated.value.originalBytes, policyBytes); assert.equal(migrated.value.intent.provenance[0].releaseSha256, entry.release.sha256);
  const wrong = structuredClone(old.policy); wrong.metadata['aih.workbench'].provenance.push({ releaseSha256: entry.release.sha256, package: entry.release.package, sources: entry.release.sources, materialSource: entry.materialSource });
  const refused = await readAuthoring({ policyBytes: encode(JSON.stringify(wrong)), inventories: [entry] });
  assert.equal(refused.value.editing, 'unavailable'); assert.equal(refused.value.diagnostics[0].code, 'INTENT_POLICY_CONTRADICTION');
});
