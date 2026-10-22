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

/** The Core tools control in the Settings menu and its panel. */
export function aiToolsElements() {
  return collectIds(["ai-tools-trigger", "ai-tools-count", "ai-tools-pop", "ai-tools-list", "ai-tools-note"]);
}
