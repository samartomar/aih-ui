// Starting and stopping the candidate's server process. It is a detached background process with no console window; the
// only way it is ever ended forcibly is by the pid it recorded itself, and only while that pid is still the candidate.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homeEnvironment } from '../consumer/home-environment.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVE = join(REPO_ROOT, 'tools', 'candidate', 'serve.mjs');
const refusal = (code, message) => Object.assign(new Error(message), { code });
const sleep = ms => new Promise(done => setTimeout(done, ms));

export function readServerRecord(layout) {
  try { return JSON.parse(readFileSync(layout.server, 'utf8')); } catch { return null; }
}

export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

export function logTail(layout, lines = 40) {
  try { return readFileSync(layout.serverLog, 'utf8').trimEnd().split('\n').slice(-lines).join('\n'); } catch { return '(no server log)'; }
}

// Exactly the environment the server process gets: this process's, minus every AIH_* host setting, with the candidate's
// disposable account home, its own temporary directory and the manifest it is built from.
export function serverEnvironment(layout, base = process.env) {
  const set = { ...homeEnvironment(layout.home), TEMP: layout.tmp, TMP: layout.tmp, TMPDIR: layout.tmp, AIH_CANDIDATE_MANIFEST: layout.manifest };
  const fold = name => (process.platform === 'win32' ? name.toUpperCase() : name), replaced = new Set(Object.keys(set).map(fold));
  const inherited = Object.entries(base).filter(([name]) => !name.toUpperCase().startsWith('AIH_') && !replaced.has(fold(name)));
  return { ...Object.fromEntries(inherited), ...set };
}

// `env` is used as given: nothing of this process's environment is added back. `script` and `args` are only for tests.
export function spawnServer({ layout, port, env, script = SERVE, args = [] }) {
  for (const directory of [layout.logs, layout.state, layout.tmp]) mkdirSync(directory, { recursive: true });
  rmSync(layout.stopRequest, { force: true });
  rmSync(layout.server, { force: true });
  const log = openSync(layout.serverLog, 'a');
  try {
    const child = spawn(process.execPath, [script, '--data', layout.root, '--port', String(port), ...args],
      { cwd: REPO_ROOT, env, detached: true, windowsHide: true, stdio: ['ignore', log, log] });
    child.on('error', error => { try { writeFileSync(layout.serverLog, `could not start the server process: ${error.message}\n`, { flag: 'a' }); } catch { /* reported by waitForReady */ } });
    child.unref();
    if (!child.pid) throw refusal('CANDIDATE_START_FAILED', 'The server process could not be started.');
    // Recorded at once, so a candidate that is still installing can be seen and stopped; the server rewrites it as ready.
    writeFileSync(layout.server, `${JSON.stringify({ pid: child.pid, state: 'starting', dataDir: layout.root, startedAt: new Date().toISOString() }, null, 2)}\n`);
    return child.pid;
  } finally { closeSync(log); }
}

// The server entry in seed-only mode: it installs the consumer, makes the sample data and exits without listening.
// Resolves { complete }: false when it ran but a sample could not be made (exit 2); the next start retries that sample.
export function runSeedOnly({ layout, env, timeoutMs, script = SERVE }) {
  for (const directory of [layout.logs, layout.state]) mkdirSync(directory, { recursive: true });
  const log = openSync(layout.serverLog, 'a');
  return new Promise((done, fail) => {
    let settled = false, timer;
    const settle = (problem, complete = true) => {
      if (settled) return;
      settled = true; clearTimeout(timer); closeSync(log);
      if (readServerRecord(layout)?.pid === child.pid) rmSync(layout.server, { force: true });
      if (problem) fail(refusal('CANDIDATE_SEED_FAILED', `${problem} Last lines of ${layout.serverLog}:\n${logTail(layout)}`)); else done({ complete });
    };
    // Detached like the server, so a POSIX timeout ends npm's descendants with the group; recorded like it, so status, stop, start and
    // reset all see the seeding run until it exits.
    const child = spawn(process.execPath, [script, '--data', layout.root, '--seed-only'], { cwd: REPO_ROOT, env, detached: true, windowsHide: true, stdio: ['ignore', log, log] });
    if (child.pid) writeFileSync(layout.server, `${JSON.stringify({ pid: child.pid, state: 'seeding', dataDir: layout.root, startedAt: new Date().toISOString() }, null, 2)}\n`);
    timer = setTimeout(() => { killTree(child.pid); settle(`Making the sample data took longer than ${Math.round(timeoutMs / 1000)} s and was ended.`); }, timeoutMs);
    child.on('error', error => settle(`The sample data could not be made: ${error.message}.`));
    child.on('exit', code => (code === 0 || code === 2 ? settle(null, code === 0) : settle(`Making the sample data failed (exit ${code}).`)));
  });
}

