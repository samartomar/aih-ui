// Q1 regression: Apply must bind to the displayed held preparation, never to unseen fresh work.
// Run: node --test tools/tests/host-review.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyIfUnchanged, staleReason } from '../../src/app/host-review.js';

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
    apply: async approval => { calls.push(`apply:${approval.sessionId}`); return { status: 'refused', diagnostics: [{ code: 'REVIEW_STALE', message: 'The reviewed setup changed.', changed: 'binding', detail: 'claude' }] }; },
  });
  assert.equal(result.state, 'stale');
  assert.equal(result.preparation.sessionId, 'fresh-session');
  assert.equal(result.reason, 'How AIH installs into claude changed since the preview; nothing was installed. Preview again.');
  assert.deepEqual(calls, ['apply:held-session', 'prepare']); // exactly one apply, with the held handle
});

test('REVIEW_STALE 1.5 changed and detail use the contract wording for every named kind', () => {
  const diagnostic = (changed, detail) => ({ diagnostics: [{ code: 'REVIEW_STALE', changed, detail, message: 'Core detail must not replace the contract sentence.' }] });
  assert.equal(staleReason(diagnostic('policy', 'obligation changed')),
    "Your organisation's policy changed since the preview; nothing was installed.");
  assert.equal(staleReason(diagnostic('index-status', 'ecc revoked')),
    'The release list changed since the preview; nothing was installed. Preview again.');
  assert.equal(staleReason(diagnostic('scan-state', 'scan:123')),
    'A scan changed since the preview; nothing was installed. Preview again.');
  assert.equal(staleReason(diagnostic('binding', 'claude')),
    'How AIH installs into claude changed since the preview; nothing was installed. Preview again.');
  assert.equal(staleReason(diagnostic('target-file', '/project/CLAUDE.md')),
    '/project/CLAUDE.md changed since the preview; nothing was installed. Preview again.');
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
test('an Apply answer that never arrived is its own unknown state: nothing is prepared and nothing is shown as done', async () => {
  const calls = [], unknown = { status: 'unknown', diagnostics: [{ code: 'APPLY_UNKNOWN', message: 'lost' }] };
  const result = await applyIfUnchanged({ held, prepare: async () => { calls.push('prepare'); return {}; }, readyPreparation: () => undefined,
    apply: async () => { calls.push('apply'); return unknown; } });
  assert.equal(result.state, 'unknown'); assert.equal(result.run, unknown); assert.deepEqual(calls, ['apply']);
});
