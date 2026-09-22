/*
 * Step 5: reopen the saved bytes and consume them independently, and what came
 * back.
 *
 * This component owns the Consume button and the verdict readout. The verdict
 * always ends with the execution sentence, chosen from the execution value:
 * "not-attempted", "observed" (Core read the installed files under an explicit
 * install root and found them one-to-one identical to the verified scan) or
 * "refused". Nothing here may ever read as Applied, Installed, Executed or
 * Published.
 */

import { el } from "../app/dom.js";
import { NOT_SUPPLIED } from "../app/absence.js";
import { REFUSAL } from "./vocabulary.js";
import { row } from "./rows.js";

/**
 * @param elements   { govConsumeBtn, govVerdict }
 * @param onConsume  called when the operator asks to reopen and consume
 */
export function createVerdict({ elements, onConsume }) {
  elements.govConsumeBtn.addEventListener("click", onConsume);

  return {
    setSaved(saved) {
      elements.govConsumeBtn.disabled = !saved;
    },

    renderError(message) {
      elements.govVerdict.replaceChildren(el("div", "text-error leading-snug", message));
    },

    render(view) {
      const box = elements.govVerdict;
      box.replaceChildren();
      if (view === null) {
        box.appendChild(el("div", "text-outline", "Not consumed yet."));
        return;
      }
      if (view.reopened === false) {
        box.appendChild(el("div", "text-error font-semibold", "Reopen failed"));
        box.appendChild(el("div", "text-on-surface-variant leading-snug", view.reason));
        return;
      }
      if (view.materialCarriesTrust !== undefined || view.scanTrustMissing === true) {
        box.appendChild(el("div", "text-error font-semibold", "Refused before verification"));
        box.appendChild(el("div", "text-on-surface-variant leading-snug", view.reason));
        return;
      }

      // Outcome, then the reason in the operator's language. Never "Applied".
      const outcomeTone =
        view.outcome === "refused" ? "text-error" : view.outcome === "partial" ? "text-tertiary" : "text-primary";
      box.appendChild(el("div", `font-semibold ${outcomeTone}`, `Outcome: ${view.outcome}`));
      if (view.reason) {
        box.appendChild(el("div", "font-mono text-[10px] text-outline", view.reason));
        box.appendChild(el("div", "text-on-surface-variant leading-snug", REFUSAL[view.reason] ?? ""));
      }

      const detail = el("div", "pt-1 space-y-0.5 font-mono text-[10px]");
      // What the evidence actually was. "Verified scanner evidence" is only ever
      // said when the claim is scan-attestation-v2 AND evidence verified.
      row(detail, "Evidence claim", view.evidenceClaim, NOT_SUPPLIED);
      row(detail, "Matched path", view.matchedPath, NOT_SUPPLIED);
      row(detail, "Binding route", view.bindingRoute, NOT_SUPPLIED);
      row(detail, "Authority transport", view.authorityTransport, NOT_SUPPLIED);
      row(detail, "Authority source", view.authoritySource, NOT_SUPPLIED);
      row(detail, "Verifier trust from", view.trustSource, NOT_SUPPLIED);
      row(detail, "Subject digest", view.subjectDigest, NOT_SUPPLIED);
      row(detail, "Decision digest", view.decisionDigest, NOT_SUPPLIED);
      box.appendChild(detail);
      // What the assessment route bound, and what it did not scan. Coverage is
      // shown beside the binding, never folded into it.
      renderAssessmentBinding(box, view.assessmentBinding);
      renderObservation(box, view.observation);

      for (const diagnostic of view.diagnostics ?? []) {
        box.appendChild(
          el("div", "text-outline leading-snug text-[10px]", `${diagnostic.field}: ${diagnostic.detail}`),
        );
      }

      box.appendChild(
        el(
          "div",
          "pt-1 mt-1 border-t border-surface-container-high/40 text-[10.5px] text-outline leading-snug",
          executionSentence(view),
        ),
      );
    },
  };
}

/**
 * The closing sentence, chosen from the execution value.
 *
 * An observed execution is the only case where Core read bytes that exist
 * outside the verified scan, and even then nothing was installed, applied,
 * executed or published: the sentence says exactly that and no more.
 */
function executionSentence(view) {
  if (view.execution === "observed") {
    const root = view.observation?.installRoot ?? "the install root";
    return `Execution: observed. Core read the files under ${root} and found them one-to-one identical to the verified scan. Nothing was installed, applied, executed or published.`;
  }
  if (view.execution === "refused") {
    return "Execution: refused. The observation was refused; see the reason above. Nothing was installed, applied, executed or published.";
  }
  return `Execution: ${view.execution}. No effect was applied, executed or published — this contract never executes.`;
}

/**
 * Core's assessment binding, as Core stated it.
 *
 * The material root and the scanned files are Core's own records; the uncovered
 * paths are its statement of what the scan did NOT reach. Coverage is shown as
 * its own line and never changes the binding status text above: "not scanned"
 * is a fact about the scan's reach, not about whether the bytes bound.
 */
function renderAssessmentBinding(box, binding) {
  if (binding === null || binding === undefined) return;
  const detail = el("div", "pt-1 space-y-0.5 font-mono text-[10px]");
  row(detail, "Material root", binding.materialRoot, NOT_SUPPLIED);
  const scannedFiles = binding.scannedMaterial?.files ?? [];
  row(detail, "Scanned files", `${scannedFiles.length}`, NOT_SUPPLIED);
  row(detail, "Declared files", `${binding.itemCoverage?.declaredFiles?.length ?? 0}`, NOT_SUPPLIED);
  for (const file of scannedFiles) {
    row(
      detail,
      "scanned file",
      `${file.declaredPath} ${file.sha256.slice(0, 12)} ${file.byteLength} B`,
      NOT_SUPPLIED,
    );
  }
  row(detail, "Whole item covered", binding.itemCoverage?.complete ? "yes" : "no", NOT_SUPPLIED);
  box.appendChild(detail);
  const uncoveredPaths = binding.itemCoverage?.uncoveredPaths ?? [];
  if (uncoveredPaths.length > 0) {
    box.appendChild(
      el(
        "div",
        "text-tertiary leading-snug",
        `Not scanned: ${uncoveredPaths.join(", ")}`,
      ),
    );
  }
}

/**
 * Core's observation, as Core stated it.
 *
 * One row per file pairs the sealed path with the path it was actually read at,
 * so a renamed file can never pass for a match. The install root is shown on its
 * own line, and the validity window and digest make the receipt checkable.
 */
function renderObservation(box, observation) {
  if (observation === null || observation === undefined) return;
  const detail = el("div", "pt-1 space-y-0.5 font-mono text-[10px]");
  row(detail, "Install root", observation.installRoot, NOT_SUPPLIED);
  row(detail, "Observed files", `${(observation.files ?? []).length}`, NOT_SUPPLIED);
  for (const file of observation.files ?? []) {
    row(
      detail,
      "observed file",
      `${file.sealedPath} → ${file.observedPath} ${String(file.sha256).slice(0, 12)} ${file.byteLength} B`,
      NOT_SUPPLIED,
    );
  }
  row(detail, "Observed at", observation.observedAt, NOT_SUPPLIED);
  row(detail, "Valid until", observation.validUntil, NOT_SUPPLIED);
  row(detail, "Observation digest", observation.observationDigest, NOT_SUPPLIED);
  box.appendChild(detail);
}
