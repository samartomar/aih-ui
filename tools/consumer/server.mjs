import { browsePolicy } from './browse-policy.mjs';
import { browseContent } from './browse-content.mjs';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readInstalledRelease } from '@aihq/catalog/node';
import { listItems, isCheckedRelease } from '@aihq/catalog/reader';
import { parsePolicy } from '@aihq/core/contracts';
import * as coreContracts from '@aihq/core/contracts';
import * as core from '@aihq/core';
import { createHost } from './host.mjs';
import { createProjectFolder, shared } from './project-folder.mjs';
import { readAuthoritySource, readOrganization } from './authority-source.mjs';
import { editSetup, reopenSetup, reviewSetupUpdate } from './setup.mjs';
import { presentReport, readScanBytes } from './report-view.mjs';
import { createIntentService } from './intent-service.mjs';
import { createMixedService } from './mixed-service.mjs';
import { readFrameworkSources, observation } from './framework-sources.mjs';
import { installedFamilies, installedReleaseInventory } from './installed-families.mjs';
import { inspectAuthenticatedReviewEvidence } from './review-host.mjs';
import { intakePersonalFolder } from './personal-folder.mjs';
import { observeCheckout } from './workspace-host.mjs';
import { createCatalogUpdateSource } from './update-source.mjs';
import { inspectorSummary } from './scan-evidence.mjs';
import { createScanEvidenceHost } from './scan-evidence-host.mjs';

