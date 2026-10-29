// Q1 regression: Apply must bind to the displayed held preparation, never to unseen fresh work.
// Run: node --test tools/tests/host-review.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyIfUnchanged } from '../../src/app/host-review.js';

const held = { sessionId: 'held-session', review: { reviewDigest: 'held-digest', operations: [] } };
const fresh = { sessionId: 'fresh-session', review: { reviewDigest: 'fresh-digest', operations: [] } };

test('applies the displayed held preparation; prepare is not called and apply uses the held handle', async () => {
  const calls = [];
  const result = await applyIfUnchanged({
    held,
    prepare: async () => { calls.push('prepare'); return { status: 'ok', preparation: { status: 'ready', ...fresh } }; },
    readyPreparation: value => value?.preparation?.status === 'ready' ? value.preparation : undefined,
    apply: async approval => { calls.push(`apply:${approval.sessionId}`); return { status: 'ok', completion: 'complete', operations: [] }; },
  });
  assert.equal(result.state, 'applied');
  assert.equal(result.preparation.sessionId, 'held-session');
  assert.deepEqual(calls, ['apply:held-session']);
});

test('a changed caller snapshot never reaches apply: a REVIEW_STALE held apply prepares fresh for display and requires a new confirmation', async () => {
  const calls = [];
  const result = await applyIfUnchanged({
    held,
    prepare: async () => { calls.push('prepare'); return { status: 'ok', preparation: { status: 'ready', ...fresh } }; },
    readyPreparation: value => value?.preparation?.status === 'ready' ? value.preparation : undefined,
    apply: async approval => { calls.push(`apply:${approval.sessionId}`); return { status: 'refused', diagnostics: [{ code: 'REVIEW_STALE', message: 'The reviewed setup changed.', changed: { reason: 'binding' } }] }; },
  });
  assert.equal(result.state, 'stale');
  assert.equal(result.preparation.sessionId, 'fresh-session');
  assert.match(result.reason, /changed/i);
  assert.deepEqual(calls, ['apply:held-session', 'prepare']); // exactly one apply, with the held handle
});

test('a superseded Apply answer keeps the outcome unknown: the run may have completed (AF1)', async () => {
  const applied = [];
  const result = await applyIfUnchanged({
    held,
    prepare: async () => { throw new Error('prepare must not run for a superseded apply'); },
    readyPreparation: value => value?.preparation?.status === 'ready' ? value.preparation : undefined,
    apply: async approval => { applied.push(approval); return { status: 'superseded' }; },
  });
  assert.equal(result.state, 'superseded');
  assert.equal(result.preparation.sessionId, 'held-session');
  assert.deepEqual(applied, [{ sessionId: 'held-session', reviewDigest: 'held-digest' }]);
});

test('a stale held apply keeps its original reason when replacement preparation is not ready', async () => {
  for (const status of ['partial', 'refused']) {
    const result = await applyIfUnchanged({
      held,
      prepare: async () => ({ status, diagnostics: [{ code: 'DISK_CONFLICT', message: 'Fresh disk conflict.' }] }),
      readyPreparation: () => undefined,
      apply: async () => ({ status: 'refused', diagnostics: [{ code: 'REVIEW_STALE', message: 'Original stale reason.' }] }),
    });
    assert.equal(result.state, 'not-ready');
    assert.equal(result.reason, 'Original stale reason.');
  }
});

test('a non-stale refusal of the held handle shows a fresh review without applying it', async () => {
  const calls = [];
  const result = await applyIfUnchanged({
    held,
    prepare: async () => { calls.push('prepare'); return { status: 'ok', preparation: { status: 'ready', ...fresh } }; },
    readyPreparation: value => value?.preparation?.status === 'ready' ? value.preparation : undefined,
    apply: async approval => { calls.push(`apply:${approval.sessionId}`); return { status: 'refused', diagnostics: [{ code: 'SESSION_MOVED', message: 'The shown session can no longer be applied.' }] }; },
  });
  assert.equal(result.state, 'not-ready');
  assert.equal(result.preparation.sessionId, 'fresh-session');
  assert.ok(!calls.some(call => call === 'apply:fresh-session'), 'fresh work must never be applied unseen');
});
