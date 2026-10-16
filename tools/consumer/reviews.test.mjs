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
import { writeJourneyEnvelope, readJourneyEnvelope } from './journey.mjs';
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
test('unrelated report changes retain exact decisions; trimming reviewed content keeps the judgment and reports it as changed', async () => {
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
    // #24: trimming no longer converts the judgment to a reconsideration request; it stays current and is reported as changed.
    assert.deepEqual(trimmed.value.intent.reviews, saved.value.intent.reviews);
    assert.equal(trimmed.value.intent.reviews.records[0].state, 'current');
    assert.equal(trimmed.value.reviewJudgments[0].applicability, 'changed');
    assert.equal(trimmed.value.reviewJudgments[0].applicabilityReason, 'subject-not-selected');
  } finally { await f.cleanup(); }
});
test('changed detector scope reports changed applicability without gating; explicit reconsideration and supersession still work', async () => {
  const f = await reviewFixture();
  try {
    const first = await f.scan(), saved = await recorded(f, first);
    await writeFile(join(f.root, 'additional-covered.md'), '# Changed detector scope\n');
    const changed = await f.scan({ selection: { paths: 'all', excludedPaths: [] } });
    const read = await authoring.readAuthoring({ policyBytes: saved.value.policyBytes, inventories: f.inventories, reviewEvidence: [changed.bytes] });
    // #24: changed evidence is reported as applicability, not a gate; the judgment stays bound to its original evidence.
    assert.equal(read.value.editing, 'available');
    assert.deepEqual(read.value.diagnostics, []);
    assert.equal(read.value.reviewJudgments[0].applicability, 'changed');
    assert.equal(read.value.reviewJudgments[0].applicabilityReason, 'evidence-changed');
    assert.deepEqual(read.value.intent.reviews, saved.value.intent.reviews);
    assert.deepEqual(read.value.originalBytes, saved.value.policyBytes);
    const reconsidered = await authoring.reconsiderReviews({ policyBytes: saved.value.policyBytes, inventories: f.inventories, reviewEvidence: [changed.bytes] });
    assert.equal(reconsidered.status, 'ok');
    assert.deepEqual(reconsidered.value.intent.reviews.history, saved.value.intent.reviews.records);
    assert.equal(reconsidered.value.reviewJudgments[0].applicability, 'reconsideration-requested');
    const inspected = await authoring.inspectReviewEvidence({ evidenceBytes: changed.bytes, inventory: f.inventory, itemId: f.item.id });
    const replacement = await authoring.recordReview({ policyBytes: reconsidered.value.policyBytes, inventories: f.inventories, evidenceBytes: changed.bytes, target: { releaseSha256: f.inventory.release.sha256, itemId: f.item.id }, finding: inspected.value.bindings[0].finding,
      decision: { ...decision, id: 'decision-2', disposition: 'accepted-risk', supersedes: reconsidered.value.intent.reviews.records[0].id, reason: 'Changed fixture configuration explicitly reviewed.' } });
    assert.equal(replacement.status, 'ok', JSON.stringify(replacement.diagnostics));
    assert.equal(replacement.value.intent.reviews.records[0].disposition, 'accepted-risk');
    assert.equal(replacement.value.intent.reviews.history.length, 2);
    assert.deepEqual(replacement.value.intent.reviews.history[0], saved.value.intent.reviews.records[0]);
  } finally { await f.cleanup(); }
});
test('missing evidence preserves executable policy and originals; version/binding violations of a new decision refuse without partial artifacts', async () => {
  const f = await reviewFixture();
  try {
    const evidence = await f.scan(), saved = await recorded(f, evidence);
    const missing = await authoring.readAuthoring({ policyBytes: saved.value.policyBytes, inventories: f.inventories });
    assert.equal(missing.status, 'ok'); assert.equal(missing.value.policy.mode, 'vibe');
    // #24: missing evidence leaves editing available; the judgment is reported as unverified, never refused.
    assert.equal(missing.value.editing, 'available'); assert.deepEqual(missing.value.diagnostics, []);
    assert.equal(missing.value.reviewJudgments[0].applicability, 'unverified');
    assert.equal(missing.value.reviewJudgments[0].applicabilityReason, 'evidence-not-supplied');
    assert.deepEqual(missing.value.originalBytes, saved.value.policyBytes);
    const record = saved.value.intent.reviews.records[0];
    for (const field of Object.keys(record.evidence)) {
      const policy = JSON.parse(new TextDecoder().decode(saved.value.policyBytes));
      policy.metadata['aih.workbench'].reviews.records[0].evidence[field] = 'incomparable';
      const read = await authoring.readAuthoring({ policyBytes: encode(policy), inventories: f.inventories, reviewEvidence: [evidence.bytes] });
      // #24: a binding that no longer matches the supplied evidence is applicability 'changed', not an editing refusal.
      assert.equal(read.value.editing, 'available', field);
      assert.equal(read.value.reviewJudgments[0].applicability, 'changed', field);
      assert.equal(read.value.reviewJudgments[0].evidence[field], 'incomparable', field);
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
    assert.equal(updated.value.reviewJudgments[0].applicability, 'applies');
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
test('changed relevant annex bytes report changed applicability even with the same checked observation ID', async () => {
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
    // #24: changed supporting evidence is reported as applicability, not a gate.
    assert.equal(read.value.editing, 'available');
    assert.equal(read.value.reviewJudgments[0].applicability, 'changed');
    assert.equal(read.value.reviewJudgments[0].applicabilityReason, 'evidence-changed');
    assert.deepEqual(read.value.intent.reviews, saved.value.intent.reviews);
  } finally { await f.cleanup(); }
});
test('composition across a new release succeeds and each current record reports its own applicability', async () => {
  const f = await reviewFixture();
  try {
    const evidence = await f.scan(), first = await recorded(f, evidence);
    const second = await authoring.recordReview({ policyBytes: first.value.policyBytes, inventories: f.inventories, evidenceBytes: evidence.bytes, target: first.value.intent.reviews.records[0].subject, finding: first.value.intent.reviews.records[0].finding,
      reviewEvidence: [evidence.bytes], decision: { ...decision, id: 'second-review', owner: { kind: 'individual', id: 'another-reviewer' } } });
    assert.equal(second.status, 'ok');
    const next = { ...await newNoteRelease(f), materials: [] }, inventories = [...f.inventories, next], intent = structuredClone(second.value.intent);
    intent.roots[0].releaseSha256 = next.release.sha256; intent.roots[0].itemSha256 = next.release.items[0].itemSha256; intent.inputs = [];
    const result = await authoring.composeAuthoring({ basePolicyBytes: second.value.policyBytes, intent, inventories, reviewEvidence: [evidence.bytes], comparisons: [{ recordId: 'second-review', target: { releaseSha256: next.release.sha256, itemId: f.item.id } }] });
    // #24: retired the refusal. One record's unavailable binding neither hides nor blocks another; each reports its own state.
    assert.equal(result.status, 'ok', JSON.stringify(result.diagnostics));
    assert.deepEqual(result.value.intent.reviews, second.value.intent.reviews);
    const byId = Object.fromEntries(result.value.reviewJudgments.map(j => [j.recordId, j]));
    assert.equal(byId[decision.id].applicability, 'changed'); assert.equal(byId[decision.id].applicabilityReason, 'subject-not-selected');
    assert.equal(byId['second-review'].applicability, 'unverified'); assert.equal(byId['second-review'].applicabilityReason, 'source-unavailable');
  } finally { await f.cleanup(); }
});
test('explicit changed-subject comparison reports changed applicability; explicit reconsideration retains history', async () => {
  const f = await reviewFixture();
  try {
    const evidence = await f.scan(), saved = await recorded(f, evidence), next = await newNoteRelease(f, 'updated');
    const inventories = [...f.inventories, next], intent = structuredClone(saved.value.intent);
    intent.roots[0].releaseSha256 = next.release.sha256; intent.roots[0].itemSha256 = next.release.items[0].itemSha256; intent.inputs = [];
    const comparisons = [{ recordId: decision.id, target: { releaseSha256: next.release.sha256, itemId: f.item.id } }];
    const changed = await authoring.composeAuthoring({ basePolicyBytes: saved.value.policyBytes, intent, inventories, reviewEvidence: [evidence.bytes], comparisons });
    assert.equal(changed.status, 'ok', JSON.stringify(changed.diagnostics));
    // #24: composition no longer converts the record; the changed subject is only reported.
    assert.deepEqual(changed.value.intent.reviews, saved.value.intent.reviews);
    assert.equal(changed.value.reviewJudgments[0].applicability, 'changed');
    assert.equal(changed.value.reviewJudgments[0].applicabilityReason, 'subject-changed');
    const reconsidered = await authoring.reconsiderReviews({ policyBytes: saved.value.policyBytes, inventories, reviewEvidence: [], comparisons: [{ recordId: decision.id, target: { releaseSha256: f.inventory.release.sha256, itemId: f.item.id } }] });
    assert.equal(reconsidered.status, 'ok', JSON.stringify(reconsidered.diagnostics));
    assert.equal(reconsidered.value.intent.reviews.records[0].state, 'reconsider');
    assert.deepEqual(reconsidered.value.intent.reviews.history, saved.value.intent.reviews.records);
  } finally { await f.cleanup(); }
});

// #24: historical judgments stay attributed and bound to their original evidence; imported ones are labelled.
async function changedEvidence(f) {
  await writeFile(join(f.root, 'additional-covered.md'), '# Changed detector scope\n');
  return f.scan({ selection: { paths: 'all', excludedPaths: [] } });
}
const unrelatedSelect = f => {
  const maintained = f.inventories[0].release, item = maintained.items[0];
  return { type: 'select', root: { releaseSha256: maintained.sha256, itemId: item.id, scope: item.scopes[0], configuration: {} } };
};
test('historical judgment survives an unrelated edit after an evidence change, stays bound and reapplies with the original evidence', async () => {
  const f = await reviewFixture();
  try {
    const first = await f.scan(), saved = await recorded(f, first), changed = await changedEvidence(f);
    const edited = await authoring.editAuthoring({ policyBytes: saved.value.policyBytes, inventories: f.inventories, reviewEvidence: [changed.bytes], operation: unrelatedSelect(f) });
    assert.equal(edited.status, 'ok', JSON.stringify(edited.diagnostics));
    assert.deepEqual(edited.value.intent.reviews, saved.value.intent.reviews);
    const record = edited.value.intent.reviews.records[0];
    assert.equal(record.state, 'current');
    for (const field of ['id', 'owner', 'actor', 'reason', 'recordedAt', 'disposition', 'subject', 'finding', 'evidence']) assert.deepEqual(record[field], saved.value.intent.reviews.records[0][field], field);
    const [judgment] = edited.value.reviewJudgments;
    assert.equal(judgment.applicability, 'changed'); assert.equal(judgment.applicabilityReason, 'evidence-changed');
    assert.deepEqual(judgment.evidence, record.evidence); assert.deepEqual(judgment.subject, record.subject);
    const reopened = await authoring.readAuthoring({ policyBytes: edited.value.policyBytes, inventories: f.inventories, reviewEvidence: [first.bytes] });
    assert.equal(reopened.value.editing, 'available', JSON.stringify(reopened.value.diagnostics));
    assert.equal(reopened.value.reviewJudgments[0].applicability, 'applies');
    assert.equal(reopened.value.reviewJudgments[0].applicabilityReason, null);
  } finally { await f.cleanup(); }
});
test('changed evidence forces no re-review: nothing refuses, converts or rewrites history', async () => {
  const f = await reviewFixture();
  try {
    const first = await f.scan(), saved = await recorded(f, first), changed = await changedEvidence(f);
    const read = await authoring.readAuthoring({ policyBytes: saved.value.policyBytes, inventories: f.inventories, reviewEvidence: [changed.bytes] });
    assert.equal(read.value.editing, 'available');
    assert.deepEqual(read.value.diagnostics, []);
    assert.deepEqual(read.value.reviewSummary, { recipientDecisions: 0, importedDecisions: 1, applies: 0, changed: 1, unverified: 0 });
    assert.deepEqual(read.value.intent.reviews.history, []);
    assert.equal(read.value.intent.reviews.records[0].state, 'current');
    // A fresh judgment on the new evidence is optional and is not blocked by the changed one.
    const inspected = await authoring.inspectReviewEvidence({ evidenceBytes: changed.bytes, inventory: f.inventory, itemId: f.item.id });
    const second = await authoring.recordReview({ policyBytes: saved.value.policyBytes, inventories: f.inventories, evidenceBytes: changed.bytes, target: { releaseSha256: f.inventory.release.sha256, itemId: f.item.id },
      finding: inspected.value.bindings[0].finding, decision: { ...decision, id: 'decision-2', reason: 'Re-reviewed on the changed evidence.' } });
    assert.equal(second.status, 'ok', JSON.stringify(second.diagnostics));
    const byId = Object.fromEntries(second.value.reviewJudgments.map(j => [j.recordId, j.applicability]));
    assert.deepEqual(byId, { [decision.id]: 'changed', 'decision-2': 'applies' });
    assert.deepEqual(second.value.intent.reviews.history, []);
  } finally { await f.cleanup(); }
});
test('imported judgments are labelled imported and are not counted as the recipient\'s decision', async () => {
  const f = await reviewFixture();
  try {
    const evidence = await f.scan(), saved = await recorded(f, evidence), read = recipient => authoring.readAuthoring({ policyBytes: saved.value.policyBytes, inventories: f.inventories, reviewEvidence: [evidence.bytes], recipient });
    const other = await read({ kind: 'individual', id: 'me' });
    assert.equal(other.value.reviewJudgments[0].origin, 'imported');
    assert.deepEqual(other.value.reviewJudgments[0].owner, decision.owner);
    assert.equal(other.value.reviewSummary.recipientDecisions, 0); assert.equal(other.value.reviewSummary.importedDecisions, 1);
    const own = await read({ kind: 'organization', id: 'team' });
    assert.equal(own.value.reviewJudgments[0].origin, 'recipient');
    assert.equal(own.value.reviewSummary.recipientDecisions, 1); assert.equal(own.value.reviewSummary.importedDecisions, 0);
    // No recipient, or one that is invalid or only partly equal to the owner, never reads as the recipient's decision and is never an error.
    for (const recipient of [undefined, { kind: 'individual', id: 'team' }, { kind: 'organization', id: '' }, { kind: 'provider', id: 'team' }, 'team', { kind: 'organization', id: 'x'.repeat(1001) }]) {
      const result = await read(recipient);
      assert.equal(result.status, 'ok'); assert.equal(result.value.reviewJudgments[0].origin, 'imported');
      assert.equal(result.value.reviewSummary.recipientDecisions, 0);
    }
    const edited = await authoring.editAuthoring({ policyBytes: saved.value.policyBytes, inventories: f.inventories, reviewEvidence: [evidence.bytes], operation: unrelatedSelect(f), recipient: decision.owner });
    assert.equal(edited.status, 'ok', JSON.stringify(edited.diagnostics));
    assert.equal(edited.value.reviewJudgments[0].origin, 'recipient');
    assert.deepEqual(edited.value.intent.reviews, saved.value.intent.reviews);
  } finally { await f.cleanup(); }
});
test('reviewing identity labels judgments but never changes exported policy, saved intent or journey bytes', async () => {
  const f = await reviewFixture();
  try {
    const evidence = await f.scan(), saved = await recorded(f, evidence), sentinel = 'settings-only-sentinel';
    const context = { inventories: f.inventories, reviewEvidence: [evidence.bytes] }, policyBytes = saved.value.policyBytes;
    const check = async (name, run, options, fields, judgments = true) => {
      const baseline = await run(options);
      assert.equal(baseline.status, 'ok', `${name}: ${JSON.stringify(baseline.diagnostics)}`);
      if (judgments) assert.equal(baseline.value.reviewJudgments[0].origin, 'imported', name);
      for (const recipient of [{ kind: 'individual', id: sentinel }, decision.owner]) {
        const result = await run({ ...options, recipient });
        assert.equal(result.status, 'ok', `${name}: ${JSON.stringify(result.diagnostics)}`);
        if (judgments) {
          assert.equal(result.value.reviewJudgments[0].origin, recipient.id === sentinel ? 'imported' : 'recipient', name);
          assert.deepEqual(result.value.reviewJudgments[0].owner, decision.owner, name);
        }
        for (const field of fields) {
          assert.ok(result.value[field] instanceof Uint8Array, `${name}.${field}`);
          assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(result.value[field]).includes(sentinel), false, `${name}.${field}`);
          assert.deepEqual(result.value[field], baseline.value[field], `${name}.${field}`);
        }
        if (fields.includes('envelopeBytes')) {
          const reopened = await readJourneyEnvelope(result.value.envelopeBytes);
          assert.equal(reopened.status, 'ok', `${name}: ${JSON.stringify(reopened.diagnostics)}`);
          assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(reopened.value.savedIntentBytes).includes(sentinel), false, `${name}.embeddedSavedIntentBytes`);
        }
      }
      return baseline;
    };
    await check('readAuthoring', authoring.readAuthoring, { ...context, policyBytes }, ['originalBytes']);
    await check('composeAuthoring', authoring.composeAuthoring, { ...context, basePolicyBytes: policyBytes, intent: saved.value.intent }, ['policyBytes']);
    await check('editAuthoring', authoring.editAuthoring, { ...context, policyBytes, operation: unrelatedSelect(f) }, ['policyBytes']);
    await check('recordReview', authoring.recordReview, { ...context, policyBytes: f.saved.value.policyBytes, evidenceBytes: evidence.bytes,
      target: { releaseSha256: f.inventory.release.sha256, itemId: f.item.id }, finding: saved.value.intent.reviews.records[0].finding, decision }, ['policyBytes']);
    const changed = await changedEvidence(f);
    await check('reconsiderReviews', authoring.reconsiderReviews, { ...context, policyBytes, reviewEvidence: [changed.bytes] }, ['policyBytes']);
    const opened = await check('openDraft(policy)', authoring.openDraft, { ...context, bytes: policyBytes }, ['envelopeBytes', 'savedIntentBytes']);
    await check('openDraft(envelope)', authoring.openDraft, { ...context, bytes: opened.value.envelopeBytes }, ['envelopeBytes', 'savedIntentBytes']);
    const edited = await check('editDraft', authoring.editDraft, { ...context, envelopeBytes: opened.value.envelopeBytes, operation: unrelatedSelect(f) }, ['envelopeBytes', 'savedIntentBytes']);
    await check('compileDraft', authoring.compileDraft, { ...context, envelopeBytes: edited.value.envelopeBytes }, ['policyBytes']);
    // The envelope writer has no recipient parameter; passing the context must not serialize it either.
    await check('writeJourneyEnvelope', writeJourneyEnvelope, { savedIntentBytes: opened.value.savedIntentBytes, records: opened.value.envelope.records }, ['envelopeBytes'], false);
  } finally { await f.cleanup(); }
});
test('accepted-risk judgment keeps actor, reason and exact binding through an edit and an evidence change', async () => {
  const f = await reviewFixture();
  try {
    const first = await f.scan(), inspected = await authoring.inspectReviewEvidence({ evidenceBytes: first.bytes, inventory: f.inventory, itemId: f.item.id });
    const risk = { ...decision, id: 'risk-1', disposition: 'accepted-risk', actor: 'risk-owner', owner: { kind: 'individual', id: 'risk-owner-id' }, reason: 'Accepted for this fixture until the license declaration is added.' };
    const saved = await authoring.recordReview({ policyBytes: f.saved.value.policyBytes, inventories: f.inventories, evidenceBytes: first.bytes, target: { releaseSha256: f.inventory.release.sha256, itemId: f.item.id }, finding: inspected.value.bindings[0].finding, decision: risk });
    assert.equal(saved.status, 'ok', JSON.stringify(saved.diagnostics));
    const changed = await changedEvidence(f);
    const edited = await authoring.editAuthoring({ policyBytes: saved.value.policyBytes, inventories: f.inventories, reviewEvidence: [changed.bytes], operation: unrelatedSelect(f), recipient: risk.owner });
    assert.equal(edited.status, 'ok', JSON.stringify(edited.diagnostics));
    const [judgment] = edited.value.reviewJudgments;
    assert.equal(judgment.disposition, 'accepted-risk'); assert.equal(judgment.actor, 'risk-owner'); assert.equal(judgment.reason, risk.reason);
    assert.deepEqual(judgment.owner, risk.owner);
    assert.deepEqual(judgment.subject, inspected.value.subject);
    assert.deepEqual(judgment.finding, inspected.value.bindings[0].finding);
    assert.deepEqual(judgment.evidence, inspected.value.bindings[0].evidence);
    assert.equal(judgment.applicability, 'changed'); assert.equal(judgment.origin, 'recipient');
    assert.deepEqual(edited.value.intent.reviews.records[0], saved.value.intent.reviews.records[0]);
  } finally { await f.cleanup(); }
});
test('drafts report saved judgments and neither refuse nor convert them when editing and compiling', async () => {
  const f = await reviewFixture();
  try {
    const first = await f.scan(), saved = await recorded(f, first), changed = await changedEvidence(f);
    const context = { inventories: f.inventories, reviewEvidence: [changed.bytes], recipient: decision.owner };
    const opened = await authoring.openDraft({ bytes: saved.value.policyBytes, ...context });
    // #24: a changed judgment no longer refuses the draft; it is reported beside it.
    assert.equal(opened.status, 'ok', JSON.stringify(opened.diagnostics));
    assert.equal(opened.value.reviewJudgments[0].applicability, 'changed'); assert.equal(opened.value.reviewJudgments[0].origin, 'recipient');
    assert.equal(opened.value.compile.status, 'available');
    const trimmed = await authoring.editDraft({ envelopeBytes: opened.value.envelopeBytes, operation: { type: 'remove-root', root: saved.value.intent.roots[0] }, ...context });
    assert.equal(trimmed.status, 'ok', JSON.stringify(trimmed.diagnostics));
    // #24: removing reviewed content no longer converts its judgment to a reconsideration request.
    assert.equal('reviewsReconsidered' in trimmed.value.changes, false);
    assert.deepEqual(trimmed.value.intent.reviews, saved.value.intent.reviews);
    assert.equal(trimmed.value.reviewJudgments[0].applicabilityReason, 'subject-not-selected');
    const compiled = await authoring.compileDraft({ envelopeBytes: trimmed.value.envelopeBytes, ...context });
    assert.equal(compiled.status, 'ok', JSON.stringify(compiled.diagnostics));
    assert.equal('reviewsReconsidered' in compiled.value, false);
    assert.deepEqual(compiled.value.intent.reviews, saved.value.intent.reviews);
    assert.equal(compiled.value.reviewJudgments[0].state, 'current');
  } finally { await f.cleanup(); }
});
