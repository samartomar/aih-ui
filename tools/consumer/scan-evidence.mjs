// Application projection; Scan owns matching, ordering, refusals and summaries.
import { selectAssessments, readContentCoverage, readArtifact, readReport } from '@aihq/scan/read';
import { evidenceKey, evidenceDigest } from './evidence-cache.mjs';
import { isCheckedRelease, listItems } from '@aihq/catalog/reader';

// Presentation only: preserve the reader's states and counts, omit large path,
// observation and finding bodies. Scan Review keeps the full public-reader answer.
export function inspectorSummary(result) {
  const coverage = value => value && ({ status: value.status, reason: value.reason,
    observationCount: value.observations?.length, unmatchedPathCount: value.unmatchedPaths?.length,
    detectorsWithoutCoverage: value.detectorsWithoutCoverage, excluded: value.excluded });
  const assessment = value => value && ({ eligibility: value.eligibility, acquisitions: value.acquisitions,
    coverage: coverage(value.coverage), comparisonCoverage: coverage(value.comparisonCoverage),
    summary: { scanId: value.summary.scanId, createdAt: value.summary.createdAt, completion: value.summary.completion,
      producer: value.summary.producer, findings: value.summary.findings,
      providers: value.summary.providers.map(provider => ({ detectorId: provider.detectorId, outcome: provider.outcome,
        findings: provider.findings, coverageComplete: provider.coverage?.complete })) } });
  return { status: result.status, selectedScanId: result.selectedScanId, evaluationTime: result.evaluationTime,
    freshness: result.freshness, checks: result.checks, diagnostics: result.diagnostics,
    assessment: assessment(result.assessments?.find(entry => entry.summary.scanId === result.selectedScanId)),
    baseline: result.baseline ? { scanId: result.baseline.scanId, evidence: assessment(result.baseline.evidence) } : null,
    acquisitionCost: result.acquisitionCost };
}

export async function selectContentEvidence({ inventory, itemId, assessments, sourceIds, checks, evaluationTime, selection, detectorIds, cache, identities }) {
  if (!isCheckedRelease(inventory?.release)) return { status: 'invalid', diagnostics: [{ code: 'CHECKED_RELEASE_REQUIRED', detail: 'Supply a checked Catalog release.' }] };
  const item = listItems(inventory.release).find(item => item.id === itemId);
  if (!item) return { status: 'invalid', diagnostics: [{ code: 'ITEM_UNAVAILABLE', detail: 'Exact Catalog item unavailable.' }] };
  const baseline = inventory.release.baseline;
  const descriptors = [item.recipe, ...item.materials].map(({ path, sha256, byteLength }) => ({ path, sha256, byteLength }));
  // The inventory compares release declarations; item capture/coverage is a separate read below.
  const context = { sourceIds, descriptors: baseline ? [baseline.inventory] : descriptors,
    selection: selection ?? (baseline ? { paths: baseline.scope.paths, excludedPaths: baseline.scope.excludedPaths } : { paths: descriptors.map(value => value.path).sort(), excludedPaths: [] }) };
  // Optional evidence has no comparison context until an acquisition is configured.
  // Do not weaken Scan's requirement for a real, nonempty source set.
  if (Array.isArray(sourceIds) && sourceIds.length === 0 && assessments?.length === 0 && checks?.length === 0 && !baseline) {
    return { status: 'unconfigured', selectedScanId: null, assessments: [], checks: [], context, evaluationTime,
      baseline: null, diagnostics: [{ code: 'no-evidence-source', detail: 'No assessment available: no evidence source configured or supplied. Browsing, selection and saving remain available.' }] };
  }
  const reuse = (key, load, size) => cache ? cache.read(key, load, size) : load();
  identities ??= assessments.map(value => ({ sourceId: value.sourceId, location: value.location, format: value.format,
    sha256: evidenceDigest(value.bytes), expectedScanId: value.expectedScanId, authentication: value.authentication }));
  const result = await reuse('selection/' + evidenceKey({ identities, context, checks, evaluationTime, detectorIds }),
    () => selectAssessments({ assessments, context, checks, evaluationTime, ...(detectorIds ? { detectorIds } : {}) }));
  if (result.status !== 'selected') return result;
  const reads = await Promise.all(assessments.map((candidate, index) => reuse('read/' + evidenceKey({ format: candidate.format, sha256: identities[index].sha256 }),
    () => candidate.format === 'artifact' ? readArtifact(candidate.bytes) : readReport(candidate.bytes), candidate.bytes.length * 4)));
  const entries = [];
  for (const entry of result.assessments) {
    const index = reads.findIndex(read => read.status === 'read' && read.scanId === entry.summary.scanId);
    const read = reads[index];
    const coverage = await reuse('coverage/' + evidenceKey({ identity: identities[index] && { format: identities[index].format, sha256: identities[index].sha256 }, descriptors }),
      () => readContentCoverage({ read, descriptors }));
    entries.push({ ...entry, comparisonCoverage: entry.coverage, coverage });
  }
  return { ...result, assessments: entries, context, item: { itemId, descriptors }, baseline: baseline ? { ...baseline,
    meaning: 'Pinned release evidence; qualification is independent of item capture and detector coverage.',
    evidence: entries.find(entry => entry.summary.scanId === baseline.scanId) ?? null } : null };
}
