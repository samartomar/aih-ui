import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const browserSource = async () => (await readFile(new URL('../../src/policy-file.js', import.meta.url), 'utf8')).replace('export function', 'function') + '\n' + (await readFile(new URL('../../src/consumer.js', import.meta.url), 'utf8')).replace("import { policyFile } from './policy-file.js';", '');

test('a delayed reopen cannot replace newer policy edits or mode', async () => {
  const nodes = new Map();
  const document = { getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, { value: id === 'mode' ? 'vibe' : '', textContent: '',
      listeners: {}, addEventListener(event, callback) { this.listeners[event] = callback; }, replaceChildren() {} });
    return nodes.get(id);
  } };
  let deliver;
  const delayed = new Promise(resolve => { deliver = resolve; });
  const fetch = async url => ({ json: async () => url === '/api/catalog'
    ? { items: [], releaseSha256: 'test', hostAvailable: false, packages: [] } : delayed });
  const source = await browserSource();
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
  await new AsyncFunction('document', 'fetch', source)(document, fetch);
  document.getElementById('reopen-result').textContent = '';
  const pending = nodes.get('reopen').onclick();
  nodes.get('policy').value = 'newer edit'; nodes.get('policy').listeners.input();
  deliver({ valid: true, editable: true, policy: { mode: 'enterprise' }, intent: { roots: [], excludedItemIds: [] } });
  await pending;
  assert.equal(nodes.get('mode').value, 'vibe');
  assert.equal(nodes.get('policy').value, 'newer edit');
  assert.equal(nodes.get('reopen-result').textContent, '');
});

test('reopened explicit empty string stays present when authoring', async () => {
  const makeNode = () => ({ value: '', checked: false, textContent: '', children: [], listeners: {},
    addEventListener(event, callback) { this.listeners[event] = callback; }, setAttribute() {},
    append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; } });
  const nodes = new Map();
  const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, makeNode()); return nodes.get(id); },
    createElement: makeNode, createTextNode: text => ({ textContent: text }) };
  document.getElementById('mode').value = 'vibe';
  let captured;
  const fetch = async (url, options) => ({ json: async () => {
    if (url === '/api/catalog') return { items: [{ id: 'example', label: 'Example', kind: 'skill', scopes: ['project'], inputs: { note: { type: 'string', default: 'default' } }, dependencies: { requires: [], optional: [] } }], packages: [], hostAvailable: false };
    if (url === '/api/reopen') return { valid: true, editable: true, policy: { mode: 'vibe' }, intent: { roots: [{ itemId: 'example', scope: 'project', configuration: { note: '' } }], excludedItemIds: [] } };
    captured = JSON.parse(options.body); return { valid: false };
  } });
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
  await new AsyncFunction('document', 'fetch', await browserSource())(document, fetch);
  await nodes.get('reopen').onclick(); await nodes.get('author').onclick();
  assert.equal(Object.hasOwn(captured.roots[0].configuration, 'note'), true);
  assert.equal(captured.roots[0].configuration.note, '');
});

test('a delayed policy file read cannot overwrite a newer edit', async () => {
  const nodes = new Map();
  const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', listeners: {}, addEventListener(event, callback) { this.listeners[event] = callback; }, replaceChildren() {} }); return nodes.get(id); } };
  let deliver; const delayed = new Promise(resolve => { deliver = resolve; });
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
  await new AsyncFunction('document', 'fetch', await browserSource())(document, async () => ({ json: async () => ({items:[],packages:[],hostAvailable:false}) }));
  nodes.get('open').files = [{ arrayBuffer: () => delayed }];
  const pending = nodes.get('open').onchange();
  nodes.get('policy').value = 'newer edit'; nodes.get('policy').listeners.input();
  deliver(new TextEncoder().encode('old file contents').buffer); await pending;
  assert.equal(nodes.get('policy').value, 'newer edit');
});
