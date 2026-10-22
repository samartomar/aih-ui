// A GitHub repository at an exact commit (owner decision 5 on #96): the server's only network read of content. It is
// plain acquisition, never interpretation: the person names owner/repo, a 40-character commit and a folder; this module
// checks those, downloads that commit's archive from codeload.github.com over HTTPS within fixed bounds, and unpacks only
// the regular files under that folder (and the license) into memory. Nothing is resolved (a branch or tag is refused
// before any request), nothing is run, no credential, cookie or proxy is used and no redirect is followed. What the
// files mean is Catalog's: the caller hands them to the same public intake the folder source uses.
import { request as httpsRequest } from 'node:https';
import { gunzipSync } from 'node:zlib';
import { ok, refuse } from './primitives.mjs';

/**
 * downloadBytes  the compressed archive; a larger one is aborted while it downloads
 * unpackedBytes  the whole unpacked archive, read once to find the folder (a gzip bomb stops here)
 * entries        archive entries of any kind, anywhere in the commit
 * files, fileBytes, totalBytes  what is kept from the folder, the same bounds as a folder on this machine
 * timeoutMs      the whole download, from the request to the last byte
 */
export const GITHUB_LIMITS = Object.freeze({ downloadBytes: 8_000_000, unpackedBytes: 32_000_000, entries: 20_000, files: 256, fileBytes: 250_000, totalBytes: 1_000_000, timeoutMs: 30_000 });
export const ARCHIVE_HOST = 'codeload.github.com';
const LICENSES = ['LICENSE', 'LICENSE.txt', 'LICENSE.md'];
const bound = message => refuse('GITHUB_BOUND_EXCEEDED', '/archive', `${message} Nothing was kept.`);
const unsafe = message => refuse('GITHUB_ARCHIVE_UNSAFE', '/archive', `${message} Nothing was kept.`);
const unreadable = () => refuse('GITHUB_ARCHIVE_UNREADABLE', '/archive', 'GitHub did not send a readable archive for this commit. Nothing was kept.');

// GitHub's own rules: an owner is 1–39 letters, digits or single hyphens; a repository name is letters, digits, '.', '_' and '-'.
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
// A segment kept on this machine must be an ordinary portable file name (the folder source's rule).
const portable = part => /^[A-Za-z0-9_. -]+$/.test(part) && !['', '.', '..', '.git'].includes(part.toLowerCase())
  && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part);

/** The person's input, checked before anything is fetched: `{ repository: 'owner/repo', commit, path }`. */
export function checkGitHubSource({ repository, commit, path } = {}) {
  if (typeof commit !== 'string' || !/^[0-9a-fA-F]{40}$/.test(commit.trim())) return refuse('GITHUB_EXACT_COMMIT_REQUIRED', '/commit',
    'This needs an exact commit: the full 40-character commit id. A branch, tag or short commit is not turned into one here (samartomar/aih-catalog#122), so nothing was fetched.');
  const [owner, repo, ...rest] = typeof repository === 'string' ? repository.trim().split('/') : [];
  if (rest.length || !OWNER.test(owner ?? '') || !REPO.test(repo ?? '') || ['.', '..'].includes(repo)) return refuse('GITHUB_REPOSITORY_INVALID', '/repository',
    'Name the repository as owner/repo, for example mattpocock/skills (not a link). Nothing was fetched.');
  const folder = typeof path === 'string' ? path.trim().replace(/^\/+|\/+$/g, '') : '';
  if (!folder || folder.length > 240 || !folder.split('/').every(portable)) return refuse('GITHUB_PATH_INVALID', '/path',
    'Name the folder that holds the skills, relative to the repository, for example skills/productivity. Nothing was fetched.');
  return ok({ owner, repo, commit: commit.trim().toLowerCase(), path: folder });
}

/** The one URL fetched: the archive of that exact commit, from GitHub's own archive host. */
export const archiveUrl = ({ owner, repo, commit }) => `https://${ARCHIVE_HOST}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tar.gz/${commit}`;

/**
 * Downloads one URL within the size bound and the timeout. `request` is node:https's; tests pass node:http's for a local
 * server. A fresh agent (never the global one) means no proxy from the environment and no kept connections; only a
 * user agent and an accept header are sent, and TLS verification is forced on, even when NODE_TLS_REJECT_UNAUTHORIZED=0.
 */
