import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchingOptions, fillBoundedOptions, OPTION_LIMIT } from '../../src/app/bounded-options.js';
import { configurationFields, createConfigurationEditor } from '../../src/app/configuration-editor.js';
import { artifactDiff } from '../../src/app/proposal-diff.js';
import { createAuthoringClient } from '../../src/app/authoring-client.js';

test('large option lists stay bounded and an exact selection survives filtering', t => {
  const prior = globalThis.Option;
  globalThis.Option = class { constructor(text, value) { this.text = text; this.value = value; } };
  t.after(() => { globalThis.Option = prior; });
  const entries = Array.from({ length: 2000 }, (_, id) => ({ id: `choice-${id}`, label: `Choice ${id}` }));
  assert.equal(matchingOptions(entries, '').entries.length, OPTION_LIMIT);
  const select = { value: 'choice-1999', replaceChildren(...values) { this.options = values; }, append(option) { this.options.push(option); } }, message = {};
  fillBoundedOptions({ select, entries, query: 'Choice 1', label: item => item.label, key: item => item.id, message });
  assert.equal(select.value, 'choice-1999');
  assert.ok(select.options.length <= OPTION_LIMIT + 2);
  assert.match(message.textContent, /Search to narrow/);
  fillBoundedOptions({ select, entries, query: 'no match', label: item => item.label, key: item => item.id, message });
  assert.equal(select.value, 'choice-1999');
  assert.equal(select.options[0].text, 'No matches — change your search');
});

test('configuration preserves falsy values and existing shapes and never invents fields', () => {
  const rows = configurationFields({ enabled: false, budget: 0, extra: { nested: true } }, { enabled: { default: true }, mode: { default: 'fast', description: 'Published choice' }, unknown: {} });
  assert.equal(rows.find(row => row.name === 'enabled').value, false);
  assert.equal(rows.find(row => row.name === 'budget').value, 0);
  assert.equal(rows.find(row => row.name === 'mode').type, 'string');
  assert.equal(rows.find(row => row.name === 'mode').present, false);
  assert.equal(rows.find(row => row.name === 'extra').type, 'object');
  assert.equal(rows.find(row => row.name === 'unknown').type, undefined);
  assert.equal(rows.length, 5);
});

test('structured configuration edits typed required new fields and nested arrays and objects', async t => {
  const prior = globalThis.document;
  const controls = [];
  const create = (tag, label) => { const node = { tag, textContent: label, children: [], listeners: {}, append(...children) { this.children.push(...children); }, setAttribute(key, value) { this[key] = value; }, addEventListener(key, fn) { this.listeners[key] = fn; }, setCustomValidity() {}, reportValidity() {}, focus() {} }; controls.push(node); return node; };
  globalThis.document = { createElement: tag => create(tag) }; t.after(() => { globalThis.document = prior; });
  let proposed;
  const makeButton = (label, action) => { const button = create('button', label); button.action = action; return button; };
  createConfigurationEditor({ configuration: { nested: { enabled: false, list: [1, 'two', null] } }, inputs: { requiredName: { type: 'string', required: true }, count: { type: 'number' } }, label: 'Example', button: makeButton, review: value => { proposed = value; } });
  const field = name => controls.find(control => control['aria-label'] === name);
  assert.equal(field('Set requiredName explicitly').checked, true);
  assert.equal(field('Set requiredName explicitly').disabled, true);
  field('requiredName for Example').value = 'Project name';
  field('nested for Example.enabled').checked = true;
  field('nested for Example.list.0').value = '3';
  field('nested for Example.list.1').value = 'updated';
  const submit = controls.find(control => control.textContent === 'Review configuration');
  await submit.action();
  assert.deepEqual(proposed, { requiredName: 'Project name', nested: { enabled: true, list: [3, 'updated', null] } });
  assert.equal(Object.hasOwn(proposed, 'count'), false);
});

test('required object without a supplied shape explicitly blocks structured review', t => {
  const prior = globalThis.document; const controls = [];
  globalThis.document = { createElement(tag) { const node = { tag, children: [], append(...children) { this.children.push(...children); }, setAttribute() {}, addEventListener() {} }; controls.push(node); return node; } };
  t.after(() => { globalThis.document = prior; });
  createConfigurationEditor({ inputs: { missing: { type: 'object', required: true } }, label: 'Example', button: (label, fn) => { const node = { textContent: label, fn }; controls.push(node); return node; }, review: () => assert.fail('blocked shape cannot be reviewed') });
  assert.equal(controls.find(node => node.textContent === 'Review configuration').disabled, true);
  assert.ok(controls.some(node => node.textContent?.includes('Structured review blocked for: missing')));
});

test('artifact review reveals exact metadata, source, exclusions and configuration changes', () => {
  const before = { metadata: { 'aih/workbench': { source: 'a', exclusions: [] } }, configuration: { size: 0 } };
  const after = { configuration: { size: 1 }, metadata: { 'aih/workbench': { source: 'b', exclusions: ['optional'] } } };
  const rows = artifactDiff(before, after);
  assert.deepEqual(rows.map(row => row.path).sort(), ['/configuration/size', '/metadata/aih~1workbench/exclusions', '/metadata/aih~1workbench/source']);
  assert.deepEqual(artifactDiff(before, structuredClone(before)), []);
  assert.deepEqual(artifactDiff({ a: 1 }, {}), [{ path: '/a', before: 1, after: undefined }]);
});

test('discard invalidates pending proposals without erasing accepted bytes or download state', async t => {
  const prior = globalThis.fetch; let complete;
  globalThis.fetch = () => new Promise(resolve => { complete = resolve; });
  t.after(() => { globalThis.fetch = prior; });
  const client = createAuthoringClient({ sessionRecovery: false });
  client.publish({ policyBytes: [1], intent: { roots: [], pins: [] } });
  client.markDownloaded();
  const pending = client.propose({ type: 'select' }); client.discard();
  complete({ ok: true, json: async () => ({ status: 'ok', value: { policyBytes: [2], intent: { roots: [{}], pins: [] } } }) });
  assert.equal((await pending).status, 'superseded');
  assert.equal(client.candidate, undefined); assert.equal(client.dirty, false);
  assert.deepEqual(client.bytes, Uint8Array.of(1));
});
