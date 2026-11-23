import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export const proposalId = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const MAX_RECORD = 8192;
const filename = id => id + '.json';

export function createGithubRecovery(directory) {
  if (!directory) return { get: async () => null, list: async () => [], save: async () => {} };

  async function exists() {
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw Error('The Workbench recovery location is not an ordinary directory.');
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  async function get(id) {
    if (typeof id !== 'string' || !proposalId.test(id) || !await exists()) return null;
    const path = join(directory, filename(id));
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_RECORD) throw Error('The Workbench recovery record is unavailable.');
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function list() {
    if (!await exists()) return [];
    const files = await readdir(directory, { withFileTypes: true });
    const records = [];
    for (const file of files) {
      const id = file.name.slice(0, -5);
      if (!file.isFile() || file.name !== filename(id) || !proposalId.test(id)) continue;
      try {
        const record = await get(id);
        if (record?.confirmationId === id) records.push(record);
      } catch { /* A malformed individual record cannot replace another proposal. */ }
    }
    return records;
  }

  async function save(record) {
    const id = record.confirmationId;
    if (typeof id !== 'string' || !proposalId.test(id)) throw Error('Invalid Workbench recovery ID.');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await exists();
    const key = join(directory, filename(id));
    const temporary = join(directory, '.' + randomUUID() + '.tmp');
    const bytes = Buffer.from(JSON.stringify(record) + '\n');
    if (bytes.length > MAX_RECORD) throw Error('The Workbench recovery record is too large.');
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(bytes); await file.sync(); }
      finally { await file.close(); }
      await rename(temporary, key);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }

  return { get, list, save };
}
