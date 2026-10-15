import test from 'node:test';
import assert from 'node:assert/strict';
import { READINESS_STATES, projectInspection, projectRepairPreparation, projectRepairOutcome } from '../consumer/readiness.mjs';
import { stateLabel, stateTone, overallLine, rowsFor, summaryCounts } from '../../src/app/readiness-view.js';

// Core-shaped records, in the style of tools/consumer/readiness.test.mjs.
const options = { targets: { value: ['npm', 'jq'], origin: 'explicit' }, network: { value: 'declared', origin: 'default' } };
const inspection = (checks, extra = {}) => ({ status: 'complete', tools: [{ id: 'npm', label: 'npm', state: 'runnable', selection: 'requested' },
  { id: 'jq', label: 'jq', state: 'present', selection: 'requested' }], observations: [], checks, repairChoices: [], diagnostics: [],
effectiveOptions: options, followUp: [], ...extra });
const check = (id, target, outcome, reason, detail = '') => ({ id, target, outcome, reason, detail });
const operation = (id, effects) => ({ id, purpose: `Purpose of ${id}`, kind: 'file.write', scope: 'user', effects, ownership: 'managed',
  requires: [], checks: [], details: { target: `/fixture-home/${id}` } });
const preparation = (status, effects, extra = {}) => ({ status, diagnostics: [], ...extra,
  ...(effects ? { review: { operations: effects.map((value, index) => operation(`trust/op${index}`, value)), reviewDigest: 'd' } } : {}) });
const run = (completion, operations) => ({ completion, operations: operations.map(([application, verification], index) =>
  ({ id: `trust/op${index}`, application, verification: { status: verification, reason: 'r' } })), checks: [], diagnostics: [], followUp: [] });
const repair = { id: 'node-npm-ca', targets: ['npm'] };
const mixed = projectInspection(inspection([check('npm/version', 'npm', 'passed', 'version-ok'),
  check('npm/tls/node', 'npm', 'skipped', 'network-off'), check('jq/version', 'jq', 'failed', 'version-exit', 'exit 3')],
{ repairChoices: [{ target: 'jq', kind: 'manual-guidance', reason: 'version-exit', guidance: 'Reinstall jq yourself.' }],
  observations: [{ id: 'claude/loading', target: 'claude', detail: 'Observed; loading not verified.' }] }));

test('every projection state has a distinct honest label and a tone', () => {
  assert.deepEqual(READINESS_STATES.map(stateLabel), ['Failed', 'Unknown', 'Applied', 'Configured', 'Verified']);
  assert.equal(stateTone('failed'), 'error');
  assert.equal(stateTone('verified'), 'success');
  assert.equal(stateLabel('surprise'), 'Unknown');
  assert.equal(stateTone('surprise'), stateTone('unknown'));
});

test('only verified is toned as success', () => {
  for (const state of READINESS_STATES) assert.equal(stateTone(state) === 'success', state === 'verified', state);
  assert.notEqual(stateTone('unknown'), 'error', 'unknown is not asserted as a failure');
});

test('rows carry the projection order, state and reason without reinterpretation', () => {
  const rows = rowsFor(mixed);
  assert.deepEqual(rows.map(row => [row.id, row.state]), mixed.items.map(item => [item.id, item.state]));
  assert.deepEqual(rows.map(row => row.state), ['failed', 'unknown', 'configured', 'verified']);
  assert.equal(rows[0].label, 'jq');
  assert.equal(rows[0].reason, 'version-exit');
  assert.equal(rows[0].detail, 'exit 3');
  assert.equal(rows[0].guidance, 'Reinstall jq yourself.');
  assert.equal(rows[0].stateLabel, 'Failed');
  assert.equal(rows[1].tone === 'success', false);
});

test('ready is stated only when the projection is ready', () => {
  const healthy = projectInspection(inspection([check('npm/version', 'npm', 'passed', 'version-ok')]));
  assert.equal(healthy.ready, true);
  assert.match(overallLine(healthy), /^Ready\b/);
  const cases = [mixed, projectInspection(inspection([])), projectInspection(inspection([check('npm/version', 'npm', 'passed', 'version-ok')], { status: 'incomplete' })),
    projectInspection(inspection([check('npm/tls', 'npm', 'skipped', 'network-off')])), projectInspection(inspection([], { status: 'cancelled' }))];
  for (const projection of cases) {
    assert.equal(projection.ready, false);
    assert.match(overallLine(projection), /^Not ready\b/);
    assert.doesNotMatch(overallLine(projection), /^Ready\b/);
  }
  assert.match(overallLine(mixed), /1 failed/);
  assert.match(overallLine(projectInspection(inspection([]))), /nothing was checked/i);
  assert.match(overallLine(cases[2]), /incomplete/);
});

test('offline unknown conditions say they are unknown, not ready', () => {
  const offline = projectInspection(inspection([check('npm/version', 'npm', 'passed', 'version-ok'), check('npm/tls/node', 'npm', 'skipped', 'network-off')]));
  assert.match(overallLine(offline), /^Not ready\b.*1 unknown/);
  assert.deepEqual(rowsFor(offline).map(row => row.tone === 'success'), [false, true]);
});

test('summary counts follow the fixed state order and match the projection', () => {
  const counts = summaryCounts(mixed);
  assert.deepEqual(counts.map(item => item.state), READINESS_STATES);
  assert.deepEqual(Object.fromEntries(counts.map(item => [item.state, item.count])), mixed.summary);
});

