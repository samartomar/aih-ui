// V9 report rendering for the report page. The page posts a saved snapshot document; the host validates
// it with the installed @aihq/core/report and renders it with the Workbench's own renderer
// (src/report/render.js), the same one tools/render-report.mjs uses. Rendering reads no file and
// collects nothing; the snapshot is the only input.
import { loadReportRenderer, renderSnapshotText, SNAPSHOT_MAX_BYTES } from '../report/core-report.mjs';

const ROUTE = '/api/report-render';
const MODES = new Set(['report', 'demo']);

export function createReportAdapter(consumerDir) {
  let renderer = null;
  const reply = (response, code, payload) => response.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    .end(JSON.stringify(payload));
  const refuse = (response, code, reason, message) => reply(response, code, { status: 'error', diagnostics: [{ code: reason, message }] });
  async function readText(request) {
    const chunks = []; let size = 0;
    // Drain an oversized body instead of returning mid-stream, so the client receives the 413.
    for await (const chunk of request) { size += chunk.length; if (size <= SNAPSHOT_MAX_BYTES) chunks.push(chunk); }
    return size > SNAPSHOT_MAX_BYTES ? null : Buffer.concat(chunks).toString('utf8');
  }

  return {
    async handle(request, response, pathname) {
      if (pathname !== ROUTE) return false;
      if (request.method !== 'POST') { refuse(response, 405, 'METHOD_NOT_ALLOWED', `${ROUTE} accepts POST only.`); return true; }
      const origin = `http://${request.headers.host}`, port = request.socket.localPort;
      if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host) || request.headers['sec-fetch-site'] === 'cross-site'
        || request.headers.origin !== origin) { refuse(response, 403, 'FORBIDDEN', 'Same-origin report request required.'); return true; }
      if (!/^application\/json\s*(;|$)/i.test(request.headers['content-type'] ?? '')) { refuse(response, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.'); return true; }
      const mode = new URL(request.url, 'http://127.0.0.1').searchParams.get('mode') ?? 'report';
      if (!MODES.has(mode)) { refuse(response, 400, 'INVALID_REQUEST', 'mode must be report or demo.'); return true; }
      const text = await readText(request).catch(() => undefined);
      if (text === undefined) { refuse(response, 400, 'INVALID_REQUEST', 'The request body could not be read.'); return true; }
      if (text === null) { refuse(response, 413, 'PAYLOAD_TOO_LARGE', `A snapshot is at most ${SNAPSHOT_MAX_BYTES} bytes.`); return true; }
      try { renderer ??= await loadReportRenderer(consumerDir); } catch (error) {
        refuse(response, 502, 'REPORT_UNAVAILABLE', `The report data interface is unavailable: ${error.message}`); return true;
      }
      const result = renderSnapshotText(renderer, text, { mode });
      if (result.status !== 'ok') {
        reply(response, 422, { status: 'error', diagnostics: result.errors.map(message => ({ code: result.code, message })) }); return true;
      }
      reply(response, 200, { status: 'ok', mode, coreVersion: renderer.version, html: result.html });
      return true;
    },
  };
}
