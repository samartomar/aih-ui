/*
 * The shell's own elements: the two rails, their toggles, the inspector tabs
 * and the error banner. The features look up their own elements separately.
 */

import { collectIds } from "./dom.js";

export function shellElements() {
  const ids = [
    "nav-rail", "toggle-nav-btn", "inspector-rail", "toggle-inspector-btn", "close-inspector-btn",
    "pane-details", "pane-security", "pane-json", "catalog-error",
    "nav-sources", "nav-policy", "nav-scan-review", "catalog-scopes-section", "framework-matrix-tabs",
    "catalog-workspace", "policy-workspace", "policy-workspace-title", "catalog-kinds-disclosure",
    "project-basics", "nav-project-basics", "project-basics-title",
  ];
  const found = collectIds(ids);
  found.tabButtons = [...document.querySelectorAll(".inspector-tab-btn")];
  return found;
}

/** The header's read-only saved setup view. */
export function organizationElements() {
  const ids = [
    "org-modal-trigger", "org-trigger-label", "org-modal-overlay", "org-modal-title",
    "close-org-modal-btn", "update-org-setup-btn", "org-setup-summary", "workbench-role",
  ];
  return collectIds(ids);
}

/** The header's Your tool control and its popup. */
export function yourToolElements() {
  return collectIds(["your-tool-trigger", "your-tool-icon", "your-tool-name", "your-tool-pop", "your-tool-list", "your-tool-note"]);
}
