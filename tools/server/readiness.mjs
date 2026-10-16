// Machine-readiness routes. Core runs in a forked child so the host chooses its environment;
// the page only ever sees the serializable projections the child returns. AIH_READINESS_HOME,
// AIH_READINESS_PATH and AIH_READINESS_REPAIRS are host/test inputs, never HTTP inputs.
import { fork } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const MAX_BODY = 64 * 1024;
const TIMEOUT_MS = { check: 200_000, 'repair-prepare': 120_000, 'repair-apply': 120_000, repairs: 10_000, report: 30_000 };
const ROUTES = { '/api/readiness-report': ['GET', 'report'], '/api/readiness-check': ['POST', 'check'], '/api/readiness-repairs': ['GET', 'repairs'],
  '/api/readiness-repair-prepare': ['POST', 'repair-prepare'], '/api/readiness-repair-apply': ['POST', 'repair-apply'] };
// lost and rejected are decisions the page renders from the body status, not transport failures.
const HTTP_STATUS = { ok: 200, lost: 200, rejected: 200 };

// Same layout as tools/consumer/readiness-fixture.mjs, so a demo points Core at one disposable home.
function homeEnvironment(home) {
  const layout = { HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local'),
    XDG_CONFIG_HOME: join(home, '.config'), XDG_STATE_HOME: join(home, '.local', 'state'), XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_CACHE_HOME: join(home, '.cache') };
  for (const directory of Object.values(layout)) mkdirSync(directory, { recursive: true });
  return layout;
}

export function createReadinessAdapter(consumerDir) {
  let child = null;
  const pending = new Map();
  let counter = 0;

  const settleAll = reason => {
    for (const [id, entry] of pending) { clearTimeout(entry.timer); entry.reject(Object.assign(new Error(reason), { unavailable: true })); pending.delete(id); }
  };
  // Killing the child drops its retained sessions; the next request starts a clean one and
  // an old session id then answers `lost`.
  const stop = reason => {
    const dying = child; child = null;
    if (dying) { dying.removeAllListeners(); dying.on('error', () => {}); dying.kill(); }
    settleAll(reason);
  };
  function start() {
    const env = { ...process.env, ...(process.env.AIH_READINESS_HOME ? homeEnvironment(process.env.AIH_READINESS_HOME) : {}),
      ...(process.env.AIH_READINESS_PATH ? { PATH: process.env.AIH_READINESS_PATH } : {}) };
    const next = fork(join(consumerDir, 'consumer/readiness-child.mjs'), [], { cwd: consumerDir, env, windowsHide: true,
      serialization: 'json', stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    next.stderr.resume();
    next.on('message', message => {
      const entry = pending.get(message?.id);
      if (!entry) return;
      clearTimeout(entry.timer); pending.delete(message.id); entry.resolve(message.result);
    });
    const gone = () => { if (child === next) { child = null; settleAll('The readiness host stopped.'); } };
    next.on('exit', gone); next.on('error', gone);
    return next;
  }
  const call = (op, body) => new Promise((resolve, reject) => {
    child ??= start();
    const id = ++counter;
    const timer = setTimeout(() => stop(`The readiness host did not answer ${op} in time.`), TIMEOUT_MS[op]);
    pending.set(id, { resolve, reject, timer });
    child.send({ id, op, body }, error => { if (error) stop(error.message); });
  });

  const reply = (response, code, payload) => response.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    .end(JSON.stringify(payload));
  const refuse = (response, code, message, reason = 'INVALID_REQUEST') => reply(response, code, { status: 'error', diagnostics: [{ code: reason, message }] });
  async function readBody(request) {
    const chunks = []; let size = 0;
    // Drain an oversized body instead of returning mid-stream, so the client receives the 413.
    for await (const chunk of request) {
      size += chunk.length;
      if (size <= MAX_BODY) chunks.push(chunk);
    }
    if (size > MAX_BODY) return { tooLarge: true };
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
      return value !== null && typeof value === 'object' && !Array.isArray(value) ? { value } : { malformed: true };
    } catch { return { malformed: true }; }
  }

  return {
    close() { stop('The readiness host was closed.'); },
    async handle(request, response, pathname) {
      if (!pathname.startsWith('/api/readiness-')) return false;
      const route = ROUTES[pathname];
      if (!route) { refuse(response, 404, `No such readiness endpoint: ${pathname}`, 'NOT_FOUND'); return true; }
      const [method, op] = route;
      if (request.method !== method) { refuse(response, 405, `${pathname} accepts ${method} only.`, 'METHOD_NOT_ALLOWED'); return true; }
      const origin = `http://${request.headers.host}`;
      const port = request.socket.localPort;
      if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host) || request.headers['sec-fetch-site'] === 'cross-site'
        || (request.headers.origin && request.headers.origin !== origin) || (method === 'POST' && request.headers.origin !== origin)) {
        refuse(response, 403, 'Same-origin readiness request required.', 'FORBIDDEN'); return true;
      }
      let body;
      if (method === 'POST') {
        if (!/^application\/json\s*(;|$)/i.test(request.headers['content-type'] ?? '')) { refuse(response, 415, 'Content-Type must be application/json.', 'UNSUPPORTED_MEDIA_TYPE'); return true; }
        const read = await readBody(request).catch(() => ({ aborted: true }));
        if (read.aborted) { refuse(response, 400, 'The request body could not be read.'); return true; }
        if (read.tooLarge) { refuse(response, 413, `The request body is larger than ${MAX_BODY} bytes.`, 'PAYLOAD_TOO_LARGE'); return true; }
        if (read.malformed) { refuse(response, 400, 'The request body must be a JSON object.'); return true; }
        body = read.value;
      }
      try {
        const result = await call(op, body);
        reply(response, HTTP_STATUS[result?.status] ?? (result?.diagnostics?.[0]?.code === 'INVALID_REQUEST' ? 400 : 500), result);
      } catch (error) {
        refuse(response, error.unavailable ? 502 : 500, `Readiness host unavailable: ${error.message}`, 'READINESS_HOST_UNAVAILABLE');
      }
      return true;
    },
  };
}
