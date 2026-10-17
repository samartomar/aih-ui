import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CLAIMS_SCHEMA_1_1_0, CLAIMS_PROJECTION_SCHEMA_1_1_0, validateClaimSet } from '@aihq/core/report';
import { validateNativeVerificationResult } from '@aihq/core/contracts';
import { frictionRecurrence, FILE_STATE_SCHEMA, NATIVE_SCHEMA, FRICTION_PRODUCER } from './friction.mjs';
import { READINESS_RECORD_SCHEMA } from './claims.mjs';

// The adapter reads stored Core results the host holds and asks Core's recurrence method; these tests build full result objects.
const T = ['2026-10-10T09:00:00Z', '2026-10-11T09:00:00Z', '2026-10-12T09:00:00Z', '2026-10-13T09:00:00Z', '2026-10-14T09:00:00Z'];
const SEL = 'catalog-aaaa', MID = 'project--aihq.catalog--mattpocock.implement', CORE = { name: '@aihq/core', version: '1.0.0-dev.37' };
const tie = (kind, key, extra = {}) => ({ kind, key, itemId: 'mattpocock.implement', rootItemId: 'mattpocock.implement', label: 'Implement', scope: 'project', ...extra });
const selectionTie = tie('managed-selection', MID, { selectionId: SEL, goal: 'ship it' }), clientTie = tie('client', 'claude', { itemId: 'aihq.client.claude' }), targetTie = tie('target', 'git');
const sha = n => String(n).repeat(64).slice(0, 64);

const fileState = targets => ({ schema: FILE_STATE_SCHEMA, package: { ...CORE }, status: 'complete', fileState: 'unverified', authority: 'not-evaluated',
  targets: targets.map(({ selection = SEL, outcome, reason }, index) => ({ id: `target-${index}`, operationIds: [`${selection}/write`], target: { root: 'project', path: 'CLAUDE.md' }, outcome, reason: reason ?? outcome })),
  checks: [], notChecked: [], coverage: { comparedTargets: targets.length, unavailableTargets: 0, comparedChecks: 0, unavailableChecks: 0, notChecked: 0 }, diagnostics: [],
  limits: { budgetMs: 1000, elapsedMs: 1, targetBytes: 0, materialBytes: 0 } });
const files = (...outcomes) => fileState(outcomes.map(outcome => ({ outcome })));
// A schema-valid failed result; a verified one is the same shape with the other verdict (a real proof carries two full sessions, which this adapter never reads).
const native = (verdict, client = 'claude') => ({ schema: NATIVE_SCHEMA, package: { ...CORE }, status: verdict === 'unverified' ? 'incomplete' : 'complete', verdict, proofScope: 'test-configuration', admission: 'admitted',
  client: { id: client, observedVersion: null }, adapter: null, platform: { os: 'win32', arch: 'x64', osRelease: '10.0', execution: 'native' }, content: null, sessions: [],
  stages: [{ id: 'fixture-integrity', session: null, outcome: verdict === 'verified' ? 'passed' : 'failed', reason: verdict === 'verified' ? 'observed' : 'fixture-bytes-mismatch', evidence: { kind: 'none' } }],
  security: { sandbox: { level: 'not-started', mechanism: null, reason: 'none' }, hostSecretIsolation: { outcome: 'unavailable', reason: 'none' } }, authority: 'not-evaluated', survivingProcesses: [],
  cleanup: { processes: 'not-created', files: 'not-created', retainedCell: null }, diagnostics: [],
  limits: { budgetMs: 1000, elapsedMs: 1, sessionsStarted: 0, stagesCompleted: 1, observedBytes: 0, telemetryEvents: 0, rpcMessages: 0, evidenceTruncated: false } });
const readiness = (id, items) => ({ schema: READINESS_RECORD_SCHEMA, kind: 'machine-check', id, sha256: sha(id.length), capturedAt: T[0], check: { status: 'complete', items } });
const probe = (outcome, extra = {}) => ({ kind: 'check', id: 'on-path', target: 'git', outcome, reason: outcome, ...extra });
const entry = (id, at, result, extra = {}) => ({ id, capturedAt: at, result, ...extra });
const recurring = [entry('cap-1', T[0], files('changed')), entry('cap-2', T[1], files('match')), entry('cap-3', T[2], files('changed'))];
const run = (evidence, subjects = [selectionTie]) => frictionRecurrence({ evidence, subjects });

