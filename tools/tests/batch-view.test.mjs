import test from 'node:test';
import assert from 'node:assert/strict';
import { scopeRows, actionRows, canApply, outcomeRows, outcomeCounts, outcomeTone, conflictText, diagnosticsText, ATOMIC_NOTE, CLIENT_NOTE, RERUN_NOTE } from '../../src/app/batch-view.js';

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

test('only a kept unverifiable action offers Run again, with the plain warning, and no row says it is already chosen', () => {
  assert.equal(RERUN_NOTE, 'Core cannot confirm whether this earlier process ran; run it again only if you know it is safe.');
  const actions = [{ id: 'proc', requires: [], retain: true, unverifiable: true }, { id: 'planned', requires: [], unverifiable: true }, { id: 'file', requires: [], retain: true, unverifiable: false }, { id: 'new-file', requires: [] }];
  for (const supersedes of [undefined, 'batch-x']) {
    const rows = actionRows({ supersedes, actions });
    assert.deepEqual(rows.map(row => [row.id, row.runAgain]), [['proc', true], ['planned', false], ['file', false], ['new-file', false]], 'offered by the kept process, whether or not the batch supersedes another');
    assert.ok(rows.every(row => !('runAgainChecked' in row)), 'the saved batch never says a choice was made');
  }
});

test('a refused answer shows its codes and messages, and the conflicts of a refused run are kept', () => {
  const refused = { status: 'refused', diagnostics: [{ code: 'BATCH_CONFLICTS', message: 'Conflicts were found before apply; nothing was applied.' }, { code: 'JOURNEY_RECORD_UNSUPPORTED' }], review: { conflicts: [{ kind: 'shared-input', input: 'shared', reason: 'changed' }] } };
  assert.equal(diagnosticsText(refused), 'BATCH_CONFLICTS: Conflicts were found before apply; nothing was applied. JOURNEY_RECORD_UNSUPPORTED');
  assert.equal(diagnosticsText({}), 'The batch host gave no reason.');
  assert.equal(conflictText(refused.review.conflicts[0]), 'Shared input shared is changed.');
});
