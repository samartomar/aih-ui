// Host-owned observation of one local checkout (Node only; package export `aih-ui/workspace-host`). It reads Git metadata
// (remotes, HEAD, branch, worktree) and a digest of the working state: the `git status` output plus a sha256 of the bytes
// of every changed file, computed here and never stored or returned, so editing a file that is already modified changes the
// digest. No network access and no write to config, refs or objects: optional locks are off, fsmonitor and the untracked
// cache are disabled, remotes come from the repository's own config only and inherited GIT_* repository and config
// variables are dropped. Remote URLs are reduced to a normalized identity inside this module, so a credential in a URL never
// leaves it. Residual risk: `git status` may still run a clean filter that the repository's own config defines while it
// compares files with the index; this module does not and cannot prevent that.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, lstatSync, openSync, readSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { refuse } from './headless.mjs';
import { remoteIdentity, UNRECOGNIZED_REMOTE } from './workspace-record.mjs';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const unavailable = message => refuse('CHECKOUT_UNAVAILABLE', '/root', message);
const notRepository = () => refuse('CHECKOUT_NOT_REPOSITORY', '/root', 'The folder is not a working checkout of a Git repository (a bare repository cannot be bound).');
const sameFolder = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const MAX_REMOTES = 32, MAX_CHANGED_PATHS = 2000, MAX_CHANGED_BYTES = 256 * 1024 * 1024;
const TOO_MANY_CHANGES = 'Too many changed files to identify the working state; commit or stash, then inspect again.';
// Git settings that point a command at some other repository, index, object store or extra configuration.
const INHERITED = /^(?:GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_OBJECT_DIRECTORY|GIT_ALTERNATE_OBJECT_DIRECTORIES|GIT_COMMON_DIR|GIT_NAMESPACE|GIT_CONFIG|GIT_CONFIG_PARAMETERS|GIT_CONFIG_COUNT|GIT_CONFIG_KEY_.*|GIT_CONFIG_VALUE_.*)$/i;
const environment = () => ({ ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !INHERITED.test(name))), GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' });
const READ_ONLY = ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false'];
const git = (spawn, root, args, encoding = 'utf8') => spawn('git', [...READ_ONLY, '-C', root, ...args],
  { windowsHide: true, encoding, timeout: 10_000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], env: environment() });
