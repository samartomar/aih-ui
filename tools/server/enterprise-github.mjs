import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readTeamProfile } from '../../src/approved/profile-model.js';
import { createGithubRecovery, proposalId } from './enterprise-github-recovery.mjs';

const PREFIX = '/api/enterprise/github/';
const MAX_FILE = 1024 * 1024;
const MAX_PENDING = 64;
const CONFIRM_FOR = 10 * 60 * 1000;
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/;
const HEAD = /^aih-workbench\/(?:policy|profile)-[0-9a-f-]{36}$/;
const part = /^[A-Za-z0-9_.-]+$/;
const pathIs = value => typeof value === 'string' && value.length <= 300 &&
  value.split('/').every(segment => part.test(segment) && !segment.endsWith('.') && !segment.toLowerCase().endsWith('.lock')) &&
  !value.includes('..');
const headRef = branch => 'refs/heads/' + branch;
const segments = value => value.split('/').map(encodeURIComponent).join('/');
const digestOf = bytes => createHash('sha256').update(bytes).digest('hex');
const blobOf = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const checked = (condition, message, status = 409) => {
  if (!condition) throw Object.assign(new Error(message), { enterpriseStatus: status });
};

function hostConfig(env) {
  return {
    repository: env.AIH_WORKBENCH_GITHUB_REPOSITORY,
    baseBranch: env.AIH_WORKBENCH_GITHUB_BASE_BRANCH,
    policyPath: env.AIH_WORKBENCH_GITHUB_POLICY_PATH,
    profilesDirectory: env.AIH_WORKBENCH_GITHUB_PROFILES_DIRECTORY,
    memberUrl: env.AIH_WORKBENCH_MEMBER_URL,
  };
}
function memberUrlOf(value) {
  if (typeof value !== 'string' || !/^https?:\/\/[^/@]+(?:\/|$)/i.test(value) || /[?#\s\\]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (url.username || url.password || !url.hostname) return undefined;
    if (url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return url.href;
  } catch { /* Omit malformed optional handoff URLs. */ }
}
function configProblem(config) {
  const { repository, baseBranch, policyPath, profilesDirectory } = config;
  if (!Object.values(config).some(Boolean)) return 'The host has not configured a GitHub destination.';
  if (typeof repository !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(repository) ||
      !pathIs(baseBranch) || !pathIs(policyPath) || !policyPath.endsWith('.json') || !pathIs(profilesDirectory) ||
      policyPath === profilesDirectory || policyPath.startsWith(profilesDirectory + '/') || profilesDirectory.startsWith(policyPath + '/')) {
    return 'The host GitHub destination requires a repository, base branch, policy JSON path and separate Profiles directory.';
  }
  if ([policyPath, profilesDirectory].some(path => path.split('/').some(segment =>
    ['.git', '.github'].includes(segment.toLowerCase())))) return 'Choose managed content paths outside GitHub configuration.';
  return null;
}

function ghRequest(method, endpoint, body) {
  const args = ['api', '--hostname', 'github.com', '--method', method, endpoint,
    '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28', '-H', 'Cache-Control: no-cache'];
  if (body !== undefined) args.push('--input', '-');
  const env = { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_NO_EXTENSION_UPDATE_NOTIFIER: '1' };
  for (const name of Object.keys(env)) if (/^(GH_DEBUG|GH_HOST)$/i.test(name)) delete env[name];
  return new Promise((resolve, reject) => {
    const child = spawn('gh', args, { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], timeout: 20000 });
    const stdout = [];
    let size = 0;
    let stderr = '';
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 12 * MAX_FILE) child.kill();
      else stdout.push(chunk);
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-3000); });
    child.stdin.on('error', () => {}); // A failed gh invocation may close stdin before the request is sent.
    child.on('error', () => reject(new Error('GitHub CLI could not run.')));
    child.on('close', code => {
      if (code !== 0) {
        const httpStatus = Number(/\(HTTP (\d{3})\)/.exec(stderr)?.[1]);
        return reject(Object.assign(new Error('GitHub request failed.'), { httpStatus }));
      }
      try { resolve(JSON.parse(Buffer.concat(stdout))); } catch { reject(new Error('GitHub response could not be read.')); }
    });
    child.stdin.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

async function requestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    checked(size <= 8 * MAX_FILE, 'GitHub handoff request is too large.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks)); } catch {
    checked(false, 'Submit a JSON request from Workbench.', 400);
  }
}

