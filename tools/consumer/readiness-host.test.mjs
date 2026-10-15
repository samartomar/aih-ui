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

  const { outcome, recheck, guidance } = ok(await host.applyRepair({ sessionId: value.sessionId, reviewDigest: value.reviewDigest, approved: true }));
  assert.ok(outcome.operations.every(item => item.application === 'applied'), JSON.stringify(outcome.operations));
  assert.equal(outcome.state, 'applied', JSON.stringify(outcome.operations));
  assert.equal(outcome.ready, false);
  assert.equal(recheck.ready, false, 'offline recheck cannot be ready');
  assert.match(guidance, /node-npm-ca/);
  assert.equal(existsSync(join(first.home, '.npmrc')), true);

  assert.equal((await host.applyRepair({ sessionId: value.sessionId, reviewDigest: value.reviewDigest, approved: true })).status, 'lost', 'sessions are one-shot');
  const again = ok(await host.prepareRepair({ key: 'npm-ca-offline' }));
  assert.equal(again.projection.state, 'configured', 'files in place are configured, not verified');
  assert.equal(again.projection.ready, false);
});

test('online repair is verified and rechecked, or honestly not verified when the registry is unreachable', async t => {
  const second = makeFixture();
  enter(second);
  const value = ok(await host.prepareRepair({ key: 'npm-ca-online' }));
  assert.equal(value.projection.state, 'failed');
  for (const operation of value.operations) assert.ok(inside(second.home, operation.target), operation.target);
  const { outcome, recheck } = ok(await host.applyRepair({ sessionId: value.sessionId, reviewDigest: value.reviewDigest, approved: true }));
  assert.equal(existsSync(join(second.home, '.npmrc')), true);
  assert.match(readFileSync(join(second.home, '.npmrc'), 'utf8'), /\S/);
  assert.ok(outcome.operations.every(item => item.application === 'applied'), JSON.stringify(outcome.operations));
  if (outcome.state !== 'verified') {
    // The registry decides whether Core can verify. Only a failed independent probe excuses it.
    const reachable = await fetch('https://registry.npmjs.org/-/ping', { signal: AbortSignal.timeout(10_000) }).then(response => response.ok, () => false);
    assert.equal(reachable, false, `registry reachable but repair not verified: ${JSON.stringify(outcome.operations)}`);
    assert.notEqual(outcome.state, 'failed', 'an unreachable registry cannot fail the repair');
    assert.equal(outcome.ready, false);
    t.skip('npm registry unreachable');
    return;
  }
  assert.equal(outcome.ready, true);
  assert.equal(outcome.recheck.state, 'configured');
  assert.equal(outcome.recheck.operations.every(item => item.reason === 'in-place-not-verified'), true);
  assert.equal(recheck.status, 'complete');
});

test('the headless projection carries the same meaning as the host API', async () => {
  const request = { targets: ['jq', 'node'], network: 'off' };
  const { projection, guidance } = ok(await host.check(request));
  const headless = projectInspection(await inspect(request));
  assert.deepEqual(projection, headless);
  assert.equal(guidance, readinessGuidance([headless]));
  assert.deepEqual(JSON.parse(JSON.stringify(ok(await host.check(request)))), { projection, guidance });
});

test('the owner configuration was not touched', () => {
  assert.equal(stamp(realNpmrc), realNpmrcBefore);
});
