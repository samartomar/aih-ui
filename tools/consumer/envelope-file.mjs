// The one way a journey envelope file is replaced: the new bytes are written to a private temporary file beside it and renamed over
// it, so a reader sees the old envelope or the new one, never a partial write. Used by the batch adapter and by the batch child,
// which persists the superseding batch that spends a Run again choice before the process can run.
import { writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export async function replaceEnvelope(path, bytes) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 }); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}
