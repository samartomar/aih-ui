// The staged TLS-interception condition: a sample of what a corporate inspection proxy does to a developer machine. Core's Node
// certificate probe for registry.npmjs.org then fails with a certificate-chain error, and the offered CA repair is a real,
// verifiable one. Everything is confined to the candidate: a generated sample CA, an interceptor on loopback, and environment
// variables that only the processes the candidate's server starts afterwards inherit. Nothing in the machine's trust store,
// npm configuration, PATH or user environment is touched, and the CA's private key is never kept.
import { X509Certificate, createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import tls from 'node:tls';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSampleCa } from './sample-ca.mjs';

export const STAGED_CONDITION_SCHEMA = 'urn:aih-ui:candidate-staged-condition:1.0.0';
export const STAGED_LABEL = 'Staged condition active: TLS interception (sample)';
export const TLS_ROUTE_MODULE = fileURLToPath(new URL('./tls-route.mjs', import.meta.url));
const HOSTS = Object.freeze(['registry.npmjs.org']);
const OFF_COMMAND = 'node tools/candidate.mjs tls-interception off';
const fold = name => (process.platform === 'win32' ? name.toUpperCase() : name);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const files = layout => ({ condition: join(layout.stagedTls, 'condition.json'), ca: join(layout.stagedTls, 'sample-ca.pem'), cert: join(layout.stagedTls, 'interceptor.pem'),
  key: join(layout.stagedTls, 'interceptor-key.pem'), notice: join(layout.stagedTls, 'STAGED.md') });

// A repair applied earlier must not hide the staged failure, so the readiness sample is made again by the next start: its folder
// goes, and so does its entry in the record of samples already made (samples.mjs makes any sample with no entry).
function resetReadinessSample(layout) {
  rmSync(layout.readiness, { recursive: true, force: true, maxRetries: 3 });
  const recordPath = join(layout.samples, '.seeded.json');
  let record;
  try { record = JSON.parse(readFileSync(recordPath, 'utf8')); } catch { return; }
  if (record?.samples && 'readiness' in record.samples) {
    delete record.samples.readiness;
    writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  }
}

const noticeText = hosts => `# Staged sample condition: TLS interception

This is a **staged sample condition**, made on purpose by \`node tools/candidate.mjs tls-interception on\`. It is not a fault on this machine.

What it does: while the candidate runs, an inspecting proxy built from a generated sample certificate authority stands between the candidate's own
services and ${hosts.join(', ')}. It decrypts the connection with a certificate that authority signed, then connects to the real host and relays the
traffic, as a corporate inspection proxy does. Core's Node certificate check for ${hosts.join(', ')} therefore fails (certificate chain) until the
offered npm CA repair is prepared and applied. The operating-system certificate check is deliberately not affected.

Who sees it: only the processes the candidate's server starts after installing its packages (the readiness check and what it runs). This machine's
certificate store, npm configuration, environment, PATH and every other program are untouched. The sample authority's private key was never saved.

Turn it off: \`${OFF_COMMAND}\` (the candidate must not be running). The next start then makes a fresh readiness sample.
`;

export function stageTlsInterception(layout, { now = new Date() } = {}) {
  rmSync(layout.stagedTls, { recursive: true, force: true, maxRetries: 3 });
  mkdirSync(layout.stagedTls, { recursive: true });
  const { caPem, leafPem, leafKeyPem } = createSampleCa({ hosts: [...HOSTS], now });
  const at = files(layout);
  writeFileSync(at.ca, caPem);
  writeFileSync(at.cert, leafPem);
  writeFileSync(at.key, leafKeyPem, { mode: 0o600 });
  writeFileSync(at.notice, noticeText(HOSTS));
  const condition = { schema: STAGED_CONDITION_SCHEMA, condition: 'tls-interception', stagedAt: now.toISOString(), hosts: [...HOSTS], caSha256: sha256(new X509Certificate(caPem).raw) };
  // Written last: the condition counts as staged only once everything else is in place.
  writeFileSync(at.condition, `${JSON.stringify(condition, null, 2)}\n`);
  resetReadinessSample(layout);
  return condition;
}

