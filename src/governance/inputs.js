/*
 * What the operator supplies, and what is known about the subject before
 * anything is prepared.
 *
 * This component owns the subject readout, the evidence file input and the
 * decision / target / effect / route fields. It never manufactures any of them:
 * a field nobody filled in stays empty and reads "Not supplied", and the
 * controller refuses to prepare.
 *
 * It reports the values it holds through `values()`. Nothing outside reads its
 * inputs directly.
 */

import { el } from "../app/dom.js";
import { NOT_PUBLISHED, NOT_SUPPLIED } from "../app/absence.js";
import { row } from "./rows.js";

function section(box, label) {
  box.appendChild(
    el("div", "pt-1 mt-1 border-t border-surface-container-high/40 text-[9px] font-mono uppercase tracking-wider text-outline", label),
  );
}

/*
 * Catalog's own result about Catalog's own bytes, kept apart from everything
 * Core decides.
 *
 * "artifacts: verified" means the four declared artifacts of each entry -
 * closure, profile, prose and recipe - hash to their declared sha256. It does
 * NOT cover the qualification evidence files, which are separate paths in the
 * same index and are not byte-checked by that reader. The two are therefore two
 * rows, and the evidence row says plainly that it is declared, not checked.
 */
function renderCatalog(box, catalog) {
  section(box, "Catalog artifact integrity");
  if (catalog === "pending") {
    row(box, "Catalog", "reading and hashing the declared artifacts...", NOT_PUBLISHED, "text-outline");
    return;
  }
  if (catalog === null || catalog === undefined) {
    row(box, "Catalog", null, NOT_PUBLISHED);
    return;
  }
  if (catalog.ok === false) {
    box.appendChild(el("div", "text-error leading-snug", catalog.error));
    return;
  }
  row(box, "Index digest", catalog.indexDigest, NOT_PUBLISHED);
  row(box, "Index structure", catalog.indexStructure, NOT_PUBLISHED, catalog.indexStructure === "valid" ? "text-primary" : "text-error");
  row(
    box,
    "Declared artifacts",
    catalog.indexArtifacts,
    NOT_PUBLISHED,
    catalog.indexArtifacts === "verified" ? "text-primary" : catalog.indexArtifacts === "unverified" ? "text-error" : "text-outline",
  );
  const states = (catalog.artifacts ?? []).map((artifact) => `${artifact.name}=${artifact.state}`).join(" ");
  row(box, "This entry", states || null, NOT_PUBLISHED);

  section(box, "Published evidence (Catalog)");
  const evidence = catalog.publishedEvidence ?? { declared: 0, byteChecked: 0 };
  row(box, "Records declared", String(evidence.declared));
  row(box, "Bytes checked here", String(evidence.byteChecked), NOT_SUPPLIED, "text-tertiary");
  for (const record of evidence.records ?? []) {
    row(box, record.kind, `${record.id} · ${record.attestor}`);
  }
  if (evidence.note) box.appendChild(el("div", "text-outline leading-snug", evidence.note));
}

/**
 * @param elements  { govSubject, govEvidence, govEvidenceFile, govDecisionId,
 *                    govDecisionDigest, govTarget, govEffect, govRoute }
 * @param onEvidenceFile  called with the File the operator chose
 * @param onInput         called whenever a typed field changes
 */
export function createInputs({ elements, onEvidenceFile, onInput }) {
  elements.govEvidenceFile.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) onEvidenceFile(file);
  });
  for (const input of [elements.govDecisionId, elements.govDecisionDigest, elements.govTarget]) {
    input.addEventListener("input", onInput);
  }

  return {
    values() {
      return {
        route: elements.govRoute.value,
        target: elements.govTarget.value.trim(),
        effect: elements.govEffect.value,
        decisionId: elements.govDecisionId.value.trim(),
        decisionDigest: elements.govDecisionDigest.value.trim(),
      };
    },

    /** True only when every operator input the contract needs is present. */
    complete() {
      const values = this.values();
      return values.decisionId.length > 0 && values.decisionDigest.length > 0 && values.target.length > 0;
    },

    /**
     * The validation fixture fills in the decision it generated, so the normal
     * fields show exactly what will be prepared. They stay editable.
     */
    setDecision({ decisionId, decisionDigest }) {
      elements.govDecisionId.value = decisionId;
      elements.govDecisionDigest.value = decisionDigest;
    },

    clearDecision() {
      elements.govDecisionId.value = "";
      elements.govDecisionDigest.value = "";
    },

    /**
     * @param subject the Core-derived identity, or null
     * @param catalog Catalog's own integrity result, "pending" while it is
     *                still being read, or null when nothing is selected
     */
    renderSubject(subject, catalog = null) {
      const box = elements.govSubject;
      box.replaceChildren();
      if (subject === null) {
        row(box, "Subject", null, "Select a catalog entry");
        return;
      }
      row(box, "Kind", subject.kind);
      row(box, "Subject id", subject.id);
      row(box, "Source type", subject.source?.type);
      row(box, "Source digest", subject.sourceDigest);
      row(box, "Subject digest", subject.subjectDigest);
      // The index carries digest copies but no signature, so they authenticate
      // nothing. Cross-check them and show disagreement rather than choosing.
      row(
        box,
        "Index copies",
        subject.indexAgrees ? "agree with Core" : "DISAGREE with Core",
        NOT_PUBLISHED,
        subject.indexAgrees ? "text-primary" : "text-error",
      );
      row(
        box,
        "Package content",
        subject.contentAvailable ? "ships in the installed package" : null,
        NOT_PUBLISHED,
        subject.contentAvailable ? "text-on-surface" : "text-outline",
      );
      renderCatalog(box, catalog);
    },

    renderSubjectError(message) {
      elements.govSubject.replaceChildren(el("div", "text-error leading-snug", message));
    },

    renderEvidence(facts) {
      const box = elements.govEvidence;
      box.replaceChildren();
      if (facts === null) {
        row(box, "Evidence", null, NOT_SUPPLIED);
        return;
      }
      if (facts.parsed !== true) {
        box.appendChild(el("div", "text-error leading-snug", facts.reason));
        row(box, "Bytes read", `${facts.byteLength}`);
        return;
      }
      row(box, "Envelope digest", facts.digest);
      row(box, "Subject digest", facts.subjectDigest);
      row(box, "Evidence kind", facts.evidenceKind);
      row(box, "Attestor", facts.attestor);
      row(box, "Not before", facts.notBefore);
      row(box, "Expires", facts.expiresAt);
      // A claim is not a verification. Say which it is.
      const claim = facts.claimsScanEvidence
        ? "claims scan-attestation-v2 — unverified until consumption"
        : "organization assertion — not a scan, not a measurement";
      box.appendChild(
        el("div", `leading-snug ${facts.claimsScanEvidence ? "text-tertiary" : "text-on-surface-variant"}`, claim),
      );
    },
  };
}
