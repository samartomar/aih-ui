import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createEnterpriseGithub } from '../server/enterprise-github.mjs';

const config = { repository: 'test-org/policies', baseBranch: 'main', policyPath: '.aih/organization.json', profilesDirectory: 'team/profiles' };
const sha = char => char.repeat(40);
const baseSha = sha('1'), baseTree = sha('2'), headSha = sha('3'), headTree = sha('4');
const nestedTree = sha('5'), mergedSha = sha('6'), advancedSha = sha('7'), profileTree = sha('8');
const changedSha = sha('9'), teamTree = sha('a');
const file = { format: 'aih-workbench-profile/1', id: 'backend', name: 'Backend', description: '', items: [], clients: [] };
const fileText = JSON.stringify(file) + '\n';
const content = '{ "selections": ["one"] }\n';
const blobOf = text => createHash('sha1').update('blob ' + Buffer.byteLength(text) + '\0').update(text).digest('hex');
const directory = (path, sha) => ({ path, sha, type: 'tree', mode: '040000' });
const entry = (path, text, mode = '100644') => ({ path, sha: blobOf(text), type: 'blob', mode });
const absent = () => { throw Object.assign(new Error('sensitive CLI error'), { httpStatus: 404 }); };

function fakeGithub() {
  const writes = [];
  const state = { base: baseSha, login: 'admin-login', id: 101, branch: null, lostPrResponse: false,
    merged: false, pull: null, head: headSha, fileMode: '100644' };
  const blobs = new Map([[blobOf(content), content], [blobOf(fileText), fileText]]);
  const prefix = 'repos/' + config.repository;
  const makeRef = (branch, sha) => ({ ref: 'refs/heads/' + branch, object: { type: 'commit', sha } });
  const pull = () => ({ ...state.pull, head: { ...state.pull?.head, sha: state.head },
    merged: state.merged, merge_commit_sha: state.merged ? mergedSha : null, state: state.merged ? 'closed' : 'open',
    merged_at: state.merged ? '2026-11-26T00:00:00Z' : null, merged_by: state.merged ? { login: 'merger-login' } : null });
  async function request(method, endpoint, data) {
    if (endpoint === 'user') return { id: state.id, login: state.login, token: 'must never reach browser' };
    assert.ok(endpoint.startsWith(prefix));
    if (state.repositoryUnavailable) return absent();
    const [route, query] = endpoint.slice(prefix.length).split('?');
    if (method === 'POST') writes.push({ route, data });
    if (!route) return { full_name: config.repository, permissions: { push: state.push !== false } };
    if (route === '/git/ref/heads/main') return makeRef('main', state.base);
    if (route.startsWith('/git/ref/heads/')) return state.branch ?? absent();
    if (route === '/git/refs' && method === 'POST') {
      if (state.failRefBeforeWrite) throw new Error('ref unavailable');
      state.branch = makeRef(data.ref.slice(11), data.sha);
      if (state.loseRefResponse) throw new Error('ref outcome unknown');
      return state.branch;
    }
    if (route.startsWith('/git/commits/')) {
      const commitSha = route.split('/').at(-1);
      const tree = [headSha, mergedSha].includes(commitSha) ? headTree : baseTree;
      return { sha: commitSha, tree: { sha: tree }, parents: [{ sha: baseSha }] };
    }
    if (route.startsWith('/git/trees/')) {
      const tree = route.split('/').at(-1);
      const entries = {
        [baseTree]: [],
        [headTree]: [directory('.aih', nestedTree), directory('team', teamTree)],
        [nestedTree]: [entry('organization.json', content, state.fileMode)],
        [teamTree]: [directory('profiles', profileTree)],
        [profileTree]: [entry('backend.json', fileText), entry('linked.json', fileText, '120000')],
      };
      return { sha: tree, tree: entries[tree] };
    }
    if (route === '/git/blobs' && method === 'POST') {
      const text = Buffer.from(data.content, 'base64').toString();
      const blob = blobOf(text);
      blobs.set(blob, text);
      return { sha: blob };
    }
    if (route.startsWith('/git/blobs/')) {
      const sha = route.split('/').at(-1), bytes = Buffer.from(blobs.get(sha));
      return { sha, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') };
    }
    if (route === '/git/trees' && method === 'POST') return { sha: headTree };
    if (route === '/git/commits' && method === 'POST') {
      return { sha: headSha, tree: { sha: data.tree }, parents: data.parents.map(sha => ({ sha })) };
    }
    if (route === '/pulls' && method === 'POST') {
      if (state.failPrBeforeWrite) throw new Error('PR unavailable');
      state.pull = { number: 12, user: { id: state.id }, head: { ref: data.head, repo: { full_name: config.repository } },
        base: { ref: data.base, repo: { full_name: config.repository } } };
      if (state.lostPrResponse) throw new Error('response lost');
      return pull();
    }
    if (route === '/pulls') return state.pull ? [pull()] : [];
    if (route === '/pulls/12') return pull();
    if (route === '/commits/' + mergedSha + '/pulls') {
      if (state.pullsUnavailable) return absent();
      return state.pull ? [pull()] : [];
    }
    if (route === '/commits') {
      const params = new URLSearchParams(query);
      assert.equal(params.get('sha'), mergedSha);
      if (params.get('path') === config.policyPath) {
        return [{ sha: mergedSha, author: state.policyAuthor === undefined ? { login: 'direct-pusher' } : state.policyAuthor }];
      }
      assert.equal(params.get('path'), 'team/profiles/backend.json');
      return [{ sha: mergedSha, author: { login: state.login } }];
    }
    assert.fail('Unexpected GitHub request ' + method + ' ' + endpoint);
  }
  return { state, writes, request };
}

async function openHost(t, github, options = {}) {
  const transport = createEnterpriseGithub({ config, request: github.request, ...options });
  transport.setPolicyHandlers({
    buildPolicy(selection) { assert.deepEqual(selection, ['one']); return { content }; },
    openPolicy(document) { assert.deepEqual(document, JSON.parse(content)); return ['one']; },
  });
  const server = createServer((request, response) =>
    transport.handle(request, response, new URL(request.url, 'http://127.0.0.1').pathname));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  return {
    transport,
    async call(route, payload, headers) {
      const init = payload === undefined ? { headers } : {
        method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload),
      };
      const response = await fetch(origin + '/api/enterprise/github/' + route, init);
      return { code: response.status, body: await response.json() };
    },
  };
}