export function downloadArchive(url, { request = httpsRequest, timeoutMs = GITHUB_LIMITS.timeoutMs, maxBytes = GITHUB_LIMITS.downloadBytes } = {}) {
  return new Promise(resolve => {
    let settled = false, outgoing;
    const finish = result => { if (settled) return; settled = true; clearTimeout(timer); outgoing?.destroy(); resolve(result); };
    const timer = setTimeout(() => finish(refuse('GITHUB_TIMEOUT', '/archive', `GitHub did not send the archive within ${timeoutMs / 1000} seconds. Nothing was kept.`)), timeoutMs);
    try {
      outgoing = request(url, { method: 'GET', agent: false, rejectUnauthorized: true, headers: { 'user-agent': 'aih-policy-workbench', accept: 'application/x-gzip, application/octet-stream' } }, response => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) return finish(refuse('GITHUB_REDIRECT_REFUSED', '/archive', 'GitHub answered with a redirect, which is not followed. Nothing was kept.'));
        if (status === 404) return finish(refuse('GITHUB_NOT_FOUND', '/archive', 'GitHub has no public repository with that commit. Check owner/repo and the commit. Nothing was kept.'));
        if (status !== 200) return finish(refuse('GITHUB_UNAVAILABLE', '/archive', `GitHub did not send the archive (HTTP ${status}). Nothing was kept.`));
        const declared = Number(response.headers['content-length']);
        if (Number.isFinite(declared) && declared > maxBytes) return finish(bound(`The archive is larger than ${maxBytes / 1_000_000} MB.`));
        const chunks = []; let length = 0;
        response.on('data', chunk => {
          length += chunk.length;
          if (length > maxBytes) return finish(bound(`The archive is larger than ${maxBytes / 1_000_000} MB.`));
          chunks.push(chunk);
        });
        response.on('end', () => finish(ok(new Uint8Array(Buffer.concat(chunks)))));
        response.on('error', () => finish(refuse('GITHUB_UNAVAILABLE', '/archive', 'The download from GitHub broke off. Nothing was kept.')));
      });
      outgoing.on('error', () => finish(refuse('GITHUB_UNAVAILABLE', '/archive', 'GitHub could not be reached from this machine. Nothing was kept.')));
      outgoing.end();
    } catch { finish(refuse('GITHUB_UNAVAILABLE', '/archive', 'GitHub could not be reached from this machine. Nothing was kept.')); }
  });
}

