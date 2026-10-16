// Where an owner-testing candidate keeps everything. One data directory holds the candidate's account home, its client
// homes, host configuration, sample data, logs and reports; nothing is written outside it except the browser's own
// downloads. Every path is derived from the data directory, so the launcher, the server process, reset and report agree.
import { join, resolve } from 'node:path';

export const DATA_MARKER_SCHEMA = 'urn:aih-ui:candidate-data:1.0.0';
export const MANIFEST_SCHEMA = 'urn:aih-ui:candidate-manifest:1.0.0';
export const DEFAULT_PORT = 4300;
// The ordinary preview's default port (tools/preview.mjs).
export const RESERVED_PORTS = Object.freeze([4173]);

export function candidateLayout(dataDir) {
  const root = resolve(dataDir);
  const config = join(root, 'config'), samples = join(root, 'samples'), state = join(root, 'state'), logs = join(root, 'logs');
  const continuity = join(samples, 'continuity');
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
    batchHost: join(config, 'batch-host.json'),
    samples,
    projects: join(samples, 'projects'),
    personalProject: join(samples, 'projects', 'sample-js-app'),
    savedIntents: join(samples, 'saved-intents'),
    repositories: join(samples, 'repositories'),
    authority: join(samples, 'authority'),
    readiness: join(samples, 'readiness'),
    continuity,
    batchEnvelope: join(continuity, 'batch-envelope.json'),
    // The two controlled client configuration homes the continuity sample creates.
    clients: Object.freeze({ claude: join(continuity, 'home-a', '.claude'), codex: join(continuity, 'home-b', '.codex') }),
    state,
    server: join(state, 'server.json'),
    stopRequest: join(state, 'stop-request'),
    realHomeGuard: join(state, 'real-home-guard.json'),
    logs,
    serverLog: join(logs, 'server.log'),
    authorityLog: join(logs, 'authority-transport.log'),
    checks: join(logs, 'checks'),
    reports: join(root, 'reports'),
  });
}
