import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readInstalledRelease } from '@aihq/catalog/node';
import { listItems } from '@aihq/catalog/reader';
import { parsePolicy } from '@aihq/core/contracts';
import { createHost } from './host.mjs';
import { editSetup, reopenSetup, reviewSetupUpdate } from './setup.mjs';
import { presentReport, readScanBytes } from './report-view.mjs';
import { createIntentService } from './intent-service.mjs';
import { createMixedService } from './mixed-service.mjs';

export async function startConsumer({ projectRoot, controls, organizationSource, previousCatalogRoot, port = 0 } = {}) {
  const installed = await readInstalledRelease({
    root: dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'))), sourceInput: 'catalog'
  });
  if (!installed.valid) throw new Error(JSON.stringify(installed.diagnostics));
  const { release, source: materialSource, materialRoots } = installed;
  const previous = previousCatalogRoot ? await readInstalledRelease({ root: previousCatalogRoot, sourceInput: 'catalog' }) : null;
  if (previous && !previous.valid) throw new Error(JSON.stringify(previous.diagnostics));
  const host = projectRoot ? createHost({ projectRoot, materialRoots, organizationSource, controls }) : null;
  const intentService = createIntentService();
  const mixedService = await createMixedService({ release, materialSource: { kind: 'local', input: 'maintained' } });
  const staticFiles = new Map([['/', ['consumer.html', 'text/html']], ['/intent', ['intent.html', 'text/html']], ['/intent.js', ['intent.js', 'text/javascript']], ['/consumer.js', ['consumer.js', 'text/javascript']], ['/consumer.css', ['consumer.css', 'text/css']], ['/tokens.css', ['tokens.css', 'text/css']]]);
  staticFiles.set('/authoring', ['authoring.html', 'text/html']);
  staticFiles.set('/authoring.js', ['authoring.js', 'text/javascript']);
  staticFiles.set('/policy-file.js', ['policy-file.js', 'text/javascript']);
  const send = (response, status, body, type = 'application/json') => {
    response.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
    response.end(type === 'application/json' ? JSON.stringify(body) : body);
  };
  const server = createServer(async (request, response) => {
    try {
      const origin = `http://127.0.0.1:${server.address().port}`;
      if (request.headers.host !== new URL(origin).host) return send(response, 403, { error: 'foreign-host' });
      const pathname = new URL(request.url, origin).pathname;
      if (request.method === 'GET' && staticFiles.has(pathname)) {
        const [name, type] = staticFiles.get(pathname);
        return send(response, 200, await readFile(join(dirname(fileURLToPath(import.meta.url)), '../page', name)), type);
      }
      if (request.method === 'GET' && pathname === '/api/catalog') return send(response, 200, {
        releaseSha256: release.sha256, items: listItems(release), hostAvailable: !!host,
        organizationConfigured: organizationSource !== undefined,
        packages: JSON.parse(process.env.AIH_CONSUMER_PACKAGES ?? '[]')
      });
      if (request.method === 'GET' && pathname === '/api/intent-catalog') {
        const query = new URL(request.url, origin).searchParams;
        return send(response, 200, intentService.catalog(query.get('inventory') ?? 'journey', query.get('stage') ?? 'current'));
      }
      if (request.method === 'GET' && pathname === '/api/authoring-catalog') return send(response, 200, mixedService.catalog());
      if (request.method !== 'POST' || !pathname.startsWith('/api/')) return send(response, 404, { error: 'not-found' });
      if (request.headers.origin !== origin) return send(response, 403, { error: 'foreign-origin' });
      if ((request.headers['content-type'] ?? '').split(';')[0] !== 'application/json') return send(response, 415, { error: 'expected-json' });
      let bytes = 0;
      const chunks = [];
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 8_000_000) return send(response, 413, { error: 'body-too-large' });
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return send(response, 400, { error: 'invalid-json' }); }
      if (pathname.startsWith('/api/authoring-')) {
        const result = await mixedService.run(pathname.slice('/api/authoring-'.length), body);
        // JSON transport represents bytes as arrays, never serialized handles.
        return send(response, 200, JSON.parse(JSON.stringify(result, (_key, value) => value instanceof Uint8Array ? [...value] : value)));
      }
      if (pathname.startsWith('/api/intent-')) return send(response, 200, intentService.run(pathname.slice('/api/intent-'.length), body));
      if (pathname === '/api/author') return send(response, 200, editSetup({
        release, materialSource, roots: body.roots, excludedItemIds: body.excludedItemIds, mode: body.mode, basePolicyText: body.basePolicyText
      }));
      if (pathname === '/api/reopen') return send(response, 200, reopenSetup({ release, materialSource, policyText: body.policyText }));
      if (pathname === '/api/update-review') return send(response, 200, previous
        ? reviewSetupUpdate({ previousRelease: previous.release, release, materialSource, policyText: body.policyText })
        : { valid: false, reason: 'No previous exact Catalog package configured by host.' });
      if (pathname === '/api/report') {
        const result = await readScanBytes(Buffer.from(body.base64, 'base64'));
        return send(response, 200, { view: presentReport(result) });
      }
      if (!host) return send(response, 409, { error: 'No execution target configured. Authoring remains available.' });
      if (pathname === '/api/prepare') {
        const parsed = parsePolicy(body.policyText);
        if (!parsed.valid) return send(response, 200, parsed);
        // Imported policies may refer only to material sources configured by this host.
        for (const selection of parsed.document.selections) {
          if (!selection.recipe.reference) return send(response, 400, { error: 'This bounded host executes configured Catalog recipe references only; inline policies remain read-only.' });
          const source = selection.recipe.reference?.source;
          if (source !== undefined && JSON.stringify(source) !== JSON.stringify(materialSource)) {
            return send(response, 400, { error: 'Imported recipe source is not the host-configured Catalog source.' });
          }
        }
        return send(response, 200, await host.prepareSession({ policyText: body.policyText }));
      }
      if (pathname === '/api/apply') return send(response, 200, await host.applyApproved({ sessionId: body.sessionId, reviewDigest: body.reviewDigest }));
      return send(response, 404, { error: 'not-found' });
    } catch (error) { send(response, 400, { error: error.message }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controls = process.env.AIH_CONSUMER_CONTROLS ? JSON.parse(await readFile(process.env.AIH_CONSUMER_CONTROLS, 'utf8')) : undefined;
  const result = await startConsumer({ projectRoot: process.env.AIH_CONSUMER_PROJECT, controls,
    previousCatalogRoot: process.env.AIH_CONSUMER_PREVIOUS_CATALOG,
    port: Number(process.env.AIH_CONSUMER_PORT ?? 4817) });
  console.log(`Policy Workbench: ${result.origin}`);
}
