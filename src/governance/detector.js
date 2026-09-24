/*
 * Scanner attestation, scanner result facts, and detector provenance.
 *
 * These are THREE different statements and they are rendered as three, always
 * together:
 *
 * 1. ATTESTATION - a signature verified under the operator's configured trust.
 *    It authenticates who signed. It is not a measurement.
 * 2. SCANNER RESULT - what Scan's own reader normalizes out of that verified
 *    attestation. Its facts are declared BY the attestation, so a run state of
 *    "succeeded" is a claim the attestation carries, and `signer.class` reads
 *    "organization" for an ephemeral test key too. The reader's own gaps name
 *    what it will not say, and they are shown verbatim.
 * 3. DETECTOR PROVENANCE - the operator's own declaration about their signer.
 *    This is the ONLY statement that can say whether a detector really ran, and
 *    it is never inferred from 1 or 2.
 *
 * The scanned-tree binding belongs to 2: Scan reports the digest of the source
 * tree that was scanned. It does not establish that the selected catalog item
 * was in that scan - only Core's binding does, and that is shown with the six
 * statuses, not here.
 */

import { el } from "../app/dom.js";
import { FINDING_DETAIL_ABSENT, NOT_SUPPLIED } from "../app/absence.js";
import { row, codeRow } from "./rows.js";

function section(box, label) {
  box.appendChild(
    el("div", "pt-1 mt-1 border-t border-wb-border text-[9px] font-mono uppercase tracking-wider text-outline", label),
  );
}

/** Facts Scan verified. Declared values are labelled as declared. */
function renderScanResult(box, scan) {
  section(box, "Scanner result (Scan)");
  if (scan === null || scan === undefined) {
    row(box, "Result record", null, NOT_SUPPLIED);
    return;
  }
  if (scan.recordStatus !== "available") {
    row(box, "Result record", scan.recordStatus, NOT_SUPPLIED, "text-outline");
    if (scan.reason) box.appendChild(el("div", "text-outline leading-snug", scan.reason));
    return;
  }

  row(box, "Record", `${scan.format} v${scan.version}`);
  row(box, "Signer identity", scan.signer?.identity);
  // Never presented as provenance: the class is whatever the signer declared.
  row(box, "Signer class (declared)", scan.signer?.class, NOT_SUPPLIED, "text-tertiary");
  codeRow(box, "Signer keyId", scan.signer?.keyId);
  row(box, "Run state (declared)", scan.declaredRunState, NOT_SUPPLIED, "text-tertiary");
  row(box, "Run provenance (declared)", scan.declaredProvenance, NOT_SUPPLIED, "text-tertiary");
  row(box, "Platform", scan.platform ? `${scan.platform.os}/${scan.platform.architecture}` : null);
  codeRow(box, "Detector id", scan.detector?.id);
  row(box, "Analyzer identity", scan.detector?.analyzerIdentity);
  codeRow(box, "Coverage", scan.coverage ? `${scan.coverage.kind} ${scan.coverage.sha256}` : null);
  row(box, "Observations", String(scan.observationCount ?? 0));
  row(box, "Findings", String(scan.findingCount ?? 0));

  // A finding record carries an occurrence fingerprint and a multiplicity and
  // nothing else. Message, location and severity are NOT in the attestation;
  // they are listed as missing below rather than filled in with a guess.
  for (const finding of scan.findings ?? []) {
    codeRow(box, "finding", `${finding.rawOccurrenceFingerprint} x${finding.multiplicity}`);
  }
  if ((scan.findingCount ?? 0) > 0) {
    box.appendChild(el("div", "text-outline leading-snug", FINDING_DETAIL_ABSENT));
  }
  row(box, "SARIF", scan.sarifState, NOT_SUPPLIED, "text-tertiary");

  // The scanned tree. Explicitly not a statement about the selected item.
  const tree = scan.scannedTree ?? {};
  row(box, "Scanned subject", tree.status === "bound" ? tree.subjectName : tree.status, NOT_SUPPLIED, tree.status === "bound" ? "text-on-surface" : "text-outline");
  if (tree.status === "bound") {
    codeRow(box, "Scanned tree sha256", tree.subjectSha256);
    box.appendChild(
      el(
        "div",
        "text-tertiary leading-snug",
        `This is ${tree.covers ?? "the digest of the source tree that was scanned."}`,
      ),
    );
  }

  // What Scan declines to say, in Scan's own words.
  if ((scan.gaps ?? []).length > 0) {
    section(box, "What this result does not state");
    for (const gap of scan.gaps) {
      box.appendChild(el("div", "text-outline leading-snug", `${gap.kind}: ${gap.detail}`));
    }
  }
}

/**
 * @param elements   { govFixtureBtn, govDetector }
 * @param onFixture  called when the operator asks for the labelled fixture
 */
export function createDetector({ elements, onFixture }) {
  elements.govFixtureBtn.addEventListener("click", onFixture);

  return {
    setAvailable(available) {
      elements.govFixtureBtn.disabled = !available;
    },

    renderError(message) {
      elements.govDetector.replaceChildren(el("div", "text-error leading-snug", message));
    },

    /**
     * @param view     the consumption result, or null
     * @param fixture  the labelled fixture's own declaration, or null
     */
    render(view, fixture) {
      const box = elements.govDetector;
      box.replaceChildren();

      // 1. the signature
      const attestationVerified =
        view !== null && view.evidenceClaim === "scan-attestation-v2" && view.evidence === "verified";
      row(
        box,
        "Attestation",
        view === null ? null : attestationVerified ? "Attestation verified" : "Attestation not verified",
        NOT_SUPPLIED,
        view === null ? undefined : attestationVerified ? "text-primary" : "text-error",
      );

      // 2. what Scan read out of it, only after verification
      renderScanResult(box, view === null ? null : view.scanResult);

      // 3. the operator's own declaration
      section(box, "Detector provenance (operator)");
      const declared = view?.operatorProvenance ?? null;
      if (fixture === null && declared === null) {
        row(box, "Detector execution", null, NOT_SUPPLIED);
        box.appendChild(
          el(
            "div",
            "text-outline leading-snug",
            "No operator provenance declaration has been supplied, so nothing can be said about whether a detector ran.",
          ),
        );
        return;
      }
      if (declared !== null) {
        // The declaration belongs to the trust entry of the signer that
        // actually signed. When that entry cannot be identified there is no
        // declaration to show, only the reason - never the first root.
        if (declared.attributed === true) {
          codeRow(box, "Verified signer", declared.signerKeyId);
          row(box, "Declared provenance", declared.evidenceProvenance, NOT_SUPPLIED, "text-tertiary");
          row(box, "Declared label", declared.provenanceLabel, NOT_SUPPLIED, "text-tertiary");
          row(box, "Declared by", declared.declaredBy);
        } else {
          row(box, "Declared provenance", null, NOT_SUPPLIED);
          row(box, "Verified signer", declared.signerKeyId, NOT_SUPPLIED, "text-outline");
          box.appendChild(el("div", "text-tertiary leading-snug", declared.reason));
        }
      }
      if (fixture !== null) {
        row(box, "Detector execution", fixture.label, NOT_SUPPLIED, "text-tertiary");
        row(box, "Detector executed", String(fixture.detectorExecuted), NOT_SUPPLIED, "text-tertiary");
        codeRow(box, "Signer keyId", fixture.keyId);
        row(box, "Sealed files", `${fixture.sealedFileCount} from the installed package`);
        box.appendChild(el("div", "text-outline leading-snug", fixture.note));
      }
    },
  };
}
