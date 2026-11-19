import { createServer } from 'node:http';
import { fork } from 'node:child_process';
import { readFile, mkdir, lstat, realpath } from 'node:fs/promises';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createLocalCatalog } from './local-catalog.mjs';
import { profileLibrary } from './profile-reader.mjs';

import { catalogInstallReason } from './catalog-install.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const actions = new Set(['draft', 'policy', 'policy-preview', 'record-review', 'prepare', 'remove', 'apply', 'check', 'check-claude', 'inspect', 'repair', 'report', 'catalog-evidence', 'catalog-plan', 'catalog-prepare', 'profile-preview']);
const fail = (message, code = 'INPUT_INVALID', status = 400) => Object.assign(Error(message), { code, status });
function keys(value, allowed) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key)); }
function validate(action, body) {
  if (action === 'record-review') {
    if (!keys(body, ['mode','digest','company','reviewer','team','decision','note','itemId','concern']) || body.mode !== 'enterprise' ||
        !/^[a-f0-9]{64}$/.test(body.digest) || !['False alarm','Accepted risk','Accepted for this use','Follow-up needed','Declined'].includes(body.decision) ||
        !['company','reviewer','note'].every(key => typeof body[key] === 'string' && body[key].trim()) ||
        !['company','reviewer','team','itemId','note'].every(key => typeof body[key] === 'string' && body[key].length <= (key === 'note' ? 2000 : 300))) throw fail('Supply company, reviewer, decision and rationale for the saved policy.');
    return;
  }
  if (action === 'profile-preview') {
    if (!keys(body, ['mode', 'profile', 'client']) || !['enterprise', 'vibe'].includes(body.mode) || typeof body.client !== 'string') throw fail('Invalid profile preview request');
    return;
  }
  if (action === 'catalog-evidence') { if (!keys(body, ['mode', 'itemId']) || !['enterprise','vibe'].includes(body.mode) || typeof body.itemId !== 'string' || body.itemId.length > 300) throw fail('Invalid Catalog selection');return; }
  if (action === 'catalog-plan' || action === 'catalog-prepare') { if (!keys(body, ['mode', 'items', 'client']) || !['enterprise','vibe'].includes(body.mode) || !Array.isArray(body.items) || body.items.some(id => typeof id !== 'string' || id.length > 300) || typeof body.client !== 'string') throw fail('Invalid plan preview selection');return; }
  if (!keys(body, ['mode', 'choices', 'text', 'id', 'obligation', 'allowCustom', 'frameworkRules','itemRules','kindRules','posture','allowedFrameworks','selection', 'managementId', 'context', 'reviewDigest', 'unit'])) throw fail('Unexpected input');
  if (!['enterprise', 'vibe'].includes(body.mode)) throw fail('Unknown mode');
  const expected = {
    draft: ['mode', 'choices', 'text'], policy: ['mode', 'id', 'obligation', 'allowCustom'], 'policy-preview': ['mode', 'id', 'obligation', 'allowCustom'],
    prepare: ['mode'], remove: ['mode', 'managementId'], apply: ['mode', 'id', 'context', 'reviewDigest'],
    check: ['mode'], 'check-claude': ['mode'], inspect: ['mode'], repair: ['mode'], report: ['mode'],
  }[action];
  const allowed = action.startsWith('policy') ? [...expected, 'frameworkRules','itemRules','kindRules','posture','allowedFrameworks','selection'] : ['prepare','check-claude'].includes(action) ? [...expected, 'unit'] : expected;
  if (!keys(body, allowed) || expected.some(key => !(key in body))) throw fail('Invalid action fields');
  if ('unit' in body && !['extensions','superpowers', 'instructions'].includes(body.unit)) throw fail('Unknown installation unit');
  if (action === 'draft' && (!keys(body.choices, ['instructions', 'superpowers','extensions']) || !['instructions','superpowers'].every(key => key in body.choices) || Object.values(body.choices).some(value => typeof value !== 'boolean') || typeof body.text !== 'string' || body.text.length > 12000)) throw fail('Invalid draft');
  if (action.startsWith('policy') && (body.mode !== 'enterprise' || typeof body.id !== 'string' || body.id.length > 120 || !['permitted', 'recommended', 'required', 'prohibited'].includes(body.obligation) || typeof body.allowCustom !== 'boolean')) throw fail('Invalid organization draft');
  for (const field of ['managementId', 'context', 'reviewDigest']) if (field in body && (typeof body[field] !== 'string' || body[field].length > 300)) throw fail('Invalid identifier');
  if ('id' in body && typeof body.id !== 'string') throw fail('Invalid identifier');
}
async function bodyOf(request, limit = 65536) {
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > limit) throw fail('Request exceeds the size limit', 'BODY_LIMIT', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail('Expected JSON'); }
}
function startWorker({ consumer, workspace, mode, sourceCache, recipeCommit, extensionsRecipeCommit, extensionsSourceCache }) {
  const root = join(workspace, mode), home = join(root, 'home');
  return (async () => {
    await mkdir(home, { recursive: true });
    const isolatedEnv = { ...process.env };
    for (const key of Object.keys(isolatedEnv)) if (/^(?:ANTHROPIC_|CLAUDE_|OPENAI_|AWS_|AMAZON_|BEDROCK_|GOOGLE_|GCLOUD_|AZURE_|MSI_|GH_TOKEN$|GITHUB_TOKEN$)/i.test(key)) delete isolatedEnv[key];
    Object.assign(isolatedEnv, { CLAUDE_CONFIG_DIR:join(home,'.claude'), GIT_CONFIG_NOSYSTEM:'1', GIT_CONFIG_GLOBAL:join(home,'.gitconfig'), GIT_TERMINAL_PROMPT:'0' });
    const child = fork(join(here, 'local-worker.mjs'), [consumer, root, mode], {
      cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...isolatedEnv, HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local'), XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local', 'share'), AIH_SOURCE_CACHE: sourceCache || '', AIH_RECIPE_COMMIT: recipeCommit || '', AIH_EXTENSIONS_RECIPE_COMMIT: extensionsRecipeCommit || '', AIH_EXTENSIONS_SOURCE_CACHE: extensionsSourceCache || '' },
    });
    let sequence = 0, pending = new Map(), logs = '';
    child.stderr.on('data', bytes => { logs = (logs + bytes).slice(-4000); });
    child.stdout.on('data', () => {});
    const ready = new Promise((accept, reject) => {
      child.on('message', message => {
        if (message.ready) { accept(); return; }
        const next = pending.get(message.id); if (!next) return;
        pending.delete(message.id);
        message.error ? next.reject(Object.assign(Error(message.error.message), { code: message.error.code, status: message.error.code === 'REVIEW_STALE' ? 409 : 400 })) : next.accept(message.value);
      });
      child.on('exit', () => { const error = fail(`Package host stopped: ${logs}`, 'HOST_STOPPED', 503); reject(error); for (const next of pending.values()) next.reject(error); pending.clear(); });
    });
    await ready;
    return {
      child,
      request(action, body = {}) { return new Promise((accept, reject) => {
        const id = ++sequence;
        // Keep the mutation turn until the child replies or exits. An HTTP timeout must
        // never release a still-running Apply and let a second mutation pass it.
        pending.set(id, { accept, reject }); child.send({ id, action, body });
      }); },
    };
  })();
}

