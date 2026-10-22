import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rememberOpen } from '../../src/app/advanced.js';

function details() {
  const listeners = {};
  return { open: false, addEventListener(name, fn) { listeners[name] = fn; }, toggle(open) { this.open = open; listeners.toggle?.(); } };
}
function memory() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}

test('Advanced starts closed for a new viewer and remembers what that viewer did', () => {
  const storage = memory();
  const first = details(); rememberOpen(first, 'catalog', storage);
  assert.equal(first.open, false);
  first.toggle(true);
  const again = details(); rememberOpen(again, 'catalog', storage);
  assert.equal(again.open, true, 'opened Advanced stays open next time');
  again.toggle(false);
  const third = details(); rememberOpen(third, 'catalog', storage);
  assert.equal(third.open, false);
});

test('each Advanced section keeps its own state', () => {
  const storage = memory();
  const catalog = details(); rememberOpen(catalog, 'catalog', storage); catalog.toggle(true);
  const drawer = details(); rememberOpen(drawer, 'drawer', storage);
  assert.equal(drawer.open, false);
});

test('Advanced still opens and closes when the browser refuses storage', () => {
  const refusing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const node = details();
  assert.doesNotThrow(() => rememberOpen(node, 'catalog', refusing));
  assert.equal(node.open, false);
  assert.doesNotThrow(() => node.toggle(true));
  assert.equal(node.open, true);
  assert.doesNotThrow(() => rememberOpen(details(), 'catalog', undefined));
});

// The page's own markup: which controls a person meets first, and which wait behind Advanced or Settings.
const VOID = new Set(['meta', 'link', 'input', 'br', 'img', 'hr', 'source', 'option-never']);
function ancestry(html) {
  const found = new Map(), stack = [];
  const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
  for (const match of body.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, tag, attrs, selfClosing] = match, name = tag.toLowerCase();
    if (closing) { const at = stack.map(entry => entry.tag).lastIndexOf(name); if (at >= 0) stack.length = at; continue; }
    const id = /\sid="([^"]+)"/.exec(attrs)?.[1] ?? null;
    if (id) found.set(id, stack.map(entry => entry.id).filter(Boolean));
    if (!VOID.has(name) && !selfClosing) stack.push({ tag: name, id });
  }
  return found;
}
const page = ancestry(readFileSync(new URL('../../src/index.html', import.meta.url), 'utf8'));
const inside = (id, container) => { assert.ok(page.has(id), `${id} is on the page`); return page.get(id).includes(container); };

test('the catalog Advanced section holds the kind tiles, the catalog scopes, the Policy workspace links and Scan Review', () => {
  for (const id of ['framework-matrix-tabs', 'catalog-scopes-section', 'rail-scope-list', 'nav-policy', 'catalog-open-policy-workspace', 'nav-scan-review'])
    assert.ok(inside(id, 'catalog-advanced'), `${id} is inside the catalog Advanced section`);
});

test('the default catalog keeps the search, the kind pills, the tool line and the cards outside Advanced', () => {
  for (const id of ['catalog-search', 'kind-filters', 'catalog-tools-bar', 'browse-target', 'cards-grid', 'review-filters', 'your-setup', 'ai-tools-trigger', 'theme-toggle-btn', 'nav-sources'])
    assert.equal(inside(id, 'catalog-advanced'), false, `${id} stays on the default screen`);
});

test('one Settings menu holds the workspace actions, the mode, Check this machine and Get started', () => {
  for (const id of ['workbench-mode-trigger', 'workbench-experience', 'org-trigger-label', 'workbench-role', 'nav-readiness', 'nav-guided'])
    assert.ok(inside(id, 'workspace-actions'), `${id} is in the Settings menu`);
  assert.equal(inside('org-modal-trigger', 'workspace-actions'), false, 'the Settings button itself is in the header');
});

test('the header has one button for your setup: Review Changes and Check Policy are not header buttons', () => {
  const html = readFileSync(new URL('../../src/index.html', import.meta.url), 'utf8');
  const header = /<header[\s\S]*?<\/header>/.exec(html)[0];
  assert.doesNotMatch(header, />\s*Review Changes\s*</);
  assert.doesNotMatch(header, />\s*Check Policy\s*</);
  assert.doesNotMatch(header, /id="check-project-policy"/);
  assert.match(header, /id="review-project-changes"[^>]*hidden/, 'the old id stays resolvable, hidden');
  assert.doesNotMatch(header, /id="workbench-mode-trigger"[^>]*class="wb-header-control"/, 'Mode is no longer its own header control');
});

test('Signals are part of the review filters, not a separate disclosure', () => {
  assert.equal(page.has('review-signals'), false);
});
