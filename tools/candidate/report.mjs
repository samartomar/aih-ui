// The failure report: one redacted bundle of the candidate's identity, logs, records and live service diagnostics, written inside its data directory.
import { lstat, mkdir, open, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { arch, homedir, release, type } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { assertCandidateDir } from './data-dir.mjs';
import { candidateIdentity, readManifest } from './manifest.mjs';
import { isAlive } from './process.mjs';
import { redact, redactJson } from './redact.mjs';

const LIMIT = 1024 * 1024, LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const refusal = (code, message) => Object.assign(new Error(message), { code });

export async function writeReport({ dataDir, now = new Date(), realHome = homedir(), fetchImpl = fetch }) {
  const { layout } = assertCandidateDir(dataDir, 'report on');
  const root = await realpath(layout.root), opts = { realHome };
  const missing = [], files = [];
  const shown = path => relative(layout.root, path).split('\\').join('/');
  const inside = path => { const rel = relative(root, path); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'))); };
  async function safe(path, directory = false) {
    try {
      // Check each component before following it: even a symlinked parent must stay inside the candidate.
      const parts = relative(layout.root, path).split(/[\\/]/).filter(Boolean);
      let current = root;
      for (const part of parts) {
        current = join(current, part);
        if ((await lstat(current)).isSymbolicLink()) {
          current = await realpath(current);
          if (!inside(current)) return false;
        }
      }
      const stat = await lstat(current);
      return directory ? stat.isDirectory() : stat.isFile();
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code)) return false;
      throw error;
    }
  }
  async function json(path) {
    if (!await safe(path)) { missing.push(`${shown(path)}: not present`); return null; }
    try { return JSON.parse(await readFile(path, 'utf8')); }
    catch (error) { if (error instanceof SyntaxError) { missing.push(`${shown(path)}: invalid JSON`); return null; } throw error; }
  }
  async function listing(path) {
    if (!await safe(path, true)) { missing.push(`${shown(path)}: not present`); return []; }
    return readdir(path, { withFileTypes: true });
  }
  if (!await safe(layout.reports, true)) {
    try { await lstat(layout.reports); throw refusal('CANDIDATE_DATA_FOREIGN', `${layout.reports} is not a directory inside the candidate, so no report is written.`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await mkdir(layout.reports);
  }
  const stem = `report-${now.toISOString().replace(/[:.]/g, '-')}`;
  let bundleDir;
  for (let n = 0; ; n++) {
    bundleDir = join(layout.reports, stem + (n ? `-${n}` : ''));
    try { await mkdir(bundleDir); break; } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  async function save(name, value, structured = false) {
    const path = join(bundleDir, name);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, structured ? JSON.stringify(redactJson(value, opts), null, 2) + '\n' : redact(value, opts));
    files.push(name);
  }
  async function copy(path, name, structured = false) {
    if (!await safe(path)) { missing.push(`${shown(path)}: not present`); return; }
    if (structured) { const value = await json(path); if (value !== null) await save(name, value, true); return; }
    const handle = await open(path, 'r');
    let text;
    try {
      const { size } = await handle.stat(), sizeToRead = Math.min(size, LIMIT), buffer = Buffer.alloc(sizeToRead);
      const { bytesRead } = await handle.read(buffer, 0, sizeToRead, Math.max(0, size - LIMIT));
      text = (size > LIMIT ? '[truncated: last 1 MiB]\n' : '') + buffer.subarray(0, bytesRead).toString('utf8');
    } finally { await handle.close(); }
    if (path.endsWith('.json') && !text.startsWith('[truncated:')) {
      try { await save(name, JSON.parse(text), true); return; }
      catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    }
    await save(name, text);
  }

  // The identity the launcher and the page use, from the same reader; an unreadable manifest is said so, not guessed at.
  let identity = 'not present';
  if (await safe(layout.manifest)) {
    try { identity = candidateIdentity(readManifest(layout.manifest)); } catch (error) { identity = `unreadable: ${error.message}`; }
  } else missing.push(`${shown(layout.manifest)}: not present`);
  const server = await json(layout.server), running = isAlive(server?.pid), ready = running && server.state === 'ready';
  await save('identity.json', {
    manifest: identity,
    server: server ? { state: server.state ?? 'unknown', url: server.url, port: server.port, startedAt: server.startedAt, packages: server.packages } : 'not present', running,
  }, true);
  await save('environment.json', { node: process.version, platform: process.platform, arch: arch(), release: release(), type: type(),
    candidate: { manifest: typeof identity === 'object' ? 'present' : identity, server: server ? 'present' : 'not present', running }, npm: 'not queried' }, true);
  await mkdir(join(bundleDir, 'logs'));
  await mkdir(join(bundleDir, 'records'));
  await copy(layout.serverLog, 'logs/server.log');
  await copy(layout.authorityLog, 'logs/authority-transport.log');
  const runs = [];
  for (const entry of await listing(layout.checks)) {
    const path = join(layout.checks, entry.name);
    if (entry.isDirectory() && await safe(path, true)) runs.push({ name: entry.name, mtime: (await lstat(path)).mtimeMs });
  }
  runs.sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name));
  async function checkFiles(path, target) {
    for (const entry of await listing(path)) {
      if (entry.isDirectory()) await checkFiles(join(path, entry.name), `${target}/${entry.name}`);
      else if (/\.(log|txt|json)$/i.test(entry.name)) await copy(join(path, entry.name), `${target}/${entry.name}`);
    }
  }
  for (const run of runs.slice(0, 3)) await checkFiles(join(layout.checks, run.name), `logs/checks/${run.name}`);
  await copy(layout.batchEnvelope, 'records/batch-envelope.json', true);
  async function records(path, target, recursive) {
    for (const entry of await listing(path)) {
      if (recursive && entry.isDirectory()) await records(join(path, entry.name), `${target}/${entry.name}`, true);
      else if (/\.json$/i.test(entry.name)) await copy(join(path, entry.name), `${target}/${entry.name}`, true);
    }
  }
  await records(layout.savedIntents, 'records/saved-intents', true);
  await records(layout.config, 'records/config', false);

  // Service diagnostics from the running candidate itself (read-only GETs, same origin). Never a reason to fail the report.
  async function live(base, name, route) {
    try {
      const response = await fetchImpl(new URL(route, base), { headers: { origin: base.origin }, signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await save(`records/live/${name}.json`, await response.json(), true);
    } catch (error) { missing.push(`records/live/${name}.json: not available: ${error.name === 'TimeoutError' ? 'no answer within 5 s' : error.message}`); }
  }
  if (ready) {
    let base = null;
    try { base = new URL(server.url); } catch { /* reported below */ }
    if (base && base.protocol === 'http:' && LOOPBACK.has(base.hostname)) {
      await live(base, 'readiness-report', 'api/readiness-report');
      await live(base, 'batch', 'api/batch');
    } else missing.push('records/live: not available: the recorded address is not a local one');
  } else missing.push('records/live: not captured (the candidate is not ready)');

  const packages = typeof identity === 'object' ? identity.packages : [];
  const summary = packages.map(pkg => `- ${pkg.name}: sha256 ${String(pkg.sha256).slice(0, 12)}, commit ${pkg.commit}, tarball ${pkg.tarball}`).join('\n') || `Manifest: ${typeof identity === 'string' ? identity : 'no packages'}`;
  await save('ISSUE.md', [
    '# Title: [describe the problem]', '',
    `Candidate: ${typeof identity === 'object' ? identity.candidate ?? '(unnamed)' : identity}`, summary, '',
    `OS: ${type()} ${release()} (${process.platform}/${arch()})`, `Node: ${process.version}`, '',
    '## Steps to reproduce', '1. [First step]', '2. [Next step]', '',
    '## Expected result', '[Describe]', '',
    '## Actual result', '[Describe]', '',
    '## Screenshots or files', '[Attach relevant files]', '',
    'This bundle was redacted automatically; check it before sharing. Sample data is sample data, not observed evidence.', ''].join('\n'));
  await save('README.md', [
    '# Candidate report', '',
    'identity.json: manifest identity, installed server packages, the server state and whether its recorded pid was alive.',
    'environment.json: Node and OS facts and candidate presence only; no environment dump or npm invocation.',
    'logs/: server and authority logs plus the three newest check directories; files over 1 MiB keep their tail with a truncation line.',
    'records/: journey records the page saved or the samples created (batch envelope and saved intents), plus host configuration in config/. These records are not proof of execution. Sample data is sample data, not observed evidence.',
    'records/live/: the readiness report and the reviewed batch as the running candidate itself reports them.',
    'ISSUE.md: issue template to fill in.', '',
    'Tokens, keys, authorization headers, URL credentials, private keys, sensitive named values and the real home path were redacted automatically. Review every file before sharing. Linked paths outside the candidate are excluded.', '',
    '## Missing inputs', missing.length ? missing.map(item => `- ${item}`).join('\n') : 'None.', ''].join('\n'));
  return { bundleDir, files };
}
