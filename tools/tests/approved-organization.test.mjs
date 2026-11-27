import assert from 'node:assert/strict';
import { test } from 'node:test';

// The organization screen reads the page address when it loads.
globalThis.location ??= { search: '' };
const { checkSelection, normalizeSelection, publisherFacts } = await import('../../src/approved/organization.js');

const data = { clients: [{ id: 'codex' }], items: [{ id: 'release/item' }],
  packages: { core: { version: '1' }, catalog: { version: '2' }, scan: { version: '3' } } };
const selection = { format: 'aih-workbench-team-selection/1', organization: ' Fixture Org ', source: '', clients: ['codex'],
  items: ['release/item'], versions: { core: '1', catalog: '2', scan: '3' } };

test('a team selection needs no typed policy owner', () => {
  const current = normalizeSelection(selection);
  assert.equal(Object.hasOwn(current, 'owner'), false);
  assert.equal(current.organization, 'Fixture Org');
  assert.deepEqual(checkSelection(current, data), []);
});

test('an earlier saved selection with an owner still opens without keeping it', () => {
  const earlier = normalizeSelection({ ...selection, owner: 'Fixture Steward' });
  assert.deepEqual(earlier, normalizeSelection(selection));
  assert.throws(() => normalizeSelection({ ...selection, owner: 7 }), /team selection/);
});

test('the member sees the verified publisher, or that no merged pull request was found', () => {
  const commit = 'c'.repeat(40);
  assert.deepEqual(publisherFacts({ status: 'verified', commit, login: 'merger', pull: 12 }),
    [['Published by', 'merger · merged pull request #12'], ['Policy commit', commit]]);
  const unverified = publisherFacts({ status: 'unverified', commit, author: 'pusher' });
  assert.deepEqual(unverified, [['Published by', 'Unavailable. No merged pull request was found for this policy commit.'],
    ['Commit author (unverified)', 'pusher'], ['Policy commit', commit]]);
  assert.ok(!unverified[0][1].includes('pusher'));
  assert.deepEqual(publisherFacts({ status: 'unavailable', commit }),
    [['Published by', 'Unavailable. No merged pull request was found for this policy commit.'], ['Policy commit', commit]]);
  assert.deepEqual(publisherFacts(undefined),
    [['Published by', 'Unavailable. The policy commit could not be identified.'], ['Policy commit', null]]);
});
