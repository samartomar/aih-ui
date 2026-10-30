// Reuse the installed application's authoring host; it owns validation and grants.
import { delimiter, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile, stat } from 'node:fs/promises';

// Demonstration/test source only: it is labelled a test fixture and is never a real update source.
// Demo/test host input: a small JSON file { "revisions": ["updated"] } naming note-fixture variants to publish
// as newer revisions of the same `notes` input. Read at each check; anything unreadable is offline (null).
// `newer` is the `updated` content one version later: a second revision of the same package and item. `additional`
// is a different package and item, so it is offered as its own content, never as a revision of the review note.
// `expanded` is the same package one minor version later with two new notes, one relevant to a tests goal and one not.
const MAINTENANCE_SOURCE_BYTES = 4096, MAINTENANCE_REVISIONS = ['current', 'updated', 'newer', 'additional', 'expanded'];
async function fileMaintenanceSource(consumerDir, path) {
  const load = name => import(pathToFileURL(join(consumerDir, 'consumer', name)).href);
  const [{ noteFixture }, { intakeDeclaration }, { digestBytes }] = await Promise.all([load('note-fixture.mjs'), load('intake.mjs'), load('primitives.mjs')]);
  return async () => {
    try {
      if ((await stat(path)).size > MAINTENANCE_SOURCE_BYTES) return null;
      const { revisions } = JSON.parse(await readFile(path, 'utf8'));
      if (!Array.isArray(revisions) || revisions.length > 8 || revisions.some(name => !MAINTENANCE_REVISIONS.includes(name))) return null;
      return await Promise.all([...new Set(revisions)].map(async name => {
        const snapshot = await noteFixture(name === 'newer' ? 'updated' : name);
        if (name === 'newer') {
          const declaration = JSON.parse(new TextDecoder().decode(snapshot.declarationBytes));
          declaration.package.version = '1.0.2';
          snapshot.declarationBytes = new TextEncoder().encode(JSON.stringify(declaration));
        }
        const input = { id: 'notes', kind: 'local', locator: { input: 'notes' }, resolvedIdentity: { sha256: await digestBytes(snapshot.declarationBytes) } };
        const result = await intakeDeclaration({ input, ...snapshot, materialSource: { kind: 'local', input: 'notes' } });
        if (result.status !== 'ok') throw new Error('maintenance revision refused');
        return result.value;
      }));
    } catch { return null; }
  };
}

// Demo/test evidence is read afresh so a check sees only the host's current stored history.
// Force the fixture label at this boundary: imported captures cannot claim to be observations of this computer.
// The count bound is the friction adapter's own, so a file beyond it reads as unreadable (null) here instead of making the adapter refuse the check.
const FRICTION_EVIDENCE_BYTES = 262144;
export async function fileFrictionEvidence(consumerDir, path) {
  const { MAX_EVIDENCE } = await import(pathToFileURL(join(consumerDir, 'consumer', 'friction.mjs')).href);
  return async () => {
    try {
      if ((await stat(path)).size > FRICTION_EVIDENCE_BYTES) return null;
      const bytes = await readFile(path);
      if (bytes.length > FRICTION_EVIDENCE_BYTES) return null;
      const { entries } = JSON.parse(bytes.toString('utf8'));
      // `entries: null` is a host that keeps no history yet (undefined), not one whose store failed (null).
      if (entries === null) return undefined;
      if (!Array.isArray(entries) || entries.length > MAX_EVIDENCE || entries.some(entry => !entry || typeof entry !== 'object' || Array.isArray(entry))) return null;
      return entries.map(entry => ({ ...entry, fixture: true }));
    } catch { return null; }
  };
}