function send(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  }).end(JSON.stringify(value));
}

function plainFile(entry) {
  return entry?.type === 'blob' && entry.mode === '100644' && SHA.test(entry.sha);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

export function createEnterpriseGithub({ config = hostConfig(process.env), request = ghRequest, recoveryDirectory } = {}) {
  const { memberUrl: configuredMemberUrl, ...target } = config;
  const problem = configProblem(target);
  const destination = Object.freeze(target);
  const hasDestination = Object.values(target).some(Boolean);
  const memberUrl = memberUrlOf(configuredMemberUrl);
  const pending = new Map();
  const inFlight = new Set();
  const recovery = createGithubRecovery(recoveryDirectory);
  let policy;
  function setPolicyHandlers(handlers) { policy = handlers; }
  function configured() { checked(!problem, problem, 503); }
  const repo = (route, method = 'GET', body) => request(method, 'repos/' + destination.repository + route, body);
  async function ref(branch, optional = false) {
    const result = await repo('/git/ref/heads/' + segments(branch)).catch(error => {
      if (optional && error.httpStatus === 404) return null;
      throw error;
    });
    if (!result && optional) return null;
    checked(result?.ref === headRef(branch) && result.object?.type === 'commit' && SHA.test(result.object.sha),
      'GitHub could not verify the configured branch.');
    return result.object.sha;
  }
  async function repositoryMetadata() {
    const repository = await repo('');
    checked(repository?.full_name?.toLowerCase() === destination.repository.toLowerCase() &&
      !repository.archived && !repository.disabled, 'The configured GitHub repository is unavailable.', 503);
    return repository;
  }
  async function signedInIdentity() {
    const user = await request('GET', 'user');
    checked(typeof user?.login === 'string' && user.login.length > 0 && Number.isSafeInteger(user.id),
      'Sign in to GitHub CLI to use the organization repository.', 503);
    return { login: user.login, id: user.id };
  }
  async function access() {
    const [identity, repository] = await Promise.all([signedInIdentity(), repositoryMetadata()]);
    return { identity, canPropose: repository.permissions?.push === true };
  }
  async function readConfig() {
    if (problem) return { status: hasDestination ? 'unavailable' : 'unconfigured', error: problem };
    try {
      const [account, baseSha] = await Promise.all([access(), ref(destination.baseBranch)]);
      return { status: 'ready', destination, ...account, baseSha, ...(memberUrl ? { memberUrl } : {}) };
    } catch (error) {
      return { status: 'unavailable', destination, error: error.enterpriseStatus ? error.message :
        'GitHub CLI could not access the configured repository and base branch. Check the signed-in account and repository access.' };
    }
  }
  async function gitCommit(sha) {
    const commit = await repo('/git/commits/' + sha);
    checked(commit?.sha === sha && SHA.test(commit.tree?.sha), 'GitHub could not verify a commit.');
    return commit;
  }
  async function gitTree(sha) {
    const tree = await repo('/git/trees/' + sha);
    checked(tree?.sha === sha && !tree.truncated && Array.isArray(tree.tree), 'GitHub returned an incomplete repository tree.');
    return tree.tree;
  }
  async function entryAt(treeSha, path) {
    const pieces = path.split('/');
    for (const [index, piece] of pieces.entries()) {
      const entry = (await gitTree(treeSha)).find(candidate => candidate.path === piece);
      if (!entry || index === pieces.length - 1) return entry;
      checked(entry.type === 'tree' && entry.mode === '040000' && SHA.test(entry.sha), 'The managed path must be inside ordinary directories.');
      treeSha = entry.sha;
    }
  }
  async function readBlob(sha) {
    const blob = await repo('/git/blobs/' + sha);
    checked(blob?.sha === sha && blob.encoding === 'base64' && Number.isSafeInteger(blob.size) && blob.size <= MAX_FILE &&
      typeof blob.content === 'string', 'GitHub could not read the exact managed file.');
    const bytes = Buffer.from(blob.content, 'base64');
    checked(bytes.length === blob.size && blobOf(bytes) === sha, 'GitHub file bytes failed verification.');
    return bytes;
  }
  async function readFileAt(commitSha, path) {
    const entry = await entryAt((await gitCommit(commitSha)).tree.sha, path);
    checked(plainFile(entry), 'The managed path must contain an ordinary committed file.', 404);
    return { bytes: await readBlob(entry.sha), blobSha: entry.sha };
  }
  const sourceOf = (commitSha, path, blobSha) => ({
    repository: destination.repository, baseBranch: destination.baseBranch, commitSha, path, blobSha,
  });
  async function inspectPolicy(input) {
    checked(policy, 'This Workbench host cannot open an organization policy.', 503);
    checked(exactKeys(input, ['content']) && typeof input.content === 'string' && Buffer.byteLength(input.content) <= MAX_FILE,
      'Supply an organization policy JSON file smaller than 1 MB.', 400);
    try { return { status: 'preview', selection: await policy.openPolicy(JSON.parse(input.content)) }; }
    catch { checked(false, 'This Workbench could not validate the policy against the prepared Catalog.', 422); }
  }
  async function readPolicy() {
    configured();
    checked(policy, 'This Workbench host cannot open a published organization policy.', 503);
    const [commitSha] = await Promise.all([ref(destination.baseBranch), repositoryMetadata()]);
    const path = destination.policyPath;
    const { bytes, blobSha } = await readFileAt(commitSha, path);
    const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    let selection;
    try { selection = await policy.openPolicy(JSON.parse(content)); } catch {
      checked(false, 'The configured branch contains a policy this Workbench could not validate.', 422);
    }
    return { status: 'ready', content, text: content, selection, source: sourceOf(commitSha, path, blobSha) };
  }
  // The publisher is the account that merged a pull request containing the active
  // policy commit into the configured base. A commit author alone is unverified.
  async function publisherOf(headSha, path) {
    let commit;
    try {
      const history = await repo('/commits?' + new URLSearchParams({ sha: headSha, path, per_page: '1' }));
      if (SHA.test(history?.[0]?.sha)) commit = history[0];
    } catch { /* Reported as unavailable below. */ }
    if (!commit) return { status: 'unavailable', commit: null };
    const author = typeof commit.author?.login === 'string' && commit.author.login ? commit.author.login : null;
    const unverified = author ? { status: 'unverified', commit: commit.sha, author } : { status: 'unavailable', commit: commit.sha };
    let pulls;
    try { pulls = await repo('/commits/' + commit.sha + '/pulls'); } catch { return unverified; }
    const merged = (Array.isArray(pulls) ? pulls : []).filter(pull => Number.isSafeInteger(pull?.number) && pull.number > 0 &&
      typeof pull.merged_at === 'string' && pull.base?.ref === destination.baseBranch &&
      pull.base.repo?.full_name?.toLowerCase() === destination.repository.toLowerCase()).slice(0, 5);
    for (const candidate of merged) {
      try {
        const pull = await repo('/pulls/' + candidate.number);
        const login = pull?.merged_by?.login;
        if (pull?.number === candidate.number && pull.merged === true && pull.base?.ref === destination.baseBranch &&
          typeof login === 'string' && login) {
          return { status: 'verified', commit: commit.sha, login, pull: pull.number,
            url: 'https://github.com/' + destination.repository + '/pull/' + pull.number };
        }
      } catch { /* Try the next merged pull request. */ }
    }
    return unverified;
  }
  async function readProfiles() {
    if (problem) return { status: hasDestination ? 'unavailable' : 'unconfigured', profiles: [], error: problem };
    const [commitSha] = await Promise.all([ref(destination.baseBranch), repositoryMetadata()]);
    const directory = await entryAt((await gitCommit(commitSha)).tree.sha, destination.profilesDirectory);
    if (!directory) return { status: 'ready', profiles: [] };
    checked(directory.type === 'tree' && directory.mode === '040000' && SHA.test(directory.sha),
      'The configured Profiles path must be an ordinary directory.');
    const entries = (await gitTree(directory.sha)).filter(entry => entry.path.endsWith('.json'));
    checked(entries.length <= 100, 'The team Profiles directory contains too many JSON files.');
    const profiles = [];
    for (const entry of entries) {
      try {
        checked(plainFile(entry), 'A team Profile needs to be an ordinary file.');
        const profile = readTeamProfile(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBlob(entry.sha))));
        checked(ID.test(profile.id) && entry.path === profile.id + '.json', 'The Profile ID and managed filename differ.');
        const path = destination.profilesDirectory + '/' + entry.path;
        const history = await repo('/commits?' + new URLSearchParams({ sha: commitSha, path, per_page: '1' }));
        const latest = history?.[0];
        checked(SHA.test(latest?.sha), 'GitHub could not identify the Profile revision.');
        profiles.push({ profile, source: { ...sourceOf(commitSha, path, entry.sha),
          revision: latest.sha, author: typeof latest.author?.login === 'string' ? latest.author.login : null } });
      } catch { /* A malformed or unverifiable entry cannot populate the team library. */ }
    }
    return { status: profiles.length === entries.length ? 'ready' : 'partial', profiles };
  }

  async function proposalOf(input) {
    if (input?.kind === 'policy') {
      checked(exactKeys(input, ['kind', 'selection']), 'Supply only the organization policy selection.', 400);
      checked(policy, 'This Workbench host cannot build an organization policy.', 503);
      let content;
      try { ({ content } = await policy.buildPolicy(input.selection)); } catch (error) {
        if (error?.enterpriseStatus === 422) throw error;
        checked(false, 'The policy could not be built from the supplied selection and installed package pins.', 422);
      }
      checked(content && (typeof content === 'string' || typeof content === 'object'), 'Workbench could not build a valid policy.', 422);
      return { kind: 'policy', content: typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n', path: destination.policyPath };
    }
    checked(input?.kind === 'profile' && exactKeys(input, ['kind', 'content']) && typeof input.content === 'string',
      'Supply a policy selection or portable Profile.', 400);
    let profile;
    try { profile = readTeamProfile(JSON.parse(input.content)); } catch {
      checked(false, 'Supply a portable team Profile without machine data.', 400);
    }
    checked(ID.test(profile.id), 'The portable Profile needs a stable ID.', 400);
    return { kind: 'profile', content: JSON.stringify(profile, null, 2) + '\n', path: destination.profilesDirectory + '/' + profile.id + '.json' };
  }
  async function preview(input) {
    configured();
    const proposal = await proposalOf(input);
    const bytes = Buffer.from(proposal.content);
    checked(bytes.length > 0 && bytes.length <= MAX_FILE, 'The proposal must be smaller than 1 MB.', 400);
    const [account, baseSha] = await Promise.all([access(), ref(destination.baseBranch)]);
    checked(account.canPropose, 'The signed-in account needs permission to create a branch and pull request in this repository.', 403);
    const baseTree = (await gitCommit(baseSha)).tree.sha;
    const previous = await entryAt(baseTree, proposal.path);
    checked(!previous || plainFile(previous), 'The managed proposal path is occupied by a nonstandard file.');
    const blobSha = blobOf(bytes);
    checked(previous?.sha !== blobSha, 'The configured base branch already contains these exact bytes.');
    for (const [id, record] of pending) if (record.expires < Date.now() && !inFlight.has(id)) pending.delete(id);
    checked(pending.size < MAX_PENDING, 'Too many GitHub confirmations are open. Let a preview expire before starting another.', 429);
    const confirmationId = randomUUID();
    const headBranch = 'aih-workbench/' + proposal.kind + '-' + confirmationId;
    const target = { repository: destination.repository, baseBranch: destination.baseBranch, baseSha, path: proposal.path };
    const result = { status: 'ready', confirmationId, identity: account.identity, target, digest: digestOf(bytes), content: proposal.content };
    const createdAt = Date.now();
    pending.set(confirmationId, { confirmationId, kind: proposal.kind, ...target, identity: result.identity,
      digest: result.digest, baseTree, headBranch, blobSha, bytes, createdAt, expires: createdAt + CONFIRM_FOR });
    return result;
  }

  function exactPull(pull, receipt) {
    return pull?.number === receipt.number && pull.head?.sha === receipt.headSha &&
      pull.head?.ref === receipt.headBranch && pull.head.repo?.full_name?.toLowerCase() === receipt.repository.toLowerCase() &&
      pull.base?.repo?.full_name?.toLowerCase() === receipt.repository.toLowerCase() && pull.base.ref === receipt.baseBranch;
  }
  function requireReviewIdentity(record, identity) {
    if (identity.id !== record.identity.id) {
      throw Object.assign(Error('Sign in as the account that previewed this GitHub proposal.'), {
        enterpriseStatus: 403, accountMismatch: true,
      });
    }
  }
  async function checkCurrentAccount(record) {
    requireReviewIdentity(record, await signedInIdentity());
    const [repository, baseSha] = await Promise.all([repositoryMetadata(), ref(record.baseBranch)]);
    checked(repository.permissions?.push === true, 'The signed-in account needs repository write access to continue this proposal.', 403);
    checked(baseSha === record.baseSha, 'The base branch advanced. Preview against the new base before continuing.');
  }
  function managedProposal({ repository, baseBranch, kind, path, headBranch, headSha, baseSha, digest }) {
    return repository === destination.repository && baseBranch === destination.baseBranch && SHA.test(baseSha) &&
      SHA.test(headSha) && DIGEST.test(digest) && HEAD.test(headBranch) && headBranch.startsWith('aih-workbench/' + kind + '-') &&
      (kind === 'policy' && path === destination.policyPath ||
        kind === 'profile' && typeof path === 'string' && path.startsWith(destination.profilesDirectory + '/') &&
        path.endsWith('.json') && ID.test(path.slice(destination.profilesDirectory.length + 1, -5)));
  }
  function durableRecord(record) {
    return record && managedProposal(record) && proposalId.test(record.confirmationId) &&
      record.headBranch === 'aih-workbench/' + record.kind + '-' + record.confirmationId && SHA.test(record.blobSha) &&
      Number.isSafeInteger(record.createdAt) && Number.isSafeInteger(record.identity?.id) && typeof record.identity.login === 'string' &&
      ['prepared', 'branch-unknown', 'branch-ready', 'branch-changed', 'branch-missing'].includes(record.branchState);
  }
  function receiptOf(record, number) {
    const { kind, repository, baseBranch, baseSha, path, digest, headBranch, headSha } = record;
    return { kind, repository, baseBranch, baseSha, path, digest, headBranch, headSha, number,
      url: 'https://github.com/' + repository + '/pull/' + number, status: 'pending' };
  }
  function recoveryOf(record) {
    const { confirmationId, kind, identity, repository, baseBranch, baseSha, path, digest, headBranch, headSha, branchState, createdAt, pullNumber } = record;
    const receipt = Number.isSafeInteger(pullNumber) && pullNumber > 0 ? receiptOf(record, pullNumber) : null;
    return { confirmationId, kind, identity, target: { repository, baseBranch, baseSha, path }, digest, headBranch, headSha,
      branchUrl: 'https://github.com/' + repository + '/tree/' + segments(headBranch),
      headCommitUrl: 'https://github.com/' + repository + '/commit/' + headSha,
      status: receipt ? 'pull-request-ready' : branchState, createdAt, ...(receipt ? { receipt } : {}) };
  }
  async function saveRecovery(record) {
    const { confirmationId, kind, repository, baseBranch, baseSha, path, digest, headBranch, headSha, blobSha,
      identity, createdAt, branchState, pullNumber } = record;
    try {
      await recovery.save({ confirmationId, kind, repository, baseBranch, baseSha, path, digest, headBranch, headSha, blobSha,
        identity, createdAt, branchState, pullNumber });
    } catch {
      checked(false, 'Workbench could not save the local recovery record for this GitHub proposal.', 503);
    }
    record.durable = true;
  }
  async function readRecoveries() {
    if (problem) return { status: hasDestination ? 'unavailable' : 'unconfigured', proposals: [] };
    const { identity } = await access();
    const records = await recovery.list();
    return { status: 'ready', proposals: records.filter(record => durableRecord(record) && record.identity.id === identity.id)
      .sort((left, right) => right.createdAt - left.createdAt).map(recoveryOf) };
  }
  async function verifyRecovery(record) {
    requireReviewIdentity(record, await signedInIdentity());
    const [commit] = await Promise.all([gitCommit(record.headSha), repositoryMetadata()]);
    checked(commit.parents?.length === 1 && commit.parents[0]?.sha === record.baseSha, 'The saved proposal has a different base commit.');
    const entry = await entryAt(commit.tree.sha, record.path);
    checked(plainFile(entry) && entry.sha === record.blobSha && digestOf(await readBlob(entry.sha)) === record.digest,
      'The exact saved proposal file could not be verified.');
  }
  async function changeBranchState(record, state) {
    if (record.branchState === state) return;
    record.branchState = state;
    await saveRecovery(record);
  }
  async function createProposal(record) {
    const title = record.kind === 'policy' ? 'Propose organization policy' : 'Propose team Profile';
    if (!record.headSha) {
      await checkCurrentAccount(record);
      const blob = await repo('/git/blobs', 'POST', { encoding: 'base64', content: record.bytes.toString('base64') });
      checked(blob?.sha === record.blobSha, 'GitHub did not confirm the exact proposal blob.');
      const tree = await repo('/git/trees', 'POST', { base_tree: record.baseTree,
        tree: [{ path: record.path, mode: '100644', type: 'blob', sha: record.blobSha }] });
      checked(SHA.test(tree?.sha), 'GitHub did not confirm the proposal tree.');
      const commit = await repo('/git/commits', 'POST', { message: title, tree: tree.sha, parents: [record.baseSha] });
      checked(SHA.test(commit?.sha) && commit.tree?.sha === tree.sha && commit.parents?.length === 1 &&
        commit.parents[0]?.sha === record.baseSha, 'GitHub did not confirm the exact proposal commit.');
      record.headSha = commit.sha;
    }
    if (!record.durable) {
      // Before creating a visible ref, retain enough information to reconcile it after a restart.
      record.branchState = 'prepared';
      await saveRecovery(record);
    }
    // Check for a completed PR before trying a ref that GitHub may have deleted after merge.
    const { repository, baseBranch, baseSha, path, digest, headBranch, headSha } = record;
    const matches = await repo('/pulls?' + new URLSearchParams({ state: 'all', head: repository.split('/')[0] + ':' + headBranch }));
    checked(Array.isArray(matches) && matches.length <= 1, 'GitHub returned conflicting pull requests for the proposal branch.');
    function verifiedReceipt(pull) {
      const receipt = receiptOf(record, pull?.number);
      checked(Number.isSafeInteger(receipt.number) && receipt.number > 0 && pull?.user?.id === record.identity.id && exactPull(pull, receipt),
        'GitHub did not confirm a pull request for the exact proposal head and base.');
      return receipt;
    }
    if (matches.length) {
      const { receipt } = await statusOf({ receipt: verifiedReceipt(matches[0]) });
      return receipt;
    }

    // Reconcile a ref after an unknown result using the saved exact commit.
    const previousHead = await ref(headBranch, true);
    if (previousHead && previousHead !== headSha) {
      await changeBranchState(record, 'branch-changed');
      checked(false, 'The proposal branch was modified on GitHub. Open the branch to inspect the changes.');
    }
    if (!previousHead) {
      if (['branch-ready', 'branch-changed', 'branch-missing'].includes(record.branchState)) {
        await changeBranchState(record, 'branch-missing');
        checked(false, 'The proposal branch was removed on GitHub. Restore the exact reviewed commit to continue this proposal.');
      }
      await checkCurrentAccount(record);
      await changeBranchState(record, 'branch-unknown');
      const created = await repo('/git/refs', 'POST', { ref: headRef(headBranch), sha: headSha });
      checked(created?.ref === headRef(headBranch) && created.object?.sha === headSha, 'GitHub did not confirm the proposal branch.');
    }
    await changeBranchState(record, 'branch-ready');
    await checkCurrentAccount(record);
    const pull = await repo('/pulls', 'POST', { title, head: headBranch, base: baseBranch,
      body: 'Workbench proposal for `' + path + '`.\n\nBase commit `' + baseSha + '`\n\nProposed file SHA-256 `' + digest + '`',
      maintainer_can_modify: false });
    return verifiedReceipt(pull);
  }
  async function propose(input) {
    configured();
    checked(exactKeys(input, ['confirmationId', 'confirmed']) && input.confirmed === true, 'Explicitly confirm this GitHub proposal.', 400);
    const { confirmationId } = input;
    checked(typeof confirmationId === 'string' && proposalId.test(confirmationId), 'Supply a current proposal confirmation.', 400);
    checked(!inFlight.has(confirmationId), 'This GitHub proposal is already in progress.');
    inFlight.add(confirmationId);
    let record;
    try {
      record = pending.get(confirmationId);
      if (!record || (!record.durable && record.expires < Date.now())) {
        const recovered = await recovery.get(confirmationId);
        checked(durableRecord(recovered) && recovered.confirmationId === confirmationId, 'This confirmation expired. Preview the proposal again.');
        record = { ...recovered, durable: true };
      }
      if (record.durable) await verifyRecovery(record);
      if (Number.isSafeInteger(record.pullNumber) && record.pullNumber > 0) return statusOf({ receipt: receiptOf(record, record.pullNumber) });
      const receipt = await createProposal(record);
      record.pullNumber = receipt.number;
      await saveRecovery(record);
      return { receipt };
    } catch (error) {
      const identity = record?.durable && !error?.accountMismatch ? await signedInIdentity().catch(() => null) : null;
      if (identity && identity.id === record.identity.id) {
        const failure = error instanceof Error ? error : new Error('GitHub handoff could not be verified.');
        failure.recovery = recoveryOf(record);
        throw failure;
      }
      throw error;
    } finally { inFlight.delete(confirmationId); }
  }
  async function statusOf(input) {
    configured();
    const { kind, repository, baseBranch, baseSha, path, digest, headBranch, headSha, number } = input?.receipt ?? {};
    checked(managedProposal(input?.receipt ?? {}) && Number.isSafeInteger(number) && number > 0,
    'This receipt does not identify a proposal for the configured destination.', 400);
    const receipt = { kind, repository, baseBranch, baseSha, path, digest, headBranch, headSha, number,
      url: 'https://github.com/' + repository + '/pull/' + number, status: 'changed' };
    const [pull] = await Promise.all([repo('/pulls/' + number), repositoryMetadata()]);
    if (!exactPull(pull, receipt)) return { receipt };
    const commit = await gitCommit(headSha);
    const headEntry = await entryAt(commit.tree.sha, path);
    if (commit.parents?.length !== 1 || commit.parents[0]?.sha !== baseSha ||
      !plainFile(headEntry) || digestOf(await readBlob(headEntry.sha)) !== digest) return { receipt };
    if (pull.state === 'closed' && pull.merged === true && SHA.test(pull.merge_commit_sha)) {
      const mergeCommitSha = pull.merge_commit_sha;
      const entry = await entryAt((await gitCommit(mergeCommitSha)).tree.sha, path);
      if (!plainFile(entry) || entry.sha !== headEntry.sha) return { receipt };
      return { receipt: { ...receipt, status: 'merged', mergeCommitSha, source: sourceOf(mergeCommitSha, path, entry.sha) } };
    }
    if (pull.merged === false && pull.state === 'open') receipt.status = 'pending';
    if (pull.merged === false && pull.state === 'closed') receipt.status = 'closed';
    return { receipt };
  }

  const routes = new Map([
    ['config', ['GET', readConfig]], ['policy', ['GET', async () => {
      const { status, content, selection, source } = await readPolicy();
      return { status, content, selection, source, publisher: await publisherOf(source.commitSha, source.path) };
    }]], ['profiles', ['GET', readProfiles]],
    ['preview', ['POST', preview]], ['propose', ['POST', propose]], ['status', ['POST', statusOf]],
    ['inspect', ['POST', inspectPolicy]], ['recovery', ['GET', readRecoveries]],
  ]);
  async function handle(request, response, pathname) {
    if (!pathname.startsWith(PREFIX)) return false;
    const route = routes.get(pathname.slice(PREFIX.length));
    try {
      checked(route, 'Unknown GitHub handoff request.', 404);
      const [method, run] = route;
      const { host, origin } = request.headers;
      const allowed = [`127.0.0.1:${request.socket.localPort}`, `localhost:${request.socket.localPort}`].includes(host) &&
        ['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(request.socket.remoteAddress) &&
        request.headers['sec-fetch-site'] !== 'cross-site' && (!origin || origin === 'http://' + host);
      checked(allowed && (method !== 'POST' || origin === 'http://' + host),
        'GitHub handoff requires a same-origin request from the loopback Workbench.', 403);
      checked(request.method === method, 'This GitHub handoff operation requires ' + method + '.', 405);
      if (method === 'POST') checked(request.headers['content-type']?.split(';')[0].trim() === 'application/json',
        'Submit a JSON request from Workbench.', 415);
      const result = await run(method === 'POST' ? await requestBody(request) : undefined);
      send(response, 200, result);
    } catch (error) {
      send(response, error?.enterpriseStatus ?? 502, { status: 'unavailable',
        error: error?.enterpriseStatus ? error.message : 'GitHub handoff could not be verified. Check the signed-in CLI account and repository access.',
        ...(error?.recovery ? { recovery: error.recovery } : {}) });
    }
    return true;
  }
  return { handle, readPolicy, readProfiles, readConfig, setPolicyHandlers, destination: problem ? null : destination };
}