test('repair preparation rows show effects and the condition is never ready', () => {
  const prepared = projectRepairPreparation(preparation('ready', ['create-file', 'create-file'], { sessionId: 's' }), repair);
  const rows = rowsFor(prepared);
  assert.deepEqual(rows.map(row => [row.id, row.state]), prepared.operations.map(item => [item.id, item.state]));
  assert.equal(rows[0].effects, 'create-file');
  assert.equal(rows[0].purpose, 'Purpose of trust/op0');
  assert.equal(rows[0].stateLabel, 'Failed');
  assert.match(overallLine(prepared), /^Not ready\b.*changes/i);
  const blocked = projectRepairPreparation(preparation('blocked'), repair);
  assert.match(overallLine(blocked), /^Not ready\b/);
  assert.equal(rowsFor(blocked).length, 0);
});

test('repair outcome distinguishes applied from verified', () => {
  const satisfied = preparation('ready', ['already-satisfied', 'already-satisfied']);
  const healthy = inspection([check('npm/version', 'npm', 'passed', 'version-ok')]);
  const verified = projectRepairOutcome({ run: run('complete', [['applied', 'passed'], ['applied', 'passed']]), recheck: satisfied, inspection: healthy, repair });
  assert.match(overallLine(verified), /^Repair verified\b.*for npm.*not machine readiness/);
  assert.doesNotMatch(overallLine(verified), /^Ready\b/, 'a repair outcome never claims machine readiness');
  const unconfirmed = projectRepairOutcome({ run: run('complete', [['applied', 'passed']]), recheck: satisfied,
    inspection: inspection([check('npm/tls/node', 'npm', 'unavailable', 'deadline')]), repair });
  assert.match(overallLine(unconfirmed), /^Not ready\b.*recheck of the repair's targets/);
  const conditionFailed = projectRepairOutcome({ run: run('complete', [['applied', 'passed']]), recheck: satisfied,
    inspection: inspection([check('npm/tls/node', 'npm', 'failed', 'connection-failed')], { status: 'incomplete' }), repair });
  assert.match(overallLine(conditionFailed), /^Not ready\b.*recheck of the repair's targets failed/);
  const outstanding = projectRepairOutcome({ run: run('complete', [['applied', 'passed']]), recheck: preparation('ready', ['already-satisfied', 'create-file']),
    inspection: healthy, repair });
  assert.match(overallLine(outstanding), /^Not ready\b.*fresh preparation.*trust\/op1/);
  assert.deepEqual(rowsFor(verified).map(row => [row.stateLabel, row.application, row.verification]),
    [['Verified', 'applied', 'passed'], ['Verified', 'applied', 'passed']]);
  const offline = projectRepairOutcome({ run: run('incomplete', [['applied', 'passed'], ['applied', 'skipped']]), recheck: satisfied, repair });
  assert.equal(offline.ready, false);
  assert.match(overallLine(offline), /^Not ready\b/);
  assert.match(overallLine(offline), /applied/i);
  assert.deepEqual(rowsFor(offline).map(row => row.stateLabel), ['Applied', 'Verified']);
  const failed = projectRepairOutcome({ run: run('complete', [['failed', 'unverified']]), recheck: null, repair });
  assert.match(overallLine(failed), /1 failed/);
  const rejected = projectRepairOutcome({ run: { completion: 'rejected', operations: [], checks: [], diagnostics: [] }, recheck: null, repair });
  assert.match(overallLine(rejected), /^Not ready\b.*rejected/);
});

test('a verified repair recheck names its scope and never reads as machine readiness while another target fails', () => {
  const latest = projectInspection(inspection([check('npm/tls/node', 'npm', 'failed', 'connection-failed'), check('jq/version', 'jq', 'failed', 'version-exit'),
    check('node/version', 'node', 'passed', 'version-ok')], { effectiveOptions: { ...options, targets: { value: ['jq', 'npm', 'node'], origin: 'explicit' } } }));
  const outcome = projectRepairOutcome({ run: run('complete', [['applied', 'passed']]), recheck: preparation('ready', ['already-satisfied']),
    inspection: inspection([check('npm/tls/node', 'npm', 'passed', 'connected')], { effectiveOptions: { ...options, targets: { value: ['npm'], origin: 'explicit' } } }),
    repair, latestCheck: latest });
  assert.equal(outcome.ready, true, 'the repair itself verified');
  const recheck = outcome.condition;
  assert.equal(recheck.scopeVerified, true);
  const line = overallLine(recheck);
  assert.match(line, /^Recheck of the repair's targets only \(npm\): every checked condition verified\. This is not machine readiness\./);
  assert.match(line, /Not re-checked: jq \(failed in the latest machine check\)/);
  assert.match(overallLine({ ...latest, beforeRepair: true }), /^Latest machine check, taken before this repair: Not ready — 2 failed\./);
  assert.deepEqual(rowsFor(recheck).map(row => [row.id, row.stateLabel]), [['npm/tls/node', 'Verified']]);
  for (const text of [line, overallLine(outcome), overallLine({ ...latest, beforeRepair: true })]) assert.doesNotMatch(text, /^Ready\b/, text);
  const unscoped = projectRepairOutcome({ run: run('complete', [['applied', 'passed']]), recheck: preparation('ready', ['already-satisfied']),
    inspection: inspection([check('npm/tls/node', 'npm', 'passed', 'connected')]), repair });
  assert.match(overallLine(unscoped.condition), /Other targets were not re-checked/);
});

test('helpers tolerate a missing projection', () => {
  assert.deepEqual(rowsFor(null), []);
  assert.match(overallLine(null), /^Not ready\b/);
});
