// Add in one click: the card's Add proposes the item and, when Catalog and Core return it with nothing to decide,
// accepts it at once. These run the real authoring client; only the host's HTTP answers are stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthoringClient } from '../../src/app/authoring-client.js';
import { addItem, undoAdd, addedMessage, chosenRoot, removeItem } from '../../src/app/one-click-add.js';

const release = 'a'.repeat(64);
const ref = (itemId, scope = 'project') => ({ releaseSha256: release, itemId, scope });
const root = itemId => ({ ...ref(itemId), itemSha256: 'b'.repeat(64), configuration: {}, originIds: ['direct'] });
const item = (id, label = id, path) => ({ id, label, root: root(id),
  ...(path ? { metadata: { upstream: { path } }, sources: [{ origin: { kind: 'git', repository: 'https://example.test/skills', revision: 'c'.repeat(40) } }] } : {}) });

// The host's answers, in order; each request's operation is recorded.
function host(t, answers) {
  const prior = globalThis.fetch, requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, body: JSON.parse(init?.body ?? '{}') });
    const next = answers.shift();
    if (!next) throw new Error(`unexpected request ${url}`);
    return { ok: true, json: async () => next };
  };
  t.after(() => { globalThis.fetch = prior; });
  return requests;
}
const policy = (roots, inclusions = []) => ({ status: 'ok', diagnostics: [], value: { policyBytes: [roots.length + 1], intent: { roots, pins: [] }, inclusions } });
function opened(t, roots = []) {
  const client = createAuthoringClient({ sessionRecovery: false });
  client.publish({ policyBytes: [1], intent: { roots, pins: [] } });
  return client;
}

test('a clean Add puts the item and the items it needs into the setup with one request and no review step', async t => {
  const requests = host(t, [policy([root('grill-me')], [
    { root: ref('grill-me'), item: ref('grill-me') }, { root: ref('grill-me'), item: ref('grilling') }, { root: ref('grill-me'), item: ref('domain-modeling') }])]);
  const client = opened(t);
  const outcome = await addItem(client, item('grill-me'));
  assert.equal(outcome.status, 'added');
  assert.deepEqual(outcome.needed, ['grilling', 'domain-modeling']);
  assert.deepEqual(client.intent.roots.map(value => value.itemId), ['grill-me']);
  assert.equal(client.candidate, undefined);
  assert.deepEqual(requests.map(request => [request.url, request.body.operation]), [['/api/authoring-edit', { type: 'select', root: root('grill-me') }]]);
});

test('a refused or conflicting Add keeps its reasons and changes nothing', async t => {
  const conflict = { status: 'refused', diagnostics: [{ code: 'INPUT_INVALID', message: 'Catalog refused the resolved set.', details: { diagnostics: [{ code: 'CONFLICT', message: 'grill-me conflicts with grill-lite.' }] } }] };
  host(t, [conflict]);
  const client = opened(t, [root('grill-lite')]);
  const outcome = await addItem(client, item('grill-me'));
  assert.equal(outcome.status, 'refused');
  assert.equal(outcome.result, conflict);
  assert.deepEqual(client.intent.roots.map(value => value.itemId), ['grill-lite']);
  assert.equal(client.candidate, undefined);
});

test('a proposal that comes back with diagnostics is left for review, not accepted', async t => {
  const warned = { ...policy([root('grill-me')]), diagnostics: [{ code: 'NOTE', message: 'Something to read first.' }] };
  host(t, [warned]);
  const client = opened(t);
  const outcome = await addItem(client, item('grill-me'));
  assert.equal(outcome.status, 'review');
  assert.deepEqual(client.intent.roots, []);
  assert.ok(client.candidate, 'the proposal stays pending for the review drawer');
  const inner = { ...policy([root('grill-me')]) }; inner.value = { ...inner.value, diagnostics: [{ code: 'NOTE', message: 'In the value.' }] };
  host(t, [inner]);
  assert.equal((await addItem(opened(t), item('grill-me'))).status, 'review');
});

// An open draft records the choice through the draft edit; one click works the same way there.
const unresolved = { code: 'SOURCE_REVISION_UNAVAILABLE', message: 'old-skill is unavailable.' };
const draftValue = (roots, diagnostics = []) => ({ envelopeBytes: [roots.length + 7], savedIntentBytes: [1], roots, diagnostics,
  intent: { roots }, projection: { revision: { sequence: roots.length + 1 } }, editing: diagnostics.length ? 'unresolved' : 'available' });
