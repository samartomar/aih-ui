// Q7-R regression: the installed panel renders the REAL interactive rows (badges and removal controls)
// grouped under their recorded exact set identities; simultaneous memberships stay truthful without
// duplicated actions; no-origin rows stay explicit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { originGroups } from '../../src/app/installed-list.js';

// The grouping logic itself lives in installed-panel's show(); exercise it through the same view data
// with a minimal DOM, asserting section membership of the real row elements.
const fake = (tag, className = '', text) => {
  const node = { tag, className, textContent: text ?? '', children: [], dataset: {}, attributes: {}, hidden: false,
    append(...children) { for (const child of children) if (child && typeof child === 'object') this.children.push(child); },
    replaceChildren(...children) { this.children = []; this.append(...children); },
    setAttribute(key, value) { this.attributes[key] = String(value); }, removeAttribute(key) { delete this.attributes[key]; },
    addEventListener() {}, click() {} };
  return node;
};
const walk = (node, out = []) => { out.push(node); for (const child of node.children) walk(child, out); return out; };

test('originGroups carry named members for the panel to place real rows under exact set identities', () => {
  const alpha = { framework: 'ecc', setId: 'alpha', setSha256: 'a'.repeat(64) };
  const beta = { framework: 'ecc', setId: 'beta', setSha256: 'b'.repeat(64) };
  const inventory = { selections: [
    { managementId: 'm-1', name: 'One', origins: [{ reasonIncluded: 'in-set', set: alpha }] },
    { managementId: 'm-2', name: 'Two', origins: [{ reasonIncluded: 'in-set', set: alpha }, { reasonIncluded: 'in-set', set: beta }] },
    { managementId: 'm-3', name: 'Three', origins: [{ reasonIncluded: 'chosen' }] },
  ] };
  const groups = originGroups(inventory);
  const byKey = new Map(groups.map(group => [group.set ? `${group.set.setId}/${group.set.setSha256}` : 'null', group]));
  assert.deepEqual(byKey.get(`alpha/${'a'.repeat(64)}`).members.map(member => member.name), ['One', 'Two']);
  assert.deepEqual(byKey.get(`beta/${'b'.repeat(64)}`).members.map(member => member.name), ['Two'], 'simultaneous membership is visible under every set');
  assert.deepEqual(byKey.get('null').members.map(member => member.name), ['Three'], 'no-origin rows stay explicit');
});

test('the panel places each interactive row in exactly one set section, noting further memberships', async () => {
  const { createInstalledPanel } = await import('../../src/app/installed-panel.js');
  const alpha = { framework: 'ecc', setId: 'alpha', setSha256: 'a'.repeat(64) };
  const beta = { framework: 'ecc', setId: 'beta', setSha256: 'b'.repeat(64) };
  const view = {
    readable: true, partial: false,
    groups: [
      { itemId: 'one', managementId: 'm-1', name: 'One', state: { file: 'matches', update: 'current', policy: null, approval: null, install: 'complete' }, sets: [alpha], needed: [], removes: [], kept: [] },
      { itemId: 'two', managementId: 'm-2', name: 'Two', state: { file: 'matches', update: 'current', policy: null, approval: null, install: 'complete' }, sets: [alpha, beta], needed: [], removes: [], kept: [] },
    ],
    others: [{ managementId: 'm-3', name: 'Three', state: { file: 'matches', update: 'current', policy: null, approval: null, install: 'complete' }, sets: [], inSetup: false }],
    originGroups: originGroups({ selections: [
      { managementId: 'm-1', name: 'One', origins: [{ reasonIncluded: 'in-set', set: alpha }] },
      { managementId: 'm-2', name: 'Two', origins: [{ reasonIncluded: 'in-set', set: alpha }, { reasonIncluded: 'in-set', set: beta }] },
      { managementId: 'm-3', name: 'Three', origins: [{ reasonIncluded: 'chosen' }] },
    ] }),
  };
  const el = (tag, className = '', text) => fake(tag, className, text);
  const button = (label, action) => { const node = fake('button', '', label); node.addEventListener('click', action); return node; };
  const selections = [
    { managementId: 'm-1', name: 'One', origins: [{ reasonIncluded: 'in-set', set: alpha }], members: [{ fileState: 'matches' }] },
    { managementId: 'm-2', name: 'Two', origins: [{ reasonIncluded: 'in-set', set: alpha }, { reasonIncluded: 'in-set', set: beta }], members: [{ fileState: 'matches' }] },
    { managementId: 'm-3', name: 'Three', origins: [{ reasonIncluded: 'chosen' }], members: [{ fileState: 'matches' }] },
  ];
  const inventory = { status: 'complete', selections };
  const client = { catalog: { executionAvailable: true }, requestCurrent: async () => inventory, intent: { roots: [] }, bytes: new Uint8Array() };
  const panel = createInstalledPanel({ client, el, button });
  await panel.refresh();
  const node = panel.node;
  const sections = walk(node).filter(entry => entry.dataset.installedSet);
  assert.equal(sections.length, 1, 'the row renders in its first set section; actions are never duplicated');
  assert.equal(sections[0].dataset.installedSet, `alpha/${'a'.repeat(64)}`, 'the section identity is exact');
  const sectionRows = walk(sections[0]).filter(entry => entry.dataset.installedOther).map(entry => entry.dataset.installedOther).sort();
  assert.deepEqual(sectionRows, ['m-1', 'm-2'], 'the real interactive rows (with their removal controls) are grouped under the exact set');
  assert.equal(walk(node).filter(entry => entry.dataset.installedOther === 'm-2').length, 1, 'a simultaneous member renders once (no duplicated actions)');
  const also = walk(node).find(entry => /Also in:/.test(entry.textContent));
  assert.ok(also, 'further memberships stay visible as a note');
  assert.match(also.textContent, /beta/, 'the note names the other exact set');
  const other = walk(node).find(entry => entry.dataset.installedOther === 'm-3');
  assert.ok(other, 'no-origin rows stay explicit outside the set sections');
  assert.equal(walk(other).filter(entry => entry.tag === 'button').length, 1, 'its removal control is present');
});
