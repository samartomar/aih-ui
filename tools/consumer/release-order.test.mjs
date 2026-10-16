import test from 'node:test';
import assert from 'node:assert/strict';
import { RELEASE_ORDER_BASIS, RELEASE_ORDER_TEXT, declareReleaseOrder, releaseOrderProblem, orderRelation } from './release-order.mjs';

const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(ch => ch.repeat(64));

test('a later configured position is newer, an earlier one older; the basis is the host, never the producer', () => {
  const order = declareReleaseOrder([[a], [b], [c]]);
  assert.deepEqual(order, { basis: 'host-declared', ranks: { [a]: [1, 1], [b]: [2, 2], [c]: [3, 3] } });
  assert.equal(RELEASE_ORDER_BASIS, 'host-declared');
  assert.equal(RELEASE_ORDER_TEXT, "order declared by this host's update source");
  assert.deepEqual(orderRelation(order, c, a), { relation: 'newer', basis: 'host-declared' });
  assert.deepEqual(orderRelation(order, a, b), { relation: 'older', basis: 'host-declared' });
});

test('a release outside the declared list, or one listed on both sides of the other, has an unknown order', () => {
  const order = declareReleaseOrder([[a, d], [b], [a]]);
  assert.deepEqual(order.ranks[a], [1, 3]);
  assert.deepEqual(orderRelation(order, b, a), { relation: 'unknown', basis: 'host-declared', reason: 'ambiguous' });
  assert.deepEqual(orderRelation(order, b, d), { relation: 'newer', basis: 'host-declared' });
  assert.deepEqual(orderRelation(order, c, a), { relation: 'unknown', basis: 'host-declared', reason: 'not-in-source' });
  assert.deepEqual(orderRelation(order, a, c), { relation: 'unknown', basis: 'host-declared', reason: 'not-in-source' });
  assert.deepEqual(orderRelation(order, a, a), { relation: 'unknown', basis: 'host-declared', reason: 'same-release' });
});

test('no declared order gives no relation at all, so callers keep their own rule', () => {
  assert.equal(orderRelation(undefined, a, b), undefined);
  assert.equal(orderRelation(null, a, b), undefined);
});

test('an order is a closed, bounded shape', () => {
  assert.equal(releaseOrderProblem(declareReleaseOrder([[a], [b]])), null);
  assert.equal(releaseOrderProblem({ basis: 'producer', ranks: {} }), '/basis');
  assert.equal(releaseOrderProblem({ basis: 'host-declared', ranks: { nothex: [1, 1] } }), '/ranks');
  assert.equal(releaseOrderProblem({ basis: 'host-declared', ranks: { [a]: [2, 1] } }), '/ranks');
  assert.equal(releaseOrderProblem({ basis: 'host-declared', ranks: { [a]: [0, 1] } }), '/ranks');
  assert.equal(releaseOrderProblem({ basis: 'host-declared', ranks: {}, extra: 1 }), '');
  assert.equal(releaseOrderProblem('x'), '');
  assert.throws(() => declareReleaseOrder(Array.from({ length: 9 }, () => [a])), /at most 8/);
  assert.throws(() => declareReleaseOrder([['nothex']]), /digest/);
});
