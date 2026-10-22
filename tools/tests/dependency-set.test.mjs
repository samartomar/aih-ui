import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dependencyRows } from '../../src/app/dependency-set.js';

const ref = (itemId, releaseSha256 = 'a', scope = 'project') => ({ itemId, releaseSha256, scope });
const inclusion = (root, item, path = [root, item]) => ({ root, item, path });

test('each root displays its required closure, including transitive and shared dependencies once', () => {
  const first = ref('first'), second = ref('second'), shared = ref('shared'), nested = ref('nested');
  const input = { roots: [first, second], inclusions: [
    inclusion(first, first, [first]), inclusion(first, shared), inclusion(first, nested, [first, shared, nested]),
    inclusion(first, nested, [first, nested]), inclusion(second, second, [second]), inclusion(second, shared)
  ] };
  const original = structuredClone(input);
  assert.deepEqual(dependencyRows(input), [
    { root: first, dependencies: [{ item: shared }, { item: nested }] },
    { root: second, dependencies: [{ item: shared }] }
  ]);
  assert.deepEqual(input, original);
});
test('same item ids in different releases or scopes stay separate', () => {
  const root = ref('root'), otherRelease = ref('root', 'b'), otherScope = ref('root', 'a', 'user');
  assert.deepEqual(dependencyRows({ roots: [root, otherRelease, otherScope], inclusions: [
    inclusion(root, ref('dep')), inclusion(root, ref('dep', 'b')), inclusion(root, ref('dep', 'a', 'user')),
    inclusion(otherRelease, ref('other')), inclusion(otherScope, ref('user-dep'))
  ] }).map(row => row.dependencies.map(({ item }) => item)), [
    [ref('dep'), ref('dep', 'b'), ref('dep', 'a', 'user')], [ref('other')], [ref('user-dep')]
  ]);
});
test('roots without inclusions have an empty dependency set', () => {
  assert.deepEqual(dependencyRows({ roots: [] }), []);
  assert.deepEqual(dependencyRows({ roots: [ref('alone')] }), [{ root: ref('alone'), dependencies: [] }]);
});