async function draftClient(t, roots, diagnostics) {
  host(t, [{ status: 'ok', diagnostics: [], value: draftValue(roots, diagnostics) }]);
  const client = createAuthoringClient({ sessionRecovery: false });
  await client.openDraft(Uint8Array.of(1));
  return client;
}

test('with a draft open, a clean Add records the choice in the draft at once, keeping the draft\'s existing gaps', async t => {
  const old = { ...ref('old-skill'), status: 'unresolved', dependencies: [] };
  const client = await draftClient(t, [old], [unresolved]);
  const requests = host(t, [{ status: 'ok', diagnostics: [], value: draftValue([old, { ...ref('grill-me'), status: 'resolved', dependencies: [ref('grilling')] }], [unresolved]) }]);
  const outcome = await addItem(client, item('grill-me'));
  assert.equal(outcome.status, 'added');
  assert.equal(outcome.draft, true);
  assert.deepEqual(outcome.needed, ['grilling']);
  assert.deepEqual(client.draft.roots.map(value => value.itemId), ['old-skill', 'grill-me']);
  assert.equal(requests[0].url, '/api/authoring-draft-edit');
});

test('with a draft open, an Add that is itself unresolved or brings a new diagnostic is left for review', async t => {
  const client = await draftClient(t, [], []);
  host(t, [{ status: 'ok', diagnostics: [], value: draftValue([{ ...ref('grill-me'), status: 'unresolved', dependencies: [] }], [unresolved]) }]);
  assert.equal((await addItem(client, item('grill-me'))).status, 'review');
  assert.deepEqual(client.draft.roots, []);
});

test('Undo takes the added chosen item back out through the remove-root proposal and acceptance', async t => {
  const client = opened(t, [root('grill-me')]);
  host(t, [policy([root('grill-me'), root('tdd')], [{ root: ref('tdd'), item: ref('tdd') }])]);
  const added = await addItem(client, item('tdd'));
  const requests = host(t, [policy([root('grill-me')])]);
  const undone = await undoAdd(client, added.root);
  assert.equal(undone.status, 'removed');
  assert.deepEqual(client.intent.roots.map(value => value.itemId), ['grill-me']);
  assert.deepEqual(requests[0].body.operation, { type: 'remove-root', root: root('tdd'), keep: [] });
});

test('Undo that the host refuses changes nothing, and Undo of an item no longer chosen asks the host nothing', async t => {
  const client = opened(t, [root('grill-me'), root('tdd')]);
  const refused = { status: 'refused', diagnostics: [{ code: 'INPUT_INVALID', message: 'No.' }] };
  host(t, [refused]);
  const undone = await undoAdd(client, root('tdd'));
  assert.equal(undone.status, 'refused'); assert.equal(undone.result, refused);
  assert.deepEqual(client.intent.roots.map(value => value.itemId), ['grill-me', 'tdd']);
  const gone = await undoAdd(client, root('other'));
  assert.equal(gone.status, 'refused'); assert.match(gone.result.diagnostics[0].message, /no longer in your setup/);
});

test('with a draft open, Undo removes the choice from the draft by its reference', async t => {
  const added = { ...ref('grill-me'), itemSha256: 'b'.repeat(64), status: 'resolved', dependencies: [] };
  const client = await draftClient(t, [added], []);
  const requests = host(t, [{ status: 'ok', diagnostics: [], value: draftValue([]) }]);
  assert.equal((await undoAdd(client, root('grill-me'))).status, 'removed');
  assert.deepEqual(client.draft.roots, []);
  assert.deepEqual(requests[0].body.operation, { type: 'remove-root', root: ref('grill-me'), keep: [] });
});

