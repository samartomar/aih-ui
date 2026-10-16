import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readInstalledRelease } from '@aihq/catalog/node';
import { freshAuthoring, composeAuthoring, openDraft, editDraft, stable } from './headless.mjs';
import * as publicApi from './workspace.mjs';
import { readWorkspace, editWorkspace, planBinding, bindCheckout, unbindCheckout, verifyBindings, exportWorkspace, remoteIdentity, sameIdentity,
  validateDeclaration, validateBinding, WORKSPACE_DECLARATION_SCHEMA, LOCAL_BINDING_SCHEMA } from './workspace.mjs';
import { observeCheckout } from './workspace-host.mjs';
import { readJourneyEnvelope, JOURNEY_RECORD_KINDS, encodeBase64 } from './journey.mjs';
import { unsafeText, identityOf } from './workspace-record.mjs';
import { recordMaintenance } from './maintenance.mjs';
import { checkImprovements, recordImprovement } from './improvements.mjs';
import { digestBytes } from './intake.mjs';
import { BATCH_RECORD_SCHEMA } from './batch-record.mjs';
import { batchFixture } from './batch-fixture.mjs';
import { createMixedService } from './mixed-service.mjs';
import { workspaceRevision, relationshipId } from './workspace-record.mjs';
const encode = value => new TextEncoder().encode(value), decode = bytes => new TextDecoder().decode(bytes);
const NOW = '2026-10-16T09:00:00Z', LATER = '2026-10-16T10:00:00Z';
const valueOf = result => { assert.equal(result.status, 'ok', JSON.stringify(result.diagnostics)); return result.value; };
const code = result => { assert.equal(result.status, 'refused'); return result.diagnostics[0].code; };
const hex = n => n.toString(16).padStart(64, '0');

