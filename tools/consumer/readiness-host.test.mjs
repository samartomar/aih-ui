// Integration test against the real installed Core. Everything observed or repaired lives in a
// disposable fixture home: the fixture environment is applied before Core is imported, and the
// test aborts if the process home is not the fixture. Run through `node --test` so this file
// gets its own process and the owner's environment is never changed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { createReadinessFixture, FIXTURE_CA } from './readiness-fixture.mjs';
import { projectInspection, readinessGuidance } from './readiness.mjs';

const realNpmrc = join(os.homedir(), '.npmrc');
const stamp = path => existsSync(path) ? statSync(path).mtimeMs : null;
const realNpmrcBefore = stamp(realNpmrc);
const makeFixture = () => createReadinessFixture(mkdtempSync(join(os.tmpdir(), 'aih-readiness-')));
const enter = fixture => {
  Object.assign(process.env, fixture.env);
  assert.equal(os.homedir(), fixture.home, 'process home must be the fixture before Core runs');
};
const inside = (root, path) => { const rel = relative(root, path); return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel); };

const first = makeFixture();
enter(first);
const { createReadinessHost } = await import('./readiness-host.mjs');
const { inspect } = await import('@aihq/core');

const offlineRepair = { key: 'npm-ca-offline', id: 'node-npm-ca', targets: ['npm'], inputs: { caFile: FIXTURE_CA }, network: 'off' };
const onlineRepair = { key: 'npm-ca-online', id: 'node-npm-ca', targets: ['npm'], inputs: { caFile: FIXTURE_CA }, network: 'declared' };
const host = createReadinessHost({ repairs: [offlineRepair, onlineRepair] });
const ok = result => { assert.equal(result.status, 'ok', JSON.stringify(result)); return result.value; };

