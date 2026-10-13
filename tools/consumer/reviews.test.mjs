import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInstalledRelease } from '@aihq/catalog/node';
import { runScan, prepareArtifact, createRetainedObservationsV1 } from '@aihq/scan/host';
import { signArtifact, authenticateArtifact } from '@aihq/scan/host';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { intakeDeclaration, digestBytes } from './intake.mjs';
import { noteFixture } from './note-fixture.mjs';
import * as authoring from './headless.mjs';
import { inspectAuthenticatedReviewEvidence } from './review-host.mjs';
const encode = value => new TextEncoder().encode(JSON.stringify(value));
export async function reviewFixture({ configured = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ui5-review-'));
  const snapshot = await noteFixture();
  if (configured) {
    // Labelled synthetic producer variation. This changes configuration data,
    // not an assertion about the pinned real repository fixture.
    const declaration = JSON.parse(new TextDecoder().decode(snapshot.declarationBytes));
    const recipePath = declaration.items[0].recipePath, recipe = JSON.parse(new TextDecoder().decode(snapshot.sourceFiles[0].files[recipePath]));
    recipe.inputs = { directory: { type: 'string', required: true } };
    declaration.items[0].configuration = recipe.inputs;
    declaration.sources[0].repository = 'fixture/configured-notes';
    snapshot.sourceFiles[0].revision = 'a'.repeat(40);
    snapshot.sourceFiles[0].files[recipePath] = encode(recipe);
    snapshot.declarationBytes = encode(declaration);
  }
  const input = { id: 'notes', kind: 'local', locator: { input: 'notes' }, resolvedIdentity: { sha256: await digestBytes(snapshot.declarationBytes) } };
  const intake = await intakeDeclaration({ ...snapshot, input, materialSource: { kind: 'local', input: 'notes' } });
  assert.equal(intake.status, 'ok');
  const inventory = intake.value, item = inventory.release.items[0], intent = authoring.freshAuthoring();
  intent.roots.push({ releaseSha256: inventory.release.sha256, itemId: item.id, itemSha256: item.itemSha256, scope: 'project', configuration: configured ? { directory: 'chosen' } : {}, originIds: ['direct'] });
  const maintained = await readInstalledRelease({ root: dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'))), sourceInput: 'maintained' });
  assert.equal(maintained.valid, true);
  const inventories = [{ release: maintained.release, materialSource: maintained.source }, inventory];
  const saved = await authoring.composeAuthoring({ intent, inventories });
  assert.equal(saved.status, 'ok', JSON.stringify(saved.diagnostics));
  for (const material of inventory.materials) {
    const path = join(root, material.path);
    await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, material.bytes);
  }
  const retained = createRetainedObservationsV1();
  const request = { schema: 'urn:aihq:scan:request:1.0.0', source: { kind: 'local', path: root }, selection: { paths: inventory.materials.map(m => m.path).sort(), excludedPaths: [] }, detectors: [{ detectorId: 'detector.aih-binding-gate', configuration: {} }] };
  const scan = async (overrides = {}, options = {}) => {
    const result = await runScan({ ...request, ...overrides }, { retained, ...options });
    assert.equal(result.status, 'assessment', JSON.stringify(result));
    const artifact = await prepareArtifact({ report: result.report, annexes: result.annexes.map(a => ({ id: a.id, bytes: Buffer.from(a.bytesBase64, 'base64') })) });
    return { ...result, bytes: artifact.bytes };
  };
  return { root, inventory, inventories, item, saved, scan, retained, cleanup: () => rm(root, { recursive: true, force: true }) };
}
export const decision = { id: 'decision-1', owner: { kind: 'organization', id: 'team' }, actor: 'reviewer', recordedAt: '2026-10-13T18:00:00Z', disposition: 'false-alarm', reason: 'Fixture review: deliberately lacks a license declaration.' };
async function recorded(f, evidence) {
  const inspected = await authoring.inspectReviewEvidence({ evidenceBytes: evidence.bytes, inventory: f.inventory, itemId: f.item.id });
  assert.equal(inspected.status, 'ok', JSON.stringify(inspected.diagnostics));
  const result = await authoring.recordReview({ policyBytes: f.saved.value.policyBytes, inventories: f.inventories, evidenceBytes: evidence.bytes, target: { releaseSha256: f.inventory.release.sha256, itemId: f.item.id }, finding: inspected.value.bindings[0].finding, decision });
  assert.equal(result.status, 'ok', JSON.stringify(result.diagnostics)); return result;
}
async function newNoteRelease(f, variant = 'current') {
  const snapshot = await noteFixture(variant), declaration = JSON.parse(new TextDecoder().decode(snapshot.declarationBytes));
  declaration.package.version = '1.0.1';
  const declarationBytes = encode(declaration);
  const result = await intakeDeclaration({ declarationBytes, sourceFiles: snapshot.sourceFiles, materialSource: f.inventory.materialSource,
    input: { ...f.inventory.input, id: 'notes-next', resolvedIdentity: { sha256: await digestBytes(declarationBytes) } } });
  assert.equal(result.status, 'ok'); return result.value;
}
test('checked finding decision round-trips with original subject and exact review-v1 fields', async () => {
  const f = await reviewFixture();
  try {
    const evidence = await f.scan();
    const inspected = await authoring.inspectReviewEvidence({ evidenceBytes: evidence.bytes, inventory: f.inventory, itemId: f.item.id });
    assert.equal(inspected.status, 'ok');
    assert.equal(inspected.value.producerAuthentication, 'unchecked');
    assert.equal(inspected.value.sourceAssociation, 'matched');
    const result = await authoring.recordReview({ policyBytes: f.saved.value.policyBytes, inventories: f.inventories, evidenceBytes: evidence.bytes, target: { releaseSha256: f.inventory.release.sha256, itemId: f.item.id }, finding: inspected.value.bindings[0].finding, decision });
    assert.equal(result.status, 'ok', JSON.stringify(result.diagnostics));
    const reopened = await authoring.readAuthoring({ policyBytes: result.value.policyBytes, inventories: f.inventories, reviewEvidence: [evidence.bytes] });
    assert.equal(reopened.value.editing, 'available', JSON.stringify(reopened.value.diagnostics));
    const record = reopened.value.intent.reviews.records[0];
    assert.equal(reopened.value.intent.reviews.schema, 'urn:aihq:workbench:review-decisions:1.0.0');
    assert.deepEqual(record.owner, decision.owner); assert.equal(record.disposition, 'false-alarm');
    assert.deepEqual(record.subject, inspected.value.subject);
    assert.deepEqual(record.evidence, inspected.value.bindings[0].evidence);
    assert.equal(record.state, 'current');
  } finally { await f.cleanup(); }
});
test('unrelated report changes retain exact decisions; trimming reviewed content retains history and requests reconsideration', async () => {
  const f = await reviewFixture();
  try {
    const first = await f.scan(), saved = await recorded(f, first);
    await writeFile(join(f.root, 'outside-selection.md'), '# Unrelated source container change\n');
    const next = await f.scan();
    assert.notEqual(first.scanId, next.scanId);
    assert.equal(next.report.results[0].observations[0].origin, 'reused');
    assert.equal(first.report.results[0].observations[0].observationId, next.report.results[0].observations[0].observationId);
    const reopened = await authoring.readAuthoring({ policyBytes: saved.value.policyBytes, inventories: f.inventories, reviewEvidence: [next.bytes] });
    assert.equal(reopened.value.editing, 'available');
    assert.deepEqual(reopened.value.intent.reviews, saved.value.intent.reviews);
    const trimmed = await authoring.editAuthoring({ policyBytes: saved.value.policyBytes, inventories: f.inventories, reviewEvidence: [next.bytes], operation: { type: 'remove-root', root: saved.value.intent.roots[0] } });
    assert.equal(trimmed.status, 'ok', JSON.stringify(trimmed.diagnostics));
    assert.equal(trimmed.value.intent.reviews.records[0].state, 'reconsider');
    assert.deepEqual(trimmed.value.intent.reviews.history, saved.value.intent.reviews.records);
    assert.deepEqual(trimmed.value.intent.reviews.records[0].subject, saved.value.intent.reviews.records[0].subject);
  } finally { await f.cleanup(); }
});
test('changed detector scope requires reconsideration, preserves history and supports explicit supersession', async () => {
  const f = await reviewFixture();
  try {
    const first = await f.scan(), saved = await recorded(f, first);
    await writeFile(join(f.root, 'additional-covered.md'), '# Changed detector scope\n');
    const changed = await f.scan({ selection: { paths: 'all', excludedPaths: [] } });
    const read = await authoring.readAuthoring({ policyBytes: saved.value.policyBytes, inventories: f.inventories, reviewEvidence: [changed.bytes] });
    assert.equal(read.value.editing, 'unavailable');
    assert.equal(read.value.diagnostics[0].code, 'REVIEW_RECONSIDER_REQUIRED');
    assert.deepEqual(read.value.originalBytes, saved.value.policyBytes);
    const reconsidered = await authoring.reconsiderReviews({ policyBytes: saved.value.policyBytes, inventories: f.inventories, reviewEvidence: [changed.bytes] });
    assert.equal(reconsidered.status, 'ok');
    assert.deepEqual(reconsidered.value.intent.reviews.history, saved.value.intent.reviews.records);
    const inspected = await authoring.inspectReviewEvidence({ evidenceBytes: changed.bytes, inventory: f.inventory, itemId: f.item.id });
    const replacement = await authoring.recordReview({ policyBytes: reconsidered.value.policyBytes, inventories: f.inventories, evidenceBytes: changed.bytes, target: { releaseSha256: f.inventory.release.sha256, itemId: f.item.id }, finding: inspected.value.bindings[0].finding,
      decision: { ...decision, id: 'decision-2', disposition: 'accepted-risk', supersedes: reconsidered.value.intent.reviews.records[0].id, reason: 'Changed fixture configuration explicitly reviewed.' } });
    assert.equal(replacement.status, 'ok', JSON.stringify(replacement.diagnostics));
    assert.equal(replacement.value.intent.reviews.records[0].disposition, 'accepted-risk');
    assert.equal(replacement.value.intent.reviews.history.length, 2);
    assert.deepEqual(replacement.value.intent.reviews.history[0], saved.value.intent.reviews.records[0]);
  } finally { await f.cleanup(); }
});
test('missing evidence preserves executable policy and originals; field/version/binding violations refuse without partial artifacts', async () => {
  const f = await reviewFixture();
  try {
    const evidence = await f.scan(), saved = await recorded(f, evidence);
    const missing = await authoring.readAuthoring({ policyBytes: saved.value.policyBytes, inventories: f.inventories });
    assert.equal(missing.status, 'ok'); assert.equal(missing.value.policy.mode, 'vibe');
    assert.equal(missing.value.diagnostics[0].code, 'REVIEW_BINDING_UNAVAILABLE');
    assert.deepEqual(missing.value.originalBytes, saved.value.policyBytes);
    const record = saved.value.intent.reviews.records[0];
    for (const field of Object.keys(record.evidence)) {
      const policy = JSON.parse(new TextDecoder().decode(saved.value.policyBytes));
      policy.metadata['aih.workbench'].reviews.records[0].evidence[field] = 'incomparable';
      const read = await authoring.readAuthoring({ policyBytes: encode(policy), inventories: f.inventories, reviewEvidence: [evidence.bytes] });
      assert.equal(read.value.editing, 'unavailable', field);
      assert.equal(read.value.diagnostics[0].code, 'REVIEW_RECONSIDER_REQUIRED', field);
    }
    const unsupported = structuredClone(saved.value.intent); unsupported.reviews.schema = 'urn:aihq:workbench:review-decisions:1.1.0';
    const refused = await authoring.composeAuthoring({ basePolicyBytes: saved.value.policyBytes, intent: unsupported, inventories: f.inventories, reviewEvidence: [evidence.bytes] });
    assert.equal(refused.status, 'refused'); assert.equal(refused.value, undefined);
    assert.equal(refused.diagnostics[0].code, 'INTENT_VERSION_UNSUPPORTED');
    assert.deepEqual(refused.originalBytes, saved.value.policyBytes);
    const inspected = await authoring.inspectReviewEvidence({ evidenceBytes: evidence.bytes, inventory: f.inventory, itemId: f.item.id });
    for (const bad of [{ owner: {kind: 'provider', id: 'scan'} }, { recordedAt: '2026-02-30T18:00:00Z' }, { recordedAt: '2026-10-13T18:00:00-05:00' }, { actor: '' }, { reason: '' }, { disposition: 'approved' }, { supersedes: 'unknown' }]) {
      const result = await authoring.recordReview({ policyBytes: f.saved.value.policyBytes, inventories: f.inventories, evidenceBytes: evidence.bytes, target: record.subject, finding: inspected.value.bindings[0].finding, decision: { ...decision, ...bad } });
      assert.equal(result.status, 'refused', JSON.stringify(bad)); assert.equal(result.value, undefined);
    }
    for (const reviewEvidence of [null, [null], [{}], Array(33).fill(evidence.bytes)]) {
      const result = await authoring.recordReview({ policyBytes: f.saved.value.policyBytes, inventories: f.inventories, evidenceBytes: evidence.bytes, target: record.subject, finding: inspected.value.bindings[0].finding, decision, reviewEvidence });
      assert.equal(result.status, 'refused'); assert.equal(result.diagnostics[0].code, 'REVIEW_BINDING_UNAVAILABLE');
    }
    assert.equal((await authoring.inspectReviewEvidence({ evidenceBytes: evidence.bytes, inventory: JSON.parse(JSON.stringify(f.inventory)), itemId: f.item.id })).status, 'refused');
  } finally { await f.cleanup(); }
});
test('real retained/authenticated built-in artifact custody differs from cloned JSON; fixture signatures do not authenticate humans', async () => {
  const f = await reviewFixture();
  try {
    const first = await f.scan();
    const clone = await f.scan({}, { retained: JSON.parse(JSON.stringify(f.retained)) });
    assert.equal(clone.report.results[0].observations[0].origin, 'fresh');
    assert(clone.report.results[0].diagnostics.some(d => d.code === 'reuse-miss'));
    const own = await f.scan();
    assert.equal(own.report.results[0].observations[0].origin, 'reused');
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const spki = publicKey.export({ type: 'spki', format: 'der' }), keyId = 'ed25519:' + createHash('sha256').update(spki).digest('hex');
    const trust = { keys: [{ identity: 'ui5-ephemeral-fixture', keyId, publicKeySpkiBase64: spki.toString('base64') }], publishers: [] };
    const signed = await signArtifact({ report: first.report, annexes: first.annexes.map(a => ({ id: a.id, bytes: Buffer.from(a.bytesBase64, 'base64') })), signer: { keyId, privateKey } });
    const authenticated = await authenticateArtifact({ bytes: signed.bytes, expectedScanId: signed.scanId, trust });
    assert.equal(authenticated.status, 'authenticated');
    const authenticatedView = await inspectAuthenticatedReviewEvidence({ evidenceBytes: signed.bytes, inventory: f.inventory, itemId: f.item.id, trust, expectedScanId: signed.scanId });
    assert.equal(authenticatedView.value.producerAuthentication.status, 'authenticated');
    assert.equal(authenticatedView.value.sourceAssociation, 'matched');
    const unknownTrust = await authenticateArtifact({ bytes: signed.bytes, expectedScanId: signed.scanId, trust: { keys: [], publishers: [] } });
    assert.equal(unknownTrust.status, 'unverifiable');
    const invalid = JSON.parse(new TextDecoder().decode(signed.bytes)); invalid.attestation.dsseEnvelope.signatures[0].sig = Buffer.alloc(64).toString('base64');
    const invalidSignature = await authenticateArtifact({ bytes: encode(invalid), expectedScanId: signed.scanId, trust });
    const unsigned = await authenticateArtifact({ bytes: first.bytes, expectedScanId: first.scanId, trust });
    assert.equal(invalidSignature.status, 'unverifiable'); assert.equal(unsigned.reason, 'unsigned');
    // Retained artifact lives outside the source closure, so reuse compares the
    // original source. Only public host acquisition/authentication grants custody.
    const priorRoot = await mkdtemp(join(tmpdir(), 'ui5-artifact-'));
    try {
      const path = join(priorRoot, 'prior.json'); await writeFile(path, signed.bytes);
      const reused = await f.scan({ priorArtifacts: [{ scanId: signed.scanId, location: { kind: 'file', path } }] }, { retained: undefined, reuseTrust: trust });
      assert.equal(reused.report.results[0].observations[0].origin, 'reused');
      assert.equal(reused.report.results[0].observations[0].observationId, first.report.results[0].observations[0].observationId);
      const refused = await f.scan({ priorArtifacts: [{ scanId: signed.scanId, location: { kind: 'file', path } }] }, { retained: undefined, reuseTrust: { keys: [], publishers: [] } });
      assert.equal(refused.report.results[0].observations[0].origin, 'fresh');
      const view = await authoring.inspectReviewEvidence({ evidenceBytes: signed.bytes, inventory: f.inventory, itemId: f.item.id });
      assert.equal(view.value.producerAuthentication, 'unchecked');
      assert.equal(view.value.annexBytes, 'checked');
      console.log(JSON.stringify({ proof: 'ui5-public-artifact-custody', scope: 'local built-in source fixture and ephemeral Ed25519 fixture key; no production signing or native/external-runtime admission', scanId: signed.scanId,
        signedArtifactSha256: createHash('sha256').update(signed.bytes).digest('hex'), observationId: first.report.results[0].observations[0].observationId,
        retainedOrigin: own.report.results[0].observations[0].origin, cloneOrigin: clone.report.results[0].observations[0].origin, authenticatedImportOrigin: reused.report.results[0].observations[0].origin, untrustedImportOrigin: refused.report.results[0].observations[0].origin,
        authenticated, unknownTrust, invalidSignature, unsigned, portableAuthentication: view.value.producerAuthentication }));
    } finally { await rm(priorRoot, { recursive: true, force: true }); }
  } finally { await f.cleanup(); }
});
test('explicit unchanged subject comparison across a new release retains the original reviewed subject', async () => {
  const f = await reviewFixture();
  try {
    const evidence = await f.scan(), saved = await recorded(f, evidence);
    const next = await newNoteRelease(f), inventories = [...f.inventories, next], intent = structuredClone(saved.value.intent);
    intent.roots[0].releaseSha256 = next.release.sha256;
    intent.roots[0].itemSha256 = next.release.items[0].itemSha256;
    intent.inputs = [];
    const comparisons = [{ recordId: decision.id, target: { releaseSha256: next.release.sha256, itemId: f.item.id } }];
    const updated = await authoring.composeAuthoring({ basePolicyBytes: saved.value.policyBytes, intent, inventories, reviewEvidence: [evidence.bytes], comparisons });
    assert.equal(updated.status, 'ok', JSON.stringify(updated.diagnostics));
    assert.deepEqual(updated.value.intent.reviews, saved.value.intent.reviews);
    const reopened = await authoring.readAuthoring({ policyBytes: updated.value.policyBytes, inventories, reviewEvidence: [evidence.bytes], comparisons });
    assert.equal(reopened.value.editing, 'available', JSON.stringify(reopened.value.diagnostics));
    const compared = await authoring.compareReviewBindings({ intent: reopened.value.intent, inventories, reviewEvidence: [evidence.bytes], comparisons });
    assert.equal(compared.value[0].state, 'unchanged');
    assert.equal(compared.value[0].reviewedSubject.releaseSha256, f.inventory.release.sha256);
    assert.equal(compared.value[0].comparedSubject.releaseSha256, next.release.sha256);
  } finally { await f.cleanup(); }
});
test('synthetic required-input item remains inspectable and reviewable with supported authored configuration', async () => {
  const f = await reviewFixture({ configured: true });
  try {
    assert.deepEqual(f.saved.value.intent.roots[0].configuration, { directory: 'chosen' });
    const evidence = await f.scan(), saved = await recorded(f, evidence);
    const reopened = await authoring.readAuthoring({ policyBytes: saved.value.policyBytes, inventories: f.inventories, reviewEvidence: [evidence.bytes] });
    assert.equal(reopened.value.editing, 'available', JSON.stringify(reopened.value.diagnostics));
    assert.deepEqual(reopened.value.intent.roots[0].configuration, { directory: 'chosen' });
  } finally { await f.cleanup(); }
});
test('changed relevant annex bytes require reconsideration even with the same checked observation ID', async () => {
  const f = await reviewFixture();
  try {
    const evidence = await f.scan(), saved = await recorded(f, evidence);
    const report = structuredClone(evidence.report), annexes = evidence.annexes.map(a => ({ id: a.id, bytes: Buffer.from(a.bytesBase64, 'base64') }));
    const relevantId = report.results[0].observations[0].body.annexIds[0];
    const annex = annexes.find(a => a.id === relevantId), body = JSON.parse(annex.bytes.toString('utf8'));
    body.runs[0].results[0].message.text = 'Different supporting evidence fixture';
    annex.bytes = encode(body);
    const descriptor = report.annexes.find(a => a.id === relevantId);
    descriptor.sha256 = createHash('sha256').update(annex.bytes).digest('hex'); descriptor.byteLength = annex.bytes.length;
    const changed = await prepareArtifact({ report, annexes });
    assert.notEqual(changed.scanId, evidence.scanId);
    const read = await authoring.readAuthoring({ policyBytes: saved.value.policyBytes, inventories: f.inventories, reviewEvidence: [changed.bytes] });
    assert.equal(read.value.editing, 'unavailable');
    assert.equal(read.value.diagnostics[0].code, 'REVIEW_RECONSIDER_REQUIRED');
    assert.deepEqual(read.value.intent.reviews, saved.value.intent.reviews);
  } finally { await f.cleanup(); }
});
test('a changed review cannot hide an unavailable binding on another current record during composition', async () => {
  const f = await reviewFixture();
  try {
    const evidence = await f.scan(), first = await recorded(f, evidence);
    const second = await authoring.recordReview({ policyBytes: first.value.policyBytes, inventories: f.inventories, evidenceBytes: evidence.bytes, target: first.value.intent.reviews.records[0].subject, finding: first.value.intent.reviews.records[0].finding,
      reviewEvidence: [evidence.bytes], decision: { ...decision, id: 'second-review', owner: { kind: 'individual', id: 'another-reviewer' } } });
    assert.equal(second.status, 'ok');
    const next = { ...await newNoteRelease(f), materials: [] }, inventories = [...f.inventories, next], intent = structuredClone(second.value.intent);
    intent.roots[0].releaseSha256 = next.release.sha256; intent.roots[0].itemSha256 = next.release.items[0].itemSha256; intent.inputs = [];
    const result = await authoring.composeAuthoring({ basePolicyBytes: second.value.policyBytes, intent, inventories, reviewEvidence: [evidence.bytes], comparisons: [{ recordId: 'second-review', target: { releaseSha256: next.release.sha256, itemId: f.item.id } }] });
    assert.equal(result.status, 'refused'); assert.equal(result.value, undefined);
    assert.equal(result.diagnostics[0].code, 'REVIEW_BINDING_UNAVAILABLE');
    assert.deepEqual(result.originalBytes, second.value.policyBytes);
  } finally { await f.cleanup(); }
});
test('explicit changed-subject comparison can retain history through composition and reconsideration', async () => {
  const f = await reviewFixture();
  try {
    const evidence = await f.scan(), saved = await recorded(f, evidence), next = await newNoteRelease(f, 'updated');
    const inventories = [...f.inventories, next], intent = structuredClone(saved.value.intent);
    intent.roots[0].releaseSha256 = next.release.sha256; intent.roots[0].itemSha256 = next.release.items[0].itemSha256; intent.inputs = [];
    const comparisons = [{ recordId: decision.id, target: { releaseSha256: next.release.sha256, itemId: f.item.id } }];
    const changed = await authoring.composeAuthoring({ basePolicyBytes: saved.value.policyBytes, intent, inventories, reviewEvidence: [evidence.bytes], comparisons });
    assert.equal(changed.status, 'ok', JSON.stringify(changed.diagnostics));
    assert.equal(changed.value.intent.reviews.records[0].state, 'reconsider');
    assert.deepEqual(changed.value.intent.reviews.history, saved.value.intent.reviews.records);
    const reconsidered = await authoring.reconsiderReviews({ policyBytes: saved.value.policyBytes, inventories, reviewEvidence: [], comparisons: [{ recordId: decision.id, target: { releaseSha256: f.inventory.release.sha256, itemId: f.item.id } }] });
    assert.equal(reconsidered.status, 'ok', JSON.stringify(reconsidered.diagnostics));
  } finally { await f.cleanup(); }
});