// ---- Fixtures --------------------------------------------------------------------------------------------------------
let installedPromise;
const installed = () => installedPromise ??= readInstalledRelease({ root: dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'))), sourceInput: 'maintained' });
async function scenario() {
  const found = await installed();
  assert.equal(found.valid, true, JSON.stringify(found.diagnostics));
  const maintained = { release: found.release, materialSource: found.source }, inventories = [maintained], intent = freshAuthoring();
  const item = maintained.release.items.find(i => i.id === 'mattpocock.implement');
  intent.roots = [{ releaseSha256: maintained.release.sha256, itemId: item.id, itemSha256: item.itemSha256, scope: 'project', configuration: {}, originIds: ['direct'] }];
  const base = valueOf(await composeAuthoring({ intent: freshAuthoring(), inventories }));
  const composed = valueOf(await composeAuthoring({ basePolicyBytes: base.policyBytes, intent, inventories }));
  const open = valueOf(await openDraft({ bytes: composed.policyBytes, inventories }));
  return { maintained, inventories, policyBytes: composed.policyBytes, envelopeBytes: open.envelopeBytes };
}
let scenarioPromise;
const shared = () => scenarioPromise ??= scenario();
const edit = async (bytes, operation, now = NOW) => valueOf(await editWorkspace({ envelopeBytes: bytes, operation, now }));
const API = { id: 'api', identity: 'github.com/acme/api', aliases: ['gitlab.com/acme/api-mirror'], label: 'API' };
const UI = { id: 'ui', identity: 'github.com/acme/ui' };
// An envelope with a declared workspace of two members (api, ui) and nothing else.
async function declared() {
  const { envelopeBytes } = await shared();
  let bytes = (await edit(envelopeBytes, { type: 'declare', label: 'Shop' })).envelopeBytes;
  for (const member of [API, UI]) bytes = (await edit(bytes, { type: 'set-member', member })).envelopeBytes;
  return bytes;
}
const observation = ({ root = '/work/api', remotes = [['origin', 'https://github.com/acme/api.git']], revision = 'a'.repeat(40), branch = 'main', git = 1, kind = 'main', dirty = false, observedAt = NOW } = {}) => ({
  root, remotes: remotes.map(([name, url]) => ({ name, identity: remoteIdentity(url)?.identity ?? null })).sort((a, b) => a.name < b.name ? -1 : 1), revision,
  ...(branch ? { branch } : {}), worktree: { kind, gitDirSha256: hex(git) }, workingState: { clean: !dirty, sha256: hex(dirty ? 200 : 100) }, observedAt });
const plan = async (bytes, memberId, obs, extra = {}) => valueOf(await planBinding({ envelopeBytes: bytes, memberId, observation: obs, ...extra }));
const bind = async (bytes, memberId, obs, extra = {}) => valueOf(await bindCheckout({ envelopeBytes: bytes, memberId, observation: obs, now: NOW, ...extra }));
const confirmed = async (bytes, memberId, obs, extra = {}) => {
  const p = await plan(bytes, memberId, obs, extra);
  assert.equal(p.outcome, 'confirm');
  return bind(bytes, memberId, obs, { ...extra, confirmation: { observationSha256: p.observationSha256, reasons: p.reasons } });
};
async function resign(bytes, mutate) {
  const doc = JSON.parse(decode(bytes));
  mutate(doc);
  const { sha256: _omitted, ...revision } = doc.revision;
  doc.revision.sha256 = await digestBytes(encode(stable({ ...doc, revision })));
  return encode(JSON.stringify(doc, null, 2) + '\n');
}
const recordsOf = (bytes, family) => JSON.parse(decode(bytes)).records.filter(r => r.schema.includes(`:${family}:`));

// ---- 1. Remote identity ----------------------------------------------------------------------------------------------
test('remoteIdentity normalizes network remotes, drops credentials and port, and returns null for anything local', () => {
  const same = 'github.com/acme/api';
  for (const url of ['https://github.com/acme/api', 'https://github.com/acme/api.git', 'https://github.com/acme/api/', 'http://github.com/acme/api.git', 'HTTPS://GITHUB.COM/acme/api.git',
    'https://user:ghp_secret@github.com/acme/api.git', 'https://ghp_secret@github.com:443/acme/api', 'http://github.com:80/acme/api', 'git://github.com:9418/acme/api', 'https://github.com/acme/api.git?x=1#frag', 'ssh://git@github.com/acme/api.git',
    'ssh://git@github.com:22/acme/api', 'git://github.com/acme/api.git', 'git+ssh://git@github.com/acme/api.git', 'git@github.com:acme/api.git', 'git@github.com:acme/api',
    'user:tok@github.com:acme/api.git', 'github.com:acme/api.git', 'git@github.com:/acme/api.git'])
    assert.deepEqual(remoteIdentity(url), { host: 'github.com', owner: 'acme', name: 'api', identity: same }, url);
  assert.equal(remoteIdentity('https://GitLab.example.com:8443/Group/Sub/Team/Repo.git').identity, 'gitlab.example.com:8443/Group/Sub/Team/Repo');
  // A non-default port names another service: kept (host:port); the scheme's default port is dropped; scp-like has no port.
  assert.deepEqual(remoteIdentity('https://git.example.com:8443/acme/api'), { host: 'git.example.com:8443', owner: 'acme', name: 'api', identity: 'git.example.com:8443/acme/api' });
  assert.notEqual(remoteIdentity('https://git.example.com:8443/acme/api').identity, remoteIdentity('https://git.example.com:9443/acme/api').identity);
  assert.equal(remoteIdentity('ssh://git@git.example.com:2222/acme/api.git').identity, 'git.example.com:2222/acme/api');
  assert.equal(remoteIdentity('https://github.com:22/acme/api').identity, 'github.com:22/acme/api');
  assert.equal(remoteIdentity('ssh://git@github.com:443/acme/api').identity, 'github.com:443/acme/api');
  assert.equal(remoteIdentity('git@git.example.com:acme/api.git').identity, 'git.example.com/acme/api');
  for (const bad of ['https://git.example.com:0/a/b', 'https://git.example.com:99999/a/b', 'https://git.example.com:8x/a/b']) assert.equal(remoteIdentity(bad), null, bad);
  // A typed identity keeps its port too (and survives the member round trip).
  assert.equal(identityOf('git.example.com:8443/acme/api'), 'git.example.com:8443/acme/api'); assert.equal(identityOf('Git.Example.com:8443/acme/api.git'), 'git.example.com:8443/acme/api');
  assert.equal(identityOf('ssh://git@git.example.com:2222/acme/api'), 'git.example.com:2222/acme/api'); assert.equal(identityOf('git@github.com:acme/api.git'), 'github.com/acme/api');
  assert.deepEqual(remoteIdentity('https://gitlab.com/g/sub/r'), { host: 'gitlab.com', owner: 'g/sub', name: 'r', identity: 'gitlab.com/g/sub/r' });
  for (const url of ['C:\\repo', 'C:/repo', 'C:repo', '/srv/repo.git', './repo', '../repo', '~/repo', 'repo.git', 'file:///srv/repo.git', 'file://host/repo.git', 'ftp://host/o/n', '\\\\server\\share\\repo',
    'https://github.com', 'https://github.com/acme', 'https://github.com/acme/.git', 'https://github.com/acme/..', 'https://github.com/acme/a%20b', 'https://user:p@ss@@github.com/a/b/%', 'a@b:c', '', '   ', 'x'.repeat(3000), null, undefined, 7, {}])
    assert.equal(remoteIdentity(url), null, String(url));
  assert.equal(sameIdentity('github.com/Acme/API', 'github.com/acme/api'), true);
  assert.equal(sameIdentity('github.com/acme/api', 'github.com/acme/api2'), false);
  // Owner and name are case-insensitive only on the hosted services that fold case; the host always is; another port is another service.
  for (const host of ['github.com', 'gitlab.com', 'bitbucket.org']) assert.equal(sameIdentity(`${host}/Acme/Api`, `${host}/acme/api`), true, host);
  assert.equal(sameIdentity('git.example.com/Acme/Api', 'git.example.com/acme/api'), false); assert.equal(sameIdentity('git.example.com/acme/api', 'git.example.com/acme/api'), true);
  assert.equal(sameIdentity('GIT.Example.com/acme/api', 'git.example.com/acme/api'), true); assert.equal(sameIdentity('github.com:8443/Acme/Api', 'github.com:8443/acme/api'), false);
  assert.equal(sameIdentity('github.com:8443/acme/api', 'github.com/acme/api'), false);
  assert.equal(sameIdentity(null, 'github.com/acme/api'), false);
});

// ---- 2. Declaration --------------------------------------------------------------------------------------------------
test('a new declaration is valid with no members or relationships and is shown unresolved, never complete', async () => {
  const { envelopeBytes } = await shared();
  const before = valueOf(await readWorkspace({ envelopeBytes }));
  assert.deepEqual([before.workspace, before.revision, before.members, before.bindings, before.unsupported], [null, null, [], 0, []]);
  assert.equal(before.relationships.shown, 'unresolved');
  const declare = await edit(envelopeBytes, { type: 'declare', label: '  Shop  ' });
  assert.equal(declare.envelope.revision.sequence, 2);
  const read = valueOf(await readWorkspace({ envelopeBytes: declare.envelopeBytes }));
  assert.equal(read.workspace.label, 'Shop'); assert.match(read.workspace.id, /^workspace-[a-f0-9]{32}$/); assert.match(read.revision, /^[a-f0-9]{64}$/);
  assert.deepEqual(read.members, []);
  assert.deepEqual(read.relationships, { status: 'unresolved', confirmed: [], suggested: [], shown: 'unresolved' });
  assert.deepEqual(read.unresolved, [{ memberId: null, field: 'relationships' }]);
  assert.deepEqual(declare.workspace, read);
  const [record] = recordsOf(declare.envelopeBytes, 'workspace-declaration');
  assert.deepEqual(Object.keys(record).sort(), ['id', 'members', 'relationships', 'required', 'revision', 'schema', 'workspace']);
  assert.equal(record.id, 'workspace-declaration'); assert.equal(record.required, false); assert.equal(record.schema, WORKSPACE_DECLARATION_SCHEMA);
  assert.equal(record.revision, await workspaceRevision(record));
  assert.deepEqual(await validateDeclaration(record), { valid: true, problem: null });
  // Complete only by an explicit owner action, and reversible; an incomplete member still shows its unresolved fields.
  const withMember = (await edit(declare.envelopeBytes, { type: 'set-member', member: UI })).envelopeBytes;
  const done = valueOf(await readWorkspace({ envelopeBytes: (await edit(withMember, { type: 'set-relationship-status', status: 'complete' })).envelopeBytes }));
  assert.equal(done.relationships.shown, 'complete');
  assert.deepEqual(done.unresolved, [{ memberId: 'ui', field: 'responsibilities' }, { memberId: 'ui', field: 'instructions' }, { memberId: 'ui', field: 'contracts' }]);
  const again = valueOf(await readWorkspace({ envelopeBytes: (await edit(withMember, { type: 'set-relationship-status', status: 'unresolved' })).envelopeBytes }));
  assert.equal(again.relationships.shown, 'unresolved');
  // A second declare, and any edit before declaring, is refused with the input kept.
  assert.equal(code(await editWorkspace({ envelopeBytes: declare.envelopeBytes, operation: { type: 'declare' }, now: NOW })), 'WORKSPACE_ALREADY_DECLARED');
  const none = await editWorkspace({ envelopeBytes, operation: { type: 'set-member', member: UI }, now: NOW });
  assert.equal(code(none), 'WORKSPACE_NOT_DECLARED'); assert.deepEqual(none.originalBytes, envelopeBytes);
});

test('members: known/unresolved fields are explicit, pasted remote URLs lose their credentials, and relationships need declared endpoints', async () => {
  let bytes = (await edit((await shared()).envelopeBytes, { type: 'declare' })).envelopeBytes;
  const full = { id: 'api', identity: 'https://user:ghp_secret@GitHub.com/acme/api.git', aliases: ['git@gitlab.com:acme/api-mirror.git', 'github.com/acme-old/api'], label: 'API',
    responsibilities: { status: 'known', values: ['Serves orders'] }, instructions: { status: 'known', locations: ['AGENTS.md', 'docs/agents/api.md'] },
    contracts: { status: 'known', references: ['openapi/orders.yaml', 'urn:acme:contract:orders:1'] } };
  const set = await edit(bytes, { type: 'set-member', member: full });
  bytes = set.envelopeBytes;
  assert.equal(decode(bytes).includes('ghp_secret'), false);
  const [api] = set.workspace.members;
  assert.equal(api.identity, 'github.com/acme/api'); assert.deepEqual(api.aliases, ['github.com/acme-old/api', 'gitlab.com/acme/api-mirror']);
  assert.deepEqual(set.workspace.unresolved, [{ memberId: null, field: 'relationships' }]);
  bytes = (await edit(bytes, { type: 'set-member', member: UI })).envelopeBytes;
  // Replace by id keeps one member; members stay sorted.
  const replaced = await edit(bytes, { type: 'set-member', member: { ...UI, label: 'UI app' } });
  assert.deepEqual(replaced.workspace.members.map(m => [m.id, m.label]), [['api', 'API'], ['ui', 'UI app']]);
  // Relationships: endpoints must be declared members; confirmed carry provenance and a time; suggestions never count as confirmed.
  const rel = { from: 'ui', to: 'api', kind: 'consumes-api', provenance: { kind: 'contract', ref: 'openapi/orders.yaml' } };
  for (const bad of [{ ...rel, to: 'missing' }, { ...rel, from: 'missing' }, { ...rel, to: 'ui' }, { ...rel, kind: 'owns' }, { ...rel, provenance: { kind: 'guess' } }, { ...rel, provenance: { kind: 'owner', ref: 'C:\\Users\\me\\x' } }, { from: 'ui', to: 'api', kind: 'depends-on' }])
    assert.equal(code(await editWorkspace({ envelopeBytes: bytes, operation: { type: 'set-relationship', relationship: bad }, now: NOW })), 'INPUT_INVALID', JSON.stringify(bad));
  const confirmedRel = await edit(bytes, { type: 'set-relationship', relationship: rel }, LATER);
  const [edge] = confirmedRel.workspace.relationships.confirmed;
  assert.equal(edge.id, await relationshipId(rel)); assert.deepEqual(edge.provenance, { kind: 'contract', ref: 'openapi/orders.yaml', recordedAt: LATER });
  const suggested = await edit(bytes, { type: 'suggest-relationship', relationship: { from: 'api', to: 'ui', kind: 'depends-on', reason: 'Both mention the orders contract.' } });
  assert.equal(suggested.workspace.relationships.confirmed.length, 0); assert.equal(suggested.workspace.relationships.suggested.length, 1);
  assert.equal(suggested.workspace.relationships.shown, 'unresolved');
  // Confirming settles the suggestion; removing a member removes its relationships; removing a relationship works for either list.
  const settled = await edit(suggested.envelopeBytes, { type: 'set-relationship', relationship: { from: 'api', to: 'ui', kind: 'depends-on', provenance: { kind: 'owner' } } });
  assert.deepEqual([settled.workspace.relationships.confirmed.length, settled.workspace.relationships.suggested.length], [1, 0]);
  assert.equal(code(await editWorkspace({ envelopeBytes: settled.envelopeBytes, operation: { type: 'suggest-relationship', relationship: { from: 'api', to: 'ui', kind: 'depends-on', reason: 'again' } }, now: NOW })), 'INPUT_INVALID');
  const removedMember = await edit(settled.envelopeBytes, { type: 'remove-member', id: 'ui' });
  assert.deepEqual([removedMember.workspace.members.map(m => m.id), removedMember.workspace.relationships.confirmed], [['api'], []]);
  const removedEdge = await edit(settled.envelopeBytes, { type: 'remove-relationship', id: settled.workspace.relationships.confirmed[0].id });
  assert.deepEqual(removedEdge.workspace.relationships.confirmed, []);
  assert.equal(code(await editWorkspace({ envelopeBytes: bytes, operation: { type: 'remove-relationship', id: 'relationship-nope' }, now: NOW })), 'INPUT_INVALID');
  assert.equal(code(await editWorkspace({ envelopeBytes: bytes, operation: { type: 'remove-member', id: 'nope' }, now: NOW })), 'INPUT_INVALID');
  // set-label changes the label but never the workspace id; an empty label removes it.
  const labeled = await edit(bytes, { type: 'set-label', label: 'Storefront' }), cleared = await edit(labeled.envelopeBytes, { type: 'set-label', label: '' });
  const idOf = r => valueOf(r).workspace.id;
  assert.equal(idOf(await readWorkspace({ envelopeBytes: bytes })), idOf(await readWorkspace({ envelopeBytes: labeled.envelopeBytes })));
  assert.equal(labeled.workspace.workspace.label, 'Storefront'); assert.equal('label' in cleared.workspace.workspace, false);
});

test('absolute local paths, URL userinfo and malformed fields are refused in every free-text and location field', async () => {
  const bytes = (await edit((await shared()).envelopeBytes, { type: 'declare' })).envelopeBytes;
  const unsafe = ['C:\\Users\\me\\repo', 'c:/work/repo', '\\\\server\\share\\repo', '/home/me/repo', '/Users/me/repo', '/root/repo', '~/repo', 'cloned at /home/me/repo', 'see (~/repo)', 'see file:///etc/passwd', 'https://user:ghp_secret@github.com/acme/api', 'clone from https://ghp_secret@host/x',
    '/srv/checkouts/api', 'checkout lives at /srv/repos/api', '/opt/a/b', 'see "/mnt/c/work"', '/Volumes/x/y', 'path=/var/lib/x', 'ssh://host/access?token=secret123', 'curl -H api_key=abcdefgh', 'password: hunter2', 'secret : s3cr3t99', '/private.pem', 'checkout:/srv/checkouts/api', 'token=secret123abc',
    'ghp_' + 'a'.repeat(36), 'github_pat_11AAAAAAA', 'glpat-abcdefghij', 'xoxb-123-456', 'sk-' + 'a1'.repeat(12), 'AKIAIOSFODNN7EXAMPLE', 'Token=abcdefgh', 'x?access_token=12345678', 'passwd=12345678', 'pwd=12345678', 'apikey=12345678'];
  const attempt = async (patch, operation = { type: 'set-member', member: { ...UI, ...patch } }) => editWorkspace({ envelopeBytes: bytes, operation, now: NOW });
  for (const text of unsafe) {
    for (const [name, patch] of [['label', { label: text }], ['responsibilities', { responsibilities: { status: 'known', values: [text] } }]]) {
      const refused = await attempt(patch);
      assert.equal(code(refused), 'INPUT_INVALID', `${name}: ${text}`);
      assert.equal(JSON.stringify(refused).includes('ghp_secret'), false);
      assert.deepEqual(refused.originalBytes, bytes);
    }
    assert.equal(code(await attempt({}, { type: 'set-label', label: text })), 'INPUT_INVALID', `workspace label: ${text}`);
    assert.equal(code(await attempt({ instructions: { status: 'known', locations: [text] } })), 'INPUT_INVALID', `instructions: ${text}`);
    assert.equal(code(await attempt({ contracts: { status: 'known', references: [text] } })), 'INPUT_INVALID', `contracts: ${text}`);
  }
  // Provenance and suggestion texts, in a workspace with two members.
  const two = await declared();
  for (const text of unsafe) {
    assert.equal(code(await editWorkspace({ envelopeBytes: two, operation: { type: 'set-relationship', relationship: { from: 'api', to: 'ui', kind: 'depends-on', provenance: { kind: 'owner', ref: text } } }, now: NOW })), 'INPUT_INVALID', text);
    assert.equal(code(await editWorkspace({ envelopeBytes: two, operation: { type: 'suggest-relationship', relationship: { from: 'api', to: 'ui', kind: 'depends-on', reason: text } }, now: NOW })), 'INPUT_INVALID', text);
  }
  for (const safe of ['Owns src/home/index.ts', 'Edits the profile: page', 'Serves api/root/health', 'See docs/api/v1/orders and AGENTS.md', 'Owns /health only', 'https://example.com/a/b is documented', 'Rotates secrets quarterly', 'sk-short', 'owns the /v1/orders/ endpoint', 'serves /api/health/live', 'Handles password: reset emails', 'limits max_token=4096', 'See https://example.com'])
    assert.equal((await attempt({ label: safe, responsibilities: { status: 'known', values: [safe] } })).status, 'ok', safe);
  for (const text of unsafe) assert.equal(unsafeText(text), true, text);
  for (const text of ['src/home/index.ts', 'profile: page', 'serves api/root/health', 'AGENTS.md', 5, null]) assert.equal(unsafeText(text), false, String(text));
  for (const path of ['AGENTS.md', 'docs/agents/api.md', 'a/b/c.txt', 'src/Users/notes.md', 'src/home/index.ts']) assert.equal((await attempt({ instructions: { status: 'known', locations: [path] } })).status, 'ok', path);
  for (const path of ['/AGENTS.md', '\\AGENTS.md', 'C:AGENTS.md', '~AGENTS.md', '../AGENTS.md', 'a/../b', './a', 'a//b', 'a/', 'a\\b', '', 'x'.repeat(513)])
    assert.equal(code(await attempt({ instructions: { status: 'known', locations: [path] } })), 'INPUT_INVALID', JSON.stringify(path));
  assert.equal((await attempt({ contracts: { status: 'known', references: ['urn:acme:contract:orders:1', 'openapi/a.yaml'] } })).status, 'ok');
  // Closed shape: unknown members, identities that are not host/owner/name, bad slugs and empty known lists.
  for (const patch of [{ extra: 1 }, { identity: 'C:\\repo' }, { identity: 'github.com/acme' }, { id: 'Bad Id' }, { id: '' }, { aliases: 'x' }, { aliases: ['/srv/repo.git'] }, { aliases: ['github.com/acme/ui'] },
    { responsibilities: { status: 'known', values: [] } }, { responsibilities: { status: 'known' } }, { responsibilities: { status: 'unresolved', values: ['x'] } }, { responsibilities: { status: 'maybe' } }, { label: 'x'.repeat(121) }])
    assert.equal(code(await attempt(patch)), 'INPUT_INVALID', JSON.stringify(patch));
});

test('the text guard refuses local roots at any depth, top-level files and credential values, and allows ordinary routes and prose', () => {
  const refused = ['/private.pem', 'see /private.pem.', '(/id_rsa.key)', 'checkout:/srv/checkouts/api', '/srv/checkouts/api', '/srv/x', 'at "/workspace/api"', 'x=/data/export', '/Library/Keychains/a', 'ssh://host/access?token=secret123', 'token=secret123abc',
    'api_key=abcdefgh12', 'x&password=hunter2hunter2', 'password=P@ssw0rd!2026', 'password=hunter2', 'pwd = x1', 'secret=a', 'built from /app/src/config.json', 'cache in /code/project/build', '/builds/group/proj/out', '/nix/store/abc-x/bin', 'see /id_rsa', 'keys in /keys/team/.env', 'Deployment password=&P@ssw0rd!2026', 'Deployment password=true!P@ssw0rd2026', 'secret=nonesuch1', 'read /app/.env.production', 'uses /srv/.env.local', 'client_secret=abc', 'in /home/me/.aws/credentials', 'uses /keys/credentials.json', 'password: hunter2', 'secret : s3cr3t99', 'api-key: abc-1234', 'passwd: Hunter22.'];
  const allowed = ['owns the /v1/orders/ endpoint', 'serves /api/health/live', 'Handles password: reset emails', 'limits max_token=4096', 'src/home/index.ts', 'profile: page', 'serves api/root/health', 'Owns /health only', 'calls /v1.2/orders',
    'See https://example.com', 'https://example.com/home/x', 'token=short', 'The secret: rotated', 'src/srv/x.ts', 'a/private.pem', 'owns the /v1/credentials endpoint', 'POST /auth/credentials', 'serves /app/health', 'routes /work/items', 'GET /code/review', 'GET /src/list', 'password = required', 'set secret=true in staging'];
  for (const text of refused) assert.equal(unsafeText(text), true, text);
  for (const text of allowed) assert.equal(unsafeText(text), false, text);
});

test('a mismatched revision, relationship or binding id and unknown members are refused on read and on write', async () => {
  const { writeJourneyEnvelope } = await import('./journey.mjs');
  const withEdge = (await edit(await declared(), { type: 'set-relationship', relationship: { from: 'ui', to: 'api', kind: 'consumes-api', provenance: { kind: 'owner' } } })).envelopeBytes;
  const bound = (await bind(withEdge, 'api', observation())).envelopeBytes;
  const find = (doc, schema) => doc.records.find(x => x.schema === schema);
  const mutations = {
    'revision': [d => { find(d, WORKSPACE_DECLARATION_SCHEMA).revision = hex(7); }, 'derived', '/revision'],
    'member edit without a new revision': [d => { find(d, WORKSPACE_DECLARATION_SCHEMA).members[0].label = 'Edited'; }, 'derived', '/revision'],
    'relationship id': [d => { find(d, WORKSPACE_DECLARATION_SCHEMA).relationships.confirmed[0].id = `relationship-${'0'.repeat(32)}`; }, 'derived', '/relationships/confirmed/0/id'],
    'binding id': [d => { find(d, LOCAL_BINDING_SCHEMA).id = `binding-${'0'.repeat(32)}`; }, 'derived', '/id'],
    'binding root edited': [d => { find(d, LOCAL_BINDING_SCHEMA).checkout.root = '/work/elsewhere'; }, 'derived', '/id'],
    'unknown declaration field': [d => { find(d, WORKSPACE_DECLARATION_SCHEMA).extra = true; }, 'shape'],
    'unknown binding field': [d => { find(d, LOCAL_BINDING_SCHEMA).extra = true; }, 'shape'],
    'unknown relationship endpoint': [d => { find(d, WORKSPACE_DECLARATION_SCHEMA).relationships.confirmed[0].to = 'ghost'; }, 'shape'],
    'unsorted members': [d => { find(d, WORKSPACE_DECLARATION_SCHEMA).members.reverse(); }, 'shape'],
    'status that is not a status': [d => { find(d, WORKSPACE_DECLARATION_SCHEMA).relationships.status = 'done'; }, 'shape'],
    'a path in a label': [d => { find(d, WORKSPACE_DECLARATION_SCHEMA).members[0].label = 'C:\\Users\\me'; }, 'shape'],
    'a relative checkout root': [d => { find(d, LOCAL_BINDING_SCHEMA).checkout.root = 'work/api'; }, 'shape'],
    'matched with reasons': [d => { find(d, LOCAL_BINDING_SCHEMA).verification.reasons = ['fork']; }, 'shape'],
    'confirmed without reasons': [d => { find(d, LOCAL_BINDING_SCHEMA).verification.result = 'confirmed'; }, 'shape']
  };
  for (const [name, [mutate, kind, tail]] of Object.entries(mutations)) {
    const mutated = await resign(bound, mutate), read = await readJourneyEnvelope(mutated);
    assert.equal(read.status, 'refused', name);
    assert.equal(read.diagnostics[0].code, 'INPUT_INVALID', name);
    assert.match(read.diagnostics[0].path, kind === 'shape' ? /^\/records\/\d+$/ : new RegExp(`^/records/\\d+${tail}$`), name);
    assert.deepEqual(read.originalBytes, mutated, name);
    assert.equal(code(await readWorkspace({ envelopeBytes: mutated })), 'INPUT_INVALID', name);
  }
  // The writer applies the same rules.
  const read = valueOf(await readJourneyEnvelope(bound)), others = read.records.filter(r => !r.schema.includes('workspace') && !r.schema.includes('local-binding'));
  const declaration = read.records.find(x => x.schema === WORKSPACE_DECLARATION_SCHEMA), binding = read.records.find(x => x.schema === LOCAL_BINDING_SCHEMA);
  const write = records => writeJourneyEnvelope({ savedIntentBytes: read.savedIntentBytes, records, previous: read });
  assert.equal((await write([...others, structuredClone(declaration), structuredClone(binding)])).status, 'ok');
  const badRevision = await write([...others, { ...structuredClone(declaration), revision: hex(9) }, structuredClone(binding)]);
  assert.deepEqual([badRevision.status, badRevision.diagnostics[0].code], ['refused', 'INPUT_INVALID']); assert.match(badRevision.diagnostics[0].path, /\/revision$/);
  const badId = await write([...others, structuredClone(declaration), { ...structuredClone(binding), id: `binding-${'1'.repeat(32)}` }]);
  assert.match(badId.diagnostics[0].path, /\/id$/);
  assert.match((await write([...others, { ...structuredClone(declaration), extra: 1 }])).diagnostics[0].path, /^\/records\/\d+$/);
  assert.deepEqual(await validateDeclaration({ ...declaration, extra: 1 }), { valid: false, problem: '' });
  assert.deepEqual(await validateDeclaration({ ...declaration, revision: hex(9) }), { valid: false, problem: '/revision' });
  assert.deepEqual(await validateBinding({ ...binding, checkout: { root: 'relative' } }), { valid: false, problem: '/checkout' });
  assert.equal(JOURNEY_RECORD_KINDS[WORKSPACE_DECLARATION_SCHEMA].required, false);
  assert.equal(JOURNEY_RECORD_KINDS[LOCAL_BINDING_SCHEMA].required, false);
});

// ---- 3. Binding ------------------------------------------------------------------------------------------------------
test('an exact or alias match is ready and binds as matched with the observed identity, revision and working state', async () => {
  const bytes = await declared();
  const ready = await plan(bytes, 'api', observation());
  assert.deepEqual([ready.outcome, ready.reasons], ['ready', []]);
  assert.match(ready.observationSha256, /^[a-f0-9]{64}$/); assert.equal(ready.observed.repository, 'github.com/acme/api'); assert.equal(ready.refusal, undefined);
  const before = bytes.slice();
  assert.deepEqual(bytes, before); // planning wrote nothing
  const bound = valueOf(await bindCheckout({ envelopeBytes: bytes, memberId: 'api', observation: observation(), now: LATER }));
  const [binding] = recordsOf(bound.envelopeBytes, 'local-binding');
  assert.deepEqual(await validateBinding(binding), { valid: true, problem: null });
  assert.match(binding.id, /^binding-[a-f0-9]{32}$/); assert.equal(binding.required, false); assert.equal(binding.schema, LOCAL_BINDING_SCHEMA);
  assert.deepEqual(binding.member, { id: 'api', identity: 'github.com/acme/api' }); assert.deepEqual(binding.checkout, { root: '/work/api' });
  assert.equal(binding.workspace.revision, valueOf(await readWorkspace({ envelopeBytes: bytes })).revision);
  assert.deepEqual(binding.observed, { repository: 'github.com/acme/api', remotes: [{ name: 'origin', identity: 'github.com/acme/api' }], revision: 'a'.repeat(40), branch: 'main',
    worktree: { kind: 'main', gitDirSha256: hex(1) }, workingState: { clean: true, sha256: hex(100) } });
  assert.deepEqual(binding.verification, { result: 'matched', reasons: [], verifiedAt: LATER });
  assert.equal(bound.workspace.bindings, 1); assert.equal(bound.workspace.members[0].bindings[0].status, 'unverified');
  assert.equal(bound.binding.id, binding.id);
  // An alias is an exact match (case-insensitively); case differences in the remote do not matter.
  const alias = await plan(bytes, 'api', observation({ remotes: [['mirror', 'git@GitLab.com:ACME/api-mirror.git']] }));
  assert.deepEqual([alias.outcome, alias.reasons, alias.observed.repository], ['ready', [], 'gitlab.com/ACME/api-mirror']);
  assert.equal(JSON.stringify(bound).includes('ghp_'), false);
});

test('a fork, similar name, ambiguous remote, missing remote or moved checkout needs confirmation with exactly those reasons', async () => {
  const bytes = await declared();
  const cases = {
    fork: [observation({ remotes: [['origin', 'https://github.com/someone/api']] }), ['fork']],
    'fork on another host': [observation({ remotes: [['origin', 'https://gitlab.com/acme/api']] }), ['fork']],
    'same identity in another case is the same repository': [observation({ remotes: [['origin', 'https://github.com/ACME/Api']] }), []],
    'similar name (separators)': [observation({ remotes: [['origin', 'https://github.com/acme/a-p-i']] }), ['similar-name']],
    'similar name (edit distance, five or more characters)': [observation({ remotes: [['origin', 'https://github.com/acme/storefornt']] }), ['similar-name'], 'store'],
    'not similar: too short to compare by edits': [observation({ remotes: [['origin', 'https://github.com/acme/apx']] }), null],
    'not similar: far apart in a longer name': [observation({ remotes: [['origin', 'https://github.com/acme/storehouse-x']] }), null, 'store'],
    'not similar: far apart': [observation({ remotes: [['origin', 'https://github.com/acme/api-gateway']] }), null],
    'ambiguous: two identities': [observation({ remotes: [['origin', 'https://github.com/acme/api'], ['upstream', 'https://github.com/other/lib']] }), ['ambiguous-remote']],
    'fork with upstream': [observation({ remotes: [['origin', 'https://github.com/someone/api'], ['upstream', 'https://github.com/else/api']] }), ['ambiguous-remote', 'fork']],
    'exact origin with an unrecognizable second remote is ambiguous': [observation({ remotes: [['origin', 'https://github.com/acme/api'], ['upstream', '/srv/git/api.git']] }), ['ambiguous-remote']],
    'unrecognizable origin next to an exact remote is ambiguous': [observation({ remotes: [['origin', '/srv/git/api.git'], ['upstream', 'https://github.com/acme/api']] }), ['ambiguous-remote']],
    'fork with an unrecognizable second remote': [observation({ remotes: [['origin', 'https://github.com/someone/api'], ['x', 'ftp://nowhere/o/n']] }), ['ambiguous-remote', 'fork']],
    'only unrecognizable remotes': [observation({ remotes: [['a', '/srv/git/a.git'], ['b', '/srv/git/b.git']] }), ['no-remote']],
    'no remote': [observation({ remotes: [] }), ['no-remote']],
    'unrecognizable remote': [observation({ remotes: [['origin', '/srv/git/api.git']] }), ['no-remote']]
  };
  const store = (await edit(bytes, { type: 'set-member', member: { id: 'store', identity: 'github.com/acme/storefront' } })).envelopeBytes;
  for (const [name, [obs, reasons, memberId = 'api']] of Object.entries(cases)) {
    const target = memberId === 'api' ? bytes : store;
    const result = await plan(target, memberId, obs);
    if (reasons === null) { assert.deepEqual([result.outcome, result.refusal?.code], ['refused', 'WORKSPACE_REPOSITORY_MISMATCH'], name); continue; }
    if (reasons.length === 0) { assert.deepEqual([result.outcome, result.reasons], ['ready', []], name); continue; }
    assert.deepEqual([result.outcome, result.reasons], ['confirm', reasons], name);
    // Without a confirmation nothing is bound; with a stale or wrong one still nothing.
    const bare = await bindCheckout({ envelopeBytes: target, memberId, observation: obs, now: NOW });
    assert.equal(code(bare), 'WORKSPACE_CONFIRMATION_REQUIRED', name); assert.deepEqual(bare.originalBytes, target);
    const stale = await bindCheckout({ envelopeBytes: target, memberId, observation: obs, now: NOW, confirmation: { observationSha256: hex(5), reasons } });
    assert.equal(code(stale), 'WORKSPACE_CONFIRMATION_STALE', name);
    for (const wrong of [[], ['fork', 'moved'], [...reasons, 'moved'], ['unknown']].filter(w => w.join() !== reasons.join()))
      assert.equal(code(await bindCheckout({ envelopeBytes: target, memberId, observation: obs, now: NOW, confirmation: { observationSha256: result.observationSha256, reasons: wrong } })), 'WORKSPACE_CONFIRMATION_REQUIRED', `${name}: ${wrong}`);
    for (const junk of ['yes', {}, { observationSha256: result.observationSha256 }, { observationSha256: result.observationSha256, reasons, extra: 1 }])
      assert.equal(code(await bindCheckout({ envelopeBytes: target, memberId, observation: obs, now: NOW, confirmation: junk })), 'WORKSPACE_CONFIRMATION_REQUIRED', name);
    const done = valueOf(await bindCheckout({ envelopeBytes: target, memberId, observation: obs, now: NOW, confirmation: { observationSha256: result.observationSha256, reasons: [...reasons].reverse() } }));
    const [binding] = recordsOf(done.envelopeBytes, 'local-binding');
    assert.deepEqual([binding.verification.result, binding.verification.reasons], ['confirmed', reasons], name);
    assert.equal(binding.observed.repository, reasons.includes('no-remote') ? null : result.observed.repository, name);
  }
  // The observation digest ignores the observation time but covers every observed fact.
  const a = await plan(bytes, 'api', observation({ remotes: [] })), b = await plan(bytes, 'api', observation({ remotes: [], observedAt: LATER })), c = await plan(bytes, 'api', observation({ remotes: [], dirty: true }));
  assert.equal(a.observationSha256, b.observationSha256); assert.notEqual(a.observationSha256, c.observationSha256);
  // A confirmation made for a changed folder is stale.
  assert.equal(code(await bindCheckout({ envelopeBytes: bytes, memberId: 'api', observation: observation({ remotes: [], dirty: true }), now: NOW, confirmation: { observationSha256: a.observationSha256, reasons: ['no-remote'] } })), 'WORKSPACE_CONFIRMATION_STALE');
});

test('an unrelated repository, another member\'s repository or checkout, and unknown ids are refused', async () => {
  const bytes = await declared();
  const refuseCase = async (obs, memberId, expected, extra = {}) => {
    const p = await plan(bytes, memberId, obs, extra);
    assert.deepEqual([p.outcome, p.refusal?.code], ['refused', expected]);
    const refused = await bindCheckout({ envelopeBytes: bytes, memberId, observation: obs, now: NOW, ...extra });
    assert.equal(code(refused), expected); assert.deepEqual(refused.originalBytes, bytes);
  };
  await refuseCase(observation({ remotes: [['origin', 'https://github.com/acme/billing']] }), 'api', 'WORKSPACE_REPOSITORY_MISMATCH');
  await refuseCase(observation({ remotes: [['origin', 'https://github.com/acme/ui']] }), 'api', 'WORKSPACE_REPOSITORY_MISMATCH');
  // Another member's repository next to this member's own is ambiguous, not a match by accident: confirmation lists exactly that.
  const both = await plan(bytes, 'api', observation({ remotes: [['origin', 'https://github.com/acme/ui'], ['upstream', 'https://github.com/acme/api']] }));
  assert.deepEqual([both.outcome, both.reasons], ['confirm', ['ambiguous-remote']]);
  const twin = (await edit(bytes, { type: 'set-member', member: { id: 'api-fork', identity: 'github.com/acme/api' } })).envelopeBytes;
  assert.deepEqual((await plan(twin, 'api', observation())).reasons, ['ambiguous-remote'], 'an identity declared by two members is ambiguous');
  await refuseCase(observation(), 'ghost', 'WORKSPACE_MEMBER_UNKNOWN');
  await refuseCase(observation(), 'api', 'WORKSPACE_BINDING_UNKNOWN', { replaces: `binding-${'0'.repeat(32)}` });
  // The same root cannot be bound to a second member.
  const first = (await bind(bytes, 'api', observation())).envelopeBytes;
  await (async () => {
    const obs = observation({ remotes: [['origin', 'https://github.com/acme/ui']] });
    assert.equal(code(await bindCheckout({ envelopeBytes: first, memberId: 'ui', observation: obs, now: NOW })), 'CHECKOUT_BOUND_TO_OTHER_MEMBER');
    assert.equal((await plan(first, 'ui', obs)).refusal.code, 'CHECKOUT_BOUND_TO_OTHER_MEMBER');
    assert.equal((await plan(first, 'ui', { ...obs, root: '/WORK/api/' })).outcome, 'ready'); // POSIX roots are case-sensitive
    assert.equal((await plan(first, 'ui', { ...obs, root: '/work/ui' })).outcome, 'ready');
  })();
  // Bad input is an input error, not a plan.
  for (const bad of [null, {}, { ...observation(), extra: 1 }, { ...observation(), root: 'relative/path' }, { ...observation(), revision: 'abc' }, { ...observation(), observedAt: 'yesterday' }])
    assert.equal(code(await planBinding({ envelopeBytes: bytes, memberId: 'api', observation: bad })), 'INPUT_INVALID');
  assert.equal(code(await bindCheckout({ envelopeBytes: bytes, memberId: 'api', observation: observation(), now: 'today' })), 'INPUT_INVALID');
  assert.equal(code(await planBinding({ envelopeBytes: (await shared()).envelopeBytes, memberId: 'api', observation: observation() })), 'WORKSPACE_NOT_DECLARED');
});

test('different worktrees of one repository are different bindings; rebinding the same root refreshes; replaces moves a binding after confirmation', async () => {
  const bytes = await declared();
  const main = observation({ root: '/work/api', git: 1, kind: 'main' }), linked = observation({ root: '/work/api-feature', git: 2, kind: 'linked', branch: 'feature' });
  const one = (await bind(bytes, 'api', main)).envelopeBytes;
  // A second checkout of a member that is already bound is deliberate: it needs confirmation as an additional checkout.
  const extra = await plan(one, 'api', linked);
  assert.deepEqual([extra.outcome, extra.reasons], ['confirm', ['additional-checkout']]);
  const unconfirmed = await bindCheckout({ envelopeBytes: one, memberId: 'api', observation: linked, now: NOW });
  assert.equal(code(unconfirmed), 'WORKSPACE_CONFIRMATION_REQUIRED'); assert.deepEqual(unconfirmed.originalBytes, one);
  assert.deepEqual((await plan(one, 'api', observation({ root: '/work/api-fork', git: 4, remotes: [['origin', 'https://github.com/someone/api']] }))).reasons, ['additional-checkout', 'fork']);
  assert.deepEqual((await plan(bytes, 'api', linked)).reasons, [], 'the first checkout of a member needs no such confirmation');
  const two = await confirmed(one, 'api', linked);
  assert.deepEqual(recordsOf(two.envelopeBytes, 'local-binding').find(b => b.checkout.root === '/work/api-feature').verification, { result: 'confirmed', reasons: ['additional-checkout'], verifiedAt: NOW });
  const bindings = recordsOf(two.envelopeBytes, 'local-binding');
  assert.equal(bindings.length, 2); assert.equal(new Set(bindings.map(b => b.id)).size, 2);
  assert.deepEqual(bindings.map(b => b.checkout.root).sort(), ['/work/api', '/work/api-feature']);
  assert.deepEqual(bindings.map(b => b.observed.worktree.kind).sort(), ['linked', 'main']);
  assert.equal(two.workspace.members.find(m => m.id === 'api').bindings.length, 2);
  // The same root again is a refresh: one binding, new facts.
  const refreshed = valueOf(await bindCheckout({ envelopeBytes: two.envelopeBytes, memberId: 'api', observation: { ...main, revision: 'b'.repeat(40) }, now: LATER }));
  const after = recordsOf(refreshed.envelopeBytes, 'local-binding');
  assert.equal(after.length, 2); assert.equal(after.find(b => b.checkout.root === '/work/api').observed.revision, 'b'.repeat(40));
  assert.equal(after.find(b => b.checkout.root === '/work/api').replaces, undefined);
  // Moving a checkout: a new root with replaces needs confirmation (moved), then removes the replaced binding.
  const old = bindings.find(b => b.checkout.root === '/work/api');
  const moved = observation({ root: '/elsewhere/api', git: 3 });
  const p = await plan(two.envelopeBytes, 'api', moved, { replaces: old.id });
  assert.deepEqual([p.outcome, p.reasons], ['confirm', ['moved']], 'replaces keeps moved and is not also an additional checkout');
  assert.equal(code(await bindCheckout({ envelopeBytes: two.envelopeBytes, memberId: 'api', observation: moved, replaces: old.id, now: NOW })), 'WORKSPACE_CONFIRMATION_REQUIRED');
  const rebound = await confirmed(two.envelopeBytes, 'api', moved, { replaces: old.id });
  const kept = recordsOf(rebound.envelopeBytes, 'local-binding');
  assert.deepEqual(kept.map(b => b.checkout.root).sort(), ['/elsewhere/api', '/work/api-feature']);
  const fresh = kept.find(b => b.checkout.root === '/elsewhere/api');
  assert.equal(fresh.replaces, old.id); assert.deepEqual(fresh.verification.reasons, ['moved']);
  // Rebinding at the same root is not "moved"; a different member's binding cannot be replaced.
  assert.deepEqual((await plan(two.envelopeBytes, 'api', main, { replaces: old.id })).reasons, []);
  const ui = (await bind(rebound.envelopeBytes, 'ui', observation({ root: '/work/ui', remotes: [['origin', 'https://github.com/acme/ui']] }))).envelopeBytes;
  const foreign = await plan(ui, 'ui', observation({ root: '/work/ui2', remotes: [['origin', 'https://github.com/acme/ui']] }), { replaces: fresh.id });
  assert.deepEqual([foreign.outcome, foreign.refusal.code], ['refused', 'WORKSPACE_BINDING_UNKNOWN']);
  // Unbind removes exactly one binding and keeps the others; an unknown id is refused.
  const unbound = valueOf(await unbindCheckout({ envelopeBytes: two.envelopeBytes, bindingId: old.id, now: LATER }));
  assert.deepEqual(recordsOf(unbound.envelopeBytes, 'local-binding').map(b => b.checkout.root), ['/work/api-feature']);
  assert.equal(code(await unbindCheckout({ envelopeBytes: two.envelopeBytes, bindingId: 'binding-nope', now: LATER })), 'INPUT_INVALID');
  // Workspace members are not saved-intent roots: no binding changes the saved intent or the draft.
  const before = valueOf(await readJourneyEnvelope(bytes)), changed = valueOf(await readJourneyEnvelope(two.envelopeBytes));
  assert.deepEqual(changed.savedIntentBytes, before.savedIntentBytes);
  assert.deepEqual(changed.records.find(r => r.id === 'draft'), before.records.find(r => r.id === 'draft'));
});

// ---- 4. Verification -------------------------------------------------------------------------------------------------
test('verifyBindings reports current, changed, identity-changed, missing, declaration-changed and unverified', async () => {
  let bytes = await declared();
  bytes = (await bind(bytes, 'api', observation({ root: '/work/api', git: 1 }))).envelopeBytes;
  bytes = (await bind(bytes, 'ui', observation({ root: '/work/ui', git: 2, remotes: [['origin', 'https://github.com/acme/ui']] }))).envelopeBytes;
  bytes = (await confirmed(bytes, 'api', observation({ root: '/work/api-wt', git: 3, kind: 'linked' }))).envelopeBytes;
  const [api, apiWt, ui] = ['/work/api', '/work/api-wt', '/work/ui'].map(root => recordsOf(bytes, 'local-binding').find(b => b.checkout.root === root));
  const read = valueOf(await readWorkspace({ envelopeBytes: bytes }));
  assert.deepEqual(read.members.flatMap(m => m.bindings.map(b => b.status)), ['unverified', 'unverified', 'unverified']);
  const verify = async (observations, source = bytes) => valueOf(await verifyBindings({ envelopeBytes: source, observations }));
  const none = await verify({});
  assert.deepEqual(Object.values(none.statuses).map(s => s.status), ['unverified', 'unverified', 'unverified']);
  assert.deepEqual(Object.keys(none.statuses).sort(), [api.id, apiWt.id, ui.id].sort());
  const current = await verify({ [api.id]: observation({ root: '/work/api', git: 1 }), [ui.id]: observation({ root: '/work/ui', git: 2, remotes: [['origin', 'https://github.com/acme/ui']] }) });
  assert.deepEqual([current.statuses[api.id].status, current.statuses[ui.id].status, current.statuses[apiWt.id].status], ['current', 'current', 'unverified']);
  assert.equal(current.projection.members[0].bindings.find(b => b.id === api.id).status, 'current');
  // Revision or working state differ: changed, with recorded and observed values.
  const moved = await verify({ [api.id]: observation({ root: '/work/api', git: 1, revision: 'c'.repeat(40), dirty: true }) });
  assert.equal(moved.statuses[api.id].status, 'changed');
  assert.deepEqual(moved.statuses[api.id].changes.map(c => c.field), ['revision', 'workingState']);
  assert.deepEqual(moved.statuses[api.id].changes[0], { field: 'revision', recorded: 'a'.repeat(40), observed: 'c'.repeat(40) });
  assert.equal((await verify({ [api.id]: observation({ root: '/work/api', git: 1, branch: 'other' }) })).statuses[api.id].status, 'current');
  // Another repository, another worktree or another root at the bound folder: identity-changed.
  for (const changed of [observation({ root: '/work/api', git: 1, remotes: [['origin', 'https://github.com/someone/api']] }), observation({ root: '/work/api', git: 9 }), observation({ root: '/work/other', git: 1 }),
    observation({ root: '/work/api', git: 1, remotes: [] })])
    assert.equal((await verify({ [api.id]: changed })).statuses[api.id].status, 'identity-changed', JSON.stringify(changed.remotes));
  // A refusal (moved or removed folder) is missing.
  const gone = await verify({ [api.id]: { status: 'refused', diagnostics: [{ code: 'CHECKOUT_UNAVAILABLE', message: 'x' }] } });
  assert.deepEqual(gone.statuses[api.id], { status: 'missing', code: 'CHECKOUT_UNAVAILABLE' });
  // Declaration changes: a removed member, an edited identity or a removed alias make the binding declaration-changed.
  const noUi = (await edit(bytes, { type: 'remove-member', id: 'ui' })).envelopeBytes;
  const afterRemoval = await verify({ [ui.id]: observation({ root: '/work/ui', git: 2 }) }, noUi);
  assert.equal(afterRemoval.statuses[ui.id].status, 'declaration-changed');
  assert.equal(afterRemoval.projection.detached.length, 1); assert.equal(afterRemoval.projection.members.length, 1); assert.equal(afterRemoval.projection.bindings, 3);
  const renamed = (await edit(bytes, { type: 'set-member', member: { ...API, identity: 'github.com/acme/api-v2', aliases: [] } })).envelopeBytes;
  assert.equal((await verify({}, renamed)).statuses[api.id].status, 'declaration-changed');
  assert.equal(valueOf(await readWorkspace({ envelopeBytes: renamed })).members[0].bindings.length, 2, 'bindings are kept');
  const aliasBound = (await confirmed(bytes, 'api', observation({ root: '/work/alias', git: 5, remotes: [['m', 'https://gitlab.com/acme/api-mirror']] }))).envelopeBytes;
  const aliasId = recordsOf(aliasBound, 'local-binding').find(b => b.checkout.root === '/work/alias').id;
  assert.equal((await verify({}, aliasBound)).statuses[aliasId].status, 'unverified');
  const noAlias = (await edit(aliasBound, { type: 'set-member', member: { ...API, aliases: [] } })).envelopeBytes;
  assert.equal((await verify({}, noAlias)).statuses[aliasId].status, 'declaration-changed');
  assert.equal(code(await verifyBindings({ envelopeBytes: bytes, observations: { [api.id]: { root: 'x' } } })), 'INPUT_INVALID');
  assert.equal(code(await verifyBindings({ envelopeBytes: bytes, observations: [] })), 'INPUT_INVALID');
});

test('verifyBindings compares the recorded remotes with the observed ones and flags an ambiguity that is new since the person confirmed', async () => {
  const acme = 'https://github.com/acme/api', bytes = (await bind(await declared(), 'api', observation())).envelopeBytes, [api] = recordsOf(bytes, 'local-binding');
  const status = async (obs, source = bytes) => valueOf(await verifyBindings({ envelopeBytes: source, observations: { [api.id]: obs } })).statuses[api.id].status;
  assert.equal(await status(observation()), 'current');
  assert.equal(await status(observation({ remotes: [['origin', 'https://github.com/ACME/API.git']] })), 'current', 'case and .git are not changes');
  // The fork became origin while the declared repository stays as upstream: the identity is still present, but the remotes are not the recorded ones.
  assert.equal(await status(observation({ remotes: [['origin', 'https://github.com/someone/api'], ['upstream', acme]] })), 'identity-changed');
  assert.equal(await status(observation({ remotes: [['origin', acme], ['upstream', 'https://github.com/other/lib']] })), 'identity-changed', 'a remote was added');
  assert.equal(await status(observation({ remotes: [['origin', acme], ['x', '/srv/git/x.git']] })), 'identity-changed', 'an unrecognizable remote was added');
  assert.equal(await status(observation({ remotes: [['upstream', acme]] })), 'identity-changed', 'the remote was renamed');
  // An ambiguity the person confirmed is not new; one that appears with a declaration change is.
  const ambiguous = observation({ remotes: [['origin', acme], ['upstream', 'https://github.com/other/lib']] }), withAmbiguity = (await confirmed(await declared(), 'api', ambiguous)).envelopeBytes;
  const [known] = recordsOf(withAmbiguity, 'local-binding');
  assert.deepEqual(known.verification.reasons, ['ambiguous-remote']);
  assert.equal(valueOf(await verifyBindings({ envelopeBytes: withAmbiguity, observations: { [known.id]: ambiguous } })).statuses[known.id].status, 'current');
  const twin = (await edit(bytes, { type: 'set-member', member: { id: 'api-fork', identity: 'github.com/acme/api' } })).envelopeBytes;
  assert.equal(await status(observation(), twin), 'identity-changed');
  // A case-only edit of the declared identity (github.com folds case) is not a declaration change; another host's case is part of the name.
  const recased = (await edit(bytes, { type: 'set-member', member: { ...API, identity: 'github.com/ACME/api' } })).envelopeBytes;
  assert.equal(await status(observation(), recased), 'current');
  const other = (await edit(await declared(), { type: 'set-member', member: { id: 'api', identity: 'git.example.com/Acme/Api' } })).envelopeBytes;
  const otherBound = (await bind(other, 'api', observation({ remotes: [['origin', 'https://git.example.com/Acme/Api']] }))).envelopeBytes, [mine] = recordsOf(otherBound, 'local-binding');
  assert.equal(valueOf(await verifyBindings({ envelopeBytes: otherBound, observations: { [mine.id]: observation({ remotes: [['origin', 'https://git.example.com/Acme/Api']] }) } })).statuses[mine.id].status, 'current');
  assert.equal(valueOf(await verifyBindings({ envelopeBytes: otherBound, observations: { [mine.id]: observation({ remotes: [['origin', 'https://git.example.com/acme/api']] }) } })).statuses[mine.id].status, 'identity-changed');
  const recasedRemote = await plan(other, 'api', observation({ remotes: [['origin', 'https://git.example.com/acme/api']] }));
  assert.deepEqual([recasedRemote.outcome, recasedRemote.reasons], ['confirm', ['fork']], 'a different case on a plain host is not the same repository');
});

test('relationships return to unresolved when a member is added or removed or its identity or aliases change, and not on other edits', async () => {
  const shown = async bytes => valueOf(await readWorkspace({ envelopeBytes: bytes })).relationships.shown;
  const complete = async bytes => (await edit(bytes, { type: 'set-relationship-status', status: 'complete' })).envelopeBytes;
  const base = await complete(await declared());
  assert.equal(await shown(base), 'complete');
  // Label, field and relationship edits do not reopen the judgement.
  for (const operation of [{ type: 'set-member', member: { ...UI, label: 'UI app' } }, { type: 'set-member', member: { ...UI, responsibilities: { status: 'known', values: ['Renders'] } } }, { type: 'set-label', label: 'Renamed' },
    { type: 'set-relationship', relationship: { from: 'ui', to: 'api', kind: 'consumes-api', provenance: { kind: 'owner' } } }, { type: 'set-member', member: API },
    // A case-only edit of a repository that the host folds is the same repository.
    { type: 'set-member', member: { ...UI, identity: 'github.com/Acme/UI' } }, { type: 'set-member', member: { ...API, aliases: ['gitlab.com/ACME/api-mirror'] } }])
    assert.equal(await shown((await edit(base, operation)).envelopeBytes), 'complete', operation.type);
  // A new member, another identity, other aliases and a removed member each leave the relationships unjudged.
  for (const [name, operation] of Object.entries({ 'new member': { type: 'set-member', member: { id: 'docs', identity: 'github.com/acme/docs' } },
    'identity change': { type: 'set-member', member: { ...UI, identity: 'github.com/acme/ui-v2' } }, 'alias added': { type: 'set-member', member: { ...UI, aliases: ['gitlab.com/acme/ui'] } },
    'alias removed': { type: 'set-member', member: { ...API, aliases: [] } }, 'member removed': { type: 'remove-member', id: 'ui' } })) {
    const changed = await edit(base, operation);
    assert.equal(await shown(changed.envelopeBytes), 'unresolved', name); assert.equal(changed.workspace.relationships.status, 'unresolved', name);
    assert.deepEqual(changed.workspace.unresolved.at(-1), { memberId: null, field: 'relationships' }, name);
  }
  // It can be declared complete again afterwards.
  assert.equal(await shown(await complete((await edit(base, { type: 'set-member', member: { id: 'docs', identity: 'github.com/acme/docs' } })).envelopeBytes)), 'complete');
});

// ---- 5. Default export -----------------------------------------------------------------------------------------------
test('the default export excludes bindings, absolute local paths and credentials', async () => {
  let bytes = await declared();
  // The observed remotes arrive from URLs that carried credentials; only their identities may reach any record.
  const withSecret = (root, url) => observation({ root, remotes: [['origin', url]] });
  bytes = (await bind(bytes, 'api', withSecret('C:\\Users\\someone\\src\\api', 'https://user:ghp_secret@github.com/acme/api.git'))).envelopeBytes;
  bytes = (await bind(bytes, 'ui', withSecret('/home/someone/src/ui', 'https://user:ghp_secret@github.com/acme/ui.git'))).envelopeBytes;
  bytes = (await edit(bytes, { type: 'set-relationship', relationship: { from: 'ui', to: 'api', kind: 'consumes-api', provenance: { kind: 'owner' } } })).envelopeBytes;
  // A binding record of a future version is local state too, and is also left out.
  bytes = await resign(bytes, doc => doc.records.push({ id: 'binding-future', schema: 'urn:aihq:workbench:journey-record:local-binding:2.0.0', required: false, root: 'D:\\secret\\place' }));
  const own = decode(bytes);
  assert.ok(own.includes('C:\\\\Users\\\\someone\\\\src\\\\api') && own.includes('/home/someone/src/ui'), 'the local envelope holds the roots');
  assert.equal(own.includes('ghp_secret'), false);
  assert.equal(valueOf(await readWorkspace({ envelopeBytes: bytes })).bindings, 2);
  const exported = valueOf(await exportWorkspace({ envelopeBytes: bytes }));
  const text = decode(exported.envelopeBytes);
  assert.deepEqual(exported.excluded, { bindings: 3, batches: 0, unknownRecords: 0 });
  for (const forbidden of [LOCAL_BINDING_SCHEMA, ':local-binding:', 'binding-', 'C:\\\\Users', 'someone', 'secret', 'ghp_secret', 'user:', 'gitDirSha256', 'workingState', '/home/', /(?<![A-Za-z0-9])[A-Za-z]:[\\/]/, /\\\\\\\\/, /\/(?:home|Users|root)\//, /:\/\/[^\s"]*@/])
    typeof forbidden === 'string' ? assert.equal(text.includes(forbidden), false, forbidden) : assert.doesNotMatch(text, forbidden, String(forbidden));
  // It is a valid envelope: it re-reads, keeps the declaration and its relationship, and carries no binding.
  const again = valueOf(await readJourneyEnvelope(exported.envelopeBytes));
  assert.equal(again.envelope.revision.sequence, valueOf(await readJourneyEnvelope(bytes)).envelope.revision.sequence + 1);
  const projection = valueOf(await readWorkspace({ envelopeBytes: exported.envelopeBytes }));
  assert.deepEqual([projection.bindings, projection.detached, projection.unsupported], [0, [], []]);
  assert.deepEqual(projection.members.map(m => [m.id, m.identity, m.bindings.length]), [['api', 'github.com/acme/api', 0], ['ui', 'github.com/acme/ui', 0]]);
  assert.equal(projection.relationships.confirmed.length, 1);
  assert.equal(projection.revision, valueOf(await readWorkspace({ envelopeBytes: bytes })).revision);
  assert.deepEqual(exported.envelope.savedIntent, valueOf(await readJourneyEnvelope(bytes)).envelope.savedIntent);
  // The local envelope is untouched, and exporting an envelope with no workspace or bindings still works.
  assert.equal(decode(bytes), own);
  assert.deepEqual(valueOf(await exportWorkspace({ envelopeBytes: (await shared()).envelopeBytes })).excluded, { bindings: 0, batches: 0, unknownRecords: 0 });
  // Exporting twice excludes nothing more.
  assert.deepEqual(valueOf(await exportWorkspace({ envelopeBytes: exported.envelopeBytes })).excluded, { bindings: 0, batches: 0, unknownRecords: 0 });
});

test('a reviewed batch holds local target roots, so the default export leaves it out and counts it', async () => {
  const f = await batchFixture(await mkdtemp(join(tmpdir(), 'ui35-export-')), { applyEarlier: false });
  const bytes = (await edit(f.envelopeBytes, { type: 'declare', label: 'Shop' })).envelopeBytes;
  assert.equal(valueOf(await readJourneyEnvelope(bytes)).records.filter(r => r.schema === BATCH_RECORD_SCHEMA).length, 1);
  const exported = valueOf(await exportWorkspace({ envelopeBytes: bytes }));
  assert.deepEqual(exported.excluded, { bindings: 0, batches: 1, unknownRecords: 0 });
  const text = decode(exported.envelopeBytes);
  for (const forbidden of [BATCH_RECORD_SCHEMA, ':reviewed-batch:', 'home-a', 'home-b', f.batchId]) assert.equal(text.includes(forbidden), false, forbidden);
  assert.equal(valueOf(await readJourneyEnvelope(exported.envelopeBytes)).records.some(r => r.schema === BATCH_RECORD_SCHEMA), false);
  assert.equal(decode(bytes).includes('home-a'), true, 'the local envelope still holds the roots');
  assert.deepEqual(valueOf(await exportWorkspace({ envelopeBytes: exported.envelopeBytes })).excluded, { bindings: 0, batches: 0, unknownRecords: 0 });
});

test('the default export refuses unsafe text anywhere in the outgoing envelope or the saved intent, reports only pointers, and still exports a normal composed envelope', async () => {
  const s = await shared(), { writeJourneyEnvelope } = await import('./journey.mjs');
  // A normal envelope composed from the installed Catalog, with a workspace and bindings, exports.
  const normal = await declared(), withBinding = (await bind(normal, 'api', observation())).envelopeBytes;
  assert.equal(valueOf(await exportWorkspace({ envelopeBytes: withBinding })).excluded.bindings, 1);
  assert.equal(valueOf(await exportWorkspace({ envelopeBytes: s.envelopeBytes })).excluded.bindings, 0);
  // An unresolved draft whose root reason names a local path and a token is refused with the original bytes and no echoed value.
  const dirty = await resign(normal, doc => { doc.records.find(r => r.id === 'draft').intent.roots[0].reason = 'uses /home/alice/private-checkout; token=secret123'; });
  assert.equal(valueOf(await readWorkspace({ envelopeBytes: dirty })).members.length, 2, 'the envelope itself is valid and readable');
  const refused = await exportWorkspace({ envelopeBytes: dirty });
  assert.equal(code(refused), 'WORKSPACE_EXPORT_UNSAFE'); assert.deepEqual(refused.originalBytes, dirty);
  assert.match(refused.diagnostics[0].path, /^\/records\/\d+\/intent\/roots\/0\/reason$/);
  const reported = JSON.stringify(refused.diagnostics);
  for (const leaked of ['alice', 'secret123', '/home/', 'private-checkout', 'token=']) assert.equal(reported.includes(leaked), false, leaked);
  assert.match(reported, /intent\/roots\/0\/reason/);
  // The same text in a binding is not a problem: bindings never leave.
  assert.equal(valueOf(await exportWorkspace({ envelopeBytes: (await bind(normal, 'ui', observation({ root: '/home/alice/private-checkout', remotes: [['origin', 'https://github.com/acme/ui']] }))).envelopeBytes })).excluded.bindings, 1);
  // The decoded saved intent is checked too, and the raw base64 field is not (it would never pass), nor is an ordinary Catalog policy.
  const read = valueOf(await readJourneyEnvelope(normal)), policy = JSON.parse(decode(read.savedIntentBytes));
  const written = await writeJourneyEnvelope({ savedIntentBytes: encode(JSON.stringify({ ...policy, note: 'checkout at /srv/checkouts/api' })), records: read.records.filter(r => r.id === 'draft').map(({ savedIntentSha256: _bound, ...rest }) => rest) });
  const unsafeIntent = (await edit(valueOf(written).envelopeBytes, { type: 'declare' })).envelopeBytes, refusedIntent = await exportWorkspace({ envelopeBytes: unsafeIntent });
  assert.equal(code(refusedIntent), 'WORKSPACE_EXPORT_UNSAFE'); assert.equal(refusedIntent.diagnostics[0].path, '/savedIntent/note'); assert.deepEqual(refusedIntent.originalBytes, unsafeIntent);
  assert.equal(JSON.stringify(refusedIntent.diagnostics).includes('srv'), false);
  // A password whose value starts with `&` is still a password, in a declaration and in the saved intent.
  assert.equal(code(await editWorkspace({ envelopeBytes: normal, operation: { type: 'set-label', label: 'Deployment password=&P@ssw0rd!2026' }, now: NOW })), 'INPUT_INVALID');
  const ampersand = await writeJourneyEnvelope({ savedIntentBytes: encode(JSON.stringify({ ...policy, note: 'Deployment password=&P@ssw0rd!2026' })), records: read.records.filter(r => r.id === 'draft').map(({ savedIntentSha256: _bound, ...rest }) => rest) });
  const ampersandBytes = (await edit(valueOf(ampersand).envelopeBytes, { type: 'declare' })).envelopeBytes, refusedAmpersand = await exportWorkspace({ envelopeBytes: ampersandBytes });
  assert.equal(code(refusedAmpersand), 'WORKSPACE_EXPORT_UNSAFE'); assert.deepEqual(refusedAmpersand.originalBytes, ampersandBytes);
  assert.equal(JSON.stringify(refusedAmpersand.diagnostics).includes('P@ss'), false);
  // Many offenders: at most 20 pointers.
  const many = await resign(normal, doc => { for (const root of doc.records.find(r => r.id === 'draft').intent.roots) { root.reason = 'x'; for (let n = 0; n < 30; n++) root.configuration[`note${n}`] = 'see /srv/a/b'; } });
  const crowded = await exportWorkspace({ envelopeBytes: many });
  assert.equal(code(crowded), 'WORKSPACE_EXPORT_UNSAFE'); assert.equal(crowded.diagnostics[0].message.split('/records/').length - 1, 20);
});

test('the default export refuses an unsafe JSON key itself, with the key redacted from the pointer', async () => {
  const normal = await declared(), { writeJourneyEnvelope } = await import('./journey.mjs');
  for (const key of ['/srv/checkouts/api', 'token=secret123abc']) {
    const dirty = await resign(normal, doc => { doc.records.find(r => r.id === 'draft').intent.roots[0].configuration[key] = 'ok'; });
    assert.equal(valueOf(await readWorkspace({ envelopeBytes: dirty })).members.length, 2, 'the envelope itself is valid and readable');
    const refused = await exportWorkspace({ envelopeBytes: dirty });
    assert.equal(code(refused), 'WORKSPACE_EXPORT_UNSAFE'); assert.deepEqual(refused.originalBytes, dirty);
    assert.match(refused.diagnostics[0].path, /^\/records\/\d+\/intent\/roots\/0\/configuration\/~unsafe-key$/);
    assert.equal(JSON.stringify(refused.diagnostics).includes('srv'), false); assert.equal(JSON.stringify(refused.diagnostics).includes('secret123'), false);
  }
  // The same in the decoded saved intent, with a safe value.
  const read = valueOf(await readJourneyEnvelope(normal)), policy = JSON.parse(decode(read.savedIntentBytes));
  const written = await writeJourneyEnvelope({ savedIntentBytes: encode(JSON.stringify({ ...policy, '/srv/checkouts/api': 'ok' })), records: read.records.filter(r => r.id === 'draft').map(({ savedIntentSha256: _bound, ...rest }) => rest) });
  const refusedIntent = await exportWorkspace({ envelopeBytes: (await edit(valueOf(written).envelopeBytes, { type: 'declare' })).envelopeBytes });
  assert.equal(code(refusedIntent), 'WORKSPACE_EXPORT_UNSAFE'); assert.equal(refusedIntent.diagnostics[0].path, '/savedIntent/~unsafe-key');
});

test('the default export is a portable artifact: it keeps only kinds known to be portable, drops unknown optional records and refuses an unknown required one', async () => {
  const base = await declared(), payload = encodeBase64(encode('/srv/checkouts/api; token=secret123'));
  assert.equal(payload.includes('srv'), false);
  const unknown = await resign(base, doc => { doc.records.push({ id: 'future-note', schema: 'urn:aihq:workbench:journey-record:future-note:1.0.0', required: false, payload }); });
  assert.ok(decode(unknown).includes(payload), 'the local envelope carries the unknown optional record');
  assert.equal(valueOf(await readWorkspace({ envelopeBytes: unknown })).members.length, 2);
  const bound = (await bind(unknown, 'api', observation())).envelopeBytes, exported = valueOf(await exportWorkspace({ envelopeBytes: bound })), text = decode(exported.envelopeBytes);
  assert.deepEqual(exported.excluded, { bindings: 1, batches: 0, unknownRecords: 1 });
  for (const leaked of [payload, '/srv/checkouts/api', 'secret123', 'future-note', 'local-binding']) assert.equal(text.includes(leaked), false, leaked);
  assert.deepEqual(exported.envelope.records.map(r => r.schema).sort(), ['urn:aihq:workbench:journey-record:unresolved-draft:1.0.0', WORKSPACE_DECLARATION_SCHEMA]);
  // Every kind this build knows to be portable survives (a binding and a batch are local); the local envelope is untouched.
  assert.ok(Object.values(JOURNEY_RECORD_KINDS).filter(entry => !['local-binding', 'reviewed-batch'].includes(entry.kind)).length === 8);
  assert.deepEqual(valueOf(await exportWorkspace({ envelopeBytes: exported.envelopeBytes })).excluded, { bindings: 0, batches: 0, unknownRecords: 0 });
  // An unknown required record cannot be left out, so nothing is exported and the original bytes stay.
  const required = await resign(base, doc => { doc.records.push({ id: 'future-required', schema: 'urn:aihq:workbench:journey-record:future-required:1.0.0', required: true, payload }); });
  const refused = await exportWorkspace({ envelopeBytes: required });
  assert.equal(code(refused), 'WORKSPACE_EXPORT_UNSAFE'); assert.deepEqual(refused.originalBytes, required); assert.match(refused.diagnostics[0].path, /^\/records\/\d+$/);
  for (const leaked of [payload, 'secret123']) assert.equal(JSON.stringify(refused.diagnostics).includes(leaked), false, leaked);
});

// ---- 6. Unsupported versions -----------------------------------------------------------------------------------------
test('an unsupported workspace record version fails explicitly, keeps its bytes, and other modules still carry it', async () => {
  const s = await shared(), base = await declared();
  const future = {
    'declaration 2.0.0': [await resign(s.envelopeBytes, d => d.records.push({ id: 'workspace-declaration', schema: 'urn:aihq:workbench:journey-record:workspace-declaration:2.0.0', required: false, members: [{ path: 'C:\\x' }] })), 'workspace-declaration'],
    'binding 9.0.0': [await resign(base, d => d.records.push({ id: 'binding-future', schema: 'urn:aihq:workbench:journey-record:local-binding:9.0.0', required: false, root: '/home/me/x' })), 'binding-future'],
    'required declaration 2.0.0': [await resign(s.envelopeBytes, d => d.records.push({ id: 'workspace-declaration', schema: 'urn:aihq:workbench:journey-record:workspace-declaration:2.0.0', required: true })), 'workspace-declaration']
  };
  for (const [name, [bytes, id]] of Object.entries(future)) {
    const original = bytes.slice();
    const read = valueOf(await readWorkspace({ envelopeBytes: bytes }));
    assert.equal(read.unsupported.length, 1, name); assert.equal(read.unsupported[0].id, id, name); assert.match(read.unsupported[0].schema, /:(?:workspace-declaration:2\.0\.0|local-binding:9\.0\.0)$/);
    const refusals = {
      edit: await editWorkspace({ envelopeBytes: bytes, operation: { type: 'set-label', label: 'x' }, now: NOW }),
      declare: await editWorkspace({ envelopeBytes: bytes, operation: { type: 'declare' }, now: NOW }),
      plan: await planBinding({ envelopeBytes: bytes, memberId: 'api', observation: observation() }),
      bind: await bindCheckout({ envelopeBytes: bytes, memberId: 'api', observation: observation(), now: NOW }),
      unbind: await unbindCheckout({ envelopeBytes: bytes, bindingId: 'binding-x', now: NOW }),
      verify: await verifyBindings({ envelopeBytes: bytes, observations: {} })
    };
    // The default export leaves out any local-binding version, so only a declaration of an unknown version blocks it.
    if (name !== 'binding 9.0.0') refusals.export = await exportWorkspace({ envelopeBytes: bytes });
    for (const [operation, result] of Object.entries(refusals)) {
      assert.equal(code(result), 'WORKSPACE_VERSION_UNSUPPORTED', `${name}: ${operation}`);
      assert.match(result.diagnostics[0].path, /^\/records\/\d+$/);
      assert.deepEqual(result.originalBytes, original, `${name}: ${operation}`);
    }
    assert.deepEqual(bytes, original);
    if (name !== 'required declaration 2.0.0') {
      // Other modules keep carrying the unknown optional record verbatim.
      const edited = valueOf(await editDraft({ envelopeBytes: bytes, inventories: s.inventories, operation: { type: 'remove-root', root: { releaseSha256: s.maintained.release.sha256, itemId: 'mattpocock.implement', scope: 'project' } } }));
      const unknown = doc => doc.records.filter(r => /:(?:workspace-declaration:2|local-binding:9)\./.test(r.schema));
      assert.deepEqual(unknown(edited.envelope), unknown(JSON.parse(decode(bytes))), name);
      const note = valueOf(await recordMaintenance({ envelopeBytes: bytes, operation: { type: 'note-check', checkedAt: NOW, categories: [{ category: 'content', state: 'checked' }] }, now: NOW }));
      assert.deepEqual(unknown(note.envelope), unknown(JSON.parse(decode(bytes))), name);
    }
  }
  // The binding future version alone still allows a default export that drops it.
  const bindingOnly = future['binding 9.0.0'][0], exported = valueOf(await exportWorkspace({ envelopeBytes: bindingOnly }));
  assert.deepEqual(exported.excluded, { bindings: 1, batches: 0, unknownRecords: 0 }); assert.equal(decode(exported.envelopeBytes).includes('/home/me/x'), false);
  // Garbage is the journey reader's refusal, untouched.
  const garbage = encode('not json');
  assert.equal(code(await readWorkspace({ envelopeBytes: garbage })), 'INPUT_INVALID');
  assert.equal(code(await editWorkspace({ envelopeBytes: 'nope', operation: { type: 'declare' }, now: NOW })), 'INPUT_INVALID');
});

// ---- 7. Carry-through ------------------------------------------------------------------------------------------------
test('workspace records survive draft edits, maintenance and improvement records, and survive their edits', async () => {
  const s = await shared();
  let bytes = await declared();
  bytes = (await bind(bytes, 'api', observation())).envelopeBytes;
  const workspaceRecords = doc => doc.records.filter(r => /:(?:workspace-declaration|local-binding):/.test(r.schema));
  const original = workspaceRecords(JSON.parse(decode(bytes)));
  assert.equal(original.length, 2);
  const edited = valueOf(await editDraft({ envelopeBytes: bytes, inventories: s.inventories, operation: { type: 'remove-root', root: { releaseSha256: s.maintained.release.sha256, itemId: 'mattpocock.implement', scope: 'project' } } }));
  assert.deepEqual(workspaceRecords(edited.envelope), original);
  const noted = valueOf(await recordMaintenance({ envelopeBytes: bytes, operation: { type: 'note-check', checkedAt: NOW, categories: [{ category: 'content', state: 'checked' }] }, now: NOW }));
  assert.deepEqual(workspaceRecords(noted.envelope), original);
  assert.ok(noted.envelope.records.some(r => r.id === 'maintenance-check'));
  // An improvement dismissal keeps both workspace records; a workspace edit and the default export keep it and the maintenance note.
  const checked = valueOf(await checkImprovements({ envelopeBytes: noted.envelopeBytes, inventories: s.inventories, goal: 'add tests', now: NOW }));
  const { label: _label, description: _description, prompt: _prompt, dismissal: _dismissal, promotion: _promotion, client: _client, ...fields } = checked.leading;
  const dismissed = valueOf(await recordImprovement({ envelopeBytes: noted.envelopeBytes, operation: { type: 'dismiss', suggestion: fields }, now: NOW }));
  assert.deepEqual(workspaceRecords(dismissed.envelope), original);
  const kept = doc => doc.records.filter(r => /:(?:improvement-suggestion|improvement-dismissal|maintenance-check):/.test(r.schema)).map(r => r.id).sort();
  assert.equal(kept(dismissed.envelope).length, 3);
  const afterEdit = valueOf(await editWorkspace({ envelopeBytes: dismissed.envelopeBytes, operation: { type: 'set-label', label: 'Renamed' }, now: LATER }));
  assert.deepEqual(kept(afterEdit.envelope), kept(dismissed.envelope));
  assert.deepEqual(kept(valueOf(await exportWorkspace({ envelopeBytes: afterEdit.envelopeBytes })).envelope), kept(dismissed.envelope));
  assert.equal(workspaceRecords(afterEdit.envelope).length, 2);
  assert.equal(afterEdit.workspace.bindings, 1);
  // The binding keeps the declaration revision it was made at; the edit gave the declaration a new one.
  const [binding] = workspaceRecords(afterEdit.envelope).filter(r => r.schema === LOCAL_BINDING_SCHEMA);
  assert.notEqual(binding.workspace.revision, afterEdit.workspace.revision);
  assert.equal(afterEdit.envelope.revision.sequence, dismissed.envelope.revision.sequence + 1);
  // Opening the envelope as a draft still works and shows both records as supported.
  const reopened = valueOf(await openDraft({ bytes: afterEdit.envelopeBytes, inventories: s.inventories }));
  assert.deepEqual(reopened.envelope.records.filter(r => r.schema.includes('workspace') || r.schema.includes('local-binding')).map(r => r.id).sort(), ['workspace-declaration', binding.id].sort());
  assert.equal(reopened.editing, 'available');
});

// ---- 8. Host adapter (real Git in two tests, canned Git output everywhere else) ------------------------------------------
test('observeCheckout reads Git metadata only: same identity across worktrees, distinct worktree hashes, no credentials', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'aih-workspace-')));
  try {
    const run = (cwd, ...args) => { const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
    const main = join(root, 'api'), linked = join(root, 'api-feature'), plain = join(root, 'plain');
    await mkdir(main); await mkdir(plain);
    run(main, 'init', '-q');
    run(main, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'init');
    run(main, 'remote', 'add', 'origin', 'https://user:tok@github.com/acme/api.git');
    run(main, 'worktree', 'add', '-q', '-b', 'feature', linked);
    await mkdir(join(main, 'sub'));
    const head = run(main, 'rev-parse', 'HEAD');
    const [a, b, sub] = [valueOf(await observeCheckout(main)), valueOf(await observeCheckout(linked)), valueOf(await observeCheckout(join(main, 'sub')))];
    for (const observed of [a, b]) {
      assert.deepEqual(observed.remotes, [{ name: 'origin', identity: 'github.com/acme/api' }]);
      assert.equal(observed.revision, head); assert.deepEqual(observed.workingState.clean, true);
      assert.match(observed.observedAt, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
    }
    assert.deepEqual([a.worktree.kind, b.worktree.kind], ['main', 'linked']);
    assert.notEqual(a.worktree.gitDirSha256, b.worktree.gitDirSha256);
    assert.match(a.worktree.gitDirSha256, /^[a-f0-9]{64}$/);
    assert.equal(a.root.toLowerCase(), main.toLowerCase()); assert.equal(b.root.toLowerCase(), linked.toLowerCase());
    assert.equal(b.branch, 'feature'); assert.equal(typeof a.branch, 'string');
    assert.deepEqual(sub, { ...a, observedAt: sub.observedAt }); // a subfolder selects its checkout, and the same state is the same digest
    assert.equal(JSON.stringify([a, b, sub]).includes('tok'), false);
    // The observation is a valid input to planning; two worktrees of one repository bind separately.
    let bytes = await declared();
    bytes = valueOf(await bindCheckout({ envelopeBytes: bytes, memberId: 'api', observation: a, now: NOW })).envelopeBytes;
    assert.equal((await confirmed(bytes, 'api', b)).workspace.members[0].bindings.length, 2);
    // A non-repository folder, a missing folder and bad input are refusals that echo nothing.
    const noneCall = observeCheckout(plain); assert.ok(noneCall instanceof Promise, 'observing does not block: the call returns a promise');
    const none = await noneCall;
    assert.equal(code(none), 'CHECKOUT_NOT_REPOSITORY');
    for (const bad of [join(root, 'missing'), 'relative', '', null, 7, 'x'.repeat(2000), join(root, 'api', '.git', 'HEAD')]) {
      const refused = await observeCheckout(bad);
      assert.ok(['CHECKOUT_UNAVAILABLE', 'CHECKOUT_NOT_REPOSITORY'].includes(code(refused)), String(bad).slice(0, 40));
      assert.equal(JSON.stringify(refused).includes('tok'), false);
    }
    // A dirty folder changes the working-state digest; a bare repository cannot be bound.
    const bare = join(root, 'bare.git'); run(root, 'init', '-q', '--bare', bare);
    assert.equal(code(await observeCheckout(bare)), 'CHECKOUT_NOT_REPOSITORY');
    const { writeFile } = await import('node:fs/promises');
    await mkdir(join(main, 'new-folder')); await writeFile(join(main, 'untracked.txt'), 'x');
    const dirty = valueOf(await observeCheckout(main));
    assert.equal(dirty.workingState.clean, false); assert.notEqual(dirty.workingState.sha256, a.workingState.sha256);
    assert.equal(dirty.revision, a.revision);
  } finally { await rm(root, { recursive: true, force: true }); }
});

const gitIn = (cwd, ...args) => { const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
const posix = path => path.replaceAll('\\', '/');
// A process runner that answers every Git call the host makes from canned output, so folder-reading rules are tested without Git. `config` and
// `filters` are the records of `git config --includes --show-scope -z --get-regexp`; `calls` collects the Git arguments after `-C <folder>`.
const configRecord = (scope, key, value) => `${scope}\0${key}\n${value}\0`;
const fakeGit = ({ top, config = '', filters = '', status = Buffer.alloc(0), staged = Buffer.alloc(0), unborn = false, calls = [] }) => (_command, args) => {
  const sub = args.slice(args.indexOf('-C') + 2), ok = stdout => ({ status: 0, stdout, stderr: '' });
  calls.push({ sub, args });
  if (sub[0] === 'rev-parse' && sub.includes('--show-toplevel')) return ok(`${posix(top)}\n${posix(join(top, '.git'))}\n${posix(join(top, '.git'))}\n`);
  if (sub[0] === 'rev-parse') return unborn ? { status: 1, stdout: '', stderr: '' } : ok(`${'a'.repeat(40)}\n`);
  if (sub[0] === 'symbolic-ref') return ok('main\n');
  if (sub[0] === 'config') return ok(sub.includes('^filter\\.') ? filters : config);
  return sub[0] === 'diff' || sub[0] === 'ls-files' ? ok(staged) : ok(status);
};
const porcelain = (...entries) => Buffer.from(entries.map(entry => `${entry}\0`).join(''));
const temporary = () => mkdtemp(join(tmpdir(), 'aih-workspace-')).then(realpath);
test('observeCheckout never runs a command the repository configures (fsmonitor, clean and process filters), reads included configuration, drops inherited Git variables and keeps every remote', async () => {
  const { writeFile, appendFile, access, utimes } = await import('node:fs/promises'), root = await temporary(), calls = [], saved = { ...process.env };
  const exists = path => access(path).then(() => true, () => false);
  try {
    const repo = join(root, 'repo'); await mkdir(repo); gitIn(repo, 'init', '-q');
    await writeFile(join(repo, 'tracked.txt'), 'one\n'); await writeFile(join(repo, 'zz.dat'), 'one\n');
    gitIn(repo, 'add', '.'); gitIn(repo, 'commit', '-q', '-m', 'init');
    // A configured fsmonitor command runs on `git status`; observing must not run it. The fixture first proves plain Git does run it.
    const marker = join(root, 'fsmonitor-ran'), script = join(root, 'fsmonitor.sh');
    await writeFile(script, `#!/bin/sh\n: > '${posix(marker)}'\nprintf '\\0'\n`);
    gitIn(repo, 'config', 'core.fsmonitor', `sh '${posix(script)}'`);
    gitIn(repo, 'status', '--porcelain');
    assert.equal(await exists(marker), true, 'the fixture hook runs under plain git status');
    await rm(marker);
    valueOf(await observeCheckout(repo));
    assert.equal(await exists(marker), false, 'observeCheckout did not run the configured fsmonitor command');
    // A clean filter and a long-running process filter that the repository defines run when Git compares a stat-dirty file with the index.
    // The fixture proves plain Git runs both; an empty clean, smudge and process command (and required=false) is what keeps them from running.
    const cleanMarker = join(root, 'clean-ran'), processMarker = join(root, 'process-ran'), cleanScript = join(root, 'clean.sh'), processScript = join(root, 'process.sh');
    await writeFile(cleanScript, `#!/bin/sh\n: > '${posix(cleanMarker)}'\ncat\n`); await writeFile(processScript, `#!/bin/sh\n: > '${posix(processMarker)}'\nexit 1\n`);
    gitIn(repo, 'config', '--unset', 'core.fsmonitor');   // a fsmonitor that reports no change would keep Git from looking at the files at all
    gitIn(repo, 'config', 'filter.x.clean', `sh '${posix(cleanScript)}'`); gitIn(repo, 'config', 'filter.p.process', `sh '${posix(processScript)}'`); gitIn(repo, 'config', 'filter.p.required', 'true');
    await writeFile(join(repo, '.git', 'info', 'attributes'), '*.txt filter=x\n*.dat filter=p\n');
    const stale = async year => { for (const name of ['tracked.txt', 'zz.dat']) { await writeFile(join(repo, name), 'one\n'); await utimes(join(repo, name), new Date(`${year}-01-01`), new Date(`${year}-01-01`)); } };
    await stale(2020);
    spawnSync('git', ['status', '--porcelain'], { cwd: repo, windowsHide: true });
    assert.deepEqual([await exists(cleanMarker), await exists(processMarker)], [true, true], 'the fixture filters run under plain git status');
    await rm(cleanMarker); await rm(processMarker); await stale(2021);
    valueOf(await observeCheckout(repo));
    assert.deepEqual([await exists(cleanMarker), await exists(processMarker)], [false, false], 'observeCheckout did not run the configured filters');
    // A remote whose name cannot be carried is still a remote: it is recorded once as (unrecognized), so a plan sees the ambiguity. A remote
    // that sits in a file the repository configuration includes is read too.
    const extra = join(root, 'extra.cfg'); await writeFile(extra, '[remote "inc"]\n\turl = https://github.com/inc/one\n');
    await appendFile(join(repo, '.git', 'config'), `[include]\n\tpath = ${posix(extra)}\n[remote "origin"]\n\turl = https://user:tok@github.com/acme/api.git\n[remote "up@x"]\n\turl = https://github.com/evil/other\n[remote "up y"]\n\turl = https://github.com/evil/other2\n[remote "multi"]\n\turl = https://github.com/a/b\n\turl = https://github.com/c/d\n`);
    // Inherited variables that would point Git at another repository or add configuration are not passed on (they would break this call).
    Object.assign(process.env, { GIT_DIR: join(root, 'elsewhere'), GIT_WORK_TREE: root, GIT_INDEX_FILE: join(root, 'index'), GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'true', GIT_CONFIG_PARAMETERS: "'core.fsmonitor=true'" });
    let odd;
    try { odd = valueOf(await observeCheckout(repo, (command, args, options) => { calls.push({ command, args, options }); return spawnSync(command, args, options); })); } finally { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; }
    assert.deepEqual(odd.remotes, [{ name: '(unrecognized)', identity: null }, { name: 'inc', identity: 'github.com/inc/one' }, { name: 'multi', identity: null }, { name: 'origin', identity: 'github.com/acme/api' }]);
    assert.equal(JSON.stringify(odd).includes('tok'), false);
    const planned = await plan(await declared(), 'api', odd);
    assert.deepEqual([planned.outcome, planned.reasons], ['confirm', ['ambiguous-remote']]);
    assert.ok(calls.length >= 7);
    for (const { command, args, options } of calls) {
      assert.equal(command, 'git');
      assert.deepEqual(args.slice(0, 5), ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false']);
      assert.equal(options.windowsHide, true); assert.equal(options.env.GIT_TERMINAL_PROMPT, '0'); assert.equal(options.env.GIT_OPTIONAL_LOCKS, '0');
      // A partial clone must never fetch a missing object: that fetch runs a transport the repository's own configuration can name.
      assert.equal(options.env.GIT_NO_LAZY_FETCH, '1');
      assert.deepEqual(Object.keys(options.env).filter(key => /^GIT_(?:DIR|WORK_TREE|INDEX_FILE|CONFIG.*)$/i.test(key)), []);
    }
    for (const call of calls.filter(call => call.args.includes('--get-regexp'))) { assert.ok(call.args.includes('--includes') && call.args.includes('--show-scope')); assert.equal(call.args.includes('--local'), false); }
    const status = calls.find(call => call.args.includes('status')).args;
    for (const setting of ['filter.x.clean=', 'filter.x.smudge=', 'filter.x.process=', 'filter.x.required=false', 'filter.p.clean=', 'filter.p.process=', 'filter.p.required=false']) assert.ok(status.includes(setting), setting);
    assert.ok(status.includes('--untracked-files=normal') && status.includes('--ignore-submodules=all'));
    assert.ok(status.includes('--no-renames'), 'rename detection would read objects a partial clone does not have');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('observeCheckout reads only the repository\'s own configuration, switches off every filter it defines, and refuses ones it cannot switch off', async () => {
  const root = await temporary();
  try {
    const calls = [], config = configRecord('local', 'remote.origin.url', 'https://github.com/acme/api') + configRecord('worktree', 'remote.wt.url', 'https://github.com/acme/wt') + configRecord('global', 'remote.g.url', 'https://github.com/g/g')
      + configRecord('system', 'remote.s.url', 'https://github.com/s/s') + configRecord('command', 'remote.c.url', 'https://github.com/c/c');
    const filters = configRecord('local', 'filter.x.clean', 'cmd') + configRecord('worktree', 'filter.my.drv.process', 'cmd') + configRecord('local', 'filter.x.required', 'true') + configRecord('global', 'filter.g.clean', 'cmd') + configRecord('command', 'filter.c.clean', 'cmd');
    const seen = valueOf(await observeCheckout(root, fakeGit({ top: root, config, filters, calls })));
    assert.deepEqual(seen.remotes, [{ name: 'origin', identity: 'github.com/acme/api' }, { name: 'wt', identity: 'github.com/acme/wt' }]);
    const status = calls.find(call => call.sub[0] === 'status').args, settings = status.filter((arg, at) => status[at - 1] === '-c' && arg.startsWith('filter.'));
    assert.deepEqual(settings.sort(), ['x', 'my.drv'].flatMap(name => [`filter.${name}.clean=`, `filter.${name}.smudge=`, `filter.${name}.process=`, `filter.${name}.required=false`]).sort());
    assert.ok(status.lastIndexOf('-c') < status.indexOf('-C'), 'overrides are given before the command');
    assert.deepEqual(calls.find(call => call.sub[0] === 'diff').args.filter(arg => arg.startsWith('filter.x.clean')), ['filter.x.clean=']);
    // Only the person's own configuration defines these, so nothing is switched off for them.
    const none = [];
    valueOf(await observeCheckout(root, fakeGit({ top: root, filters: configRecord('global', 'filter.g.clean', 'cmd'), calls: none })));
    assert.equal(none.find(call => call.sub[0] === 'status').args.some(arg => arg.startsWith('filter.')), false);
    // A name that cannot be given on a command line, or too many names, is refused in words and echoes nothing.
    for (const filtersOut of [configRecord('local', 'filter.a=b.clean', 'cmd'), Array.from({ length: 33 }, (_, n) => configRecord('local', `filter.f${n}.clean`, 'cmd')).join('')]) {
      const refused = await observeCheckout(root, fakeGit({ top: root, filters: filtersOut }));
      assert.equal(code(refused), 'CHECKOUT_UNAVAILABLE'); assert.match(refused.diagnostics[0].message, /content filters/); assert.equal(JSON.stringify(refused).includes('a=b'), false);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('observeCheckout refuses in words a person can act on: ownership, too many remotes, too many changes, a failed Git call', async () => {
  const { writeFile, truncate } = await import('node:fs/promises'), root = await temporary();
  try {
    const remotes = count => Array.from({ length: count }, (_, n) => configRecord('local', `remote.r${n}.url`, `https://github.com/a/r${n}`)).join('');
    assert.equal(valueOf(await observeCheckout(root, fakeGit({ top: root, config: remotes(32) }))).remotes.length, 32);
    const tooMany = await observeCheckout(root, fakeGit({ top: root, config: remotes(33) }));
    assert.equal(code(tooMany), 'CHECKOUT_UNAVAILABLE'); assert.equal(tooMany.diagnostics[0].message, 'The checkout has more than 32 remotes.');
    const dubious = () => ({ status: 128, stdout: '', stderr: "fatal: detected dubious ownership in repository at 'C:/secret/place'\nTo add an exception for this directory, call:\n\tgit config --global --add safe.directory C:/secret/place\n" });
    const owned = await observeCheckout(root, dubious);
    assert.equal(code(owned), 'CHECKOUT_UNAVAILABLE'); assert.equal(owned.diagnostics[0].message, 'Git refuses this folder because it is owned by another user (safe.directory).');
    assert.equal(JSON.stringify(owned).includes('secret'), false);
    assert.equal(code(await observeCheckout(root, () => ({ status: 128, stdout: '', stderr: 'fatal: not a git repository' }))), 'CHECKOUT_NOT_REPOSITORY');
    // A runner that answers with a promise is awaited like a synchronous one; a call that fails or throws is a refusal, never a crash.
    const asynchronous = fakeGit({ top: root });
    assert.equal(valueOf(await observeCheckout(root, async (...args) => asynchronous(...args))).revision, 'a'.repeat(40));
    const failing = after => (command, args, options) => args.includes(after) ? { status: 2, stdout: '', stderr: 'fatal: boom' } : fakeGit({ top: root })(command, args, options);
    for (const word of ['status', 'diff', 'config']) assert.equal((await observeCheckout(root, failing(word))).diagnostics[0].message, 'Git metadata could not be read for this folder.', word);
    assert.equal((await observeCheckout(root, () => { throw new Error('spawn exploded'); })).diagnostics[0].message, 'Git could not be run for this folder.');
    // Up to 2000 changed paths are identified; one more is refused (before any file is read), and so are more than 256 MiB of changed bytes.
    const paths = count => porcelain(...Array.from({ length: count }, (_, n) => `?? many/f${n}`));
    assert.equal(valueOf(await observeCheckout(root, fakeGit({ top: root, status: paths(2000) }))).workingState.clean, false);
    const crowded = await observeCheckout(root, fakeGit({ top: root, status: paths(2001) }));
    assert.equal(code(crowded), 'CHECKOUT_UNAVAILABLE'); assert.equal(crowded.diagnostics[0].message, 'Too many changed files, or more than 256 MiB of changed content, to identify the working state; commit, stash or ignore them, then inspect again.');
    // Output that overruns the buffer is the same refusal.
    for (const error of [{ code: 'ENOBUFS' }, { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }]) {
      const overrun = (command, args, options) => args.includes('status') ? { status: null, stdout: '', stderr: '', error } : fakeGit({ top: root })(command, args, options);
      assert.equal((await observeCheckout(root, overrun)).diagnostics[0].message, crowded.diagnostics[0].message);
    }
    await writeFile(join(root, 'big.bin'), ''); await truncate(join(root, 'big.bin'), 257 * 1024 * 1024);
    assert.equal((await observeCheckout(root, fakeGit({ top: root, status: porcelain('?? big.bin') }))).diagnostics[0].message, crowded.diagnostics[0].message);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the working state covers the content of changed files and what is staged, so editing a changed file or staging another version changes it', async () => {
  const { writeFile, symlink, mkdir: makeDir } = await import('node:fs/promises'), root = await temporary();
  try {
    const state = async (...entries) => valueOf(await observeCheckout(root, fakeGit({ top: root, status: porcelain(...entries) }))).workingState;
    await writeFile(join(root, 'a.txt'), 'one');
    const first = await state(' M a.txt');
    await writeFile(join(root, 'a.txt'), 'two');                           // the same status line, other bytes
    const second = await state(' M a.txt');
    assert.deepEqual([first.clean, second.clean], [false, false]); assert.notEqual(first.sha256, second.sha256);
    await writeFile(join(root, 'a.txt'), 'one'); assert.equal((await state(' M a.txt')).sha256, first.sha256, 'the same content is the same state');
    assert.equal((await state()).clean, true);
    // An untracked file, and a deleted one (listed, but nothing to read).
    await writeFile(join(root, 'u.txt'), 'aaa'); const u1 = await state('?? u.txt'); await writeFile(join(root, 'u.txt'), 'bbb'); assert.notEqual((await state('?? u.txt')).sha256, u1.sha256);
    assert.equal((await state(' D gone.txt')).clean, false); assert.notEqual((await state(' D gone.txt')).sha256, (await state(' D other.txt')).sha256);
    // A rename or copy entry is followed by its original path; that path is not a change of its own (`zzzc.txt` would otherwise read as `c.txt`).
    await writeFile(join(root, 'b.txt'), 'b1'); await writeFile(join(root, 'c.txt'), 'c1');
    for (const kind of ['R ', ' R', 'C ']) {
      const entry = `${kind} b.txt`, renamed = await state(entry, 'zzzc.txt'), before = renamed.sha256;
      await writeFile(join(root, 'c.txt'), 'c2'); assert.equal((await state(entry, 'zzzc.txt')).sha256, before, kind); await writeFile(join(root, 'c.txt'), 'c1');
      await writeFile(join(root, 'b.txt'), 'b2'); assert.notEqual((await state(entry, 'zzzc.txt')).sha256, before, kind); await writeFile(join(root, 'b.txt'), 'b1');
    }
    // Staged changes: the same worktree bytes and the same status line, but another staged blob, is another state. Before the first commit the index itself is read.
    const staged = async (output, options = {}) => { const calls = []; const seen = valueOf(await observeCheckout(root, fakeGit({ top: root, status: porcelain('MM a.txt'), staged: Buffer.from(output), calls, ...options }))).workingState; return { seen, calls }; };
    const raw = blob => `:100644 100644 ${'1'.repeat(40)} ${blob.repeat(40)} M\0a.txt\0`;
    const one = await staged(raw('2')), again = await staged(raw('2')), other = await staged(raw('3')), mode = await staged(raw('2').replace('100644 100644', '100644 100755'));
    assert.equal(one.seen.sha256, again.seen.sha256); assert.notEqual(one.seen.sha256, other.seen.sha256); assert.notEqual(one.seen.sha256, mode.seen.sha256);
    const diff = one.calls.find(call => call.sub[0] === 'diff').sub;
    assert.deepEqual(diff.slice(0, 5), ['diff', '--cached', '--raw', '-z', '--no-renames']); assert.ok(diff.includes('--abbrev=40') && diff.includes('HEAD'));
    const unborn = await staged(`100644 ${'2'.repeat(40)} 0\ta.txt\0`, { unborn: true }), unbornOther = await staged(`100644 ${'3'.repeat(40)} 0\ta.txt\0`, { unborn: true });
    assert.deepEqual(unborn.calls.find(call => call.sub[0] === 'ls-files').sub, ['ls-files', '-s', '-z']); assert.equal(unborn.calls.some(call => call.sub[0] === 'diff'), false);
    assert.notEqual(unborn.seen.sha256, unbornOther.seen.sha256);
    // A symlink digests its target string and is never followed; so is a path below a link that leaves the checkout. Without the privilege to make
    // links the symlink assertions are skipped, never weakened.
    const outside = join(root, 'outside'); await makeDir(outside); await writeFile(join(outside, 'file.txt'), 'secret'); await makeDir(join(root, 'work'));
    const checkout = join(root, 'work');
    const inside = async (...entries) => valueOf(await observeCheckout(checkout, fakeGit({ top: checkout, status: porcelain(...entries) }))).workingState;
    try {
      await symlink(join(outside, 'file.txt'), join(checkout, 'link'), 'file'); const l1 = await inside('?? link');
      await writeFile(join(outside, 'file.txt'), 'changed elsewhere'); assert.equal((await inside('?? link')).sha256, l1.sha256, 'the target of a link is not read');
      await rm(join(checkout, 'link')); await symlink(join(outside, 'other.txt'), join(checkout, 'link'), 'file'); assert.notEqual((await inside('?? link')).sha256, l1.sha256, 'another target is a change');
      await symlink(outside, join(checkout, 'door'), process.platform === 'win32' ? 'junction' : 'dir'); const d1 = await inside('?? door/file.txt');
      await writeFile(join(outside, 'file.txt'), 'changed again'); assert.equal((await inside('?? door/file.txt')).sha256, d1.sha256, 'a path that leaves the checkout is not read');
    } catch (error) { if (!['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) throw error; }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('an untracked folder is one entry that digests the paths and contents of its files, and a big folder can still be bound', async () => {
  const { writeFile, utimes, mkdir: makeDir } = await import('node:fs/promises'), root = await temporary();
  try {
    const state = async (options, ...entries) => valueOf(await observeCheckout(root, fakeGit({ top: root, status: porcelain(...entries) }), options)).workingState;
    // Two thousand and a hundred files below one untracked folder (more than the changed-path limit) are one entry: observing works.
    const build = join(root, 'build'); await makeDir(join(build, 'deep'), { recursive: true });
    await Promise.all(Array.from({ length: 2100 }, (_, n) => writeFile(join(n % 2 === 0 ? build : join(build, 'deep'), `f${n}.o`), 'x')));
    const big = await state({}, '?? build/');
    assert.equal(big.clean, false);
    assert.equal((await state({}, '?? build/')).sha256, big.sha256, 'the same listing is the same state');
    // Same size and time but other bytes is a change: the listing digests content. A new file is a change; a different time alone is not.
    const old = new Date('2020-01-01T00:00:00Z'), small = join(root, 'small'); await makeDir(join(small, 'deep'), { recursive: true });
    const stamp = async (name, text, date = old) => { await writeFile(join(small, name), text); await utimes(join(small, name), date, date); };
    await stamp('f0.o', 'x'); await stamp('deep/f1.o', 'x');
    const first = await state({}, '?? small/');
    await stamp('f0.o', 'y'); assert.notEqual((await state({}, '?? small/')).sha256, first.sha256, 'content inside an untracked folder counts');
    await stamp('f0.o', 'yy'); const longer = await state({}, '?? small/'); assert.notEqual(longer.sha256, first.sha256);
    await stamp('f0.o', 'yy', new Date('2021-01-01T00:00:00Z')); const later = await state({}, '?? small/'); assert.equal(later.sha256, longer.sha256, 'touching a file changes nothing');
    await stamp('deep/new.o', 'x'); assert.notEqual((await state({}, '?? small/')).sha256, later.sha256);
    // A file at the top of the checkout keeps its content digest, and a nested `.git` is not listed.
    await writeFile(join(root, 'top.txt'), 'one'); const t1 = await state({}, '?? top.txt'); await writeFile(join(root, 'top.txt'), 'two'); assert.notEqual((await state({}, '?? top.txt')).sha256, t1.sha256);
    await makeDir(join(root, 'nested', '.git'), { recursive: true }); await writeFile(join(root, 'nested', 'a.txt'), 'a'); const n1 = await state({}, '?? nested/');
    await writeFile(join(root, 'nested', '.git', 'HEAD'), 'ref'); assert.equal((await state({}, '?? nested/')).sha256, n1.sha256);
    // More than the limit of listed files is the usual refusal; the limit (20000) is lowered here so the folder stays small.
    const limited = await observeCheckout(root, fakeGit({ top: root, status: porcelain('?? build/') }), { listedEntries: 2100 });
    assert.equal(code(limited), 'CHECKOUT_UNAVAILABLE'); assert.equal(limited.diagnostics[0].message, 'Too many changed files, or more than 256 MiB of changed content, to identify the working state; commit, stash or ignore them, then inspect again.');
    assert.equal((await observeCheckout(root, fakeGit({ top: root, status: porcelain('?? build/') }), { listedEntries: 2101 })).status, 'ok');
  } finally { await rm(root, { recursive: true, force: true }); }
});


// ---- 9. Service operations --------------------------------------------------------------------------------------------
test('mixed service: an ordinary saved policy becomes a draft on workspace-edit; bind returns the draft; export has no bindings', async () => {
  const s = await shared(), inspected = [];
  const fake = root => { inspected.push(root); return { status: 'ok', diagnostics: [], value: observation({ root }) }; };
  const service = await createMixedService(s.maintained, { observeCheckout: fake });
  const policy = [...s.policyBytes];
  assert.equal(valueOf(await service.run('workspace-read', { bytes: policy })).workspace, null);
  const declared = valueOf(await service.run('workspace-edit', { bytes: policy, operation: { type: 'declare', label: 'Shop' } }));
  assert.equal(declared.draft.editing, 'available'); assert.deepEqual(declared.draft.savedIntentBytes, s.policyBytes);
  assert.equal(declared.projection.workspace.label, 'Shop'); assert.ok(declared.draft.envelope.records.some(r => r.schema === WORKSPACE_DECLARATION_SCHEMA));
  let bytes = [...declared.draft.envelopeBytes];
  bytes = [...valueOf(await service.run('workspace-edit', { envelopeBytes: bytes, operation: { type: 'set-member', member: API } })).draft.envelopeBytes];
  const planned = valueOf(await service.run('workspace-plan', { envelopeBytes: bytes, memberId: 'api', root: '/work/api' }));
  assert.deepEqual([planned.outcome, planned.reasons], ['ready', []]); assert.deepEqual(inspected, ['/work/api']);
  const bound = valueOf(await service.run('workspace-bind', { envelopeBytes: bytes, memberId: 'api', root: '/work/api' }));
  assert.deepEqual(inspected, ['/work/api', '/work/api']); // each bind re-observes freshly
  assert.equal(bound.draft.editing, 'available'); assert.equal(bound.projection.members[0].bindings.length, 1);
  bytes = [...bound.draft.envelopeBytes];
  const verified = valueOf(await service.run('workspace-verify', { envelopeBytes: bytes }));
  const [bindingId] = Object.keys(verified.statuses);
  assert.equal(verified.statuses[bindingId].status, 'current'); assert.equal(inspected.at(-1), '/work/api'); assert.equal(verified.projection.members[0].bindings[0].status, 'current');
  const exported = valueOf(await service.run('workspace-export', { envelopeBytes: bytes }));
  assert.deepEqual(exported.excluded, { bindings: 1, batches: 0, unknownRecords: 0 });
  assert.equal(decode(Uint8Array.from(exported.envelopeBytes)).includes('/work/api'), false); assert.equal(decode(Uint8Array.from(exported.envelopeBytes)).includes(LOCAL_BINDING_SCHEMA), false);
  assert.equal('draft' in exported, false);
  const unbound = valueOf(await service.run('workspace-unbind', { envelopeBytes: bytes, bindingId }));
  assert.equal(unbound.projection.bindings, 0); assert.equal(unbound.draft.editing, 'available');
  // A refusal from the host stays a refusal; a confirmation request needs the plan's digest.
  const refusing = await createMixedService(s.maintained, { observeCheckout: () => ({ status: 'refused', diagnostics: [{ code: 'CHECKOUT_NOT_REPOSITORY', path: '/root', message: 'no' }] }) });
  assert.equal(code(await refusing.run('workspace-plan', { envelopeBytes: bytes, memberId: 'api', root: '/x/y' })), 'CHECKOUT_NOT_REPOSITORY');
  const noHost = await createMixedService(s.maintained);
  assert.equal(code(await noHost.run('workspace-bind', { envelopeBytes: bytes, memberId: 'api', root: '/work/api' })), 'CHECKOUT_UNAVAILABLE');
  assert.equal((await noHost.run('workspace-read', { envelopeBytes: bytes })).status, 'ok');
  assert.equal(code(await service.run('workspace-plan', { envelopeBytes: bytes, memberId: 'api', root: 7 })), 'INPUT_INVALID');
  assert.equal(code(await service.run('workspace-edit', { operation: { type: 'declare' } })), 'INPUT_INVALID');
  const fork = await createMixedService(s.maintained, { observeCheckout: root => ({ status: 'ok', diagnostics: [], value: observation({ root, remotes: [['origin', 'https://github.com/someone/api']] }) }) });
  const forkPlan = valueOf(await fork.run('workspace-plan', { envelopeBytes: bytes, memberId: 'api', root: '/work/fork' }));
  assert.deepEqual([forkPlan.outcome, forkPlan.reasons], ['confirm', ['additional-checkout', 'fork']]);
  assert.equal(code(await fork.run('workspace-bind', { envelopeBytes: bytes, memberId: 'api', root: '/work/fork' })), 'WORKSPACE_CONFIRMATION_REQUIRED');
  const forkBound = valueOf(await fork.run('workspace-bind', { envelopeBytes: bytes, memberId: 'api', root: '/work/fork', confirmation: { observationSha256: forkPlan.observationSha256, reasons: ['additional-checkout', 'fork'] } }));
  assert.equal(forkBound.projection.members[0].bindings.find(b => b.checkout.root === '/work/fork').verification.result, 'confirmed');
});

// ---- Shipped schemas ------------------------------------------------------------------------------------------------
test('shipped workspace schemas agree structurally with the runtime records and their patterns accept what the runtime accepts', async t => {
  let declarationSchema, bindingSchema, journey;
  for (const base of ['../../schemas/', '../schemas/']) {
    try {
      declarationSchema = JSON.parse(await readFile(new URL(`${base}journey-record-workspace-declaration-1.0.0.json`, import.meta.url), 'utf8'));
      bindingSchema = JSON.parse(await readFile(new URL(`${base}journey-record-local-binding-1.0.0.json`, import.meta.url), 'utf8'));
      journey = JSON.parse(await readFile(new URL(`${base}journey-envelope-1.0.0.json`, import.meta.url), 'utf8'));
      break;
    } catch { /* try next layout */ }
  }
  if (!declarationSchema) return t.skip('schema file is not present in this consumer layout; tools/write-authoring-schemas.mjs --check verifies it');
  let bytes = await declared();
  bytes = (await edit(bytes, { type: 'set-member', member: { id: 'docs', identity: 'github.com/acme/docs', responsibilities: { status: 'known', values: ['Docs'] }, instructions: { status: 'known', locations: ['AGENTS.md'] },
    contracts: { status: 'known', references: ['openapi/a.yaml', 'urn:acme:c:1'] } } })).envelopeBytes;
  bytes = (await edit(bytes, { type: 'set-relationship', relationship: { from: 'ui', to: 'api', kind: 'consumes-api', provenance: { kind: 'contract', ref: 'openapi/a.yaml' } } })).envelopeBytes;
  bytes = (await edit(bytes, { type: 'suggest-relationship', relationship: { from: 'docs', to: 'api', kind: 'depends-on', reason: 'Mentioned together.' } })).envelopeBytes;
  bytes = (await bind(bytes, 'api', observation())).envelopeBytes;
  const [declaration] = recordsOf(bytes, 'workspace-declaration'), [binding] = recordsOf(bytes, 'local-binding');
  for (const [schema, urn] of [[declarationSchema, WORKSPACE_DECLARATION_SCHEMA], [bindingSchema, LOCAL_BINDING_SCHEMA]]) {
    assert.equal(schema.$id, urn); assert.equal(schema.properties.schema.const, urn); assert.equal(schema.additionalProperties, false); assert.equal(schema.properties.required.const, false);
  }
  assert.deepEqual(Object.keys(declarationSchema.properties).sort(), Object.keys(declaration).sort()); assert.deepEqual([...declarationSchema.required].sort(), Object.keys(declaration).sort());
  assert.deepEqual(Object.keys(bindingSchema.properties).sort(), [...Object.keys(binding), 'replaces'].sort()); assert.deepEqual([...bindingSchema.required].sort(), Object.keys(binding).sort());
  assert.equal(declarationSchema.properties.id.const, declaration.id);
  assert.match(binding.id, new RegExp(bindingSchema.properties.id.pattern)); assert.match(declaration.workspace.id, new RegExp(declarationSchema.properties.workspace.properties.id.pattern));
  assert.match(declaration.revision, new RegExp(declarationSchema.properties.revision.pattern));
  const member = declarationSchema.properties.members.items, relationships = declarationSchema.properties.relationships;
  assert.deepEqual([...member.required].sort(), ['aliases', 'contracts', 'id', 'identity', 'instructions', 'responsibilities']); assert.deepEqual(Object.keys(member.properties).sort(), [...member.required, 'label'].sort());
  assert.deepEqual(relationships.required, ['status', 'confirmed', 'suggested']); assert.deepEqual(relationships.properties.status.enum, ['unresolved', 'complete']);
  const confirmed = relationships.properties.confirmed.items, suggested = relationships.properties.suggested.items, [edge] = declaration.relationships.confirmed, [idea] = declaration.relationships.suggested;
  assert.deepEqual([...confirmed.required].sort(), Object.keys(edge).sort()); assert.deepEqual([...suggested.required].sort(), Object.keys(idea).sort());
  assert.deepEqual([...confirmed.properties.provenance.required].sort(), ['kind', 'recordedAt']); assert.deepEqual(Object.keys(confirmed.properties.provenance.properties).sort(), ['kind', 'recordedAt', 'ref']);
  assert.deepEqual(confirmed.properties.kind.enum, ['depends-on', 'consumes-api', 'deploys', 'shares-contract']);
  assert.match(edge.id, new RegExp(confirmed.properties.id.pattern)); assert.match(edge.provenance.recordedAt, new RegExp(confirmed.properties.provenance.properties.recordedAt.pattern));
  for (const entry of declaration.members) { assert.match(entry.id, new RegExp(member.properties.id.pattern)); assert.match(entry.identity, new RegExp(member.properties.identity.pattern)); }
  const observed = bindingSchema.properties.observed;
  assert.deepEqual([...observed.required].sort(), ['remotes', 'repository', 'revision', 'workingState', 'worktree']); assert.deepEqual(Object.keys(observed.properties).sort(), [...Object.keys(binding.observed)].sort());
  assert.deepEqual([...bindingSchema.properties.verification.required].sort(), Object.keys(binding.verification).sort());
  assert.deepEqual(bindingSchema.properties.verification.properties.reasons.items.enum, ['additional-checkout', 'ambiguous-remote', 'fork', 'moved', 'no-remote', 'similar-name']);
  assert.deepEqual(observed.properties.worktree.properties.kind.enum, ['main', 'linked']);
  assert.match(binding.observed.revision, new RegExp(observed.properties.revision.oneOf[0].pattern));
  // The path, identity and root patterns accept and refuse the same values as the runtime.
  const pathPattern = new RegExp(member.properties.instructions.oneOf[1].properties.locations.items.pattern), rootPattern = new RegExp(bindingSchema.properties.checkout.properties.root.pattern);
  for (const path of ['AGENTS.md', 'docs/agents/api.md', '.github/x.md', 'a.b/c']) assert.match(path, pathPattern, path);
  for (const path of ['/AGENTS.md', '\\AGENTS.md', 'C:AGENTS.md', '~x', '../x', 'a/../b', './a', 'a//b', 'a/', 'a\\b']) assert.doesNotMatch(path, pathPattern, path);
  for (const root of ['C:\\Users\\a\\b', 'c:/work/b', '\\\\server\\share\\b', '/home/a/b']) assert.match(root, rootPattern, root);
  for (const root of ['relative/path', 'work', '']) assert.doesNotMatch(root, rootPattern, root);
  const identityPattern = new RegExp(member.properties.identity.pattern);
  for (const identity of ['github.com/acme/api', 'gitlab.example.com/Group/Sub/Repo']) assert.match(identity, identityPattern, identity);
  for (const identity of ['github.com/acme', 'GitHub.com/acme/api', 'github.com/acme/api.git/', 'github.com//api', 'C:\\repo']) assert.doesNotMatch(identity, identityPattern, identity);
  const rules = journey.properties.records.items.allOf.map(rule => [rule.if.properties.schema.const, rule.then.$ref]);
  for (const urn of [WORKSPACE_DECLARATION_SCHEMA, LOCAL_BINDING_SCHEMA]) assert.ok(rules.some(([a, b]) => a === urn && b === urn), urn);
});

// ---- 10. Boundaries --------------------------------------------------------------------------------------------------
test('the pure modules import only the allowed seams and contain no network, process, timer or random calls; the public entry is small', async () => {
  const allowed = [/^\.\/intake\.mjs$/, /^\.\/journey\.mjs$/, /^\.\/headless\.mjs$/, /^\.\/maintenance-record\.mjs$/, /^\.\/workspace-record\.mjs$/];
  for (const name of ['workspace-record.mjs', 'workspace.mjs']) {
    const source = await readFile(new URL(`./${name}`, import.meta.url), 'utf8');
    const specifiers = [...source.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s+'([^']+)'/gm)].map(match => match[1]);
    assert.ok(specifiers.length > 0, name);
    for (const specifier of specifiers) assert.ok(allowed.some(pattern => pattern.test(specifier)), `${name} imports ${specifier}`);
    assert.equal(/\bimport\s*\(/.test(source), false, `${name} dynamic import`);
    for (const forbidden of [/fetch\(/, /node:/, /child_process/, /process\./, /Math\.random/, /setTimeout/, /setInterval/, /Date\.now/, /new Date\(\)/, /\bBuffer\b/, /\bwindow\b/, /\bdocument\b/, /localStorage/, /WebSocket/, /XMLHttpRequest/])
      assert.doesNotMatch(source, forbidden, `${name} ${forbidden}`);
  }
  const host = await readFile(new URL('./workspace-host.mjs', import.meta.url), 'utf8');
  assert.match(host, /windowsHide: true/); assert.doesNotMatch(host, /fetch\(|shell: true|(?<![.\w])exec\(|execSync|spawnSync|GIT_ASKPASS|['"]push['"]|['"]fetch['"]|['"]pull['"]|['"]clone['"]/);
  assert.deepEqual(Object.keys(publicApi).sort(), ['BINDING_REASONS', 'LOCAL_BINDING_SCHEMA', 'RELATIONSHIP_KINDS', 'WORKSPACE_DECLARATION_SCHEMA', 'bindCheckout', 'editWorkspace', 'exportWorkspace', 'planBinding',
    'projectWorkspace', 'readWorkspace', 'remoteIdentity', 'sameIdentity', 'unbindCheckout', 'validateBinding', 'validateDeclaration', 'verifyBindings']);
});

test('no operation touches a folder, the network, a timer or the clock: the module is pure over bytes and observations', async () => {
  const s = await shared(), calls = [];
  const { fetch: realFetch, setTimeout: realTimeout } = globalThis;
  globalThis.fetch = (...args) => { calls.push('fetch'); return realFetch(...args); };
  globalThis.setTimeout = (...args) => { calls.push('setTimeout'); return realTimeout(...args); };
  try {
    let bytes = await declared();
    bytes = (await bind(bytes, 'api', observation())).envelopeBytes;
    await plan(bytes, 'ui', observation({ root: '/x', remotes: [['origin', 'https://github.com/acme/ui']] }));
    valueOf(await verifyBindings({ envelopeBytes: bytes, observations: {} })); valueOf(await exportWorkspace({ envelopeBytes: bytes })); valueOf(await readWorkspace({ envelopeBytes: bytes }));
  } finally { globalThis.fetch = realFetch; globalThis.setTimeout = realTimeout; }
  assert.deepEqual(calls, []);
  assert.ok(s);
});

test('an unmerged checkout is refused, because its conflict stages are not identified', async () => {
  const root = await temporary();
  try {
    for (const entry of ['UU a.txt', 'AA a.txt', 'DU a.txt']) {
      const refused = await observeCheckout(root, fakeGit({ top: root, status: porcelain(entry) }));
      assert.equal(code(refused), 'CHECKOUT_UNAVAILABLE', entry);
      assert.equal(refused.diagnostics[0].message, 'The checkout has unresolved merge conflicts; resolve them, then inspect again.');
    }
    assert.equal((await observeCheckout(root, fakeGit({ top: root, status: porcelain('MM a.txt') }))).status, 'ok');
  } finally { await rm(root, { recursive: true, force: true }); }
});
