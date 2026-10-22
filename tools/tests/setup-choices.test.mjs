import test from 'node:test';
import assert from 'node:assert/strict';
import { choiceLines, createSetupChoices } from '../../src/app/setup-choices.js';

// Your choices: one line per chosen item or starting set, with the items it needs folded under it. The needed-by
// relation is setupNeeds' (what Catalog resolved); supporting material is supporting.js'.
const REL = 'r'.repeat(64);
const ref = itemId => ({ releaseSha256: REL, itemId, scope: 'project' });
const item = (id, label, kind = 'skill') => ({ id, label, kind, root: { releaseSha256: REL } });
const items = [item('grill-me', 'grill-me'), item('grilling', 'grilling'), item('notices', 'Extensions licenses and notices', 'instruction'),
  item('tdd', 'tdd'), item('git-guard', 'git-guard', 'hook'), item('git-guard.scripts', 'hooks/hooks.json', 'hook')];
const key = value => `${REL}/${value}`;
const supporting = new Set([key('notices'), key('git-guard.scripts')]);

test('each chosen item is one line with the items it needs folded under it, by name, supporting files marked', () => {
  const roots = [ref('grill-me'), ref('tdd'), ref('git-guard')];
  const needs = new Map([[key('grilling'), [roots[0]]], [key('notices'), [roots[0], roots[1]]], [key('git-guard.scripts'), [roots[2]]]]);
  const lines = choiceLines({ roots, needs, items, supporting });
  assert.deepEqual(lines.map(line => [line.name, line.kind, line.needed.map(entry => [entry.name, entry.supporting])]), [
    ['grill-me', 'skill', [['grilling', false], ['Extensions licenses and notices', true]]],
    ['tdd', 'skill', [['Extensions licenses and notices', true]]],
    ['git-guard', 'hook', [['hooks/hooks.json', true]]]]);
  assert.equal(lines[0].root, roots[0]);
});

test('a chosen item that another chosen item needs keeps its own line and is not folded twice', () => {
  const roots = [ref('grill-me'), ref('grilling')];
  const lines = choiceLines({ roots, needs: new Map([[key('grilling'), [roots[0]]]]), items, supporting });
  assert.deepEqual(lines.map(line => [line.name, line.needed.length]), [['grill-me', 0], ['grilling', 0]]);
});

test('an item the installed Catalog no longer lists is named by its id, never left blank', () => {
  const roots = [ref('gone.item')];
  const lines = choiceLines({ roots, needs: new Map([[key('other.gone'), [roots[0]]]]), items, supporting });
  assert.deepEqual(lines.map(line => [line.name, line.needed.map(entry => entry.name)]), [['gone.item', ['other.gone']]]);
});

// A small DOM: enough for the section to build its rows.
function fake(tag, className = '', text) {
  const node = { tag, className, textContent: text ?? '', children: [], dataset: {}, attributes: {}, hidden: false, listeners: {},
    append(...children) { for (const child of children) if (typeof child === 'object') this.children.push(child); },
    replaceChildren(...children) { this.children = []; this.append(...children); },
    setAttribute(key, value) { this.attributes[key] = String(value); }, removeAttribute(key) { delete this.attributes[key]; },
    addEventListener(key, fn) { (this.listeners[key] ??= []).push(fn); }, click() { return Promise.all((this.listeners.click ?? []).map(fn => fn())); } };
  return node;
}
const walk = (node, out = []) => { out.push(node); for (const child of node.children) walk(child, out); return out; };

test('Your choices shows one row per chosen item with Remove from setup, which is unavailable while a change waits', async () => {
  const roots = [ref('grill-me'), ref('tdd')];
  const client = { intent: { roots, pins: [] }, catalog: { items }, bytes: [] };
  const removed = [];
  const button = (label, action) => { const node = fake('button', 'px-3 py-1.5 rounded', label); node.addEventListener('click', action); return node; };
  const view = createSetupChoices({ client, el: fake, button, onRemove: async (root, name) => { removed.push([root.itemId, name]); } });
  view.render();
  assert.equal(walk(view.node).find(node => node.id === 'setup-choices-title').textContent, 'Your choices (2)');
  const rows = walk(view.node).filter(node => node.dataset.choiceItem);
  assert.deepEqual(rows.map(row => row.dataset.choiceItem), ['grill-me', 'tdd']);
  const remove = walk(rows[1]).find(node => node.tag === 'button');
  assert.equal(remove.attributes['aria-label'], 'Remove tdd from setup');
  assert.match(remove.className, /px-2 py-0\.5/);
  await remove.click();
  assert.deepEqual(removed, [['tdd', 'tdd']]);
  client.candidate = { intent: { roots: [] } }; view.render();
  assert.equal(walk(view.node).filter(node => node.tag === 'button').every(node => node.disabled), true);
  client.intent = { roots: [], pins: [] }; client.candidate = undefined; view.render();
  assert.equal(walk(view.node).find(node => node.id === 'setup-choices-empty').hidden, false);
});
