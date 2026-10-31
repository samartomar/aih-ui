// The temporary folders a Workbench host stages Catalog material in, under the account's temporary folder (os.tmpdir():
// TMPDIR on Linux and macOS, the user's %TEMP% on Windows). Each holds a marker naming the process that made it. The host
// removes its own when its server closes or its process exits; at start it removes those an earlier host left behind
// because it was killed or crashed. Nothing else in the temporary folder is ever touched.
import { lstat, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const STAGING_PREFIXES = ['aih-authoring-materials-', 'aih-personal-grant-'];
export const STAGING_MARKER = '.aih-workbench-host-staging.json';
// A folder an older Workbench made has no marker, so whether its host still runs is unknown: it is left for a day.
export const UNMARKED_AGE_MS = 24 * 60 * 60 * 1000;
// mkdtemp appends six characters to the prefix; only names of exactly that shape are this Workbench's.
const NAME = new RegExp(`^(?:${STAGING_PREFIXES.join('|')})[A-Za-z0-9]{6}$`);

const live = new Set();
let exitHook = false;
const removeNow = directory => { try { rmSync(directory, { recursive: true, force: true }); } catch { /* Left for the next start's sweep. */ } };

/** A new staging folder for this process, removed by releaseStaging or when the process exits. */
export async function createStaging(prefix, { root = tmpdir() } = {}) {
  if (!STAGING_PREFIXES.includes(prefix)) throw new Error(`Unknown host staging prefix ${prefix}.`);
  const directory = await mkdtemp(join(root, prefix));
  live.add(directory);
  if (!exitHook) { exitHook = true; process.once('exit', () => { for (const value of live) removeNow(value); }); }
  await writeFile(join(directory, STAGING_MARKER), JSON.stringify({ pid: process.pid }) + '\n');
  return directory;
}

/** Removes a staging folder this process made. */
export function releaseStaging(directory) {
  if (!live.delete(directory)) return;
  removeNow(directory);
}

export function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

/**
 * Removes the staging folders an earlier host left in `root`: a folder named with a staging prefix, a real directory (not
 * a link), owned by this account where the platform reports owners, whose marked process is gone; or, with no marker,
 * older than UNMARKED_AGE_MS. A folder this process made, or a live host's, is kept. Returns the removed paths.
 */
export async function sweepStaging({ root = tmpdir(), now = Date.now(), alive = processAlive, uid = process.getuid?.() } = {}) {
  const removed = [];
  let names;
  try { names = await readdir(root); } catch { return removed; }
  for (const name of names) {
    if (!NAME.test(name)) continue;
    const directory = join(root, name);
    if (live.has(directory)) continue;
    try {
      const stat = await lstat(directory);
      if (!stat.isDirectory() || (uid !== undefined && stat.uid !== uid)) continue;
      const marker = await readFile(join(directory, STAGING_MARKER), 'utf8').then(text => JSON.parse(text), () => undefined);
      const stale = Number.isInteger(marker?.pid) ? marker.pid !== process.pid && !alive(marker.pid) : now - stat.mtimeMs > UNMARKED_AGE_MS;
      if (!stale) continue;
      await rm(directory, { recursive: true, force: true });
      removed.push(directory);
    } catch { /* Another host removed it first, or it cannot be read; it is not this host's to force. */ }
  }
  return removed;
}