test('previews GitHub identity and base, refuses foreign requests, changed identity and stale base with no writes', async t => {
  const github = fakeGithub(), { call } = await openHost(t, github);
  const peek = { kind: 'policy', selection: ['one'] };
  assert.equal((await call('preview', peek, { origin: 'https://other.example' })).code, 403);
  assert.equal((await call('preview', peek, { origin: 'null' })).code, 403);
  const { body: review } = await call('preview', peek);
  assert.deepEqual(review.identity, { login: 'admin-login', id: 101 });
  assert.deepEqual(review.target, { repository: config.repository, baseBranch: 'main', baseSha, path: config.policyPath });
  assert.equal(review.content, content);
  assert.equal(review.digest, createHash('sha256').update(review.content).digest('hex'));
  assert.equal((await call('propose', { confirmationId: review.confirmationId })).code, 400);
  const confirm = { confirmationId: review.confirmationId, confirmed: true };
  github.state.id++;
  assert.equal((await call('propose', confirm)).code, 403);
  github.state.id--;
  github.state.base = advancedSha;
  assert.equal((await call('propose', confirm)).code, 409);
  assert.deepEqual(github.writes, []);
});

test('recovers a lost PR response, checks the immutable head, and reads exact merged policy', async t => {
  const github = fakeGithub(), { call, transport } = await openHost(t, github);
  const { body: configResult } = await call('config');
  assert.equal(configResult.status, 'ready');
  assert.ok(!JSON.stringify(configResult).includes('must never'));
  const { body: review } = await call('preview', { kind: 'policy', selection: ['one'] });
  const confirm = { confirmationId: review.confirmationId, confirmed: true };
  github.state.lostPrResponse = true;
  const failed = await call('propose', confirm);
  assert.equal(failed.code, 502);
  assert.ok(!failed.body.error.includes('response lost'));
  github.state.base = advancedSha;
  const { body: { receipt } } = await call('propose', confirm);
  assert.equal(receipt.status, 'pending');
  assert.deepEqual(github.writes.map(write => write.route), ['/git/blobs', '/git/trees', '/git/commits', '/git/refs', '/pulls']);
  assert.equal(github.writes[1].data.tree[0].path, config.policyPath);
  assert.equal(github.writes[2].data.parents[0], baseSha);
  assert.equal((await call('status', { receipt })).body.receipt.status, 'pending');
  assert.equal((await call('status', { receipt: { ...receipt, repository: 'attacker/other' } })).code, 400);
  github.state.head = changedSha;
  assert.equal((await call('status', { receipt })).body.receipt.status, 'changed');
  github.state.head = headSha;
  github.state.merged = true;
  assert.equal((await call('status', { receipt })).body.receipt.mergeCommitSha, mergedSha);
  assert.equal((await call('policy')).code, 404);
  github.state.base = mergedSha;
  const current = await transport.readPolicy();
  assert.equal(current.text, content);
  assert.equal(current.source.blobSha, blobOf(content));
  assert.equal((await call('policy')).body.text, undefined);
  github.state.fileMode = '120000';
  assert.equal((await call('policy')).code, 404);
  assert.equal((await call('status', { receipt })).body.receipt.status, 'changed');
});

