// The fixture file is host configuration. HTTP can name only a batch and a choice,
// never a target, home, material root, fault, policy or prepared handle.
import { fork } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { callService } from './service-client.mjs';
import { homeEnvironment } from '../consumer/home-environment.mjs';
import { replaceEnvelope } from '../consumer/envelope-file.mjs';

const MAX_BODY = 64 * 1024;
const ROUTES = { '/api/batch': 'GET', '/api/batch-review': 'POST', '/api/batch-run': 'POST', '/api/batch-recover': 'POST', '/api/batch-continuation': 'POST' };
const TIMEOUT_MS = { review: 120_000, run: 300_000, recover: 120_000 };
// Decisions the page renders from the body: a refusal is a conflict with the current state (409), unavailable means no host is configured.
const HTTP_STATUS = { ok: 200, unavailable: 200, refused: 409 };
const reply = (response, code, value) => response.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(value));
const problem = (message, code = 'INVALID_REQUEST') => Object.assign(new Error(message), { code });
const refusal = (code, message) => ({ status: 'refused', diagnostics: [{ code, message }] });
// A module or host answer goes to the page as it is (codes, paths, `review`); only bytes the page never needs are dropped.
const passed = ({ originalBytes: _held, ...rest }) => rest;
const statusOf = result => HTTP_STATUS[result?.status] ?? (result?.diagnostics?.[0]?.code === 'INVALID_REQUEST' ? 400 : 500);
async function readBody(request) {
  const chunks = []; let size = 0;
  // Drain an oversized body instead of returning mid-stream, so the client receives the 413.
  for await (const chunk of request) { size += chunk.length; if (size <= MAX_BODY) chunks.push(chunk); }
  if (size > MAX_BODY) return { tooLarge: true };
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? { value } : { malformed: true };
  } catch { return { malformed: true }; }
}

