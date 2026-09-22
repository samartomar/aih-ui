/*
 * Step 5: reopen the saved bytes and consume them independently, and what came
 * back.
 *
 * This component owns the Consume button and the verdict readout. The verdict
 * always ends with the execution sentence: `execution` is always
 * "not-attempted", so nothing here may ever read as Applied, Executed or
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

      for (const diagnostic of view.diagnostics ?? []) {
        box.appendChild(
          el("div", "text-outline leading-snug text-[10px]", `${diagnostic.field}: ${diagnostic.detail}`),
        );
      }

      box.appendChild(
        el(
          "div",
          "pt-1 mt-1 border-t border-surface-container-high/40 text-[10.5px] text-outline leading-snug",
          `Execution: ${view.execution}. No effect was applied, executed or published — this contract never executes.`,
        ),
      );
    },
  };
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
  row(detail, "Scanned files", `${binding.scannedMaterial.files.length}`, NOT_SUPPLIED);
  for (const file of binding.scannedMaterial.files) {
    row(
      detail,
      "  scanned",
      `${file.declaredPath} ${file.sha256.slice(0, 12)} ${file.byteLength} B`,
      NOT_SUPPLIED,
    );
  }
  row(detail, "Whole item covered", binding.itemCoverage.complete ? "yes" : "no", NOT_SUPPLIED);
  box.appendChild(detail);
  if (binding.itemCoverage.uncoveredPaths.length > 0) {
    box.appendChild(
      el(
        "div",
        "text-tertiary leading-snug",
        `Not scanned: ${binding.itemCoverage.uncoveredPaths.join(", ")}`,
      ),
    );
  }
}
