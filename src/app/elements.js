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
