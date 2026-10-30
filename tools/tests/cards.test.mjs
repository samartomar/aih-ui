import { test } from "node:test";
import assert from "node:assert/strict";
import { createCards, EVIDENCE_STATE } from "../../src/catalog/cards.js";
import { itemBrowseFacts } from "../../src/catalog/browse-facts.js";
import { ICONS } from "../../src/app/icons.js";

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
  globalThis.document = { createElement: element, createElementNS: (_namespace, tag) => element(tag) };
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete globalThis.document;
  });
  const entry = { entryId: "fixture.skill", subject: { id: "fixture", kind: "skill", subjectDigest: "sha256:fixture", source: { type: "github" } },
    ...(description === null ? {} : { authoringItem: { id: "fixture", label: "Fixture", family: "fixture-family", description, root: { releaseSha256: "a".repeat(64), itemId: "fixture" }, ...(model.authoringItem ?? {}) } }) };
  const elements = Object.fromEntries(["cardsGrid", "visibleCount", "visibleCaption", "categoryContext"].map(key => [key, element("div")]));
  const selections = [];
  createCards({ elements, onSelect: id => selections.push(id) }).render({ entries: [entry], total: 1, selectedId: null, ...model, ...(evidence ? { evidence: new Map([["fixture.skill", evidence]]) } : {}) });
  return { node: elements.cardsGrid.children[0], selections };
}
function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }

test("skill cards use the shared skill icon and preserve full description text for clamping", (t) => {
  const text = "A long published description. ".repeat(20);
  const { node, selections } = renderCard(t, text);
  const nodes = descendants(node);
  const icon = nodes.find(e => e.className.includes("material-symbols-outlined"));
  assert.equal(ICONS.kind.skill.icon, "auto_awesome");
  assert.equal(icon.dataset.tooltip, "Kind: Skill", "the kind icon carries its words, so it is not hidden as decoration");
  assert.equal(icon.title, "Kind: Skill");
  assert.equal(icon.textContent, ICONS.kind.skill.icon);
  assert.match(icon.className, new RegExp(ICONS.kind.skill.tone));
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
  assert.equal(status.children[0].dataset.icon, "scan:not-scanned");
  const gap = descendants(status).find(node => node.attributes['aria-label'] === 'Not supplied');
  assert.ok(gap);
  const tooltip = descendants(status).find(node => node.attributes.role === 'tooltip');
  assert.equal(gap.attributes['aria-describedby'], tooltip.id);
  assert.equal(tooltip.textContent, `Not supplied: ${EVIDENCE_STATE['not-supplied'].title()}`);
  const text = descendants(node).map(e => e.textContent).join("|");
  assert.equal(text.includes("Not published"), false);
  assert.match(text, /(?:^|\|)Unknown(?:\||$)/);
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

test("returning to the catalog focuses the chosen card when the grid shows it, and reports when it does not", t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  let focused = null;
  globalThis.document = { createElement: tag => Object.assign(element(tag), { focus() { focused = this; } }), createElementNS: (_namespace, tag) => element(tag) };
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

test("an Add or Remove still in flight keeps its busy label when the grid is redrawn meanwhile (#144)", t => {
  let called = false;
  const { node } = renderCard(t, 'Described', undefined, { acceptedRoots: [{ itemId: 'fixture', releaseSha256: 'a'.repeat(64) }], busy: new Map([['fixture.skill', 'Removing…']]),
    onRemove: () => { called = true; } });
  const busy = descendants(node).find(node => node.textContent === 'Removing…');
  assert.ok(busy); assert.equal(busy.disabled, true); assert.equal(busy.attributes['aria-busy'], 'true');
  busy.listeners.click({ stopPropagation() {} });
  assert.equal(called, false);
});

test('fit words distinguish recognised, listed-only and stale observations', () => {
  const item = { id: 'rule' };
  const compatibility = observed => ({ items: [{ item: { itemId: 'rule' }, support: 'native', observed, reason: '', observedOn: { observedAt: '2026-10-23', toolVersion: '2.1.0', os: 'linux', arch: 'x64' } }] });
  assert.equal(itemBrowseFacts(item, { compatibility: compatibility('recognised') }, { label: 'Claude Code' }).words,
    'Works in Claude Code (seen 2026-10-23, 2.1.0, on linux)');
  assert.equal(itemBrowseFacts(item, { compatibility: compatibility('listed-only') }, { label: 'Claude Code' }).words,
    'Claude Code sees its name; not yet seen using it');
  const stale = compatibility('registered'); stale.items[0].stale = true;
  assert.equal(itemBrowseFacts(item, { compatibility: stale }, { label: 'Claude Code' }).words,
    'Last confirmed 2026-10-23 on 2.1.0');
});

test('card names include the Catalog namespace, not the raw id as a namespace', t => {
  const { node } = renderCard(t, 'Described', undefined, { authoringItem: { name: 'coding-style', role: 'choosable', payload: { namespace: 'typescript' } } });
  assert.equal(descendants(node).find(value => value.className.includes('wb-card-title')).textContent, 'coding-style (typescript)');
  assert.equal(descendants(node).find(value => value.className.includes('card-namespace')).textContent, 'typescript');
});

test('tool hints use registry labels and variants name the referenced item', t => {
  const { node } = renderCard(t, 'Described', undefined, {
    authoringItem: { role: 'choosable', hints: { tools: ['claude-code'] }, variantOf: { framework: 'ecc', itemId: 'base-rule' } },
    browse: { toolLabels: { 'claude-code': 'Claude Code' }, items: [{ id: 'base-rule', name: 'tdd' }] },
  });
  const words = descendants(node).map(value => value.textContent).join('|');
  assert.match(words, /Written for Claude Code/);
  assert.match(words, /Claude Code version of tdd/);
  assert.doesNotMatch(words, /Written for claude-code|Variant of base-rule/);
});

test("a chosen item whose tool check did not run is named on its card, never by its id or Core's code", t => {
  const browse = { chosenItemIds: ["fixture"], host: { status: "unavailable", reason: "user-root-not-observed" } };
  const { node } = renderCard(t, "Described", undefined, { browse, authoringItem: { id: "acme.fixture-rule", name: "coding-style", role: "choosable", payload: { namespace: "typescript" } } });
  const words = descendants(node).filter(value => value.dataset.state === "not-reported").map(value => descendants(value).map(child => child.textContent).join(""));
  assert.deepEqual(words, [], "the fixture's own id is not chosen");
  const chosen = renderCard(t, "Described", undefined, { browse: { ...browse, chosenItemIds: ["acme.fixture-rule"] }, authoringItem: { id: "acme.fixture-rule", name: "coding-style", role: "choosable", payload: { namespace: "typescript" } } });
  const badge = descendants(chosen.node).find(value => value.dataset.state === "not-reported");
  assert.equal(badge.children[1].textContent, "Couldn't check whether your tool already has coding-style (typescript).");
});
