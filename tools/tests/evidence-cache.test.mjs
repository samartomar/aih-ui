import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvidenceCache } from '../consumer/evidence-cache.mjs';

test('evidence cache keeps recently used results within entry and byte budgets', async () => {
  const cache = createEvidenceCache({ maxEntries: 2, maxBytes: 20 });
  await cache.read('a', () => 'a', 8); await cache.read('b', () => 'b', 8);
  assert.equal(await cache.read('a', () => assert.fail('must reuse'), 8), 'a');
  await cache.read('c', () => 'c', 8);
  assert.equal(cache.has('a'), true); assert.equal(cache.has('b'), false);
  await cache.read('large', () => 'large', 21); assert.equal(cache.has('large'), false);
  await cache.read('d', () => 'd', 15);
  assert.equal(cache.has('a'), false); assert.equal(cache.has('c'), false); assert.equal(cache.has('d'), true);
});

test('failed reads are retried and overlapping reads do not double-charge the budget', async () => {
  const cache = createEvidenceCache({ maxEntries: 2, maxBytes: 16 });
  await assert.rejects(cache.read('a', () => Promise.reject(new Error('read failed')), 8));
  assert.equal(cache.has('a'), false);
  let finish;
  const first = cache.read('a', () => new Promise(resolve => { finish = resolve; }), 8);
  assert.equal(await cache.read('a', () => 'checked', 8), 'checked');
  finish('checked'); assert.equal(await first, 'checked');
  await cache.read('b', () => 'b', 8);
  assert.equal(cache.has('a'), true); assert.equal(cache.has('b'), true);
});
