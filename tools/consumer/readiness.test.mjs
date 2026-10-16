import test from 'node:test';
import * as readiness from './readiness.mjs';
import assert from 'node:assert/strict';
import { READINESS_STATES, projectInspection, projectRepairPreparation, projectRepairOutcome, readinessGuidance } from './readiness.mjs';

// Core-shaped records: InspectResult, PreparationResult (serializable part) and RunResult.
const options = { targets: { value: ['npm', 'jq'], origin: 'explicit' }, network: { value: 'declared', origin: 'default' },
  probeConfiguredMcp: { value: false, origin: 'default' }, budgetMs: { value: 180000, origin: 'default' } };
const inspection = (checks, extra = {}) => ({ status: 'complete', package: { name: '@aihq/core', version: 'x' },
  tools: [{ id: 'npm', label: 'npm', state: 'runnable', selection: 'requested' }, { id: 'jq', label: 'jq', state: 'absent', selection: 'requested' },
    { id: 'git', label: 'Git', state: 'binary', selection: 'unselected' }],
  observations: [], checks, repairChoices: [], diagnostics: [], effectiveOptions: options,
  limits: { budgetMs: 180000, elapsedMs: 1, maxActiveProbes: 2 }, followUp: [], ...extra });
const check = (id, target, outcome, reason) => ({ id, target, outcome, reason, detail: '' });
const operation = (id, effects) => ({ id, purpose: `Purpose of ${id}`, kind: 'file.write', scope: 'user', effects, ownership: 'managed',
  requires: [], checks: [], details: { target: `/fixture-home/${id}` } });
const preparation = (status, effects) => ({ status, diagnostics: [],
  ...(effects ? { review: { useCase: 'repair', operations: effects.map((value, index) => operation(`trust/op${index}`, value)), reviewDigest: 'd' } } : {}) });
const run = (completion, operations) => ({ completion, operations: operations.map(([application, verification], index) =>
  ({ id: `trust/op${index}`, application, verification: { status: verification, reason: 'r' } })), checks: [], diagnostics: [], followUp: [] });
const repair = { id: 'node-npm-ca', targets: ['npm'] };

test('state vocabulary is failure-first and fixed', () => {
  assert.deepEqual(READINESS_STATES, ['failed', 'unknown', 'applied', 'configured', 'verified']);
});

test('a failing condition is listed before passing checks and carries copyable Core guidance', () => {
  const result = inspection([check('npm/version', 'npm', 'passed', 'version-ok'), check('jq/version', 'jq', 'failed', 'executable-missing')],
    { repairChoices: [{ target: 'jq', kind: 'manual-guidance', reason: 'executable-missing', guidance: 'Install jq yourself.' }] });
  const projected = projectInspection(result);
  assert.deepEqual(projected.items.map(item => [item.id, item.state]), [['jq/version', 'failed'], ['npm/version', 'verified']]);
  assert.equal(projected.items[0].guidance, 'Install jq yourself.');
  assert.equal(projected.ready, false);
  assert.deepEqual(projected.summary, { failed: 1, unknown: 0, applied: 0, configured: 0, verified: 1 });
});

test('offline, unavailable and unchecked conditions are unknown and never ready', () => {
  const offline = projectInspection(inspection([check('npm/version', 'npm', 'passed', 'version-ok'),
    check('npm/tls/node/registry.npmjs.org', 'npm', 'skipped', 'network-off'), check('npm/tls/os/registry.npmjs.org', 'npm', 'unavailable', 'deadline')]));
  assert.deepEqual(offline.items.map(item => item.state), ['unknown', 'unknown', 'verified']);
  assert.equal(offline.ready, false);
  for (const status of ['incomplete', 'cancelled', 'invalid']) {
    const partial = projectInspection(inspection([check('npm/version', 'npm', 'passed', 'version-ok')], { status }));
    assert.equal(partial.ready, false, status);
    assert.equal(partial.state, 'unknown', status);
  }
  assert.equal(projectInspection(inspection([])).ready, false, 'nothing checked is not ready');
  const failedIncomplete = projectInspection(inspection([check('jq/version', 'jq', 'failed', 'version-exit')], { status: 'incomplete' }));
  assert.equal(failedIncomplete.state, 'failed', 'an observed failure is not hidden by an incomplete inspection');
});

