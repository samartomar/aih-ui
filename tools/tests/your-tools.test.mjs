import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createYourTool, YOUR_TOOLS_CHANGES_KEY, YOUR_TOOLS_KEY, YOUR_TOOL_KEY } from '../../src/app/your-tool.js';
import { toolFit } from '../../src/catalog/tool-fit.js';
import { itemBrowseFacts } from '../../src/catalog/browse-facts.js';

class Node {
  constructor(tag = 'div') { this.tag = tag; this.className = ''; this.textContent = ''; this.title = ''; this.children = []; this.listeners = {}; this.attributes = {}; this.dataset = {}; this.hidden = false; }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, action) { this.listeners[name] = action; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  contains() { return false; }
  focus() {}
}
const textOf = node => [node.textContent, ...node.children.map(textOf)].join(' ');
const rows = elements => elements.yourToolList.children;

const REGISTRY = [
  { id: 'claude', label: 'Claude Code', surface: 'cli', observed: true },
  { id: 'codex', label: 'Codex CLI', surface: 'cli', observed: true },
  { id: 'kiro', label: 'Kiro CLI', surface: 'cli', observed: true },
  { id: 'cursor', label: 'Cursor', surface: 'ide', observed: false, refusal: { reason: 'tool-not-observed' } },
];

// Browser-wide listeners (the `storage` event a second tab's write fires here), shared by every mounted instance.
const windowListeners = [];
const fireStorage = (key, except) => { for (const [instance, listener] of windowListeners) if (instance !== except) listener({ key }); };
async function mount(t, { saved = {}, store = new Map(Object.entries(saved)) } = {}) {
  const previous = { document: globalThis.document, localStorage: globalThis.localStorage, fetch: globalThis.fetch, addEventListener: globalThis.addEventListener };
  globalThis.document = { createElement: tag => new Node(tag), createElementNS: (_namespace, tag) => new Node(tag), addEventListener() {}, activeElement: null };
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) };
  const instance = {};
  globalThis.addEventListener = (name, listener) => { if (name === 'storage') windowListeners.push([instance, listener]); };
  t.after(() => windowListeners.splice(0, windowListeners.length, ...windowListeners.filter(([owner]) => owner !== instance)));
  globalThis.fetch = async path => ({ ok: true, json: async () => path === '/api/tools' ? { ok: true, state: 'published', tools: REGISTRY } : { ok: true, state: 'inspected', tools: [], observations: [] } });
  t.after(() => Object.assign(globalThis, previous));
  const elements = Object.fromEntries(['yourToolTrigger', 'yourToolIcon', 'yourToolName', 'yourToolPop', 'yourToolList', 'yourToolNote'].map(name => [name, new Node()]));
  elements.yourToolPop.hidden = true;
  const changes = [];
  const control = createYourTool({ elements, onChange: tools => changes.push(tools.map(tool => tool.id)) });
  await control.start();
  return { elements, control, changes, store, instance };
}

test('Your tools is a multi-select: each tool is a checkbox and ticking a second keeps the first', async t => {
  const { elements, control, changes, store } = await mount(t);
  assert.ok(rows(elements).length >= 4);
  for (const row of rows(elements)) assert.equal(row.attributes.role, 'checkbox', 'never a radio: everyone uses several tools');
  assert.equal(elements.yourToolList.attributes.role, 'group');
  elements.yourToolPop.hidden = false;
  rows(elements).find(row => row.dataset.tool === 'claude').listeners.click();
  rows(elements).find(row => row.dataset.tool === 'codex').listeners.click();
  assert.deepEqual(control.current().map(tool => tool.id), ['claude', 'codex']);
  assert.deepEqual(changes.at(-1), ['claude', 'codex']);
  assert.equal(elements.yourToolPop.hidden, false, 'ticking a tool leaves the list open for the next one');
  assert.equal(rows(elements).find(row => row.dataset.tool === 'claude').attributes['aria-checked'], 'true');
  assert.equal(rows(elements).find(row => row.dataset.tool === 'codex').attributes['aria-checked'], 'true');
  assert.deepEqual(JSON.parse(store.get(YOUR_TOOLS_CHANGES_KEY)), { unticked: [], added: ['claude', 'codex'] }, 'only what was changed here is kept');
  assert.match(elements.yourToolName.textContent, /Claude Code.*Codex CLI/, 'the header lists every chosen tool');
  rows(elements).find(row => row.dataset.tool === 'claude').listeners.click();
  assert.deepEqual(control.current().map(tool => tool.id), ['codex'], 'unticking one keeps the others');
});