test('proposal renders dependency hooks and one acceptance publishes the whole candidate', async t => {
  const { createAuthoringWorkspace } = await import('../../src/app/authoring-workspace.js');
  const { createAuthoringClient } = await import('../../src/app/authoring-client.js');
  const nodes = new Map(), created = [];
  const element = tagName => {
    const node = { tagName, children: [], dataset: {}, listeners: {}, value: '', textContent: '', options: [],
      classList: { remove() {}, toggle() {} }, getAttribute() { return null; }, setAttribute() {}, removeAttribute() {}, after() {}, before() {}, focus() { globalThis.document.activeElement = this; }, contains(target) { return target === this || this.children.some(child => child.contains?.(target)); },
      closest(selector) { if (selector === 'details') { let ancestor = this.parentElement; while (ancestor) { if (ancestor.tagName === 'details') return ancestor; ancestor = ancestor.parentElement; } } return null; },
      get childNodes() { return this.children; },
      addEventListener(name, listener) { const prior = this.listeners[name]; this.listeners[name] = prior ? (...args) => { prior(...args); return listener(...args); } : listener; },
      append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }, prepend(...children) { this.children.unshift(...children); },
      replaceChildren(...children) { this.children = children; }, get lastChild() { return this.children.at(-1); } };
    created.push(node); return node;
  };
  const prior = { document: globalThis.document, fetch: globalThis.fetch, Option: globalThis.Option, window: globalThis.window };
  t.after(() => { for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  const media = { matches: false, addEventListener(name, callback) { this.change = callback; } };
  globalThis.window = { addEventListener() {}, matchMedia: () => media };
  const documentListeners = {};
  globalThis.document = { body: element('body'), addEventListener(name, listener) { documentListeners[name] = listener; }, dispatchEvent(event) { documentListeners[event.type]?.(event); }, createElement: element, createTextNode: textContent => ({ textContent }),
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, element('div')); return nodes.get(id); }, querySelector(selector) { return selector === 'dialog[open]' ? null : element('div'); } };
  globalThis.Option = function(textContent, value) { return { textContent, value }; };
  const metricWrapper = element('details'), metricStrip = globalThis.document.getElementById('framework-matrix-tabs'); metricWrapper.append(metricStrip);
  const root = ref('chosen'), dependency = ref('dependency');
  const initial = { roots: [], pins: [], origins: [] };
  const candidate = { intent: { ...initial, roots: [root], pins: [root, dependency] }, inclusions: [inclusion(root, root, [root]), inclusion(root, dependency)], policyBytes: [...new TextEncoder().encode('{"complete":true}')] };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: 'ok', value: candidate }) });
  const client = createAuthoringClient(); client.publish({ intent: initial, policyBytes: [...new TextEncoder().encode('{}')] });
  const workspace = createAuthoringWorkspace(client);
  workspace.present(await client.propose({ type: 'select', root }));
  const dependencyNode = created.find(node => node.dataset.dependencyOf === root.itemId);
  assert.match(dependencyNode.textContent, /Required dependency: dependency/);
  assert.ok(created.some(node => /No separate dependency approval/.test(node.textContent)));
  assert.equal(client.intent.roots.length, 0);
  const accept = created.find(node => node.id === 'policy-accept');
  assert.equal(accept.textContent, 'Add to setup');
  const reviewPanel = created.find(node => node.id === 'policy-review-panel');
  assert.equal(reviewPanel.hidden, false, 'choosing opens review without navigation');
  const discard = created.find(node => node.id === 'policy-discard'); discard.listeners.click();
  assert.equal(client.candidate, undefined); assert.equal(client.intent.roots.length, 0);
  workspace.present(await client.propose({ type: 'select', root }));
  accept.listeners.click();
  assert.equal(reviewPanel.hidden, false, 'acceptance keeps the same review surface');
  assert.deepEqual(client.intent, candidate.intent);
  assert.deepEqual([...client.bytes], candidate.policyBytes);
  assert.equal(client.candidate, undefined);
  assert.equal(created.find(node => node.id === 'policy-proposal-actions').hidden, true);
  assert.equal(document.activeElement.id, 'policy-review-panel-title');
  const reviewTrigger = document.getElementById('review-project-changes');
  reviewTrigger.listeners.click(); assert.equal(reviewPanel.hidden, true);
  client.reopen = async () => ({ status: 'refused', diagnostics: [{ message: 'Exact source unavailable' }] });
  const check = created.find(node => node.id === 'check-project-policy');
  assert.equal(check.closest('details')?.id, 'setup-advanced', "Check Policy sits in Your setup's Advanced section");
  // Your setup's Advanced section holds the policy file, update, improvement, trial, workspace and authority controls.
  const within = (id, container) => { for (let at = created.find(node => node.id === id)?.parentElement; at; at = at.parentElement) if (at.id === container) return true; return false; };
  for (const id of ['policy-save', 'policy-file-actions', 'authority-source', 'policy-open'])
    assert.ok(within(id, 'setup-advanced'), `${id} is inside Advanced`);
  const advanced = created.find(node => node.id === 'setup-advanced');
  const sections = advanced.children.filter(node => node.tagName === 'details').map(node => node.children[0]?.textContent);
  for (const label of ['File actions: new, open and validate', 'Available updates', 'Improvement suggestions', 'Improvement trials', 'Workspace repositories', 'Sources and execution'])
    assert.ok(sections.includes(label), `${label} is inside Advanced`);
  assert.equal(reviewPanel.children.at(-1), advanced, 'Advanced is the last part of the drawer');
  for (const id of ['policy-accept', 'policy-roots']) assert.equal(within(id, 'setup-advanced'), false, `${id} stays on the default drawer`);
  await check.listeners.click();
  assert.equal(reviewPanel.hidden, false, 'Check Policy opens visible results');
  assert.match(created.find(node => node.id === 'policy-status').textContent, /Exact source unavailable/);
  media.matches = true; media.change();
  assert.equal(document.getElementById('main-content').inert, true);
  assert.equal(document.getElementById('nav-rail').inert, true);
  assert.equal(metricWrapper.inert, true, 'covered metric disclosure blocks pointer and focus through native inert');
  documentListeners.focusin({ target: document.getElementById('nav-rail') });
  assert.equal(document.activeElement.id, 'policy-review-panel-title', 'covered background cannot take focus');
  documentListeners.focusin({ target: metricStrip });
  assert.equal(document.activeElement.id, 'policy-review-panel-title', 'covered metric controls cannot take focus');
  document.dispatchEvent(new CustomEvent('aih:inspector-open'));
  assert.equal(reviewPanel.hidden, true);
  assert.equal(document.getElementById('main-content').inert, false);
  assert.equal(document.getElementById('nav-rail').inert, false);
  assert.equal(metricWrapper.inert, false);
});
