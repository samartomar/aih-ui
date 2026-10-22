import test from 'node:test';
import assert from 'node:assert/strict';
import { groupInstalled, removalOrder } from '../../src/app/installed-list.js';

// The compiled policy carries each selection's `requires` (selection ids) as Catalog resolved them; the saved
// intent's pins name the item behind each recipe digest. Nothing here decides a dependency itself.
const selection = (name, requires = []) => ({ id: `s-${name}`, managementId: `m-${name}`, scope: 'project', requires: requires.map(other => `s-${other}`),
  recipe: { reference: { sha256: `r-${name}` } } });
const pin = name => ({ releaseSha256: 'rel', itemId: name, recipe: { sha256: `r-${name}` } });
const policy = { selections: [selection('grill-me', ['notices', 'grilling']), selection('grilling', ['notices']), selection('notices'), selection('tdd', ['notices'])] };
const intent = { roots: [{ itemId: 'grill-me' }, { itemId: 'tdd' }], pins: ['grill-me', 'grilling', 'notices', 'tdd'].map(pin) };
const label = itemId => ({ 'grill-me': 'grill-me', grilling: 'grilling', notices: 'Extensions notices', tdd: 'TDD' })[itemId];
const inventory = (...names) => ({ status: 'complete', selections: names.map(name => ({ managementId: name.startsWith('m-') ? name : `m-${name}`, scope: 'project' })) });

test('groups installed items under the chosen item, naming the needed items it brought in', () => {
  const view = groupInstalled({ inventory: inventory('grill-me', 'grilling', 'notices'), policy, intent, label });
  assert.equal(view.partial, false);
  assert.deepEqual(view.groups.map(group => ({ name: group.name, needed: group.needed.map(item => item.name) })),
    [{ name: 'grill-me', needed: ['grilling', 'Extensions notices'] }]);
  assert.deepEqual(view.notInstalled.map(item => item.name), ['TDD']);
  assert.deepEqual(view.others, []);
});

test('Remove takes the chosen item and only the needed items nothing else installed still needs', () => {
  const view = groupInstalled({ inventory: inventory('grill-me', 'grilling', 'notices', 'tdd'), policy, intent, label });
  const grill = view.groups.find(group => group.name === 'grill-me');
  // notices is still needed by TDD, so it stays; grill-me goes before grilling, which it requires.
  assert.deepEqual(grill.removes.map(item => item.managementId), ['m-grill-me', 'm-grilling']);
  assert.deepEqual(grill.kept.map(item => item.name), ['Extensions notices']);
  const tdd = view.groups.find(group => group.name === 'TDD');
  assert.deepEqual(tdd.removes.map(item => item.managementId), ['m-tdd']);
});

test('installed items outside the current setup are listed apart by their management id', () => {
  const view = groupInstalled({ inventory: inventory('m-project--kiro.grill-me', 'grill-me', 'grilling', 'notices'), policy, intent, label });
  assert.deepEqual(view.others, [{ managementId: 'm-project--kiro.grill-me', scope: 'project', name: 'm-project--kiro.grill-me', inSetup: false }]);
});

test('a needed item whose chosen item is no longer installed is listed apart with its name', () => {
  const view = groupInstalled({ inventory: inventory('grilling'), policy, intent, label });
  assert.deepEqual(view.groups, []);
  assert.deepEqual(view.others.map(item => [item.name, item.inSetup]), [['grilling', true]]);
  assert.deepEqual(view.notInstalled.map(item => item.name), ['grill-me', 'TDD']);
});

test('an incomplete inventory is reported as possibly partial, and an unreadable one gives no list', () => {
  assert.equal(groupInstalled({ inventory: { ...inventory('grill-me'), status: 'incomplete' }, policy, intent, label }).partial, true);
  const none = groupInstalled({ inventory: { status: 'invalid', selections: [], diagnostics: [{ message: 'Receipt unreadable.' }] }, policy, intent, label });
  assert.equal(none.readable, false);
  assert.match(none.reason, /Receipt unreadable/);
});

test('without a policy every installed item is listed apart', () => {
  const view = groupInstalled({ inventory: inventory('grill-me'), policy: undefined, intent: undefined, label });
  assert.deepEqual(view.groups, []);
  assert.deepEqual(view.others.map(item => item.name), ['m-grill-me']);
});

test('removal order puts every item before the items it requires', () => {
  const ordered = removalOrder(['s-notices', 's-grilling', 's-grill-me'], new Map(policy.selections.map(entry => [entry.id, entry])));
  assert.deepEqual(ordered, ['s-grill-me', 's-grilling', 's-notices']);
});

test('a kept needed item names the installed chosen items that still need it', () => {
  const view = groupInstalled({ inventory: inventory('grill-me', 'grilling', 'notices', 'tdd'), policy, intent, label });
  assert.deepEqual(view.groups.find(group => group.name === 'grill-me').kept.map(item => [item.name, item.neededBy]), [['Extensions notices', ['TDD']]]);
});