test('names the account that merged the active policy commit, otherwise says no merged pull request was found', async t => {
  const github = fakeGithub(), { call, transport } = await openHost(t, github);
  github.state.base = mergedSha;
  const direct = (await call('policy')).body;
  assert.equal(direct.status, 'ready');
  assert.deepEqual(direct.publisher, { status: 'unverified', commit: mergedSha, author: 'direct-pusher' });
  github.state.policyAuthor = null;
  assert.deepEqual((await call('policy')).body.publisher, { status: 'unavailable', commit: mergedSha });
  github.state.pull = { number: 12, user: { id: 7 }, head: { ref: 'aih-workbench/policy-x', repo: { full_name: config.repository } },
    base: { ref: 'main', repo: { full_name: config.repository } } };
  assert.deepEqual((await call('policy')).body.publisher, { status: 'unavailable', commit: mergedSha },
    'An open pull request does not verify a publisher.');
  github.state.merged = true;
  assert.deepEqual((await call('policy')).body.publisher, { status: 'verified', commit: mergedSha, login: 'merger-login', pull: 12,
    url: 'https://github.com/' + config.repository + '/pull/12' });
  github.state.pull.base = { ref: 'other', repo: { full_name: config.repository } };
  assert.equal((await call('policy')).body.publisher.status, 'unavailable', 'A pull request into another branch does not count.');
  github.state.pull.base = { ref: 'main', repo: { full_name: config.repository } };
  github.state.policyAuthor = { login: 'direct-pusher' };
  github.state.pullsUnavailable = true;
  assert.deepEqual((await call('policy')).body.publisher, { status: 'unverified', commit: mergedSha, author: 'direct-pusher' });
  assert.equal(Object.hasOwn(await transport.readPolicy(), 'publisher'), false, 'Execution reads make no publisher lookup.');
  assert.deepEqual(github.writes, []);
});

test('limits team proposals to portable Profiles and reads their merged, attributed files', async t => {
  const github = fakeGithub(), { call } = await openHost(t, github);
  for (const value of [{ ...file, id: '../policy' }, { ...file, byo: [] }, { ...file, localPath: 'private' }]) {
    assert.equal((await call('preview', { kind: 'profile', content: JSON.stringify(value) })).code, 400);
  }
  assert.equal((await call('preview', { kind: 'profile', content: fileText, path: config.policyPath })).code, 400);
  const { body: review } = await call('preview', { kind: 'profile', content: fileText });
  assert.equal(review.target.path, 'team/profiles/backend.json');
  assert.deepEqual(JSON.parse(review.content), file);
  assert.equal(review.digest, createHash('sha256').update(review.content).digest('hex'));
  assert.deepEqual((await call('profiles')).body, { status: 'ready', profiles: [] });
  github.state.base = mergedSha;
  const { body: library } = await call('profiles');
  assert.equal(library.status, 'partial');
  assert.deepEqual(library.profiles, [{ profile: file, source: { repository: config.repository, baseBranch: 'main',
    path: 'team/profiles/backend.json', commitSha: mergedSha, blobSha: blobOf(fileText), revision: mergedSha, author: 'admin-login' } }]);
  assert.deepEqual(github.writes, []);
});

test('disabled host does not contact GitHub', async t => {
  const { call } = await openHost(t, { request() { assert.fail('No GitHub access expected'); } }, { config: {} });
  assert.equal((await call('config')).body.status, 'unconfigured');
  assert.equal((await call('profiles')).body.status, 'unconfigured');
  assert.equal((await call('policy')).code, 503);
  assert.deepEqual((await call('inspect', { content })).body, { status: 'preview', selection: ['one'] });
  assert.equal((await call('inspect', { content: 'bad JSON' })).code, 422);
});

