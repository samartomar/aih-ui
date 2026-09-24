/*
 * The operator's own observation inputs: the upstream artifact manifest, the
 * root the files sit under, and the folder itself.
 *
 * Three inputs, because they are three separate statements the operator makes
 * about their own machine. The page collects them and hands the bytes over by
 * path; it parses no manifest, hashes nothing for verification and derives no
 * path from any file's contents. Core reads the manifest and the files at their
 * exact paths and decides, one to one against the verified scan, whether the
 * observation holds.
 *
 * Nothing here installs, applies or executes anything: the files are copied
 * into the session's consumption root only so Core has something to read.
 *
 * Nothing is generated. A part the operator has not supplied stays
 * "Not supplied", and consumption simply reports that no observation was made.
 */

import { el } from "../app/dom.js";
import { NOT_SUPPLIED } from "../app/absence.js";
import { row, codeRow } from "./rows.js";

/**
 * @param elements    { govObservationManifestFile, govObservationRoot, govObservationFiles, govObservation }
 * @param onManifest  called with the chosen manifest File
 * @param onRoot      called with the install root the operator typed
 * @param onFiles     called with the FileList of the chosen folder
 */
export function createObservation({ elements, onManifest, onRoot, onFiles }) {
  elements.govObservationManifestFile.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) onManifest(file);
  });
  // The typed root is read when the operator is done typing it, not on every
  // keystroke: each change re-uploads, and half a path is not a path.
  elements.govObservationRoot.addEventListener("change", (event) => onRoot(event.target.value));
  elements.govObservationFiles.addEventListener("change", (event) => {
    const files = event.target.files;
    if (files && files.length > 0) onFiles(files);
  });

  return {
    /**
     * @param view  { manifest, installRoot, files, stored } - what the operator
     *              chose, and what the backend reported storing, or null
     */
    render(view) {
      const box = elements.govObservation;
      box.replaceChildren();
      const stored = view?.stored ?? null;

      if (stored !== null && stored.ok === false) {
        row(box, "Observation", "refused", NOT_SUPPLIED, "text-error");
        box.appendChild(el("div", "text-error leading-snug", stored.error));
      }

      // Once the backend has the bytes, what is shown is what it stored: the
      // name it gave them, their length and their digest. Before that, the page
      // can only say which file the operator picked.
      if (stored?.ok === true) {
        row(box, "Manifest", `${stored.manifest.byteLength} bytes`, NOT_SUPPLIED, "text-on-surface");
        codeRow(box, "stored as", stored.manifest.storedAs);
        codeRow(box, "sha256", stored.manifest.sha256);
      } else {
        row(box, "Manifest", view?.manifest?.name ?? null, NOT_SUPPLIED);
      }

      codeRow(
        box,
        "Install root",
        (stored?.ok === true ? stored.installRoot : view?.installRoot) || null,
        NOT_SUPPLIED,
      );

      if (stored?.ok === true) {
        row(box, "Files", `${stored.files.length}`, NOT_SUPPLIED, "text-on-surface");
        for (const file of stored.files) {
          codeRow(box, "file", `${file.relativePath} ${file.sha256.slice(0, 12)} ${file.byteLength} B`);
        }
      } else {
        row(box, "Files", view?.files?.length ? `${view.files.length} chosen` : null, NOT_SUPPLIED);
      }

      box.appendChild(
        el(
          "div",
          "text-outline leading-snug",
          "Supplied by you and uploaded into this session's temporary workspace. Core reads those copies at their exact paths, which proves the snapshot you supplied matches the scan - not that these files are still in place on your machine. Nothing is installed, applied or executed.",
        ),
      );
    },

    /** Clears the inputs when the selection changes; nothing carries over. */
    reset() {
      elements.govObservationManifestFile.value = "";
      elements.govObservationFiles.value = "";
      elements.govObservationRoot.value = "";
    },
  };
}
