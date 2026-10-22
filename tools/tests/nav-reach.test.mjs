import test from 'node:test';
import assert from 'node:assert/strict';
import { createShell } from '../../src/app/shell.js';

// The shell with a window whose width can change, so the rails see the same media-query changes a browser sends.
function node() {
  const classes = new Set(), attributes = {}, listeners = {};
  return { attributes, listeners, inert: false, classes,
    classList: { contains: key => classes.has(key), toggle(key, force) { const on = force ?? !classes.has(key); if (on) classes.add(key); else classes.delete(key); return on; } },
    setAttribute(key, value) { attributes[key] = String(value); }, removeAttribute(key) { delete attributes[key]; }, getAttribute(key) { return attributes[key]; },
    addEventListener(key, value) { listeners[key] = value; }, querySelectorAll: () => [], querySelector: () => null,
    contains: () => false, focus() { this.focused = true; }, getBoundingClientRect: () => ({ height: 44 }),
  };
}
function shell(t, { width = 1280, hash = '' } = {}) {
  const windowListeners = {}, events = [], media = [], header = node(), subheader = node(), context = node();
  header.nextElementSibling = subheader;
  const keys = ['catalogWorkspace', 'navRail', 'frameworkMatrixTabs', 'catalogKindsDisclosure', 'inspectorRail', 'toggleInspectorBtn', 'toggleNavBtn', 'closeInspectorBtn', 'policyWorkspace', 'catalogScopesSection', 'navSources', 'navPolicy', 'navScanReview', 'policyWorkspaceTitle', 'paneDetails', 'paneSecurity', 'paneJson'];
  const elements = Object.fromEntries(keys.map(key => [key, node()])); elements.tabButtons = [];
  elements.navRail.classList.toggle('w-60', true); elements.navRail.id = 'nav-rail';
  const win = { innerWidth: width, addEventListener: (name, handler) => { windowListeners[name] = handler; },
    matchMedia(query) {
      const limit = Number(/max-width:\s*(\d+)px/.exec(query)[1]);
      const entry = { limit, matches: win.innerWidth <= limit, handlers: [], addEventListener(_, handler) { this.handlers.push(handler); } };
      media.push(entry); return entry;
    } };
  for (const [key, value] of Object.entries({
    window: win, location: { hash }, ResizeObserver: class { observe() {} },
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
  const navOpen = () => !elements.navRail.classList.contains('w-0');
  return { instance, elements, events, navOpen, windowListeners,
    resize(next) {
      win.innerWidth = next;
      for (const entry of media) {
        const matches = next <= entry.limit; if (matches === entry.matches) continue;
        entry.matches = matches; for (const handler of entry.handlers) handler({ matches });
      }
    } };
}

for (const width of [1024, 1280, 1440]) {
  test(`at ${width} px the navigation is open on load and its toggle says so`, t => {
    const h = shell(t, { width });
    assert.equal(h.navOpen(), true);
    assert.equal(h.elements.toggleNavBtn.attributes['aria-controls'], 'nav-rail');
    assert.equal(h.elements.toggleNavBtn.attributes['aria-expanded'], 'true');
  });
}

test('the navigation the page folded away on a narrow window comes back when the window is wide again', t => {
  const h = shell(t, { width: 700 });
  assert.equal(h.navOpen(), false, 'a phone-width window starts with the navigation folded');
  assert.equal(h.elements.toggleNavBtn.attributes['aria-expanded'], 'false');
  h.resize(1280);
  assert.equal(h.navOpen(), true);
  assert.equal(h.elements.toggleNavBtn.attributes['aria-expanded'], 'true');
  h.resize(700); h.resize(1024);
  assert.equal(h.navOpen(), true, 'the same holds after a second narrow spell');
});

test('a navigation the person folded away stays folded when the window widens', t => {
  const h = shell(t, { width: 1280 });
  h.elements.toggleNavBtn.listeners.click();
  assert.equal(h.navOpen(), false);
  h.resize(700); h.resize(1440);
  assert.equal(h.navOpen(), false);
  h.elements.toggleNavBtn.listeners.click();
  assert.equal(h.navOpen(), true, 'one click on the toggle brings it back');
});

test('showing the catalog from another view switches once, without a second view change from the address', t => {
  const h = shell(t, { width: 1280, hash: '#policy' });
  assert.equal(h.elements.catalogWorkspace.hidden, true);
  const before = h.events.filter(event => event.type === 'aih:view-changed').length;
  h.instance.showCatalog();
  assert.equal(h.elements.catalogWorkspace.hidden, false);
  assert.equal(globalThis.location.hash, 'catalog');
  h.windowListeners.hashchange();
  assert.equal(h.events.filter(event => event.type === 'aih:view-changed').length, before + 1);
  h.instance.showCatalog();
  assert.equal(h.events.filter(event => event.type === 'aih:view-changed').length, before + 1, 'already on the catalog: nothing moves');
});