test('publishes only a valid host-provided member URL', async t => {
  for (const [memberUrl, expected] of [
    ['https://member.example/workbench', 'https://member.example/workbench'],
    ['http://127.0.0.1:2200', 'http://127.0.0.1:2200/'],
    ['http://member.example/workbench', undefined],
    ['https://u@member.example/', undefined],
    ['https://@member.example/', undefined],
    ['https://member.example/?', undefined],
    ['https://member.example/#start', undefined],
  ]) {
    const { call } = await openHost(t, fakeGithub(), { config: { ...config, memberUrl } });
    const { body } = await call('config');
    assert.equal(body.status, 'ready');
    assert.equal(body.memberUrl, expected);
    assert.equal(body.destination.memberUrl, undefined);
  }
});

test('resumes the same durable proposal after partial GitHub responses and host restarts', async t => {
  for (const [fault, expectedState, expectedRefWrites, expectedPullWrites] of [
    ['failRefBeforeWrite', 'branch-unknown', 2, 1],
    ['loseRefResponse', 'branch-unknown', 1, 1],
    ['failPrBeforeWrite', 'branch-ready', 1, 2],
    ['lostPrResponse', 'branch-ready', 1, 1],
  ]) {
    await t.test(fault, async t => {
      const github = fakeGithub();
      const recoveryDirectory = await mkdtemp(join(tmpdir(), 'aih-github-recovery-'));
      t.after(() => rm(recoveryDirectory, { recursive: true, force: true }));
      const first = await openHost(t, github, { recoveryDirectory });
      const { body: preview } = await first.call('preview', { kind: 'policy', selection: ['one'] });
      const confirm = { confirmationId: preview.confirmationId, confirmed: true };
      github.state[fault] = true;
      const failure = await first.call('propose', confirm);
      assert.equal(failure.code, 502);
      const recovery = failure.body.recovery;
      assert.equal(recovery.confirmationId, confirm.confirmationId);
      assert.equal(recovery.status, expectedState);
      assert.equal(recovery.headSha, headSha);
      assert.ok(recovery.branchUrl.startsWith('https://github.com/test-org/policies/tree/'));
      const saved = await readFile(join(recoveryDirectory, confirm.confirmationId + '.json'), 'utf8');
      assert.equal(JSON.parse(saved).blobSha, blobOf(content));
      assert.ok(!saved.includes('selections'));
      assert.ok(!saved.includes('must never'));

      github.state[fault] = false;
      const restarted = await openHost(t, github, { recoveryDirectory });
      github.state.id++;
      assert.deepEqual((await restarted.call('recovery')).body.proposals, []);
      assert.equal((await restarted.call('propose', confirm)).code, 403);
      github.state.id--;
      assert.deepEqual((await restarted.call('recovery')).body.proposals, [recovery]);
      if (fault === 'lostPrResponse') {
        github.state.base = mergedSha;
        github.state.merged = true;
        github.state.branch = null;
      }
      const completed = await restarted.call('propose', confirm);
      assert.equal(completed.code, 200);
      assert.equal(completed.body.receipt.headSha, headSha);
      assert.equal(completed.body.receipt.status, fault === 'lostPrResponse' ? 'merged' : 'pending');
      assert.equal(completed.body.receipt.headBranch, recovery.headBranch);
      assert.equal(github.writes.filter(write => write.route === '/git/refs').length, expectedRefWrites);
      assert.equal(github.writes.filter(write => write.route === '/pulls').length, expectedPullWrites);
      assert.equal(github.writes.filter(write => write.route === '/git/commits').length, 1);
    });
  }
});

test('recovery preserves a modified or deleted branch', async t => {
  const github = fakeGithub();
  const recoveryDirectory = await mkdtemp(join(tmpdir(), 'aih-github-recovery-'));
  t.after(() => rm(recoveryDirectory, { recursive: true, force: true }));
  const initial = await openHost(t, github, { recoveryDirectory });
  const { body: preview } = await initial.call('preview', { kind: 'policy', selection: ['one'] });
  const confirm = { confirmationId: preview.confirmationId, confirmed: true };
  github.state.failPrBeforeWrite = true;
  assert.equal((await initial.call('propose', confirm)).body.recovery.status, 'branch-ready');
  const writes = github.writes.length;
  const reopened = await openHost(t, github, { recoveryDirectory });
  github.state.failPrBeforeWrite = false;
  github.state.push = false;
  const permission = await reopened.call('propose', confirm);
  assert.equal(permission.code, 403);
  assert.equal(permission.body.recovery.status, 'branch-ready');
  github.state.push = true;
  github.state.branch.object.sha = changedSha;
  const moved = await reopened.call('propose', confirm);
  assert.equal(moved.code, 409);
  assert.equal(moved.body.recovery.status, 'branch-changed');
  assert.equal(github.state.branch.object.sha, changedSha);
  github.state.branch = null;
  const deleted = await reopened.call('propose', confirm);
  assert.equal(deleted.code, 409);
  assert.equal(deleted.body.recovery.status, 'branch-missing');
  assert.equal(github.writes.length, writes);
  assert.equal(github.state.branch, null);
});