test('Remove (#144) finds the chosen root for a catalog item and takes it out through the same remove-root proposal and acceptance', async t => {
  const configured = { ...root('tdd'), configuration: { level: 'strict' } };
  const client = opened(t, [root('grill-me'), configured]);
  assert.deepEqual(chosenRoot(client, item('tdd')), configured);
  assert.equal(chosenRoot(client, item('other')), undefined);
  assert.equal(chosenRoot(client, { ...item('tdd'), root: { ...root('tdd'), releaseSha256: 'f'.repeat(64) } }), undefined, 'same id, another release: not chosen');
  const requests = host(t, [policy([root('grill-me')])]);
  const removed = await removeItem(client, item('tdd'));
  assert.equal(removed.status, 'removed');
  assert.deepEqual(removed.root, configured, 'the removed root, with its configuration, is kept for Undo');
  assert.deepEqual(client.intent.roots.map(value => value.itemId), ['grill-me']);
  assert.deepEqual(requests.map(request => request.body.operation), [{ type: 'remove-root', root: configured, keep: [] }]);
  const none = await removeItem(client, item('tdd'));
  assert.equal(none.status, 'refused'); assert.match(none.result.diagnostics[0].message, /no longer in your setup/);
});

test('the confirmation names the chosen item and the items it needs, in the Workbench words', () => {
  assert.equal(addedMessage({ name: 'grill-me', needed: ['grilling', 'domain-modeling'] }), 'Added grill-me + 2 it needs (grilling, domain-modeling) to your setup.');
  assert.equal(addedMessage({ name: 'tdd', needed: [] }), 'Added tdd to your setup.');
  assert.equal(addedMessage({ name: 'big', needed: ['a', 'b', 'c', 'd', 'e'] }), 'Added big + 5 it needs (a, b, c, …) to your setup.');
  assert.equal(addedMessage({ name: 'tdd', needed: ['x'], draft: true }), 'Added tdd + 1 it needs (x) to your draft. Save the draft to keep it.');
});

