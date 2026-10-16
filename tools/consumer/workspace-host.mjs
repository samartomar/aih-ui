// Host-owned observation of one local checkout (Node only; package export `aih-ui/workspace-host`). It reads Git metadata
// (remotes, HEAD, branch, worktree) and a digest of the working state: the `git status` output, the staged changes (index
// against HEAD, as blob ids and modes), a sha256 of the bytes of every changed file and, for an untracked folder, the relative
// paths and content digests of its files. All of it is computed here and never stored or returned, so editing a file that is
// already modified, or staging another version of it, changes the digest; an unmerged checkout is refused. Submodule state is not
// part of the identity (`--ignore-submodules=all`, so a submodule's own configuration is never consulted). No network access (lazy
// fetching in a partial clone is switched off and status detects no renames, which would need missing objects) and no write to
// config, refs or objects: optional locks are off, fsmonitor and the untracked cache are disabled, every content filter the
// repository's own configuration (local, worktree or an include of them) defines is switched off for the call, remotes come from
// that same repository configuration only and inherited GIT_* repository and config variables are dropped. Remote URLs are
// reduced to a normalized identity inside this module, so a credential in a URL never leaves it. Nothing here blocks the server:
// Git runs as a child process and files are read with asynchronous I/O.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, readlink, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { refuse } from './headless.mjs';
import { remoteIdentity, UNRECOGNIZED_REMOTE } from './workspace-record.mjs';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const unavailable = message => refuse('CHECKOUT_UNAVAILABLE', '/root', message);
const notRepository = () => refuse('CHECKOUT_NOT_REPOSITORY', '/root', 'The folder is not a working checkout of a Git repository (a bare repository cannot be bound).');
const sameFolder = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const MAX_REMOTES = 32, MAX_FILTERS = 32, MAX_CHANGED_PATHS = 2000, MAX_CHANGED_BYTES = 256 * 1024 * 1024, MAX_LISTED_ENTRIES = 20000;
const TOO_MANY_CHANGES = 'Too many changed files, or more than 256 MiB of changed content, to identify the working state; commit, stash or ignore them, then inspect again.';
const UNREADABLE = 'Git metadata could not be read for this folder.';
const OWNED = 'Git refuses this folder because it is owned by another user (safe.directory).';
// Git settings that point a command at some other repository, index, object store or extra configuration.
const INHERITED = /^(?:GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_OBJECT_DIRECTORY|GIT_ALTERNATE_OBJECT_DIRECTORIES|GIT_COMMON_DIR|GIT_NAMESPACE|GIT_CONFIG|GIT_CONFIG_PARAMETERS|GIT_CONFIG_COUNT|GIT_CONFIG_KEY_.*|GIT_CONFIG_VALUE_.*)$/i;
const environment = () => ({ ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !INHERITED.test(name))), GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0',
  // A partial clone would otherwise fetch a missing object, through a transport the repository's own configuration can name.
  GIT_NO_LAZY_FETCH: '1' });
