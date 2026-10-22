import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startConsumer } from './server.mjs';
import { fixtureItem, fixtureRelease, rootFor } from './intent-fixtures.mjs';
const page = name => readFile(new URL(`../page/${name}`, import.meta.url), 'utf8');
const unexported = text => text.replace(/^export /gm, '');
// The page's own modules, inlined in their own scope so their top-level names stay private.
const editorModule = `const { createConfigurationEditor } = (() => {\n${unexported(await page('app/dom.js'))}\n` +
  `${unexported((await page('app/configuration-editor.js')).replace("import { el } from './dom.js';", ''))}\nreturn { createConfigurationEditor };\n})();\n`;
const source = unexported(await page('policy-file.js')) + '\n' + editorModule +
  (await page('authoring.js')).replace("import { policyFile } from './policy-file.js';", '').replace("import { createConfigurationEditor } from './app/configuration-editor.js';", '');

// Every node below one node, in document order; the configuration editor nests its controls.
const descendants = node => [node, ...(node.children ?? []).flatMap(descendants)];
const chooseButton = box => descendants(box).find(node => node.tagName === 'button' && node.textContent.startsWith('Choose '));

async function openPage(fetch) {
  const nodes = new Map();
  const node = tagName => ({ tagName, value: '', children: [], textContent: '', disabled: false,
    addEventListener() {}, setAttribute() {}, append(...values) { this.children.push(...values); }, replaceChildren(...values) { this.children = values; } });
  const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, node('node')); return nodes.get(id); }, createElement: node };
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
  await new AsyncFunction('document', 'fetch', source)(document, fetch);
  return nodes;
}

for (const changeDraft of [false, true]) test(`folder readiness waits for catalog rendering${changeDraft ? ' and a newer draft discards the pending refresh' : ' before immediate reopen'}`, async () => {
  const started = await startConsumer();
  let releaseCatalog, observeCatalog, hold = false;
  const gate = new Promise(resolve => { releaseCatalog = resolve; });
  const observed = new Promise(resolve => { observeCatalog = resolve; });
  const pageFetch = async (url, options) => {
    const response = await fetch(`${started.origin}${url}`, { ...options, headers: { ...options?.headers, origin: started.origin } });
    if (url === '/api/authoring-catalog' && hold) { observeCatalog(); await gate; }
    return response;
  };
  try {
    const nodes = await openPage(pageFetch);
    nodes.get('folder').files = [
      ['LICENSE', 'MIT License\nCopyright Example\nPermission is hereby granted.'],
      ['skills/example/SKILL.md', '---\nname: example\ndescription: A personal example.\nlicense: MIT\n---\n\nPersonal instructions.\n']
    ].map(([path, text]) => {
      const bytes = new TextEncoder().encode(text);
      return { webkitRelativePath: `chosen/${path}`, size: bytes.length, arrayBuffer: async () => bytes.buffer };
    });
    hold = true;
    const folderAction = nodes.get('folder').onchange(); await observed;
    assert.doesNotMatch(nodes.get('folder-result').textContent, /Folder validated for this page session/);
    assert.equal(nodes.get('family').children.some(option => option.value === 'Personal'), false);
    if (changeDraft) await nodes.get('new').onclick();
    const policyBefore = nodes.get('policy').value;
    releaseCatalog(); await folderAction;
    assert.equal(nodes.get('policy').value, policyBefore);
    if (changeDraft) {
      assert.equal(nodes.get('family').children.some(option => option.value === 'Personal'), false);
      assert.doesNotMatch(nodes.get('folder-result').textContent, /Folder validated for this page session/);
    } else {
      assert.match(nodes.get('folder-result').textContent, /Folder validated for this page session/);
      await nodes.get('reopen').onclick();
      assert.equal(nodes.get('family').children.some(option => option.value === 'Personal'), true);
      nodes.get('family').value = 'Personal'; nodes.get('family').onchange();
      assert.equal(nodes.get('items').children.length, 1);
    }
  } finally { releaseCatalog(); await new Promise(resolve => started.server.close(resolve)); }
});

