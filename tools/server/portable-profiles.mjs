import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { readProfile } from '../../src/approved/profiles.js';

const LIMIT = 1024 * 1024;

export function createPortableProfiles(configured = process.env.AIH_WORKBENCH_PROFILES) {
  async function profiles() {
    if (!configured) return { status: 'unconfigured', profiles: [] };
    if (!isAbsolute(configured)) return { status: 'unavailable', profiles: [] };
    let file;
    try {
      file = await open(configured);
      const info = await file.stat();
      if (!info.isFile() || info.size > LIMIT) return { status: 'unavailable', profiles: [] };
      const buffer = Buffer.alloc(LIMIT + 1);
      const { bytesRead } = await file.read(buffer);
      if (bytesRead !== info.size) return { status: 'unavailable', profiles: [] };
      const values = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
      if (!Array.isArray(values) || values.length > 100) return { status: 'unavailable', profiles: [] };
      const accepted = values.flatMap(value => {
        try { return [readProfile(value)]; } catch { return []; }
      });
      return { status: accepted.length === values.length ? 'ready' : 'partial', profiles: accepted };
    } catch {
      return { status: 'unavailable', profiles: [] };
    } finally {
      await file?.close();
    }
  }

  return async function handle(request, response, pathname) {
    if (pathname !== '/api/approved-profiles') return false;
    const { host, origin } = request.headers;
    const loopback = [`127.0.0.1:${request.socket.localPort}`, `localhost:${request.socket.localPort}`].includes(host);
    const allowed = loopback && (!origin || origin === `http://${host}`) && request.headers['sec-fetch-site'] !== 'cross-site';
    const status = !allowed ? 403 : request.method !== 'GET' ? 405 : 200;
    const body = status === 200 ? await profiles() : { status: 'refused', profiles: [] };
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify(body));
    return true;
  };
}
