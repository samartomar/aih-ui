// Application projection; Scan owns matching, ordering, refusals and summaries.
import { selectAssessments, readContentCoverage, readArtifact, readReport } from '@aihq/scan/read';
import { isCheckedRelease, listItems } from '@aihq/catalog/reader';

export async function selectContentEvidence({ inventory, itemId, assessments, sourceIds, checks, evaluationTime, selection, detectorIds }) {
  if (!isCheckedRelease(inventory?.release)) return { status: 'invalid', diagnostics: [{ code: 'CHECKED_RELEASE_REQUIRED', detail: 'Supply a checked Catalog release.' }] };
  const item = listItems(inventory.release).find(item => item.id === itemId);
  if (!item) return { status: 'invalid', diagnostics: [{ code: 'ITEM_UNAVAILABLE', detail: 'Exact Catalog item unavailable.' }] };
  const baseline = inventory.release.baseline;
  const descriptors = [item.recipe, ...item.materials].map(({ path, sha256, byteLength }) => ({ path, sha256, byteLength }));
  // The inventory compares release declarations; item capture/coverage is a separate read below.
  const context = { sourceIds, descriptors: baseline ? [baseline.inventory] : descriptors,
    selection: selection ?? (baseline ? { paths: baseline.scope.paths, excludedPaths: baseline.scope.excludedPaths } : { paths: descriptors.map(value => value.path).sort(), excludedPaths: [] }) };
  const result = await selectAssessments({ assessments, context, checks, evaluationTime, ...(detectorIds ? { detectorIds } : {}) });
  if (result.status !== 'selected') return result;
  const reads = await Promise.all(assessments.map(candidate => candidate.format === 'artifact' ? readArtifact(candidate.bytes) : readReport(candidate.bytes)));
  const entries = [];
  for (const entry of result.assessments) {
    const read = reads.find(read => read.status === 'read' && read.scanId === entry.summary.scanId);
    entries.push({ ...entry, comparisonCoverage: entry.coverage, coverage: await readContentCoverage({ read, descriptors }) });
  }
  return { ...result, assessments: entries, context, item: { itemId, descriptors }, baseline: baseline ? { ...baseline,
    meaning: 'Pinned release evidence; qualification is independent of item capture and detector coverage.',
    evidence: entries.find(entry => entry.summary.scanId === baseline.scanId) ?? null } : null };
}
