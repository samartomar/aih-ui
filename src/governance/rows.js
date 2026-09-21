/*
 * The one row shape every Governance display uses.
 *
 * A null value is rendered as the absence word the caller passes, so the pane
 * always says which absence it means: "Not supplied" for operator input nobody
 * has given, "Not published" for package data the index does not carry.
 */

import { el } from "../app/dom.js";
import { NOT_SUPPLIED } from "../app/absence.js";

export function row(parent, label, value, absent = NOT_SUPPLIED, tone) {
  const node = el("div", "flex items-start justify-between gap-2");
  node.appendChild(el("span", "text-outline shrink-0", label));
  const shown = value === null || value === undefined || value === "" ? absent : String(value);
  const valueNode = el(
    "span",
    `text-right break-all ${tone ?? (value ? "text-on-surface" : "text-outline")}`,
    shown,
  );
  node.appendChild(valueNode);
  parent.appendChild(node);
  return node;
}