test('Your tools starts from the AI clients chosen in setup, in Core registry order, unobserved ones said so', async t => {
  const { elements, control } = await mount(t, { saved: { [YOUR_TOOL_KEY]: 'codex' } });
  control.setSetupClients(['cursor', 'claude', 'codex', 'kiro']);
  assert.deepEqual(control.current().map(tool => tool.id), ['claude', 'codex', 'kiro', 'cursor']);
  assert.equal(control.current().find(tool => tool.id === 'cursor').observed, false);
  const text = textOf(elements.yourToolName);
  for (const label of ['Claude Code', 'Codex CLI', 'Kiro CLI', 'Cursor']) assert.match(text, new RegExp(label));
  assert.match(textOf(elements.yourToolNote), /Cursor: not supported yet/);
});

test('a tool Core does not support yet stays chosen and says so in words, never by a code or a Core function name', async t => {
  const { elements, control } = await mount(t);
  control.setSetupClients(['cursor', 'claude']);
  assert.deepEqual(control.current().map(tool => tool.id), ['claude', 'cursor'], 'never silently dropped or unticked');
  const cursor = rows(elements).find(row => row.dataset.tool === 'cursor');
  assert.equal(cursor.attributes['aria-checked'], 'true');
  assert.match(textOf(cursor), /Not supported yet/);
  const shown = [textOf(elements.yourToolList), textOf(elements.yourToolNote), textOf(elements.yourToolName), ...rows(elements).map(row => row.title), elements.yourToolTrigger.title].join(' ');
  assert.doesNotMatch(shown, /tool-not-observed|PREREQUISITE_UNAVAILABLE|listTools|nativeClientIds|registry/);
});

// The header's choice is setup's tools, plus tools added here, minus tools unticked here. Only those two changes are
// stored, so nothing can overwrite setup's choice; saving setup clears the unticks.
test('every tool chosen in setup is chosen in the header; an untick here lasts until setup is saved again', async t => {
  const { elements, control, store } = await mount(t);
  control.setSetupClients(['claude', 'codex']);
  rows(elements).find(row => row.dataset.tool === 'claude').listeners.click();
  rows(elements).find(row => row.dataset.tool === 'kiro').listeners.click();
  assert.deepEqual(control.current().map(tool => tool.id), ['codex', 'kiro']);
  assert.deepEqual(JSON.parse(store.get(YOUR_TOOLS_CHANGES_KEY)), { unticked: ['claude'], added: ['kiro'] });
  // Setup read again (a reload, a mode switch) keeps the untick; a tool setup newly holds is chosen.
  control.setSetupClients(['claude', 'codex', 'cursor']);
  assert.deepEqual(control.current().map(tool => tool.id), ['codex', 'kiro', 'cursor']);
  // Saving setup clears the unticks: every setup tool is chosen again; additions here stay.
  control.setupSaved();
  assert.deepEqual(control.current().map(tool => tool.id), ['claude', 'codex', 'kiro', 'cursor']);
  assert.deepEqual(JSON.parse(store.get(YOUR_TOOLS_CHANGES_KEY)), { unticked: [], added: ['kiro'] });
  // Ticking a setup tool again after an untick removes the untick rather than recording an addition.
  rows(elements).find(row => row.dataset.tool === 'codex').listeners.click();
  rows(elements).find(row => row.dataset.tool === 'codex').listeners.click();
  assert.deepEqual(JSON.parse(store.get(YOUR_TOOLS_CHANGES_KEY)), { unticked: [], added: ['kiro'] });
});

test('an older saved header choice and single choice migrate once, as additions beside setup\'s tools', async t => {
  const { control, store } = await mount(t, { saved: { [YOUR_TOOLS_KEY]: JSON.stringify(['kiro', 'codex']), [YOUR_TOOL_KEY]: 'claude', 'wb-your-tools-setup': JSON.stringify(['codex']) } });
  control.setSetupClients(['cursor']);
  assert.deepEqual(control.current().map(tool => tool.id), ['claude', 'codex', 'kiro', 'cursor']);
  assert.deepEqual(JSON.parse(store.get(YOUR_TOOLS_CHANGES_KEY)), { unticked: [], added: ['kiro', 'codex', 'claude'] });
  assert.equal(store.has(YOUR_TOOLS_KEY), false, 'the old whole-choice key is gone once migrated');
  assert.equal(store.has('wb-your-tools-setup'), false);
  // Once migrated, the old single choice is not read again.
  const again = await mount(t, { store: new Map([...store, [YOUR_TOOL_KEY, 'cursor']]) });
  again.control.setSetupClients([]);
  assert.deepEqual(again.control.current().map(tool => tool.id), ['claude', 'codex', 'kiro']);
});

