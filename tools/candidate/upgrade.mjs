// Install before stopping; resume only after rechecking the exact archive and installed bytes.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, lstatSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { absoluteManifest, candidateIdentity, readManifest, verifyManifest } from './manifest.mjs';
import { assertCandidateDir, claimDataDir, ensureLayout } from './data-dir.mjs';
import { candidateLayout } from './layout.mjs';
import { isAlive, isCandidateProcess, readServerRecord, stopServer } from './process.mjs';
import { assertPortAvailable } from './port.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
function run(executable, args, cwd) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 300_000, maxBuffer: 32 * 1024 * 1024,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'npm_config_allow_scripts')) });
  if (result.error || result.status !== 0) throw new Error(`${executable} ${args[0]} failed: ${result.error?.message ?? `${result.stdout}\n${result.stderr}`}`);
  return result.stdout;
}
function npm(args, cwd) {
  const cli = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  if (!existsSync(cli)) throw new Error('Set npm_execpath to the installed npm-cli.js before upgrading.');
  return run(process.execPath, [cli, ...args], cwd);
}
function archiveManifest(entry) {
  const result = spawnSync('tar', ['-xzOf', '-', 'package/package.json'], { input: readFileSync(entry.tarball), encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 2_000_000 });
  if (result.error || result.status !== 0) throw new Error(`Cannot read package.json from ${entry.tarball}: ${result.error?.message ?? result.stderr}`);
  return JSON.parse(result.stdout);
}
function retainedFiles(layout) {
  const files = {};
  const walk = (path, label) => {
    if (!existsSync(path)) return;
    for (const name of readdirSync(path).sort()) {
      const file = join(path, name), key = `${label}/${name}`, stat = lstatSync(file);
      // Runtime caches and the sample seeding ledger are regenerated, not saved
      // choices. All account-owned AIH records and sample/configuration files remain checked.
      if (key === 'samples/.seeded.json') continue;
      if (stat.isSymbolicLink()) throw new Error(`Retained state contains a symbolic link: ${key}`);
      if (stat.isDirectory()) walk(file, key);
      else if (stat.isFile()) files[key] = hash(readFileSync(file));
    }
  };
  for (const name of ['home', 'config', 'samples']) walk(layout[name], name);
  return files;
}
export async function preflightCandidate({ manifest, data, port }) {
  if (!manifest) throw new Error('preflight and upgrade require --manifest with a pinned ui archive.');
  const read = readManifest(resolve(manifest));
  await verifyManifest(read);
  if (!read.packages.ui) throw new Error('The upgrade manifest must pin ui as well as Core, Catalog and Scan.');
  const layout = candidateLayout(data), record = readServerRecord(layout);
  if (existsSync(layout.root) && readdirSync(layout.root).length) assertCandidateDir(data);
  let ancestor = layout.root;
  while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor);
  const git = spawnSync('git', ['-C', ancestor, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  if (git.status === 0) throw new Error('Install candidate data outside every source Git workspace.');
  if (record && isAlive(record.pid)) {
    if (!isCandidateProcess(layout, record.pid)) throw new Error(`Recorded process ${record.pid} is not this candidate; left untouched.`);
    if (record.port !== port) await assertPortAvailable(port);
  } else await assertPortAvailable(port);
  const packages = Object.fromEntries(['core', 'scan', 'catalog', 'ui'].map(key => {
    const pkg = archiveManifest(read.packages[key]), expected = key === 'ui' ? 'aih-ui' : `@aihq/${key}`;
    if (pkg.name !== expected) throw new Error(`${key} archive contains ${pkg.name}, expected ${expected}.`);
    return [key, { name: pkg.name, version: pkg.version }];
  }));
  const ui = archiveManifest(read.packages.ui);
  for (const [name, version] of Object.entries(ui.devDependencies ?? {})) if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`UI build dependency ${name} must be exactly pinned.`);
  run('tar', ['--version']);
  npm(['--version']);
  return { read, layout, packages, ui, record, checkedAt: new Date().toISOString(), identity: candidateIdentity(read) };
}