const READ_ONLY = ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false'];
// The default process runner: `{ status, stdout, stderr }`, plus `error` when the process could not run, timed out or overran its output.
const run = (command, args, options) => new Promise(done => {
  try {
    execFile(command, args, options, (error, stdout, stderr) => done(!error ? { status: 0, stdout, stderr } : typeof error.code === 'number' ? { status: error.code, stdout, stderr } : { status: null, stdout, stderr, error }));
  } catch (error) { done({ status: null, stdout: '', stderr: '', error }); }
});
const tooBig = result => result.error?.code === 'ENOBUFS' || result.error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
const git = async (spawn, root, args, { encoding = 'utf8', overrides = [] } = {}) => {
  try {
    return await spawn('git', [...READ_ONLY, ...overrides, '-C', root, ...args],
      { windowsHide: true, encoding, timeout: 10_000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], env: environment() });
  } catch (error) { return { status: null, stdout: '', stderr: '', error }; }
};
// Entries `{ scope, key, value }` of `git config --includes --show-scope -z --get-regexp`, whose records are `scope NUL key LF value NUL`.
// Only the repository's own configuration counts (local and worktree, and files they include); global, system and command-line
// settings are the person's own and are not read as the repository's.
function repositoryConfig(output) {
  const entries = [];
  const tokens = String(output).split('\0');
  for (let at = 0; at + 1 < tokens.length; at += 2) {
    const scope = tokens[at], rest = tokens[at + 1], newline = rest.indexOf('\n');
    if (scope !== 'local' && scope !== 'worktree') continue;
    entries.push({ scope, key: newline < 0 ? rest : rest.slice(0, newline), value: newline < 0 ? '' : rest.slice(newline + 1) });
  }
  return entries;
}
// Remote names with their normalized identity (null when not a recognizable network repository), sorted by name. One remote with
// URLs of different identities has no single identity, so it is null. A remote whose name cannot be carried is never dropped: it
// is recorded as `(unrecognized)` with no identity. More than 32 remotes is `null` (refused by the caller).
function remotesOf(entries) {
  const found = new Map(), names = new Set();
  for (const { key, value } of entries) {
    const match = /^remote\.(.+)\.url$/.exec(key);
    if (!match) continue;
    names.add(match[1]);
    const name = /^[\w./-]{1,200}$/.test(match[1]) ? match[1] : UNRECOGNIZED_REMOTE;
    const identity = name === UNRECOGNIZED_REMOTE ? null : remoteIdentity(value)?.identity ?? null;
    found.set(name, found.has(name) && found.get(name) !== identity ? null : identity);
  }
  if (names.size > MAX_REMOTES) return null;
  return [...found].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, identity]) => ({ name, identity }));
}
// The `-c` settings that switch off every content filter driver the repository defines (`filter.<name>.*`), or null when there are
// too many or a name cannot be given on a command line. An empty clean, smudge or process command means no filter, and a filter
// that is not required cannot fail the call.
function filterOverrides(entries) {
  const names = new Set();
  for (const { key } of entries) { const match = /^filter\.(.+)\.[^.]+$/.exec(key); if (match) names.add(match[1]); }
  if (names.size > MAX_FILTERS || [...names].some(name => /[=\n\0]/.test(name))) return null;
  return [...names].flatMap(name => ['clean', 'smudge', 'process'].flatMap(attribute => ['-c', `filter.${name}.${attribute}=`]).concat(['-c', `filter.${name}.required=false`]));
}
// Whether `status --porcelain=v1 -z` lists an unmerged entry (DD, AU, UD, UA, DU, AA or UU).
const unmerged = porcelain => porcelain.toString('utf8').split('\0').some(entry => /^(?:DD|AU|UD|UA|DU|AA|UU) /.test(entry));
// Paths listed by `status --porcelain=v1 -z`: each entry is `XY path`, and a rename or copy entry is followed by its original path.
// An untracked folder is one entry with a trailing slash.
function changedPaths(porcelain) {
  const tokens = porcelain.toString('utf8').split('\0'), paths = new Set();
  for (let at = 0; at < tokens.length; at++) {
    const entry = tokens[at];
    if (entry.length < 4) continue;
    paths.add(entry.slice(3));
    if (/[RC]/.test(entry.slice(0, 2))) at++;
  }
  return [...paths];
}
// sha256 of the relative path and content digest of every file below an untracked folder (nested `.git` entries are skipped and
// links digest their target string); undefined when the folder holds more than the entry limit or the byte budget is spent.
async function folderListing(folder, budget) {
  const lines = [], pending = [['', folder]];
  try {
    while (pending.length > 0) {
      const [prefix, current] = pending.pop();
      for (const item of await readdir(current, { withFileTypes: true })) {
        if (item.name === '.git') continue;
        if (++budget.entries > budget.limit) return undefined;
        if (item.isDirectory()) { pending.push([`${prefix}${item.name}/`, join(current, item.name)]); continue; }
        const digest = await entryDigest(join(current, item.name), budget);
        if (digest === undefined) return undefined;
        lines.push(`${prefix}${item.name}\0${digest}\0`);
      }
    }
  } catch { return sha256('unreadable'); }
  return sha256(lines.sort().join(''));
}
// sha256 of a file's bytes, read in bounded chunks; a symlink digests its target string and is never followed, a path that
// resolves outside the checkout is not read, and anything that is not a regular file is not opened. A folder (an untracked
// folder entry) digests its listing. `null` for a deleted path, `undefined` when a budget is exceeded.
async function contentDigest(checkout, real, path, budget) {
  const full = join(checkout, path.replace(/\/$/, ''));
  let info;
  try { info = await lstat(full); } catch (error) { return (error.code === 'ENOENT' || error.code === 'ENOTDIR') && !path.includes('�') ? null : sha256('unreadable'); }
  try {
    const parent = await realpath(dirname(full)), inside = sameFolder(parent, real) || (sameFolder(parent.slice(0, real.length), real) && parent[real.length] === sep);
    if (!inside) return sha256('outside');
    if (info.isDirectory()) return path.endsWith('/') ? folderListing(full, budget) : sha256('directory');
    return entryDigest(full, budget, info);
  } catch { return sha256('unreadable'); }
}
// sha256 of one entry that is not a folder: a symlink digests its target string and is never followed, a regular file its bytes (read
// in bounded chunks against the shared byte budget), anything else only its kind. `undefined` when the byte budget is spent.
async function entryDigest(full, budget, known) {
  try {
    const info = known ?? await lstat(full);
    if (info.isSymbolicLink()) return sha256(`symlink:${await readlink(full)}`);
    if (!info.isFile()) return sha256('special');
    budget.bytes += info.size;
    if (budget.bytes > MAX_CHANGED_BYTES) return undefined;
    const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(1 << 20), file = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try { for (let read = await file.read(buffer, 0, buffer.length, null); read.bytesRead > 0; read = await file.read(buffer, 0, buffer.length, null)) hash.update(buffer.subarray(0, read.bytesRead)); } finally { await file.close(); }
    return hash.digest('hex');
  } catch { return sha256('unreadable'); }
}
// `{ clean, sha256 }` identifying the working state, or null when too many files changed. The digest covers the porcelain bytes, the
// staged changes and the sorted `path NUL digest NUL` list, so any change to a listed file's content or to what is staged changes it;
// no content is kept.
async function workingStateOf(checkout, porcelain, staged, limit) {
  const paths = changedPaths(porcelain);
  if (paths.length > MAX_CHANGED_PATHS) return null;
  let real;
  try { real = await realpath(checkout); } catch { return null; }
  const budget = { bytes: 0, entries: 0, limit }, entries = [];
  for (const path of paths) {
    const digest = await contentDigest(checkout, real, path, budget);
    if (digest === undefined) return null;
    if (digest !== null) entries.push([path, digest]);
  }
  const hash = createHash('sha256').update(`status\0${porcelain.length}\0`).update(porcelain).update(`staged\0${staged.length}\0`).update(staged);
  for (const [path, digest] of entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) hash.update(`${path}\0${digest}\0`);
  return { clean: porcelain.length === 0, sha256: hash.digest('hex') };
}
const refusedOwnership = result => /dubious ownership|safe\.directory/i.test(String(result.stderr ?? ''));
// `get-regexp` exits 1 when nothing matches, which is an empty answer.
const configFailed = result => result.error || (result.status !== 0 && result.status !== 1);
// `{ status: 'ok', value: observation }` of the working checkout that holds `root` (a subfolder selects its checkout), or a
// refusal. The observation never contains a raw remote URL, a file name or file content. `spawn` is the process runner
// (tests substitute one; it may answer synchronously or with a promise); it is always called with windowsHide. `listedEntries` is the most
// files a single observation lists below untracked folders (tests lower it).
export async function observeCheckout(root, spawn = run, { listedEntries = MAX_LISTED_ENTRIES } = {}) {
  if (typeof root !== 'string' || root.length === 0 || root.length > 1024 || root.includes('\0') || !isAbsolute(root)) return unavailable('Supply an absolute folder path of at most 1024 characters.');
  let folder;
  try { folder = await stat(root); } catch { return unavailable('The folder cannot be read.'); }
  if (!folder.isDirectory()) return unavailable('The path is not a folder.');
  const top = await git(spawn, root, ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir']);
  if (top.error) return unavailable('Git could not be run for this folder.');
  if (top.status !== 0 && refusedOwnership(top)) return unavailable(OWNED);
  const [toplevel, gitDir, commonDir] = top.status === 0 ? top.stdout.split(/\r?\n/) : [];
  if (!toplevel || !gitDir || !commonDir) return notRepository();
  const checkout = resolve(toplevel), absoluteGitDir = resolve(gitDir);
  const configured = pattern => git(spawn, checkout, ['config', '--includes', '--show-scope', '-z', '--get-regexp', pattern]);
  const [head, branch, remoteConfig, filterConfig] = await Promise.all([git(spawn, checkout, ['rev-parse', '-q', '--verify', 'HEAD^{commit}']), git(spawn, checkout, ['symbolic-ref', '-q', '--short', 'HEAD']),
    configured('^remote\\..*\\.url$'), configured('^filter\\.')]);
  if (head.error || branch.error || configFailed(remoteConfig) || configFailed(filterConfig)) return unavailable(refusedOwnership(remoteConfig) ? OWNED : UNREADABLE);
  const remotes = remotesOf(repositoryConfig(remoteConfig.stdout));
  if (remotes === null) return unavailable(`The checkout has more than ${MAX_REMOTES} remotes.`);
  const overrides = filterOverrides(repositoryConfig(filterConfig.stdout));
  if (overrides === null) return unavailable('The checkout configures content filters that this Workbench cannot switch off for a read; remove them from the repository configuration and inspect again.');
  const revision = head.status === 0 && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head.stdout.trim()) ? head.stdout.trim() : null;
  // What is staged: the index against HEAD (blob ids and modes, never content), or the whole index when HEAD is not born yet.
  const [status, staged] = await Promise.all([git(spawn, checkout, ['status', '--porcelain=v1', '-z', '--untracked-files=normal', '--ignore-submodules=all', '--no-renames'], { encoding: 'buffer', overrides }),
    git(spawn, checkout, head.status === 0 ? ['diff', '--cached', '--raw', '-z', '--no-renames', '--abbrev=40', '--no-ext-diff', '--ignore-submodules=all', 'HEAD', '--'] : ['ls-files', '-s', '-z'], { encoding: 'buffer', overrides })]);
  if (tooBig(status) || tooBig(staged)) return unavailable(TOO_MANY_CHANGES);
  if (status.error || staged.error || status.status !== 0 || staged.status !== 0) return unavailable(refusedOwnership(status) ? OWNED : UNREADABLE);
  // Conflict stages are not in the staged diff, so an unmerged checkout has no identifiable working state.
  if (unmerged(status.stdout)) return unavailable('The checkout has unresolved merge conflicts; resolve them, then inspect again.');
  const workingState = await workingStateOf(checkout, status.stdout, staged.stdout, listedEntries);
  if (workingState === null) return unavailable(TOO_MANY_CHANGES);
  const name = branch.status === 0 ? branch.stdout.trim() : '';
  return { status: 'ok', diagnostics: [], value: { root: checkout, remotes, revision, ...(name !== '' ? { branch: name } : {}),
    worktree: { kind: sameFolder(absoluteGitDir, resolve(root, commonDir)) ? 'main' : 'linked', gitDirSha256: sha256(absoluteGitDir) }, workingState, observedAt: new Date().toISOString() } };
}
