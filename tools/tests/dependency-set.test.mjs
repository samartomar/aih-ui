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
      classList: { remove() {}, toggle() {} }, getAttribute() { return null; }, setAttribute() {}, removeAttribute() {}, after() {},
      addEventListener(name, listener) { this.listeners[name] = listener; },
      append(...children) { this.children.push(...children); }, prepend(...children) { this.children.unshift(...children); },
      replaceChildren(...children) { this.children = children; }, get lastChild() { return this.children.at(-1); } };
    created.push(node); return node;
  };
  const prior = { document: globalThis.document, fetch: globalThis.fetch, Option: globalThis.Option };
  t.after(() => { for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  globalThis.document = { createElement: element, createTextNode: textContent => ({ textContent }),
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, element('div')); return nodes.get(id); }, querySelector() { return element('div'); } };
  globalThis.Option = function(textContent, value) { return { textContent, value }; };
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
  assert.equal(accept.textContent, 'Accept choices with dependencies');
  accept.listeners.click();
  assert.deepEqual(client.intent, candidate.intent);
  assert.deepEqual([...client.bytes], candidate.policyBytes);
  assert.equal(client.candidate, undefined);
});