test('a machine check journals its identity and returns isolated copies', async () => {
  const journalHost = createReadinessHost();
  const { projection } = ok(await journalHost.check({ targets: ['jq'], network: 'off' }));
  const records = journalHost.records();
  assert.equal(records.length, 1);
  const [record] = records;
  assert.equal(record.schema, 'urn:aih-ui:readiness-record:1.0.0');
  assert.equal(record.kind, 'machine-check');
  assert.match(record.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(record.sha256, /^[0-9a-f]{64}$/);
  assert.equal(new Date(record.capturedAt).toISOString(), record.capturedAt);
  assert.equal(record.core.name, '@aihq/core');
  assert.equal(typeof record.core.version, 'string');
  assert.deepEqual(record.check, projection);
  assert.deepEqual([projection.options.configuration, projection.persisted], ['persisted', []], 'the machine check uses the persisted configuration');
  const original = structuredClone(records);
  record.check.items[0].state = 'verified';
  record.core.version = 'changed';
  records.pop();
  projection.items[0].state = 'verified';
  assert.deepEqual(journalHost.records(), original);
});

test('the journal retains only the latest 64 records with increasing instants', async () => {
  const journalHost = createReadinessHost();
  ok(await journalHost.check({ targets: ['jq'], network: 'off' }));
  const firstId = journalHost.records()[0].id;
  for (let index = 0; index < 64; index++) ok(await journalHost.check({ targets: ['jq'], network: 'off' }));
  const records = journalHost.records();
  assert.equal(records.length, 64);
  assert.ok(records.every(record => record.id !== firstId));
  assert.equal(new Set(records.map(record => record.id)).size, 64);
  for (let index = 1; index < records.length; index++) assert.ok(records[index - 1].capturedAt < records[index].capturedAt);
});

test('a failing condition is listed first with guidance and is not ready', async () => {
  const { projection, guidance } = ok(await host.check({ targets: ['jq'], network: 'off' }));
  assert.equal(projection.items[0].id, 'jq/version');
  assert.equal(projection.items[0].state, 'failed');
  assert.equal(projection.items[0].reason, 'version-exit');
  assert.equal(projection.ready, false);
  assert.match(guidance, /jq\/version/);
  assert.ok(projection.items[0].guidance, 'Core manual guidance is carried through');
});

test('offline and unavailable checks are unknown and never ready', async () => {
  const offline = ok(await host.check({ targets: ['npm'], network: 'off' })).projection;
  const tls = offline.items.filter(item => item.id.includes('/tls/'));
  assert.ok(tls.length > 0, 'npm reports tls checks');
  assert.ok(tls.every(item => item.state === 'unknown' && item.reason === 'network-off'));
  assert.equal(offline.ready, false);
  const missing = ok(await host.check({ targets: ['cargo'], network: 'off' })).projection;
  assert.ok(missing.items.length > 0 && missing.items.every(item => item.state === 'unknown'), JSON.stringify(missing.items));
  assert.equal(missing.ready, false);
});

test('an already healthy condition is verified and ready', async () => {
  const { projection } = ok(await host.check({ targets: ['node'], network: 'off' }));
  assert.equal(projection.state, 'verified', JSON.stringify(projection.items));
  assert.equal(projection.ready, true);
});

test('requests are validated before Core is touched', async () => {
  for (const body of [{ targets: 'jq' }, { targets: [] }, { targets: ['not-a-target'] }, { targets: [1] }, { network: 'maybe' }, { targets: ['jq', 'jq'] }]) {
    const result = await host.check(body);
    assert.equal(result.status, 'error', JSON.stringify(body));
    assert.equal(result.diagnostics[0].code, 'INVALID_REQUEST');
  }
  assert.equal((await host.prepareRepair({ key: 'nope' })).status, 'error');
  assert.equal((await host.prepareRepair({ key: { toString: () => 'npm-ca-offline' } })).status, 'error');
  assert.throws(() => createReadinessHost({ repairs: [{ key: 'x', id: 'node-npm-ca', targets: ['node'], inputs: {}, network: 'off' }] }), /node/);
  assert.throws(() => createReadinessHost({ repairs: [offlineRepair, offlineRepair] }), /duplicate/i);
  assert.equal((await host.applyRepair({ sessionId: 'unknown', reviewDigest: 'x', approved: true })).status, 'lost');
});

test('configured repairs are listed without paths or inputs', () => {
  const { repairs } = ok(host.repairs());
  assert.deepEqual(repairs, [
    { key: 'npm-ca-offline', id: 'node-npm-ca', targets: ['npm'], network: 'off' },
    { key: 'npm-ca-online', id: 'node-npm-ca', targets: ['npm'], network: 'declared' }]);
  assert.ok(!JSON.stringify(repairs).includes(FIXTURE_CA) && !JSON.stringify(repairs).includes('caFile'));
  assert.deepEqual(ok(createReadinessHost().repairs()).repairs, []);
});

test('offline repair needs a live preparation, a matching digest and approval, and is applied, not verified', async () => {
  const before = ok(await host.check({ targets: ['jq', 'npm'], network: 'off' })).projection;
  const beforeRecord = host.records().at(-1);
  const value = ok(await host.prepareRepair({ key: 'npm-ca-offline' }));
  assert.equal(typeof value.sessionId, 'string');
  assert.equal(typeof value.reviewDigest, 'string');
  assert.equal(value.projection.preparationStatus, 'ready');
  assert.equal(value.projection.state, 'failed');
  assert.equal(value.projection.approvable, true);
  assert.ok(value.operations.length > 0);
  for (const operation of value.operations) {
    assert.ok(typeof operation.target === 'string' && inside(first.home, operation.target), `repair target ${operation.target} is outside the fixture home`);
  }
  assert.ok(!JSON.stringify(value).includes('"prepared"'), 'the live handle never leaves the host');
  assert.equal(existsSync(join(first.home, '.npmrc')), false, 'preparing changes nothing');

  const wrong = await host.applyRepair({ sessionId: value.sessionId, reviewDigest: 'wrong', approved: true });
  assert.equal(wrong.status, 'rejected');
  const unapproved = await host.applyRepair({ sessionId: value.sessionId, reviewDigest: value.reviewDigest, approved: false });
  assert.equal(unapproved.status, 'rejected');
  assert.equal(existsSync(join(first.home, '.npmrc')), false, 'a rejected approval writes nothing');

  // A machine check that finishes while the repair runs is not the one labelled as taken before it.
  // The settle order is recorded and required, so this test cannot pass without the overlap.
  const settled = [];
  const [applied, overlapping] = await Promise.all([
    host.applyRepair({ sessionId: value.sessionId, reviewDigest: value.reviewDigest, approved: true }).finally(() => settled.push('apply')),
    host.check({ targets: ['node'], network: 'off' }).finally(() => settled.push('check'))]);
  ok(overlapping);
  assert.deepEqual(settled, ['check', 'apply'], 'the overlapping check must finish while the repair is still running');
  const { outcome, recheck, machine, guidance } = ok(applied);
  const record = host.records().at(-1);
  assert.equal(record.schema, 'urn:aih-ui:readiness-record:1.0.0');
  assert.equal(record.kind, 'repair');
  assert.match(record.sha256, /^[0-9a-f]{64}$/);
  assert.equal(record.repair.before, beforeRecord.id, 'the overlapping check must not replace the pre-apply identity');
  assert.ok(beforeRecord.capturedAt < record.repair.appliedAt);
  assert.ok(record.repair.appliedAt < record.repair.recheckedAt);
  assert.equal(record.capturedAt, record.repair.recheckedAt);
  assert.equal(new Date(record.capturedAt).toISOString(), record.capturedAt);
  assert.equal(record.repair.repairId, offlineRepair.id);
  assert.deepEqual(record.repair.targets, offlineRepair.targets);
  assert.equal(typeof record.repair.run.id, 'string');
  assert.equal(typeof record.repair.run.schema, 'string');
  assert.deepEqual(record.repair.outcome, outcome);
  assert.deepEqual(machine, { ...before, beforeRepair: true });
  assert.deepEqual(recheck.notRechecked, [{ target: 'jq', state: 'failed' }]);
  assert.ok(outcome.operations.every(item => item.application === 'applied'), JSON.stringify(outcome.operations));
  assert.equal(outcome.state, 'applied', JSON.stringify(outcome.operations));
  assert.equal(outcome.ready, false);
  assert.equal(recheck.ready, false, 'offline recheck cannot be ready');
  assert.match(guidance, /node-npm-ca/);
  assert.equal(existsSync(join(first.home, '.npmrc')), true);
  // The recheck sees the trust this repair persisted for a new process, and the journal says which value it applied.
  assert.equal(outcome.condition.options.configuration, 'persisted');
  const cafile = outcome.condition.persisted.find(entry => entry.id === 'npm-cafile');
  assert.deepEqual([cafile?.repair, cafile?.state], ['node-npm-ca', 'applied'], JSON.stringify(outcome.condition.persisted));
  assert.ok(cafile.certificates >= 1 && /^[0-9a-f]{64}$/.test(cafile.materialSha256), JSON.stringify(cafile));
  assert.ok(!JSON.stringify(record).includes(first.home), 'no fixture path is journaled');
  assert.match(guidance, /^Checked with the configuration Core's managed repairs persist for a new process: .*npm-cafile applied \(node-npm-ca, \d+ certificates?\)/m);

  assert.equal((await host.applyRepair({ sessionId: value.sessionId, reviewDigest: value.reviewDigest, approved: true })).status, 'lost', 'sessions are one-shot');
  const again = ok(await host.prepareRepair({ key: 'npm-ca-offline' }));
  assert.equal(again.projection.state, 'configured', 'files in place are configured, not verified');
  assert.equal(again.projection.ready, false);
});

test('online repair is verified and rechecked, or honestly not verified when the registry is unreachable', async t => {
  const second = makeFixture();
  enter(second);
  // The machine check covers an unrelated target that still fails after the npm repair.
  const before = ok(await host.check({ targets: ['jq', 'npm'], network: 'declared' })).projection;
  assert.equal(before.ready, false);
  const value = ok(await host.prepareRepair({ key: 'npm-ca-online' }));
  assert.equal(value.projection.state, 'failed');
  for (const operation of value.operations) assert.ok(inside(second.home, operation.target), operation.target);
  const { outcome, recheck, machine, guidance } = ok(await host.applyRepair({ sessionId: value.sessionId, reviewDigest: value.reviewDigest, approved: true }));
  // Whatever the registry allows, the recheck is scoped to npm and jq is reported as not re-checked.
  assert.equal(recheck.kind, 'repair-recheck');
  assert.deepEqual(recheck.scope, ['npm']);
  assert.equal(recheck.ready, false, 'a recheck of the repair targets is never machine readiness');
  assert.deepEqual(recheck.notRechecked, [{ target: 'jq', state: 'failed' }]);
  assert.equal(machine.beforeRepair, true);
  assert.equal(machine.ready, false);
  assert.match(guidance, /^Latest machine check, taken before this repair \((?:complete|incomplete), network declared\): not ready\.$/m);
  assert.match(guidance, /^Recheck of the repair's targets only: npm /m);
  assert.match(guidance, /^Not re-checked: jq \(failed in the latest machine check\)\.$/m);
  assert.doesNotMatch(guidance, /\): ready\./);
  assert.equal(existsSync(join(second.home, '.npmrc')), true);
  assert.match(readFileSync(join(second.home, '.npmrc'), 'utf8'), /\S/);
  assert.ok(outcome.operations.every(item => item.application === 'applied'), JSON.stringify(outcome.operations));
  if (outcome.state !== 'verified') {
    // The registry decides whether Core can verify. Only a failed independent probe excuses it.
    const reachable = await fetch('https://registry.npmjs.org/-/ping', { signal: AbortSignal.timeout(10_000) }).then(response => response.ok, () => false);
    assert.equal(reachable, false, `registry reachable but repair not verified: ${JSON.stringify(outcome.operations)}`);
    // Unreachable network checks may honestly fail the post-repair condition or Core's verification.
    if (outcome.state === 'failed') assert.ok(outcome.condition?.items.some(item => item.state === 'failed' && item.id.includes('/tls/'))
      || outcome.operations.some(item => item.verification === 'failed'), JSON.stringify(outcome));
    assert.equal(outcome.ready, false);
    t.skip('npm registry unreachable');
    return;
  }
  assert.equal(outcome.ready, true);
  assert.equal(outcome.recheck.state, 'configured');
  assert.equal(outcome.recheck.operations.every(item => item.reason === 'in-place-not-verified'), true);
  assert.equal(recheck.status, 'complete');
  assert.deepEqual([recheck.options.targets, recheck.options.network], [['npm'], 'declared'], 'the recheck inspects the repaired condition');
  assert.equal(recheck.scopeVerified, true);
});

test('the headless projection carries the same meaning as the host API', async () => {
  const request = { targets: ['jq', 'node'], network: 'off' };
  const { projection, guidance } = ok(await host.check(request));
  const headless = projectInspection(await inspect({ ...request, configuration: 'persisted' }));
  assert.deepEqual(projection, headless);
  assert.equal(guidance, readinessGuidance([headless]));
  assert.deepEqual(JSON.parse(JSON.stringify(ok(await host.check(request)))), { projection, guidance });
});

test('the host journal reports verified repairs end to end through the adapter and Core', async t => {
  const third = makeFixture();
  enter(third);
  const reportHost = createReadinessHost({ repairs: [onlineRepair] });
  const empty = ok(await reportHost.report());
  assert.equal(empty.records, 0);
  assert.equal(empty.projection.calculations.find(entry => entry.id === 'verified-repairs').count, 0);
  const { projection: before } = ok(await reportHost.check({ targets: ['jq', 'npm'], network: 'declared' }));
  const value = ok(await reportHost.prepareRepair({ key: 'npm-ca-online' }));
  const { outcome } = ok(await reportHost.applyRepair({ sessionId: value.sessionId, reviewDigest: value.reviewDigest, approved: true }));
  // What Core itself said about each npm condition, before and after the applied repair.
  const stateBefore = new Map(before.items.filter(item => item.target === 'npm').map(item => [item.id, item.state]));
  const stateAfter = new Map((outcome.condition?.items ?? []).map(item => [item.id, item.state]));
  const expected = [...stateBefore].filter(([id, state]) => state === 'failed' && stateAfter.get(id) === 'verified').map(([id]) => id);

  const report = ok(await reportHost.report());
  const records = reportHost.records();
  assert.deepEqual([report.records, records.map(record => record.kind)], [2, ['machine-check', 'repair']]);
  const repairs = report.projection.calculations.find(entry => entry.id === 'verified-repairs');
  assert.equal(repairs.status, 'available');
  assert.deepEqual(repairs.attempts.filter(attempt => attempt.counted).map(attempt => attempt.condition.replace(/^condition:/, '')).sort(), [...expected].sort());
  assert.equal(repairs.count, expected.length, JSON.stringify(repairs.attempts));
  assert.ok(outcome.operations.every(item => item.application === 'applied'), 'the repair was applied, so each attempt has an applied repair');
  // The reason Core must give for each before/after pair of that condition, stated independently of the attempt.
  const expectedReason = (was, now) => was === 'verified' ? 'already-healthy'
    : was !== 'failed' ? 'unknown-precondition'
      : now === 'verified' ? 'verified' : now === 'failed' ? 'repair-not-verified' : 'applied-unverified';
  assert.ok(repairs.attempts.length > 0, 'the repair of npm has attempts');
  for (const attempt of repairs.attempts) {
    const id = attempt.condition.replace(/^condition:/, '');
    assert.equal(attempt.reason, expectedReason(stateBefore.get(id), stateAfter.get(id)), `${id}: before ${stateBefore.get(id)}, after ${stateAfter.get(id)}`);
    assert.equal(attempt.counted, attempt.reason === 'verified');
    assert.equal(attempt.operation, 'node-npm-ca');
  }
  const [machineRecord, repairRecord] = records;
  const claimsOf = id => report.claimSet.claims.filter(claim => claim.sources.some(source => source.id === id));
  assert.ok(claimsOf(machineRecord.id).every(claim => claim.sources.some(source => source.sha256 === machineRecord.sha256)), 'exact journal identity');
  assert.ok(claimsOf(repairRecord.id).length > 0 && claimsOf(repairRecord.repair.run.id).length > 0, 'the repair record and the Core run are sources');
  const usage = report.claimSet.claims.find(claim => claim.measure === 'observed-usage');
  assert.equal(usage.kind, 'unknown');
  assert.ok(usage.capturedAt >= repairRecord.capturedAt, 'stamped by the host clock, not before the journal');
  if (!expected.length) t.diagnostic(`no npm condition failed before the repair in this environment; the count is ${repairs.count} by Core's own states`);
});

test('the owner configuration was not touched', () => {
  assert.equal(stamp(realNpmrc), realNpmrcBefore);
});
