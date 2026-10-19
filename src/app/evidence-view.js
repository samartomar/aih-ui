// Viewing evidence is independent of policy edits and prepared approvals.
export function evidenceView(selection, historicalId) {
  const scanId = historicalId ?? selection.selectedScanId;
  const entry = selection.assessments?.find(value => value.summary.scanId === scanId);
  return { scanId, mode: historicalId ? 'history' : 'latest', unavailable: !!scanId && !entry,
    newer: !!historicalId && !!selection.selectedScanId && historicalId !== selection.selectedScanId, entry };
}
