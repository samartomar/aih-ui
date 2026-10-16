// Starting and stopping the candidate's server process. It is a detached background process with no console window; the
// only way it is ever ended forcibly is by the pid it recorded itself, and only while that pid is still the candidate.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

export function spawnServer({ layout, port, env }) {
  mkdirSync(layout.logs, { recursive: true });
  mkdirSync(layout.state, { recursive: true });
  rmSync(layout.stopRequest, { force: true });
  rmSync(layout.server, { force: true });
  const log = openSync(layout.serverLog, 'a');
  try {
    const child = spawn(process.execPath, [SERVE, '--data', layout.root, '--port', String(port)],
      { cwd: REPO_ROOT, env: { ...process.env, ...env }, detached: true, windowsHide: true, stdio: ['ignore', log, log] });
    child.on('error', error => { try { writeFileSync(layout.serverLog, `could not start the server process: ${error.message}\n`, { flag: 'a' }); } catch { /* reported by waitForReady */ } });
    child.unref();
    if (!child.pid) throw refusal('CANDIDATE_START_FAILED', 'The server process could not be started.');
    return child.pid;
  } finally { closeSync(log); }
}

export async function waitForReady(layout, pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const record = readServerRecord(layout);
    if (record?.pid === pid) {
      try { if ((await fetch(`${record.url}api/packages`)).ok) return record; } catch { /* not answering yet */ }
    }
    if (!isAlive(pid)) throw refusal('CANDIDATE_START_FAILED', `The server process ended before it was ready. Last lines of ${layout.serverLog}:\n${logTail(layout)}`);
    if (Date.now() > deadline) throw refusal('CANDIDATE_START_TIMEOUT', `The server was not ready after ${Math.round(timeoutMs / 1000)} s (process ${pid} is still running; node tools/candidate.mjs stop ends it). Last lines of ${layout.serverLog}:\n${logTail(layout)}`);
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
  writeFileSync(layout.stopRequest, `${new Date().toISOString()}\n`);
  let how = 'stopped';
  if (!await waitForExit(record.pid, graceMs)) {
    if (!isCandidateProcess(layout, record.pid)) {
      rmSync(layout.stopRequest, { force: true });
      throw refusal('CANDIDATE_STOP_REFUSED', `Process ${record.pid} did not stop, and it no longer looks like this candidate's server, so it was left alone.`);
    }
    killTree(record.pid);
    if (!await waitForExit(record.pid, 10_000)) throw refusal('CANDIDATE_STOP_FAILED', `Process ${record.pid} could not be ended.`);
    how = 'ended after it did not stop on request';
  }
  cleanup();
  return { running: true, pid: record.pid, message: `The candidate ${how} (process ${record.pid}).` };
}

export const stopRequested = layout => existsSync(layout.stopRequest);
