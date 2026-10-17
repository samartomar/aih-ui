// Where an owner-testing candidate keeps everything. One data directory holds the candidate's account home, its client
// homes, host configuration, sample data, temporary files, logs and reports; nothing is written outside it except the
// browser's own profile and downloads. Every path is derived from the data directory, so the launcher, the server
// process, reset and report agree.
import { join, resolve } from 'node:path';

export const DATA_MARKER_SCHEMA = 'urn:aih-ui:candidate-data:1.0.0';
export const MANIFEST_SCHEMA = 'urn:aih-ui:candidate-manifest:1.0.0';
export const DEFAULT_PORT = 4300;
// The ordinary preview's default port (tools/preview.mjs).
export const RESERVED_PORTS = Object.freeze([4173]);

export function candidateLayout(dataDir) {
  const root = resolve(dataDir);
  const config = join(root, 'config'), samples = join(root, 'samples'), state = join(root, 'state'), logs = join(root, 'logs');
  const continuity = join(samples, 'continuity'), repositories = join(samples, 'repositories');
  const sampleWeb = join(repositories, 'sample-web'), sampleApi = join(repositories, 'sample-api');
  return Object.freeze({
    root,
    marker: join(root, 'candidate.json'),
    manifest: join(root, 'manifest.json'),
    // Rebuilt by every start: the installed consumer and the served page.
    run: join(root, 'run'),
    // The candidate's account home: Core keeps its records under home/.aih/core.
    home: join(root, 'home'),
    config,
    settings: join(config, 'settings.json'),
    organizationSource: join(config, 'organization-source.json'),
    maintenanceSource: join(config, 'maintenance-source.json'),
    readinessRepairs: join(config, 'readiness-repairs.json'),
    // Written at start while the TLS-interception condition is staged: the repair offer that goes with it (tls-interception.mjs).
    stagedRepairs: join(config, 'readiness-repairs-staged.json'),
    batchHost: join(config, 'batch-host.json'),
    samples,
    projects: join(samples, 'projects'),
    personalProject: join(samples, 'projects', 'sample-js-app'),
    savedIntents: join(samples, 'saved-intents'),
    maintenanceDraft: join(samples, 'saved-intents', 'sample-maintenance-draft.json'),
    repositories,
    sampleWeb,
    sampleApi,
    authority: join(samples, 'authority'),
    readiness: join(samples, 'readiness'),
    continuity,
    batchEnvelope: join(continuity, 'batch-envelope.json'),
    // The two controlled client configuration folders the continuity sample uses: one inside each sample checkout.
    clients: Object.freeze({ claude: join(sampleWeb, '.claude'), codex: join(sampleApi, '.codex') }),
    // A condition the owner stages on purpose: today only TLS interception, with its generated sample CA and certificate.
    stagedTls: join(root, 'staged', 'tls-interception'),
    // Temporary files of the server process (and every process it starts) land here, not in the account's.
    tmp: join(root, 'tmp'),
    state,
    server: join(state, 'server.json'),
    stopRequest: join(state, 'stop-request'),
    realHomeGuard: join(state, 'real-home-guard.json'),
    logs,
    serverLog: join(logs, 'server.log'),
    authorityLog: join(logs, 'authority-transport.log'),
    tlsLog: join(logs, 'tls-interception.log'),
    checks: join(logs, 'checks'),
    reports: join(root, 'reports'),
  });
}