test('supported-first browsing preserves mixed capability facts and exposes undeclared target support', async () => {
  const fact = (capability, support, reason) => ({ client: 'claude-code', surface: 'project', capability, support, reason });
  const item = (id, facts) => ({ id, label: id, package: { name: 'synthetic' }, scopes: ['project'], root: { scope: 'project' }, metadata: { discovery: { clientCapabilities: facts } } });
  const intent = { origins: [], roots: [], pins: [], exclusions: [], inputs: [], reviews: {} };
  const nodes = await openPage(async url => ({ json: async () => url.endsWith('-catalog') ? {
    items: [item('mixed', [fact('skill-material-format', 'supported', 'Documented layout.'), fact('automatic-guardrails', 'unsupported', 'Instructions do not intercept tools.'), fact('native-execution', 'unknown', 'Execution unobserved.')]), item('undeclared', [])], templates: []
  } : { status: 'ok', value: { policyBytes: [...new TextEncoder().encode('{}')], intent } } }));
  assert.equal(nodes.get('target').value, 'claude-code');
  assert.equal(nodes.get('support-filter').value, 'supported');
  assert.equal(nodes.get('items').children.length, 1);
  const visibleText = node => [node.textContent, ...node.children.map(visibleText)].join(' ');
  const text = visibleText(nodes.get('items'));
  assert.match(text, /supported · skill-material-format/);
  assert.match(text, /unsupported · automatic-guardrails.*Instructions do not intercept tools/);
  assert.match(text, /unknown · native-execution.*Execution unobserved/);
  assert.match(nodes.get('support-counts').textContent, /1 with supported.*1 with unsupported.*2 with unknown/);
  nodes.get('support-filter').value = 'all'; nodes.get('support-filter').onchange();
  assert.equal(nodes.get('items').children.length, 2);
  assert.match(visibleText(nodes.get('items')), /No capability facts declared for claude-code/);
  nodes.get('support-filter').value = 'unsupported'; nodes.get('support-filter').onchange();
  assert.equal(nodes.get('items').children.length, 1);
  nodes.get('support-filter').value = 'unknown'; nodes.get('support-filter').onchange();
  assert.equal(nodes.get('items').children.length, 2);
  nodes.get('search').value = 'undeclared'; nodes.get('search').oninput();
  assert.match(nodes.get('support-counts').textContent, /1 items in family\/search scope: 0 with supported.*0 with unsupported.*1 with unknown/);
});

test('ordinary target changes refresh counts and reasons while preserving accepted exact choices', async () => {
  const started = await startConsumer();
  try {
    const requests = [];
    const pageFetch = async (url, options) => {
      if (options?.body) requests.push({ url, body: JSON.parse(options.body) });
      return fetch(`${started.origin}${url}`, { ...options, headers: { ...options?.headers, origin: started.origin } });
    };
    const nodes = await openPage(pageFetch);
    assert.equal(nodes.get('target').value, 'claude-code');
    assert.deepEqual(nodes.get('target').children.map(option => option.value), ['claude-code', 'codex', 'copilot-vscode', 'generic', 'kiro-ide']);
    for (const family of ['Extensions', 'ECC', 'Superpowers', 'Anthropic']) {
      assert.ok(nodes.get('family').children.some(option => option.value === family));
      assert.ok(nodes.get('items').children.some(box => box.children[0].textContent.startsWith(family + ' ·')));
    }
    const text = node => [node.textContent, ...node.children.map(text)].join(' ');
    const matt = nodes.get('items').children.find(box => box.children[0].textContent.includes('ask-matt'));
    assert.match(text(matt), /unsupported · automatic-guardrails · agent-tools — Skills are instructions/);
    const ecc = nodes.get('items').children.find(box => box.children[0].textContent.includes('accessibility'));
    assert.match(text(ecc), /unknown · native-execution/);
    await chooseButton(ecc).onclick();
    assert.equal(nodes.get('accept').disabled, false);
    nodes.get('accept').onclick();
    const policy = nodes.get('policy').value, summary = nodes.get('summary').textContent;
    const countBefore = nodes.get('support-counts').textContent, callsBefore = requests.length;
    nodes.get('family').value = 'ECC'; nodes.get('family').onchange();
    nodes.get('target').value = 'copilot-vscode'; nodes.get('target').onchange();
    assert.equal(nodes.get('items').children.length, 1);
    assert.match(text(nodes.get('items')), /ecc.copilot.skill.api-design/);
    assert.match(nodes.get('support-counts').textContent, /1 with supported facts/);
    assert.notEqual(nodes.get('support-counts').textContent, countBefore);
    nodes.get('support-filter').value = 'unsupported'; nodes.get('support-filter').onchange();
    assert.ok(nodes.get('items').children.length > 0);
    assert.match(text(nodes.get('items')), /no translated native mechanism is offered/);
    nodes.get('support-filter').value = 'unknown'; nodes.get('support-filter').onchange();
    assert.ok(nodes.get('items').children.length > 0);
    assert.match(text(nodes.get('items')), /unknown · native-execution/);
    nodes.get('target').value = 'generic'; nodes.get('target').onchange();
    assert.match(text(nodes.get('items')), /No capability facts declared for generic/);
    nodes.get('support-filter').value = 'all'; nodes.get('support-filter').onchange();
    assert.ok(nodes.get('items').children.some(box => box.children[0].textContent.includes('accessibility')));
    assert.equal(nodes.get('policy').value, policy);
    assert.equal(nodes.get('summary').textContent, summary);
    assert.equal(requests.length, callsBefore, 'Browsing must not send an authoring mutation');
    await nodes.get('reopen').onclick();
    assert.equal(nodes.get('summary').textContent, summary);
    assert.equal(nodes.get('policy').value, policy);
  } finally { await new Promise(resolve => started.server.close(resolve)); }
});