test('file-state results become claims 1.1.0 and Core reports the recurrence', () => {
  const { claimSet, projection, results, unread } = run(recurring);
  assert.equal(claimSet.schema, CLAIMS_SCHEMA_1_1_0); assert.equal(projection.schema, CLAIMS_PROJECTION_SCHEMA_1_1_0); assert.equal(validateClaimSet(claimSet).valid, true); assert.equal(unread, 0);
  assert.deepEqual(claimSet.calculations.map(c => [c.method, c.version, c.subject, c.condition, c.observations.length]), [['recurrence', '1.0.0', { kind: 'managed-selection', id: MID }, 'condition:file-state', 3]]);
  assert.deepEqual(claimSet.claims.map(c => [c.sources[0].id, c.measure, c.kind, c.value?.amount, c.value?.unit, c.capturedAt]),
    [['cap-1', 'condition:file-state', 'measured', 'failed', 'outcome', T[0]], ['cap-2', 'condition:file-state', 'measured', 'passed', 'outcome', T[1]], ['cap-3', 'condition:file-state', 'measured', 'failed', 'outcome', T[2]]]);
  const [first] = claimSet.claims;
  assert.deepEqual(first.producer, FRICTION_PRODUCER); assert.equal(first.recordSchema, FILE_STATE_SCHEMA); assert.deepEqual(first.subject, { kind: 'managed-selection', id: MID });
  assert.deepEqual(first.scope, { kind: 'repository', targets: [MID] }); assert.deepEqual(first.sources, [{ id: 'cap-1', schema: FILE_STATE_SCHEMA }]);
  assert.equal(first.observation, `cap-1/${MID}/condition:file-state`); assert.equal('method' in first, false); assert.deepEqual(first.authentication, { status: 'not-authenticated' });
  assert.equal(new Set(claimSet.claims.map(c => c.revision)).size, 3);
  const [{ result, stored, fixture, tie: tied, subject, condition }] = results;
  assert.deepEqual([result.method, result.status, result.reason, result.count, stored, fixture, tied, subject, condition],
    [{ id: 'recurrence', version: '1.0.0' }, 'available', null, 1, 3, false, selectionTie, { kind: 'managed-selection', id: MID }, 'condition:file-state']);
  assert.deepEqual(result.timeline.map(t => [t.outcome, t.role]), [['failed', 'failure'], ['passed', 'recovery'], ['failed', 'recurrence']]);
  assert.equal(result.recurrences.length, 1); assert.equal(result.deduplication.status, 'established');
  // A user-scope selection's claims are user content; the id given by the host's stored result is kept as the source.
  assert.equal(run(recurring, [{ ...selectionTie, scope: 'user' }]).claimSet.claims[0].scope.kind, 'user-content');
});

test('a capture folds to one outcome per selection: any changed or absent target fails, all matching passes, anything else is unknown', () => {
  const folded = (...targets) => run([entry('cap-1', T[0], fileState(targets))]).claimSet.claims;
  const outcome = claims => claims.length === 1 ? claims[0].kind === 'unknown' ? ['unknown', claims[0].unknownReason] : [claims[0].value.amount] : claims.length;
  assert.deepEqual(outcome(folded({ outcome: 'changed' }, { outcome: 'match' })), ['failed']);
  assert.deepEqual(outcome(folded({ outcome: 'absent' }, { outcome: 'match' })), ['failed']);
  assert.deepEqual(outcome(folded({ outcome: 'match' }, { outcome: 'match' })), ['passed']);
  assert.deepEqual(outcome(folded({ outcome: 'match' }, { outcome: 'unavailable', reason: 'target-unreadable' })), ['unknown', 'target-unreadable']);
  assert.deepEqual(outcome(folded({ outcome: 'unavailable', reason: 'C:\\Users\\a\\b' })), ['unknown', 'unavailable']);
  assert.equal(folded({ outcome: 'unavailable' })[0].value, undefined);
  // Targets of another selection, and a result with no target of this one, make no claim.
  assert.equal(folded({ selection: 'catalog-other', outcome: 'changed' }).length, 0);
  assert.equal(run([entry('cap-1', T[0], fileState([]))]).claimSet.claims.length, 0);
  // Selection ids are matched as whole path segments of the operation id, so a longer id never matches a shorter one.
  assert.equal(folded({ selection: `${SEL}0`, outcome: 'changed' }).length, 0);
  // One passed and one failed target at one instant fold to one claim, so Core never sees a tie.
  const tied = run([entry('cap-1', T[0], fileState([{ outcome: 'changed' }, { outcome: 'match' }])), entry('cap-2', T[1], files('match')), entry('cap-3', T[2], files('changed'))]);
  assert.equal(tied.results[0].result.status, 'available'); assert.equal(tied.results[0].result.count, 1);
});

