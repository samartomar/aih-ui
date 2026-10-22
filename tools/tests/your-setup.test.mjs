import test from 'node:test';
import assert from 'node:assert/strict';
import { setupEntry } from '../../src/app/setup-entry.js';

test('the header entry counts the chosen items of the current setup, and says only "Your setup" when there are none', () => {
  assert.equal(setupEntry({ intent: { roots: [{ itemId: 'grill-me' }] } }).label, 'Your setup (1)');
  assert.equal(setupEntry({ intent: { roots: [{}, {}, {}] } }).label, 'Your setup (3)');
  assert.equal(setupEntry({ intent: { roots: [] } }).label, 'Your setup');
  assert.equal(setupEntry({}).label, 'Your setup');
});

test('an open draft is the current setup; a proposal not yet accepted is not counted', () => {
  assert.equal(setupEntry({ draft: { roots: [{}, {}] }, intent: { roots: [{}] } }).label, 'Your setup (2)');
  assert.equal(setupEntry({ intent: { roots: [{}] }, candidate: { intent: { roots: [{}, {}] } } }).label, 'Your setup (1)');
});

test('the entry names what it opens in the Workbench words', () => {
  const { title, accessibleName } = setupEntry({ intent: { roots: [{}] } });
  assert.match(title, /Project folder/); assert.match(title, /Install/); assert.match(title, /installed items/);
  assert.equal(accessibleName, 'Your setup: 1 chosen item. Open the Project folder, Install and installed items');
  assert.equal(setupEntry({ intent: { roots: [{}, {}] } }).accessibleName, 'Your setup: 2 chosen items. Open the Project folder, Install and installed items');
  assert.equal(setupEntry({}).accessibleName, 'Your setup: nothing chosen yet. Open the Project folder, Install and installed items');
});

// A small DOM: enough for the review drawer to build itself, open, close and move focus.
function fakeNode(tag, registry) {
  const node = { tag, children: [], attributes: {}, listeners: {}, dataset: {}, hidden: false, textContent: '', className: '', parentElement: null, get childNodes() { return this.children; },
    append(...children) { for (const child of children) { if (typeof child === 'object') { child.parentElement = this; this.children.push(child); } } },
    prepend(...children) { this.append(...children); }, after() {}, replaceChildren(...children) { this.children = []; this.append(...children); },
    replaceWith() {}, setAttribute(key, value) { this.attributes[key] = String(value); }, getAttribute(key) { return this.attributes[key]; }, removeAttribute(key) { delete this.attributes[key]; },
    addEventListener(key, fn) { (this.listeners[key] ??= []).push(fn); }, fire(key, event = {}) { for (const fn of this.listeners[key] ?? []) fn(event); },
    click() { this.fire('click'); }, contains(other) { for (let at = other; at; at = at.parentElement) if (at === this) return true; return false; },
    focus() { registry.document.activeElement = this; }, scrollIntoView(options) { this.scrolled = options ?? true; },
    querySelectorAll: () => [], closest: () => null, getClientRects: () => [1] };
  Object.defineProperty(node, 'id', { get() { return this._id; }, set(value) { this._id = value; registry.ids.set(value, this); } });
  return node;
}
function drawer(t, { roots = [{ itemId: 'grill-me' }], width = 1280, heading = true, withEntry = true } = {}) {
  const registry = { ids: new Map() }, docListeners = {}, events = [];
  const make = tag => fakeNode(tag, registry);
  const body = make('body'), header = make('header');
  const review = make('button'); review.id = 'review-project-changes'; header.append(review);
  const entry = make('button'); if (withEntry) { entry.id = 'your-setup'; header.append(entry); }
  registry.document = { activeElement: body, body, createElement: make, getElementById: id => registry.ids.get(id) ?? null,
    querySelector: selector => selector === 'body > header' ? header : selector === 'dialog[open]' ? null : null,
    addEventListener: (key, fn) => { (docListeners[key] ??= []).push(fn); }, dispatchEvent: event => { events.push(event.type); } };
  const saved = {};
  for (const [key, value] of Object.entries({ document: registry.document,
    window: { matchMedia: query => ({ matches: width <= 700, addEventListener() {} }) },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } } })) {
    saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  t.after(() => { for (const [key, value] of Object.entries(saved)) value ? Object.defineProperty(globalThis, key, value) : delete globalThis[key]; });
  const subscribers = [];
  const client = { intent: { roots }, subscribe: fn => subscribers.push(fn), discard() {} };
  const install = make('h3'); install.textContent = 'Install your setup into sample-js-app';
  const backs = [];
  return { registry, client, review, entry, install, events, docListeners, backs, subscribers,
    async load() {
      const { createPolicyReview } = await import('../../src/app/policy-review.js');
      const panel = createPolicyReview({ client, accept: make('button'), proposed: make('div'), status: make('p'),
        setupHeading: () => heading ? install : null, onBack: () => backs.push('back') });
      panel.node.append(install);
      return panel;
    } };
}