// The workspace's Add, on a small DOM: what the person sees after a clean Add, its Undo, and a refusal.
function page(t) {
  const nodes = new Map(), created = [];
  const element = tagName => {
    const node = { tagName, children: [], dataset: {}, listeners: {}, attributes: {}, value: '', textContent: '', options: [], hidden: false,
      classList: { remove() {}, toggle() {} }, getAttribute(key) { return this.attributes[key] ?? null; }, setAttribute(key, value) { this.attributes[key] = String(value); }, removeAttribute(key) { delete this.attributes[key]; },
      after() {}, before() {}, focus() { globalThis.document.activeElement = this; }, scrollIntoView() {}, contains(target) { return target === this || this.children.some(child => child.contains?.(target)); },
      closest() { return null; }, get childNodes() { return this.children; },
      addEventListener(name, listener) { const prior = this.listeners[name]; this.listeners[name] = prior ? (...args) => { prior(...args); return listener(...args); } : listener; },
      append(...children) { for (const child of children) { if (typeof child !== 'object') continue; child.parentElement = this; this.children.push(child); } }, prepend(...children) { this.children.unshift(...children); },
      replaceChildren(...children) { this.children = children; }, get lastChild() { return this.children.at(-1); } };
    created.push(node); return node;
  };
  const prior = { document: globalThis.document, Option: globalThis.Option, window: globalThis.window };
  t.after(() => { for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  globalThis.window = { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
  globalThis.document = { body: element('body'), addEventListener() {}, dispatchEvent() {}, createElement: element, createTextNode: textContent => ({ textContent }),
    getElementById(id) { if (!nodes.has(id)) { const node = element('div'); node.id = id; nodes.set(id, node); } return nodes.get(id); }, querySelector: () => element('div') };
  globalThis.Option = function(textContent, value) { return { textContent, value }; };
  const byId = id => created.find(node => node.id === id);
  return { byId, text: id => byId(id).textContent };
}
// Edits come from `edits`, in order; every other host request is answered as unavailable.
function editHost(t, edits) {
  const prior = globalThis.fetch;
  globalThis.fetch = async url => ({ ok: true, json: async () => url === '/api/authoring-edit' ? edits.shift() : { status: 'refused', diagnostics: [] } });
  t.after(() => { globalThis.fetch = prior; });
}

test('on the page, a clean Add confirms what it added with Undo, keeps the review closed, and Undo takes it back out', async t => {
  const { byId, text } = page(t);
  editHost(t, [policy([root('grill-me')], [{ root: ref('grill-me'), item: ref('grilling') }]), policy([])]);
  const { createAuthoringWorkspace } = await import('../../src/app/authoring-workspace.js');
  const client = opened(t);
  const workspace = createAuthoringWorkspace(client);
  await workspace.add(item('grill-me'));
  assert.equal(byId('added-notice').hidden, false);
  assert.equal(text('added-notice-message'), 'Added grill-me + 1 it needs (grilling) to your setup.');
  assert.equal(byId('added-notice-warning').hidden, true);
  assert.equal(byId('policy-review-panel').hidden, true, 'the person keeps browsing');
  assert.equal(text('your-setup'), 'Your setup (1)');
  byId('added-notice-undo').focus();
  await byId('added-notice-undo').listeners.click();
  assert.equal(text('added-notice-message'), 'Undone: grill-me is no longer in your setup.');
  assert.equal(byId('added-notice-undo').hidden, true);
  assert.equal(globalThis.document.activeElement, byId('added-notice-dismiss'), 'focus does not fall to the page');
  assert.equal(text('your-setup'), 'Your setup');
});

test('on the page, a refused Add opens the review with its reason and adds nothing', async t => {
  const { byId, text } = page(t);
  editHost(t, [{ status: 'refused', diagnostics: [{ code: 'INPUT_INVALID', message: 'Catalog refused the resolved set.', details: { diagnostics: [{ code: 'CONFLICT', message: 'grill-me conflicts with grill-lite.' }] } }] }]);
  const { createAuthoringWorkspace } = await import('../../src/app/authoring-workspace.js');
  const client = opened(t);
  const workspace = createAuthoringWorkspace(client);
  await workspace.add(item('grill-me'));
  assert.equal(byId('policy-review-panel').hidden, false);
  assert.match(text('policy-status'), /^Nothing was added: grill-me was refused\..*grill-me conflicts with grill-lite\./);
  assert.equal(byId('added-notice').hidden, true);
  assert.deepEqual(client.intent.roots, []);
});

test('the items it needs are named by their catalog label when the installed catalog has one', async t => {
  host(t, [{ items: [item('grill-me', 'Grill me'), item('grilling', 'Grilling'), item('notes', '')].map(value => value.id === 'notes' ? { ...value, label: undefined } : value), templates: [] }]);
  const client = opened(t); await client.loadCatalog();
  host(t, [policy([root('grill-me')], [{ root: ref('grill-me'), item: ref('grilling') }, { root: ref('grill-me'), item: ref('notes') }])]);
  assert.deepEqual((await addItem(client, item('grill-me', 'Grill me'))).needed, ['Grilling', 'notes']);
});

test('on the page, Remove on a chosen item (#144) confirms with Undo, and Add then Remove leaves the setup exactly as before', async t => {
  const { byId, text } = page(t);
  const bodies = [], edits = [policy([root('grill-me')], [{ root: ref('grill-me'), item: ref('grilling') }]), policy([]), policy([root('grill-me')]), policy([])], prior = globalThis.fetch;
  globalThis.fetch = async (url, init) => { if (url === '/api/authoring-edit') bodies.push(JSON.parse(init.body).operation); return { ok: true, json: async () => url === '/api/authoring-edit' ? edits.shift() : { status: 'refused', diagnostics: [] } }; };
  t.after(() => { globalThis.fetch = prior; });
  const { createAuthoringWorkspace } = await import('../../src/app/authoring-workspace.js');
  const client = opened(t);
  const workspace = createAuthoringWorkspace(client);
  client.discard();
  const before = { bytes: [...client.bytes], roots: structuredClone(client.intent.roots) };
  await workspace.add(item('grill-me'));
  assert.equal(text('your-setup'), 'Your setup (1)');
  await workspace.remove(item('grill-me'));
  assert.equal(text('added-notice-message'), 'Removed grill-me from your setup.');
  assert.equal(byId('added-notice-undo').hidden, false);
  assert.equal(byId('policy-review-panel').hidden, true, 'the person keeps browsing');
  assert.equal(text('your-setup'), 'Your setup');
  assert.deepEqual([...client.bytes], before.bytes, 'the setup bytes are back exactly as before the Add');
  assert.deepEqual(client.intent.roots, before.roots);
  // Undo puts the same root back, through the one-click Add.
  await byId('added-notice-undo').listeners.click();
  assert.equal(text('added-notice-message'), 'Undone: grill-me is back in your setup.');
  assert.deepEqual(bodies.map(body => [body.type, body.root.itemId]), [['select', 'grill-me'], ['remove-root', 'grill-me'], ['select', 'grill-me']]);
  assert.equal(text('your-setup'), 'Your setup (1)');
});
