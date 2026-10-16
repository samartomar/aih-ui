// The loopback sample transport answers the organization reader's GitHub requests from real Git objects in a mkdtemp repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SAMPLE_AUTHORITY, authoritySource, installLocalAuthority } from '../candidate/local-authority.mjs';

const { owner, name } = SAMPLE_AUTHORITY, BASE = `https://api.github.com/repos/${owner}/${name}/git`;
const POLICY = `${JSON.stringify({ schema: 'urn:aihq:core:organization-policy:1.0.0', id: 'sample', selections: [] })}\n`;

function git(cwd, ...args) {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args],
    { cwd, encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  assert.equal(result.status, 0, `git ${args[0]}: ${result.stderr}`);
  return result.stdout.trim();
}
function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'aih-ui-authority-'));
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; rmSync(root, { recursive: true, force: true }); });
  const repo = join(root, 'authority');
  mkdirSync(join(repo, 'policy'), { recursive: true });
  git(repo, 'init', '--quiet', '-b', 'main');
  writeFileSync(join(repo, 'policy', 'organization.json'), POLICY);
  writeFileSync(join(repo, 'README.md'), 'sample\n');
  git(repo, 'add', '--all');
  git(repo, 'commit', '--quiet', '-m', 'publish');
  return { root, repo, logFile: join(root, 'authority-transport.log') };
}
const get = async path => { const response = await fetch(`${BASE}/${path}`); return { status: response.status, body: await response.json() }; };

test('the reader\'s four routes answer from git: branch, commit, trees down to the blob, and the blob bytes', async t => {
  const { repo, logFile } = repository(t);
  const { source, restore } = installLocalAuthority({ repository: repo, log: logFile });
  assert.deepEqual(source, { provider: 'github', repository: { owner, name }, path: 'policy/organization.json', revision: { kind: 'branch', value: 'main' } });
  assert.deepEqual(source, authoritySource());

  const head = git(repo, 'rev-parse', 'HEAD'), rootTree = git(repo, 'rev-parse', 'HEAD^{tree}');
  const blobId = git(repo, 'rev-parse', 'HEAD:policy/organization.json'), policyTree = git(repo, 'rev-parse', 'HEAD:policy');

  const ref = await get('ref/heads/main');
  assert.deepEqual(ref, { status: 200, body: { ref: 'refs/heads/main', object: { type: 'commit', sha: head } } });
  assert.deepEqual((await get(`commits/${head}`)).body, { sha: head, tree: { sha: rootTree } });
  const top = (await get(`trees/${rootTree}`)).body;
  assert.equal(top.truncated, false);
  assert.deepEqual(top.tree.map(({ path, mode, type }) => [path, mode, type]).sort(), [['README.md', '100644', 'blob'], ['policy', '040000', 'tree']]);
  assert.equal(top.tree.find(entry => entry.path === 'policy').sha, policyTree);
  assert.equal(top.tree.find(entry => entry.path === 'policy').size, undefined);
  const inner = (await get(`trees/${policyTree}`)).body;
  assert.deepEqual(inner.tree, [{ path: 'organization.json', mode: '100644', type: 'blob', sha: blobId, size: Buffer.byteLength(POLICY) }]);

  const blob = (await get(`blobs/${blobId}`)).body;
  const bytes = Buffer.from(blob.content, 'base64');
  assert.equal(blob.encoding, 'base64');
  assert.equal(blob.size, bytes.length);
  assert.equal(bytes.toString('utf8'), POLICY);
  assert.equal(blob.sha, blobId);
  assert.equal(createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex'), blobId, 'the blob id is the hash of the git blob header and bytes');

  const lines = readFileSync(logFile, 'utf8').trim().split('\n');
  assert.equal(lines.length, 5);
  assert.ok(lines.every(line => line.includes('loopback sample transport')));
  assert.match(lines[0], /GET \/repos\/sample-org\/sample-authority\/git\/ref\/heads\/main -> 200/);
  restore();
});

test('an unknown ref or object, or an object of the wrong kind, is a 404 like the fixture', async t => {
  const { repo } = repository(t);
  const { restore } = installLocalAuthority({ repository: repo });
  const head = git(repo, 'rev-parse', 'HEAD'), rootTree = git(repo, 'rev-parse', 'HEAD^{tree}');
  for (const path of ['ref/heads/nope', `commits/${'0'.repeat(40)}`, `trees/${'1'.repeat(40)}`, `blobs/${'2'.repeat(40)}`, `trees/${head}`, `blobs/${rootTree}`, `commits/${rootTree}`,
    'commits/--help', 'trees/HEAD', 'ref/heads/..%2F..%2Fconfig', 'ref/heads/-x', 'ref/tags/v1', 'merges/x']) {
    const answered = await get(path);
    assert.equal(answered.status, 404, path);
    assert.match(answered.body.message, /Not found/, path);
  }
  restore();
});

test('every other request goes to the original fetch, and restore puts it back', async t => {
  const { repo } = repository(t);
  const seen = [], stub = async (input, options) => { seen.push([String(input), options?.method]); return new Response('original'); };
  globalThis.fetch = stub;
  const { restore } = installLocalAuthority({ repository: repo });
  assert.notEqual(globalThis.fetch, stub);
  assert.equal(await (await fetch('https://api.github.com/repos/other-org/other/git/ref/heads/main')).text(), 'original');
  assert.equal(await (await fetch('https://api.github.com/repos/sample-org/sample-authority/pulls')).text(), 'original');
  assert.equal(await (await fetch('https://example.invalid/x', { method: 'POST' })).text(), 'original');
  assert.deepEqual(seen.map(([url]) => url), ['https://api.github.com/repos/other-org/other/git/ref/heads/main', 'https://api.github.com/repos/sample-org/sample-authority/pulls', 'https://example.invalid/x']);
  assert.throws(() => installLocalAuthority({ repository: repo }), /already installed/);
  restore();
  assert.equal(globalThis.fetch, stub);
  restore();
  assert.equal(globalThis.fetch, stub);
});

test('reading never writes to the repository', async t => {
  const { repo } = repository(t);
  const before = git(repo, 'status', '--porcelain=v2', '--branch'), refs = git(repo, 'for-each-ref');
  const { restore } = installLocalAuthority({ repository: repo });
  const head = git(repo, 'rev-parse', 'HEAD');
  await get('ref/heads/main'); await get(`commits/${head}`); await get(`blobs/${git(repo, 'rev-parse', 'HEAD:README.md')}`);
  restore();
  assert.equal(git(repo, 'status', '--porcelain=v2', '--branch'), before);
  assert.equal(git(repo, 'for-each-ref'), refs);
});