test('a retargeted pull request cannot create a second proposal on recovery', async t => {
  const github = fakeGithub();
  const recoveryDirectory = await mkdtemp(join(tmpdir(), 'aih-github-recovery-'));
  t.after(() => rm(recoveryDirectory, { recursive: true, force: true }));
  const initial = await openHost(t, github, { recoveryDirectory });
  const { body: preview } = await initial.call('preview', { kind: 'policy', selection: ['one'] });
  const confirm = { confirmationId: preview.confirmationId, confirmed: true };
  github.state.lostPrResponse = true;
  assert.equal((await initial.call('propose', confirm)).code, 502);
  github.state.lostPrResponse = false;
  github.state.pull.base.ref = 'other-branch';
  const writes = github.writes.length;
  const reopened = await openHost(t, github, { recoveryDirectory });
  const retargeted = await reopened.call('propose', confirm);
  assert.equal(retargeted.code, 409);
  assert.equal(retargeted.body.recovery.status, 'branch-ready');
  assert.equal(github.writes.length, writes);
});

test('GitHub cannot receive a branch write before the local recovery record saves', async t => {
  const github = fakeGithub();
  const home = await mkdtemp(join(tmpdir(), 'aih-github-recovery-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const recoveryDirectory = join(home, 'recovery');
  await writeFile(recoveryDirectory, 'The host directory is unavailable.');
  const host = await openHost(t, github, { recoveryDirectory });
  const { body: preview } = await host.call('preview', { kind: 'policy', selection: ['one'] });
  const confirm = { confirmationId: preview.confirmationId, confirmed: true };
  const unavailable = await host.call('propose', confirm);
  assert.equal(unavailable.code, 503);
  assert.match(unavailable.body.error, /local recovery record/);
  assert.deepEqual(github.writes.map(write => write.route), ['/git/blobs', '/git/trees', '/git/commits']);
  await unlink(recoveryDirectory);
  const completed = await host.call('propose', confirm);
  assert.equal(completed.code, 200);
  assert.deepEqual(github.writes.map(write => write.route), ['/git/blobs', '/git/trees', '/git/commits', '/git/refs', '/pulls']);
});

test('sanitizes recovery when a switched account cannot access the repository', async t => {
  const github = fakeGithub();
  const recoveryDirectory = await mkdtemp(join(tmpdir(), 'aih-github-recovery-'));
  t.after(() => rm(recoveryDirectory, { recursive: true, force: true }));
  const initial = await openHost(t, github, { recoveryDirectory });
  const { body: preview } = await initial.call('preview', { kind: 'policy', selection: ['one'] });
  const confirm = { confirmationId: preview.confirmationId, confirmed: true };
  github.state.failPrBeforeWrite = true;
  const original = await initial.call('propose', confirm);
  assert.equal(original.body.recovery.status, 'branch-ready');

  const restarted = await openHost(t, github, { recoveryDirectory });
  github.state.repositoryUnavailable = true;
  github.state.id++;
  const switched = await restarted.call('propose', confirm);
  assert.equal(switched.code, 403);
  assert.equal(switched.body.recovery, undefined);
  assert.ok(!JSON.stringify(switched.body).includes(config.repository));

  github.state.id--;
  const sameAccount = await restarted.call('propose', confirm);
  assert.equal(sameAccount.code, 502);
  assert.deepEqual(sameAccount.body.recovery, original.body.recovery);
  github.state.repositoryUnavailable = false;
  github.state.failPrBeforeWrite = false;
  const receipt = await restarted.call('propose', confirm);
  assert.equal(receipt.code, 200);
  assert.equal(receipt.body.receipt.headBranch, original.body.recovery.headBranch);
  assert.equal(github.writes.filter(write => write.route === '/git/refs').length, 1);
});