// The Workbench's own readiness journal is the friction input for the checks and repairs the person triggered. `records` is the readiness adapter's: the journal
// the readiness child holds in memory, undefined when this host holds none (the child never started) and null when it could not be read. Those records are
// observations of this computer, so unlike the demo file nothing is labelled a fixture; an empty journal is no history (undefined), never an empty list. The
// count bound is the friction adapter's own, so a journal beyond it reads as unreadable (null) instead of making the adapter refuse the check.
export async function journalFrictionEvidence(consumerDir, records) {
  const { MAX_EVIDENCE } = await import(pathToFileURL(join(consumerDir, 'consumer', 'friction.mjs')).href);
  return async () => {
    try {
      const held = await records();
      if (held === undefined) return undefined;
      if (!Array.isArray(held) || held.length > MAX_EVIDENCE || held.some(record => !record || typeof record !== 'object' || Array.isArray(record))) return null;
      return held.length === 0 ? undefined : held.map(record => ({ id: record.id, capturedAt: record.capturedAt, sha256: record.sha256, result: record }));
    } catch { return null; }
  };
}

// `frictionEvidence` (optional) is the host's own provider of stored Core results (journalFrictionEvidence). The demo file, when set, keeps precedence and stays fixture-labelled.
export async function createAuthoringAdapter(consumerDir, { frictionEvidence, coreState, frameworkFixtureInventories, suppliedInventories, installedFamilyInventories, createExecutionHost, installRecordRoot, setupSettingsPath } = {}) {
  const { startConsumer } = await import(pathToFileURL(join(consumerDir, 'consumer/server.mjs')).href);
  const selectedJson = async name => process.env[name] ? JSON.parse(await readFile(process.env[name], 'utf8')) : undefined;
  const evidence = process.env.AIH_FRICTION_EVIDENCE ? await fileFrictionEvidence(consumerDir, process.env.AIH_FRICTION_EVIDENCE) : frictionEvidence;
  const host = await startConsumer({ coreState, frameworkFixtureInventories, suppliedInventories, installedFamilyInventories, createExecutionHost, installRecordRoot, projectRoot: process.env.AIH_CONSUMER_PROJECT,
    controls: await selectedJson('AIH_CONSUMER_CONTROLS'),
    frameworkSources: await selectedJson('AIH_FRAMEWORK_SOURCES'),
    organizationSource: await selectedJson('AIH_ORGANIZATION_SOURCE'), setupSettingsPath,
    reviewTrust: await selectedJson('AIH_REVIEW_TRUST'),
    evidenceSources: await selectedJson('AIH_SCAN_EVIDENCE_SOURCES'),
    evidenceDetectorIds: await selectedJson('AIH_SCAN_EVIDENCE_PROVIDERS'),
    previousCatalogRoot: process.env.AIH_CONSUMER_PREVIOUS_CATALOG,
    ...(evidence ? { frictionEvidence: evidence } : {}),
    ...(process.env.AIH_UPDATE_SOURCE_CATALOG_ROOTS ? { updateSourceCatalogRoots: process.env.AIH_UPDATE_SOURCE_CATALOG_ROOTS.split(delimiter) } : {}),
    ...(process.env.AIH_MAINTENANCE_SOURCE ? { maintenanceSource: await fileMaintenanceSource(consumerDir, process.env.AIH_MAINTENANCE_SOURCE) } : {}) });
  return {
    catalog: async () => (await fetch(host.origin + '/api/authoring-catalog')).json(),
    close: () => host.server.close(),
    async handle(request, response, pathname) {
      if (!pathname.startsWith('/api/authoring-')) return false;
      const origin = `http://${request.headers.host}`;
      const allowed = [`127.0.0.1:${request.socket.localPort}`, `localhost:${request.socket.localPort}`];
      if (!allowed.includes(request.headers.host) || request.headers['sec-fetch-site'] === 'cross-site'
        || (request.headers.origin && request.headers.origin !== origin)
        || (request.method !== 'GET' && request.headers.origin !== origin)) {
        response.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Same-origin authoring request required.' }));
        return true;
      }
      const headers = { 'content-type': request.headers['content-type'] ?? 'application/json', origin: host.origin };
      if (request.headers['x-aih-client']) headers['x-aih-client'] = request.headers['x-aih-client'];
      const upstream = await fetch(host.origin + pathname, {
        method: request.method, headers,
        ...(request.method === 'POST' ? { body: request, duplex: 'half' } : {}),
      });
      response.writeHead(upstream.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(await upstream.text());
      return true;
    },
  };
}
