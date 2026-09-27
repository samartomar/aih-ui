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
import { NOT_SUPPLIED } from "../app/absence.js";
import { row, codeRow } from "./rows.js";

function section(box, label) {
  box.appendChild(
    el("div", "pt-1 mt-1 border-t border-wb-border text-[9px] font-mono uppercase tracking-wider text-outline", label),
  );
}

function findingField(parent, label, field, format = (value) => String(value)) {
  if (field?.state === "present") {
    row(parent, label, format(field.value));
    return;
  }
  const line = row(parent, label, `Unavailable · ${field?.reason ?? "not stated"}`, NOT_SUPPLIED, "text-outline");
  line.title = field?.detail ?? field?.reason ?? "Scan did not publish this field for this finding.";
}

function renderFindingDetail(box, detail) {
  section(box, "Finding detail (Scan)");
  if (detail?.status !== "available") {
    row(box, "Detail", detail?.status ?? "Unavailable", NOT_SUPPLIED, "text-outline");
    if (detail?.reason) box.appendChild(el("div", "text-outline leading-snug", detail.reason));
    return false;
  }

  row(box, "Detail source", detail.source, NOT_SUPPLIED, "text-tertiary");
  if (detail.findings.length === 0) {
    row(box, "Typed findings", "0 declared");
  }
  for (const finding of detail.findings) {
    const disclosure = el("details", "p-2 rounded bg-surface-container-low border border-wb-border");
    disclosure.appendChild(el("summary", "cursor-pointer font-mono break-all", `${finding.rawOccurrenceFingerprint} ×${finding.multiplicity}`));
    const facts = el("div", "pt-2 space-y-1");
    findingField(facts, "Detector", finding.detector, (value) => `${value.id} · ${value.analyzerIdentity}`);
    findingField(facts, "Rule", finding.rule, (value) => value.name ? `${value.nativeRuleId} · ${value.name}` : value.nativeRuleId);
    findingField(facts, "SARIF level", finding.severity, (value) => value.level);
    findingField(facts, "Message", finding.message);
    findingField(facts, "Location", finding.location, (value) => `${value.path}${value.startLine === undefined ? "" : `:${value.startLine}`}`);
    findingField(facts, "Supporting annex", finding.supportingEvidence, (value) => `${value.annexDescriptorId} · ${value.annexSha256}`);
    disclosure.appendChild(facts);
    box.appendChild(disclosure);
  }
  if (detail.gaps.length > 0) {
    section(box, "Typed finding gaps");
    for (const gap of detail.gaps) box.appendChild(el("div", "text-outline leading-snug", `${gap.kind}: ${gap.detail}`));
  }
  return true;
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

  // The record's occurrence facts remain visible if the typed reader refuses.
  // When it succeeds, the disclosure repeats those identities with whatever
  // details Scan could actually bind to verified annex bytes.
  if (!renderFindingDetail(box, scan.findingDetail)) {
    for (const finding of scan.findings ?? []) {
      codeRow(box, "finding", `${finding.rawOccurrenceFingerprint} ×${finding.multiplicity}`);
    }
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

  // The record reader's gaps are distinct from the typed finding reader's.
  if ((scan.gaps ?? []).length > 0) {
    section(box, "Result record gaps");
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
