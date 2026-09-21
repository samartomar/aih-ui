/*
 * Step 4: prepare through Core, and what was saved.
 *
 * This component owns the Prepare button, the prepared-artifact readout and the
 * two download buttons. The downloads hand over the exact bytes the backend
 * read back off disk.
 *
 * A saved document may only ever CLAIM a binding, so the binding status shown
 * here is the claim - only independent consumption can report "bound".
 */

import { el } from "../app/dom.js";
import { NOT_SUPPLIED } from "../app/absence.js";
import { REFUSAL, TONE } from "./vocabulary.js";
import { row } from "./rows.js";

/**
 * @param elements  { govPrepareBtn, govPrepared, govDownloadInput, govDownloadEvidence }
 * @param onPrepare   called when the operator asks to prepare
 * @param onDownload  called with "input" or "evidence"
 */
export function createPrepared({ elements, onPrepare, onDownload }) {
  elements.govPrepareBtn.addEventListener("click", onPrepare);
  elements.govDownloadInput.addEventListener("click", () => onDownload("input"));
  elements.govDownloadEvidence.addEventListener("click", () => onDownload("evidence"));

  return {
    setCanPrepare(can) {
      elements.govPrepareBtn.disabled = !can;
    },

    setSaved(saved) {
      elements.govDownloadInput.disabled = !saved;
      elements.govDownloadEvidence.disabled = !saved;
    },

    renderError(message) {
      elements.govPrepared.replaceChildren(el("div", "text-error leading-snug", message));
    },

    render(prepared) {
      const box = elements.govPrepared;
      box.replaceChildren();
      if (prepared === null) {
        row(box, "Artifacts", null, NOT_SUPPLIED);
        return;
      }
      if (prepared.prepared !== true) {
        box.appendChild(el("div", "text-error font-semibold", `Refused: ${prepared.status.reason}`));
        box.appendChild(el("div", "text-on-surface-variant leading-snug", REFUSAL[prepared.status.reason] ?? ""));
        for (const diagnostic of prepared.diagnostics ?? []) {
          box.appendChild(el("div", "text-outline leading-snug", `${diagnostic.field}: ${diagnostic.detail}`));
        }
        return;
      }
      row(box, "governance-input.json", `${prepared.input.byteLength} bytes`);
      // A domain-separated digest OVER the document, not a hash of the file. The
      // label says so: an operator who hashes the download will get a different
      // value and should not be left wondering which one is wrong.
      row(box, "input document digest", prepared.input.digest);
      row(box, "evidence path", prepared.evidence.rootRelativePath);
      row(box, "evidence envelope digest", prepared.evidence.digest);
      row(
        box,
        "Byte-identical on repeat",
        prepared.deterministic ? "yes" : "NO",
        NOT_SUPPLIED,
        prepared.deterministic ? "text-primary" : "text-error",
      );
      row(box, "Saved binding status", prepared.status.binding, NOT_SUPPLIED, TONE[prepared.status.binding]);
    },
  };
}
