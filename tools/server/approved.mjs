import { isAbsolute } from 'node:path';
import { createLocalCatalog } from '../workbench/local-catalog.mjs';
import { createApprovedPersonal } from './approved-personal.mjs';
import { createEnterprisePolicy } from './enterprise-core-policy.mjs';
import { createEnterpriseExecution } from './enterprise-core-execution.mjs';
import { callServiceAsync } from './service-client.mjs';

export async function createApprovedAdapter(consumerDir, { enterpriseGithub, summary } = {}) {
  const published = await callServiceAsync(consumerDir, { op: 'approvedCatalog' });
  if (!published.ok) throw new Error(`Catalog interface could not load: ${published.error}`);
  if (published.state === 'legacy') return null;
  const items = new Map(published.items.map(item => [item.id, item]));
  const toolConsumer = process.env.AIH_APPROVED_TOOL_CONSUMER ?? consumerDir;
  let planner, assessmentCheck;
  const catalogPlanner = () => planner ??= isAbsolute(toolConsumer)
    ? createLocalCatalog(consumerDir, undefined, toolConsumer).catch(() => null) : Promise.resolve(null);
  const personal = createApprovedPersonal({ consumer: consumerDir, catalog: catalogPlanner,
    sourceConsumer: toolConsumer, project: process.env.AIH_CONSUMER_PROJECT });
  const enterprise = createEnterpriseExecution({ consumer:consumerDir, catalog:catalogPlanner,
    sourceConsumer:toolConsumer, project:process.env.AIH_CONSUMER_PROJECT,
    readPolicy:enterpriseGithub && (() => enterpriseGithub.readPolicy()) });
  enterpriseGithub?.setPolicyHandlers(createEnterprisePolicy({consumer:consumerDir, published, summary, catalog:catalogPlanner}));
  const catalog = { ...published, items: published.items.map(({ scanKey, ...item }) => item) };
  const reply = (response, status, value) => response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
  }).end(JSON.stringify(value));
  return {
    catalog: () => catalog,
    close() { void enterprise.close(); },
    async handle(request, response, pathname) {
      const importing = pathname === '/api/repository-scan-import';
      const personalPath = ['/api/approved-personal', '/api/approved-personal-prepare', '/api/approved-personal-apply'].includes(pathname);
      const enterpriseImpact = pathname === '/api/approved-enterprise-impact';
      const enterprisePath = ['/api/approved-enterprise', '/api/approved-enterprise-prepare', '/api/approved-enterprise-apply'].includes(pathname);
      if (pathname !== '/api/repository-scan' && pathname !== '/api/approved-evidence' && pathname !== '/api/approved-assessments' &&
        pathname !== '/api/approved-tool-plan' && !importing && !personalPath && !enterprisePath && !enterpriseImpact && !pathname.startsWith('/api/authoring-')) return false;
      const host = request.headers.host;
      if (![`127.0.0.1:${request.socket.localPort}`, `localhost:${request.socket.localPort}`].includes(host) ||
        request.headers['sec-fetch-site'] === 'cross-site' ||
        (request.headers.origin && request.headers.origin !== `http://${host}`)) {
        reply(response, 403, { status: 'refused', reason: 'Same-origin Workbench request required.' });
        return true;
      }
      if (enterpriseImpact && request.method === 'GET') {
        reply(response, 200, await enterprise.impact());
        return true;
      }
      if (request.method === 'GET' && ['/api/approved-personal', '/api/approved-enterprise'].includes(pathname)) {
        reply(response, 200, (enterprisePath ? enterprise : personal).status());
        return true;
      }
      if (pathname === '/api/repository-scan' || importing || personalPath || enterprisePath) {
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
        const limit = importing ? 24 * 1024 * 1024 : enterprisePath ? 1024 * 1024 : 65536;
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
        if (personalPath || enterprisePath) {
          const session = request.headers['x-aih-client'];
          if (typeof session !== 'string' || !/^[a-f0-9-]{36}$/.test(session)) {
            reply(response, 400, { status: 'invalid', reason: 'Open a current Workbench review session.' });
            return true;
          }
          if (enterprisePath) {
            if (pathname === '/api/approved-enterprise-prepare') {
              const ids = input?.items;
              const files = input?.files;
              const organizationFiles = input?.organizationFiles === true;
              const selection = Array.isArray(ids) ? ids.map(id => items.get(id)) : [];
              if (!Array.isArray(ids) || !Array.isArray(files) || selection.length > 64 ||
                (!selection.length && !files.length && !organizationFiles) || new Set(ids).size !== ids.length || selection.some(item => !item)) {
                reply(response, 400, {status:'invalid', reason:'Choose exact Catalog items or supporting files for review.'});
              } else reply(response, 200, await enterprise.prepare({items:selection, files, organizationFiles, client:input.client,
                binding:input.binding, source:input.source, session}));
            } else if (pathname === '/api/approved-enterprise-apply') {
              reply(response, 200, await enterprise.apply({id:input?.id,reviewDigest:input?.reviewDigest,confirmed:input?.confirmed,session}));
            } else reply(response, 405, {status:'invalid', reason:'Choose an Enterprise setup operation.'});
            return true;
          }
          if (pathname === '/api/approved-personal-prepare') {
            const ids = input?.items;
            const selection = Array.isArray(ids) ? ids.map(id => items.get(id)) : [];
            if (!selection.length || selection.length > 64 || new Set(ids).size !== ids.length || selection.some(item => !item)) {
              reply(response, 400, { status: 'invalid', reason: 'Choose exact items from the current Catalog.' });
            } else reply(response, 200, await personal.prepare({ items: selection, client: input.client, binding: input.binding, session }));
          } else if (pathname === '/api/approved-personal-apply') {
            reply(response, 200, await personal.apply({ id: input?.id, reviewDigest: input?.reviewDigest, confirmed: input?.confirmed, session }));
          } else reply(response, 405, { status: 'invalid', reason: 'Choose a personal setup operation.' });
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
        const source = await catalogPlanner();
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
      } else if (request.method === 'GET' && pathname === '/api/approved-assessments') {
        assessmentCheck ??= callServiceAsync(consumerDir, { op: 'approvedAssessments',
          items: published.items.map(({ id, scanKey }) => ({ id, scanKey })) });
        const result = await assessmentCheck;
        if (!result.ok) assessmentCheck = undefined;
        reply(response, 200, result.ok ? result : { status: 'unavailable', reason: 'The public Scan reader could not summarize these assessments.' });
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
