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

test('the default catalog keeps the search, the kind pills, Your tool and the cards outside Advanced', () => {
  for (const id of ['catalog-search', 'kind-filters', 'your-tool-trigger', 'your-tool-status', 'cards-grid', 'review-filters', 'your-setup', 'theme-toggle-btn', 'nav-sources'])
    assert.equal(inside(id, 'catalog-advanced'), false, `${id} stays on the default screen`);
});

test('the tool line is under Advanced and the Core tools chip is in Settings, Advanced, with their ids (owner decision 3, #136)', () => {
  for (const id of ['catalog-tools-bar', 'browse-target', 'catalog-tools-toggle', 'catalog-tools-undeclared', 'catalog-tools-unsupported', 'catalog-tools-unmatched'])
    assert.ok(inside(id, 'catalog-advanced'), `${id} is inside the catalog Advanced section`);
  for (const id of ['ai-tools-trigger', 'ai-tools-count', 'ai-tools-pop', 'ai-tools-list', 'ai-tools-note', 'your-tool-core']) {
    assert.ok(inside(id, 'workspace-actions'), `${id} is in the Settings menu`);
    assert.ok(inside(id, 'settings-advanced'), `${id} is in the Settings menu's Advanced part`);
  }
});

test('one Settings menu holds the workspace actions, the mode, Check this machine and Get started', () => {
  for (const id of ['workbench-mode-trigger', 'workbench-experience', 'org-trigger-label', 'nav-readiness', 'nav-guided'])
    assert.ok(inside(id, 'workspace-actions'), `${id} is in the Settings menu`);
  assert.equal(inside('org-modal-trigger', 'workspace-actions'), false, 'the Settings button itself is in the header');
  // The role badge is not on the agreed list, so it stays in the header beside the product name, outside the menu.
  assert.equal(inside('workbench-role', 'workspace-actions'), false, 'the role badge is not moved into Settings');
  const html = readFileSync(new URL('../../src/index.html', import.meta.url), 'utf8');
  assert.match(/<header[\s\S]*?<\/header>/.exec(html)[0], /id="workbench-role"/, 'the role badge renders in the header');
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

// Words a person meets on the default screen, per GLOSSARY.md: engine words may stay inside Advanced, the hidden views
// and the dialogs, never on the screen a person first sees. "aih Policy" is the product's name.
const ENGINE_WORDS = /(polic(y|ies)|pins?|pinned|artifacts?|explicit choices?|accepted choices?|prepare[ds]?|digests?|recipes?|envelopes?|admission)/i;
const NOT_DEFAULT = ['catalog-advanced', 'pane-json', 'tab-json', 'pane-security', 'policy-workspace', 'workbench-mode-dialog', 'setup-dialog', 'org-modal-overlay', 'details-disclosure'];
function defaultText(html) {
  const words = [], stack = [];
  const body = html.slice(html.indexOf('<body')).replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
  for (const match of body.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g)) {
    const [, closing, tag, attrs, selfClosing, text] = match;
    if (text !== undefined) { if (text.trim() && !stack.some(entry => NOT_DEFAULT.includes(entry.id) || entry.hidden)) words.push(text.trim()); continue; }
    const name = tag.toLowerCase();
    if (closing) { const at = stack.map(entry => entry.tag).lastIndexOf(name); if (at >= 0) stack.length = at; continue; }
    if (!VOID.has(name) && !selfClosing) stack.push({ tag: name, id: /\sid="([^"]+)"/.exec(attrs)?.[1] ?? null, hidden: /\shidden(\s|=|$)/.test(attrs) });
  }
  return words.join(' | ').replace(/aih Policy/g, 'aih');
}

test('the default catalog screen uses plain words: no policy, pins, artifacts, digests, recipes or Prepare', () => {
  const text = defaultText(readFileSync(new URL('../../src/index.html', import.meta.url), 'utf8'));
  assert.doesNotMatch(text, ENGINE_WORDS);
  assert.match(text, /Choose content for your AI tool/);
});

test('the words say where Mode and Core tools now live: the Settings menu', () => {
  const html = readFileSync(new URL('../../src/index.html', import.meta.url), 'utf8');
  assert.match(/id="org-modal-trigger"[^>]*title="([^"]*)"/.exec(html)[1], /Advanced, the tools to set up on this machine/, 'the Settings button says where the Core tools list is');
  const onboarding = readFileSync(new URL('../../src/app/onboarding.js', import.meta.url), 'utf8');
  assert.doesNotMatch(onboarding, /Mode control in the header/);
  assert.match(onboarding, /Change mode in Settings/);
  // One tool list where people work (#136): setup names the Core list by its place and says it does not choose content.
  assert.doesNotMatch(onboarding, /AI tools control/);
  assert.match(onboarding, /Settings, Advanced, Tools to set up on this machine/);
});

test('an open Advanced section is a panel beside the cards on a wide screen, with its own Close (#122)', () => {
  assert.ok(inside('catalog-advanced-close', 'catalog-advanced'), 'Close is inside the Advanced section');
  const css = readFileSync(new URL('../../src/styles/workbench.css', import.meta.url), 'utf8');
  const wide = /@media \(min-width: 900px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  assert.match(wide, /#catalog-advanced\[open\] > \.catalog-advanced-body \{[^}]*position: absolute/, 'the open body leaves the flow');
  assert.match(wide, /#catalog-workspace:has\(#catalog-advanced\[open\]\) \{ padding-left/, 'the cards make room rather than being covered');
});

test('the catalog filters are under Advanced, so the cards come straight after the search (#122)', () => {
  for (const id of ['catalog-filter-disclosure', 'browse-support', 'catalog-reset-filters', 'support-counts'])
    assert.ok(inside(id, 'catalog-advanced'), `${id} is inside the catalog Advanced section`);
});

test('the folder picker moved from Advanced to Your sources with its ids (owner decision 5, #124)', () => {
  for (const id of ['personal-folder', 'personal-binding', 'personal-result']) {
    assert.ok(inside(id, 'your-sources'), `${id} is under Your sources`);
    assert.ok(!inside(id, 'catalog-advanced'), `${id} is no longer under Advanced`);
  }
});
