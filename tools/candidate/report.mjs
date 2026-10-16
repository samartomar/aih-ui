import { lstat, realpath, readdir, mkdir, readFile, writeFile, open } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import os from 'node:os';
import { candidateLayout } from './layout.mjs';
import { redact, redactJson } from './redact.mjs';

const basename = path => typeof path === 'string' ? path.split(/[\\/]/).pop() : null;
const limit = 1024 * 1024;

export async function writeReport({ dataDir, now = new Date(), realHome = os.homedir() }) {
  const layout = candidateLayout(dataDir), root = await realpath(layout.root), opts = { realHome };
  const missing = [], files = [];
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
    if (!await safe(path)) { missing.push(`${relative(layout.root, path)}: not present`); return null; }
    try { return JSON.parse(await readFile(path, 'utf8')); }
    catch (error) { if (error instanceof SyntaxError) { missing.push(`${relative(layout.root, path)}: invalid JSON`); return null; } throw error; }
  }
  async function listing(path) {
    if (!await safe(path, true)) { missing.push(`${relative(layout.root, path)}: not present`); return []; }
    return readdir(path, { withFileTypes: true });
  }
  if (!await safe(layout.reports, true)) {
    try { await lstat(layout.reports); throw Error('Reports directory is not a confined directory'); }
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
    if (!await safe(path)) { missing.push(`${relative(layout.root, path)}: not present`); return; }
    if (structured) { const value = await json(path); if (value !== null) await save(name, value, true); return; }
    const handle = await open(path, 'r');
    let text;
    try {
      const { size } = await handle.stat(), sizeToRead = Math.min(size, limit), buffer = Buffer.alloc(sizeToRead);
      const { bytesRead } = await handle.read(buffer, 0, sizeToRead, Math.max(0, size - limit));
      text = (size > limit ? '[truncated: last 1 MiB]\n' : '') + buffer.subarray(0, bytesRead).toString('utf8');
    } finally { await handle.close(); }
    if (path.endsWith('.json') && !text.startsWith('[truncated:')) {
      try { await save(name, JSON.parse(text), true); return; }
      catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    }
    await save(name, text);
  }
  const manifest = await json(layout.manifest), server = await json(layout.server);
  // The manifest keys packages by name (core, catalog, scan); the identity lists them in the page's order.
  const packages = manifest && typeof manifest.packages === 'object' ? ['core', 'scan', 'catalog'].filter(name => manifest.packages[name])
    .map(name => { const { sha256, commit, tarball } = manifest.packages[name]; return { name: '@aihq/' + name, sha256, commit, tarball: basename(tarball) }; }) : [];
  let running = false;
  if (Number.isInteger(server?.pid) && server.pid > 0) {
    try { process.kill(server.pid, 0); running = true; } catch (error) { running = error.code === 'EPERM'; }
  }
  await save('identity.json', {
    manifest: manifest ? { schema: manifest.schema, label: manifest.label, candidate: manifest.candidate, packages } : 'not present',
    server: server ? { url: server.url, port: server.port, startedAt: server.startedAt, packages: server.packages } : 'not present', running,
  }, true);
  await save('environment.json', { node: process.version, platform: process.platform, arch: process.arch, release: os.release(), type: os.type(), candidate: { manifest: manifest ? 'present' : 'not present', server: server ? 'present' : 'not present', running }, npm: 'not queried' }, true);
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
  const summary = packages.map(pkg => `- ${pkg.name}: sha256 ${String(pkg.sha256).slice(0, 12)}, commit ${pkg.commit}, tarball ${pkg.tarball}`).join('\n') || 'Manifest: not present';
  await save('ISSUE.md', `# Title: [describe the problem]\n\nCandidate: ${manifest?.label ?? manifest?.candidate ?? 'not present'}\n${summary}\n\nOS: ${os.type()} ${os.release()} (${process.platform}/${process.arch})\nNode: ${process.version}\n\n## Steps to reproduce\n1. [First step]\n2. [Next step]\n\n## Expected result\n[Describe]\n\n## Actual result\n[Describe]\n\n## Screenshots or files\n[Attach relevant files]\n\nThis bundle was redacted automatically; check it before sharing. Sample data is sample data, not observed evidence.\n`);
  await save('README.md', `# Candidate report\n\nidentity.json: manifest identity, installed server packages and whether its recorded pid was alive.\nenvironment.json: Node and OS facts and candidate presence only; no environment dump or npm invocation.\nlogs/: server and authority logs plus the three newest check directories; files over 1 MiB keep their tail with a truncation line.\nrecords/: journey records the page saved or the samples created (batch envelope and saved intents), plus host configuration in config/. These records are not proof of execution. Sample data is sample data, not observed evidence.\nISSUE.md: issue template to fill in.\n\nTokens, keys, authorization headers, URL credentials, private keys, sensitive named values and the real home path were redacted automatically. Review every file before sharing. Linked paths outside the candidate are excluded.\n\n## Missing inputs\n${missing.length ? missing.map(item => `- ${item}`).join('\n') : 'None.'}\n`);
  return { bundleDir, files };
}
