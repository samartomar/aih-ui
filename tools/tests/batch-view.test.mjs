import test from 'node:test';
import assert from 'node:assert/strict';
import { scopeRows, actionRows, canApply, outcomeRows, outcomeCounts, outcomeTone, conflictText, ATOMIC_NOTE, CLIENT_NOTE } from '../../src/app/batch-view.js';

test('scopes use only Core labels and disclose what listing establishes', () => {
  assert.deepEqual(scopeRows({ scopes: [{ id: 'a', role: 'existing', client: 'one' }, { id: 'b', role: 'added', client: 'other' }] }, { labels: { one: 'Client One' } })
    .map(row => [row.id, row.label, row.note]), [['a', 'Client One', CLIENT_NOTE], ['b', 'other', CLIENT_NOTE]]);
  assert.equal(CLIENT_NOTE, 'Listed by Core; not checked as installed or connected');
});

test('reviewed execution order and dependency edges stay visible', () => {
  const actions = [{ id: 'first', scope: 'a', category: 'content', requires: [] }, { id: 'next', scope: 'b', category: 'client', requires: ['first'], retain: true }];
  const rows = actionRows({ actions });
  assert.deepEqual(rows.map(row => row.id), ['first', 'next']);
  assert.equal(rows[1].dependencies, 'first → next');
  assert.equal(rows[1].retained, true);
  assert.equal(actions[1].requires[0], 'first');
});

test('apply requires a ready review for the displayed batch and zero conflicts', () => {
  assert.equal(canApply(null, 'batch-a'), false);
  assert.equal(canApply({ batchId: 'batch-a', ready: true, conflicts: [] }, 'batch-a'), true);
  for (const review of [{ batchId: 'batch-a', ready: true, conflicts: [{ reason: 'collision' }] },
    { batchId: 'batch-b', ready: true, conflicts: [] }, { batchId: 'batch-a', ready: false, conflicts: [] }, { batchId: 'batch-a', ready: true }]) {
    assert.equal(canApply(review, 'batch-a'), false);
  }
});

test('report preserves all five observed outcomes, reasons and unrelated scope state', () => {
  const states = ['completed', 'failed', 'untouched', 'cancelled', 'unknown'];
  const report = { actions: states.map((outcome, index) => ({ id: `a${index}`, scope: 'a', outcome, reason: `reason-${outcome}` })),
    scopes: [{ id: 'a', unrelated: { outcome: 'untouched', files: 3 } }, { id: 'b', unrelated: { outcome: 'unknown', reason: 'unreadable' } }] };
  const rows = outcomeRows(report);
  assert.deepEqual(rows.slice(0, 5).map(row => [row.outcome, row.reason]), states.map(state => [state, `reason-${state}`]));
  assert.equal(rows[5].label, 'Unrelated state');
  assert.equal(rows[5].files, 3);
  assert.equal(rows[6].outcome, 'unknown');
  assert.deepEqual(outcomeCounts(report).map(row => [row.outcome, row.count]), states.map(state => [state, 1]));
  assert.equal(outcomeTone('completed'), 'success');
  assert.equal(outcomeTone('failed'), 'error');
  assert.equal(outcomeTone('unknown'), 'warning');
  assert.equal(outcomeTone('unrecognized'), 'warning');
  assert.equal(ATOMIC_NOTE, 'Each scope is applied separately; there is no all-or-nothing promise.');
});

test('missing observations remain unknown and missing data does not claim success', () => {
  assert.deepEqual(outcomeRows(null), []);
  assert.equal(outcomeRows({ actions: [{ id: 'x', scope: 'a' }] })[0].outcome, 'unknown');
  assert.equal(outcomeCounts(null).every(row => row.count === 0), true);
});

test('conflicts read as sentences naming the scope, action and target, and unknown kinds stay visible', () => {
  assert.equal(conflictText({ kind: 'core-conflict', scope: 'b', action: 'x', target: '/t/x.md', code: 'STATE_CONFLICT', reason: 'existing-content' }),
    'Scope b: action x cannot write /t/x.md; Core reports STATE_CONFLICT:existing-content.');
  assert.match(conflictText({ kind: 'client-not-listed', scope: 'b', client: 'zed' }), /zed is not in Core's published client list/);
  assert.match(conflictText({ kind: 'nested-roots', scopes: ['a', 'b'] }), /Scopes a and b have overlapping folders/);
  assert.match(conflictText({ kind: 'core-review', scope: 'b', status: 'invalid' }), /no Core code reported/);
  assert.equal(conflictText({ kind: 'future-kind', n: 1 }), '{"kind":"future-kind","n":1}');
});

test('a state without a host reason is described, and an unknown one says it was not reported', () => {
  const rows = outcomeRows({ actions: [{ id: 'x', scope: 'a', outcome: 'completed' }, { id: 'y', scope: 'a', outcome: 'unknown' }], scopes: [{ id: 'a', unrelated: { outcome: 'untouched', files: 2 } }] });
  assert.deepEqual(rows.map(row => row.reason), ['Core reported the work complete', 'Not reported', 'No change observed']);
});