test('"Your setup" opens the drawer at Install with focus on its heading, and says whether the drawer is open', async t => {
  const h = drawer(t); const panel = await h.load();
  assert.equal(h.entry.textContent, 'Your setup (1)');
  assert.equal(h.entry.attributes['aria-label'], 'Your setup: 1 chosen item. Open the Project folder, Install and installed items');
  assert.equal(h.entry.attributes['aria-controls'], 'policy-review-panel');
  assert.equal(h.entry.attributes['aria-expanded'], 'false');
  h.entry.click();
  assert.equal(panel.node.hidden, false);
  assert.equal(h.entry.attributes['aria-expanded'], 'true');
  assert.equal(h.review.attributes['aria-expanded'], 'true');
  assert.equal(h.registry.document.activeElement, h.install, 'focus is on the Install heading');
  assert.ok(h.install.scrolled, 'the drawer is scrolled to Install');
  assert.equal(h.install.tabIndex, -1, 'the heading takes focus without becoming a tab stop');
  // Clicking it again while the drawer is open goes back to Install; it does not close the drawer.
  h.registry.document.activeElement = h.registry.document.body; h.entry.click();
  assert.equal(panel.node.hidden, false); assert.equal(h.registry.document.activeElement, h.install);
});

test('the count follows the setup as choices are accepted or removed', async t => {
  const h = drawer(t, { roots: [] }); await h.load();
  assert.equal(h.entry.textContent, 'Your setup');
  h.client.intent = { roots: [{ itemId: 'grill-me' }, { itemId: 'tdd' }] }; for (const fn of h.subscribers) fn();
  assert.equal(h.entry.textContent, 'Your setup (2)');
});

test('with nothing to install yet, "Your setup" opens the drawer at its title', async t => {
  const h = drawer(t, { heading: false }); const panel = await h.load();
  h.entry.click();
  assert.equal(panel.node.hidden, false);
  assert.equal(h.registry.document.activeElement.id, 'policy-review-panel-title');
});

test("Back to catalog is the drawer's one way out: there is no separate Close, and Escape still closes it", async t => {
  const h = drawer(t); const panel = await h.load();
  const back = h.registry.ids.get('policy-back-to-catalog');
  assert.equal(back.textContent, 'Back to catalog');
  assert.equal(panel.node.children.some(child => child.textContent === 'Close'), false, 'Close is merged into Back to catalog');
  h.entry.click(); assert.equal(panel.node.hidden, false);
  back.click();
  assert.equal(panel.node.hidden, true);
  assert.deepEqual(h.backs, ['back']);
  assert.equal(h.entry.attributes['aria-expanded'], 'false'); assert.equal(h.review.attributes['aria-expanded'], 'false');
  // Escape returns focus to Your setup, the control that opened the drawer, without leaving for the catalog.
  h.entry.click(); for (const fn of h.docListeners.keydown) fn({ key: 'Escape' });
  assert.equal(panel.node.hidden, true); assert.equal(h.registry.document.activeElement, h.entry);
  // The hidden Review Changes alias still opens the drawer; it has no place on screen, so focus goes back to Your setup.
  h.review.click(); assert.equal(panel.node.hidden, false);
  for (const fn of h.docListeners.keydown) fn({ key: 'Escape' });
  assert.equal(panel.node.hidden, true); assert.equal(h.registry.document.activeElement, h.entry);
  assert.deepEqual(h.backs, ['back'], 'Escape does not leave for the catalog');
});

test('Your setup opens at a pending addition when one waits, instead of at Install', async t => {
  const h = drawer(t); const panel = await h.load();
  h.client.bytes = new Uint8Array(); h.client.candidate = { intent: { roots: [{ itemId: 'grill-me' }, { itemId: 'other' }] } };
  h.entry.click();
  assert.equal(panel.node.hidden, false);
  assert.equal(h.registry.document.activeElement.id, 'policy-review-panel-title', 'focus is on the drawer title, above the addition');
});

test('the drawer names its parts in plain words', async t => {
  const h = drawer(t); const panel = await h.load();
  assert.equal(h.registry.ids.get('policy-review-panel-title').textContent, 'Your setup');
  assert.equal(h.registry.ids.get('policy-discard').textContent, 'Cancel');
});

test('the drawer still works on a page without the "Your setup" entry', async t => {
  const h = drawer(t, { withEntry: false }); const panel = await h.load();
  h.review.click(); assert.equal(panel.node.hidden, false);
});
