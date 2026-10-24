import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAiTools } from '../../src/app/ai-tools.js';

class Node {
  constructor(tag = 'div') { this.tag = tag; this.className = ''; this.textContent = ''; this.title = ''; this.children = []; this.listeners = {}; this.attributes = {}; this.dataset = {};
    const classes = new Set(); this.classList = { contains: name => classes.has(name), toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name); }, add: name => classes.add(name) }; }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, action) { this.listeners[name] = action; }
  focus() {}
}
const textOf = node => [node.textContent, ...node.children.map(textOf)].join(' ');

function mount(t) {
  const previous = { document: globalThis.document };
  globalThis.document = { createElement: tag => new Node(tag), addEventListener() {} };
  t.after(() => { globalThis.document = previous.document; });
  const elements = Object.fromEntries(['aiToolsTrigger', 'aiToolsCount', 'aiToolsPop', 'aiToolsList', 'aiToolsNote'].map(name => [name, new Node()]));
  elements.aiToolsPop.classList.add('hidden');
  const tools = createAiTools({ elements, onSelectionChange() {} });
  tools.setTargets({ state: 'published', targets: ['claude', 'codex'], labels: {} });
  return { elements, tools };
}

test('the AI tools control says an unchecked client is not checked, never "not connected"', t => {
  const { elements, tools } = mount(t);
  tools.setSelection(['claude']);
  const note = textOf(elements.aiToolsNote), tip = elements.aiToolsTrigger.title;
  assert.match(note, /Installed or connected: not checked\./);
  assert.match(tip, /Installed or connected: not checked\./);
  for (const text of [note, tip]) assert.doesNotMatch(text, /not connected/i);
  assert.match(elements.aiToolsCount.textContent, /^1\/2$/);
});
