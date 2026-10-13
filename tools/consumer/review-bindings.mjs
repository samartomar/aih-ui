// Bind consumer decisions to freshly checked public Scan values. These exact
// projections name public fields; they neither mint Scan digests nor grant custody.
import { readScanBytes, presentReport } from './report-view.mjs';
import { isCheckedRelease, listItems } from '@aihq/catalog/reader';
import { describeAuthoringSubject, stable, ok, refuse } from './headless.mjs';
import { checkIntentShape } from './intent-shape.mjs';

const bindingFailure = message => refuse('REVIEW_BINDING_UNAVAILABLE', '/reviews/records', message);
const exact = (tag, value) => `${tag}:${stable(value)}`;
const absent = (field, value) => `absent:${field}:${value.reason}`;
export async function inspectReviewEvidence({ evidenceBytes, inventory, itemId }) {
  if (!(evidenceBytes instanceof Uint8Array) || !isCheckedRelease(inventory?.release)) return bindingFailure('Supply evidence bytes and an actual checked inventory.');
  const read = await readScanBytes(evidenceBytes);
  const view = presentReport(read);
  if (read.status !== 'read') return ok({ reportSupport: read.status, view, bindings: [], sourceAssociation: 'unavailable', producerAuthentication: 'unchecked' });
  const subject = await describeAuthoringSubject({ inventory, itemId });
  if (subject.status !== 'ok') return subject;
  const item = listItems(inventory.release).find(item => item.id === itemId);
  const descriptors = [item.recipe, ...item.materials];
  const contains = entries => descriptors.every(material => entries.some(entry => ['file', 'file-link'].includes(entry.kind) && entry.path === material.path && entry.sha256 === material.sha256 && entry.byteLength === material.byteLength));
  const sourceAssociation = contains(read.report.source.capture.entries) ? 'matched' : 'mismatched';
  const bindings = [];
  for (const detector of read.report.results) for (const observation of detector.observations) {
    const { input } = observation.body;
    // Partial sibling work stays visible. Only successful covered observations
    // covering the complete exact subject can support a reusable decision.
    if (sourceAssociation !== 'matched' || detector.outcome !== 'succeeded' || !contains(input.entries)
      || !descriptors.every(material => observation.body.coverage.coveredPaths.includes(material.path))) continue;
    const annexIds = [...new Set([...observation.body.annexIds, ...observation.body.findings.filter(finding => finding.supportingEvidence.state === 'present').map(finding => finding.supportingEvidence.value.annexId)])].sort();
    const annexes = annexIds.map(id => read.report.annexes.find(annex => annex.id === id));
    if (annexes.some(annex => !annex)) continue;
    const evidence = {
      observationIdentity: exact('observation', { id: observation.observationId, annexes }),
      detectorIdentity: exact('detector', { id: input.detectorId, version: input.detectorVersion, adapterSha256: input.adapterSha256, platform: input.platform }),
      rulesIdentity: `sha256:${input.rulesSha256}`,
      configurationIdentity: `sha256:${input.configurationSha256}`,
      profileIdentity: exact('profile', { id: input.profileId, sha256: input.profileSha256 }),
      scopeIdentity: `${observation.observationId}#input`,
      coverageIdentity: exact(`${observation.observationId}#coverage`, detector.coverage)
    };
    // Observation ID binds the full body including scope, coverage and gaps.
    // Aggregate detector coverage is an exact checked projection, not a new hash.
    if (Object.values(evidence).some(value => value.length > 1000)) continue;
    for (const finding of observation.body.findings) bindings.push({
      finding: { detectorId: detector.detectorId, ruleId: finding.rule.state === 'present' ? finding.rule.value.nativeRuleId : absent('rule', finding.rule), findingId: finding.rawOccurrenceFingerprint },
      evidence, findingDisplay: finding,
      optionalIdentities: { location: finding.location.state === 'present' ? exact('location', finding.location.value) : absent('location', finding.location), supportingEvidence: finding.supportingEvidence.state === 'present' ? exact('annex', finding.supportingEvidence.value) : absent('supportingEvidence', finding.supportingEvidence) }
    });
  }
  return ok({ reportSupport: 'supported', scanId: read.scanId, producerAuthentication: read.authenticity, annexBytes: read.annexBytes, sourceAssociation, subject: subject.value, bindings, view });
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
    let state = 'unavailable', comparedSubject;
    if (!pin || !inventory) state = 'changed';
    else {
      const subject = await describeAuthoringSubject({ inventory, itemId: target.itemId });
      if (subject.status === 'ok') {
        comparedSubject = subject.value;
        if (comparedSubject.itemId !== record.subject.itemId || (comparedSubject.releaseSha256 === record.subject.releaseSha256 && comparedSubject.itemSha256 !== record.subject.itemSha256) || comparedSubject.recipeIdentity !== record.subject.recipeIdentity || stable(comparedSubject.materials) !== stable(record.subject.materials)) state = 'changed';
        else for (const evidenceBytes of reviewEvidence) {
          const inspected = await inspectReviewEvidence({ evidenceBytes, inventory, itemId: target.itemId });
          if (inspected.status !== 'ok' || inspected.value.reportSupport !== 'supported' || inspected.value.sourceAssociation !== 'matched') continue;
          state = 'changed';
          if (inspected.value.bindings.some(binding => stable(binding.finding) === stable(record.finding) && stable(binding.evidence) === stable(record.evidence))) { state = 'unchanged'; break; }
        }
      }
    }
    results.push({ recordId: record.id, state, reviewedSubject: record.subject, ...(comparedSubject ? { comparedSubject } : {}) });
  }
  return ok(results);
}

export async function reviewDiagnostics(options) {
  const compared = await compareReviewBindings(options);
  if (compared.status !== 'ok') return compared.diagnostics;
  return compared.value.filter(result => result.state !== 'unchanged').map(result => ({
    code: result.state === 'changed' ? 'REVIEW_RECONSIDER_REQUIRED' : 'REVIEW_BINDING_UNAVAILABLE', path: '/reviews/records', related: [result.recordId],
    message: result.state === 'changed' ? 'Relevant subject/finding/evidence changed; retain history and reconsider.' : 'Required checked binding unavailable; retain original report and history.'
  }));
}
