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
  assert.equal(view.others.length, 1);
  assert.deepEqual(view.others.map(item => ({ managementId: item.managementId, scope: item.scope, name: item.name, inSetup: item.inSetup })),
    [{ managementId: 'm-project--kiro.grill-me', scope: 'project', name: 'm-project--kiro.grill-me', inSetup: false }]);
  assert.deepEqual(view.others[0].state, { file: 'unknown', update: 'unknown', policy: null, approval: null, install: null });
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

test('the whole setup counts as installed only when Core lists every one of its selections', () => {
  const all = inventory('grill-me', 'grilling', 'notices', 'tdd');
  assert.equal(groupInstalled({ inventory: all, policy, intent, label }).setupInstalled, true);
  assert.equal(groupInstalled({ inventory: inventory('grill-me', 'grilling', 'notices'), policy, intent, label }).setupInstalled, false);
  assert.equal(groupInstalled({ inventory: { ...all, status: 'incomplete' }, policy, intent, label }).setupInstalled, true);
  assert.equal(groupInstalled({ inventory: { status: 'invalid', selections: [] }, policy, intent, label }).setupInstalled, false);
  assert.equal(groupInstalled({ inventory: all, policy: { selections: [] }, intent, label }).setupInstalled, false);
});

// UI167: the redacted 1.1 projection records names, origins and states at install time; the list uses them
// independent of the current draft, and legacy rows without recorded metadata stay explicit instead of inferred.
const recorded = (managementId, over = {}) => ({ managementId, scope: 'project', name: null, kind: null, framework: null, item: null, tool: null,
  origins: [], updateState: 'current', installState: 'complete', approval: null, members: [], ...over });

test('recorded 1.1 names win over draft-derived labels, and per-selection states come from the projection', () => {
  const inv = { status: 'complete', selections: [recorded('m-grill-me', { name: 'Grill me (recorded)', updateState: 'update-available',
    members: [{ fileState: 'changed' }] }), recorded('m-grilling'), recorded('m-notices')] };
  const view = groupInstalled({ inventory: inv, policy, intent, label });
  const grill = view.groups.find(group => group.name === 'Grill me (recorded)');
  assert.ok(grill, 'recorded name is used');
  assert.deepEqual(grill.state, { file: 'changed', update: 'update-available', policy: null, approval: null, install: 'complete' });
  assert.equal(view.groups.find(group => group.managementId === 'm-grill-me').needed.find(item => item.managementId === 'm-grilling').state.file, 'unknown', 'no members is unknown, never fabricated');
});

test('items outside the current setup keep their recorded names from the projection', () => {
  const inv = { status: 'complete', selections: [recorded('m-elsewhere', { name: 'Outside item', item: { framework: 'ecc', itemId: 'ecc.other' } })] };
  const view = groupInstalled({ inventory: inv, policy: undefined, intent: undefined, label });
  assert.deepEqual(view.others.map(item => [item.name, item.inSetup]), [['Outside item', false]]);
});

test('origin groups come from recorded in-set origins, keep simultaneous membership, and stay explicit for legacy rows', () => {
  const starter = { framework: 'ecc', setId: 'starter', setSha256: 'a'.repeat(64) };
  const extra = { framework: 'ecc', setId: 'extra', setSha256: 'b'.repeat(64) };
  const inv = { status: 'complete', selections: [
    recorded('m-a', { origins: [{ reasonIncluded: 'in-set', set: starter }, { reasonIncluded: 'in-set', set: extra }] }),
    recorded('m-b', { origins: [{ reasonIncluded: 'in-set', set: starter }] }),
    recorded('m-legacy', { origins: [{ reasonIncluded: 'chosen' }] }),
  ] };
  const view = groupInstalled({ inventory: inv, policy: undefined, intent: undefined, label });
  const byKey = new Map(view.originGroups.map(group => [group.set ? `${group.set.framework}/${group.set.setId}/${group.set.setSha256}` : 'null', group.items]));
  assert.deepEqual(byKey.get(`ecc/starter/${'a'.repeat(64)}`), ['m-a', 'm-b'], 'overlapping sets keep every membership');
  assert.deepEqual(byKey.get(`ecc/extra/${'b'.repeat(64)}`), ['m-a']);
  assert.deepEqual(byKey.get('null'), ['m-legacy'], 'a row without recorded set origin stays explicit, never inferred');
});

test('update and install states Core reports are never recomputed here', () => {
  const inv = { status: 'incomplete', selections: [recorded('m-x', { updateState: 'no-longer-offered', installState: 'interrupted', members: [{ fileState: 'missing' }] })] };
  const view = groupInstalled({ inventory: inv, policy: undefined, intent: undefined, label });
  assert.equal(view.partial, true, 'an incomplete result is said incomplete, distinct from the selection state');
  assert.deepEqual(view.others[0].state, { file: 'missing', update: 'no-longer-offered', policy: null, approval: null, install: 'interrupted' });
  const blocky = { status: 'complete', selections: [recorded('m-y', { members: [{ fileState: 'block-changed' }, { fileState: 'block-changed' }] })] };
  const blockyView = groupInstalled({ inventory: blocky, policy: undefined, intent: undefined, label });
  assert.equal(blockyView.others[0].state.file, 'block-changed', 'a uniform block-changed set keeps its distinct literal state (Q8)');
  const mixed = { status: 'complete', selections: [recorded('m-z', { members: [{ fileState: 'block-changed' }, { fileState: 'missing' }] })] };
  const mixedView = groupInstalled({ inventory: mixed, policy: undefined, intent: undefined, label });
  assert.equal(mixedView.others[0].state.file, 'changed', 'a mixed differing set degrades to the generic changed');
});
