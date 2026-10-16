// The one way a journey envelope file is replaced: the new bytes are written to a private temporary file beside it and renamed over
// it, so a reader sees the old envelope or the new one, never a partial write. Used by the batch adapter and by the batch child,
// which persists the superseding batch that spends the consent to run an opaque process before it can run.
// The replace is a compare-and-swap on `expectedRevisionSha256`, which is required: under an exclusive lock (`<path>.lock`, created exclusively and
// removed afterwards) the stored envelope's revision digest must be the expected one, else nothing is written
// (`BATCH_ENVELOPE_CHANGED`; `BATCH_ENVELOPE_BUSY` while another writer holds the lock). The lock holds its writer's token and is
// released only by that writer. A lock left by a writer that died is broken once it is older than LOCK_STALE_MS (far longer than a
// replace takes) by renaming it aside, which only one writer can win.
import { readFile, stat, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const LOCK_STALE_MS = 15_000;
// A lock file another writer is creating, removing or holding open answers EEXIST, ENOENT or, on Windows, EPERM/EACCES/EBUSY: all mean another writer is at it.
const contended = error => ['EEXIST', 'ENOENT', 'EPERM', 'EACCES', 'EBUSY'].includes(error.code);
const failure = (code, message) => Object.assign(new Error(message), { code });
export const revisionOf = bytes => { try { return JSON.parse(Buffer.from(bytes).toString('utf8'))?.revision?.sha256 ?? null; } catch { return null; } };

async function lock(path) {
  const token = randomUUID();
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await writeFile(path, token, { flag: 'wx', mode: 0o600 }); return token; }
    catch (error) { if (!contended(error)) throw error; }
    const age = await stat(path).then(found => Date.now() - found.mtimeMs, error => { if (contended(error)) return null; throw error; });
    if (age === null) continue;
    if (age < LOCK_STALE_MS) break;
    const aside = `${path}.${token}.stale`;
    if (await rename(path, aside).then(() => true, error => { if (contended(error)) return false; throw error; })) await rm(aside, { force: true });
  }
  throw failure('BATCH_ENVELOPE_BUSY', 'Another change to the saved batch is in progress.');
}
const unlock = async (path, token) => { if (await readFile(path, 'utf8').catch(() => null) === token) await rm(path, { force: true }); };

export async function replaceEnvelope(path, bytes, { expectedRevisionSha256 } = {}) {
  if (typeof expectedRevisionSha256 !== 'string') throw new TypeError('Name the revision digest the stored envelope must have.');
  const token = await lock(`${path}.lock`);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const stored = await readFile(path).then(revisionOf, () => null);
    if (stored === null || stored !== expectedRevisionSha256) throw failure('BATCH_ENVELOPE_CHANGED', 'The saved batch changed since it was read.');
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); await unlock(`${path}.lock`, token); }
}