// Idempotent. Says whether anything was there to remove; the readiness sample is made again only then.
export function unstageTlsInterception(layout) {
  const changed = existsSync(layout.stagedTls) || existsSync(layout.stagedRepairs);
  rmSync(layout.stagedTls, { recursive: true, force: true, maxRetries: 3 });
  rmSync(layout.stagedRepairs, { force: true });
  // The folder that held it, once empty.
  try { rmdirSync(dirname(layout.stagedTls)); } catch { /* not empty, or already gone */ }
  if (changed) resetReadinessSample(layout);
  return { changed };
}

// The parsed condition when it is staged and complete (its files exist and the recorded digest is the CA's), else null.
export function stagedTlsCondition(layout) {
  const at = files(layout);
  try {
    const condition = JSON.parse(readFileSync(at.condition, 'utf8'));
    if (condition?.schema !== STAGED_CONDITION_SCHEMA || condition.condition !== 'tls-interception' || !Array.isArray(condition.hosts) || !condition.hosts.length || typeof condition.caSha256 !== 'string') return null;
    for (const file of [at.cert, at.key]) if (!existsSync(file)) return null;
    return sha256(new X509Certificate(readFileSync(at.ca)).raw) === condition.caSha256 ? condition : null;
  } catch { return null; }
}

// Starts the interceptor on loopback with two listeners that share one TLS terminator: an HTTP proxy that accepts only
// `CONNECT <listed host>:443` (npm's own proxy setting reaches the registry this way), and a direct TLS port (where the preload
// reroutes the Node probe). The terminator answers with the sample leaf, then relays to the real host as a client would, so the
// upstream is verified with default trust (plus `upstreamCa`, which only tests supply).
export async function startInterceptor({ layout, condition = stagedTlsCondition(layout), log = layout.tlsLog, upstream = { host: 'registry.npmjs.org', port: 443 }, upstreamCa } = {}) {
  if (!condition) throw Object.assign(new Error('The TLS-interception condition is not staged.'), { code: 'CANDIDATE_NOT_STAGED' });
  const at = files(layout), hosts = condition.hosts.map(host => host.toLowerCase());
  mkdirSync(dirname(log), { recursive: true });
  const record = line => { try { appendFileSync(log, `${new Date().toISOString()} ${line}\n`); } catch { /* logging is never a reason to fail a connection */ } };
  const counts = { intercepted: 0, refusedByClient: 0, upstreamErrors: 0, connectAccepted: 0, connectRefused: 0 };
  const sockets = new Set();
  const track = socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); };
  const ca = upstreamCa ? [...tls.rootCertificates, upstreamCa] : undefined;

  const terminator = tls.createServer({ key: readFileSync(at.key), cert: readFileSync(at.cert) }, clear => {
    track(clear);
    // The server name the client asked for, when it is a listed host: that is the name the real host must answer to.
    const wanted = clear.servername?.toLowerCase();
    const servername = upstream.servername ?? (hosts.includes(wanted) ? wanted : upstream.host);
    counts.intercepted++;
    record(`intercepted ${servername}; relaying to ${upstream.host}:${upstream.port}`);
    const onward = tls.connect({ host: upstream.host, port: upstream.port, servername, ...(ca ? { ca } : {}) });
    track(onward);
    onward.on('error', error => { counts.upstreamErrors++; record(`upstream error for ${servername}: ${error.code ?? ''} ${error.message}`); clear.destroy(); });
    clear.on('error', () => onward.destroy());
    clear.pipe(onward).pipe(clear);
  });
  // A client that rejects the sample chain ends the handshake, but so does a probe that only needed the handshake and hung up
  // before this side finished it; the error alone cannot tell the two apart.
  terminator.on('tlsClientError', error => { counts.refusedByClient++; record(`handshake ended by the client (an untrusted chain, or a probe that closed early): ${error.code ?? ''} ${error.message}`); });

  const proxy = createServer((request, response) => {
    counts.connectRefused++;
    record(`refused ${request.method} ${request.url}: only CONNECT to a listed host is answered`);
    response.writeHead(403, { 'content-type': 'text/plain', connection: 'close' }).end('Forbidden\n');
  });
  proxy.on('connect', (request, socket, head) => {
    track(socket);
    socket.on('error', () => {});
    const [host, port] = String(request.url).split(/:(?=\d+$)/);
    if (!hosts.includes(String(host).toLowerCase()) || port !== '443') {
      counts.connectRefused++;
      record(`refused CONNECT ${request.url}: only ${hosts.map(name => `${name}:443`).join(', ')} is answered`);
      socket.end('HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\nconnection: close\r\n\r\n');
      return;
    }
    counts.connectAccepted++;
    record(`CONNECT ${request.url} accepted`);
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head?.length) socket.unshift(head);
    terminator.emit('connection', socket);
  });

  const listen = server => new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', () => { server.off('error', fail); done(server.address().port); }); });
  const tlsPort = await listen(terminator), proxyPort = await listen(proxy);
  return {
    proxyPort, tlsPort,
    counts: () => ({ ...counts }),
    async close() {
      for (const socket of sockets) socket.destroy();
      proxy.closeAllConnections?.();
      await Promise.all([terminator, proxy].map(server => new Promise(done => server.close(() => done()))));
    },
  };
}

