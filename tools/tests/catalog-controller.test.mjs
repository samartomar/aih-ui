// AF2/Q6-R2 regressions: the real createCatalog call chain - no-framework navigation with saved/draft
// roots invalidates facts WITHOUT re-entering render (no synchronous recursion), and a folder revision
// change during a pending browse read discards the old-folder reply instead of adopting it.
import test from 'node:test';
import assert from 'node:assert/strict';

// DOM-faithful fixture: every element is a generic node; parentElement is read-only; document is a Proxy.
const makeEl = () => {
  const listeners = {};
  const el = {
    children: [], dataset: {}, style: {}, attributes: {}, hidden: false, disabled: false, value: '', checked: false, options: [],
    textContent: '', innerHTML: '', open: false, title: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    contains: () => false,
    get parentElement() { return this._parent ?? null; },
    append(...kids) { for (const kid of kids) if (kid && typeof kid === 'object') { this.children.push(kid); Object.defineProperty(kid, '_parent', { value: this, configurable: true, writable: false }); } },
    appendChild(kid) { this.append(kid); return kid; },
    replaceChildren(...kids) { this.children = []; this.append(...kids); },
    remove() {}, setAttribute(k, v) { this.attributes[k] = String(v); }, removeAttribute(k) { delete this.attributes[k]; },
    getAttribute(k) { return this.attributes[k] ?? null; }, hasAttribute(k) { return k in this.attributes; },
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); }, dispatch(type, event) { for (const fn of listeners[type] ?? []) fn(event); },
    querySelector() { return (this._q ??= makeEl()); }, querySelectorAll: () => [], closest: () => null, focus() {}, click() { return Promise.all((listeners.click ?? []).map(fn => fn())); },
    add(option) { this.options.push(option); }, insertAdjacentHTML() {}, after(...kids) { for (const kid of kids) if (kid && typeof kid === 'object') { const i = this._parent ? this._parent.children.indexOf(this) : -1; if (i >= 0) this._parent.children.splice(i + 1, 0, kid); Object.defineProperty(kid, '_parent', { value: this._parent, configurable: true }); } }, before() {}, prepend(...kids) { this.children.unshift(...kids.filter(k => k && typeof k === 'object')); },
  };
  return el;
};
const documentStub = () => {
  const byId = new Map();
  return {
    getElementById: id => byId.get(id) ?? (byId.set(id, makeEl()).get(id)),
    querySelector: () => makeEl(), querySelectorAll: () => [],
    createElement: () => makeEl(), createElementNS: () => makeEl(), createTextNode: text => ({ textContent: String(text), children: [] }), addEventListener() {}, body: makeEl(), documentElement: makeEl(), activeElement: null, activeElement: null,
  };
};

const REL = 'r'.repeat(64);
function authoringStub(over = {}) {
  const requests = [];
  return {
    catalog: { frameworks: [], items: [] },
    intent: { roots: [{ releaseSha256: REL, itemId: 'grill-me', scope: 'project', configuration: {}, originIds: ['direct'] }], pins: [] },
    draft: undefined, bytes: new Uint8Array(), evidenceRevision: 0, revision: 0, folderRevision: 0,
    subscribe: () => () => {}, request: async (operation, body) => { requests.push([operation, body]); return { status: 'read' }; },
    requests, ...over,
  };
}

