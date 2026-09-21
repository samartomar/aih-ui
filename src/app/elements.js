/*
 * The shell's own elements: the two rails, their toggles, the inspector tabs
 * and the error banner. The features look up their own elements separately.
 */

import { collectIds } from "./dom.js";

export function shellElements() {
  const ids = [
    "nav-rail", "toggle-nav-btn", "inspector-rail", "toggle-inspector-btn", "close-inspector-btn",
    "pane-details", "pane-security", "pane-governance", "pane-json", "catalog-error",
  ];
  const found = collectIds(ids);
  found.tabButtons = [...document.querySelectorAll(".inspector-tab-btn")];
  return found;
}

/** The header's organization control and every node of its setup popup. */
export function organizationElements() {
  const ids = [
    "org-modal-trigger", "org-trigger-label", "org-modal-overlay", "org-form",
    "close-org-modal-btn", "cancel-org-modal-btn", "save-org-modal-btn",
    "org-input-name", "org-input-id", "org-input-repo", "org-input-email", "org-add-email-btn",
    "org-email-list", "org-posture",
    "org-error-name", "org-error-id", "org-error-repo", "org-error-email",
  ];
  return collectIds(ids);
}
