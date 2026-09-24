/*
 * Reopening downloaded files in a fresh session.
 *
 * The operator hands back the exact two files they downloaded. They go into a
 * session that knows nothing about the one that produced them - no digests, no
 * status, no binding claim, not even which catalog entry it was. Consumption
 * then re-derives the whole verdict from those bytes alone, which is what makes
 * it independent rather than a replay of what the page already believed.
 *
 * The bytes are sent exactly as read. Core's parser refuses a document that was
 * altered, re-serialized or truncated, and that refusal is the point of this
 * step: it is how an operator checks that what they stored is still what Core
 * will accept.
 */

import { el } from "../app/dom.js";
import { NOT_SUPPLIED } from "../app/absence.js";
import { row, codeRow } from "./rows.js";

/**
 * @param elements  { govReopenInputFile, govReopenEvidenceFile, govReopenBtn, govReopen }
 * @param onFiles   called with { input, evidence } once both are chosen
 * @param onReopen  called when the operator asks for the fresh session
 */
export function createReopen({ elements, onFiles, onReopen }) {
  const chosen = { input: null, evidence: null };

  const pick = (which, node) => {
    node.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      chosen[which] = file;
      elements.govReopenBtn.disabled = chosen.input === null || chosen.evidence === null;
      onFiles({ ...chosen });
    });
  };
  pick("input", elements.govReopenInputFile);
  pick("evidence", elements.govReopenEvidenceFile);

  elements.govReopenBtn.addEventListener("click", onReopen);

  return {
    renderError(message) {
      elements.govReopen.replaceChildren(el("div", "text-error leading-snug", message));
    },

    /**
     * Forgets the chosen files when the selection changes. The button is
     * offered again only once both files are chosen for the new selection;
     * nothing carries over.
     */
    reset() {
      chosen.input = null;
      chosen.evidence = null;
      elements.govReopenInputFile.value = "";
      elements.govReopenEvidenceFile.value = "";
      elements.govReopenBtn.disabled = true;
    },

    /** @param opened { sessionId, files } from the backend, or null */
    render(opened) {
      const box = elements.govReopen;
      box.replaceChildren();
      if (opened === null) {
        row(box, "Fresh session", null, NOT_SUPPLIED);
        return;
      }
      row(box, "Fresh session", "opened", NOT_SUPPLIED, "text-primary");
      for (const file of opened.files ?? []) {
        row(box, file.name, `${file.byteLength} bytes`);
        codeRow(box, "sha256", file.sha256);
      }
      box.appendChild(
        el(
          "div",
          "text-on-surface-variant leading-snug",
          "This session carries only these bytes. Consume now to re-derive the verdict from them.",
        ),
      );
    },
  };
}
