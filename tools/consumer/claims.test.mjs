import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateClaimSet, projectClaims } from '@aihq/core/report';
import { runScan, prepareArtifact } from '@aihq/scan/host';
import { readArtifact } from '@aihq/scan/read';
import { READINESS_RECORD_SCHEMA, CLAIMS_PRODUCER, CHECK_SET, readinessClaimSet, readinessReport } from './claims.mjs';
import { projectInspection, projectRepairOutcome } from './readiness.mjs';
import { reportPanels, reportText } from '../page/app/claims-view.js';

// The records the readiness host produces (contract: urn:aih-ui:readiness-record:1.0.0), built from
// Core-shaped results through the same projections the host uses.
const options = targets => ({ targets: { value: targets, origin: 'explicit' }, network: { value: 'declared', origin: 'default' } });
const inspection = (checks, { targets = ['npm', 'jq'], status = 'complete', observations = [] } = {}) => ({ status, package: { name: '@aihq/core', version: 'x' },
  tools: targets.map(id => ({ id, label: id, state: 'runnable', selection: 'requested' })), observations, checks, repairChoices: [], diagnostics: [],
  effectiveOptions: options(targets), limits: {}, followUp: [] });
const check = (id, target, outcome, reason = outcome === 'passed' ? 'version-ok' : 'executable-missing') => ({ id, target, outcome, reason, detail: '' });
const operation = (id, effects) => ({ id, purpose: id, kind: 'file.write', scope: 'user', effects, ownership: 'managed', requires: [], checks: [], details: {} });
const preparation = effects => ({ status: 'ready', diagnostics: [], review: { operations: effects.map((value, index) => operation(`trust/op${index}`, value)), reviewDigest: 'd' } });
const run = (completion, operations) => ({ id: 'run-1', schema: 'urn:aihq:core:run-result:1.3.0', completion, checks: [], diagnostics: [], followUp: [],
  operations: operations.map(([application, verification], index) => ({ id: `trust/op${index}`, application, verification: { status: verification, reason: 'r' } })) });
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// One monotonic clock, as the host stamps every instant.
function world() {
  let tick = Date.parse('2026-10-15T10:00:00.000Z'), serial = 0;
  const stamp = () => new Date(tick += 1000).toISOString();
  const machine = (checks, extra = {}) => {
    const result = inspection(checks, extra);
    return { schema: READINESS_RECORD_SCHEMA, id: `machine-${++serial}`, kind: 'machine-check', capturedAt: stamp(), sha256: sha(result),
      core: { ...result.package }, check: projectInspection(result) };
  };
  const repair = ({ before = null, targets = ['npm'], applied = [['applied', 'passed']], after, afterOptions = { targets }, repairId = 'node-npm-ca', recheck = ['already-satisfied'] }) => {
    const result = run('complete', applied), fresh = preparation(recheck), post = after ? inspection(after, afterOptions) : null;
    const appliedAt = stamp(), recheckedAt = stamp();
    const outcome = projectRepairOutcome({ run: result, recheck: fresh, inspection: post, repair: { id: repairId, targets }, latestCheck: before?.check ?? null });
    return { schema: READINESS_RECORD_SCHEMA, id: `repair-${++serial}`, kind: 'repair', capturedAt: recheckedAt, sha256: sha({ run: result, recheck: fresh, inspection: post }),
      core: post ? { ...post.package } : null, repair: { repairId, targets, before: before?.id ?? null, run: { id: result.id, schema: result.schema }, appliedAt, recheckedAt, outcome } };
  };
  return { machine, repair };
}
const tls = outcome => check('npm/tls/node', 'npm', outcome, outcome === 'passed' ? 'connected' : 'connection-failed');
const attemptFor = (projection, subject, condition) => projection.calculations.find(r => r.id === 'verified-repairs').attempts
  .find(a => a.subject.id === subject && a.condition === `condition:${condition}`);
const repairCount = projection => projection.calculations.find(r => r.id === 'verified-repairs');
const scoreOf = projection => projection.calculations.find(r => r.id === 'configuration-check-score');

