// Hooks for your tool (#135): a framework's hooks are not cards; a short Hooks section offers the ones the Catalog marks
// supported for Your tool, with the command each runs. The Catalog publishes no command for these hooks (each asks the
// person to type a reviewed one as a configuration input), so the page says so and never invents one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hookEntryIds, hooksFor, commandOf, setupHookNote, createHooks } from '../../src/catalog/hooks.js';

const R = 'a'.repeat(64);
const fact = (client, support) => ({ client, support, capability: 'automatic-hook-activation', surface: 'hooks/settings', ...(support === 'unsupported' ? { reason: 'Not for this tool.' } : {}) });
const commandInput = { type: 'string', required: true, minLength: 1, maxLength: 4096, description: 'Reviewed Node command pointing at the installed git-guard.mjs.' };
const hook = (id, { facts = [fact('claude-code', 'supported'), fact('kiro-ide', 'unsupported')], inputs = { hookCommand: commandInput }, label = id, description = `What ${id} does.` } = {}) => ({
  id, kind: 'hook', label, description, inputs, root: { releaseSha256: R, itemId: id, scope: 'project', configuration: {} },
  dependencies: { requires: [{ itemId: `${id}.source` }], optional: [], conflicts: [] }, metadata: { discovery: { clientCapabilities: facts } },
});
const source = id => ({ id, kind: 'hook', label: id, root: { releaseSha256: R, itemId: id, scope: 'project' }, metadata: { discovery: { clientCapabilities: [fact('claude-code', 'unsupported')] } } });
const items = [hook('git-guard', { label: 'Claude Code: git-guard hook group' }), hook('lanes-card'), source('git-guard.source'), source('lanes-card.source'),
  { id: 'skill.a', kind: 'skill', root: { releaseSha256: R, itemId: 'skill.a' } }];
const supporting = new Set([`${R}/git-guard.source`, `${R}/lanes-card.source`]);

test('hooks are the hook items that are not supporting material (a hook\'s script files come with it)', () => {
  assert.deepEqual([...hookEntryIds(items, supporting)], [`${R}/git-guard`, `${R}/lanes-card`]);
});

test('the section offers only the hooks the Catalog marks supported for Your tool', () => {
  const hooks = items.filter(item => hookEntryIds(items, supporting).has(`${R}/${item.id}`));
  assert.deepEqual(hooksFor(hooks, 'claude-code').map(item => item.id), ['git-guard', 'lanes-card']);
  assert.deepEqual(hooksFor(hooks, 'kiro-ide'), []);
  assert.deepEqual(hooksFor(hooks, ''), []);
});

test('the command is never invented: with no published command the person types one, from the input the Catalog declares', () => {
  const said = commandOf(hook('git-guard'));
  assert.equal(said.declared, null);
  assert.deepEqual(said.inputs.map(input => [input.name, input.required]), [['hookCommand', true]]);
  assert.match(said.text, /^The Catalog does not publish the command this hook runs\. You type it/);
  // Were the Catalog to declare one (a default for the input), that exact command is shown.
  const declared = commandOf(hook('x', { inputs: { hookCommand: { ...commandInput, default: 'node x.mjs' } } }));
  assert.equal(declared.declared, 'node x.mjs');
  assert.equal(declared.text, 'The Catalog declares this command: node x.mjs');
});

test('in Your setup a chosen hook shows the command it will run again, with a plain note', () => {
  const note = setupHookNote({ item: hook('git-guard'), configuration: { hookCommand: 'node "$CLAUDE_PROJECT_DIR/.aih-extensions/source/hooks/git-guard.mjs"' }, tool: 'claude-code' });
  assert.equal(note.command, 'node "$CLAUDE_PROJECT_DIR/.aih-extensions/source/hooks/git-guard.mjs"');
  assert.equal(note.text, 'claude-code will run this command each time the hook\'s event happens. The Catalog does not say which event that is.');
  // With no Catalog tool chosen it names the tools the Catalog marks it supported for.
  assert.match(setupHookNote({ item: hook('git-guard'), configuration: { hookCommand: 'x' }, tool: '' }).text, /^claude-code will run/);
  const none = setupHookNote({ item: hook('git-guard'), configuration: {}, tool: 'claude-code' });
  assert.equal(none.command, null);
  assert.match(none.text, /^No command typed yet/);
});

