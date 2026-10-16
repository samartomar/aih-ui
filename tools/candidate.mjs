#!/usr/bin/env node
/*
 * Owner-testing candidate: one command starts the Workbench from a manifest of pinned package tarballs, with sample data and a
 * disposable account home, and one command stops it and proves the real account home was not touched.
 *
 *   node tools/candidate.mjs start  --manifest <file> [--data <dir>] [--port <n>] [--no-smoke]
 *   node tools/candidate.mjs stop   [--data <dir>]
 *   node tools/candidate.mjs reset  [--data <dir>]
 *   node tools/candidate.mjs report [--data <dir>]
 *   node tools/candidate.mjs status [--data <dir>]
 *
 * The data directory (default .aih-ui/candidate, git-ignored) holds everything the candidate writes. See tools/candidate/layout.mjs.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertCandidateDir, claimDataDir, ensureLayout, resetDataDir } from './candidate/data-dir.mjs';
import { checkRealHome, recordRealHome } from './candidate/guard.mjs';
import { DEFAULT_PORT, candidateLayout } from './candidate/layout.mjs';
import { absoluteManifest, candidateIdentity, readManifest, verifyManifest } from './candidate/manifest.mjs';
import { assertPortAvailable } from './candidate/port.mjs';
import { isAlive, readServerRecord, runSeedOnly, serverEnvironment, spawnServer, stopServer, waitForReady } from './candidate/process.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const READY_TIMEOUT_MS = 5 * 60_000, SEED_TIMEOUT_MS = 10 * 60_000;
const USAGE = 'usage: node tools/candidate.mjs <start|stop|reset|report|status> [--manifest <file>] [--data <dir>] [--port <n>] [--no-smoke]';
const refusal = (code, message) => Object.assign(new Error(message), { code });
const out = line => process.stdout.write(`${line}\n`);

function parseArguments(argv) {
  const [command, ...rest] = argv, options = { smoke: true };
  for (let at = 0; at < rest.length; at++) {
    const flag = rest[at];
    if (flag === '--no-smoke') options.smoke = false;
    else if (['--manifest', '--data', '--port'].includes(flag)) {
      if (rest[++at] === undefined) throw refusal('CANDIDATE_USAGE', `${flag} needs a value.\n${USAGE}`);
      options[flag.slice(2)] = rest[at];
    } else throw refusal('CANDIDATE_USAGE', `Unknown argument ${flag}.\n${USAGE}`);
  }
  if (!['start', 'stop', 'reset', 'report', 'status'].includes(command)) throw refusal('CANDIDATE_USAGE', USAGE);
  return { command, options };
}

// The report and the page check are written by their own modules; a missing one is a clear refusal, not a crash.
async function lazy(file, name) {
  try { return (await import(`./candidate/${file}.mjs`))[name]; }
  catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes(`${file}.mjs`)) throw refusal('CANDIDATE_MODULE_MISSING', `tools/candidate/${file}.mjs is not part of this checkout, so this step is unavailable.`);
    throw error;
  }
}

function describeCandidate(record) {
  out(`url: ${record.url}`);
  if (record.identity?.candidate) out(`candidate: ${record.identity.candidate}`);
  for (const pkg of record.identity?.packages ?? []) {
    const version = record.packages?.find(item => item.packageName === pkg.name)?.version ?? 'unknown version';
    out(`  ${pkg.name} ${version}  sha256 ${pkg.sha256}  commit ${pkg.commit}  (${pkg.tarball})`);
  }
  out(`data directory: ${record.dataDir}`);
}

// The recorded process, while it is alive: a server starting or ready, or reset's seeding run.
const running = layout => { const record = readServerRecord(layout); return record && isAlive(record.pid) ? record : null; };
const isStarting = record => record.state === 'starting' || record.state === 'seeding';
const phase = record => (record.state === 'seeding' ? 'making the sample data again' : 'starting');

async function start({ manifest, data, port, smoke }) {
  const layout = candidateLayout(data);
  const manifestPath = manifest ? resolve(manifest) : layout.manifest;
  if (!manifest && !existsSync(layout.manifest)) throw refusal('CANDIDATE_USAGE', `start needs --manifest <file> (there is no earlier candidate in ${layout.root}).`);
  const already = running(layout);
  if (already) throw refusal('CANDIDATE_RUNNING', `The candidate is already ${isStarting(already) ? phase(already) : `running at ${already.url}`} (process ${already.pid}). Stop it first: node tools/candidate.mjs stop`);
  // Nothing is written until the tarballs are exactly the bytes the manifest names and the port is free.
  const read = readManifest(manifestPath);
  await verifyManifest(read);
  await assertPortAvailable(port);
  claimDataDir(layout.root);
  ensureLayout(layout);
  if (manifest) writeFileSync(layout.manifest, `${JSON.stringify(absoluteManifest(read), null, 2)}\n`);
  recordRealHome(layout, homedir());
  // The candidate is reproducible from its manifest: no AIH_* host setting from this shell reaches it, Core's records land in its own home and its temporary files in its own directory.
  const pid = spawnServer({ layout, port, env: serverEnvironment(layout) });
  out(`starting the candidate (process ${pid}); installing the packages can take a few minutes. Stop it at any time with: node tools/candidate.mjs stop`);
  const record = await waitForReady(layout, pid, READY_TIMEOUT_MS);
  out('the candidate is ready');
  describeCandidate(record);
  out(`server log: ${layout.serverLog}`);
  out(`real account home: ${checkRealHome(layout, homedir()).message}`);
  if (!smoke) return;
  const smokeCandidate = await lazy('smoke', 'smokeCandidate');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const result = await smokeCandidate({ origin: record.url.replace(/\/$/, ''), identity: candidateIdentity(read), output: join(layout.checks, `start-${stamp}`),
    playwrightModule: pathToFileURL(join(REPO_ROOT, 'node_modules', 'playwright', 'index.mjs')).href });
  if (!result.ok) {
    out('page check FAILED:');
    for (const mismatch of result.mismatches) out(`  - ${mismatch}`);
    out('The candidate is still running; stop it with: node tools/candidate.mjs stop');
    process.exitCode = 1;
    return;
  }
  out(`page check passed${result.screenshots?.length ? `; screenshots: ${result.screenshots.join(', ')}` : ''}`);
}

async function stop({ data }) {
  const layout = candidateLayout(data);
  const stopped = await stopServer(layout);
  out(stopped.message);
  if (!existsSync(layout.marker)) return;
  const guard = checkRealHome(layout, homedir());
  out(`real account home: ${guard.message}`);
  if (guard.unchanged === false) process.exitCode = 1;
}

// The candidate definition survives a reset: its manifest copy is read and re-verified first, written back afterwards, and the
// sample data is made again from it (the server entry in seed-only mode), so the owner starts again from fresh samples.
async function reset({ data }) {
  const { layout } = assertCandidateDir(data, 'reset');
  let kept = null, notKept = null;
  if (existsSync(layout.manifest)) {
    try { const read = readManifest(layout.manifest); await verifyManifest(read); kept = readFileSync(layout.manifest); }
    catch (error) { notKept = error.message; }
  }
  const result = await resetDataDir(data);
  out(`removed ${result.removed} (${result.entries} top-level ${result.entries === 1 ? 'entry' : 'entries'}) and made it empty again.`);
  if (!kept) {
    out(`The candidate definition was not kept (${notKept ?? 'there was no manifest copy'}); the next start needs --manifest <file>, and makes the sample data then.`);
    return;
  }
  writeFileSync(layout.manifest, kept);
  ensureLayout(layout);
  out('making the sample data again; installing the packages can take a few minutes...');
  const seeded = await runSeedOnly({ layout, env: serverEnvironment(layout), timeoutMs: SEED_TIMEOUT_MS });
  out(seeded.complete ? 'the sample data was recreated from the kept manifest.' : `some sample data could not be made (see ${layout.serverLog}); the next start tries again.`);
  out('The candidate is not running; start it with: node tools/candidate.mjs start');
  if (!seeded.complete) process.exitCode = 1;
}

async function report({ data }) {
  const writeReport = await lazy('report', 'writeReport');
  const { bundleDir } = await writeReport({ dataDir: candidateLayout(data).root, now: new Date() });
  out(`report bundle: ${bundleDir}`);
}

function status({ data }) {
  const layout = candidateLayout(data), record = running(layout);
  if (record && isStarting(record)) {
    out(`The candidate is ${phase(record)} (process ${record.pid}); installing the packages can take a few minutes. Stop it with: node tools/candidate.mjs stop`);
    return;
  }
  if (!record) {
    out('The candidate is not running.');
    if (existsSync(layout.manifest)) out(`Its manifest is kept in ${layout.manifest}; start it again with: node tools/candidate.mjs start`);
    return;
  }
  out(`The candidate is running (process ${record.pid}).`);
  describeCandidate(record);
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  const data = resolve(options.data ?? join(REPO_ROOT, '.aih-ui', 'candidate'));
  const port = options.port === undefined ? DEFAULT_PORT : Number(options.port);
  await { start: () => start({ ...options, data, port }), stop: () => stop({ data }), reset: () => reset({ data }), report: () => report({ data }), status: () => status({ data }) }[command]();
}

main().catch(error => {
  process.stderr.write(`candidate: ${String(error?.code).startsWith('CANDIDATE_') ? error.message : error?.stack ?? error}\n`);
  process.exitCode = 1;
});
