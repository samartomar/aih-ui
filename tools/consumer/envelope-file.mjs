// The one way a journey envelope file is replaced: the new bytes are written to a private temporary file beside it and renamed over
// it, so a reader sees the old envelope or the new one, never a partial write. Used by the batch adapter alone, for every write of the
// envelope file: its own (a continuation choice, a recovery) and the ones the batch child asks for, which record each attempt at an
// opaque process (a first attempt: the superseding batch that keeps the action; Run again: the same batch at its next revision)
// before the process can run.
// The replace is a compare-and-swap on `expectedRevisionSha256`, which is required: the stored envelope's revision digest must be the
// expected one, else nothing is written (`BATCH_ENVELOPE_CHANGED`). The guarantee is one writer process: within one process every
// replace of a file runs in its own turn, one after another in the order they were made, so each reads the revision the previous one
// left. Nothing is left on disk to reclaim when a process dies (at worst a temporary file, which never replaces anything). Two
// separate processes replacing one envelope file are not supported; the batch page has exactly one writer.
import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const failure = (code, message) => Object.assign(new Error(message), { code });
export const revisionOf = bytes => { try { return JSON.parse(Buffer.from(bytes).toString('utf8'))?.revision?.sha256 ?? null; } catch { return null; } };

// The end of the latest replace queued for each file; a replace starts once the one before it has settled, whichever way it settled.
const turns = new Map();
const keyOf = path => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);

async function replace(path, bytes, expectedRevisionSha256) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const stored = await readFile(path).then(revisionOf, () => null);
    if (stored === null || stored !== expectedRevisionSha256) throw failure('BATCH_ENVELOPE_CHANGED', 'The saved batch changed since it was read.');
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

export function replaceEnvelope(path, bytes, { expectedRevisionSha256 } = {}) {
  if (typeof expectedRevisionSha256 !== 'string') return Promise.reject(new TypeError('Name the revision digest the stored envelope must have.'));
  const key = keyOf(path), turn = (turns.get(key) ?? Promise.resolve()).then(() => replace(path, bytes, expectedRevisionSha256));
  const ended = turn.then(() => {}, () => {});
  turns.set(key, ended);
  ended.then(() => { if (turns.get(key) === ended) turns.delete(key); });
  return turn;
}
