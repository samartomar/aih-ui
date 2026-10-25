import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { gzipSync } from 'node:zlib';
import { tarHeader as header, tarball } from '../consumer/github-archive-fixture.mjs';
import { archiveUrl, checkGitHubSource, downloadArchive, extractCommitArchive, GITHUB_LIMITS } from '../consumer/github-archive.mjs';

const COMMIT = 'd81f3a183412e71a5b1e84ca21bc1a35eea03a60';

const skill = name => ({ path: `skills/productivity/${name}/SKILL.md`, text: `---\nname: ${name}\ndescription: ${name} skill.\n---\nBody.\n` });
const ordinary = [{ path: '', type: '5' }, { path: 'LICENSE', text: 'MIT License' }, { path: 'README.md', text: 'readme' },
  { path: 'CHANGELOG.md', type: '2', linkname: 'docs/CHANGELOG.md' }, skill('grill-me'), { path: 'skills/productivity/grill-me/agents/openai.yaml', text: 'a: 1' }, skill('teach')];
const spec = { repository: 'mattpocock/skills', commit: COMMIT, path: 'skills/productivity' };

test('an exact owner/repo, 40-character commit and path is accepted; the commit is read in lower case', () => {
  assert.deepEqual(checkGitHubSource(spec), { status: 'ok', value: { owner: 'mattpocock', repo: 'skills', commit: COMMIT, path: 'skills/productivity' }, diagnostics: [] });
  assert.equal(checkGitHubSource({ ...spec, commit: COMMIT.toUpperCase(), path: '/skills/productivity/' }).value.commit, COMMIT);
  assert.equal(checkGitHubSource({ ...spec, path: '/skills/productivity/' }).value.path, 'skills/productivity');
});

test('a branch, tag, short commit or anything else is refused as needing an exact commit', () => {
  for (const commit of ['main', 'v1.0.0', 'd81f3a1', `${COMMIT}0`, 'refs/heads/main', `${COMMIT.slice(0, 39)}g`, '', undefined, 42]) {
    const result = checkGitHubSource({ ...spec, commit });
    assert.equal(result.status, 'refused', String(commit));
    assert.equal(result.diagnostics[0].code, 'GITHUB_EXACT_COMMIT_REQUIRED');
    assert.match(result.diagnostics[0].message, /needs an exact commit/);
  }
});

test('a repository that is not a plain owner/repo on github.com is refused', () => {
  for (const repository of ['skills', 'mattpocock/skills/extra', 'https://github.com/mattpocock/skills', 'git@github.com:mattpocock/skills', '-x/skills', 'mattpocock/..', 'mattpocock/.', 'matt pocock/skills', 'mattpocock/skills?x=1', 'a'.repeat(40) + '/skills', '', undefined]) {
    const result = checkGitHubSource({ ...spec, repository });
    assert.equal(result.status, 'refused', String(repository));
    assert.equal(result.diagnostics[0].code, 'GITHUB_REPOSITORY_INVALID');
  }
});

test('a path that is absolute, climbs out, names .git or is empty is refused', () => {
  for (const path of ['', '/', '../skills', 'skills/../..', 'C:/skills', 'skills\\productivity', 'skills//x', '.git', 'skills/.git/x', 'a'.repeat(241), undefined]) {
    const result = checkGitHubSource({ ...spec, path });
    assert.equal(result.status, 'refused', String(path));
    assert.equal(result.diagnostics[0].code, 'GITHUB_PATH_INVALID');
  }
});

test('the archive is fetched from codeload.github.com over HTTPS for that exact commit only', () => {
  const url = new URL(archiveUrl(checkGitHubSource(spec).value));
  assert.equal(url.protocol, 'https:');
  assert.equal(url.host, 'codeload.github.com');
  assert.equal(url.pathname, `/mattpocock/skills/tar.gz/${COMMIT}`);
  assert.equal(url.search, '');
});

test('only the requested folder and the repository license are kept, under their repository paths', () => {
  const result = extractCommitArchive(tarball(ordinary), checkGitHubSource(spec).value);
  assert.equal(result.status, 'ok', JSON.stringify(result));
  assert.deepEqual(Object.keys(result.value.files).sort(), ['LICENSE', 'skills/productivity/grill-me/SKILL.md', 'skills/productivity/grill-me/agents/openai.yaml', 'skills/productivity/teach/SKILL.md']);
  assert.equal(new TextDecoder().decode(result.value.files.LICENSE), 'MIT License');
  assert.equal(result.value.licensePath, 'LICENSE');
});

test('a license inside the requested folder is preferred to the repository one', () => {
  const result = extractCommitArchive(tarball([...ordinary, { path: 'skills/productivity/LICENSE.md', text: 'Folder license' }]), checkGitHubSource(spec).value);
  assert.equal(result.value.licensePath, 'skills/productivity/LICENSE.md');
  assert.equal(result.value.files.LICENSE, undefined);
});

