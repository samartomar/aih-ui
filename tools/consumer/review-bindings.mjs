// Bind consumer decisions to freshly checked public Scan values. Scan's public
// coverage read decides association and which observations cover the exact
// subject; these projections only name its fields. They neither mint Scan
// digests nor grant custody.
import { readContentCoverage, selectAssessments } from '@aihq/scan/read';
import { readScanBytes, presentReport } from './report-view.mjs';
import { isCheckedRelease, listItems } from '@aihq/catalog/reader';
import { stable, ok, refuse } from './primitives.mjs';
import { deriveRecipeIdentity } from '@aihq/core/contracts';
import { checkIntentShape } from './intent-shape.mjs';

const bindingFailure = message => refuse('REVIEW_BINDING_UNAVAILABLE', '/reviews/records', message);
const exact = (tag, value) => `${tag}:${stable(value)}`;
const absent = (field, value) => `absent:${field}:${value.reason}`;
const descriptorsOf = item => [item.recipe, ...item.materials].map(({ path, sha256, byteLength }) => ({ path, sha256, byteLength }));
// Scan's coverage status is the association: matched, mismatched, or unavailable when Scan cannot assess it.
const association = coverage => ['matched', 'mismatched'].includes(coverage.status) ? coverage.status : 'unavailable';
export async function inspectReviewEvidence({ evidenceBytes, inventory, itemId }) {
  if (!(evidenceBytes instanceof Uint8Array) || !isCheckedRelease(inventory?.release)) return bindingFailure('Supply evidence bytes and an actual checked inventory.');
  const read = await readScanBytes(evidenceBytes);
  const view = presentReport(read);
  if (read.status !== 'read') return ok({ reportSupport: read.status, view, bindings: [], sourceAssociation: 'unavailable', producerAuthentication: 'unchecked' });
  const subject = await describeAuthoringSubject({ inventory, itemId });
  if (subject.status !== 'ok') return subject;
  const item = listItems(inventory.release).find(item => item.id === itemId);
  const coverage = await readContentCoverage({ read, descriptors: descriptorsOf(item) });
  const sourceAssociation = association(coverage);
  const bindings = [];
  // Only observations Scan reports as covering the complete exact subject can support a reusable decision.
  for (const observation of coverage.status === 'matched' ? coverage.observations : []) {
    const { detector, input } = observation;
    const evidence = {
      observationIdentity: exact('observation', { id: observation.observationId, annexes: observation.annexes }),
      detectorIdentity: exact('detector', { id: detector.detectorId, version: detector.detectorVersion, adapterSha256: detector.adapterSha256, platform: detector.platform }),
      rulesIdentity: `sha256:${input.rulesSha256}`,
      configurationIdentity: `sha256:${input.configurationSha256}`,
      profileIdentity: exact('profile', { id: input.profileId, sha256: input.profileSha256 }),
      scopeIdentity: `${observation.observationId}#input`,
      coverageIdentity: exact(`${observation.observationId}#coverage`, observation.detectorCoverage)
    };
    // Observation ID binds the full body including scope, coverage and gaps.
    // Aggregate detector coverage is an exact checked projection, not a new hash.
    if (Object.values(evidence).some(value => value.length > 1000)) continue;
    for (const finding of observation.findings) bindings.push({
      finding: { detectorId: detector.detectorId, ruleId: finding.rule.state === 'present' ? finding.rule.value.nativeRuleId : absent('rule', finding.rule), findingId: finding.rawOccurrenceFingerprint },
      evidence, findingDisplay: finding,
      optionalIdentities: { location: finding.location.state === 'present' ? exact('location', finding.location.value) : absent('location', finding.location), supportingEvidence: finding.supportingEvidence.state === 'present' ? exact('annex', finding.supportingEvidence.value) : absent('supportingEvidence', finding.supportingEvidence) }
    });
  }
  return ok({ reportSupport: 'supported', scanId: read.scanId, producerAuthentication: read.authenticity, annexBytes: read.annexBytes, sourceAssociation, subject: subject.value, bindings, view });
}