test('two tabs sharing one store: a stale tab never drops a tool setup chose in the other', async t => {
  const store = new Map();
  const a = await mount(t, { store }), b = await mount(t, { store });
  a.control.setSetupClients(['claude', 'codex']);
  b.control.setSetupClients(['claude', 'codex']);
  // Tab A: setup gains Cursor and is saved. Tab B still holds setup's older copy.
  a.control.setSetupClients(['claude', 'codex', 'cursor']);
  a.control.setupSaved();
  // Tab B unticks Codex without having heard from A: it re-reads the store first and writes only its own change.
  b.elements.yourToolPop.hidden = false;
  rows(b.elements).find(row => row.dataset.tool === 'codex').listeners.click();
  assert.deepEqual(JSON.parse(store.get(YOUR_TOOLS_CHANGES_KEY)), { unticked: ['codex'], added: [] });
  // Tab A hears B's write through the storage event and shows it at once.
  fireStorage(YOUR_TOOLS_CHANGES_KEY, b.instance);
  assert.deepEqual(a.control.current().map(tool => tool.id), ['claude', 'cursor']);
  // A reload with the saved setup: Cursor is chosen, the person never unticked it.
  const reloaded = await mount(t, { store });
  reloaded.control.setSetupClients(['claude', 'codex', 'cursor']);
  assert.deepEqual(reloaded.control.current().map(tool => tool.id), ['claude', 'cursor']);
  // A tick in A after B's untick keeps B's untick: each change is made against what is stored now.
  rows(a.elements).find(row => row.dataset.tool === 'kiro').listeners.click();
  assert.deepEqual(JSON.parse(store.get(YOUR_TOOLS_CHANGES_KEY)), { unticked: ['codex'], added: ['kiro'] });
});

// Core's answers for one item across three chosen tools: Claude Code has no project location for it, Codex fits.
const browse = {
  status: 'read', tool: { id: 'claude', label: 'Claude Code' },
  compatibility: { items: [{ item: { itemId: 'x.mcp' }, support: 'unconfirmed', reason: 'Not yet confirmed.', staticBlockers: [{ code: 'scope-not-bound', detail: 'No project location.' }] }] },
  fit: [{ itemId: 'x.mcp', tools: [
    { tool: 'claude', label: 'Claude Code', fits: false, reason: 'The binding names no project location for mcp-server items.' },
    { tool: 'codex', label: 'Codex CLI', fits: true },
    { tool: 'kiro', label: 'Kiro CLI', fits: true }] }],
};

test('fit is judged across every chosen tool: one supporting tool makes the item addable and names where it fits', () => {
  const fit = toolFit({ id: 'x.mcp' }, browse);
  assert.equal(fit.judged, true);
  assert.equal(fit.addable, true);
  assert.deepEqual(fit.fits.map(tool => tool.label), ['Codex CLI', 'Kiro CLI']);
  assert.deepEqual(fit.misses.map(tool => tool.label), ['Claude Code']);
  const facts = itemBrowseFacts({ id: 'x.mcp' }, browse, browse.tool);
  assert.match(facts.words, /^Fits Codex CLI, Kiro CLI$/);
  assert.notEqual(facts.fitKey, 'none', 'not filed under "doesn’t work" because the first tool can’t take it');
  assert.match(facts.explanation, /Claude Code: The binding names no project location/);
});

test('an item no chosen tool supports is not addable, and says so for all of them', () => {
  const none = { ...browse, fit: [{ itemId: 'x.mcp', tools: browse.fit[0].tools.map(tool => ({ ...tool, fits: false, reason: tool.reason ?? 'native-only-kind' })) }] };
  const fit = toolFit({ id: 'x.mcp' }, none);
  assert.equal(fit.addable, false);
  const facts = itemBrowseFacts({ id: 'x.mcp' }, none, none.tool);
  assert.equal(facts.fitKey, 'none');
  assert.match(facts.words, /Doesn’t work in any of your tools/);
});
