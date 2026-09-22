/*
 * The Governance pane's elements, grouped by the component that owns each one.
 */

import { collectIds } from "../app/dom.js";

export function governanceElements() {
  const ids = [
    "gov-subject", "gov-evidence-file", "gov-evidence",
    "gov-decision-id", "gov-decision-digest", "gov-target", "gov-effect", "gov-route",
    "gov-prepare-btn", "gov-prepared", "gov-download-input", "gov-download-evidence",
    "gov-consume-btn", "gov-statuses", "gov-verdict", "gov-fixture-btn", "gov-detector",
    "gov-authority-file", "gov-trust-file", "gov-material-file", "gov-operator-files",
    "gov-reopen-input-file", "gov-reopen-evidence-file", "gov-reopen-btn", "gov-reopen",
    "gov-observation-manifest-file", "gov-observation-root", "gov-observation-files", "gov-observation",
  ];
  const found = collectIds(ids);
  return {
    inputs: {
      govSubject: found.govSubject,
      govEvidence: found.govEvidence,
      govEvidenceFile: found.govEvidenceFile,
      govDecisionId: found.govDecisionId,
      govDecisionDigest: found.govDecisionDigest,
      govTarget: found.govTarget,
      govEffect: found.govEffect,
      govRoute: found.govRoute,
    },
    prepared: {
      govPrepareBtn: found.govPrepareBtn,
      govPrepared: found.govPrepared,
      govDownloadInput: found.govDownloadInput,
      govDownloadEvidence: found.govDownloadEvidence,
    },
    operatorFiles: {
      govAuthorityFile: found.govAuthorityFile,
      govTrustFile: found.govTrustFile,
      govMaterialFile: found.govMaterialFile,
      govOperatorFiles: found.govOperatorFiles,
    },
    statuses: { govStatuses: found.govStatuses },
    reopen: {
      govReopenInputFile: found.govReopenInputFile,
      govReopenEvidenceFile: found.govReopenEvidenceFile,
      govReopenBtn: found.govReopenBtn,
      govReopen: found.govReopen,
    },
    observation: {
      govObservationManifestFile: found.govObservationManifestFile,
      govObservationRoot: found.govObservationRoot,
      govObservationFiles: found.govObservationFiles,
      govObservation: found.govObservation,
    },
    verdict: { govConsumeBtn: found.govConsumeBtn, govVerdict: found.govVerdict },
    detector: { govFixtureBtn: found.govFixtureBtn, govDetector: found.govDetector },
  };
}