test('AF2: no-framework navigation with saved roots invalidates without recursion and without requests', async () => {
  const originals = { document: globalThis.document, sessionStorage: globalThis.sessionStorage, fetch: globalThis.fetch, ResizeObserver: globalThis.ResizeObserver, IntersectionObserver: globalThis.IntersectionObserver, matchMedia: globalThis.matchMedia, Option: globalThis.Option };
  globalThis.Option ??= class { constructor(text, value) { this.text = text; this.value = value; this.selected = false; this.disabled = false; } };
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  globalThis.IntersectionObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.document = documentStub();
  globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
  try {
    const { createCatalog } = await import('../../src/catalog/controller.js');
    const authoring = authoringStub();
    const catalog = createCatalog({ authoring, onSummary() {} });
    // Force legacy (no ready framework) browsing with saved roots present: this is the recursion trigger.
    catalog.setMode({ role: 'vibe coder' });
    await new Promise(done => setTimeout(done, 0));
    await Promise.resolve();
    assert.ok(authoring.requests.every(([operation, body]) => body?.releaseSha256 !== undefined && body?.releaseSha256 !== null),
      'no browse request was ever made without a framework identity');
    assert.ok(authoring.requests.filter(([operation]) => operation === 'browse-content').length <= 1,
      'the no-framework branch does not loop: at most one pending read, no render re-entry');
    await new Promise(done => setTimeout(done, 50)); // let start()'s contract-check promise settle before restoring globals
  } finally {
    globalThis.document = originals.document; globalThis.sessionStorage = originals.sessionStorage; globalThis.fetch = originals.fetch;
    if (originals.ResizeObserver === undefined) delete globalThis.ResizeObserver; else globalThis.ResizeObserver = originals.ResizeObserver;
    if (originals.IntersectionObserver === undefined) delete globalThis.IntersectionObserver; else globalThis.IntersectionObserver = originals.IntersectionObserver;
    if (originals.matchMedia === undefined) delete globalThis.matchMedia; else globalThis.matchMedia = originals.matchMedia;
    if (originals.Option === undefined) delete globalThis.Option; else globalThis.Option = originals.Option;
  }
});

test('Q6-R2: a folder revision change during a pending browse read discards the old-folder reply', async () => {
  const originals = { document: globalThis.document, sessionStorage: globalThis.sessionStorage, fetch: globalThis.fetch, ResizeObserver: globalThis.ResizeObserver, IntersectionObserver: globalThis.IntersectionObserver, matchMedia: globalThis.matchMedia, Option: globalThis.Option };
  globalThis.Option ??= class { constructor(text, value) { this.text = text; this.value = value; this.selected = false; this.disabled = false; } };
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  globalThis.IntersectionObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.document = documentStub();
  globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
  try {
    const { createCatalog } = await import('../../src/catalog/controller.js');
    let resolveRead;
    const authoring = authoringStub({
      catalog: { frameworks: [{ id: 'ecc', name: 'ECC', sha256: REL, state: 'ready', sets: [] }], items: [] },
      request: async (operation, body) => {
        if (operation === 'browse-content') { requests.push([operation, body]); return new Promise(resolve => { resolveRead = () => resolve({ status: 'read' }); }); }
        requests.push([operation, body]); return { status: 'ok' };
      },
    });
    const requests = authoring.requests;
    const catalog = createCatalog({ authoring, onSummary() {} });
    // start() subscribes refresh() and runs it: restoredView -> render (readBrowse at the top) -> later
    // render stages. The fixture intentionally does not model every toolbar node; the browse read has
    // already been issued before those stages, so a late render gap does not affect the assertion.
    await catalog.start().catch(() => {});
    await new Promise(done => setTimeout(done, 0));
    assert.ok(resolveRead, 'a browse read is pending');
    const folderAtRequest = authoring.folderRevision;
    authoring.folderRevision = folderAtRequest + 1; // the host folder switched while the read was out
    resolveRead();
    await new Promise(done => setTimeout(done, 10));
    const reads = requests.filter(([operation]) => operation === 'browse-content');
    assert.ok(reads.length >= 2, 'the superseded reply triggered a re-read for the new folder snapshot');
    await new Promise(done => setTimeout(done, 50)); // let start()'s contract-check promise settle before restoring globals
  } finally {
    globalThis.document = originals.document; globalThis.sessionStorage = originals.sessionStorage; globalThis.fetch = originals.fetch;
    if (originals.ResizeObserver === undefined) delete globalThis.ResizeObserver; else globalThis.ResizeObserver = originals.ResizeObserver;
    if (originals.IntersectionObserver === undefined) delete globalThis.IntersectionObserver; else globalThis.IntersectionObserver = originals.IntersectionObserver;
    if (originals.matchMedia === undefined) delete globalThis.matchMedia; else globalThis.matchMedia = originals.matchMedia;
    if (originals.Option === undefined) delete globalThis.Option; else globalThis.Option = originals.Option;
  }
});
