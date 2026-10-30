// Native-verification results for the friction and improvement checks, in the shape Core's own validator accepts
// (`validateNativeVerificationResult`; the adapter reads only a result Core accepts, stored-results.mjs). No package publishes a
// verified result to read instead, so a verified one is assembled here with its two recorded sessions and consistent digests;
// the digests are placeholders and prove nothing about a real run. A failed or unverified one records no session.
const NATIVE_SCHEMA = 'urn:aihq:core:native-verification-result:1.0.0';
const CORE = { name: '@aihq/core', version: '1.0.0-dev.47' };
const H = c => c.repeat(64);
const STAGED = H('f');
const match = { kind: 'match', matched: true }, digest = sha256 => ({ kind: 'digest', sha256 });
const sessionStages = session => [['session-freshness', match], ['loading-mode', match], ['tool-restrictions', match], ['provider-authentication', match],
  ['tool-discovery', { kind: 'counts', count: 1 }], ['instruction-loading', match], ['read-only-query', digest(H('a'))], ['isolation', match], ['cleanup', { kind: 'none' }]]
  .map(([id, evidence]) => ({ id, session, outcome: 'passed', reason: 'observed', evidence }));
const limits = (sessionsStarted, stagesCompleted) => ({ budgetMs: 1000, elapsedMs: 1, sessionsStarted, stagesCompleted, observedBytes: 0, telemetryEvents: 0, rpcMessages: 0, evidenceTruncated: false });
const common = (verdict, client, platform) => ({ schema: NATIVE_SCHEMA, package: { ...CORE }, verdict, proofScope: 'test-configuration', admission: 'admitted', platform: { ...platform },
  authority: 'not-evaluated', survivingProcesses: [], diagnostics: [] });

export const NATIVE_PLATFORM = Object.freeze({ os: 'win32', arch: 'x64', osRelease: '10.0', execution: 'native' });

/** A native-verification result with this verdict ('verified', 'failed' or 'unverified') for this client id (or null). */
export function nativeResult(verdict, client = 'claude', platform = NATIVE_PLATFORM) {
  if (verdict !== 'verified') return { ...common(verdict, client, platform), status: verdict === 'unverified' ? 'incomplete' : 'complete',
    client: { id: client, observedVersion: null }, adapter: null, content: null, sessions: [],
    stages: [{ id: 'fixture-integrity', session: null, outcome: 'failed', reason: 'fixture-bytes-mismatch', evidence: { kind: 'none' } }],
    security: { sandbox: { level: 'not-started', mechanism: null, reason: 'none' }, hostSecretIsolation: { outcome: 'unavailable', reason: 'none' } },
    cleanup: { processes: 'not-created', files: 'not-created', retainedCell: null }, limits: limits(0, 1) };
  return { ...common(verdict, client, platform), status: 'complete', client: { id: client, observedVersion: '1.0.0' }, adapter: { id: 'fixture-adapter', sha256: H('b') },
    content: { bundleId: 'fixture-bundle', manifestSha256: H('c'), archiveSha256: H('9'), outputTreeSha256: H('d'), guardrailsSha256: H('e'), stagedConfigurationDigest: STAGED },
    sessions: [1, 2].map(index => ({ index, process: { pid: 100 + index, clientSessionId: `session-${index}` }, launchArgvDigest: H('1'), stagedConfigurationDigest: STAGED,
      challengeSha256: H(String(index + 4)), stages: sessionStages(index) })),
    stages: [['fixture-integrity', null, 'observed', digest(H('3'))], ['host-presence', null, 'observed', { kind: 'none' }], ['identity-binding', null, 'observed', match],
      ['cell-staging', null, 'observed', digest(STAGED)], ['session-start', 1, 'observed', { kind: 'none' }], ['configuration-unchanged', 2, 'before-session-2', digest(STAGED)],
      ['session-start', 2, 'observed', { kind: 'none' }], ['configuration-unchanged', 2, 'after-session-2', digest(STAGED)], ['cleanup', null, 'observed', { kind: 'none' }]]
      .map(([id, session, reason, evidence]) => ({ id, session, outcome: 'passed', reason, evidence })),
    security: { sandbox: { level: 'observed-os-boundary', mechanism: 'fixture-sandbox', reason: 'observed' }, hostSecretIsolation: { outcome: 'passed', reason: 'observed' } },
    cleanup: { processes: 'confirmed', files: 'removed', retainedCell: null }, limits: limits(2, 27) };
}
