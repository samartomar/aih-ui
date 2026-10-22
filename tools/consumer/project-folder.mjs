// The ordinary page's project folder: host state the page may change. The host's configured project
// (AIH_CONSUMER_PROJECT, startConsumer({ projectRoot })) is the default; a folder chosen on the page replaces it
// for this server's lifetime. A switch is refused while Install or Remove is running, and `onChange` replaces the
// execution hosts, so nothing prepared for the old folder can be applied in the new one.
import { realpath, stat } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import { isAbsolute, join, parse, sep } from 'node:path';

const refused = reason => ({ status: 'refused', reason });
const comparable = path => process.platform === 'win32' ? path.toLowerCase() : path;
// The account's own home, from the account database rather than the environment: a host run with an isolated
// HOME (the candidate, a test) must still refuse the real one, where Claude Code loads skills for every project.
const accountHomeDir = () => { try { return userInfo().homedir; } catch { return undefined; } };
const realOrSame = async path => { try { return await realpath(path); } catch { return path; } };

/** Whether `path` may be the project folder: { status: 'ok', project } with its real path, or { status: 'refused', reason }. */
export async function checkProjectFolder(path, { env = process.env, home = homedir(), accountHome = accountHomeDir() } = {}) {
  if (typeof path !== 'string' || !path.trim()) return refused('Type the full path of a folder.');
  if (!isAbsolute(path)) return refused('Use the full path of the folder, starting from the drive or /.');
  let project, folder;
  try { project = await realpath(path); folder = (await stat(project)).isDirectory(); } catch { return refused('That folder does not exist.'); }
  if (!folder) return refused('That path is a file, not a folder.');
  if (parse(project).root === project) return refused('A drive or filesystem root cannot be the project folder. Choose a folder inside it.');
  const target = comparable(project);
  for (const value of new Set([home, accountHome, env.HOME, env.USERPROFILE].filter(value => typeof value === 'string' && value))) {
    const own = await realOrSame(value);
    if (target === comparable(own)) return refused('Your home folder cannot be the project folder. Choose a project inside it.');
    const state = comparable(await realOrSame(join(own, '.aih')));
    if (target === state || target.startsWith(state + sep)) return refused('Core keeps its own records in this folder, so it cannot be the project folder.');
  }
  return { status: 'ok', project };
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
    read: () => ({ ...current }),
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
