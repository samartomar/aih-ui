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
  const [{ noteFixture }, { intakeDeclaration, digestBytes }] = await Promise.all([load('note-fixture.mjs'), load('intake.mjs')]);
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

export async function createAuthoringAdapter(consumerDir) {
  const { startConsumer } = await import(pathToFileURL(join(consumerDir, 'consumer/server.mjs')).href);
  const selectedJson = async name => process.env[name] ? JSON.parse(await readFile(process.env[name], 'utf8')) : undefined;
  const host = await startConsumer({ projectRoot: process.env.AIH_CONSUMER_PROJECT,
    controls: await selectedJson('AIH_CONSUMER_CONTROLS'),
    organizationSource: await selectedJson('AIH_ORGANIZATION_SOURCE'),
    reviewTrust: await selectedJson('AIH_REVIEW_TRUST'),
    previousCatalogRoot: process.env.AIH_CONSUMER_PREVIOUS_CATALOG,
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
