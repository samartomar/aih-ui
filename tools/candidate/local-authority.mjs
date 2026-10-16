// Core's published organization reader speaks GitHub's REST protocol only. For the owner-testing candidate the developer
// side reads a LOCAL sample Git repository through that same reader: this answers the reader's GitHub requests for one
// fictional repository from real Git objects in a local directory (read-only, no network), and passes every other request
// through. It is candidate-only host wiring, never a Workbench capability. Mirrors tools/consumer/github-fixture.mjs.
import { execFile } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { promisify } from 'node:util';

const run = promisify(execFile);
const SHA = /^[0-9a-f]{40}$/, BRANCH = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]+$/;
export const SAMPLE_AUTHORITY = Object.freeze({ owner: 'sample-org', name: 'sample-authority', path: 'policy/organization.json', branch: 'main' });

export const authoritySource = ({ owner, name, path = SAMPLE_AUTHORITY.path, branch = SAMPLE_AUTHORITY.branch } = SAMPLE_AUTHORITY) =>
  ({ provider: 'github', repository: { owner, name }, path, revision: { kind: 'branch', value: branch } });

export function installLocalAuthority({ repository, owner = SAMPLE_AUTHORITY.owner, name = SAMPLE_AUTHORITY.name, log }) {
  if (globalThis.fetch.localAuthority) throw new Error('The local authority transport is already installed.');
  const originalFetch = globalThis.fetch, base = `/repos/${owner}/${name}/git/`;
  const record = line => {
    const text = `${new Date().toISOString()} loopback sample transport ${line}`;
    if (typeof log === 'function') log(text); else if (log) try { appendFileSync(log, `${text}\n`); } catch { /* the log is a courtesy */ }
  };
  // Read-only plumbing only; a failing command means the object is not there.
  const git = async args => {
    try {
      const { stdout } = await run('git', ['-C', repository, ...args], { encoding: 'buffer', windowsHide: true, maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } });
      return stdout;
    } catch { return null; }
  };
  const text = async args => (await git(args))?.toString('utf8').trim() ?? null;
  const typeOf = async sha => SHA.test(sha) ? text(['cat-file', '-t', sha]) : null;

  async function answer(rest) {
    let match;
    if ((match = /^ref\/heads\/(.+)$/.exec(rest))) {
      const branch = decodeURIComponent(match[1]);
      const sha = BRANCH.test(branch) ? await text(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`]) : null;
      return sha && SHA.test(sha) ? { ref: `refs/heads/${branch}`, object: { type: 'commit', sha } } : null;
    }
    if ((match = /^commits\/([^/]+)$/.exec(rest))) {
      const sha = match[1];
      const tree = await typeOf(sha) === 'commit' ? await text(['rev-parse', `${sha}^{tree}`]) : null;
      return tree ? { sha, tree: { sha: tree } } : null;
    }
    if ((match = /^trees\/([^/]+)$/.exec(rest))) {
      const sha = match[1];
      const listing = await typeOf(sha) === 'tree' ? await git(['ls-tree', '-z', '-l', sha]) : null;
      if (!listing) return null;
      const tree = listing.toString('utf8').split('\0').filter(Boolean).map(entry => {
        const [meta, path] = [entry.slice(0, entry.indexOf('\t')), entry.slice(entry.indexOf('\t') + 1)];
        const [mode, type, id, size] = meta.trim().split(/\s+/);
        return { path, mode, type, sha: id, ...(type === 'blob' ? { size: Number(size) } : {}) };
      });
      return { sha, truncated: false, tree };
    }
    if ((match = /^blobs\/([^/]+)$/.exec(rest))) {
      const sha = match[1];
      const bytes = await typeOf(sha) === 'blob' ? await git(['cat-file', 'blob', sha]) : null;
      return bytes ? { sha, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') } : null;
    }
    return null;
  }

  const patched = async (input, options) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.origin !== 'https://api.github.com' || !url.pathname.startsWith(base)) return originalFetch(input, options);
    const body = await answer(url.pathname.slice(base.length));
    record(`${(options?.method ?? 'GET')} ${url.pathname} -> ${body ? 200 : 404}`);
    return Response.json(body ?? { message: 'Not found in the loopback sample transport' }, { status: body ? 200 : 404 });
  };
  patched.localAuthority = true;
  globalThis.fetch = patched;
  return { source: authoritySource({ owner, name }),
    restore() { if (globalThis.fetch === patched) globalThis.fetch = originalFetch; } };
}