export async function waitForReady(layout, pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const record = readServerRecord(layout);
    if (record?.pid === pid && record.state === 'ready' && record.url) {
      try { if ((await fetch(`${record.url}api/packages`)).ok) return record; } catch { /* not answering yet */ }
    }
    if (!isAlive(pid)) throw refusal('CANDIDATE_START_FAILED', `The server process ended before it was ready. Last lines of ${layout.serverLog}:\n${logTail(layout)}`);
    if (Date.now() > deadline) throw refusal('CANDIDATE_START_TIMEOUT', `The server was not ready after ${Math.round(timeoutMs / 1000)} s. It is still starting (process ${pid}); check it with: node tools/candidate.mjs status, or end it with: node tools/candidate.mjs stop. Last lines of ${layout.serverLog}:\n${logTail(layout)}`);
    await sleep(500);
  }
}

// Whether `pid` is still this candidate's server: its command line names serve.mjs and this data directory.
function commandLine(pid) {
  if (process.platform === 'win32') {
    const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`],
      { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    return result.status === 0 ? result.stdout.trim() : '';
  }
  try { return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').trim(); } catch { /* no /proc: ask ps */ }
  const result = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  return result.status === 0 ? result.stdout.trim() : '';
}
export function isCandidateProcess(layout, pid) {
  const line = commandLine(pid), fold = text => (process.platform === 'win32' ? text.toLowerCase() : text);
  return fold(line).includes('serve.mjs') && fold(line).includes(fold(layout.root));
}

function killTree(pid) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 30_000 });
  // Spawned detached, so the server is its own process group leader.
  else try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
}

async function waitForExit(pid, ms) {
  const deadline = Date.now() + ms;
  while (isAlive(pid) && Date.now() < deadline) await sleep(250);
  return !isAlive(pid);
}

export async function stopServer(layout, { graceMs = 30_000 } = {}) {
  const record = readServerRecord(layout);
  if (!record) return { running: false, message: 'The candidate is not running.' };
  const cleanup = () => { rmSync(layout.stopRequest, { force: true }); rmSync(layout.server, { force: true }); };
  if (!isAlive(record.pid)) { cleanup(); return { running: false, message: `The candidate is not running (process ${record.pid} had already ended; its leftover record was removed).` }; }
  // A candidate still installing cannot read the request (npm runs synchronously), so it is ended at once after the identity check.
  const installing = record.state === 'starting' || record.state === 'seeding';
  if (!installing) writeFileSync(layout.stopRequest, `${new Date().toISOString()}\n`);
  let how = 'stopped';
  if (installing || !await waitForExit(record.pid, graceMs)) {
    if (!isCandidateProcess(layout, record.pid)) {
      rmSync(layout.stopRequest, { force: true });
      throw refusal('CANDIDATE_STOP_REFUSED', `Process ${record.pid} is still running, and it no longer looks like this candidate's server, so it was left alone.`);
    }
    killTree(record.pid);
    if (!await waitForExit(record.pid, 10_000)) throw refusal('CANDIDATE_STOP_FAILED', `Process ${record.pid} could not be ended.`);
    how = installing ? 'ended' : 'ended after it did not stop on request';
  }
  cleanup();
  return { running: true, pid: record.pid, message: `The candidate${{ starting: ' (it was still starting)', seeding: ' (it was still making the sample data)' }[record.state] ?? ''} ${how} (process ${record.pid}).` };
}

export const stopRequested = layout => existsSync(layout.stopRequest);