// Per-item evidence state for the catalog: what the supplied documents say about each exact item, from Scan's
// public read and coverage operations. Absence of evidence is `not-supplied`, never a publication claim; a
// matched state is Scan's unchecked coverage of exact bytes, not producer authentication or authority.
export const MAX_EVIDENCE_SUBJECTS = 2048;
export async function describeEvidenceStates({ reviewEvidence = [], inventories, subjects, evaluationTime }) {
  if (!Array.isArray(reviewEvidence) || reviewEvidence.length > 32 || reviewEvidence.some(bytes => !(bytes instanceof Uint8Array))
    || !Array.isArray(inventories) || inventories.length > 32 || inventories.some(entry => !isCheckedRelease(entry?.release))
    || !Array.isArray(subjects) || subjects.length > MAX_EVIDENCE_SUBJECTS
    || subjects.some(value => !value || typeof value.itemId !== 'string' || !/^[a-f0-9]{64}$/.test(value.releaseSha256 ?? ''))) return bindingFailure('Supply bounded evidence, checked inventories and exact subjects.');
  const reads = await Promise.all(reviewEvidence.map(bytes => readScanBytes(bytes)));
  const scopes = [...new Map(reads.filter(read => read.status === 'read').map(read => [stable(read.report.selection), read.report.selection])).values()];
  const assessments = reviewEvidence.map((bytes, index) => ({ sourceId: 'supplied', location: `Supplied document ${index + 1}`, bytes,
    format: reads[index].annexBytes === 'checked' ? 'artifact' : 'report' }));
  const values = [];
  for (const subject of subjects) {
    const inventory = inventories.find(entry => entry.release.sha256 === subject.releaseSha256);
    const item = inventory && listItems(inventory.release).find(item => item.id === subject.itemId);
    let state = !reads.length ? 'not-supplied' : !item ? 'unavailable' : reads.some(read => read.status === 'unsupported-report') ? 'unsupported' : 'invalid', scanId;
    const baseline = inventory?.release.baseline;
    // Without an explicit release request, several supplied scopes require a choice in Scan Review.
    if (item && scopes.length && (baseline || scopes.length === 1)) {
      const selection = baseline ? { paths: baseline.scope.paths, excludedPaths: baseline.scope.excludedPaths } : scopes[0];
      const selected = await selectAssessments({ assessments, context: { sourceIds: ['supplied'], descriptors: descriptorsOf(item), selection },
        evaluationTime, checks: [{ sourceId: 'supplied', status: 'succeeded', attemptedAt: evaluationTime, lastSuccessfulAt: evaluationTime, diagnostics: [] }] });
      if (selected.status === 'selected') {
        const entry = selected.assessments.find(entry => entry.summary.scanId === selected.selectedScanId);
        // Mismatched remains inspectable; only Scan's eligible selection receives a selected identity.
        state = entry ? 'matched' : selected.assessments.length ? 'mismatched' : state;
        scanId = entry?.summary.scanId;
      } else state = 'unavailable';
    } else if (scopes.length > 1) state = 'unavailable';
    values.push({ ...subject, state, ...(scanId ? { scanId } : {}), documents: reads.length });
  }
  return ok(values);
}

export async function compareReviewBindings({ intent, inventories, reviewEvidence = [], comparisons = [] }) {
  if (!checkIntentShape(intent) || !Array.isArray(inventories) || inventories.length > 32 || inventories.some(entry => !isCheckedRelease(entry?.release)) || !Array.isArray(reviewEvidence) || reviewEvidence.length > 32 || reviewEvidence.some(bytes => !(bytes instanceof Uint8Array)) || !Array.isArray(comparisons)
    || comparisons.length > 4096 || new Set(comparisons.map(value => value?.recordId)).size !== comparisons.length
    || comparisons.some(value => !value || Object.keys(value).sort().join(',') !== 'recordId,target' || ![...intent.reviews.records, ...intent.reviews.history].some(record => record.id === value.recordId)
      || !value.target || Object.keys(value.target).sort().join(',') !== 'itemId,releaseSha256' || !/^[a-f0-9]{64}$/.test(value.target.releaseSha256) || !/^[\w.-]{1,180}$/.test(value.target.itemId))) return bindingFailure('Supply supported intent, checked inventories, at most 32 original evidence byte arrays and unique exact comparison targets.');
  const results = [];
  for (const record of intent.reviews.records.filter(record => record.state === 'current')) {
    const target = comparisons.find(value => value.recordId === record.id)?.target ?? record.subject;
    const pin = intent.pins.find(pin => pin.releaseSha256 === target.releaseSha256 && pin.itemId === target.itemId);
    const inventory = inventories.find(entry => entry.release.sha256 === target.releaseSha256);
    let state = 'unavailable', reason = 'evidence-not-supplied', comparedSubject;
    if (!pin) [state, reason] = ['changed', 'subject-not-selected'];
    else if (!inventory) reason = 'source-unavailable';
    else {
      const subject = await describeAuthoringSubject({ inventory, itemId: target.itemId });
      if (subject.status !== 'ok') reason = 'source-unavailable';
      else {
        comparedSubject = subject.value;
        if (comparedSubject.itemId !== record.subject.itemId || (comparedSubject.releaseSha256 === record.subject.releaseSha256 && comparedSubject.itemSha256 !== record.subject.itemSha256) || comparedSubject.recipeIdentity !== record.subject.recipeIdentity || stable(comparedSubject.materials) !== stable(record.subject.materials)) [state, reason] = ['changed', 'subject-changed'];
        else for (const evidenceBytes of reviewEvidence) {
          const inspected = await inspectReviewEvidence({ evidenceBytes, inventory, itemId: target.itemId });
          if (inspected.status !== 'ok' || inspected.value.reportSupport !== 'supported' || inspected.value.sourceAssociation !== 'matched') continue;
          [state, reason] = ['changed', 'evidence-changed'];
          if (inspected.value.bindings.some(binding => stable(binding.finding) === stable(record.finding) && stable(binding.evidence) === stable(record.evidence))) { [state, reason] = ['unchanged', null]; break; }
        }
      }
    }
    results.push({ recordId: record.id, state, reason, reviewedSubject: record.subject, ...(comparedSubject ? { comparedSubject } : {}) });
  }
  return ok(results);
}

