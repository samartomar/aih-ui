// The candidate's data directory is only ever created, reset or deleted by the candidate itself. A marker file written
// at creation names the directory's own real path, so a directory the candidate did not make (or a marker copied
// elsewhere) is never touched, and reset cannot be pointed at a home, a drive root or the repository.
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, parse, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_MARKER_SCHEMA, candidateLayout } from './layout.mjs';
import { isAlive } from './process.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const refusal = (code, message) => Object.assign(new Error(message), { code });
const real = path => realpathSync.native(path);
// A stand-in directory that does not exist yet is compared by its resolved path.
const realOrResolved = path => { try { return real(path); } catch { return resolve(path); } };
const lower = path => (process.platform === 'win32' ? path.toLowerCase() : path);
const same = (a, b) => lower(a) === lower(b);
// `inner` is `outer` itself or lies beneath it.
const within = (outer, inner) => { const path = relative(lower(outer), lower(inner)); return path === '' || (!path.startsWith('..') && !isAbsolute(path)); };

function readMarker(layout, realRoot) {
  try {
    if (!lstatSync(layout.marker).isFile()) return null;
    const marker = JSON.parse(readFileSync(layout.marker, 'utf8'));
    return marker?.schema === DATA_MARKER_SCHEMA && typeof marker.root === 'string' && typeof marker.instance === 'string' && same(marker.root, realRoot) ? marker : null;
  } catch { return null; }
}

export function claimDataDir(dataDir) {
  const layout = candidateLayout(dataDir);
  let stat = null;
  try { stat = lstatSync(layout.root); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) throw refusal('CANDIDATE_DATA_FOREIGN', `${layout.root} is not a plain directory, so the candidate will not use it.`);
  if (!stat) mkdirSync(layout.root, { recursive: true });
  const realRoot = real(layout.root);
  if (stat && readdirSync(layout.root).length) {
    const marker = readMarker(layout, realRoot);
    if (!marker) throw refusal('CANDIDATE_DATA_FOREIGN', `${layout.root} is not empty and is not a candidate data directory, so the candidate will not use it.`);
    return { layout, marker, created: false };
  }
  const marker = { schema: DATA_MARKER_SCHEMA, root: realRoot, createdAt: new Date().toISOString(), instance: randomUUID() };
  writeFileSync(layout.marker, `${JSON.stringify(marker, null, 2)}\n`);
  return { layout, marker, created: true };
}

// The sub-directories every start needs before anything is written into them.
export function ensureLayout(layout) {
  for (const directory of [layout.config, layout.samples, layout.state, layout.logs, layout.checks, layout.reports, layout.home, layout.tmp]) mkdirSync(directory, { recursive: true });
}

// The pid state/server.json names, when that process is still alive (starting or ready; a process we may not signal still counts as alive).
function recordedPid(layout) {
  let pid;
  try { ({ pid } = JSON.parse(readFileSync(layout.server, 'utf8'))); } catch { return null; }
  return isAlive(pid) ? pid : null;
}

// The data directory as a plain directory this candidate made: a real directory (not a link) carrying a marker that names itself.
function plainRoot(layout, action) {
  let stat;
  try { stat = lstatSync(layout.root); } catch { throw refusal('CANDIDATE_DATA_FOREIGN', `${layout.root} does not exist, so there is nothing to ${action}.`); }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw refusal('CANDIDATE_DATA_FOREIGN', `${layout.root} is not a plain directory, so it is not used.`);
  return real(layout.root);
}
function markedRoot(layout, realRoot) {
  const marker = readMarker(layout, realRoot);
  if (!marker) throw refusal('CANDIDATE_DATA_FOREIGN', `${layout.root} carries no valid candidate marker for this location, so it is not used.`);
  return marker;
}
export function assertCandidateDir(dataDir, action = 'use') {
  const layout = candidateLayout(dataDir), realRoot = plainRoot(layout, action);
  return { layout, realRoot, marker: markedRoot(layout, realRoot) };
}

// `home` and `repoRoot` are parameters only so a test can stand in for them.
export async function resetDataDir(dataDir, { home = homedir(), repoRoot = REPO_ROOT } = {}) {
  const layout = candidateLayout(dataDir), realRoot = plainRoot(layout, 'reset');
  if (same(parse(realRoot).root, realRoot)) throw refusal('CANDIDATE_DATA_PROTECTED', `${realRoot} is a filesystem root and is never reset.`);
  // The home, anything that contains it, and the repository (or anything that contains it) are never deleted.
  if (within(realRoot, realOrResolved(home))) throw refusal('CANDIDATE_DATA_PROTECTED', `${realRoot} is, or contains, the real home directory and is never reset.`);
  if (within(realRoot, realOrResolved(repoRoot))) throw refusal('CANDIDATE_DATA_PROTECTED', `${realRoot} is, or contains, the aih-ui repository and is never reset.`);
  markedRoot(layout, realRoot);
  const pid = recordedPid(layout);
  if (pid !== null) throw refusal('CANDIDATE_RUNNING', `The candidate still appears to be running (process ${pid}). Stop it first: node tools/candidate.mjs stop`);
  const entries = readdirSync(realRoot).length;
  await rm(realRoot, { recursive: true, force: true, maxRetries: 3 });
  const claimed = claimDataDir(layout.root);
  return { removed: realRoot, entries, layout, marker: claimed.marker };
}

export const dataDirExists = dataDir => existsSync(candidateLayout(dataDir).marker);