test('an archive that is not for the requested commit is refused', () => {
  for (const archive of [tarball(ordinary, { commit: 'f'.repeat(40) }), tarball(ordinary, { commit: null })]) {
    const result = extractCommitArchive(archive, checkGitHubSource(spec).value);
    assert.equal(result.status, 'refused');
    assert.equal(result.diagnostics[0].code, 'GITHUB_ARCHIVE_COMMIT_MISMATCH');
  }
});

test('traversal, absolute paths and entries outside the one archive folder refuse the whole archive', () => {
  for (const entry of [{ path: '../evil', text: 'x' }, { path: 'skills/productivity/../../../evil', text: 'x' }, { path: '/etc/passwd', text: 'x', raw: true },
    { path: 'C:/evil', text: 'x', raw: true }, { path: 'other-root/LICENSE', text: 'x', raw: true }, { path: 'skills\\productivity\\x', text: 'x' },
    { path: 'skills/productivity/../../../../evil', text: 'x', longPath: true }]) {
    const result = extractCommitArchive(tarball([...ordinary, entry]), checkGitHubSource(spec).value);
    assert.equal(result.status, 'refused', entry.path);
    assert.equal(result.diagnostics[0].code, 'GITHUB_ARCHIVE_UNSAFE', entry.path);
  }
});

test('a symlink or hardlink inside the requested folder, or any device, fifo or unknown entry, is refused', () => {
  for (const entry of [{ path: 'skills/productivity/teach/link.md', type: '2', linkname: '../../../LICENSE' }, { path: 'skills/productivity/teach/hard.md', type: '1', linkname: 'LICENSE' },
    { path: 'dev/null', type: '3' }, { path: 'dev/sda', type: '4' }, { path: 'pipe', type: '6' }, { path: 'long', type: 'L' }]) {
    const result = extractCommitArchive(tarball([...ordinary, entry]), checkGitHubSource(spec).value);
    assert.equal(result.status, 'refused', entry.path);
    assert.equal(result.diagnostics[0].code, 'GITHUB_ARCHIVE_UNSAFE', entry.path);
  }
});

test("the archive's one top folder must be <repo>-<commit>/ (GitHub may change the case of the name)", () => {
  const value = checkGitHubSource(spec).value;
  const wrong = extractCommitArchive(tarball(ordinary, { root: `other-${COMMIT}/` }), value);
  assert.equal(wrong.diagnostics[0].code, 'GITHUB_ARCHIVE_UNSAFE');
  assert.equal(extractCommitArchive(tarball(ordinary, { root: `skills-${'e'.repeat(40)}/` }), value).diagnostics[0].code, 'GITHUB_ARCHIVE_UNSAFE');
  assert.equal(extractCommitArchive(tarball(ordinary, { root: `Skills-${COMMIT}/` }), value).status, 'ok');
});

test('two kept files whose names differ only in case are refused', () => {
  const result = extractCommitArchive(tarball([...ordinary, { path: 'skills/productivity/teach/Notes.md', text: 'a' }, { path: 'skills/productivity/teach/notes.md', text: 'b' }]), checkGitHubSource(spec).value);
  assert.equal(result.diagnostics[0].code, 'GITHUB_ARCHIVE_UNSAFE');
  assert.match(result.diagnostics[0].message, /differ only in case/);
});

