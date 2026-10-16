import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReviewIdentity } from '../../src/app/review-identity.js';

const alice = { kind: 'individual', id: 'alice' };

test('with no saved identity and no session choice nothing changes', () => {
  const identity = createReviewIdentity();
  assert.equal(identity.offer(null), undefined);
  assert.equal(identity.offer(undefined), undefined);
});

test('a saved identity becomes the default and is reported as from setup', () => {
  const identity = createReviewIdentity();
  assert.deepEqual(identity.offer(alice), { recipient: alice, fromSetup: true });
});

test('a changed setup identity replaces the setup default; clearing it removes only that default', () => {
  const identity = createReviewIdentity();
  identity.offer(alice);
  assert.deepEqual(identity.offer({ kind: 'organization', id: 'team' }), { recipient: { kind: 'organization', id: 'team' }, fromSetup: true });
  assert.deepEqual(identity.offer(null), { recipient: undefined, fromSetup: false });
  assert.equal(identity.offer(null), undefined);
});

test('saving setup again with the same identity changes nothing', () => {
  const identity = createReviewIdentity();
  identity.offer(alice);
  assert.equal(identity.offer({ ...alice }), undefined);
  identity.offer(null);
  assert.deepEqual(identity.offer(alice), { recipient: alice, fromSetup: true });
});

test('a session choice wins over later setup changes, including clearing', () => {
  const identity = createReviewIdentity();
  identity.offer(alice);
  identity.choose();
  assert.equal(identity.offer({ kind: 'organization', id: 'team' }), undefined);
  assert.equal(identity.offer(null), undefined);
});

test('a session choice made before any setup identity also wins', () => {
  const identity = createReviewIdentity();
  identity.choose();
  assert.equal(identity.offer(alice), undefined);
});