test('an inventory without target declarations stays unknown and remains fully discoverable', async () => {
  const intent = { origins: [], roots: [], pins: [], exclusions: [], inputs: [], reviews: {} };
  const nodes = await openPage(async url => ({ json: async () => url.endsWith('-catalog') ? {
    items: [{ id: 'no-facts', label: 'No facts', package: { name: 'synthetic' }, root: {}, scopes: ['project'], targets: ['declared-recipe-target'] }], templates: []
  } : { status: 'ok', value: { policyBytes: [...new TextEncoder().encode('{}')], intent } } }));
  assert.equal(nodes.get('target').disabled, true);
  assert.equal(nodes.get('items').children.length, 0);
  assert.match(nodes.get('support-counts').textContent, /0 with supported.*0 with unsupported.*1 with unknown/);
  nodes.get('support-filter').value = 'unknown'; nodes.get('support-filter').onchange();
  assert.equal(nodes.get('items').children.length, 1);
  const disclosure = nodes.get('items').children[0].children.find(node => node.tagName === 'details');
  assert.deepEqual(JSON.parse(disclosure.children[1].textContent).recipeTargets, ['declared-recipe-target']);
});

test('public-reader accepted malformed capability metadata stays unknown without blocking full inventory', async () => {
  const supported = { client: 'claude-code', surface: 'project', capability: 'instruction-material', support: 'supported' };
  const declarations = [
    {}, null, [null], [{ ...supported, client: {} }], [{ ...supported, surface: {} }],
    [{ ...supported, capability: ' ' }], [{ ...supported, support: 'yes' }],
    [{ ...supported, reason: {} }], [{ ...supported, support: 'unsupported' }],
    [supported, { ...supported, support: 'yes' }]
  ];
  // fixtureRelease invokes the installed public readRelease and refuses invalid
  // releases. Descriptive discovery metadata is intentionally not schema-checked.
  const inventory = fixtureRelease('malformed-discovery', declarations.map((clientCapabilities, index) =>
    fixtureItem(`item-${index}`, {}, { metadata: { discovery: { clientCapabilities } } })));
  const intent = { origins: [], roots: [], pins: [], exclusions: [], inputs: [], reviews: {} };
  const nodes = await openPage(async url => ({ json: async () => url.endsWith('-catalog') ? {
    items: inventory.release.items.map(item => ({ ...item, root: rootFor(inventory, item.id), package: inventory.release.package })), templates: []
  } : { status: 'ok', value: { policyBytes: [...new TextEncoder().encode('{}')], intent } } }));
  assert.deepEqual(nodes.get('target').children.map(option => option.value), ['claude-code']);
  assert.equal(nodes.get('items').children.length, 1, 'Malformed supported claims must not qualify an item');
  assert.match(nodes.get('support-counts').textContent, /1 with supported.*0 with unsupported.*10 with unknown/);
  const text = node => [node.textContent, ...node.children.map(text)].join(' ');
  assert.match(text(nodes.get('items')), /unknown.*Unusable capability declarations/);
  nodes.get('support-filter').value = 'all'; nodes.get('support-filter').onchange();
  assert.equal(nodes.get('items').children.length, 10);
  nodes.get('support-filter').value = 'unknown'; nodes.get('support-filter').onchange();
  assert.equal(nodes.get('items').children.length, 10);
});
test('fresh reopen restores saved user scope/configuration and switching scopes restores each choice', async () => {
  const nodes = new Map();
  const node = tagName => ({ tagName, value: '', children: [], textContent: '', disabled: false, attributes: {}, addEventListener() {}, setAttribute(k, v) { this.attributes[k] = v; }, append(...values) { this.children.push(...values); }, replaceChildren(...values) { this.children = values; } });
  const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, node('node')); return nodes.get(id); }, createElement: node };
  const root = { releaseSha256: 'a'.repeat(64), itemId: 'configured', itemSha256: 'b'.repeat(64), scope: 'user', configuration: { directory: 'chosen' }, originIds: ['direct'] };
  const intent = { origins: [{ id: 'direct', kind: 'direct' }], roots: [root], pins: [], exclusions: [], inputs: [], reviews: {} };
  const catalog = { description: 'synthetic UI transport fixture', items: [{ id: root.itemId, label: 'Configured', scopes: ['project', 'user'], root: { ...root, scope: 'project', configuration: {} }, package: { name: 'synthetic' }, metadata: { discovery: { clientCapabilities: [{ client: 'fixture', surface: 'fixture', capability: 'fixture-material', support: 'supported' }] } } }], templates: [] };
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
  const box = nodes.get('items').children[0], scope = box.children.find(n => n.tagName === 'select');
  // The editor is rebuilt for each scope, so its controls are looked up again after every change.
  const field = () => descendants(box).find(n => n.tagName === 'input' && n.attributes['aria-label'] === 'directory for configured');
  const advanced = () => JSON.parse(descendants(box).find(n => n.tagName === 'textarea').value);
  assert.equal(scope.value, 'user'); assert.equal(field().value, 'chosen'); assert.deepEqual(advanced(), { directory: 'chosen' });
  await chooseButton(box).onclick(); assert.equal(operations[0].root.scope, 'user'); assert.deepEqual(operations[0].root.configuration, { directory: 'chosen' });
  scope.value = 'project'; scope.onchange(); assert.equal(field(), undefined); assert.deepEqual(advanced(), {});
  scope.value = 'user'; scope.onchange(); assert.equal(field().value, 'chosen'); assert.deepEqual(advanced(), { directory: 'chosen' });
});

