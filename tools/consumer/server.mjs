import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readInstalledRelease } from '@aihq/catalog/node';
import { listItems } from '@aihq/catalog/reader';
import { parsePolicy } from '@aihq/core/contracts';
import { createHost } from './host.mjs';
import { readAuthoritySource } from './authority-source.mjs';
import { editSetup, reopenSetup, reviewSetupUpdate } from './setup.mjs';
import { presentReport, readScanBytes } from './report-view.mjs';
import { createIntentService } from './intent-service.mjs';
import { createMixedService } from './mixed-service.mjs';
import { installedFamilies } from './installed-families.mjs';
import { inspectAuthenticatedReviewEvidence } from './review-host.mjs';
import { intakePersonalFolder } from './personal-folder.mjs';

export async function startConsumer({ projectRoot, controls, organizationSource, previousCatalogRoot, reviewTrust, suppliedInventories, port = 0 } = {}) {
  const installed = await readInstalledRelease({
    root: dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'))), sourceInput: 'catalog'
  });
  if (!installed.valid) throw new Error(JSON.stringify(installed.diagnostics));
  const { release, source: materialSource, materialRoots } = installed;
  const previous = previousCatalogRoot ? await readInstalledRelease({ root: previousCatalogRoot, sourceInput: 'catalog' }) : null;
  if (previous && !previous.valid) throw new Error(JSON.stringify(previous.diagnostics));
  const legacyHost = projectRoot ? createHost({ projectRoot, materialRoots, organizationSource, controls }) : null;
  const intentService = createIntentService();
  const catalogRoot = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
  const descriptors = new Map();
  for (const item of listItems(release)) descriptors.set(item.recipe.path, item.recipe);
  const materials = await Promise.all([...descriptors.values()].map(async descriptor => {
    const path = resolve(catalogRoot, descriptor.path);
    if (!path.startsWith(catalogRoot + sep)) throw new Error('Catalog material path escapes the installed package.');
    return { ...descriptor, bytes: new Uint8Array(await readFile(path)) };
  }));
  const familyInventories = await installedFamilies();
  const mixedService = await createMixedService({ release, materials, materialSource: { kind: 'local', input: 'maintained' } }, { suppliedInventories, familyInventories });
  const authoringRoots = { maintained: catalogRoot };
  if (projectRoot) {
    const staging = await mkdtemp(join(tmpdir(), 'aih-authoring-materials-'));
    for (const inventory of mixedService.inventories.filter(entry => entry.materialSource.input !== 'maintained')) {
      const input = inventory.materialSource.input;
      // Only host-selected startup inventories acquire execution bindings.
      const directory = join(staging, `source-${Object.keys(authoringRoots).length}`);
      authoringRoots[input] = directory;
      for (const material of inventory.materials) {
        const path = resolve(directory, material.path);
        if (!path.startsWith(directory + sep)) throw new Error('Material path escapes host staging.');
        await mkdir(dirname(path), { recursive: true }); await writeFile(path, material.bytes);
      }
    }
  }
  const host = projectRoot ? createHost({ projectRoot, materialRoots: authoringRoots, organizationSource,
    recipeMaterials: mixedService.inventories.flatMap(i => i.materials ?? []), controls }) : null;
  // Client tokens exist only in the live page. No cookie, saved intent or imported
  // snapshot restores a client's inventory, material grants or prepared handles.
  const clients = new Map(), clientStages = new Set();
  async function clientFor(request) {
    const id = request.headers['x-aih-client'];
    if (id === undefined) return { mixed: mixedService, host };
    if (typeof id !== 'string' || !/^[A-Za-z0-9-]{8,80}$/.test(id)) throw new Error('Invalid authoring client token.');
    const now = Date.now();
    for (const [key, value] of clients) if (now - value.usedAt > 3_600_000) {
      clients.delete(key);
      for (const directory of value.stages) { await rm(directory, { recursive: true, force: true }); clientStages.delete(directory); }
    }
    if (!clients.has(id)) {
      if (clients.size >= 64) throw new Error('Too many active authoring clients; reopen after idle sessions expire.');
      const client = { usedAt: now, stages: [], grants: new Map(), roots: { ...authoringRoots } };
      clients.set(id, client);
      client.ready = (async () => {
        client.mixed = await createMixedService({ release, materials, materialSource: { kind: 'local', input: 'maintained' } }, { suppliedInventories, familyInventories });
        client.recipeMaterials = client.mixed.inventories.flatMap(i => i.materials ?? []);
        client.host = projectRoot ? createHost({ projectRoot, materialRoots: client.roots, organizationSource, recipeMaterials: client.recipeMaterials, controls }) : null;
      })();
    }
    const client = clients.get(id); await client.ready; client.usedAt = now; return client;
  }
  // Only the declared source fields reach the page; extra host-file members never do.
  const publicSource = organizationSource && typeof organizationSource === 'object' ? {
    provider: organizationSource.provider, repository: { owner: organizationSource.repository?.owner, name: organizationSource.repository?.name },
    path: organizationSource.path, revision: { kind: organizationSource.revision?.kind, value: organizationSource.revision?.value } } : null;
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
      if (request.method === 'GET' && pathname === '/api/authoring-catalog') {
        const client = await clientFor(request);
        return send(response, 200, { ...client.mixed.catalog(), executionAvailable: !!client.host,
          organizationConfigured: organizationSource !== undefined, organizationSource: publicSource });
      }
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
        const client = await clientFor(request), mixedService = client.mixed, host = client.host;
        const operation = pathname.slice('/api/authoring-'.length);
        if (['intake', 'folder'].includes(operation) && !client.grants) return send(response, 400, { status: 'refused', diagnostics: [{ code: 'CLIENT_REQUIRED', message: 'Open a fresh authoring client before supplying content.' }] });
        if (operation === 'folder') {
          if (client.grants.size >= 16) return send(response, 409, { status: 'refused', diagnostics: [{ code: 'LOCAL_GRANT_LIMIT', message: 'Up to 16 personal folders per page session; reopen a fresh page to start again.' }] });
          const result = await intakePersonalFolder(body);
          if (result.status !== 'ok') return send(response, 200, result);
          const inventory = result.value, input = inventory.materialSource.input;
          const grantId = randomUUID();
          if (projectRoot && !client.grants.has(inventory.release.sha256)) {
            const directory = await mkdtemp(join(tmpdir(), 'aih-personal-grant-'));
            clientStages.add(directory); client.stages.push(directory);
            for (const material of inventory.materials) {
              const path = resolve(directory, material.path);
              if (!path.startsWith(directory + sep)) throw new Error('Material path escapes granted staging.');
              await mkdir(dirname(path), { recursive: true }); await writeFile(path, material.bytes);
            }
            client.roots[input] = directory;
            client.recipeMaterials.push(...inventory.materials);
            // A binding/context change discards prior approvals in this client.
            client.host = createHost({ projectRoot, materialRoots: client.roots, organizationSource, recipeMaterials: client.recipeMaterials, controls });
          }
          mixedService.addInventory(inventory); client.grants.set(inventory.release.sha256, grantId);
          return send(response, 200, { status: 'ok', diagnostics: [], value: { input: inventory.input, grantId, itemIds: inventory.release.items.map(item => item.id),
            message: body.rebind ? 'Exact folder rebound for this page session. Validate and reopen the saved policy.' : 'Folder validated for this page session. Choose its Personal items alongside maintained content.' } });
        }
        // Host-configured source and controls only; the request body is ignored and needs no project root.
        if (operation === 'authority-source') return send(response, 200, await readAuthoritySource({ organizationSource, controls }));
        if (['authority', 'prepare', 'apply', 'managed', 'remove'].includes(operation)) {
          if (!host) return send(response, 409, { status: 'unavailable', diagnostics: [{ code: 'HOST_UNAVAILABLE', message: 'No execution target configured by host.' }] });
          const policyText = new TextDecoder().decode(Uint8Array.from(body.policyBytes ?? []));
          const result = operation === 'authority' ? await host.inspectAuthority({ policyText })
            : operation === 'prepare' ? await host.prepareSession({ policyText, resolutions: body.resolutions })
            : operation === 'apply' ? await host.applyApproved({ sessionId: body.sessionId, reviewDigest: body.reviewDigest })
            : operation === 'managed' ? await host.managedInventory()
            : await host.prepareRemovalSession({ managementId: body.managementId, scope: body.scope, mode: body.mode });
          return send(response, 200, result);
        }
        const result = pathname === '/api/authoring-inspect-review' && reviewTrust
          ? await inspectAuthenticatedReviewEvidence({ evidenceBytes: Uint8Array.from((Number.isSafeInteger(body.evidenceIndex) ? body.reviewEvidence?.[body.evidenceIndex] : body.evidenceBytes) ?? []), inventory: mixedService.inventories.find(entry => entry.release.sha256 === body.target?.releaseSha256), itemId: body.target?.itemId, trust: reviewTrust })
          : await mixedService.run(pathname.slice('/api/authoring-'.length), body);
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
        return send(response, 200, await legacyHost.prepareSession({ policyText: body.policyText }));
      }
      if (pathname === '/api/apply') return send(response, 200, await legacyHost.applyApproved({ sessionId: body.sessionId, reviewDigest: body.reviewDigest }));
      return send(response, 404, { error: 'not-found' });
    } catch (error) { send(response, 400, { error: error.message }); }
  });
  server.on('close', () => { for (const directory of clientStages) void rm(directory, { recursive: true, force: true }); clients.clear(); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controls = process.env.AIH_CONSUMER_CONTROLS ? JSON.parse(await readFile(process.env.AIH_CONSUMER_CONTROLS, 'utf8')) : undefined;
  const result = await startConsumer({ projectRoot: process.env.AIH_CONSUMER_PROJECT, controls,
    organizationSource: process.env.AIH_ORGANIZATION_SOURCE ? JSON.parse(await readFile(process.env.AIH_ORGANIZATION_SOURCE, 'utf8')) : undefined,
    reviewTrust: process.env.AIH_REVIEW_TRUST ? JSON.parse(await readFile(process.env.AIH_REVIEW_TRUST, 'utf8')) : undefined,
    previousCatalogRoot: process.env.AIH_CONSUMER_PREVIOUS_CATALOG,
    port: Number(process.env.AIH_CONSUMER_PORT ?? 4817) });
  console.log(`Policy Workbench: ${result.origin}`);
}
