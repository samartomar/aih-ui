// Content in the setup as a needed item, for Your choices to fold under the chosen item that needs it. The needed-by
// relation comes only from what Catalog resolved: each compiled selection's `requires` in the policy, or each draft
// choice's resolved dependencies. Nothing here decides one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupNeeds } from '../../src/app/setup-needs.js';

const R = 'a'.repeat(64);
const selection = (name, requires = []) => ({ id: `s-${name}`, managementId: `m-${name}`, scope: 'project', requires: requires.map(other => `s-${other}`),
  recipe: { reference: { sha256: `r-${name}` } } });
const pin = name => ({ releaseSha256: R, itemId: name, recipe: { sha256: `r-${name}` } });
const policy = { selections: [selection('set.complete', ['skill.grill-me', 'notices']), selection('skill.grill-me', ['skill.grilling', 'notices']),
  selection('skill.grilling', ['notices']), selection('notices'), selection('skill.tdd', ['notices'])] };
const intent = { roots: [{ releaseSha256: R, itemId: 'set.complete', scope: 'project' }, { releaseSha256: R, itemId: 'skill.tdd', scope: 'project' }],
  pins: ['set.complete', 'skill.grill-me', 'skill.grilling', 'notices', 'skill.tdd'].map(pin) };
const bytes = value => new TextEncoder().encode(JSON.stringify(value));

test('every needed item names the chosen items that need it, through the whole resolved closure', () => {
  const needs = setupNeeds({ intent, policyBytes: bytes(policy) });
  assert.deepEqual(needs.get(`${R}/skill.grill-me`).map(root => root.itemId), ['set.complete']);
  assert.deepEqual(needs.get(`${R}/skill.grilling`).map(root => root.itemId), ['set.complete'], 'needed through grill-me');
  assert.deepEqual(needs.get(`${R}/notices`).map(root => root.itemId), ['set.complete', 'skill.tdd']);
  assert.equal(needs.has(`${R}/set.complete`), false, 'a chosen item nothing else needs is not a needed item');
  assert.equal(needs.has(`${R}/skill.tdd`), false);
});

test('an open draft reads each choice\'s resolved dependencies', () => {
  const draft = { roots: [{ releaseSha256: R, itemId: 'set.complete', scope: 'project', dependencies: [{ releaseSha256: R, itemId: 'skill.grill-me', scope: 'project' }] }] };
  assert.deepEqual(setupNeeds({ draft }).get(`${R}/skill.grill-me`).map(root => root.itemId), ['set.complete']);
});

test('without a readable policy nothing is said to be needed', () => {
  assert.equal(setupNeeds({ intent, policyBytes: new Uint8Array() }).size, 0);
  assert.equal(setupNeeds({ intent, policyBytes: new TextEncoder().encode('{not json') }).size, 0);
  assert.equal(setupNeeds({}).size, 0);
});