export function createBatchAdapter(consumerDir) {
  const fixturePath = process.env.AIH_BATCH_FIXTURE;
  let queue = Promise.resolve(), closed = false, listed, child = null, childKey = null;
  const pending = new Map();
  let counter = 0;
  // The batch module lives in the installed consumer, so its constants are read from there once, never repeated here.
  let batchModule;
  const loadBatch = () => batchModule ??= import(pathToFileURL(join(consumerDir, 'consumer', 'batch.mjs')).href);
  const settleAll = reason => {
    for (const [id, entry] of pending) { clearTimeout(entry.timer); entry.reject(problem(reason, 'BATCH_HOST_UNAVAILABLE')); pending.delete(id); }
  };
  // Core runs in a forked child whose account home is the fixture's `coreHome`, never the developer's. The child also gets the
  // envelope file's path (from the fixture, never a request) so that it can make a spent Run again choice durable before a process
  // runs. Killing the child drops nothing durable: the envelope file is the only state, and every request starts from its bytes.
  const stop = reason => {
    const dying = child; child = null; childKey = null;
    if (dying) { dying.removeAllListeners(); dying.on('error', () => {}); dying.kill(); }
    settleAll(reason);
  };
  function start(coreHome, envelopePath) {
    const env = { ...process.env, ...homeEnvironment(coreHome), AIH_BATCH_CORE_HOME: coreHome, AIH_BATCH_ENVELOPE: envelopePath };
    const next = fork(join(consumerDir, 'consumer/batch-child.mjs'), [], { cwd: consumerDir, env, windowsHide: true,
      serialization: 'json', stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    next.stderr.resume();
    next.on('message', message => {
      const entry = pending.get(message?.id);
      if (!entry) return;
      clearTimeout(entry.timer); pending.delete(message.id); entry.resolve(message.result);
    });
    const gone = () => { if (child === next) { child = null; childKey = null; settleAll('The batch host stopped.'); } };
    next.on('exit', gone); next.on('error', gone);
    return next;
  }
  const call = (coreHome, envelopePath, op, body) => new Promise((resolve, reject) => {
    const key = JSON.stringify([coreHome, envelopePath]);
    if (child && childKey !== key) stop('The batch host was restarted for a different Core home or envelope file.');
    if (!child) { child = start(coreHome, envelopePath); childKey = key; }
    const id = ++counter;
    const timer = setTimeout(() => stop(`The batch host did not answer ${op} in time.`), TIMEOUT_MS[op]);
    pending.set(id, { resolve, reject, timer });
    child.send({ id, op, body }, error => { if (error) stop(error.message); });
  });
  // Reads, edits and execution share a queue. Durable bytes are read again for
  // every request, and no review session survives a request or a reload.
  const exclusive = operation => {
    const running = queue.then(operation);
    queue = running.catch(() => {});
    return running;
  };
  async function operate(pathname, body) {
    if (closed) throw problem('The batch adapter is closed.', 'BATCH_HOST_UNAVAILABLE');
    if (!fixturePath) return { status: 'unavailable', diagnostics: [{ code: 'BATCH_HOST_UNCONFIGURED', message: 'No batch host is configured.' }] };
    const config = JSON.parse(await readFile(fixturePath, 'utf8'));
    if (![config.envelopePath, config.materialRoot].every(path => typeof path === 'string' && isAbsolute(path))) {
      throw problem('Batch fixture requires absolute envelopePath and materialRoot.', 'BATCH_HOST_UNAVAILABLE');
    }
    // Core writes protected records into the current account's home; with no disposable home named, nothing starts.
    if (typeof config.coreHome !== 'string' || !isAbsolute(config.coreHome)) throw problem('No isolated Core home is configured.', 'BATCH_HOST_UNAVAILABLE');
    const { readBatch, setContinuation } = await loadBatch();
    const envelopeBytes = new Uint8Array(await readFile(config.envelopePath));
    const read = await readBatch({ envelopeBytes });
    if (read.status !== 'ok') return passed(read);
    const { record, projection, supported } = read.value;
    // Core's published client list is fixed for the installed archive, so it is asked for once.
    listed ??= callService(consumerDir, { op: 'coreTargets' });
    const clients = listed;
    if (!clients.ok) { listed = undefined; throw problem(clients.error ?? 'Core client list unavailable.', 'BATCH_HOST_UNAVAILABLE'); }
    if (pathname === '/api/batch') return { status: 'ok', batchId: record.id, projection, supported, clients: { targets: clients.targets, labels: clients.labels } };
    if (body.batchId !== record.id) return refusal('BATCH_CHANGED', 'The current batch changed. Reopen and review it again.');
    if (pathname === '/api/batch-continuation') {
      const edited = await setContinuation({ envelopeBytes, batchId: record.id, continuation: body.continuation, now: new Date().toISOString() });
      if (edited.status !== 'ok') return passed(edited);
      await replaceEnvelope(config.envelopePath, edited.value.envelopeBytes);
      return { status: 'ok', batchId: edited.value.record.id, projection: edited.value.projection };
    }
    const materialRoots = Object.fromEntries(record.inputs.map(input => [input.id, config.materialRoot]));
    const ask = (op, extra) => call(config.coreHome, config.envelopePath, op, { envelope: Buffer.from(envelopeBytes).toString('base64'), batchId: record.id,
      clients: clients.targets, materialRoots, faults: config.faults, ...extra });
    if (pathname === '/api/batch-review') { const review = await ask('review'); return review.status === 'ok' ? { status: 'ok', batchId: record.id, review } : review; }
    if (pathname === '/api/batch-run') {
      const report = await ask('run', { approve: { batchId: record.id }, now: new Date().toISOString() });
      if (report.status !== 'ok') return report;
      // Running an opaque process spends the person's choice in a superseding batch the child already wrote to the envelope file.
      // The page is shown that record as it now stands, read from the file, never rebuilt from what it sent.
      // Work has run by now, so a failed re-read never turns the report into a refusal: the report is returned without `current`.
      const after = await readFile(config.envelopePath).then(bytes => readBatch({ envelopeBytes: new Uint8Array(bytes) }), error => ({ status: 'error', diagnostics: [{ code: 'BATCH_ENVELOPE_UNREADABLE', message: error.message }] }));
      if (after.status !== 'ok') return { status: 'ok', batchId: record.id, report, diagnostics: after.diagnostics };
      return { status: 'ok', batchId: record.id, report, current: { batchId: after.value.record.id, projection: after.value.projection } };
    }
    const recovered = await ask('recover', { now: new Date().toISOString(), rerun: body.rerun });
    if (recovered.status !== 'ok') return recovered;
    await replaceEnvelope(config.envelopePath, new Uint8Array(Buffer.from(recovered.envelope, 'base64')));
    return { status: 'ok', batchId: recovered.record.id, projection: recovered.projection, review: recovered.review };
  }
  return {
    close() { closed = true; stop('The batch adapter was closed.'); },
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
          const read = await readBody(request).catch(() => ({ aborted: true }));
          if (read.aborted) { fail(400, 'The request body could not be read.', 'INVALID_REQUEST'); return true; }
          if (read.tooLarge) { fail(413, `The request body is larger than ${MAX_BODY} bytes.`, 'PAYLOAD_TOO_LARGE'); return true; }
          if (read.malformed) { fail(400, 'The request body must be a JSON object.', 'INVALID_REQUEST'); return true; }
          body = read.value;
          const { BATCH_ID_PATTERN, CONTINUATIONS, MAX_ACTIONS } = await loadBatch();
          const keys = { '/api/batch-continuation': ['batchId', 'continuation'], '/api/batch-recover': ['batchId', 'rerun'] }[pathname] ?? ['batchId'];
          const names = body.rerun === undefined || (Array.isArray(body.rerun) && body.rerun.length <= MAX_ACTIONS && body.rerun.every(id => typeof id === 'string' && id.length <= 64));
          if (Object.keys(body).some(key => !keys.includes(key)) || !BATCH_ID_PATTERN.test(body.batchId ?? '') || !names
            || (keys.includes('continuation') && !CONTINUATIONS.includes(body.continuation))) { fail(400, 'Only the current batchId, the supported continuation choice and the actions to run again are accepted.', 'INVALID_REQUEST'); return true; }
        }
        const result = await exclusive(() => operate(pathname, body));
        reply(response, statusOf(result), result);
      } catch (error) {
        fail(error.code === 'INVALID_REQUEST' ? 400 : 502, error.message, error.code ?? 'BATCH_HOST_UNAVAILABLE');
      }
      return true;
    },
  };
}