test('an already-healthy machine check is verified, and installed clients without a check stay configured', () => {
  const healthy = projectInspection(inspection([check('npm/version', 'npm', 'passed', 'version-ok')]));
  assert.equal(healthy.ready, true);
  assert.equal(healthy.state, 'verified');
  const client = projectInspection(inspection([check('npm/version', 'npm', 'passed', 'version-ok')], {
    observations: [{ id: 'claude/loading', target: 'claude', detail: 'Installation or configuration observed; native loading was not verified.' }],
    repairChoices: [{ target: 'claude', kind: 'manual-guidance', reason: 'loading-unverified', guidance: 'Start a fresh session.' }] }));
  assert.deepEqual(client.items.map(item => [item.id, item.state]), [['claude/loading', 'configured'], ['npm/version', 'verified']]);
  assert.equal(client.ready, false, 'configured is not verified');
});

test('repair preparation reports the condition without claiming readiness from files', () => {
  assert.equal(projectRepairPreparation(preparation('ready', ['create-file', 'create-file']), repair).state, 'failed');
  const satisfied = projectRepairPreparation(preparation('ready', ['already-satisfied', 'already-satisfied']), repair);
  assert.equal(satisfied.state, 'configured');
  assert.equal(satisfied.ready, false);
  assert.equal(projectRepairPreparation(preparation('ready', ['conflict']), repair).state, 'failed');
  assert.equal(projectRepairPreparation(preparation('blocked'), repair).state, 'unknown');
  assert.equal(projectRepairPreparation(preparation('invalid'), repair).approvable, false);
});

test('applied without passing verification shows applied; verified needs passing checks and a satisfied recheck', () => {
  const satisfied = preparation('ready', ['already-satisfied', 'already-satisfied']);
  const healthy = inspection([check('npm/version', 'npm', 'passed', 'version-ok')]);
  const verified = projectRepairOutcome({ run: run('complete', [['applied', 'passed'], ['applied', 'passed']]), recheck: satisfied, inspection: healthy, repair });
  assert.equal(verified.state, 'verified');
  assert.equal(verified.ready, true);
  const offline = projectRepairOutcome({ run: run('incomplete', [['applied', 'passed'], ['applied', 'skipped']]), recheck: satisfied, inspection: healthy, repair });
  assert.deepEqual(offline.operations.map(item => [item.id, item.state]), [['trust/op1', 'applied'], ['trust/op0', 'verified']]);
  assert.equal(offline.state, 'applied');
  assert.equal(offline.ready, false);
  const drifted = projectRepairOutcome({ run: run('complete', [['applied', 'passed']]), recheck: preparation('ready', ['replace-file']), inspection: healthy, repair });
  assert.equal(drifted.state, 'failed');
  const unrechecked = projectRepairOutcome({ run: run('complete', [['applied', 'passed']]), recheck: null, inspection: healthy, repair });
  assert.equal(unrechecked.state, 'applied');
  assert.equal(projectRepairOutcome({ run: run('complete', [['failed', 'unverified']]), recheck: satisfied, inspection: healthy, repair }).state, 'failed');
  assert.equal(projectRepairOutcome({ run: run('complete', [['already-satisfied', 'unverified']]), recheck: satisfied, inspection: healthy, repair }).state, 'configured');
  assert.equal(projectRepairOutcome({ run: { completion: 'rejected', operations: [], checks: [], diagnostics: [] }, recheck: null, repair }).state, 'unknown');
});

test('the post-repair check of the same condition governs the success claim', () => {
  const satisfied = preparation('ready', ['already-satisfied']);
  const passed = run('complete', [['applied', 'passed']]);
  const outcome = condition => projectRepairOutcome({ run: passed, recheck: satisfied, inspection: condition, repair });
  const failedCheck = outcome(inspection([check('npm/tls/node/registry.npmjs.org', 'npm', 'failed', 'connection-failed')], { status: 'incomplete' }));
  assert.equal(failedCheck.state, 'failed');
  assert.equal(failedCheck.ready, false);
  assert.equal(failedCheck.condition.state, 'failed');
  const unavailable = outcome(inspection([check('npm/tls/node/registry.npmjs.org', 'npm', 'unavailable', 'deadline')]));
  assert.equal(unavailable.state, 'applied');
  assert.equal(unavailable.ready, false);
  const missing = projectRepairOutcome({ run: passed, recheck: satisfied, repair });
  assert.equal(missing.state, 'applied', 'no post-repair check is not verification');
  assert.equal(missing.condition, null);
  const extra = projectRepairOutcome({ run: passed, recheck: preparation('ready', ['already-satisfied', 'create-file']),
    inspection: inspection([check('npm/version', 'npm', 'passed', 'version-ok')]), repair });
  assert.equal(extra.state, 'failed', 'a fresh preparation that still needs changes is not success');
  assert.deepEqual(extra.unresolved.map(item => [item.id, item.state]), [['trust/op1', 'failed']]);
  const opaque = projectRepairOutcome({ run: passed, recheck: preparation('ready', ['already-satisfied', 'unavailable']),
    inspection: inspection([check('npm/version', 'npm', 'passed', 'version-ok')]), repair });
  assert.equal(opaque.state, 'unknown', 'uncovered unavailable work follows the preparation mapping');
});

