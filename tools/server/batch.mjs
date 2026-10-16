// The fixture file is host configuration. HTTP can name only a batch and a choice,
// never a target, home, material root, fault, policy or prepared handle.
import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { callService } from './service-client.mjs';

const MAX_BODY = 64 * 1024;
const ROUTES = { '/api/batch': 'GET', '/api/batch-review': 'POST', '/api/batch-run': 'POST', '/api/batch-recover': 'POST', '/api/batch-continuation': 'POST' };
const CLIENT_NOTE = 'Listed by Core; not checked as installed or connected';
const reply = (response, code, value) => response.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(value));
const problem = (message, code = 'INVALID_REQUEST') => Object.assign(new Error(message), { code });
const valueOf = result => {
  if (result?.status && result.status !== 'ok') throw problem(result.diagnostics?.map(item => item.message ?? item.reason ?? item.code).join('; ') || 'Batch operation refused.', 'BATCH_REFUSED');
  return result?.value ?? result;
};
async function readBody(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size <= MAX_BODY) chunks.push(chunk); }
  if (size > MAX_BODY) throw problem(`The request body is larger than ${MAX_BODY} bytes.`, 'PAYLOAD_TOO_LARGE');
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw problem('The request body must be a JSON object.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw problem('The request body must be a JSON object.');
  return body;
}
async function replaceEnvelope(path, bytes) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 }); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}

export function createBatchAdapter(consumerDir) {
  const fixturePath = process.env.AIH_BATCH_FIXTURE;
  let queue = Promise.resolve(), closed = false;
  // Reads, edits and execution share a queue. Durable bytes are read again for
  // every request, and no review session survives a request or a reload.
  const exclusive = operation => {
    const pending = queue.then(operation);
    queue = pending.catch(() => {});
    return pending;
  };
  async function operate(pathname, body) {
    if (closed) throw problem('The batch adapter is closed.', 'BATCH_HOST_UNAVAILABLE');
    if (!fixturePath) return { status: 'unavailable', message: 'No batch host is configured.' };
    const config = JSON.parse(await readFile(fixturePath, 'utf8'));
    if (![config.envelopePath, config.materialRoot, config.homes?.a, config.homes?.b].every(path => typeof path === 'string' && isAbsolute(path))) {
      throw problem('Batch fixture requires absolute envelopePath, materialRoot and homes.a/homes.b.', 'BATCH_HOST_UNAVAILABLE');
    }
    const load = name => import(pathToFileURL(join(consumerDir, 'consumer', name)).href);
    const [{ readBatch, projectBatch, setContinuation }, { createBatchHost }] = await Promise.all([load('batch.mjs'), load('batch-host.mjs')]);
    const envelopeBytes = new Uint8Array(await readFile(config.envelopePath));
    const current = valueOf(await readBatch({ envelopeBytes }));
    const record = current.record;
    if (!record?.id) throw problem('The envelope has no current reviewed batch.', 'BATCH_REFUSED');
    const clients = callService(consumerDir, { op: 'coreTargets' });
    if (!clients.ok) throw problem(clients.error ?? 'Core client list unavailable.', 'BATCH_HOST_UNAVAILABLE');
    const projection = projectBatch(record);
    if (pathname === '/api/batch') return { status: 'ok', batchId: record.id, projection, clients: { targets: clients.targets, labels: clients.labels }, note: CLIENT_NOTE };
    if (body.batchId !== record.id) throw problem('The current batch changed. Reopen and review it again.', 'BATCH_CHANGED');
    if (pathname === '/api/batch-continuation') {
      const edited = valueOf(await setContinuation({ envelopeBytes, batchId: record.id, continuation: body.continuation, now: new Date().toISOString() }));
      await replaceEnvelope(config.envelopePath, edited.envelopeBytes);
      return { status: 'ok', batchId: edited.record.id, projection: projectBatch(edited.record) };
    }
    const host = createBatchHost({ scopeRoots: config.homes, clients: clients.targets,
      materialRoots: Object.fromEntries(record.inputs.map(input => [input.id, config.materialRoot])), controls: { logging: 'off' }, faults: config.faults });
    try {
      if (pathname === '/api/batch-review') return { status: 'ok', batchId: record.id, review: valueOf(await host.reviewBatch({ envelopeBytes, batchId: record.id })) };
      if (pathname === '/api/batch-run') return { status: 'ok', batchId: record.id,
        report: valueOf(await host.runBatch({ envelopeBytes, batchId: record.id, approve: { batchId: record.id } })) };
      const recovered = valueOf(await host.recoverBatch({ envelopeBytes, batchId: record.id, now: new Date().toISOString() }));
      await replaceEnvelope(config.envelopePath, recovered.envelopeBytes);
      return { status: 'ok', batchId: recovered.record.id, projection: projectBatch(recovered.record), review: recovered.review };
    } finally { await host.close?.(); }
  }
  return {
    close() { closed = true; },
    async handle(request, response, pathname) {
      if (pathname !== '/api/batch' && !pathname.startsWith('/api/batch-')) return false;
      const fail = (status, message, code) => reply(response, status, { status: 'error', diagnostics: [{ code, message }] });
      if (!ROUTES[pathname]) { fail(404, 'No such batch endpoint.', 'NOT_FOUND'); return true; }
      if (request.method !== ROUTES[pathname]) { fail(405, `${pathname} accepts ${ROUTES[pathname]} only.`, 'METHOD_NOT_ALLOWED'); return true; }
      const origin = `http://${request.headers.host}`;
      if (![`127.0.0.1:${request.socket.localPort}`, `localhost:${request.socket.localPort}`].includes(request.headers.host)
        || request.headers['sec-fetch-site'] === 'cross-site' || (request.headers.origin && request.headers.origin !== origin)
        || (request.method === 'POST' && request.headers.origin !== origin)) {
        fail(403, 'Same-origin batch request required.', 'FORBIDDEN'); return true;
      }
      try {
        let body;
        if (request.method === 'POST') {
          if (!/^application\/json\s*(;|$)/i.test(request.headers['content-type'] ?? '')) { fail(415, 'Content-Type must be application/json.', 'UNSUPPORTED_MEDIA_TYPE'); return true; }
          body = await readBody(request);
          const keys = pathname === '/api/batch-continuation' ? ['batchId', 'continuation'] : ['batchId'];
          if (Object.keys(body).some(key => !keys.includes(key)) || !/^batch-[a-f0-9]{32}$/.test(body.batchId ?? '')
            || (keys.includes('continuation') && !['stop', 'continue-independent'].includes(body.continuation))) throw problem('Only the current batchId and the supported continuation choice are accepted.');
        }
        reply(response, 200, await exclusive(() => operate(pathname, body)));
      } catch (error) {
        const code = error.code ?? 'BATCH_HOST_UNAVAILABLE';
        fail(({ INVALID_REQUEST: 400, PAYLOAD_TOO_LARGE: 413, BATCH_CHANGED: 409, BATCH_REFUSED: 409 })[code] ?? 502,
          error.message, code);
      }
      return true;
    },
  };
}