test('native verification results are claims on the client in its environment; an unidentified client makes none', () => {
  assert.equal(validateNativeVerificationResult(native('failed')).valid, true);
  const evidence = [entry('nv-1', T[0], native('failed')), entry('nv-2', T[1], native('verified')), entry('nv-3', T[2], native('failed'))];
  const { claimSet, results } = run(evidence, [clientTie]);
  assert.deepEqual(claimSet.claims.map(c => [c.subject, c.measure, c.value.amount, c.scope]), [0, 1, 2].map(i => [{ kind: 'client', id: 'claude@win32-native' }, 'condition:native-use', ['failed', 'passed', 'failed'][i], { kind: 'machine', targets: ['claude@win32-native'] }]));
  assert.deepEqual([results[0].result.status, results[0].result.count, results[0].subject], ['available', 1, { kind: 'client', id: 'claude@win32-native' }]);
  const unknown = run([entry('nv-1', T[0], native('unverified'))], [clientTie]).claimSet.claims;
  assert.deepEqual([unknown.length, unknown[0].kind, unknown[0].unknownReason, unknown[0].value], [1, 'unknown', 'unverified', undefined]);
  assert.equal(run([entry('nv-1', T[0], native('failed', null))], [clientTie]).claimSet.claims.length, 0);
  assert.equal(run([entry('nv-1', T[0], native('failed', 'codex'))], [clientTie]).claimSet.claims.length, 0);
  const wsl = { ...native('failed'), platform: { os: 'linux', arch: 'x64', osRelease: '6.1', execution: 'wsl2' } };
  assert.equal(run([entry('nv-1', T[0], wsl)], [clientTie]).claimSet.claims[0].subject.id, 'claude@linux-wsl2');
});

test('the Workbench stored inspect result (a machine check) gives one claim per tied check; unavailable and skipped are unknown', () => {
  const evidence = [entry('chk-1', T[0], readiness('chk-1', [probe('failed'), probe('passed', { id: 'version', target: 'node' }), { kind: 'observation', id: 'loaded', target: 'git', outcome: 'passed', reason: 'observed' }])),
    entry('chk-2', T[1], readiness('chk-2', [probe('passed')])), entry('chk-3', T[2], readiness('chk-3', [probe('failed')])), entry('chk-4', T[3], readiness('chk-4', [probe('skipped')]))];
  const { claimSet, results } = run(evidence, [targetTie]);
  assert.deepEqual(claimSet.claims.map(c => [c.subject, c.measure, c.kind === 'unknown' ? c.unknownReason : c.value.amount, c.scope.kind, c.recordSchema]),
    [['failed', 'passed', 'failed', 'skipped']].flatMap(([a, b, c, d]) => [a, b, c, d].map(v => [{ kind: 'target', id: 'git' }, 'condition:on-path', v, 'machine', READINESS_RECORD_SCHEMA])));
  assert.deepEqual(claimSet.claims.map(c => c.sources[0]), evidence.map((e, i) => ({ id: e.id, schema: READINESS_RECORD_SCHEMA })));
  assert.deepEqual([results.length, results[0].condition, results[0].result.count, results[0].result.timeline.at(-1).outcome], [1, 'condition:on-path', 1, 'unknown']);
});

