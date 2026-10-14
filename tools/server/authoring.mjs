// Reuse the installed application's authoring host; it owns validation and grants.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';

export async function createAuthoringAdapter(consumerDir) {
  const { startConsumer } = await import(pathToFileURL(join(consumerDir, 'consumer/server.mjs')).href);
  const selectedJson = async name => process.env[name] ? JSON.parse(await readFile(process.env[name], 'utf8')) : undefined;
  const host = await startConsumer({ projectRoot: process.env.AIH_CONSUMER_PROJECT,
    controls: await selectedJson('AIH_CONSUMER_CONTROLS'),
    organizationSource: await selectedJson('AIH_ORGANIZATION_SOURCE'),
    reviewTrust: await selectedJson('AIH_REVIEW_TRUST'),
    previousCatalogRoot: process.env.AIH_CONSUMER_PREVIOUS_CATALOG });
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