export async function createPrototypeServer({ consumer, workspace, port = 0, sourceCache, recipeCommit = 'baec1884f1d7aa5262535a16d447c1094c258a07', extensionsRecipeCommit = '11734d9017aaf2e2d9c68bcd37eb6202081d5931', extensionsSourceCache } = {}) {
  if (!consumer || !workspace) throw Error('--consumer and --workspace are required');
  consumer = resolve(consumer); workspace = resolve(workspace);
  if (sourceCache) sourceCache = resolve(sourceCache);if (extensionsSourceCache) extensionsSourceCache = resolve(extensionsSourceCache);
  const fullCatalog = await createLocalCatalog(consumer, sourceCache);
  await mkdir(workspace, { recursive: true });
  const canonicalWorkspace = await realpath(workspace);
  if ((await lstat(workspace)).isSymbolicLink() || (process.platform === 'win32' ? canonicalWorkspace.toLowerCase() !== workspace.toLowerCase() : canonicalWorkspace !== workspace)) throw Error('Workspace must be a direct directory');
  const token = randomBytes(32).toString('hex');
  const screen = join(here, '..', '..', 'src', 'workbench');
  const assets = new Map(['index.html', 'workbench.js', 'layout.js'].map(name => [`/${name}`, join(screen, name)]));
  assets.set('/workbench.css', join(screen, '..', 'styles', 'reviewed-workbench.css'));
  assets.set('/tokens.css', join(screen, '..', 'styles', 'tokens.css'));
  const data = JSON.parse(await readFile(join(consumer, 'public', 'provenance.json'), 'utf8'));
  const comparisonFile = join(consumer, 'public', 'workbench', 'comparison.json');
  const comparison = await readFile(comparisonFile, 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const workers = new Map();
  try { for (const mode of ['enterprise', 'vibe']) workers.set(mode, await startWorker({ consumer, workspace, mode, sourceCache, recipeCommit, extensionsRecipeCommit, extensionsSourceCache })); }
  catch (error) { for (const worker of workers.values()) worker.child.kill(); throw error; }
  let origin, mutation = Promise.resolve();
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    const json = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); };
    try {
      if (request.headers.host !== new URL(origin).host || (request.headers.origin && request.headers.origin !== origin)) throw fail('Loopback origin required', 'ORIGIN_DENIED', 403);
      const url = new URL(request.url, origin);
      const v9 = /^\/reports\/(enterprise|vibe)\/([a-f0-9]{64})\.html$/.exec(url.pathname);
      const showcase = /^\/reports\/(enterprise|vibe)\/(?:([a-f0-9]{64})\/)?console\.html$/.exec(url.pathname);
      const reportRoute = showcase || v9;
      if (reportRoute && request.method === 'GET') {
        const html = await workers.get(reportRoute[1]).request(showcase ? 'render-console' : 'render-v9', {digest:reportRoute[2]});
        response.setHeader('Content-Security-Policy', "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'");
        response.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
        return response.end(html);
      }
      if (url.pathname === '/api/session' && request.method === 'GET') return json(200, { token, workspace, packages: data.packages, comparison, enterprise: await workers.get('enterprise').request('state'), vibe: await workers.get('vibe').request('state') });
      if (url.pathname === '/api/catalog' && request.method === 'GET') return json(200, fullCatalog.catalog);
      if (url.pathname === '/api/profiles' && request.method === 'GET') return json(200, await profileLibrary());
      if (url.pathname.startsWith('/api/')) {
        const action = url.pathname.slice(5);
        if (!actions.has(action) || request.method !== 'POST') throw fail('Route not found', 'NOT_FOUND', 404);
        if (request.headers.origin !== origin || request.headers['x-workbench-token'] !== token || request.headers['content-type'] !== 'application/json') throw fail('Session capability required', 'CAPABILITY_DENIED', 403);
        const body = await bodyOf(request, action === 'profile-preview' ? 66560 : 65536); validate(action, body);
        const { mode, ...input } = body;
        if (action.startsWith('policy') && input.frameworkRules !== undefined) {
          const rules = input.frameworkRules;
          const known = fullCatalog.catalog.frameworks.filter(f => f.id !== 'superpowers').map(f => f.id);
          if (!keys(rules, known) || Array.isArray(rules) || !Object.values(rules).every(rule => ['permitted','recommended','required','prohibited'].includes(rule))) throw fail('Choose known Catalog frameworks and valid obligations.');
        }
        if (action.startsWith('policy')) {
          if (input.allowedFrameworks !== undefined && (!Array.isArray(input.allowedFrameworks) || input.allowedFrameworks.length > 1000 || new Set(input.allowedFrameworks).size !== input.allowedFrameworks.length || input.allowedFrameworks.some(id => typeof id !== 'string' || !id || id.length > 300))) throw fail('Choose bounded framework identifiers for this Catalog boundary.');
          if (input.selection !== undefined) {
            if (!keys(input.selection,['items','client']) || !Array.isArray(input.selection.items) || !input.selection.items.length || input.selection.items.length > 100 || !input.selection.items.every(id => typeof id === 'string') || typeof input.selection.client !== 'string') throw fail('Choose a valid Catalog selection for policy impact.');
            const selected = fullCatalog.catalogPreview(input.selection.items,input.selection.client);
            input.selectionRequest = selected.requestParts;
          }
          if (input.posture !== undefined && !['catalog-default','only-selected'].includes(input.posture)) throw fail('Unknown policy posture.');
          for (const [field,known] of [['itemRules',fullCatalog.catalog.items.map(item => item.id)],['kindRules',[...new Set(fullCatalog.catalog.items.map(item => item.kind))]]]) {
            if (input[field] !== undefined && (!keys(input[field],known) || !Object.values(input[field]).every(value => ['permitted','recommended','required','prohibited'].includes(value)))) throw fail('Choose known Catalog items or kinds and valid obligations.');
          }
        }
        if (action === 'record-review') {
          const record = input.itemId ? await fullCatalog.evidence(input.itemId) : null;
          if (['False alarm','Accepted risk'].includes(input.decision) && !record) throw fail('Attach the item or concern being reviewed.');
          if (input.concern && (!keys(input.concern,['tool','ruleId']) || !['tool','ruleId'].every(key => typeof input.concern[key] === 'string' && input.concern[key].length <= 300) || !record?.findings.some(finding => finding.tool === input.concern.tool && finding.ruleId === input.concern.ruleId))) throw fail('Choose a concern from this exact assessment.');
          const reference = url => url && ({url, sha256:fullCatalog.assets.get(url).sha256});
          input.evidence = record && {itemId:record.id, scanKey:record.scanKey, catalogCommit:fullCatalog.catalog.data.commit,
            status:record.status, revision:record.summary?.revision ?? null, verdict:record.verdict ?? null,
            verification:record.verificationLabel ?? null, reason:record.reason ?? null,
            summary:reference(record.summaryUrl) ?? null, bundle:reference(record.bundleUrl) ?? null, findings:record.assets ?? []};
        }
        if (action === 'catalog-prepare') {
          const { requestParts } = fullCatalog.catalogPreview(input.items,input.client);
          const reason = catalogInstallReason(requestParts);
          if (reason) throw fail(reason);
          const operation = mutation.then(() => workers.get(mode).request('catalog-prepare', { parts:requestParts, items:input.items, client:input.client }));
          mutation=operation.catch(()=>{});
          return json(200,await operation);
        }
        if (action === 'profile-preview' || action === 'catalog-plan') {
          const { response: preview, requestParts } = action === 'profile-preview'
            ? fullCatalog.profilePreview(input.profile, input.client)
            : fullCatalog.catalogPreview(input.items, input.client);
          if (mode === 'enterprise') {
            preview.policyNote = 'A complete plan is needed to check admission for the selected client.';
            if (requestParts) {
              const assessment = await workers.get(mode).request('profile-admission', {...requestParts,client:input.client});
              Object.assign(preview, assessment);
            }
          }
          if (action === 'catalog-plan') {
            preview.installReason=catalogInstallReason(requestParts);
            preview.installable=!preview.installReason;
          }
          return json(200, preview);
        }
        if (action === 'catalog-evidence') return json(200, await fullCatalog.evidence(input.itemId));
        const operation = mutation.then(() => workers.get(mode).request(action, input)); mutation = operation.catch(() => {});
        return json(200, await operation);
      }
      if (request.method !== 'GET') throw fail('Route not found', 'NOT_FOUND', 404);
      if (fullCatalog.assets.has(url.pathname)) { const bytes = await fullCatalog.readAsset(url.pathname);response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });return response.end(bytes); }
      const path = assets.get(url.pathname === '/' ? '/index.html' : url.pathname);
      if (!path) throw fail('Route not found', 'NOT_FOUND', 404);
      const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };
      response.writeHead(200, { 'Content-Type': (types[extname(path)] || 'application/octet-stream') + '; charset=utf-8' }); response.end(await readFile(path));
    } catch (error) { if (!response.headersSent) json(error.status || 500, { code: error.code || 'HOST_ERROR', message: error.message }); else response.end(); }
  });
  server.requestTimeout = 150000; server.headersTimeout = 10000;
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', accept); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, workspace, async close() { for (const worker of workers.values()) worker.child.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = { '--consumer': 'consumer', '--workspace': 'workspace', '--port': 'port', '--source-cache': 'sourceCache', '--recipe-commit': 'recipeCommit', '--extensions-recipe-commit': 'extensionsRecipeCommit', '--extensions-source-cache': 'extensionsSourceCache' }[args[i]];
    if (!key || !args[i + 1]) throw Error('Expected --consumer <dir> --workspace <dir> [--port <port>] [--source-cache <file>] [--recipe-commit <commit>]');
    options[key] = key === 'port' ? Number(args[i + 1]) : args[i + 1];
  }
  const host = await createPrototypeServer(options);
  console.log(JSON.stringify({ url: host.origin, workspace: host.workspace }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await host.close(); process.exit(0); });
}
