import { callServiceAsync } from './service-client.mjs';

export async function createApprovedAdapter(consumerDir) {
  const published = await callServiceAsync(consumerDir, { op: 'approvedCatalog' });
  if (!published.ok) throw new Error(`Catalog interface could not load: ${published.error}`);
  if (published.state === 'legacy') return null;
  const items = new Map(published.items.map(item => [item.id, item]));
  const catalog = { ...published, items: published.items.map(({ scanKey, ...item }) => item) };
  const reply = (response, status, value) => response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
  }).end(JSON.stringify(value));
  return {
    catalog: () => catalog,
    close() {},
    async handle(request, response, pathname) {
      if (pathname !== '/api/repository-scan' && pathname !== '/api/approved-evidence' && !pathname.startsWith('/api/authoring-')) return false;
      const host = request.headers.host;
      if (![`127.0.0.1:${request.socket.localPort}`, `localhost:${request.socket.localPort}`].includes(host) ||
        request.headers['sec-fetch-site'] === 'cross-site' ||
        (request.headers.origin && request.headers.origin !== `http://${host}`)) {
        reply(response, 403, { status: 'refused', reason: 'Same-origin Workbench request required.' });
        return true;
      }
      if (pathname === '/api/repository-scan') {
        if (request.method !== 'POST' || request.headers['content-type'] !== 'application/json') {
          reply(response, 405, {reason:'Submit a folder from the Workbench.'});
          return true;
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 65536) { reply(response, 413, {reason:'Request too large.'}); return true; }
          chunks.push(chunk);
        }
        let folder;
        try {
          folder = JSON.parse(Buffer.concat(chunks)).folder;
        } catch {
          reply(response, 400, {reason:'Expected a JSON folder request.'});
          return true;
        }
        if (typeof folder !== 'string' || !folder.trim()) reply(response, 400, {reason:'Enter a folder path.'});
        else {
          const result = await callServiceAsync(consumerDir, {op:'repositoryScan', folder});
          reply(response, result.ok ? 200 : 422, result.ok ? result : {reason:'The local folder could not be scanned.'});
        }
        return true;
      }
      if (request.method === 'GET' && pathname === '/api/authoring-catalog') {
        reply(response, 200, catalog);
      } else if (request.method === 'GET' && pathname === '/api/approved-evidence') {
        const id = new URL(request.url, `http://${host}`).searchParams.get('item');
        const item = items.get(id);
        if (!item) reply(response, 404, { status: 'unavailable', reason: 'This exact Catalog item is unavailable.' });
        else {
          const result = await callServiceAsync(consumerDir, { op: 'approvedEvidence', scanKey: item.scanKey });
          reply(response, 200, result.ok ? result : { status: 'failed', reason: 'The Scan reader could not run.' });
        }
      } else reply(response, 409, { status: 'unavailable', reason: 'This Workbench host exposes read-only Catalog and evidence.' });
      return true;
    },
  };
}
