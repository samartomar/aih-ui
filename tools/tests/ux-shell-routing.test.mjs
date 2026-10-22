import test from 'node:test';
import assert from 'node:assert/strict';
import { createShell } from '../../src/app/shell.js';

function node() {
  const classes = new Set(), attributes = {}, listeners = {};
  return { attributes, listeners, inert: false,
    classList: { contains: key => classes.has(key), toggle(key, force) { const on = force ?? !classes.has(key); if (on) classes.add(key); else classes.delete(key); return on; } },
    setAttribute(key, value) { attributes[key] = value; }, removeAttribute(key) { delete attributes[key]; },
    addEventListener(key, value) { listeners[key] = value; }, querySelectorAll: () => [], querySelector: () => null,
    contains: () => false, focus() { this.focused = true; }, getBoundingClientRect: () => ({ height: 44 }),
  };
}
function shell(t, hash = '', width = 1200) {
  const windowListeners = {}, events = [], header = node(), subheader = node(), context = node();
  header.nextElementSibling = subheader;
  const keys = ['catalogWorkspace', 'navRail', 'frameworkMatrixTabs', 'catalogKindsDisclosure', 'inspectorRail', 'toggleInspectorBtn', 'toggleNavBtn', 'closeInspectorBtn', 'policyWorkspace', 'catalogScopesSection', 'navSources', 'navPolicy', 'navScanReview', 'policyWorkspaceTitle', 'paneDetails', 'paneSecurity', 'paneJson', 'projectBasics', 'navProjectBasics', 'projectBasicsTitle', 'yourSources', 'yourSourcesNav', 'yourSourcesTitle'];
  const elements = Object.fromEntries(keys.map(key => [key, node()])); elements.tabButtons = [];
  for (const [key, value] of Object.entries({
    window: { innerWidth: width, matchMedia: query => ({ matches: width <= (query.includes('1100') ? 1100 : 760), addEventListener() {} }), addEventListener: (name, handler) => { windowListeners[name] = handler; } },
    location: { hash }, ResizeObserver: class { observe() {} },
    document: { activeElement: node(), documentElement: { style: { setProperty() {} } },
      querySelector: selector => selector === 'body > header' ? header : null, querySelectorAll: () => [],
      getElementById: id => id === 'policy-context-disclosure' ? context : null,
      addEventListener() {}, dispatchEvent: event => { events.push(event); } },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  const instance = createShell(elements);
  return { instance, elements, events, context, route(value) { globalThis.location.hash = value; windowListeners.hashchange(); } };
}

test('direct review URL and history navigation announce the actual view without nav clicks', t => {
  const h = shell(t, '#review');
  assert.equal(h.elements.policyWorkspace.hidden, false);
  assert.equal(h.elements.catalogWorkspace.hidden, true);
  assert.equal(h.events.at(-1).type, 'aih:view-changed');
  assert.equal(h.events.at(-1).detail.view, 'review');
  h.route('#catalog');
  assert.equal(h.events.at(-1).detail.view, 'catalog');
  h.route('#review');
  assert.equal(h.events.at(-1).detail.view, 'review');
  assert.equal(h.elements.catalogKindsDisclosure.hidden, true);
});

test('mobile kind and policy context start compact, and inspector makes disclosure inert', t => {
  const h = shell(t, '', 390);
  assert.equal(h.elements.catalogKindsDisclosure.open, false);
  assert.equal(h.context.open, false);
  h.instance.setInspectorSelection(true);
  assert.equal(h.elements.catalogKindsDisclosure.inert, true);
  assert.equal(h.elements.inspectorRail.attributes['aria-modal'], 'true');
  h.elements.closeInspectorBtn.listeners.click();
  assert.equal(h.elements.catalogKindsDisclosure.inert, false);
  assert.equal(h.elements.inspectorRail.attributes['aria-modal'], undefined);
});

test('Project basics is its own view: it shows in place of the cards and keeps the inspector for its project files', t => {
  const h = shell(t, '#basics');
  assert.equal(h.events.at(-1).detail.view, 'basics');
  assert.equal(h.elements.projectBasics.hidden, false);
  assert.equal(h.elements.catalogWorkspace.hidden, true, 'the cards give way to Project basics');
  assert.equal(h.elements.policyWorkspace.hidden, true);
  assert.equal(h.elements.inspectorRail.hidden, false, "a project file's details still open in the inspector");
  assert.equal(h.elements.navProjectBasics.attributes['aria-current'], 'page');
  assert.equal(h.elements.navSources.attributes['aria-current'], undefined);
  assert.equal(h.elements.projectBasicsTitle.focused, true);
  // Back to catalog (from Your setup) stays on Project basics; choosing a framework returns to the cards.
  const changes = h.events.length;
  h.instance.showCatalog();
  assert.equal(h.events.length, changes, 'Back to catalog keeps Project basics');
  h.instance.showCards();
  assert.equal(h.events.at(-1).detail.view, 'catalog');
  assert.equal(h.elements.catalogWorkspace.hidden, false);
  assert.equal(h.elements.projectBasics.hidden, true);
  assert.equal(h.elements.navProjectBasics.attributes['aria-current'], undefined);
  h.route('#policy');
  assert.equal(h.elements.projectBasics.hidden, true);
});

test('the inspector opens for a selection while Project basics shows', t => {
  const h = shell(t, '#basics', 1200);
  h.instance.setInspectorSelection(true);
  assert.equal(h.elements.inspectorRail.attributes['aria-hidden'], 'false');
});

test('Your sources is its own view: it shows in place of the cards and keeps the inspector for its skills', t => {
  const h = shell(t, '#your-sources');
  assert.equal(h.events.at(-1).detail.view, 'your-sources');
  assert.equal(h.elements.yourSources.hidden, false);
  assert.equal(h.elements.catalogWorkspace.hidden, true, 'the cards give way to Your sources');
  assert.equal(h.elements.projectBasics.hidden, true);
  assert.equal(h.elements.inspectorRail.hidden, false, "a skill's details still open in the inspector");
  assert.equal(h.elements.yourSourcesNav.attributes['aria-current'], 'page');
  assert.equal(h.elements.navSources.attributes['aria-current'], undefined);
  assert.equal(h.elements.yourSourcesTitle.focused, true);
  h.instance.setInspectorSelection(true);
  assert.equal(h.elements.inspectorRail.attributes['aria-hidden'], 'false');
  const changes = h.events.length;
  h.instance.showCatalog();
  assert.equal(h.events.length, changes, 'Back to catalog keeps Your sources');
  h.instance.showCards();
  assert.equal(h.elements.yourSources.hidden, true);
  assert.equal(h.elements.yourSourcesNav.attributes['aria-current'], undefined);
  h.route('#basics');
  assert.equal(h.elements.yourSources.hidden, true);
  h.route('#your-sources');
  h.route('#policy');
  assert.equal(h.elements.yourSources.hidden, true);
});
