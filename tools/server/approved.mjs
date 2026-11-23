import { isAbsolute } from 'node:path';
import { createLocalCatalog } from '../workbench/local-catalog.mjs';
import { callServiceAsync } from './service-client.mjs';

export async function createApprovedAdapter(consumerDir) {
  const published = await callServiceAsync(consumerDir, { op: 'approvedCatalog' });
  if (!published.ok) throw new Error(`Catalog interface could not load: ${published.error}`);
  if (published.state === 'legacy') return null;
  const items = new Map(published.items.map(item => [item.id, item]));
  const toolConsumer = process.env.AIH_APPROVED_TOOL_CONSUMER ?? consumerDir;
  let planner;
  const catalog = { ...published, items: published.items.map(({ scanKey, ...item }) => item) };
  const reply = (response, status, value) => response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
  }).end(JSON.stringify(value));
  return {
    catalog: () => catalog,
    close() {},
    async handle(request, response, pathname) {
      const importing = pathname === '/api/repository-scan-import';
      if (pathname !== '/api/repository-scan' && pathname !== '/api/approved-evidence' &&
        pathname !== '/api/approved-tool-plan' && !importing && !pathname.startsWith('/api/authoring-')) return false;
      const host = request.headers.host;
      if (![`127.0.0.1:${request.socket.localPort}`, `localhost:${request.socket.localPort}`].includes(host) ||
        request.headers['sec-fetch-site'] === 'cross-site' ||
        (request.headers.origin && request.headers.origin !== `http://${host}`)) {
        reply(response, 403, { status: 'refused', reason: 'Same-origin Workbench request required.' });
        return true;
      }
      if (pathname === '/api/repository-scan' || importing) {
        if (request.method !== 'POST' || request.headers['content-type'] !== 'application/json') {
          reply(response, 405, { reason: 'Submit a JSON request from the Workbench.' });
          return true;
        }
        if (request.headers.origin !== `http://${host}`) {
          reply(response, 403, { reason: 'Same-origin Workbench request required.' });
          return true;
        }
        const chunks = [];
        let size = 0;
        const limit = importing ? 24 * 1024 * 1024 : 65536;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > limit) { reply(response, 413, { reason: 'Request too large.' }); return true; }
          chunks.push(chunk);
        }
        let input;
        try {
          input = JSON.parse(Buffer.concat(chunks));
        } catch {
          reply(response, 400, { reason: 'Expected a JSON request.' });
          return true;
        }
        if (importing) {
          const result = await callServiceAsync(consumerDir, { op: 'importRepositoryScan', files: input?.files });
          reply(response, result.ok && result.status === 'read' ? 200 : 422,
            result.ok ? result : { reason: 'The public Scan reader could not open this report.' });
          return true;
        }
        const folder = input?.folder;
        if (typeof folder !== 'string' || !folder.trim()) reply(response, 400, {reason:'Enter a folder path.'});
        else {
          const result = await callServiceAsync(consumerDir, {op:'repositoryScan', folder});
          reply(response, result.ok ? 200 : 422, result.ok ? result : {reason:'The local folder could not be scanned.'});
        }
        return true;
      }
      if (request.method === 'GET' && pathname === '/api/authoring-catalog') {
        reply(response, 200, catalog);
      } else if (request.method === 'GET' && pathname === '/api/approved-tool-plan') {
        const params = new URL(request.url, `http://${host}`).searchParams;
        const ids = params.getAll('item');
        const selected = ids.map(id => items.get(id));
        if (!ids.length || ids.length > 16 || new Set(ids).size !== ids.length ||
          selected.some(item => item?.kind !== 'ai-setup')) {
          reply(response, 400, { status: 'unavailable', reason: 'Select exact Tool Setup recipes from this Catalog.' });
          return true;
        }
        planner ??= isAbsolute(toolConsumer) ? createLocalCatalog(consumerDir, undefined, toolConsumer).catch(() => null) : Promise.resolve(null);
        const source = await planner;
        if (!source) {
          reply(response, 409, { status: 'unavailable', reason: 'A prepared consumer with pinned Catalog recipe inputs is required to preview tool setup.' });
          return true;
        }
        try {
          reply(response, 200, source.previewTools(selected, params.get('client'), params.get('platform')));
        } catch (error) {
          const invalid = error.code === 'CATALOG_INPUT_INVALID';
          reply(response, invalid ? 400 : 500, { status: 'unavailable', reason: invalid ? error.message : 'Catalog could not preview this tool setup.' });
        }
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
