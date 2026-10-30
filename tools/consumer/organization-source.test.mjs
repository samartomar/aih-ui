// The host-side step that connects an Enterprise setup's policy repository to the organisation source the host reads.
// The browser names only the file path and branch; the repository comes from the saved setup, and the host saves the
// source and reads it through Core's GitHub reader. GitHub is the controlled in-process fixture: no real network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startConsumer } from './server.mjs';
import { createGitHubFixture } from './github-fixture.mjs';

const SETTINGS = { format: 'aih-ui-settings', version: 1, experience: 'enterprise', role: 'admin', capabilities: [], clients: ['claude'],
  organization: { name: 'Gosam', shortId: 'gosam', policyRepo: 'https://github.com/samartomar/test', emails: ['owner@example.invalid'] }, reviewer: { kind: 'individual', id: 'Owner' } };
const TOKEN = 'ghp_fixture-token-never-shown';

async function withHost(t, { controls, organizationSource } = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'aih-organization-source-'));
  const setupSettingsPath = join(folder, 'settings.json');
  await writeFile(setupSettingsPath, JSON.stringify(SETTINGS));
  const started = await startConsumer({ setupSettingsPath, controls: { logging: 'off', ...controls }, ...(organizationSource ? { organizationSource } : {}) });
  t.after(async () => { await new Promise(resolve => started.server.close(resolve)); await rm(folder, { recursive: true, force: true }); });
  const post = async (operation, body = {}) => (await fetch(`${started.origin}/api/authoring-${operation}`, { method: 'POST',
    headers: { 'content-type': 'application/json', origin: started.origin, 'x-aih-client': 'organization-source-test' }, body: JSON.stringify(body) })).json();
  return { started, post, file: join(folder, 'organization-source.json') };
}
const fixtureFor = path => createGitHubFixture({ owner: 'samartomar', name: 'test', path, ref: 'main' });

test('an Enterprise setup with a policy repository is asked once for the file and branch, with the export\'s defaults', async t => {
  const { post } = await withHost(t);
  const asked = await post('organization-source', {});
  assert.equal(asked.status, 'not-configured');
  assert.deepEqual(asked.request, { repository: 'samartomar/test', path: 'gosam.organization-policy.json', branch: 'main' });
});

test('the host saves the source from the setup\'s repository and reads it through Core: read', async t => {
  const fixture = fixtureFor('gosam.organization-policy.json'); fixture.install(); t.after(() => fixture.restore());
  fixture.publish({ schema: 'urn:aihq:core:organization-policy:1.1.0', id: 'gosam-baseline', selections: [] });
  const { post, file } = await withHost(t, { controls: { authentication: { kind: 'bearer', token: TOKEN } } });
  // Anything else the browser sends about where to read is ignored: the repository is the saved setup's.
  const saved = await post('organization-source', { path: 'gosam.organization-policy.json', branch: 'main', repository: { owner: 'attacker', name: 'evil' }, provider: 'local' });
  assert.equal(saved.status, 'read', JSON.stringify(saved));
  assert.equal(saved.policyId, 'gosam-baseline');
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { provider: 'github', repository: { owner: 'samartomar', name: 'test' }, path: 'gosam.organization-policy.json', revision: { kind: 'branch', value: 'main' } });
  assert.ok(fixture.requests.length && fixture.requests.every(path => path.startsWith('/repos/samartomar/test/')), fixture.requests.join(', '));
  assert.ok(!JSON.stringify(saved).includes(TOKEN) && !(await readFile(file, 'utf8')).includes(TOKEN), 'the token is never stored or shown');
  // It is now the host's configured source: the authority read and an Enterprise browse use it.
  const authority = await post('authority-source');
  assert.equal(authority.status, 'ok', JSON.stringify(authority));
  assert.equal((await post('organization-source', {})).status, 'read', 'asked only once');
});

test('a file that is not there reads "not found"; a repository the host cannot read reads "no access"', async t => {
  const fixture = fixtureFor('gosam.organization-policy.json'); fixture.install(); t.after(() => fixture.restore());
  const { post } = await withHost(t);
  const missing = await post('organization-source', { path: 'policies/missing.json', branch: 'main' });
  assert.equal(missing.status, 'not-found', JSON.stringify(missing));
  fixture.restore();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => new URL(typeof input === 'string' || input instanceof URL ? input : input.url).origin === 'https://api.github.com'
    ? Response.json({ message: 'Requires authentication' }, { status: 401 }) : realFetch(input, options);
  t.after(() => { globalThis.fetch = realFetch; });
  const denied = await post('organization-source', { path: 'gosam.organization-policy.json', branch: 'main' });
  assert.equal(denied.status, 'no-access', JSON.stringify(denied));
});

test('a path or branch that is not a plain file and ref is refused, and a source the host configuration names cannot be replaced', async t => {
  const { post, file } = await withHost(t);
  for (const body of [{ path: '../secrets.json', branch: 'main' }, { path: 'org/policy.txt', branch: 'main' }, { path: 'org/policy.json', branch: 'main;rm' }]) {
    const refused = await post('organization-source', body);
    assert.equal(refused.status, 'refused', JSON.stringify(refused));
  }
  assert.equal(existsSync(file), false, 'nothing was saved');
  const configured = await withHost(t, { organizationSource: { provider: 'local', path: join(tmpdir(), 'organization.json') } });
  const fixed = await configured.post('organization-source', { path: 'gosam.organization-policy.json', branch: 'main' });
  assert.equal(fixed.status, 'refused');
  assert.match(fixed.diagnostics[0].message, /^The Workbench host already names its organization policy source in its own configuration\./);
  assert.doesNotMatch(fixed.diagnostics[0].message, /AIH_/, 'host configuration is named only in the README');
});