const decoder = new TextDecoder('utf-8', { fatal: true });
class NameNotUtf8 extends Error {}
const field = (block, start, length) => {
  const bytes = block.subarray(start, start + length), end = bytes.indexOf(0);
  try { return decoder.decode(end === -1 ? bytes : bytes.subarray(0, end)); } catch { throw new NameNotUtf8(); }
};
const octal = (block, start, length) => {
  if (block[start] & 0x80) return NaN; // base-256 sizes are never needed for this archive
  const text = field(block, start, length).trim();
  return /^[0-7]+$/.test(text) ? parseInt(text, 8) : text === '' ? 0 : NaN;
};
function paxRecords(bytes) {
  const records = {}; let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(0x20, offset), length = Number(decoder.decode(bytes.subarray(offset, space)));
    if (space === -1 || !Number.isSafeInteger(length) || length <= 0 || offset + length > bytes.length) throw new Error('pax');
    const record = decoder.decode(bytes.subarray(space + 1, offset + length - 1)), equals = record.indexOf('=');
    if (equals > 0) records[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return records;
}
// An archive name is safe when it is relative, uses '/' only and never names '.', '..' or an empty segment.
const safeName = name => !!name && !/[\0\\]/.test(name) && !name.startsWith('/') && !/^[A-Za-z]:/.test(name)
  && name.replace(/\/$/, '').split('/').every(part => part !== '' && part !== '.' && part !== '..');

/**
 * Unpacks the gzip tar GitHub serves for a commit. The archive must say it is that commit (git's pax comment), hold every
 * entry under one top folder and contain only safe names; a link, device or unknown entry under the folder refuses it.
 * Returns the kept files keyed by repository path, and which license was kept.
 */
export function extractCommitArchive(archive, { repo, commit, path }) {
  let tar;
  try { tar = gunzipSync(archive, { maxOutputLength: GITHUB_LIMITS.unpackedBytes }); }
  catch (error) { return error?.code === 'ERR_BUFFER_TOO_LARGE' || error instanceof RangeError ? bound(`The unpacked archive is larger than ${GITHUB_LIMITS.unpackedBytes / 1_000_000} MB.`) : unreadable(); }
  const prefix = `${path}/`, files = Object.create(null), licenses = Object.create(null), folded = new Set();
  // GitHub names the one top folder <repo>-<commit>/, with the repository name in its own case.
  const expectedRoot = `${repo}-${commit}/`.toLowerCase();
  let offset = 0, entries = 0, root, archiveCommit, pending = {}, found = false, kept = 0, total = 0;
  try {
    while (offset + 512 <= tar.length) {
      const block = tar.subarray(offset, offset + 512);
      if (block.every(byte => byte === 0)) break;
      let sum = 0; for (let index = 0; index < 512; index++) sum += index >= 148 && index < 156 ? 0x20 : block[index];
      if (octal(block, 148, 8) !== sum) return unreadable();
      const type = String.fromCharCode(block[156] || 0x30), size = Number(pending.size ?? octal(block, 124, 12));
      if (!Number.isSafeInteger(size) || size < 0) return unreadable();
      const start = offset + 512, end = start + size;
      if (end > tar.length) return unreadable();
      offset = start + Math.ceil(size / 512) * 512;
      if (++entries > GITHUB_LIMITS.entries) return bound(`The commit has more than ${GITHUB_LIMITS.entries} entries.`);
      if (type === 'g') { const records = paxRecords(tar.subarray(start, end)); archiveCommit ??= records.comment; continue; }
      if (type === 'x') { pending = paxRecords(tar.subarray(start, end)); continue; }
      const magic = field(block, 257, 6), ustarPrefix = magic.startsWith('ustar') ? field(block, 345, 155) : '';
      const name = pending.path ?? (ustarPrefix ? `${ustarPrefix}/${field(block, 0, 100)}` : field(block, 0, 100));
      pending = {};
      if (archiveCommit !== commit) return refuse('GITHUB_ARCHIVE_COMMIT_MISMATCH', '/archive', 'GitHub sent an archive that does not say it is this exact commit. Nothing was kept.');
      if (!safeName(name)) return unsafe(`The archive names a path outside its folder (${JSON.stringify(name.slice(0, 120))}).`);
      const top = name.split('/')[0] + '/';
      root ??= top;
      if (top !== root) return unsafe('The archive holds more than one top folder.');
      if (root.toLowerCase() !== expectedRoot) return unsafe(`The archive's folder is not named for ${repo} at this commit.`);
      const relative = name.slice(root.length).replace(/\/$/, ''), inside = relative === path || relative.startsWith(prefix);
      if (inside) found = true;
      if (type === '5') continue;
      if (type === '2') { if (inside) return unsafe(`The folder holds a symbolic link (${relative}); links are never kept.`); continue; }
      if (type !== '0') return unsafe(`The archive holds an entry that is not a file or folder (${relative || name}).`);
      const license = LICENSES.includes(relative) || LICENSES.some(file => relative === prefix + file);
      if (!inside && !license) continue;
      if (!relative.split('/').every(portable)) return unsafe(`The folder holds a file whose name cannot be kept on this machine (${relative}).`);
      if (size > GITHUB_LIMITS.fileBytes) return bound(`${relative} is larger than ${GITHUB_LIMITS.fileBytes / 1000} KB.`);
      const bytes = new Uint8Array(tar.subarray(start, end));
      if (license && !inside) { licenses[relative] = bytes; continue; }
      // Kept names must stay distinct on a file system that ignores case.
      if (folded.has(relative.toLowerCase())) return unsafe(`The folder holds two files whose names differ only in case (${relative}).`);
      folded.add(relative.toLowerCase());
      if (++kept > GITHUB_LIMITS.files) return bound(`The folder has more than ${GITHUB_LIMITS.files} files.`);
      if ((total += size) > GITHUB_LIMITS.totalBytes) return bound(`The folder is larger than ${GITHUB_LIMITS.totalBytes / 1_000_000} MB.`);
      files[relative] = bytes;
    }
  } catch (error) {
    return error instanceof NameNotUtf8 ? refuse('GITHUB_ARCHIVE_UNREADABLE', '/archive', "A file name in the repository isn't valid UTF-8, so the archive can't be read safely. Nothing was kept.") : unreadable();
  }
  if (archiveCommit !== commit) return refuse('GITHUB_ARCHIVE_COMMIT_MISMATCH', '/archive', 'GitHub sent an archive that does not say it is this exact commit. Nothing was kept.');
  if (!found) return refuse('GITHUB_PATH_MISSING', '/path', `${path} is not a folder in that commit. Nothing was kept.`);
  // The folder's own license, if it has one, else the repository's; it travels with every skill.
  let licensePath = LICENSES.map(file => prefix + file).find(file => files[file]);
  if (!licensePath) {
    licensePath = LICENSES.find(file => licenses[file]);
    if (licensePath) {
      if (++kept > GITHUB_LIMITS.files) return bound(`The folder has more than ${GITHUB_LIMITS.files} files.`);
      if ((total += licenses[licensePath].length) > GITHUB_LIMITS.totalBytes) return bound(`The folder is larger than ${GITHUB_LIMITS.totalBytes / 1_000_000} MB.`);
      files[licensePath] = licenses[licensePath];
    }
  }
  return ok({ files, licensePath });
}
