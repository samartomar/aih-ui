/*
 * The operator's own configuration: their authority, their verifier trust and
 * their attestation material.
 *
 * Three separate inputs, stored separately, because they are three separate
 * things and one of them is a trust decision. None of them is derived from the
 * imported evidence, and the evidence never supplies any of them - material
 * that carries its own `roots`, `expected`, `trust`, `publicKey` or
 * `publicKeyPem` is refused by the backend before verification is attempted.
 *
 * Nothing here is generated. A file the operator has not supplied stays
 * "Not supplied", and consumption refuses on that basis.
 */

import { el } from "../app/dom.js";
import { NOT_SUPPLIED } from "../app/absence.js";
import { row, codeRow } from "./rows.js";

/** What each input is for, in the order the operator meets them. */
const KINDS = [
  {
    kind: "authority",
    element: "govAuthorityFile",
    label: "Authority bundle",
    note: "Held outside the consumption root, as the contract requires.",
  },
  {
    kind: "trust",
    element: "govTrustFile",
    label: "Verifier trust",
    note: "Your roots and expected values. Never read from the imported material.",
  },
  {
    kind: "material",
    element: "govMaterialFile",
    label: "Attestation material",
    note: "Canonical envelope and candidate text, plus annex bytes.",
  },
];

/**
 * @param elements  { govAuthorityFile, govTrustFile, govMaterialFile, govOperatorFiles }
 * @param onFile    called with { kind, file }
 */
export function createOperatorFiles({ elements, onFile }) {
  for (const spec of KINDS) {
    elements[spec.element].addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (file) onFile({ kind: spec.kind, file });
    });
  }

  return {
    /**
     * @param stored  { [kind]: { storedAs, byteLength, sha256 } | { error } }
     */
    render(stored) {
      const box = elements.govOperatorFiles;
      box.replaceChildren();
      for (const spec of KINDS) {
        const value = stored[spec.kind];
        if (value === undefined) {
          row(box, spec.label, null, NOT_SUPPLIED);
          continue;
        }
        if (value.ok === false) {
          row(box, spec.label, "refused", NOT_SUPPLIED, "text-error");
          box.appendChild(el("div", "text-error leading-snug", value.error));
          continue;
        }
        if (value.note !== undefined) {
          // Validation mode writes these itself. It says so instead of
          // reporting a byte count and a digest for a file nobody supplied.
          row(box, spec.label, value.note, NOT_SUPPLIED, "text-tertiary");
          codeRow(box, "stored as", value.storedAs);
          continue;
        }
        row(box, spec.label, `${value.byteLength} bytes`, NOT_SUPPLIED, "text-on-surface");
        codeRow(box, "stored as", value.storedAs);
        codeRow(box, "sha256", value.sha256);
      }
      box.appendChild(
        el(
          "div",
          "text-outline leading-snug",
          "Supplied by you and kept beside the session. Evidence that carries its own trust is refused.",
        ),
      );
    },

    /** Clears the inputs when the selection changes; nothing carries over. */
    reset() {
      for (const spec of KINDS) elements[spec.element].value = "";
    },
  };
}
