import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFrameworkNavigation } from '../../src/catalog/frameworks.js';
import { SETUP_TOOLS_LOADING, createToolListStore, listedTools, readToolList, setupToolsNotice, toolLabels, toolNames } from '../../src/app/tool-list.js';

// One tool list: setup, the header's Your tools and the rail read Core's listTools({ includeUnobserved: true }) answer
// (GET /api/tools) and show its tools by Core's labels.
const LIST = { state: 'published', tools: [
  { id: 'claude', label: 'Claude Code', surface: 'cli', observed: true },
  { id: 'codex', label: 'Codex CLI', surface: 'cli', observed: true },
  { id: 'copilot', label: 'Copilot CLI', surface: 'cli', observed: true },
  { id: 'cursor', label: 'Cursor', surface: 'ide', observed: false, refusal: { code: 'PREREQUISITE_UNAVAILABLE', reason: 'tool-not-observed' } },
] };

class Node {
  constructor(tag = 'div') { this.tag = tag; this.className = ''; this.textContent = ''; this.title = ''; this.children = []; this.listeners = {}; this.attributes = {}; this.dataset = {}; this.hidden = false; }
  append(...nodes) { this.children.push(...nodes.map(node => typeof node === 'string' ? Object.assign(new Node('#text'), { textContent: node }) : node)); }
  appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, action) { this.listeners[name] = action; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  contains() { return false; }
  focus() {}
}
const walk = node => [node, ...node.children.flatMap(walk)];

test('the list keeps Core\'s ids and labels; a chosen id Core no longer lists is counted, never shown raw', () => {
  assert.deepEqual(listedTools(LIST).map(tool => tool.id), ['claude', 'codex', 'copilot', 'cursor']);
  assert.equal(listedTools({ state: 'failed', reason: 'x' }), null);
  const labels = toolLabels(LIST);
  assert.deepEqual(labels, { claude: 'Claude Code', codex: 'Codex CLI', copilot: 'Copilot CLI', cursor: 'Cursor' });
  assert.equal(toolNames(labels, ['claude', 'cursor']), 'Claude Code, Cursor');
  assert.equal(toolNames(labels, ['claude', 'gone-tool']), 'Claude Code and 1 tool Core no longer lists');
  assert.doesNotMatch(toolNames(labels, ['gone-tool', 'other-gone']), /gone-tool|other-gone/);
});

test('the rail\'s observations note names every chosen tool and says plainly which have none yet', t => {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Node(tag), createElementNS: (_namespace, tag) => new Node(tag), getElementById: () => null, addEventListener() {}, activeElement: null };
  t.after(() => { globalThis.document = previous; });
  const container = new Node();
  const rail = createFrameworkNavigation({ container, onChoose() {}, onFirstStep() {} });
  rail.setCatalog({ frameworks: [], hostPlatform: { os: 'linux', arch: 'x64' } });
  rail.setTool(LIST.tools.filter(tool => ['claude', 'codex', 'cursor'].includes(tool.id)));
  const note = walk(container).find(node => node.dataset.compatibilityNote !== undefined);
  const summary = note.children.find(node => node.tag === 'summary').textContent;
  for (const label of ['Claude Code', 'Codex CLI', 'Cursor']) assert.ok(summary.split('.')[0].includes(label), `the note names ${label} among your tools: ${summary}`);
  assert.match(summary, /None yet for Cursor: not supported yet/);
  assert.doesNotMatch(summary, /observed by Core|tool-not-observed|listTools/);
  rail.setTool(LIST.tools.filter(tool => tool.id === 'cursor'));
  const only = walk(container).find(node => node.dataset.compatibilityNote !== undefined).children.find(node => node.tag === 'summary').textContent;
  assert.match(only, /^Compatibility observations for Cursor\. None yet for Cursor/);
});

test('setup says in fixed words that Your tools couldn\'t be loaded, never the raw error', () => {
  const sentence = "Your tools couldn't be loaded. Tools you already chose stay chosen; you can continue and choose them later from Settings.";
  assert.equal(setupToolsNotice(undefined), SETUP_TOOLS_LOADING, 'before any answer: loading, and the person may go on');
  assert.match(SETUP_TOOLS_LOADING, /^Loading your tools… You can continue and choose them later from Settings\.$/);
  for (const list of [{ state: 'failed', reason: 'Failed to fetch' }, { state: 'failed', reason: "Unexpected token '<', \"<html>\" is not valid JSON" },
    { state: 'unavailable', reason: 'The installed Core does not publish its tool list.' }, { state: 'published', tools: [] }]) {
    assert.equal(setupToolsNotice(list), sentence, JSON.stringify(list));
  }
  assert.equal(setupToolsNotice(LIST), null);
});

// One shared read: every consumer hears every answer; a failure is retried once before anyone hears of it.
const deferredRead = () => { const reads = []; const read = () => new Promise(resolve => reads.push(resolve)); return { reads, read }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('one read serves every consumer, and a list that arrives late reaches each of them', async () => {
  const { reads, read } = deferredRead();
  const store = createToolListStore({ read });
  const header = [], setup = [];
  store.subscribe(value => header.push(value.state)); store.subscribe(value => setup.push(value.state));
  store.load(); store.load(); store.load();
  assert.equal(reads.length, 1, 'setup, the header and the rest share one request');
  reads[0](LIST); await tick();
  assert.deepEqual([header, setup], [['published'], ['published']]);
  await store.load();
  assert.equal(reads.length, 1, 'a list already here is not read again');
  const late = []; store.subscribe(value => late.push(value.tools.length));
  assert.deepEqual(late, [4], 'a consumer that subscribes after the answer gets it at once');
});

test('a failed read is retried once for everyone, with no failure heard before a list that comes on the retry', async () => {
  const { reads, read } = deferredRead();
  const store = createToolListStore({ read });
  const heard = []; store.subscribe(value => heard.push(value.state));
  store.load();
  reads[0]({ state: 'failed', reason: 'busy' }); await tick();
  assert.equal(reads.length, 2, 'one retry'); assert.deepEqual(heard, [], 'no "couldn\'t be loaded" flash');
  reads[1](LIST); await tick();
  assert.deepEqual(heard, ['published']);
});

test('after the retry fails too, everyone hears the failure; a later load (setup re-opened) reads again and updates them all', async () => {
  const { reads, read } = deferredRead();
  const store = createToolListStore({ read });
  const heard = []; store.subscribe(value => heard.push(value.state));
  store.load();
  reads[0]({ state: 'failed', reason: 'a' }); await tick(); reads[1]({ state: 'failed', reason: 'b' }); await tick();
  assert.deepEqual(heard, ['failed']);
  store.load();
  assert.equal(reads.length, 3, 'a failure is read again on the next load');
  reads[2](LIST); await tick();
  assert.deepEqual(heard, ['failed', 'published']);
  store.load(); assert.equal(reads.length, 3);
});

test('a read that never answers is a failure after the timeout, so the page can say so and go on', async t => {
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  let aborted = false;
  globalThis.fetch = (_path, { signal }) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }));
  const started = Date.now();
  const answer = await readToolList({ timeoutMs: 50 });
  assert.equal(answer.state, 'failed');
  assert.ok(Date.now() - started < 2000);
  assert.equal(aborted, true, 'the stalled request is abandoned');
});
