// The ordinary page's project folder: host state the page may change. The host's configured project
// (AIH_CONSUMER_PROJECT, startConsumer({ projectRoot })) is the default; a folder chosen on the page replaces it
// for this server's lifetime. A switch is refused while Install or Remove is running, and `onChange` replaces the
// execution hosts, so nothing prepared for the old folder can be applied in the new one.
import { realpath, stat, opendir } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import { isAbsolute, parse, sep, dirname, join } from 'node:path';

import { readCoreState, stateRootForHome } from './core-state-location.mjs';
import { loadCoreState } from './core-state-loader.mjs';

const refused = reason => ({ status: 'refused', reason });
const comparable = path => process.platform === 'win32' ? path.toLowerCase() : path;
// The account's own home, from the account database rather than the environment: a host run with an isolated
// HOME (the candidate, a test) must still refuse the real one, where Claude Code loads skills for every project.
const accountHomeDir = () => { try { return userInfo().homedir; } catch { return undefined; } };
const realOrSame = async path => { try { return await realpath(path); } catch { return path; } };

/** Whether `path` may be the project folder: { status: 'ok', project } with its real path, or { status: 'refused', reason }. */
export async function checkProjectFolder(path, { env = process.env, home = homedir(), accountHome = accountHomeDir(), coreState } = {}) {
  if (typeof path !== 'string' || !path.trim()) return refused('Type the full path of a folder.');
  if (!isAbsolute(path)) return refused('Use the full path of the folder, starting from the drive or /.');
  let project, folder;
  try { project = await realpath(path); folder = (await stat(project)).isDirectory(); } catch { return refused('That folder does not exist.'); }
  if (!folder) return refused('That path is a file, not a folder.');
  if (parse(project).root === project) return refused('A whole drive cannot be the project folder. Choose a folder inside it.');
  const target = comparable(project);
  for (const value of new Set([home, accountHome, env.HOME, env.USERPROFILE].filter(value => typeof value === 'string' && value))) {
    const own = await realOrSame(value);
    if (target === comparable(own)) return refused('Your home folder cannot be the project folder. Choose a project inside it.');
  }
  coreState ??= await loadCoreState();
  const location = readCoreState(coreState);
  if (location.status !== 'available') return refused(location.reason);
  const homes = new Set([home, accountHome, env.HOME, env.USERPROFILE].filter(value => typeof value === 'string' && isAbsolute(value)));
  const roots = [location.root, ...[...homes].map(value => stateRootForHome(value, location.descriptor))];
  for (const root of roots) {
    const state = comparable(await realOrSame(root));
    if (target === state || target.startsWith(state + sep)) return refused('Core keeps its own records in this folder, so it cannot be the project folder.');
  }
  return { status: 'ok', project };
}

// Read-only chooser metadata. Never read files, recurse, follow directory links, or switch the project.
// Bound both scanning and the returned menu; a typed path remains available for large directories.
export async function listProjectFolders(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) return refused('Use a full folder path on the Workbench host.');
  let current;
  try {
    current = await realpath(path);
    const directories = []; let scanned = 0, truncated = false;
    for await (const entry of await opendir(current)) {
      if (++scanned > 1000 || directories.length >= 200) { truncated = true; break; }
      if (entry.isDirectory() && !entry.name.startsWith('.')) directories.push({ name: entry.name, path: join(current, entry.name) });
    }
    directories.sort((a, b) => a.name.localeCompare(b.name));
    return { status: 'ok', path: current, parent: dirname(current), directories, truncated };
  } catch { return refused('This folder cannot be listed. Enter another path on the Workbench host.'); }
}

/** `task` run once: callers share the run in flight and its result; a failed run is cleared so the next caller retries. */
export function shared(task) {
  let running;
  return () => running ??= task().catch(error => { running = undefined; throw error; });
}

const busy = { status: 'busy', code: 'FOLDER_BUSY', reason: 'Install or Remove is running in the current project folder. Wait for it to finish, then change the folder.' };

/**
 * `run(work)` marks Install or Remove work against the current folder; `choose(path)` switches only when none is
 * running, before and after the path is checked. `beforeChange` (async) readies what a first folder needs.
 */
export function createProjectFolder({ initial, onChange, beforeChange = async () => {}, options } = {}) {
  let current = initial ? { project: initial, source: 'host-default' } : { project: null, source: 'none' }, running = 0;
  return {
    get project() { return current.project; },
    browse: path => listProjectFolders(path ?? current.project ?? options?.home ?? homedir()),
    read: () => {
      const location = options?.coreState && readCoreState(options.coreState);
      return { ...current, ...(location?.status === 'unavailable' ? { stateLocation: location } : {}) };
    },
    /** Called inside `run`: a chosen folder must still be the same real folder and still pass the checks. */
    async verify() {
      if (current.source !== 'chosen') return undefined;
      const checked = await checkProjectFolder(current.project, options);
      if (checked.status === 'ok' && comparable(checked.project) === comparable(current.project)) return undefined;
      return { status: 'refused', code: 'FOLDER_CHANGED', reason: checked.status === 'ok' ? 'This path is no longer the folder you chose: it now leads to another folder.' : checked.reason };
    },
    async run(work) { running++; try { return await work(); } finally { running--; } },
    async choose(path) {
      if (running) return busy;
      const checked = await checkProjectFolder(path, options);
      if (checked.status !== 'ok') return checked;
      await beforeChange();
      if (running) return busy;
      current = { project: checked.project, source: 'chosen' };
      onChange(checked.project);
      return { status: 'ok', ...current };
    },
  };
}