export async function startConsumer({ projectRoot, controls, organizationSource, previousCatalogRoot, reviewTrust, suppliedInventories, maintenanceSource, frictionEvidence, updateSourceCatalogRoots, evidenceSources, evidenceDetectorIds, frameworkSources, frameworkFixtureInventories, port = 0, createExecutionHost = createHost, coreState = { resolveStateLocation: core.resolveStateLocation, stateLocation: coreContracts.stateLocation } } = {}) {
  // `createExecutionHost` is createHost; tests pass one that holds Install work while they act.
  // The fixture is a test source; a host names one update source, so both together would be ambiguous.
  if (updateSourceCatalogRoots !== undefined && maintenanceSource) throw new Error('Configure one update source: Catalog package roots or the test fixture, not both.');
  const installed = await readInstalledRelease({
    root: dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'))), sourceInput: 'catalog'
  });
  if (!installed.valid) throw new Error(JSON.stringify(installed.diagnostics));
  const { release, source: materialSource, materialRoots } = installed;
  const previous = previousCatalogRoot ? await readInstalledRelease({ root: previousCatalogRoot, sourceInput: 'catalog' }) : null;
  if (previous && !previous.valid) throw new Error(JSON.stringify(previous.diagnostics));
  let legacyHost = projectRoot ? createExecutionHost({ projectRoot, materialRoots, organizationSource, controls }) : null;
  const intentService = createIntentService();
  const catalogRoot = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
  const descriptors = new Map();
  for (const item of listItems(release)) descriptors.set(item.recipe.path, item.recipe);
  const materials = await Promise.all([...descriptors.values()].map(async descriptor => {
    const path = resolve(catalogRoot, descriptor.path);
    if (!path.startsWith(catalogRoot + sep)) throw new Error('Catalog material path escapes the installed package.');
    return { ...descriptor, bytes: new Uint8Array(await readFile(path)) };
  }));
  const frameworkCatalog = await readFrameworkSources(frameworkSources);
  if (frameworkFixtureInventories !== undefined) {
    if (!Array.isArray(frameworkFixtureInventories) || frameworkFixtureInventories.length > 8 || frameworkFixtureInventories.some(entry => !isCheckedRelease(entry.release))) throw new Error('Supply bounded public-reader checked fixture inventories.');
    frameworkCatalog.fixture = true;
    frameworkCatalog.inventories.push(...frameworkFixtureInventories);
    frameworkCatalog.frameworks.push(...frameworkFixtureInventories.map(entry => ({ ...entry.release.framework, sha256: entry.release.sha256, kind: 'fixture', reason: entry.fixture, state: 'ready', sets: entry.release.sets ?? [], sources: entry.release.sources, observations: observation(entry.release) })));
  }
  const familyInventories = [...await installedFamilies(), ...frameworkCatalog.inventories];
  // Explicit previous-package history participates in exact saved-pin reads,
  // never in the current browse inventory. Preserve the logical input saved
  // before upgrade; historical execution is guarded separately below.
  const historicalInventories = previousCatalogRoot ? [await installedReleaseInventory({ root: previousCatalogRoot }), ...await installedFamilies({ root: previousCatalogRoot })] : [];
  const currentReleases = new Set([release.sha256, ...familyInventories.map(value => value.release.sha256)]);
  const historicalOnly = new Set(historicalInventories.map(value => value.release.sha256).filter(sha => !currentReleases.has(sha)));
  // One source object per host, so the last time each root was read lives as long as the server.
  const updateSource = updateSourceCatalogRoots !== undefined ? createCatalogUpdateSource({ roots: updateSourceCatalogRoots, installedPackage: release.package }) : null;
  if (updateSource) maintenanceSource = () => updateSource.read();
  const mixedService = await createMixedService({ release, materials, materialSource: { kind: 'local', input: 'maintained' } }, { suppliedInventories, familyInventories, frameworkCatalog, historicalInventories, maintenanceSource, frictionEvidence, observeCheckout });
  const authoringRoots = { maintained: catalogRoot };
  // Startup inventories are staged once, when the first project folder is known. Concurrent callers share the one run,
  // and the roots are published only once every file is written; a failed run is retried by the next caller.
  const stageAuthoringRoots = shared(async () => {
    const staging = await mkdtemp(join(tmpdir(), 'aih-authoring-materials-')), staged = {};
    for (const inventory of mixedService.inventories.filter(entry => !Object.hasOwn(authoringRoots, entry.materialSource.input) && !Object.hasOwn(staged, entry.materialSource.input))) {
      const input = inventory.materialSource.input;
      // Only host-selected startup inventories acquire execution bindings.
      const directory = join(staging, `source-${Object.keys(authoringRoots).length + Object.keys(staged).length}`);
      for (const material of inventory.materials) {
        const path = resolve(directory, material.path);
        if (!path.startsWith(directory + sep)) throw new Error('Material path escapes host staging.');
        await mkdir(dirname(path), { recursive: true }); await writeFile(path, material.bytes);
      }
      staged[input] = directory;
    }
    Object.assign(authoringRoots, staged);
  });
  if (projectRoot) await stageAuthoringRoots();
  const hostFor = project => project ? createExecutionHost({ projectRoot: project, materialRoots: authoringRoots, organizationSource,
    recipeMaterials: mixedService.inventories.flatMap(i => i.materials ?? []), controls }) : null;
  let host = hostFor(projectRoot);
  // Client tokens exist only in the live page. No cookie, saved intent or imported
  // snapshot restores a client's inventory, material grants or prepared handles.
  const clients = new Map(), clientStages = new Set();
  const clientHost = client => folder.project ? createExecutionHost({ projectRoot: folder.project, materialRoots: client.roots, organizationSource, recipeMaterials: client.recipeMaterials, controls }) : null;
  // Session ids prepared for an earlier project folder, so applying one is refused by name. Bounded; older ones read as lost.
  const retired = new Set();
  const retire = old => { for (const id of old?.heldSessions() ?? []) { retired.add(id); if (retired.size > 1024) retired.delete(retired.values().next().value); } };
  // The ordinary page's project folder. A switch replaces every execution host, discarding all prepared sessions;
  // personal-folder grants and their staged material roots are kept, since they are about content, not the project.
  const folder = createProjectFolder({ initial: projectRoot, options: { coreState }, beforeChange: stageAuthoringRoots, onChange: project => {
    retire(legacyHost); retire(host);
    legacyHost = createExecutionHost({ projectRoot: project, materialRoots, organizationSource, controls }); host = hostFor(project);
    for (const client of clients.values()) {
      for (const [input, root] of Object.entries(authoringRoots)) if (!Object.hasOwn(client.roots, input)) client.roots[input] = root;
      if (client.recipeMaterials) { retire(client.host); client.host = clientHost(client); }
    }
  } });
  // Called inside folder.run: the chosen folder is checked again right before Install or Remove uses it.
  const folderMoved = async () => { const moved = await folder.verify(); return moved && { status: 'refused', diagnostics: [{ code: 'FOLDER_CHANGED', reason: 'folder-changed',
    message: `The project folder cannot be used now: ${moved.reason} Nothing was written. Choose the folder again.` }] }; };
  const folderChanged = () => ({ status: 'rejected', reason: 'folder-changed', diagnostics: [{ code: 'FOLDER_CHANGED', reason: 'folder-changed',
    message: 'The project folder changed after this was checked, so it was discarded and nothing was written. Check the list and install again.' }] });
  const scanEvidence = createScanEvidenceHost({ sources: evidenceSources, packageRoot: catalogRoot, trust: reviewTrust, detectorIds: evidenceDetectorIds });
  // Requests without a client token read the host's execution host when they use it, never a copy taken earlier.
  const anonymous = { mixed: mixedService, get host() { return host; }, scanEvidence };
  async function clientFor(request) {
    const id = request.headers['x-aih-client'];
    if (id === undefined) return anonymous;
    if (typeof id !== 'string' || !/^[A-Za-z0-9-]{8,80}$/.test(id)) throw new Error('Invalid authoring client token.');
    const now = Date.now();
    for (const [key, value] of clients) if (now - value.usedAt > 3_600_000) {
      clients.delete(key);
      for (const directory of value.stages) { await rm(directory, { recursive: true, force: true }); clientStages.delete(directory); }
    }
    if (!clients.has(id)) {
      if (clients.size >= 64) throw new Error('Too many active authoring clients; reopen after idle sessions expire.');
      const client = { usedAt: now, stages: [], grants: new Map(), roots: { ...authoringRoots },
        scanEvidence: createScanEvidenceHost({ sources: evidenceSources, packageRoot: catalogRoot, trust: reviewTrust, detectorIds: evidenceDetectorIds }) };
      clients.set(id, client);
      client.ready = (async () => {
        client.mixed = await createMixedService({ release, materials, materialSource: { kind: 'local', input: 'maintained' } }, { suppliedInventories, familyInventories, frameworkCatalog, historicalInventories, maintenanceSource, frictionEvidence, observeCheckout });
        client.recipeMaterials = client.mixed.inventories.flatMap(i => i.materials ?? []);
        client.host = clientHost(client);
      })();
    }
    const client = clients.get(id); await client.ready; client.usedAt = now; return client;
  }
  // Only the declared source fields reach the page; extra host-file members never do.
  const publicSource = organizationSource !== undefined ? {
    provider: organizationSource?.provider, repository: { owner: organizationSource?.repository?.owner, name: organizationSource?.repository?.name },
    path: organizationSource?.path, revision: { kind: organizationSource?.revision?.kind, value: organizationSource?.revision?.value } } : null;
  const staticFiles = new Map([['/', ['consumer.html', 'text/html']], ['/intent', ['intent.html', 'text/html']], ['/intent.js', ['intent.js', 'text/javascript']], ['/consumer.js', ['consumer.js', 'text/javascript']], ['/consumer.css', ['consumer.css', 'text/css']], ['/tokens.css', ['tokens.css', 'text/css']]]);
  staticFiles.set('/authoring', ['authoring.html', 'text/html']);
  staticFiles.set('/authoring.js', ['authoring.js', 'text/javascript']);
  staticFiles.set('/policy-file.js', ['policy-file.js', 'text/javascript']);
  // The authoring page's configuration editor and the DOM helper it imports.
  for (const name of ['app/dom.js', 'app/configuration-editor.js']) staticFiles.set(`/${name}`, [name, 'text/javascript']);
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
      if (request.method === 'GET' && pathname === '/api/authoring-project') return send(response, 200, folder.read());
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
      if (pathname === '/api/authoring-project') {
        const result = await folder.choose(body.path);
        return send(response, result.status === 'busy' ? 409 : 200, result);
      }
      if (pathname.startsWith('/api/authoring-')) {
        const client = await clientFor(request), mixedService = client.mixed;
        const operation = pathname.slice('/api/authoring-'.length);
        if (operation === 'scan-evidence-detail') return send(response, 200, client.scanEvidence.detail(body.scanId));
        if (body.reviewEvidenceIds !== undefined) {
          const ids = body.reviewEvidenceIds;
          if (!Array.isArray(ids) || ids.length > 32 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !/^scan:sha256:[a-f0-9]{64}$/.test(id))) return send(response, 200, { status: 'refused', diagnostics: [{ code: 'EVIDENCE_UNAVAILABLE', message: 'Supply up to 32 unique acquired Scan identities.' }] });
          const retained = ids.map(id => client.scanEvidence.detail(id));
          if (retained.some(value => value.status !== 'read')) return send(response, 200, { status: 'refused', diagnostics: [{ code: 'EVIDENCE_UNAVAILABLE', message: 'Original evidence is unavailable in this page session; check its source again. Saved review identities remain unchanged.' }] });
          if ((body.reviewEvidence?.length ?? 0) + ids.length > 32) return send(response, 200, { status: 'refused', diagnostics: [{ code: 'EVIDENCE_UNAVAILABLE', message: 'Use up to 32 original evidence documents.' }] });
          body.reviewEvidence = [...(body.reviewEvidence ?? []), ...retained.map(value => value.bytes)];
        }
        if (operation === 'browse-content') {
          const result = await browseContent(mixedService.inventories, body, folder.project, (inventory, itemId) => client.scanEvidence.check({ inventory, itemId, supplied: (body.reviewEvidence ?? []).map(bytes => Uint8Array.from(bytes)), evaluationTime: new Date().toISOString(), withSummary: true }));
          if (body.enterprise === true && result.compatibility) {
            const inventory = mixedService.inventories.find(entry => entry.release.sha256 === body.releaseSha256);
            const source = organizationSource ? await readOrganization({ organizationSource, controls }) : {};
            result.policy = await browsePolicy(inventory, body.tool, source.organization);
          }
          return send(response, 200, result);
        }
        if (operation === 'scan-evidence') {
          const [releaseSha256, itemId] = String(body.target ?? '').split('/');
          const inventory = mixedService.inventories.find(entry => entry.release.sha256 === releaseSha256);
          if (!inventory) return send(response, 200, { status: 'invalid', diagnostics: [{ code: 'ITEM_UNAVAILABLE', detail: 'Exact content unavailable.' }] });
          const result = await client.scanEvidence.check({ inventory, itemId, supplied: (body.reviewEvidence ?? []).map(bytes => Uint8Array.from(bytes)), evaluationTime: body.evaluationTime, selection: body.selection });
          return send(response, 200, body.projection === 'inspector' ? inspectorSummary(result) : result);
        }
        if (['intake', 'folder'].includes(operation) && !client.grants) return send(response, 400, { status: 'refused', diagnostics: [{ code: 'CLIENT_REQUIRED', message: 'Open a fresh authoring client before supplying content.' }] });
        if (operation === 'folder') {
          if (client.grants.size >= 16) return send(response, 409, { status: 'refused', diagnostics: [{ code: 'LOCAL_GRANT_LIMIT', message: 'Up to 16 personal folders per page session; reopen a fresh page to start again.' }] });
          const result = await intakePersonalFolder(body);
          if (result.status !== 'ok') return send(response, 200, result);
          const inventory = result.value, input = inventory.materialSource.input;
          const grantId = randomUUID();
          if (!client.grants.has(inventory.release.sha256)) {
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
            client.host = clientHost(client);
          }
          mixedService.addInventory(inventory); client.grants.set(inventory.release.sha256, grantId);
          return send(response, 200, { status: 'ok', diagnostics: [], value: { input: inventory.input, grantId, itemIds: inventory.release.items.map(item => item.id),
            message: body.rebind ? 'Exact folder rebound for this page session. Validate and reopen the saved policy.' : 'Folder validated for this page session. Choose its Personal items alongside maintained content.' } });
        }
        // Host-configured source and controls only; the request body is ignored and needs no project root.
        if (operation === 'authority-source') return send(response, 200, await readAuthoritySource({ organizationSource, controls }));
        if (['authority', 'prepare', 'apply', 'managed', 'remove'].includes(operation)) {
          if (!client.host) return send(response, 409, { status: 'unavailable', diagnostics: [{ code: 'HOST_UNAVAILABLE', message: 'No project folder is set. Choose one to install or remove.' }] });
          if (operation === 'apply' && retired.has(body.sessionId)) return send(response, 200, folderChanged());
          // Install and Remove hold the current folder until they finish; the host is read once they hold it.
          const work = ['prepare', 'apply', 'remove'].includes(operation) ? folder.run : action => action();
          return send(response, 200, await work(async () => {
            const moved = operation === 'prepare' || operation === 'apply' || operation === 'remove' ? await folderMoved() : undefined;
            if (moved) return moved;
            const policyText = new TextDecoder().decode(Uint8Array.from(body.policyBytes ?? []));
            if (operation === 'prepare' && historicalOnly.size) {
              const checked = await mixedService.run('read', { policyBytes: body.policyBytes });
              if (checked.status === 'ok' && checked.value.editing === 'available' && checked.value.intent.pins.some(pin => historicalOnly.has(pin.releaseSha256))) {
                return { status: 'refused', diagnostics: [{ code: 'HISTORICAL_SOURCE_UPDATE_REQUIRED', message: 'This policy includes historical Catalog content. Review and explicitly accept its source update before preparing against the current installed package. Your saved policy is unchanged.' }] };
              }
            }
            const host = client.host;
            return operation === 'authority' ? await host.inspectAuthority({ policyText })
              : operation === 'prepare' ? await host.prepareSession({ policyText, resolutions: body.resolutions })
              : operation === 'apply' ? await host.applyApproved({ sessionId: body.sessionId, reviewDigest: body.reviewDigest })
              : operation === 'managed' ? await host.managedInventory()
              : await host.prepareRemovalSession({ managementId: body.managementId, scope: body.scope, mode: body.mode });
          }));
        }
        const reviewIntent = pathname === '/api/authoring-inspect-review' && reviewTrust && body.policyBytes ? (await mixedService.run('read', body)).value?.intent : undefined;
        const reviewPin = reviewIntent?.pins.find(pin => pin.releaseSha256 === body.target?.releaseSha256 && pin.itemId === body.target?.itemId);
        const result = pathname === '/api/authoring-inspect-review' && reviewTrust
          ? await inspectAuthenticatedReviewEvidence({ evidenceBytes: Uint8Array.from((Number.isSafeInteger(body.evidenceIndex) ? body.reviewEvidence?.[body.evidenceIndex] : body.evidenceBytes) ?? []), inventory: mixedService.inventories.find(entry => entry.release.sha256 === body.target?.releaseSha256), itemId: body.target?.itemId, recipe: reviewPin?.recipe, configuration: reviewIntent?.roots.find(root => root.releaseSha256 === body.target?.releaseSha256 && root.itemId === body.target?.itemId)?.configuration, trust: reviewTrust })
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
        return send(response, 200, await folder.run(async () => await folderMoved() ?? legacyHost.prepareSession({ policyText: body.policyText })));
      }
      if (pathname === '/api/apply') return send(response, 200, retired.has(body.sessionId) ? folderChanged()
        : await folder.run(async () => await folderMoved() ?? legacyHost.applyApproved({ sessionId: body.sessionId, reviewDigest: body.reviewDigest })));
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
    ...(process.env.AIH_UPDATE_SOURCE_CATALOG_ROOTS ? { updateSourceCatalogRoots: process.env.AIH_UPDATE_SOURCE_CATALOG_ROOTS.split(delimiter) } : {}),
    port: Number(process.env.AIH_CONSUMER_PORT ?? 4817) });
  console.log(`Policy Workbench: ${result.origin}`);
}
