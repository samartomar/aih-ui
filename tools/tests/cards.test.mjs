import { test } from "node:test";
import assert from "node:assert/strict";
import { createCards, EVIDENCE_STATE } from "../../src/catalog/cards.js";
import { KIND_ICON, KIND_TONE } from "../../src/catalog/entry.js";

function element(tag) {
  return {
    tagName: tag, children: [], dataset: {}, attributes: {}, listeners: {},
    className: "", textContent: "",
    appendChild(child) { this.children.push(child); return child; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(name, callback) { this.listeners[name] = callback; },
  };
}
function renderCard(t, description, evidence) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  globalThis.document = { createElement: element };
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete globalThis.document;
  });
  const entry = { entryId: "fixture.skill", subject: { id: "fixture", kind: "skill", subjectDigest: "sha256:fixture", source: { type: "github" } },
    ...(description === null ? {} : { authoringItem: { id: "fixture", label: "Fixture", family: "fixture-family", description, root: { releaseSha256: "a".repeat(64), itemId: "fixture" } } }) };
  const elements = Object.fromEntries(["cardsGrid", "visibleCount", "visibleCaption", "categoryContext"].map(key => [key, element("div")]));
  const selections = [];
  createCards({ elements, onSelect: id => selections.push(id) }).render({ entries: [entry], total: 1, selectedId: null, ...(evidence ? { evidence: new Map([["fixture.skill", evidence]]) } : {}) });
  return { node: elements.cardsGrid.children[0], selections };
}
function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }

test("skill cards use the shared skill icon and preserve full description text for clamping", (t) => {
  const text = "A long published description. ".repeat(20);
  const { node, selections } = renderCard(t, text);
  const nodes = descendants(node);
  const icon = nodes.find(e => e.className.includes("material-symbols-outlined"));
  assert.equal(KIND_ICON.skill, "auto_awesome");
  assert.equal(icon.attributes["aria-hidden"], "true");
  assert.equal(icon.title, "Kind: Skill");
  assert.equal(icon.textContent, KIND_ICON.skill);
  assert.match(icon.className, new RegExp(KIND_TONE.skill));
  const description = nodes.find(e => e.className.includes("wb-card-description"));
  assert.equal(description.textContent, text);
  assert.match(description.className, /text-wb-card-description/);
  assert.match(description.className, /line-clamp-3/);
  node.listeners.keydown({ key: "Enter", preventDefault() {} });
  assert.deepEqual(selections, ["fixture.skill"]);
});

test("unmapped local preferences remain unavailable without claiming an off state", (t) => {
  const { node } = renderCard(t, null);
  const button = descendants(node).find(e => e.className.includes("toggle-switch"));
  assert.equal(button.disabled, true);
  assert.equal(button.attributes["aria-disabled"], "true");
  assert.match(button.attributes["aria-label"], /Local preference unavailable/);
  assert.match(button.title, /Local preference not saved/);
  assert.equal(button.attributes["aria-checked"], undefined);
  assert.equal(button.dataset.active, undefined);
});

const pill = node => descendants(node).find(e => e.dataset.evidenceState);
test("missing evidence reads no scan record, never not published, and tokens stay unknown", (t) => {
  const { node } = renderCard(t, "Described");
  const status = pill(node);
  assert.equal(status.dataset.evidenceState, "not-supplied");
  assert.equal(status.children[1].textContent, "No scan record");
  assert.equal(status.children[0].dataset.icon, "scan:not-scanned");
  const text = descendants(node).map(e => e.textContent).join("|");
  assert.equal(text.includes("Not published"), false);
  assert.match(text, /\|Unknown\|/);
});

test("each supplied evidence state renders neutral scan words, and matched is not authentication or Verified", (t) => {
  for (const [state, text, scan] of [["invalid", "Scan record can't be read", "unreadable"], ["unsupported", "Scan record can't be read", "unreadable"], ["mismatched", "The scan offered covers other files", "not-covered"], ["matched", "Scanned, not verified (unchecked)", "not-verified"], ["unavailable", "Not assessable", "unknown"]]) {
    const status = pill(renderCard(t, "Described", { state, scanId: "scan-1" }).node);
    assert.equal(status.dataset.evidenceState, state);
    assert.equal(status.children[1].textContent, text);
    assert.equal(EVIDENCE_STATE[state].text, text);
    assert.equal(status.children[0].dataset.icon, `scan:${scan}`);
    assert.equal(status.children[0].attributes["aria-hidden"], "true");
  }
  assert.match(pill(renderCard(t, "Described", { state: "matched", scanId: "scan-1" }).node).title, /scan-1.*unchecked; this is not an approval or execution authority/);
});

test("no evidence state can say Verified or another positive scan word, and none is green", () => {
  for (const [state, shown] of Object.entries(EVIDENCE_STATE)) {
    const words = `${shown.text} ${shown.title({ scanId: "scan-1" })}`.replace(/not verified/gi, "");
    assert.doesNotMatch(words, /\bverified\b/i, state);
    assert.doesNotMatch(words, /\b(safe|clean|passed)\b/i, state);
    assert.notEqual(shown.scan, "verified", state);
  }
});
