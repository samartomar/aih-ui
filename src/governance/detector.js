/*
 * Detector provenance, and the validation-mode button that can produce some.
 *
 * Attestation verification and detector execution are TWO ROWS, always shown
 * together. `attestationVerified` is a statement about a signature and its
 * binding; it is not a statement that any measurement occurred. Only the
 * operator's own trust configuration carries `evidenceProvenance`, and that is
 * the only thing that can say whether a detector ran - it is never inferred
 * from the evidence.
 *
 * Everything this component can show today is a labelled fixture, and it says
 * so wherever it appears.
 */

import { el } from "../app/dom.js";
import { NOT_SUPPLIED } from "../app/absence.js";
import { row } from "./rows.js";

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

      const attestationVerified =
        view !== null && view.evidenceClaim === "scan-attestation-v2" && view.evidence === "verified";
      row(
        box,
        "Attestation",
        view === null ? null : attestationVerified ? "Attestation verified" : "Attestation not verified",
        NOT_SUPPLIED,
        view === null ? undefined : attestationVerified ? "text-primary" : "text-error",
      );

      if (fixture === null) {
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
      row(box, "Detector execution", fixture.label, NOT_SUPPLIED, "text-tertiary");
      row(box, "Detector executed", String(fixture.detectorExecuted), NOT_SUPPLIED, "text-tertiary");
      row(box, "Signer keyId", fixture.keyId);
      row(box, "Sealed files", `${fixture.sealedFileCount} from the installed package`);
      box.appendChild(el("div", "text-outline leading-snug", fixture.note));
    },
  };
}