// Compare every regular file with the tarball's bytes. A resumed install never trusts a completion marker alone.
export function verifyInstalledArchive(entry, installedRoot) {
  const temporary = mkdtempSync(join(tmpdir(), 'aih-candidate-verify-'));
  try {
    const extracted = spawnSync('tar', ['-xz'], { cwd: temporary, input: readFileSync(entry.tarball), encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    if (extracted.error || extracted.status !== 0) throw new Error(`Archive extraction failed: ${extracted.error?.message ?? extracted.stderr}`);
    const files = [];
    const walk = (path, relative = '') => {
      for (const name of readdirSync(path).sort()) {
        const source = join(path, name), rel = relative ? `${relative}/${name}` : name, stat = lstatSync(source);
        if (stat.isDirectory()) walk(source, rel);
        else {
          if (!stat.isFile()) throw new Error(`Archive has a non-regular member: ${rel}`);
          const actual = join(installedRoot, rel);
          if (!lstatSync(actual).isFile() || hash(readFileSync(source)) !== hash(readFileSync(actual))) throw new Error(`Installed bytes differ: ${rel}`);
          files.push([rel, hash(readFileSync(source))]);
        }
      }
    };
    walk(join(temporary, 'package'));
    return { files: files.length, treeSha256: hash(JSON.stringify(files)) };
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

export async function upgradeCandidate(options) {
  const began = Date.now(), preflight = await preflightCandidate(options), { read, layout, ui } = preflight;
  claimDataDir(layout.root); ensureLayout(layout);
  const release = join(layout.root, 'releases', hash(JSON.stringify(absoluteManifest(read)))), checkpoint = join(release, 'checkpoint.json');
  mkdirSync(release, { recursive: true });
  const receipt = { schema: 'urn:aih-ui:candidate-upgrade:1.0.0', identity: preflight.identity, checkedAt: preflight.checkedAt, phases: [], previous: existsSync(layout.manifest) ? json(layout.manifest) : null };
  const save = (phase, detail = {}) => {
    receipt.phases.push({ phase, at: new Date().toISOString(), elapsedMs: Date.now() - began, ...detail });
    writeFileSync(checkpoint, JSON.stringify(receipt, null, 2) + '\n');
  };
  save('preflight-verified');
  const installedUi = join(release, 'node_modules', 'aih-ui');
  let reused = false;
  if (existsSync(installedUi)) {
    try { verifyInstalledArchive(read.packages.ui, installedUi); reused = true; } catch { /* Repair only this release's npm install. */ }
  }
  if (!reused) {
    writeFileSync(join(release, 'package.json'), JSON.stringify({ name: 'aih-ui-installed-candidate', private: true, type: 'module' }));
    npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--force', ...['ui', 'core', 'catalog', 'scan'].map(name => read.packages[name].tarball),
      ...Object.entries(ui.devDependencies ?? {}).map(([name, version]) => `${name}@${version}`)], release);
  }
  receipt.installed = Object.fromEntries(['ui', 'core', 'catalog', 'scan'].map(name => [name, verifyInstalledArchive(read.packages[name], join(release, 'node_modules', name === 'ui' ? 'aih-ui' : `@aihq/${name}`))]));
  // Resolve the browser/build runtime while the previous release is still usable.
  run(process.execPath, ['--input-type=module', '-e', "await import('playwright'); await import('postcss'); await import('tailwindcss');"], release);
  save('installed-verified', { reused });
  const manifestPath = join(release, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(absoluteManifest(read), null, 2) + '\n');
  const cli = join(installedUi, 'tools', 'candidate.mjs');
  receipt.retainedBefore = retainedFiles(layout);
  // No stop takes place until installation and exact-byte readback have succeeded.
  try {
    await stopServer(layout);
    save('previous-stopped');
    run(process.execPath, [cli, 'start', '--manifest', manifestPath, '--data', layout.root, '--port', String(options.port)], release);
    const after = retainedFiles(layout);
    receipt.retainedState = { checkedFiles: Object.keys(receipt.retainedBefore).length, changed: Object.keys(receipt.retainedBefore).filter(key => after[key] !== receipt.retainedBefore[key]) };
    if (receipt.retainedState.changed.length) throw new Error(`Saved candidate state changed during upgrade: ${receipt.retainedState.changed.join(', ')}`);
    save('ready-and-browser-verified', { server: readServerRecord(layout) });
  } catch (error) {
    save('failed', { message: error.message, recovery: `Inspect ${checkpoint}; fix the reported failure and rerun the same upgrade command. Saved samples, configuration and account home remain in ${layout.root}.` });
    throw error;
  }
  return { checkpoint, receipt, release };
}
