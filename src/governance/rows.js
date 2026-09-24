/*
 * The one row shape every Governance display uses.
 *
 * A null value is rendered as the absence word the caller passes, so the pane
 * always says which absence it means: "Not supplied" for operator input nobody
 * has given, "Not published" for package data the index does not carry.
 */

import { el } from "../app/dom.js";
import { NOT_SUPPLIED } from "../app/absence.js";

export function row(parent, label, value, absent = NOT_SUPPLIED, tone, code = false) {
  const present = value !== null && value !== undefined && value !== "";
  const node = el("div", `inspector-row ${code && present ? "inspector-row-code" : ""}`);
  node.appendChild(el("span", "text-outline shrink-0", label));
  const shown = value === null || value === undefined || value === "" ? absent : String(value);
  const valueNode = el(
    code && present ? "code" : "span",
    code && present ? "inspector-code-value" : `${tone ?? (value ? "text-on-surface" : "text-outline")}`,
    shown,
  );
  node.appendChild(valueNode);
  parent.appendChild(node);
  return node;
}

/** Display exact identifiers/paths/digests as selectable text, never editable HTML. */
export function codeRow(parent, label, value, absent = NOT_SUPPLIED) {
  return row(parent, label, value, absent, undefined, true);
}
