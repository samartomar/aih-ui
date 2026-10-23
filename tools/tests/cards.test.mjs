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
    querySelectorAll(selector) {
      assert.equal(selector, '.material-symbols-outlined');
      return this.children.flatMap(descendants).filter(node => node.className.split(' ').includes('material-symbols-outlined'));
    },
  };
}
function renderCard(t, description, evidence, model = {}) {
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
  createCards({ elements, onSelect: id => selections.push(id) }).render({ entries: [entry], total: 1, selectedId: null, ...model, ...(evidence ? { evidence: new Map([["fixture.skill", evidence]]) } : {}) });
  return { node: elements.cardsGrid.children[0], selections };
}
function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }

test("skill cards share the puzzle icon and preserve full description text for clamping", (t) => {
  const text = "A long published description. ".repeat(20);
  const { node, selections } = renderCard(t, text);
  const nodes = descendants(node);
  const icon = nodes.find(e => e.className.includes("material-symbols-outlined"));
  assert.equal(KIND_ICON.skill, "extension");
  assert.equal(icon.textContent, KIND_ICON.skill);
  assert.match(icon.className, new RegExp(KIND_TONE.skill));
  const description = nodes.find(e => e.className.includes("wb-card-description"));
  assert.equal(description.textContent, text);
  assert.match(description.className, /text-wb-card-description/);
  assert.match(description.className, /line-clamp-3/);
  node.listeners.keydown({ key: "Enter", target: node, preventDefault() {} });
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
test("missing evidence keeps its exact accessible reason and tokens stay unknown", (t) => {
  const { node } = renderCard(t, "Described");
  const status = pill(node);
  assert.equal(status.dataset.evidenceState, "not-supplied");
  const gap = descendants(status).find(node => node.attributes['aria-label'] === 'Not supplied');
  assert.ok(gap);
  const tooltip = descendants(status).find(node => node.attributes.role === 'tooltip');
  assert.equal(gap.attributes['aria-describedby'], tooltip.id);
  assert.equal(tooltip.textContent, `Not supplied: ${EVIDENCE_STATE['not-supplied'].title()}`);
  const text = descendants(node).map(e => e.textContent).join("|");
  assert.equal(text.includes("Not published"), false);
  assert.match(text, /\|Unknown\|/);
});

test("each supplied evidence state renders its own text, and matched is not authentication", (t) => {
  for (const [state, text] of [["invalid", "Invalid evidence"], ["unsupported", "Unsupported report"], ["mismatched", "Mismatched"], ["matched", "Matched"]]) {
    const status = pill(renderCard(t, "Described", { state, scanId: "scan-1" }).node);
    assert.equal(status.dataset.evidenceState, state);
    assert.equal(status.children[1].textContent, text);
    assert.equal(EVIDENCE_STATE[state].text, text);
  }
  assert.match(pill(renderCard(t, "Described", { state: "matched", scanId: "scan-1" }).node).title, /scan-1.*unchecked; this is not an approval or execution authority/);
});

test("keyboard activation on Add does not inspect its parent card", t => {
  const { node, selections } = renderCard(t, 'Described');
  const choose = descendants(node).find(node => node.textContent === 'Add');
  assert.ok(choose);
  for (const key of ['Enter', ' ']) node.listeners.keydown({ key, target: choose, preventDefault() { assert.fail('Parent must not cancel child keyboard input'); } });
  assert.deepEqual(selections, []);
});

test("accepted draft roots stay chosen even without executable intent roots, and offer Remove from the draft", t => {
  const { node } = renderCard(t, 'Described', undefined, {
    intent: { roots: [] }, acceptedRoots: [{ itemId: 'fixture', releaseSha256: 'a'.repeat(64) }], acceptedLabel: 'In draft', setupWord: 'draft',
  });
  const choice = descendants(node).find(node => node.textContent === 'Remove');
  assert.ok(choice);
  assert.equal(choice.disabled, false);
  assert.equal(choice.attributes['aria-label'], 'Remove fixture');
  assert.match(choice.title, /draft/);
  assert.equal(descendants(node).some(node => node.textContent === 'Add'), false);
});

test("a card's Add reads Adding… while it adds", async t => {
  let finish;
  const { node } = renderCard(t, 'Described', undefined, { onChoose: () => new Promise(resolve => { finish = resolve; }) });
  const add = descendants(node).find(node => node.textContent === 'Add');
  assert.equal(add.attributes['aria-label'], 'Add fixture');
  const pending = add.listeners.click({ stopPropagation() {} });
  assert.equal(add.textContent, 'Adding…'); assert.equal(add.disabled, true); assert.equal(add.attributes['aria-busy'], 'true');
  finish(); await pending;
  assert.equal(add.textContent, 'Add'); assert.equal(add.attributes['aria-busy'], undefined);
});

test("a chosen item's card offers Remove (#144), reads Removing… while it removes, and keeps its card from being inspected", async t => {
  let finish; const removed = [];
  const { node, selections } = renderCard(t, 'Described', undefined, { acceptedRoots: [{ itemId: 'fixture', releaseSha256: 'a'.repeat(64) }],
    onRemove: (item, entryId) => { removed.push([item.id, entryId]); return new Promise(resolve => { finish = resolve; }); } });
  const remove = descendants(node).find(node => node.textContent === 'Remove');
  assert.ok(remove); assert.equal(remove.disabled, false); assert.equal(remove.attributes['aria-label'], 'Remove fixture');
  assert.match(remove.title, /setup/);
  const pending = remove.listeners.click({ stopPropagation() {} });
  assert.equal(remove.textContent, 'Removing…'); assert.equal(remove.disabled, true); assert.equal(remove.attributes['aria-busy'], 'true');
  finish(); await pending;
  assert.deepEqual(removed, [['fixture', 'fixture.skill']]);
  assert.deepEqual(selections, [], 'Remove does not inspect the card');
  assert.equal(remove.attributes['aria-busy'], undefined);
  assert.equal(descendants(node).some(node => node.textContent === 'Added'), false, 'no disabled Added state any more');
});

test("an item already in the setup as a needed item says who needs it and offers no second Add", t => {
  const { node } = renderCard(t, 'Described', undefined, { acceptedRoots: [{ itemId: 'set.complete', releaseSha256: 'a'.repeat(64) }],
    neededBy: item => item.id === 'fixture' ? 'In your setup (needed by Whole set)' : '' });
  const shown = descendants(node).find(node => node.textContent === 'In your setup (needed by Whole set)');
  assert.ok(shown, 'the card names the chosen set that needs it');
  assert.equal(shown.disabled, true);
  assert.equal(shown.attributes['aria-label'], 'In your setup (needed by Whole set): fixture');
  assert.equal(descendants(node).some(node => node.textContent === 'Add'), false);
  // Chosen directly wins: it offers Remove.
  const chosen = renderCard(t, 'Described', undefined, { acceptedRoots: [{ itemId: 'fixture', releaseSha256: 'a'.repeat(64) }], neededBy: () => 'In your setup (needed by Whole set)' }).node;
  assert.ok(descendants(chosen).some(node => node.textContent === 'Remove'));
});

test("returning to the catalog focuses the chosen card when the grid shows it, and reports when it does not", t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  let focused = null;
  globalThis.document = { createElement: tag => Object.assign(element(tag), { focus() { focused = this; } }) };
  t.after(() => { if (previous) Object.defineProperty(globalThis, "document", previous); else delete globalThis.document; });
  const entry = id => ({ entryId: id, subject: { id, kind: "skill", subjectDigest: `sha256:${id}`, source: { type: "github" } } });
  const elements = Object.fromEntries(["cardsGrid", "visibleCount", "visibleCaption", "categoryContext"].map(key => [key, element("div")]));
  const cards = createCards({ elements, onSelect() {} });
  cards.render({ entries: [entry("a.skill"), entry("b.skill")], total: 2, selectedId: null });
  assert.equal(cards.focus("b.skill"), true);
  assert.equal(focused.dataset.cardId, "b.skill");
  assert.equal(cards.focus("not-shown.skill"), false);
  assert.equal(cards.focus(null), false);
});

test("a card names its framework as the left panel does, and the default release as other Catalog content", (t) => {
  for (const [family, label] of [["Extensions", "AIH-Extensions"], ["Catalog", "Other Catalog content"], ["ECC", "ECC"]]) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
    globalThis.document = { createElement: element };
    const entry = { entryId: `${family}.skill`, subject: { id: "x", kind: "skill", source: { type: "family" } },
      authoringItem: { id: "x", label: "X", family, description: "d", root: { releaseSha256: "a".repeat(64), itemId: "x" } } };
    const elements = Object.fromEntries(["cardsGrid", "visibleCount", "visibleCaption", "categoryContext"].map(key => [key, element("div")]));
    createCards({ elements, onSelect() {} }).render({ entries: [entry], total: 1, selectedId: null });
    if (previous) Object.defineProperty(globalThis, "document", previous); else delete globalThis.document;
    const card = elements.cardsGrid.children[0];
    assert.equal(card.dataset.categoryLabel, label);
    const badge = descendants(card).find(node => node.textContent === label);
    assert.ok(badge, `${label} is shown on the card`);
    assert.doesNotMatch(badge.className, /uppercase/, "the name is shown as written");
    assert.equal(elements.categoryContext.textContent, `Content family · ${label}`);
  }
});

test("an Add or Remove still in flight keeps its busy label when the grid is redrawn meanwhile (#144)", t => {
  let called = false;
  const { node } = renderCard(t, 'Described', undefined, { acceptedRoots: [{ itemId: 'fixture', releaseSha256: 'a'.repeat(64) }], busy: new Map([['fixture.skill', 'Removing…']]),
    onRemove: () => { called = true; } });
  const busy = descendants(node).find(node => node.textContent === 'Removing…');
  assert.ok(busy); assert.equal(busy.disabled, true); assert.equal(busy.attributes['aria-busy'], 'true');
  busy.listeners.click({ stopPropagation() {} });
  assert.equal(called, false);
});
