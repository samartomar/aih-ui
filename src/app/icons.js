/*
 * One icon per contract value, the same everywhere.
 *
 * ICONS maps each value the screen shows to a Material Symbols name (the font
 * the page already loads), a semantic colour class and the words that go with
 * it. Colour is never the only signal: every icon is decorative (aria-hidden)
 * and sits beside its words or a tooltip that carries them.
 *
 * Colour roles: green only for Verified and confirmed on disk; amber means
 * "needs you"; red is blocked or failed; blue is information; grey is a
 * neutral fact. The classes are Tailwind utilities over the theme roles in
 * src/styles/tokens.css, so both themes follow.
 *
 * Every group is total over its contract enum. A value outside it (a newer
 * contract, or a value today's packages report that the contracts do not name)
 * gets the group's neutral icon and its own value as words; nothing throws.
 */

import { el } from "./dom.js";

const NEUTRAL = "text-outline";

/* Content kinds (Catalog release `kind`). `mcp` is the value today's installed
   Catalog reports for an MCP server; the contracts call it `mcp-server`. Other
   kinds today's Catalog reports are not contract kinds and get the neutral icon. */
const KIND = {
  skill: { icon: "auto_awesome", tone: "text-kind-skill", label: "Skill" },
  rule: { icon: "rule", tone: "text-kind-rule", label: "Rule" },
  command: { icon: "terminal", tone: "text-kind-command", label: "Command" },
  agent: { icon: "smart_toy", tone: "text-kind-agent", label: "Agent" },
  hook: { icon: "bolt", tone: "text-kind-hook", label: "Hook" },
  "mcp-server": { icon: "hub", tone: "text-kind-mcp", label: "MCP server" },
  mcp: { icon: "hub", tone: "text-kind-mcp", label: "MCP server" },
  document: { icon: "description", tone: "text-kind-document", label: "Document" },
};

/* How far "works in your tool" was proven (Core compatibility `support`). */
const FIT = {
  recognised: { icon: "check_circle", fill: true, tone: "text-primary", label: "Works in {tool}" },
  registered: { icon: "playlist_add_check", tone: "text-primary", label: "{tool} lists it; not yet seen in use" },
  "listed-only": { icon: "visibility", tone: NEUTRAL, label: "{tool} sees its name; not yet seen using it" },
  unconfirmed: { icon: "help", tone: NEUTRAL, label: "Not yet confirmed for {tool}." },
  none: { icon: "block", tone: "text-error", label: "Doesn't work in {tool}" },
};

/* Scan item summary `state`. "Verified" is the only positive scan word, and the
   only green one. */
const SCAN = {
  verified: { icon: "verified_user", fill: true, tone: "text-secondary", label: "Verified" },
  "not-verified": { icon: "shield", tone: "text-on-surface-variant", label: "Scanned, not verified" },
  partial: { icon: "gpp_maybe", tone: "text-tertiary", label: "Scan incomplete" },
  "not-covered": { icon: "shield_question", tone: "text-tertiary", label: "The scan offered covers other files" },
  unreadable: { icon: "gpp_bad", tone: "text-error", label: "Scan record can't be read" },
  "not-scanned": { icon: "remove_moderator", tone: NEUTRAL, label: "No scan record" },
};

/* States and hints (install preview, inventory, item detail). */
const STATE = {
  "needs-ok": { icon: "lock_open", tone: "text-tertiary", label: "Still needs your OK" },
  "two-copies": { icon: "content_copy", tone: "text-tertiary", label: "Would make two copies" },
  "changed-since-install": { icon: "edit_note", tone: "text-tertiary", label: "Changed since install" },
  "block-edited": { icon: "edit_document", tone: "text-tertiary", label: "AIH block edited" },
  "update-available": { icon: "upgrade", tone: "text-info", label: "Update available" },
  "first-run": { icon: "play_circle", tone: "text-info", label: "First-run step" },
  "plugin-route": { icon: "extension", tone: "text-info", label: "Also available as the tool's own plugin" },
  "on-request": { icon: "touch_app", tone: "text-on-surface-variant", label: "Only when you ask for it" },
  size: { icon: "data_usage", tone: "text-on-surface-variant", label: "Estimated size" },
  replaced: { icon: "swap_horiz", tone: "text-on-surface-variant", label: "Replaced by" },
  "no-longer-offered": { icon: "archive", tone: "text-on-surface-variant", label: "No longer offered" },
  provenance: { icon: "account_tree", tone: "text-on-surface-variant", label: "Where it came from" },
  policy: { icon: "gavel", tone: "text-error", label: "Organisation policy" },
  "confirmed-on-disk": { icon: "task_alt", tone: "text-secondary", label: "Confirmed on disk" },
  languages: { icon: "translate", tone: "text-on-surface-variant", label: "Languages picked" },
  "starting-set": { icon: "inventory_2", tone: "text-on-surface-variant", label: "Starting set" },
  info: { icon: "info", tone: "text-info", label: "Information" },
};

export const ICONS = Object.freeze({ kind: KIND, fit: FIT, scan: SCAN, state: STATE });

/* The neutral icon for a value a group does not name. */
const FALLBACK = {
  kind: { icon: "category", tone: NEUTRAL },
  fit: { icon: "radio_button_unchecked", tone: NEUTRAL },
  scan: { icon: "radio_button_unchecked", tone: NEUTRAL },
  state: { icon: "radio_button_unchecked", tone: NEUTRAL },
};

/**
 * The icon for one contract value. Never throws: an unknown group or value
 * returns a neutral icon whose label is the value itself.
 * @returns {{ icon: string, tone: string, label: string, fill: boolean, known: boolean }}
 */
export function iconFor(group, value) {
  const table = Object.hasOwn(ICONS, group) ? ICONS[group] : null;
  const key = typeof value === "string" ? value : String(value ?? "");
  const found = table && Object.hasOwn(table, key) ? table[key] : null;
  if (found) return { fill: false, ...found, known: true };
  const fallback = Object.hasOwn(FALLBACK, group) ? FALLBACK[group] : FALLBACK.state;
  return { ...fallback, label: key || "Unknown", fill: false, known: false };
}

/**
 * A decorative icon span: aria-hidden, with the value's semantic colour class.
 * The words belong next to it or in a tooltip (src/app/tooltip.js).
 * @param size a Tailwind text size class, e.g. "text-[14px]"
 */
export function iconSpan(group, value, { size = "text-[14px]", className = "" } = {}) {
  const shown = iconFor(group, value);
  const node = el("span", `material-symbols-outlined ${size} ${shown.tone}${shown.fill ? " wb-icon-filled" : ""}${className ? ` ${className}` : ""}`, shown.icon);
  node.setAttribute("aria-hidden", "true");
  node.dataset.icon = `${group}:${shown.known ? value : "unknown"}`;
  return node;
}