// A new environment for the processes the candidate's server starts afterwards; `base` is not changed. It adds the preload that
// reroutes the Node probe, npm's own proxy setting (npm then reaches the registry through the interceptor, as it does through a
// corporate proxy) and the staged repair offer. HTTPS_PROXY and HTTP_PROXY are deliberately left out: they would only move the
// operating-system probe, which would then fail with a connection error that only a change to the OS trust store could repair.
// NODE_EXTRA_CA_CERTS, npm_config_cafile and npm_config_registry are left out too: trusting the CA is the repair the owner tries.
export function stagedEnvironment({ base, routeModule, tlsPort, proxyPort, repairsFile }) {
  const options = Object.entries(base).find(([name]) => fold(name) === 'NODE_OPTIONS')?.[1];
  const set = {
    NODE_OPTIONS: `${options ? `${options} ` : ''}--import=${pathToFileURL(routeModule).href}`,
    AIH_CANDIDATE_TLS_ROUTE: `${HOSTS[0]}=127.0.0.1:${tlsPort}`,
    npm_config_https_proxy: `http://127.0.0.1:${proxyPort}`,
    npm_config_proxy: `http://127.0.0.1:${proxyPort}`,
    AIH_READINESS_REPAIRS: repairsFile,
  };
  // Windows folds names, so a differently written copy of a name set here must not survive beside it.
  const replaced = new Set(Object.keys(set).map(fold));
  const kept = Object.entries(base).filter(([name]) => process.platform !== 'win32' || !replaced.has(fold(name)));
  return { ...Object.fromEntries(kept), ...set };
}

// The repair offer that goes with the condition. `staged` is read by the readiness child and shown as a banner on the readiness
// and report pages: exactly these two strings.
export function writeStagedRepairs(layout, condition) {
  const staged = { label: 'Staged condition: TLS interception (sample)',
    detail: `An intercepting proxy with a generated sample CA stands between this candidate's services and ${condition.hosts.join(', ')}; nothing on this machine outside the candidate is changed. Turn it off with: ${OFF_COMMAND}` };
  const repairs = [{ key: 'npm-ca', id: 'node-npm-ca', targets: ['npm'], inputs: { caFile: files(layout).ca }, network: 'declared' }];
  mkdirSync(dirname(layout.stagedRepairs), { recursive: true });
  writeFileSync(layout.stagedRepairs, `${JSON.stringify({ staged, repairs }, null, 2)}\n`);
}