test('installed Core is the reviewed packed artifact the adapter runs against', async () => {
  const consumer = new URL('../', import.meta.url);
  const reviewed = JSON.parse(await readFile(new URL('reviewed-packages.json', consumer), 'utf8')).find(entry => entry.name === 'core');
  assert.ok(reviewed, 'reviewed-packages.json lists core');
  assert.equal(createHash('sha256').update(await readFile(reviewed.tarball)).digest('hex'), reviewed.sha256);
  const installed = JSON.parse(await readFile(new URL('node_modules/@aihq/core/package.json', consumer), 'utf8'));
  assert.equal(installed.name, '@aihq/core');
  assert.ok(reviewed.tarball.includes(`aihq-core-${installed.version}-`), `${installed.version} is the packed version`);
  const { claimSet } = readinessReport({ records: [world().machine([check('npm/version', 'npm', 'passed')])] });
  assert.equal(validateClaimSet(claimSet).valid, true);
});

test('claims keep the exact producer record identity, the Core run and a stable event identity', () => {
  const w = world();
  const before = w.machine([tls('failed'), check('jq/version', 'jq', 'passed')]);
  const repaired = w.repair({ before, after: [tls('passed')] });
  const claimSet = readinessClaimSet({ records: [before, repaired] });
  assert.equal(validateClaimSet(claimSet).valid, true, JSON.stringify(validateClaimSet(claimSet).errors));
  assert.deepEqual(claimSet.claims.find(claim => claim.producer.id).producer, CLAIMS_PRODUCER);
  assert.deepEqual(CHECK_SET, { id: 'aih-ui/machine-check', version: '1.0.0' });
  const checkClaims = claimSet.claims.filter(claim => claim.measure === 'configuration-check');
  assert.ok(checkClaims.length > 0 && checkClaims.every(claim => JSON.stringify(claim.method) === JSON.stringify(CHECK_SET)), 'check claims name the check set');
  const fromBefore = claimSet.claims.filter(claim => claim.sources.some(source => source.id === before.id));
  assert.ok(fromBefore.length >= 4, 'a check claim and a condition claim per check item');
  for (const claim of fromBefore) {
    assert.deepEqual(claim.sources.find(source => source.id === before.id), { id: before.id, schema: READINESS_RECORD_SCHEMA, sha256: before.sha256 });
    assert.equal(claim.revision, before.sha256);
    assert.equal(typeof claim.observation, 'string');
    assert.deepEqual(claim.authentication, { status: 'not-authenticated' });
  }
  const fromRepair = claimSet.claims.filter(claim => claim.sources.some(source => source.id === repaired.id));
  assert.ok(fromRepair.length >= 2);
  for (const claim of fromRepair) {
    assert.ok(claim.sources.some(source => source.id === repaired.id && source.schema === READINESS_RECORD_SCHEMA && source.sha256 === repaired.sha256));
    assert.ok(claim.sources.some(source => source.id === 'run-1' && source.schema === 'urn:aihq:core:run-result:1.3.0'), 'the Core run is a source');
  }
  assert.equal(new Set(claimSet.claims.map(claim => claim.observation)).size, claimSet.claims.length, 'one event identity per claim');
  const again = readinessClaimSet({ records: [before, repaired] });
  assert.deepEqual(again, claimSet, 'the same records give the same claims');
  for (const claim of claimSet.claims) assert.doesNotMatch(JSON.stringify(claim), /[A-Za-z]:\\|\/Users\/|\/home\//);
});

test('the same record passed twice counts once; a re-imported event under another claim id counts once', () => {
  const w = world();
  const before = w.machine([tls('failed'), check('jq/version', 'jq', 'failed')]);
  const repaired = w.repair({ before, after: [tls('passed')] });
  const once = readinessReport({ records: [before, repaired] });
  const twice = readinessReport({ records: [before, repaired, JSON.parse(JSON.stringify(before)), JSON.parse(JSON.stringify(repaired))] });
  assert.deepEqual(twice.claimSet, once.claimSet);
  assert.equal(repairCount(twice.projection).count, 1);
  assert.deepEqual(scoreOf(twice.projection).counts, scoreOf(once.projection).counts);
  assert.equal(twice.projection.claims.length, once.projection.claims.length);

  // A re-import carries the adapter's claim under a new claim id but the same event identity.
  const claimSet = JSON.parse(JSON.stringify(once.claimSet));
  const precheck = claimSet.claims.find(claim => claim.measure === 'condition:npm/tls/node' && claim.id.startsWith(before.id));
  claimSet.claims.push({ ...JSON.parse(JSON.stringify(precheck)), id: `${precheck.id}-reimport` });
  const request = claimSet.calculations.find(entry => entry.id === 'verified-repairs');
  request.attempts.push({ ...JSON.parse(JSON.stringify(request.attempts.find(entry => entry.condition === 'condition:npm/tls/node'))),
    precheck: { id: `${precheck.id}-reimport`, revision: precheck.revision } });
  const projected = projectClaims(claimSet);
  const result = projected.calculations.find(entry => entry.id === 'verified-repairs');
  assert.equal(result.attempts.filter(entry => entry.counted).length, 2, 'both imports are verified attempts');
  assert.equal(result.count, 1, 'one failed condition');
  assert.equal(projected.observations.duplicates[0].imports, 2);
  assert.equal(projected.observations.conflicts.length, 0);
});

test('a record id re-used with different content is a visible conflict, not a silent merge', () => {
  const w = world();
  const first = w.machine([tls('failed')]);
  const edited = { ...JSON.parse(JSON.stringify(first)), sha256: sha('edited'), check: { ...first.check, items: first.check.items.map(entry => ({ ...entry, outcome: 'passed', state: 'verified' })) } };
  const { projection } = readinessReport({ records: [first, edited] });
  assert.ok(projection.observations.conflicts.length > 0);
  assert.ok(projection.claims.some(claim => claim.dedup.status === 'conflict'));
  assert.match(reportText(projection), /Conflicting records for one event/);
});

test('failed precheck, applied repair, passing recheck of the same condition is exactly one verified repair', () => {
  const w = world();
  const before = w.machine([tls('failed'), check('jq/version', 'jq', 'passed')]);
  const repaired = w.repair({ before, after: [tls('passed')] });
  const { projection } = readinessReport({ records: [before, repaired] });
  const result = repairCount(projection);
  assert.equal(result.status, 'available');
  assert.equal(result.count, 1);
  const attempt = attemptFor(projection, 'npm', 'npm/tls/node');
  assert.deepEqual([attempt.counted, attempt.reason, attempt.operation], [true, 'verified', 'node-npm-ca']);
  const panels = reportPanels(projection);
  assert.equal(panels.repairs.value, '1');
  assert.match(panels.repairs.summary, /^1 verified repair\b/);
  assert.match(panels.repairs.items.find(entry => entry.details.includes('Core reason: verified')).text, /^Counted — npm npm\/tls\/node/);
});

test('an already-healthy condition and an unknown-cause recovery are not counted, each with its Core reason', () => {
  const w = world();
  const healthy = w.machine([tls('passed'), check('jq/version', 'jq', 'failed')]);
  const repairedHealthy = w.repair({ before: healthy, after: [tls('passed')] });
  const a = readinessReport({ records: [healthy, repairedHealthy] }).projection;
  assert.equal(repairCount(a).count, 0);
  assert.equal(attemptFor(a, 'npm', 'npm/tls/node').reason, 'already-healthy');
  assert.match(reportText(a), /Core reason: already-healthy/);

  const w2 = world();
  const failed = w2.machine([tls('failed')]);
  const later = w2.machine([tls('passed')]);
  const b = readinessReport({ records: [failed, later] }).projection;
  assert.equal(repairCount(b).count, 0);
  const cause = attemptFor(b, 'npm', 'npm/tls/node');
  assert.deepEqual([cause.counted, cause.reason, cause.repair, cause.operation], [false, 'unknown-cause', null, 'none']);
  assert.match(reportText(b), /Core reason: unknown-cause/);
  assert.match(reportPanels(b).repairs.summary, /^0 verified repairs\b/);
});

test('an applied repair with no passing recheck is applied-unverified, ranks an urgent review and is not counted', () => {
  const w = world();
  const before = w.machine([tls('failed'), check('jq/version', 'jq', 'failed')]);
  const unchecked = w.repair({ before, after: null });
  const failedAfter = w.repair({ before, after: [tls('failed')], repairId: 'other' });
  const { projection } = readinessReport({ records: [before, unchecked, failedAfter] });
  assert.equal(repairCount(projection).count, 0);
  assert.deepEqual(repairCount(projection).attempts.map(entry => entry.reason).sort(), ['applied-unverified', 'repair-not-verified']);
  assert.equal(projection.actions.filter(action => action.category === 'urgent-review').length, 2);
  const blocker = projection.actions.findIndex(action => action.category === 'blocker');
  assert.ok(blocker >= 0 && blocker < projection.actions.findIndex(action => action.category === 'urgent-review'));
});

test('a repair rechecked a target after the latest machine check: its failure is recheck-needed, not a blocker', () => {
  const w = world();
  const before = w.machine([tls('failed'), check('jq/version', 'jq', 'failed')]);
  const repaired = w.repair({ before, after: [tls('passed')] });
  const { projection } = readinessReport({ records: [before, repaired] });
  const fromBefore = target => projection.claims.filter(claim => claim.sources.some(source => source.id === before.id) && claim.subject.id === target);
  assert.ok(fromBefore('npm').length > 0);
  for (const claim of fromBefore('npm')) {
    assert.deepEqual([claim.applicability.state, claim.applicability.reason], ['recheck-needed', 'A later repair recheck covered this target; run the machine check again.']);
  }
  for (const claim of fromBefore('jq')) assert.deepEqual([claim.applicability.state, claim.applicability.reason], ['current', 'This is the latest machine check.']);
  const blockers = projection.actions.filter(action => action.category === 'blocker');
  assert.deepEqual(blockers.map(action => action.subjects[0].id), ['jq'], 'the untouched failed check stays a current blocker');
  const stale = projection.actions.filter(action => action.subjects.some(subject => subject.id === 'npm') && action.category === 'important-unknown');
  assert.equal(stale.length, 1, 'one action per rechecked target');
  assert.match(stale[0].reason, /run the machine check again/);
  assert.deepEqual(stale[0].route, { kind: 'guidance', id: 'npm/run-the-machine-check-again' });
  assert.equal(projection.actions.some(action => action.category === 'blocker' && action.subjects.some(subject => subject.id === 'npm')), false);
  assert.match(reportText(projection), /Freshness: Recheck needed — A later repair recheck covered this target; run the machine check again\./);
  assert.equal(repairCount(projection).count, 1, 'the repair is still the one verified repair');
});

test('a machine check taken after the repair makes its failures current blockers again', () => {
  const w = world();
  const before = w.machine([tls('failed'), check('jq/version', 'jq', 'failed')]);
  const repaired = w.repair({ before, after: [tls('failed')] });
  const later = w.machine([tls('failed'), check('jq/version', 'jq', 'failed')]);
  const { projection } = readinessReport({ records: [before, repaired, later] });
  assert.deepEqual(projection.actions.filter(action => action.category === 'blocker').map(action => action.subjects[0].id).sort(), ['jq', 'npm']);
  assert.ok(projection.claims.filter(claim => claim.sources.some(source => source.id === later.id)).every(claim => claim.applicability.state === 'current'));
  assert.equal(projection.actions.some(action => /run the machine check again/.test(action.reason)), false);
});

test('a repair with no earlier machine check has an unknown precondition and an unapplied operation is not a repair claim', () => {
  const w = world();
  const orphan = w.repair({ before: null, after: [tls('passed')] });
  const { projection } = readinessReport({ records: [orphan] });
  assert.equal(attemptFor(projection, 'npm', 'npm/tls/node').reason, 'unknown-precondition');
  const w2 = world();
  const before = w2.machine([tls('failed')]);
  const notApplied = w2.repair({ before, applied: [['failed', 'unverified']], after: [tls('passed')] });
  const attempt = attemptFor(readinessReport({ records: [before, notApplied] }).projection, 'npm', 'npm/tls/node');
  assert.equal(attempt.repair, null);
  assert.equal(attempt.counted, false);
});

test('the score keeps unknown checks in the denominator and lists failed checks even when it is high', () => {
  const w = world();
  const passing = Array.from({ length: 19 }, (_, index) => check(`jq/probe${index}`, 'jq', 'passed'));
  const high = readinessReport({ records: [w.machine([...passing, check('npm/version', 'npm', 'failed')])] }).projection;
  assert.equal(scoreOf(high).score, 95);
  assert.equal(scoreOf(high).failed.length, 1);
  const panels = reportPanels(high);
  assert.equal(panels.score.value, '95%');
  assert.match(panels.score.summary, /Check set aih-ui\/machine-check 1\.0\.0 · method configuration-check-score 1\.0\.0\./);
  assert.match(reportText(high), /^Configuration-check score\n95%\n19 of 20 checks passed/m, 'the headline value is printed');
  assert.match(panels.score.items[0].text, /^Failed: npm\/version on npm/);
  const mixed = readinessReport({ records: [world().machine([check('npm/version', 'npm', 'passed'), check('jq/version', 'jq', 'failed'),
    check('npm/tls/node', 'npm', 'skipped', 'network-off'), check('jq/tls', 'jq', 'unavailable', 'deadline')])] }).projection;
  assert.deepEqual([scoreOf(mixed).numerator, scoreOf(mixed).denominator, scoreOf(mixed).score], [1, 4, 25]);
  assert.deepEqual(scoreOf(mixed).counts, { passed: 1, failed: 1, unknown: 2, inapplicable: 0 });
  assert.match(reportPanels(mixed).claims.items.map(entry => entry.details.join('\n')).join('\n'), /Value: Unavailable — network-off/);
});

test('a client loading observation is an unknown claim that stays in the denominator', () => {
  const result = inspection([check('npm/version', 'npm', 'passed')], { observations: [{ id: 'claude/loading', target: 'claude', detail: 'Observed; loading not verified.' }] });
  const record = { schema: READINESS_RECORD_SCHEMA, id: 'machine-x', kind: 'machine-check', capturedAt: '2026-10-15T10:00:01.000Z', sha256: sha(result), core: null, check: projectInspection(result) };
  const { projection } = readinessReport({ records: [record] });
  assert.equal(scoreOf(projection).denominator, 2);
  assert.equal(scoreOf(projection).score, 50);
  const loading = projection.claims.find(claim => claim.id.endsWith('/claude/loading'));
  assert.equal(loading.kind, 'unknown');
  assert.equal(loading.unknownReason, 'loading-unverified');
  assert.equal(loading.value, undefined);
});

test('with no machine check the score is Unavailable, not 0, and the report still renders', () => {
  const { projection } = readinessReport({});
  assert.equal(scoreOf(projection), undefined);
  assert.equal(repairCount(projection).count, 0);
  assert.equal(reportPanels(projection).score.value, 'Unavailable');
  assert.doesNotMatch(reportText(projection), /\b0%/);
  const empty = readinessReport({ records: [world().machine([])] }).projection;
  assert.equal(scoreOf(empty).score, null);
  assert.equal(reportPanels(empty).score.value, 'Unavailable');
});

test('older machine checks are recheck-needed and only the latest one feeds the score and blockers', () => {
  const w = world();
  const first = w.machine([tls('failed'), check('jq/version', 'jq', 'failed')]);
  const second = w.machine([tls('passed'), check('jq/version', 'jq', 'passed')]);
  const { projection } = readinessReport({ records: [second, first] });
  assert.equal(scoreOf(projection).score, 100);
  assert.equal(projection.actions.filter(action => action.category === 'blocker').length, 0);
  const olderClaims = projection.claims.filter(claim => claim.sources.some(source => source.id === first.id));
  assert.ok(olderClaims.length > 0);
  assert.ok(olderClaims.every(claim => claim.applicability.state === 'recheck-needed'));
  assert.ok(projection.claims.filter(claim => claim.sources.some(source => source.id === second.id)).every(claim => claim.applicability.state === 'current'));
  const text = reportText(projection);
  assert.match(text, /Freshness: Recheck needed — A later machine check exists\. Captured 2026-10-15T10:00:0\d\.000Z/);
});

test('estimated context, observed usage and file size stay separate; missing usage is Unavailable, not 0', () => {
  const estimate = { subject: { kind: 'instruction-set', id: 'project-instructions' }, amount: 400, unit: 'tokens', method: { id: 'chars-over-four', version: '1.0.0' },
    source: { id: 'estimate-1', schema: 'urn:aih-ui:estimate:1.0.0' }, observation: 'estimate-1#tokens', capturedAt: '2026-10-15T09:00:00.000Z' };
  const without = readinessReport({ estimates: [estimate] });
  assert.equal(validateClaimSet(without.claimSet).valid, true);
  const estimated = without.projection.claims.find(claim => claim.measure === 'configured-context');
  assert.deepEqual([estimated.kind, estimated.value, estimated.method], ['estimated', { amount: 400, unit: 'tokens' }, { id: 'chars-over-four', version: '1.0.0' }]);
  const none = without.projection.claims.filter(claim => claim.measure === 'observed-usage');
  assert.equal(none.length, 1);
  assert.equal(none[0].kind, 'unknown');
  assert.match(none[0].unknownReason, /no client usage/i);
  const panels = reportPanels(without.projection);
  assert.match(panels.context.sections.find(section => section.id === 'observed-usage').summary, /^Unavailable/);
  assert.doesNotMatch(reportText(without.projection), /Value: 0\b/);

  const withUsage = readinessReport({ estimates: [estimate], usage: [{ ...estimate, amount: 280, observation: 'usage-1#tokens', source: { id: 'usage-1', schema: 'urn:aih-ui:usage:1.0.0' } }] });
  const usage = withUsage.projection.claims.filter(claim => claim.measure === 'observed-usage');
  assert.deepEqual(usage.map(claim => [claim.kind, claim.value]), [['measured', { amount: 280, unit: 'tokens' }]]);
  assert.equal(withUsage.projection.calculations.filter(entry => entry.method.id === 'context-change').length, 0, 'estimate is never compared with usage');
  const sections = reportPanels(withUsage.projection).context.sections;
  assert.match(sections.find(section => section.id === 'configured-context').items[0].details.join('\n'), /Value: 400 tokens/);
  assert.match(sections.find(section => section.id === 'observed-usage').items[0].details.join('\n'), /Value: 280 tokens/);
});

const supplied = { subject: { kind: 'instruction-set', id: 'project-instructions' }, amount: 400, unit: 'tokens', method: { id: 'chars-over-four', version: '1.0.0' },
  source: { id: 'estimate-1', schema: 'urn:aih-ui:estimate:1.0.0' }, observation: 'estimate-1#tokens', capturedAt: '2026-10-15T09:00:00.000Z' };
const identities = claimSet => claimSet.claims.map(claim => `${claim.id}@${claim.revision}`).sort();

test('identical supplied entries collapse; entries that differ stay distinct claims of one event, a Core conflict', () => {
  for (const [key, measure] of [['estimates', 'configured-context'], ['usage', 'observed-usage']]) {
    const once = readinessReport({ [key]: [supplied] });
    const same = readinessReport({ [key]: [supplied, JSON.parse(JSON.stringify(supplied))] });
    assert.deepEqual(identities(same.claimSet), identities(once.claimSet), `${key}: the same entry twice is one claim`);
    assert.equal(same.projection.observations.conflicts.length, 0);

    const other = { ...supplied, amount: 500 };
    const differing = readinessReport({ [key]: [supplied, other] });
    assert.equal(validateClaimSet(differing.claimSet).valid, true, JSON.stringify(validateClaimSet(differing.claimSet).errors));
    const found = differing.projection.claims.filter(claim => claim.measure === measure);
    assert.deepEqual(found.map(claim => claim.value.amount).sort(), [400, 500], `${key}: both amounts stay visible`);
    assert.equal(new Set(found.map(claim => claim.observation)).size, 1, 'one event');
    assert.equal(new Set(found.map(claim => `${claim.id}@${claim.revision}`)).size, 2, 'two claim identities');
    assert.deepEqual(differing.projection.observations.conflicts.map(entry => entry.claims.length), [2]);
    assert.ok(found.every(claim => claim.dedup.status === 'conflict'));
    assert.match(reportText(differing.projection), /Conflicting records for one event/);
    const swapped = readinessReport({ [key]: [other, supplied] });
    assert.deepEqual(identities(swapped.claimSet), identities(differing.claimSet), `${key}: identity does not depend on input order`);
  }
});

test('supplied ids that carry a machine-local path are refused before any claim is built', () => {
  const paths = ['/home/alice/private/AGENTS.md', 'C:\\Users\\x\\AGENTS.md', 'C:/x/AGENTS.md', '\\\\server\\share\\AGENTS.md', '~/x/AGENTS.md', 'file:///home/alice/AGENTS.md'];
  const variants = path => [
    { ...supplied, subject: { kind: 'instruction-set', id: path } },
    { ...supplied, scope: { kind: 'repository', targets: [path] } },
    { ...supplied, source: { ...supplied.source, id: path } },
    { ...supplied, source: { ...supplied.source, schema: path } },
    { ...supplied, observation: path },
  ];
  for (const path of paths) for (const key of ['estimates', 'usage']) for (const entry of variants(path)) {
    assert.throws(() => readinessClaimSet({ [key]: [entry] }), error => error instanceof TypeError && !/alice|Users|server|\.md/.test(error.message), `${key}: ${path}`);
  }
  for (const key of ['estimates', 'usage']) assert.doesNotThrow(() => readinessClaimSet({ [key]: [{ ...supplied, scope: { kind: 'repository', targets: ['docs/AGENTS.md', 'https://example.com/a'] } }] }));
});

test('an invalid claim set is refused by the claim-set builder instead of being returned unvalidated', () => {
  const bad = { ...supplied, coverage: { state: 'bogus', reason: 'x' } };
  assert.throws(() => readinessClaimSet({ estimates: [bad] }), /not valid/);
  assert.throws(() => readinessReport({ estimates: [bad] }), /not valid/);
});

test('file size from a real Scan report read is one measured bytes claim', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aih-claims-scan-'));
  try {
    await writeFile(join(root, 'AGENTS.md'), 'hello world\n');
    await writeFile(join(root, 'CLAUDE.md'), '@AGENTS.md\n');
    const scanned = await runScan({ schema: 'urn:aihq:scan:request:1.0.0', source: { kind: 'local', path: root },
      selection: { paths: ['AGENTS.md', 'CLAUDE.md'], excludedPaths: [] }, detectors: [{ detectorId: 'detector.aih-binding-gate', configuration: {} }] });
    assert.equal(scanned.status, 'assessment', JSON.stringify(scanned));
    const artifact = await prepareArtifact({ report: scanned.report, annexes: scanned.annexes.map(a => ({ id: a.id, bytes: Buffer.from(a.bytesBase64, 'base64') })) });
    const read = await readArtifact(artifact.bytes);
    assert.equal(read.status, 'read');
    const { claimSet, projection } = readinessReport({ scanReports: [read, read, { status: 'invalid', diagnostics: [] }] });
    assert.equal(validateClaimSet(claimSet).valid, true, JSON.stringify(validateClaimSet(claimSet).errors));
    const size = projection.claims.filter(claim => claim.measure === 'file-size');
    assert.equal(size.length, 1, 'a re-read is one claim; an unsupported read is not a claim');
    assert.deepEqual([size[0].kind, size[0].value], ['measured', { amount: 23, unit: 'bytes' }]);
    assert.deepEqual(size[0].sources, [{ id: read.scanId, schema: read.report.schema, sha256: read.scanId.replace('scan:sha256:', '') }]);
    assert.match(reportPanels(projection).context.sections.find(section => section.id === 'file-size').items[0].details.join('\n'), /Value: 23 bytes/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('headless text is built only from the strings of the UI panels', () => {
  const w = world();
  const before = w.machine([tls('failed'), check('jq/version', 'jq', 'failed'), check('git/version', 'git', 'passed')], { targets: ['npm', 'jq', 'git'] });
  const repaired = w.repair({ before, after: [tls('passed')] });
  const later = w.machine([tls('passed'), check('jq/version', 'jq', 'passed')]);
  const { projection } = readinessReport({ records: [before, repaired, later, repaired],
    estimates: [{ subject: { kind: 'instruction-set', id: 'p' }, amount: 10, unit: 'tokens', method: { id: 'm', version: '1' }, source: { id: 'e', schema: 'urn:aih-ui:estimate:1.0.0' },
      observation: 'e#1', capturedAt: '2026-10-15T09:00:00.000Z' }] });
  const panels = reportPanels(projection), text = reportText(projection);
  const strings = value => [value.title, value.value, value.summary, ...value.items.flatMap(entry => [entry.text, ...entry.details]), ...(value.sections ?? []).flatMap(strings)];
  const meanings = [...new Set(Object.values(panels).flatMap(strings).filter(Boolean))].sort((a, b) => b.length - a.length);
  assert.ok(meanings.length > 20);
  for (const meaning of meanings) assert.ok(text.includes(meaning), `reportText lacks: ${meaning}`);
  let rest = text;
  for (const meaning of meanings) rest = rest.split(meaning).join('');
  assert.match(rest, /^[\s-]*$/, 'reportText adds no words of its own');
});

test('invalid input is refused rather than rendered', () => {
  assert.throws(() => readinessClaimSet({ records: [{ schema: 'urn:other', id: 'x', kind: 'machine-check' }] }), /readiness record/i);
  assert.throws(() => readinessClaimSet({ records: [{ schema: READINESS_RECORD_SCHEMA, id: 'x', kind: 'mystery' }] }), /readiness record/i);
});
