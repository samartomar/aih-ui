// Host-owned observation of one local checkout (Node only; package export `aih-ui/workspace-host`). It reads Git
// metadata and nothing else: no fetch, no write to config or the index (optional locks off), no file contents. Remote
// URLs are reduced to a normalized identity inside this module, so a credential in a URL never leaves it.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { refuse } from './headless.mjs';
import { remoteIdentity } from './workspace-record.mjs';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const unavailable = message => refuse('CHECKOUT_UNAVAILABLE', '/root', message);
const notRepository = () => refuse('CHECKOUT_NOT_REPOSITORY', '/root', 'The folder is not a working checkout of a Git repository (a bare repository cannot be bound).');
const sameFolder = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
function git(root, args, encoding = 'utf8') {
  return spawnSync('git', ['-C', root, ...args], { windowsHide: true, encoding, timeout: 10_000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } });
}
// Remote names with their normalized identity (null when not a recognizable network repository), sorted by name. One
// remote with URLs of different identities has no single identity, so it is null.
function remotesOf(output) {
  const found = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = /^remote\.(.+)\.url (.*)$/.exec(line);
    if (!match || !/^[\w./-]{1,200}$/.test(match[1])) continue;
    const identity = remoteIdentity(match[2])?.identity ?? null, [, name] = match;
    found.set(name, found.has(name) && found.get(name) !== identity ? null : identity);
  }
  return [...found].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, identity]) => ({ name, identity }));
}
// `{ status: 'ok', value: observation }` of the working checkout that holds `root` (a subfolder selects its checkout), or a
// refusal. The observation never contains a raw remote URL or a file name.
export function observeCheckout(root) {
  if (typeof root !== 'string' || root.length === 0 || root.length > 1024 || root.includes('\0') || !isAbsolute(root)) return unavailable('Supply an absolute folder path of at most 1024 characters.');
  let folder;
  try { folder = statSync(root); } catch { return unavailable('The folder cannot be read.'); }
  if (!folder.isDirectory()) return unavailable('The path is not a folder.');
  const top = git(root, ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir']);
  if (top.error) return unavailable('Git could not be run for this folder.');
  const [toplevel, gitDir, commonDir] = top.status === 0 ? top.stdout.split(/\r?\n/) : [];
  if (!toplevel || !gitDir || !commonDir) return notRepository();
  const checkout = resolve(toplevel), absoluteGitDir = resolve(gitDir);
  const head = git(checkout, ['rev-parse', '-q', '--verify', 'HEAD^{commit}']), branch = git(checkout, ['symbolic-ref', '-q', '--short', 'HEAD']);
  const config = git(checkout, ['config', '--get-regexp', '^remote\\..*\\.url$']), status = git(checkout, ['status', '--porcelain=v1', '-z', '--untracked-files=normal'], 'buffer');
  if (head.error || branch.error || config.error || status.error || status.status !== 0) return unavailable('Git metadata could not be read for this folder.');
  const revision = head.status === 0 && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head.stdout.trim()) ? head.stdout.trim() : null, name = branch.status === 0 ? branch.stdout.trim() : '';
  return { status: 'ok', diagnostics: [], value: { root: checkout, remotes: remotesOf(config.status === 0 ? config.stdout : ''), revision, ...(name !== '' ? { branch: name } : {}),
    worktree: { kind: sameFolder(absoluteGitDir, resolve(root, commonDir)) ? 'main' : 'linked', gitDirSha256: sha256(absoluteGitDir) },
    workingState: { clean: status.stdout.length === 0, sha256: sha256(status.stdout) }, observedAt: new Date().toISOString() } };
}