test('a file name that is not valid UTF-8 is refused and said so', () => {
  const result = extractCommitArchive(tarball([...ordinary, { nameBytes: Buffer.from([0x73, 0xff, 0xfe, 0x2e, 0x6d, 0x64]), text: 'x' }]), checkGitHubSource(spec).value);
  assert.equal(result.diagnostics[0].code, 'GITHUB_ARCHIVE_UNREADABLE');
  assert.match(result.diagnostics[0].message, /file name in the repository isn't valid UTF-8/);
});

test('a requested folder that does not exist in that commit is said plainly', () => {
  const result = extractCommitArchive(tarball(ordinary), checkGitHubSource({ ...spec, path: 'skills/missing' }).value);
  assert.equal(result.status, 'refused');
  assert.equal(result.diagnostics[0].code, 'GITHUB_PATH_MISSING');
});

test('the file size, file count, kept bytes, entry count and unpacked size bounds each stop the extraction', () => {
  const value = checkGitHubSource(spec).value;
  const big = { path: 'skills/productivity/teach/big.md', text: 'x'.repeat(GITHUB_LIMITS.fileBytes + 1) };
  assert.equal(extractCommitArchive(tarball([...ordinary, big]), value).diagnostics[0].code, 'GITHUB_BOUND_EXCEEDED');
  const many = Array.from({ length: GITHUB_LIMITS.files }, (_, index) => ({ path: `skills/productivity/teach/f${index}.md`, text: 'x' }));
  assert.equal(extractCommitArchive(tarball([...ordinary, ...many]), value).diagnostics[0].code, 'GITHUB_BOUND_EXCEEDED');
  const heavy = Array.from({ length: 5 }, (_, index) => ({ path: `skills/productivity/teach/h${index}.md`, text: 'x'.repeat(GITHUB_LIMITS.fileBytes - 10) }));
  assert.equal(extractCommitArchive(tarball([...ordinary, ...heavy]), value).diagnostics[0].code, 'GITHUB_BOUND_EXCEEDED');
  const entries = Array.from({ length: GITHUB_LIMITS.entries }, (_, index) => ({ path: `elsewhere/e${index}`, type: '5' }));
  assert.equal(extractCommitArchive(tarball([...ordinary, ...entries]), value).diagnostics[0].code, 'GITHUB_BOUND_EXCEEDED');
  // Outside the requested folder nothing is kept, but the whole archive still has to be unpacked within its bound.
  const bomb = gzipSync(Buffer.concat([tarball(ordinary, { gzip: false }).subarray(0, -1024), header(`skills-${COMMIT}/elsewhere/zeros`, { size: GITHUB_LIMITS.unpackedBytes }), Buffer.alloc(GITHUB_LIMITS.unpackedBytes), Buffer.alloc(1024)]));
  assert.equal(extractCommitArchive(bomb, value).diagnostics[0].code, 'GITHUB_BOUND_EXCEEDED');
});

test('bytes that are not a gzip tar archive are refused', () => {
  assert.equal(extractCommitArchive(Buffer.from('not an archive'), checkGitHubSource(spec).value).diagnostics[0].code, 'GITHUB_ARCHIVE_UNREADABLE');
  const tar = tarball(ordinary, { gzip: false }); tar[148] = 0x37; // a broken header checksum
  assert.equal(extractCommitArchive(gzipSync(tar), checkGitHubSource(spec).value).diagnostics[0].code, 'GITHUB_ARCHIVE_UNREADABLE');
});

// The downloader is checked against a local plain-HTTP server through an injected request function; the real one only
// ever uses node:https and the codeload URL above.
async function serve(handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/archive`, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }), server };
}

test('the download sends no credentials or cookies and returns the exact bytes', async () => {
  let seen;
  const local = await serve((request, response) => { seen = request.headers; response.end(Buffer.from('archive bytes')); });
  try {
    const result = await downloadArchive(local.url, { request: httpRequest });
    assert.equal(result.status, 'ok');
    assert.equal(Buffer.from(result.value).toString(), 'archive bytes');
    assert.equal(seen.authorization, undefined);
    assert.equal(seen.cookie, undefined);
    assert.equal(seen['proxy-authorization'], undefined);
  } finally { await local.close(); }
});

test('a redirect is never followed', async () => {
  let followed = false;
  const local = await serve((request, response) => {
    if (request.url === '/elsewhere') { followed = true; return response.end('x'); }
    response.writeHead(302, { location: '/elsewhere' }).end();
  });
  try {
    const result = await downloadArchive(local.url, { request: httpRequest });
    assert.equal(result.status, 'refused');
    assert.equal(result.diagnostics[0].code, 'GITHUB_REDIRECT_REFUSED');
    assert.equal(followed, false);
  } finally { await local.close(); }
});

test('a missing commit or repository is said plainly', async () => {
  const local = await serve((request, response) => response.writeHead(404).end('Not Found'));
  try { assert.equal((await downloadArchive(local.url, { request: httpRequest })).diagnostics[0].code, 'GITHUB_NOT_FOUND'); }
  finally { await local.close(); }
});

test('a download over the size bound is aborted, whether or not it declares its length', async () => {
  for (const declared of [true, false]) {
    const local = await serve((request, response) => {
      if (declared) response.setHeader('content-length', String(GITHUB_LIMITS.downloadBytes + 1));
      response.write(Buffer.alloc(64 * 1024));
      const timer = setInterval(() => { if (!response.write(Buffer.alloc(256 * 1024))) return; }, 1);
      response.on('close', () => clearInterval(timer));
    });
    try {
      const result = await downloadArchive(local.url, { request: httpRequest });
      assert.equal(result.status, 'refused');
      assert.equal(result.diagnostics[0].code, 'GITHUB_BOUND_EXCEEDED', String(declared));
    } finally { await local.close(); }
  }
});

test('a download that takes longer than the timeout is aborted', async () => {
  const local = await serve((request, response) => { response.write('slow'); });
  try {
    const started = Date.now();
    const result = await downloadArchive(local.url, { request: httpRequest, timeoutMs: 300 });
    assert.equal(result.status, 'refused');
    assert.equal(result.diagnostics[0].code, 'GITHUB_TIMEOUT');
    assert.ok(Date.now() - started < 5000);
  } finally { await local.close(); }
});

test('the bounds are conservative constants', () => {
  assert.deepEqual(GITHUB_LIMITS, { downloadBytes: 8_000_000, unpackedBytes: 32_000_000, entries: 20_000, files: 256, fileBytes: 250_000, totalBytes: 1_000_000, timeoutMs: 30_000 });
  assert.ok(Object.isFrozen(GITHUB_LIMITS));
});