// A small DOM, enough for the section and the configuration editor it reuses.
function element(tag) {
  const node = {
    tagName: tag, children: [], dataset: {}, attributes: {}, listeners: {}, className: '', textContent: '', hidden: false, value: '', disabled: false,
    append(...children) { this.children.push(...children); }, appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; }, before() {}, after() {},
    setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(name, callback) { this.listeners[name] = callback; }, setCustomValidity() {}, reportValidity() {}, focus() {},
    get isConnected() { return true; },
  };
  return node;
}
const all = node => [node, ...node.children.flatMap(all)];
function dom(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  globalThis.document = { createElement: element };
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
}

test('the section lists each hook with what it does, the command, and Add; Add sends the command typed', async t => {
  dom(t);
  const section = element('section'), list = element('div'), note = element('p'), added = [];
  const view = createHooks({ section, list, note, onAdd: async item => { added.push(item); } });
  const hooks = items.filter(item => hookEntryIds(items, supporting).has(`${R}/${item.id}`));
  view.render({ hooks, tool: 'claude-code', accepted: [], acceptedLabel: 'Added', neededBy: () => '' });
  assert.equal(section.hidden, false);
  assert.equal(list.children.length, 2);
  const row = list.children[0], texts = all(row).map(node => node.textContent);
  assert.ok(texts.includes('Claude Code: git-guard hook group'));
  assert.ok(texts.includes('What git-guard does.'));
  assert.ok(texts.some(value => /^The Catalog does not publish the command this hook runs/.test(value)));
  assert.ok(!texts.some(value => /For claude-code|kiro/.test(value)), 'no tool line on a hook row');
  const field = all(row).find(node => node.attributes['aria-label'] === 'hookCommand for Claude Code: git-guard hook group');
  assert.ok(field, 'the existing configuration editor asks for the command');
  field.value = 'node guard.mjs';
  const add = all(row).find(node => node.textContent === 'Add with this command');
  await add.listeners.click();
  assert.deepEqual(added.map(item => [item.id, item.root.configuration]), [['git-guard', { hookCommand: 'node guard.mjs' }]]);
});

test('a hook in the setup shows its command and Remove (#144), not a second Add; a needed one says who needs it', async t => {
  dom(t);
  const section = element('section'), list = element('div'), note = element('p'), removed = [];
  const view = createHooks({ section, list, note, onAdd: async () => {}, onRemove: async item => { removed.push(item.id); } });
  const hooks = items.filter(item => hookEntryIds(items, supporting).has(`${R}/${item.id}`));
  view.render({ hooks, tool: 'claude-code', accepted: [{ releaseSha256: R, itemId: 'git-guard', configuration: { hookCommand: 'node guard.mjs' } }], acceptedLabel: 'Added',
    neededBy: item => item.id === 'lanes-card' ? 'In your setup (needed by Whole set)' : '' });
  const [first, second] = list.children;
  assert.ok(all(first).some(node => node.textContent === 'node guard.mjs'));
  const remove = all(first).find(node => node.textContent === 'Remove');
  assert.equal(remove.disabled, false);
  assert.equal(remove.attributes['aria-label'], 'Remove: Claude Code: git-guard hook group');
  await remove.listeners.click();
  assert.deepEqual(removed, ['git-guard']);
  assert.equal(all(first).some(node => node.textContent === 'Add with this command'), false);
  const needed = all(second).find(node => node.textContent === 'In your setup (needed by Whole set)');
  assert.equal(needed.disabled, true);
  assert.equal(all(second).some(node => node.textContent === 'Add with this command' || node.textContent === 'Remove'), false);
});

test('with a tool that has no hooks here the section does not appear; with no tool it asks for one', t => {
  dom(t);
  const section = element('section'), list = element('div'), note = element('p');
  const view = createHooks({ section, list, note, onAdd: async () => {} });
  const hooks = items.filter(item => hookEntryIds(items, supporting).has(`${R}/${item.id}`));
  view.render({ hooks, tool: 'kiro-ide', accepted: [], acceptedLabel: 'Added', neededBy: () => '' });
  assert.equal(section.hidden, true);
  view.render({ hooks: [], tool: 'claude-code', accepted: [], acceptedLabel: 'Added', neededBy: () => '' });
  assert.equal(section.hidden, true);
  view.render({ hooks, tool: '', accepted: [], acceptedLabel: 'Added', neededBy: () => '' });
  assert.equal(section.hidden, false);
  assert.equal(list.children.length, 0);
  assert.equal(note.textContent, 'This framework has 2 hooks. Choose your tool in the header to see the ones for it.');
});