test('a repair recheck covers only its targets and never states machine readiness while another target fails', () => {
  const targets = value => ({ effectiveOptions: { ...options, targets: { value, origin: 'explicit' } } });
  const latestCheck = projectInspection(inspection([check('npm/tls/node', 'npm', 'failed', 'connection-failed'), check('jq/version', 'jq', 'failed', 'version-exit'),
    check('node/version', 'node', 'passed', 'version-ok')], targets(['jq', 'npm', 'node'])));
  const outcome = projectRepairOutcome({ run: run('complete', [['applied', 'passed']]), recheck: preparation('ready', ['already-satisfied']),
    inspection: inspection([check('npm/tls/node', 'npm', 'passed', 'connected')], targets(['npm'])), repair, latestCheck });
  assert.equal(outcome.state, 'verified');
  const recheck = outcome.condition;
  assert.equal(recheck.kind, 'repair-recheck');
  assert.deepEqual(recheck.scope, ['npm']);
  assert.equal(recheck.scopeVerified, true);
  assert.equal(recheck.ready, false, 'a scoped recheck is never machine readiness');
  assert.deepEqual(recheck.notRechecked, [{ target: 'jq', state: 'failed' }, { target: 'node', state: 'verified' }]);
  const text = readinessGuidance([{ ...latestCheck, beforeRepair: true }, outcome, recheck]);
  assert.match(text, /^Latest machine check, taken before this repair \(complete, network declared\): not ready\.$/m);
  assert.match(text, /^Recheck of the repair's targets only: npm \(complete, network declared\): every checked condition verified for these targets\. This is not a machine readiness result\.$/m);
  assert.match(text, /^Not re-checked: jq \(failed in the latest machine check\), node \(verified in the latest machine check\)\.$/m);
  assert.doesNotMatch(text, /\): ready\./, 'no line claims the machine is ready');
  const alone = projectRepairOutcome({ run: run('complete', [['applied', 'passed']]), recheck: preparation('ready', ['already-satisfied']),
    inspection: inspection([check('npm/tls/node', 'npm', 'passed', 'connected')], targets(['npm'])), repair });
  assert.equal(alone.condition.notRechecked, null);
  assert.match(readinessGuidance([alone, alone.condition]), /Other targets were not re-checked/);
});

test('guidance text is plain, failure-first and states that nothing was executed', () => {
  const projected = projectInspection(inspection([check('npm/version', 'npm', 'passed', 'version-ok'), check('jq/version', 'jq', 'failed', 'executable-missing')],
    { repairChoices: [{ target: 'jq', kind: 'manual-guidance', reason: 'executable-missing', guidance: 'Install jq yourself.' }] }));
  const text = readinessGuidance([projected]);
  assert.equal(typeof text, 'string');
  assert.match(text, /executes nothing/i);
  const repaired = readinessGuidance([projectRepairOutcome({ run: run('complete', [['applied', 'passed']]), recheck: preparation('ready', ['already-satisfied']), repair })]);
  assert.doesNotMatch(repaired, /nothing has been changed/i, 'a repair outcome must not claim nothing changed');
  assert.ok(text.indexOf('jq/version') < text.indexOf('npm/version'));
  assert.match(text, /Install jq yourself\./);
  assert.doesNotMatch(text, /fixture-home/);
});

test('the readiness API exposes repair conditions through outcomes only', () => {
  assert.equal(Object.hasOwn(readiness, 'projectRecheck'), false);
});
