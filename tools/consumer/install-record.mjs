// The Workbench's own record of what it installed in one project folder: for each selection Core applied, its scope,
// the configuration it was installed with and the selections it required then. Core keeps these facts only in its
// private ownership records and publishes no reader for them, and its inventory carries neither, so an update reads
// them here rather than from the editable setup in the page.
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FORMAT = 'aih-ui-installed-record', VERSION = 1, MAX_BYTES = 8 * 1024 * 1024;
export const selectionKey = (scope, managementId) => `${scope}:${managementId}`;

/** `root` is the folder beside the Workbench's setup store; HTTP inputs never choose it. */
export function createInstallRecord({ root, project }) {
  const real = realpathSync(project);
  const directory = join(root, 'installed'), path = join(directory, `${createHash('sha256').update(real).digest('hex')}.json`);
  const guard = target => { try { if (lstatSync(target).isSymbolicLink()) throw new Error('The install record must not be a symbolic link.'); } catch (error) { if (error.code !== 'ENOENT') throw error; } };
  function read() {
    for (const target of [root, directory, path]) guard(target);
    let text;
    try { if (lstatSync(path).size > MAX_BYTES) throw new Error('The install record is too large.'); text = readFileSync(path, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return new Map(); throw error; }
    const document = JSON.parse(text);
    if (document?.format !== FORMAT || document.version !== VERSION || document.project !== real || typeof document.selections !== 'object') throw new Error('The install record is not this Workbench\'s record of this project.');
    return new Map(Object.entries(document.selections));
  }
  /** Adds or replaces the given selections, keyed by scope and management id; every other entry is kept. */
  function record(entries) {
    if (!entries.length) return;
    const selections = read();
    for (const entry of entries) selections.set(selectionKey(entry.scope, entry.managementId), structuredClone(entry));
    const bytes = `${JSON.stringify({ format: FORMAT, version: VERSION, project: real, selections: Object.fromEntries(selections) }, null, 2)}\n`;
    if (Buffer.byteLength(bytes) > MAX_BYTES) throw new Error('The install record would be too large.');
    mkdirSync(directory, { recursive: true }); for (const target of [root, directory]) guard(target);
    const temporary = join(directory, `.record-${randomUUID()}.tmp`);
    try { writeFileSync(temporary, bytes, { flag: 'wx' }); renameSync(temporary, path); }
    catch (error) { try { unlinkSync(temporary); } catch { /* already gone */ } throw error; }
  }
  return { read, record };
}