// Applicability is a display of how a saved judgment relates to the supplied
// evidence. It never gates editing and never rewrites the stored judgment.
const validRecipient = value => !!value && typeof value === 'object' && ['individual', 'organization'].includes(value.kind)
  && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 1000;
export async function describeReviewJudgments({ intent, inventories, reviewEvidence = [], comparisons = [], recipient }) {
  const compared = await compareReviewBindings({ intent, inventories, reviewEvidence, comparisons });
  if (compared.status !== 'ok') return compared;
  const self = validRecipient(recipient) ? recipient : undefined;
  return ok(intent.reviews.records.map(record => {
    const comparison = compared.value.find(value => value.recordId === record.id);
    const applicability = comparison ? { unchanged: 'applies', changed: 'changed', unavailable: 'unverified' }[comparison.state] : 'reconsideration-requested';
    return { recordId: record.id, state: record.state, owner: structuredClone(record.owner), actor: record.actor, disposition: record.disposition, reason: record.reason, recordedAt: record.recordedAt,
      subject: structuredClone(record.subject), finding: structuredClone(record.finding), evidence: structuredClone(record.evidence), applicability, applicabilityReason: comparison?.reason ?? null,
      origin: self && self.kind === record.owner.kind && self.id === record.owner.id ? 'recipient' : 'imported' };
  }));
}
export function summarizeReviewJudgments(judgments) {
  const current = judgments.filter(judgment => judgment.state === 'current'), count = test => current.filter(test).length;
  return { recipientDecisions: count(j => j.origin === 'recipient'), importedDecisions: count(j => j.origin === 'imported'),
    applies: count(j => j.applicability === 'applies'), changed: count(j => j.applicability === 'changed'), unverified: count(j => j.applicability === 'unverified') };
}
// Use Core's public identity semantics for exact supplied recipe snapshots.
// This describes content, not human approval or observation custody.
export async function describeAuthoringSubject({ inventory, itemId }) {
  if (!inventory || !isCheckedRelease(inventory.release)) return refuse('SOURCE_IDENTITY_MISMATCH', '/inventory', 'Supply an actual checked Catalog reader value.');
  const item = listItems(inventory.release).find(item => item.id === itemId);
  if (!item) return refuse('SOURCE_REVISION_UNAVAILABLE', '/itemId', 'Exact item unavailable.');
  const recipeBytes = inventory.materials?.find(material => material.path === item.recipe.path)?.bytes;
  if (!recipeBytes) return refuse('SOURCE_REVISION_UNAVAILABLE', '/recipeBytes', 'Exact recipe bytes are required for identity derivation.');
  // Identity describes the checked recipe declaration, independent of the
  // authored values for its required inputs. Core validates this public shape.
  const reference = { source: inventory.materialSource, path: item.recipe.path, sha256: item.recipe.sha256, byteLength: item.recipe.byteLength,
    materials: item.materials.map(({ id, path, sha256, byteLength }) => ({ id, path, sha256, byteLength })) };
  const identity = await deriveRecipeIdentity({ recipeBytes, reference });
  if (identity.status !== 'ok') return identity;
  return ok({ releaseSha256: inventory.release.sha256, itemId, itemSha256: item.itemSha256, recipeIdentity: identity.value.recipeIdentity, materials: identity.value.materials });
}