test('a published check id keeps its path separator in the condition; control characters, local paths and oversized ids make no claim', () => {
  const claudeTie = tie('target', 'claude', { itemId: 'aihq.client.claude' }), version = outcome => probe(outcome, { id: 'claude/version', target: 'claude' });
  const evidence = ['failed', 'passed', 'failed'].map((outcome, index) => entry(`chk-${index + 1}`, T[index], readiness(`chk-${index + 1}`, [version(outcome)])));
  const { claimSet, results } = run(evidence, [claudeTie]);
  assert.equal(validateClaimSet(claimSet).valid, true);
  assert.deepEqual(claimSet.claims.map(c => [c.subject, c.measure, c.value.amount]), ['failed', 'passed', 'failed'].map(amount => [{ kind: 'target', id: 'claude' }, 'condition:claude/version', amount]));
  assert.deepEqual([results.length, results[0].condition, results[0].result.status, results[0].result.count], [1, 'condition:claude/version', 'available', 1]);
  for (const id of ['a\nb', 'a\u0000b', 'a\u007fb', 'C:\\Users\\a\\b', '/etc/passwd', '~/x', '', 'x'.repeat(129), 'a/'.repeat(80)]) {
    assert.equal(run([entry('chk-1', T[0], readiness('chk-1', [probe('failed', { id, target: 'claude' })]))], [claudeTie]).claimSet.claims.length, 0, JSON.stringify(id));
  }
});

test('the local-path refusal and the content fingerprint are claims.mjs\'s own, imported rather than copied', async () => {
  const claims = await import('./claims.mjs'), source = await readFile(new URL('./friction.mjs', import.meta.url), 'utf8');
  assert.equal(typeof claims.fingerprint, 'function'); assert.equal(typeof claims.isLocalPath, 'function');
  assert.equal(claims.fingerprint({ b: 1, a: [2] }), claims.fingerprint({ a: [2], b: 1 })); assert.match(claims.fingerprint({ a: 1 }), /^[0-9a-f]{16}$/);
  for (const path of ['C:\\Users\\a', '/home/a', '~/a', 'file:///a', '\\\\server\\share']) assert.equal(claims.isLocalPath(path), true, path);
  for (const stable of ['claude/version', 'cap-1', 'project--pkg--item']) assert.equal(claims.isLocalPath(stable), false, stable);
  assert.doesNotMatch(source, /const LOCAL_PATH\b/); assert.doesNotMatch(source, /function fingerprint\b/); assert.doesNotMatch(source, /const canonical\b/);
});

test('only tied subjects are requested; untied selections and results of another schema are ignored, never an error', () => {
  const mixed = [...recurring, entry('other', T[3], { schema: 'urn:aihq:core:run-result:1.0.0', status: 'complete' }), entry('odd', T[3], { notASchema: true })];
  const { claimSet, results, unread } = run(mixed);
  assert.equal(unread, 2); assert.equal(results.length, 1); assert.equal(claimSet.claims.length, 3);
  const none = run(mixed, []);
  assert.deepEqual([none.claimSet.claims.length, none.claimSet.calculations.length, none.results], [0, 0, []]);
  assert.equal(run(mixed, [{ ...selectionTie, key: 'project--aihq.catalog--other', selectionId: 'catalog-other' }]).results.length, 0);
  assert.deepEqual(run([]).results, []);
});

test('a duplicate import counts once; the same id with other content is a Core conflict, never a count', () => {
  const doubled = run([...recurring, recurring[0], recurring[2]]);
  assert.equal(doubled.claimSet.claims.length, 3); assert.equal(doubled.results[0].result.count, 1); assert.equal(doubled.results[0].stored, 3);
  // The digest the host gives names the claim's revision, so a re-import with it is the same claim.
  const hashed = [{ ...recurring[0], sha256: sha(7) }, recurring[1], recurring[2]], again = run([...hashed, hashed[0]]);
  assert.deepEqual([again.claimSet.claims.length, again.claimSet.claims[0].revision, again.claimSet.claims[0].sources[0].sha256], [3, sha(7), sha(7)]);
  assert.deepEqual([again.results[0].result.count, again.results[0].stored], [1, 3]);
  // The same id once with and once without a digest, or with other content, describes one event two ways: Core excludes both.
  const first = recurring[0], withDigest = { ...first, sha256: sha(7) };
  for (const pair of [[first, withDigest], [first, { ...first, result: files('match') }], [withDigest, { ...withDigest, result: files('match') }]]) {
    const conflicted = run(pair);
    assert.equal(conflicted.claimSet.claims.length, 2); assert.equal(conflicted.projection.observations.conflicts.length, 1);
    assert.deepEqual([conflicted.results[0].result.status, conflicted.results[0].result.reason, conflicted.results[0].result.conflicts.length], ['unavailable', 'no-history', 2]);
  }
});

