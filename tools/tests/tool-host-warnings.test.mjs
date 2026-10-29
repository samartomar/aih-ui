import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostCopiesState, secondCopyWarnings, copiesWords, drawerCopiesWords } from '../../src/app/tool-host-warnings.js';

const warning = (itemId, where = 'user', key = 'grill-me', path = 'C:\\Users\\me\\.claude\\skills\\grill-me') =>
  ({ code: 'same-key-elsewhere', item: { framework: 'ecc', itemId }, key, where, path });
const host = (status, over = {}) => ({ status, items: [{ itemId: 'skill-a' }], warnings: [], ...over });

test('second-copy warnings come only from Core’s same-key-elsewhere warnings', () => {
  assert.deepEqual(secondCopyWarnings(host('complete', { warnings: [warning('skill-a'), { code: 'also-reads', what: 'x' }] })),
    [{ itemId: 'skill-a', key: 'grill-me', where: 'user', path: 'C:\\Users\\me\\.claude\\skills\\grill-me' }]);
  assert.deepEqual(secondCopyWarnings(host('unavailable')), [], 'an unavailable check reports no warnings');
  assert.deepEqual(secondCopyWarnings(host('refused', { items: [] })), [], 'a refused check reports no warnings');
});

test('the check state is explicit: loading, unavailable, failed, empty, checked', () => {
  assert.equal(hostCopiesState(undefined).state, 'loading');
  assert.equal(hostCopiesState(host('unavailable', { reason: 'no folder' })).state, 'unavailable');
  assert.equal(hostCopiesState(host('failed')).state, 'failed');
  assert.equal(hostCopiesState(host('cancelled')).state, 'failed');
  assert.equal(hostCopiesState(host('complete', { items: [] })).state, 'empty');
  assert.equal(hostCopiesState(host('complete')).state, 'checked');
});

test('an unavailable or failed check says it could not check, never implying there is no second copy', () => {
  assert.match(copiesWords(host('unavailable', { reason: 'Choose a project folder.' }), 'skill-a'), /^Couldn't check whether your tool already has this\. Choose a project folder\.$/);
  assert.match(copiesWords(host('failed', { reason: 'Host facts could not be inspected.' }), 'skill-a'), /^Couldn't check/);
  assert.match(copiesWords(undefined, 'skill-a'), /^Checking whether your tool already has this…/);
  assert.match(copiesWords(host('complete', { items: [] }), 'skill-a'), /^Couldn't check: nothing is chosen yet\./);
});

test('a reported second copy is worded from Core’s warning, per item', () => {
  const seen = host('complete', { items: [{ itemId: 'skill-a' }, { itemId: 'skill-b' }], warnings: [warning('skill-a', 'parent-folder'), warning('skill-b', 'plugin')] });
  assert.match(copiesWords(seen, 'skill-a', { chosen: true }), /^Second copy: grill-me is also in a parent folder \(/);
  assert.match(copiesWords(seen, 'skill-b', { chosen: true }), /this tool's plugin folder/);
  assert.match(copiesWords(seen, 'skill-c', { chosen: false }), /^Couldn't check: only your chosen content is checked for a second copy\./);
  assert.equal(copiesWords(seen, 'skill-c', { chosen: true }), 'No second copy reported by your tool.');
});

test('the drawer line summarizes the check without inventing a clean state', () => {
  assert.match(drawerCopiesWords(undefined), /^Checking whether your tool already has your chosen content…/);
  assert.match(drawerCopiesWords(host('unavailable', { reason: 'no folder' })), /^Couldn't check whether your tool already has this\./);
  assert.match(drawerCopiesWords(host('complete', { items: [{ itemId: 'skill-a' }] })), /^Your tool reported no second copies of your chosen content\./);
  assert.match(drawerCopiesWords(host('incomplete', { items: [{ itemId: 'skill-a' }], warnings: [warning('skill-a')] })), /^Second copy: grill-me is also in your user folder \(/);
});

test('unavailable per-item copy facts stay unchecked and preserve actual warnings', () => {
  const partial = host('incomplete', { items: [{ itemId: 'skill-a', copies: {
    user: { state: 'unavailable', reason: 'Permission denied.' },
    parentFolders: { state: 'none' }, plugins: { state: 'none' },
  } }] });
  assert.equal(hostCopiesState(partial).state, 'unavailable');
  assert.match(copiesWords(partial, 'skill-a'), /Couldn't check.*Permission denied/);
  assert.match(drawerCopiesWords(partial), /Couldn't check.*Permission denied/);
  assert.doesNotMatch(drawerCopiesWords(partial), /reported no second copies/);
  const mixed = { ...partial, warnings: [warning('skill-a')] };
  assert.match(copiesWords(mixed, 'skill-a'), /Second copy[\s\S]*Couldn't check.*Permission denied/);
  assert.match(drawerCopiesWords(mixed), /Second copy[\s\S]*Couldn't check.*Permission denied/);
});
