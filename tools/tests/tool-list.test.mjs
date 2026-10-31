import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFrameworkNavigation } from '../../src/catalog/frameworks.js';
import { listedTools, setupToolsNotice, toolLabels, toolNames } from '../../src/app/tool-list.js';

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
  for (const list of [undefined, { state: 'failed', reason: 'Failed to fetch' }, { state: 'failed', reason: "Unexpected token '<', \"<html>\" is not valid JSON" },
    { state: 'unavailable', reason: 'The installed Core does not publish its tool list.' }, { state: 'published', tools: [] }]) {
    assert.equal(setupToolsNotice(list), sentence, JSON.stringify(list));
  }
  assert.equal(setupToolsNotice(LIST), null);
});
