import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startConsumer } from './server.mjs';
import { createHost } from './host.mjs';
import { readAuthoritySource } from './authority-source.mjs';
import { createGitHubFixture, enterpriseFixture } from './github-fixture.mjs';
const attacker = { provider: 'github', repository: { owner: 'attacker', name: 'redirect' }, path: 'evil.json', revision: { kind: 'branch', value: 'evil' } };
const redirect = { organizationSource: attacker, source: attacker, repository: attacker.repository, path: attacker.path, revision: attacker.revision };
const revision = authority => Object.fromEntries(['resolvedCommit', 'blobId', 'contentDigest'].map(key => [key, authority[key]]));
async function post(started, operation, body = {}) {
  const response = await fetch(`${started.origin}/api/authoring-${operation}`, { method: 'POST', headers: { origin: started.origin, 'content-type': 'application/json', 'x-aih-client': 'authority-source-test' }, body: JSON.stringify(body) });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
function onlyFixture(fixture) {
  assert.ok(fixture.requests.length > 0);
  const base = `/repos/${fixture.source.repository.owner}/${fixture.source.repository.name}/git/`;
  for (const path of fixture.requests) assert.ok(path.startsWith(base), path);
  assert.ok(fixture.requests.some(path => path.includes('/blobs/')));
  assert.ok(!fixture.requests.some(path => /attacker|evil|redirect/.test(path)));
}
test('unconfigured source performs no GitHub reads, including without a project', async () => {
  const fixture = createGitHubFixture(); fixture.install();
  let started;
  try {
    assert.equal(typeof createHost, 'function');
    assert.equal((await readAuthoritySource()).status, 'not-configured');
    started = await startConsumer();
    assert.equal((await (await fetch(started.origin + '/api/authoring-catalog')).json()).organizationSource, null);
    assert.deepEqual(await post(started, 'authority-source', redirect), { status: 'not-configured', source: null, authority: null, diagnostics: [] });
    assert.deepEqual(fixture.requests, []);
  } finally { if (started) await new Promise(resolve => started.server.close(resolve)); fixture.restore(); }
});
test('source refresh pins host configuration and observes new commits without a project', async () => {
  const fixture = createGitHubFixture(); fixture.install();
  let started;
  try {
    started = await startConsumer({ organizationSource: fixture.source });
    const catalog = await (await fetch(started.origin + '/api/authoring-catalog')).json();
    assert.deepEqual(catalog.organizationSource, fixture.source); assert.equal(catalog.executionAvailable, false);
    const first = await post(started, 'authority-source');
    assert.equal(first.status, 'ok', JSON.stringify(first)); assert.deepEqual(first.source, fixture.source);
    for (const key of ['resolvedCommit', 'blobId', 'contentDigest', 'policyId', 'retrievedAt']) assert.ok(first.authority[key], key);
    const unchanged = await post(started, 'authority-source', redirect);
    assert.deepEqual(revision(unchanged.authority), revision(first.authority));
    const policyBytes = [...new TextEncoder().encode(JSON.stringify({ schema: 'urn:aihq:core:execution-policy:1.3.0', mode: 'enterprise', selections: [], metadata: redirect }))];
    const ignored = await post(started, 'authority-source', { ...redirect, policyBytes });
    assert.deepEqual(ignored.source, fixture.source); assert.deepEqual(revision(ignored.authority), revision(first.authority));
    fixture.publish({ schema: 'urn:aihq:core:organization-policy:1.0.0', id: 'controlled-organization-next', selections: [], metadata: redirect });
    const changed = await post(started, 'authority-source', redirect);
    assert.equal(changed.status, 'ok', JSON.stringify(changed)); assert.deepEqual(changed.source, fixture.source);
    for (const key of Object.keys(revision(first.authority))) assert.notEqual(changed.authority[key], first.authority[key], key);
    onlyFixture(fixture);
  } finally { if (started) await new Promise(resolve => started.server.close(resolve)); fixture.restore(); }
});
test('Enterprise authority and prepare ignore redirects; changed authority rejects stale Apply without writes', async () => {
  const fixture = createGitHubFixture(), projectRoot = await mkdtemp(join(tmpdir(), 'authority-source-'));
  const enterprise = await enterpriseFixture();
  const document = { ...enterprise.document, metadata: redirect }; fixture.publish(document); fixture.install();
  let started;
  try {
    started = await startConsumer({ organizationSource: fixture.source, projectRoot, controls: { logging: 'off' } });
    const policy = { ...enterprise.policy, metadata: { ...enterprise.policy.metadata, ...redirect } };
    const body = { ...redirect, policyBytes: [...new TextEncoder().encode(JSON.stringify(policy))] };
    const authority = await post(started, 'authority', body);
    assert.equal(authority.status, 'ok', JSON.stringify(authority)); assert.equal(authority.value.admitted, true);
    assert.deepEqual(authority.value.authority.source, fixture.source);
    const ready = await post(started, 'prepare', body);
    assert.equal(ready.status, 'ready', JSON.stringify(ready));
    assert.deepEqual(revision(ready.review.inputs.organization), revision(authority.value.authority));
    fixture.publish({ ...document, metadata: { ...redirect, changed: true } });
    const refreshed = await post(started, 'authority-source', redirect);
    assert.notEqual(refreshed.authority.resolvedCommit, ready.review.inputs.organization.resolvedCommit);
    const applied = await post(started, 'apply', { ...redirect, sessionId: ready.sessionId, reviewDigest: ready.review.reviewDigest });
    assert.equal(applied.completion, 'rejected', JSON.stringify(applied));
    assert.ok(applied.diagnostics.some(d => d.code === 'REVIEW_STALE'), JSON.stringify(applied));
    assert.deepEqual(await readdir(projectRoot, { recursive: true }), []);
    onlyFixture(fixture);
  } finally { if (started) await new Promise(resolve => started.server.close(resolve)); fixture.restore(); await rm(projectRoot, { recursive: true, force: true }); }
});
test('a local source reaches the page by its file name only, never its folder', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'authority-local-')), projectRoot = await mkdtemp(join(tmpdir(), 'authority-source-'));
  const enterprise = await enterpriseFixture(), path = join(folder, 'organization.json');
  await writeFile(path, JSON.stringify(enterprise.document));
  const local = { provider: 'local', path }, shown = { provider: 'local', fileName: 'organization.json' };
  const unreadable = { provider: 'local', path: join(folder, 'missing.json') };
  const started = [];
  try {
    const host = await startConsumer({ organizationSource: local, projectRoot, controls: { logging: 'off' } }); started.push(host);
    const policyBytes = [...new TextEncoder().encode(JSON.stringify(enterprise.policy))];
    const catalog = await (await fetch(host.origin + '/api/authoring-catalog')).json();
    const read = await post(host, 'authority-source'), authority = await post(host, 'authority', { policyBytes }), ready = await post(host, 'prepare', { policyBytes });
    assert.equal(read.status, 'ok', JSON.stringify(read)); assert.equal(authority.status, 'ok', JSON.stringify(authority)); assert.equal(ready.status, 'ready', JSON.stringify(ready));
    assert.deepEqual(catalog.organizationSource, shown); assert.deepEqual(read.source, shown); assert.deepEqual(read.authority.source, shown);
    assert.deepEqual(authority.value.authority.source, shown);
    for (const value of [catalog, read, authority, ready]) assert.ok(!JSON.stringify(value).includes(folder), JSON.stringify(value));
    const missing = await startConsumer({ organizationSource: unreadable, projectRoot, controls: { logging: 'off' } }); started.push(missing);
    const refused = await post(missing, 'authority-source'), refusedAuthority = await post(missing, 'authority', { policyBytes });
    assert.equal(refused.status, 'refused'); assert.equal(refusedAuthority.status, 'refused');
    assert.deepEqual(refused.source, { provider: 'local', fileName: 'missing.json' });
    for (const value of [refused, refusedAuthority]) assert.ok(!JSON.stringify(value).includes(folder), JSON.stringify(value));
  } finally {
    for (const host of started) await new Promise(resolve => host.server.close(resolve));
    await rm(folder, { recursive: true, force: true }); await rm(projectRoot, { recursive: true, force: true });
  }
});
test('Enterprise removal of one installed selection is prepared with a local source', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'authority-local-')), projectRoot = await mkdtemp(join(tmpdir(), 'authority-source-'));
  const enterprise = await enterpriseFixture(), path = join(folder, 'organization.json');
  await writeFile(path, JSON.stringify(enterprise.document));
  let started;
  try {
    started = await startConsumer({ organizationSource: { provider: 'local', path }, projectRoot, controls: { logging: 'off' } });
    const policyBytes = [...new TextEncoder().encode(JSON.stringify(enterprise.policy))];
    const ready = await post(started, 'prepare', { policyBytes });
    assert.equal(ready.status, 'ready', JSON.stringify(ready));
    const applied = await post(started, 'apply', { sessionId: ready.sessionId, reviewDigest: ready.review.reviewDigest });
    assert.equal(applied.completion, 'complete', JSON.stringify(applied));
    // The Policy drawer's "Review removal" names one managementId.
    const { managementId, scope } = enterprise.policy.selections[0];
    const removal = await post(started, 'remove', { managementId, scope, mode: 'enterprise' });
    assert.equal((removal.preparation ?? removal).status, 'ready', JSON.stringify(removal));
    assert.ok(!JSON.stringify(removal).includes(folder), JSON.stringify(removal));
  } finally {
    if (started) await new Promise(resolve => started.server.close(resolve));
    await rm(folder, { recursive: true, force: true }); await rm(projectRoot, { recursive: true, force: true });
  }
});
