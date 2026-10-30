// A checkout whose bytes are exactly its commit: no uncommitted edit and no untracked file (ignored files such as
// node_modules/ are not part of what `npm pack` ships and do not count). The installed-candidate check packs a checkout and
// records its commit, so a receipt names the bytes it proved only when this holds.
import { spawnSync } from 'node:child_process';

export function cleanCheckout(directory) {
  const git = (...args) => spawnSync('git', ['-C', directory, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  const head = git('rev-parse', 'HEAD');
  if (head.status !== 0) throw new Error(`${directory} is not a Git checkout with a commit: ${head.stderr.trim()}`);
  const status = git('status', '--porcelain', '--untracked-files=all');
  if (status.status !== 0) throw new Error(`git status failed in ${directory}: ${status.stderr.trim()}`);
  const changed = status.stdout.split('\n').filter(Boolean);
  if (changed.length) throw new Error(`${directory} is not clean, so its archive would not be commit ${head.stdout.trim()}. Commit or remove:\n${changed.slice(0, 20).join('\n')}${changed.length > 20 ? `\n… and ${changed.length - 20} more` : ''}`);
  return { commit: head.stdout.trim(), treeClean: true };
}
