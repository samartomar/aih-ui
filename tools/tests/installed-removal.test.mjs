// Q1 (connected) regression: removal applies exactly the displayed preparation (handle + full review),
// stale Core answers re-review and require a new confirmation, and nothing unseen is applied.
// Run: node --test tools/tests/installed-removal.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { previewRemoval, confirmRemoval } from '../../src/app/installed-removal.js';

const entry = name => ({ name, managementId: `mgmt-${name}`, scope: 'project' });
const review = (digest, operations) => ({ reviewDigest: digest, operations });
const prepared = (sessionId, digest, operations = [{ effects: 'remove-file', details: { target: '/p/a' }, purpose: 'remove a' }]) =>
  ({ disposition: 'prepared', preparation: { status: 'ready', sessionId, review: review(digest, operations) } });
const appliedRun = operations => ({ status: 'ok', completion: 'complete', operations });

test('one-item removal applies the shown handle and digest, verifies fully, and prepares nothing fresh', async () => {
  const applied = [];
  const requests = [];
  const request = async (operation, body) => {
    requests.push(operation);
    if (operation === 'remove') return prepared('s1', 'd1');
    if (operation === 'apply') { applied.push(body); return appliedRun([{ application: 'applied', verification: { status: 'passed' } }]); }
    throw new Error('unexpected ' + operation);
  };
  const preview = await previewRemoval({ entries: [entry('a')], request, mode: 'all' });
  assert.equal(preview.canConfirm, true);
  const step = preview.steps[0];
  assert.equal(step.sessionId, 's1', 'the displayed step carries the shown session handle');
  assert.ok(step.review?.operations?.length, 'the displayed step keeps the full shown review');
  const result = await confirmRemoval({ preview, request, mode: 'all' });
  assert.deepEqual(applied, [{ sessionId: 's1', reviewDigest: 'd1' }], 'Apply bound to the shown handle and digest');
  assert.equal(requests.filter(op => op === 'remove').length, 1, 'no fresh prepare in the happy path');
  assert.equal(result.outcome, 'removed');
});

test('a Core REVIEW_STALE apply answer re-prepares for display and stops without applying', async () => {
  const applied = [];
  let removes = 0;
  const request = async (operation, body) => {
    if (operation === 'remove') { removes += 1; return removes === 1 ? prepared('s1', 'd1') : prepared('s2', 'd2'); }
    if (operation === 'apply') { applied.push(body); return { status: 'refused', diagnostics: [{ code: 'REVIEW_STALE', message: 'The reviewed setup changed.' }] }; }
    throw new Error('unexpected ' + operation);
  };
  const preview = await previewRemoval({ entries: [entry('a')], request, mode: 'all' });
  const result = await confirmRemoval({ preview, request, mode: 'all' });
  assert.equal(result.outcome, 'failed');
  assert.match(result.message, /changed/);
  assert.deepEqual(applied, [{ sessionId: 's1', reviewDigest: 'd1' }], 'only the shown handle was applied');
  assert.equal(removes, 2, 'stale answer caused exactly one fresh prepare for re-display');
});

test('a dependency-held later step applies its own shown handle on the second confirmation', async () => {
  const applied = [];
  let removes = 0;
  const request = async (operation, body) => {
    if (operation === 'remove') {
      removes += 1;
      // first call: 'a' prepares; second call: 'b' is retained while 'a' is pending; third call: 'b' prepares.
      if (removes === 2) return { disposition: 'retained' };
      return prepared(removes === 1 ? 's1' : 's3', removes === 1 ? 'd1' : 'd3');
    }
    if (operation === 'apply') { applied.push(body); return appliedRun([{ application: 'applied', verification: { status: 'passed' } }]); }
    throw new Error('unexpected ' + operation);
  };
  const preview = await previewRemoval({ entries: [entry('a'), entry('b')], request, mode: 'all' });
  assert.equal(preview.steps[1].state, 'after', 'b waits for a');
  const first = await confirmRemoval({ preview, request, mode: 'all' });
  assert.equal(first.outcome, 'needs-confirm');
  const shown = first.next.steps[0];
  assert.equal(shown.sessionId, 's3', 'the fresh preview of the waiting item carries its own handle');
  const second = await confirmRemoval({ preview: first.next, request, mode: 'all', results: first.results });
  assert.deepEqual(applied.map(a => a.sessionId), ['s1', 's3'], 'each step applied only its shown handle');
  assert.equal(second.outcome, 'removed');
});