// Remote names with their normalized identity (null when not a recognizable network repository), sorted by name. One remote with
// URLs of different identities has no single identity, so it is null. A remote whose name cannot be carried is never dropped: it
// is recorded as `(unrecognized)` with no identity. More than 32 remotes is `null` (refused by the caller).
function remotesOf(output) {
  const found = new Map(), names = new Set();
  for (const entry of output.split('\0')) {
    const at = entry.indexOf('\n'), match = /^remote\.(.+)\.url$/.exec(at < 0 ? entry : entry.slice(0, at));
    if (!match) continue;
    names.add(match[1]);
    const name = /^[\w./-]{1,200}$/.test(match[1]) ? match[1] : UNRECOGNIZED_REMOTE;
    const identity = name === UNRECOGNIZED_REMOTE || at < 0 ? null : remoteIdentity(entry.slice(at + 1))?.identity ?? null;
    found.set(name, found.has(name) && found.get(name) !== identity ? null : identity);
  }
  if (names.size > MAX_REMOTES) return null;
  return [...found].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, identity]) => ({ name, identity }));
}
// Paths listed by `status --porcelain=v1 -z`: each entry is `XY path`, and a rename or copy entry is followed by its original path.
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
// sha256 of a file's bytes, read in bounded chunks; a symlink digests its target string and is never followed, a path that
// resolves outside the checkout is not read, and anything that is not a regular file is not opened. `null` for a deleted path.
function contentDigest(checkout, real, path, budget) {
  const full = join(checkout, path);
  let stat;
  try { stat = lstatSync(full); } catch (error) { return (error.code === 'ENOENT' || error.code === 'ENOTDIR') && !path.includes('�') ? null : sha256('unreadable'); }
  try {
    const parent = realpathSync(dirname(full)), inside = sameFolder(parent, real) || (sameFolder(parent.slice(0, real.length), real) && parent[real.length] === sep);
    if (!inside) return sha256('outside');
    if (stat.isSymbolicLink()) return sha256(`symlink:${readlinkSync(full)}`);
    if (!stat.isFile()) return sha256(stat.isDirectory() ? 'directory' : 'special');
    budget.bytes += stat.size;
    if (budget.bytes > MAX_CHANGED_BYTES) return undefined;
    const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(1 << 20), file = openSync(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try { for (let count = readSync(file, buffer, 0, buffer.length, null); count > 0; count = readSync(file, buffer, 0, buffer.length, null)) hash.update(buffer.subarray(0, count)); } finally { closeSync(file); }
    return hash.digest('hex');
  } catch { return sha256('unreadable'); }
}
// `{ clean, sha256 }` identifying the working state, or null when too many files changed. The digest covers the porcelain bytes and the
// sorted `path NUL digest NUL` list, so any change to a listed file's content changes it; no content is kept.
function workingStateOf(checkout, porcelain) {
  const paths = changedPaths(porcelain);
  if (paths.length > MAX_CHANGED_PATHS) return null;
  let real;
  try { real = realpathSync(checkout); } catch { return null; }
  const budget = { bytes: 0 }, entries = [];
  for (const path of paths) {
    const digest = contentDigest(checkout, real, path, budget);
    if (digest === undefined) return null;
    if (digest !== null) entries.push([path, digest]);
  }
  const hash = createHash('sha256').update(porcelain);
  for (const [path, digest] of entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) hash.update(`${path}\0${digest}\0`);
  return { clean: porcelain.length === 0, sha256: hash.digest('hex') };
}
const refusedOwnership = result => /dubious ownership|safe\.directory/i.test(String(result.stderr ?? ''));
// `{ status: 'ok', value: observation }` of the working checkout that holds `root` (a subfolder selects its checkout), or a
// refusal. The observation never contains a raw remote URL, a file name or file content. `spawn` is the process runner
// (tests substitute one); it is always called with windowsHide.
export function observeCheckout(root, spawn = spawnSync) {
  if (typeof root !== 'string' || root.length === 0 || root.length > 1024 || root.includes('\0') || !isAbsolute(root)) return unavailable('Supply an absolute folder path of at most 1024 characters.');
  let folder;
  try { folder = statSync(root); } catch { return unavailable('The folder cannot be read.'); }
  if (!folder.isDirectory()) return unavailable('The path is not a folder.');
  const top = git(spawn, root, ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir']);
  if (top.error) return unavailable('Git could not be run for this folder.');
  if (top.status !== 0 && refusedOwnership(top)) return unavailable('Git refuses this folder because it is owned by another user (safe.directory).');
  const [toplevel, gitDir, commonDir] = top.status === 0 ? top.stdout.split(/\r?\n/) : [];
  if (!toplevel || !gitDir || !commonDir) return notRepository();
  const checkout = resolve(toplevel), absoluteGitDir = resolve(gitDir);
  const head = git(spawn, checkout, ['rev-parse', '-q', '--verify', 'HEAD^{commit}']), branch = git(spawn, checkout, ['symbolic-ref', '-q', '--short', 'HEAD']);
  const config = git(spawn, checkout, ['config', '--local', '-z', '--get-regexp', '^remote\\..*\\.url$']);
  const status = git(spawn, checkout, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], 'buffer');
  if (status.error?.code === 'ENOBUFS') return unavailable(TOO_MANY_CHANGES);
  if (head.error || branch.error || config.error || status.error || status.status !== 0) return unavailable(refusedOwnership(status) ? 'Git refuses this folder because it is owned by another user (safe.directory).' : 'Git metadata could not be read for this folder.');
  const remotes = remotesOf(config.status === 0 ? config.stdout : '');
  if (remotes === null) return unavailable(`The checkout has more than ${MAX_REMOTES} remotes.`);
  const workingState = workingStateOf(checkout, status.stdout);
  if (workingState === null) return unavailable(TOO_MANY_CHANGES);
  const revision = head.status === 0 && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head.stdout.trim()) ? head.stdout.trim() : null, name = branch.status === 0 ? branch.stdout.trim() : '';
  return { status: 'ok', diagnostics: [], value: { root: checkout, remotes, revision, ...(name !== '' ? { branch: name } : {}),
    worktree: { kind: sameFolder(absoluteGitDir, resolve(root, commonDir)) ? 'main' : 'linked', gitDirSha256: sha256(absoluteGitDir) }, workingState, observedAt: new Date().toISOString() } };
}
