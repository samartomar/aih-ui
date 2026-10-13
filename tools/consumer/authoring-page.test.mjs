import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = (await readFile(new URL('../page/policy-file.js', import.meta.url), 'utf8')).replace('export function', 'function') + '\n' +
  (await readFile(new URL('../page/authoring.js', import.meta.url), 'utf8')).replace("import { policyFile } from './policy-file.js';", '');
test('fresh reopen restores saved user scope/configuration and switching scopes restores each choice', async () => {
  const nodes = new Map();
  const node = tagName => ({ tagName, value: '', children: [], textContent: '', disabled: false, attributes: {}, addEventListener() {}, setAttribute(k, v) { this.attributes[k] = v; }, append(...values) { this.children.push(...values); }, replaceChildren() { this.children = []; } });
  const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, node('node')); return nodes.get(id); }, createElement: node };
  const root = { releaseSha256: 'a'.repeat(64), itemId: 'configured', itemSha256: 'b'.repeat(64), scope: 'user', configuration: { directory: 'chosen' }, originIds: ['direct'] };
  const intent = { origins: [{ id: 'direct', kind: 'direct' }], roots: [root], pins: [], exclusions: [], inputs: [], reviews: {} };
  const catalog = { description: 'synthetic UI transport fixture', items: [{ id: root.itemId, label: 'Configured', scopes: ['project', 'user'], root: { ...root, scope: 'project', configuration: {} }, package: { name: 'synthetic' } }], templates: [] };
  const operations = [];
  const fetch = async (url, options) => ({ json: async () => {
    if (url === '/api/authoring-catalog') return catalog;
    if (url.endsWith('-new')) return { status: 'ok', value: { policyBytes: [...new TextEncoder().encode('{}')], intent: { ...intent, roots: [] } } };
    if (url.endsWith('-read')) return { status: 'ok', value: { editing: 'available', intent, optional: [] } };
    operations.push(JSON.parse(options.body).operation); return { status: 'refused', diagnostics: [] };
  } });
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
  await new AsyncFunction('document', 'fetch', source)(document, fetch);
  await nodes.get('reopen').onclick();
  const controls = nodes.get('items').children[0].children;
  const config = controls.find(n => n.tagName === 'input'), scope = controls.find(n => n.tagName === 'select'), choose = controls.find(n => n.tagName === 'button');
  assert.equal(scope.value, 'user'); assert.equal(config.value, '{"directory":"chosen"}');
  await choose.onclick(); assert.equal(operations[0].root.scope, 'user'); assert.deepEqual(operations[0].root.configuration, { directory: 'chosen' });
  scope.value = 'project'; scope.onchange(); assert.equal(config.value, '{}');
  scope.value = 'user'; scope.onchange(); assert.equal(config.value, '{"directory":"chosen"}');
});

test('editing while Prepare is pending cannot enable Apply for an older draft', async () => {
  const nodes = new Map();
  const node = tagName => ({ tagName, value: '', children: [], textContent: '', disabled: false, listeners: {},
    addEventListener(name, listener) { (this.listeners[name] ??= []).push(listener); },
    setAttribute() {}, append(...values) { this.children.push(...values); }, replaceChildren() { this.children = []; } });
  const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, node('node')); return nodes.get(id); }, createElement: node };
  const intent = { origins: [], roots: [], pins: [], exclusions: [], inputs: [], reviews: { records: [], history: [] } };
  let answerPrepare;
  const fetch = async url => ({ json: async () => {
    if (url.endsWith('-catalog')) return { executionAvailable: true, items: [], templates: [] };
    if (url.endsWith('-new')) return { status: 'ok', value: { policyBytes: [...new TextEncoder().encode('{}')], intent } };
    if (url.endsWith('-authority')) return { status: 'ok', value: { mode: 'vibe' } };
    if (url.endsWith('-prepare')) return new Promise(resolve => { answerPrepare = resolve; });
    throw Error(`Unexpected request ${url}`);
  } });
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
  await new AsyncFunction('document', 'fetch', source)(document, fetch);
  const pending = nodes.get('prepare').onclick();
  await new Promise(resolve => setImmediate(resolve));
  nodes.get('policy').value = '{"changed":true}';
  for (const listener of nodes.get('policy').listeners.input) listener();
  answerPrepare({ status: 'ready', sessionId: 'old-live-session', review: { reviewDigest: 'old-digest' } });
  await pending;
  assert.equal(nodes.get('apply').disabled, true);
  assert.match(nodes.get('execution').textContent, /changed/);
  assert.match(nodes.get('authority-summary').textContent, /Refresh authority/);
});