test('missing history is never a count: failures without a verified recovery, unknown-only history and a recovery alone give no recurrence', () => {
  const statusOf = (...outcomes) => { const [r] = run(outcomes.map((o, i) => entry(`cap-${i}`, T[i], files(o)))).results; return [r.result.status, r.result.reason, r.result.count]; };
  assert.deepEqual(statusOf('changed', 'changed'), ['unavailable', 'no-recovery', null]);
  assert.deepEqual(statusOf('changed', 'match'), ['available', null, 0]);
  assert.deepEqual(statusOf('match'), ['unavailable', 'no-failure', null]);
  assert.deepEqual(statusOf('unavailable'), ['unavailable', 'no-history', null]);
  assert.deepEqual(statusOf('changed', 'match', 'changed', 'match', 'changed'), ['available', null, 2]);
});

test('a fixture entry marks the result it contributes to, and only that one', () => {
  const marked = run([recurring[0], { ...recurring[1], fixture: true }, recurring[2]]);
  assert.equal(marked.results[0].fixture, true);
  assert.equal(run(recurring).results[0].fixture, false);
  assert.equal(run([...recurring, entry('cap-x', T[3], native('failed'), { fixture: true })], [selectionTie, clientTie]).results.find(r => r.tie.kind === 'managed-selection').fixture, false);
});

test('supplied entries are validated and a machine-local path is refused before any claim is built', () => {
  const refused = (evidence, pattern) => assert.throws(() => run(evidence), pattern);
  for (const id of ['C:\\Users\\a\\result.json', '/home/a/result.json', '~/result.json', 'file:///a/b', '\\\\server\\share\\r']) refused([entry(id, T[0], files('changed'))], /machine-local path/);
  refused('x', /array/); refused(Array.from({ length: 257 }, (_, i) => entry(`cap-${i}`, T[0], files('match'))), /at most 256/);
  for (const bad of [{ ...recurring[0], capturedAt: '2026-10-10' }, { ...recurring[0], capturedAt: '2026-02-30T00:00:00Z' }, { ...recurring[0], id: '' }, { ...recurring[0], id: 'x'.repeat(129) }, { ...recurring[0], sha256: 'abc' },
    { ...recurring[0], fixture: 'yes' }, { ...recurring[0], extra: 1 }, { ...recurring[0], result: null }, { ...recurring[0], result: [] }, null]) refused([bad], /evidence\[0\]/);
  // The claim set carries no local path from a result either.
  const text = JSON.stringify(run([entry('cap-1', T[0], fileState([{ outcome: 'unavailable', reason: 'C:\\Users\\a\\b' }]))]).claimSet);
  assert.equal(/Users|[A-Za-z]:\\/.test(text), false);
});

test('the same evidence gives the same claim set, whatever the order it is supplied in, and the input is never changed', () => {
  const evidence = structuredClone(recurring), before = JSON.stringify(evidence), once = run(evidence), again = run([...evidence].reverse());
  assert.equal(JSON.stringify(evidence), before);
  assert.deepEqual(once.results.map(r => r.result), again.results.map(r => r.result));
  assert.deepEqual(once.projection, run(structuredClone(recurring)).projection);
  assert.deepEqual(once.claimSet.claims.map(c => c.id).sort(), again.claimSet.claims.map(c => c.id).sort());
});

test('friction.mjs reads no clock, network or file', async () => {
  const source = await readFile(new URL('./friction.mjs', import.meta.url), 'utf8');
  for (const forbidden of [/Date\.now/, /new Date\(\)/, /fetch\(/, /node:/, /Math\.random/, /\bprocess\b/]) assert.doesNotMatch(source, forbidden);
});
