// Explicit Node host boundary. Trust is independently selected by the host;
// imported policy/report JSON is never a source of verification authority.
import { authenticateArtifact } from '@aihq/scan/host';
import { inspectReviewEvidence } from './headless.mjs';
export async function inspectAuthenticatedReviewEvidence({ evidenceBytes, inventory, itemId, recipe, configuration, trust, expectedScanId }) {
  const inspected = await inspectReviewEvidence({ evidenceBytes, inventory, itemId, recipe, configuration });
  if (inspected.status !== 'ok') return inspected;
  const producerAuthentication = await authenticateArtifact({ bytes: evidenceBytes, expectedScanId, trust });
  return { ...inspected, value: { ...inspected.value, producerAuthentication } };
}