test('editing while Prepare is pending cannot enable Apply for an older draft', async () => {
  const nodes = new Map();
  const node = tagName => ({ tagName, value: '', children: [], textContent: '', disabled: false, listeners: {},
    addEventListener(name, listener) { (this.listeners[name] ??= []).push(listener); },
    setAttribute() {}, append(...values) { this.children.push(...values); }, replaceChildren(...values) { this.children = values; } });
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

test('family filters expose every item including beyond the former forty-item cap without selecting content', async () => {
  const nodes = new Map();
  const node = tagName => ({ tagName, value: '', children: [], textContent: '', disabled: false,
    addEventListener() {}, setAttribute() {}, append(...values) { this.children.push(...values); }, replaceChildren(...values) { this.children = values; } });
  const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, node('node')); return nodes.get(id); }, createElement: node };
  const intent = { origins: [], roots: [], pins: [], exclusions: [], inputs: [], reviews: { records: [], history: [] } };
  const items = Array.from({ length: 45 }, (_, index) => ({ id: `item-${index}`, family: index < 42 ? 'Extensions' : 'Anthropic',
    label: `Item ${index}`, package: { name: 'synthetic' }, scopes: ['project'], root: { scope: 'project' },
    sources: [{ origin: { repository: 'https://github.com/mattpocock/skills' } }] }));
  const operations = [];
  const fetch = async url => ({ json: async () => {
    if (url.endsWith('-catalog')) return { items, templates: [] };
    operations.push(url); return { status: 'ok', value: { policyBytes: [...new TextEncoder().encode('{}')], intent } };
  } });
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
  await new AsyncFunction('document', 'fetch', source)(document, fetch);
  nodes.get('support-filter').value = 'all'; nodes.get('support-filter').onchange();
  assert.equal(nodes.get('items').children.length, 45);
  assert.deepEqual(nodes.get('family').children.map(option => option.textContent), ['All families', 'Extensions (42)', 'Anthropic (3)']);
  nodes.get('family').value = 'Anthropic'; nodes.get('family').onchange();
  assert.equal(nodes.get('items').children.length, 3);
  assert.match(nodes.get('items').children[0].children[0].textContent, /Anthropic/);
  nodes.get('search').value = 'item-44'; nodes.get('search').oninput();
  assert.equal(nodes.get('items').children.length, 1);
  assert.match(nodes.get('inventory-count').textContent, /1 of 45/);
  assert.deepEqual(operations, ['/api/authoring-new']);
});
