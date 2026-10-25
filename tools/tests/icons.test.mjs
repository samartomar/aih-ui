import { test } from "node:test";
import assert from "node:assert/strict";
import { ICONS, iconFor, iconSpan } from "../../src/app/icons.js";

// The contract enums the screens show (contracts v3.2: workbench-reads and the approved visual rule).
const ENUMS = {
  kind: { skill: "auto_awesome", rule: "rule", command: "terminal", agent: "smart_toy", hook: "bolt", "mcp-server": "hub", document: "description" },
  fit: { recognised: "check_circle", registered: "playlist_add_check", "listed-only": "visibility", unconfirmed: "help", none: "block" },
  scan: { verified: "verified_user", "not-verified": "shield", partial: "gpp_maybe", "not-covered": "shield_question", unreadable: "gpp_bad", "not-scanned": "remove_moderator" },
  state: {
    "needs-ok": "lock_open", "two-copies": "content_copy", "changed-since-install": "edit_note", "block-edited": "edit_document",
    "update-available": "upgrade", "first-run": "play_circle", "plugin-route": "extension", "on-request": "touch_app", size: "data_usage",
    replaced: "swap_horiz", "no-longer-offered": "archive", provenance: "account_tree", policy: "gavel", "confirmed-on-disk": "task_alt",
    languages: "translate", "starting-set": "inventory_2",
  },
};
const SEMANTIC = /^text-(kind-(skill|rule|command|agent|hook|mcp|document)|primary|secondary|tertiary|error|info|outline|on-surface-variant)$/;

function element(tag) {
  return { tagName: tag, children: [], dataset: {}, attributes: {}, className: "", textContent: "",
    setAttribute(name, value) { this.attributes[name] = value; } };
}
function withDocument(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  globalThis.document = { createElement: element };
  t.after(() => { if (previous) Object.defineProperty(globalThis, "document", previous); else delete globalThis.document; });
}

test("every contract value has its approved icon, a semantic colour and words", () => {
  for (const [group, values] of Object.entries(ENUMS)) {
    for (const [value, icon] of Object.entries(values)) {
      const shown = iconFor(group, value);
      assert.equal(shown.known, true, `${group}:${value}`);
      assert.equal(shown.icon, icon, `${group}:${value}`);
      assert.match(shown.tone, SEMANTIC, `${group}:${value}`);
      assert.ok(shown.label.length > 0, `${group}:${value}`);
    }
  }
  assert.equal(Object.keys(ICONS.state).filter(key => key !== "info").length, 16, "the sixteen state icons of the visual rule");
});

test("green is reserved for Verified and confirmed on disk; works and Verified are filled; the hook accent is its own", () => {
  const green = Object.entries(ICONS).flatMap(([group, values]) => Object.entries(values).filter(([, value]) => value.tone === "text-secondary").map(([key]) => `${group}:${key}`));
  assert.deepEqual(green.sort(), ["scan:verified", "state:confirmed-on-disk"]);
  assert.equal(iconFor("fit", "recognised").fill, true);
  assert.equal(iconFor("scan", "verified").fill, true);
  assert.equal(iconFor("scan", "not-verified").fill, false);
  assert.equal(iconFor("kind", "hook").tone, "text-kind-hook");
  assert.equal(iconFor("scan", "partial").tone, "text-tertiary");
  assert.equal(iconFor("scan", "unreadable").tone, "text-error");
});

test("today's Catalog MCP kind shares the MCP server icon; other values fall back to a neutral icon without throwing", () => {
  assert.equal(iconFor("kind", "mcp").icon, iconFor("kind", "mcp-server").icon);
  for (const [group, value] of [["kind", "playbook"], ["kind", undefined], ["scan", null], ["fit", 7], ["state", { an: "object" }], ["nope", "skill"], [undefined, undefined]]) {
    const shown = iconFor(group, value);
    assert.equal(shown.known, false, `${String(group)}:${String(value)}`);
    assert.equal(shown.tone, "text-outline");
    assert.ok(shown.icon.length > 0);
    assert.ok(shown.label.length > 0);
  }
  assert.equal(iconFor("kind", "playbook").label, "playbook", "an unknown value keeps its own words, never a guessed kind");
  assert.equal(iconFor("kind", "instruction").label, "Instruction", "a kind today's Catalog reports keeps its own name, never another kind's");
  assert.equal(iconFor("scan", "__proto__").known, false);
});

test("iconSpan renders a decorative, coloured Material Symbols span", (t) => {
  withDocument(t);
  const span = iconSpan("scan", "verified", { size: "text-[12px]", className: "shrink-0" });
  assert.equal(span.textContent, "verified_user");
  assert.equal(span.attributes["aria-hidden"], "true");
  assert.match(span.className, /material-symbols-outlined text-\[12px\] text-secondary wb-icon-filled shrink-0/);
  assert.equal(span.dataset.icon, "scan:verified");
  const unknown = iconSpan("scan", "who-knows");
  assert.equal(unknown.dataset.icon, "scan:unknown");
  assert.match(unknown.className, /text-outline/);
});
