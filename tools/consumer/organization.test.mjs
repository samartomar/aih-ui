import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveRecipeIdentity } from '@aihq/core/contracts';
import { previewPolicyAuthority } from './organization.mjs';
import { createHost } from './host.mjs';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { organizationFixture } from './organization-fixture.mjs';
const recipe = id => ({ schema: 'urn:aihq:core:recipe:1.3.0', id, description: 'Authored authority boundary fixture', inputs: { directory: { type: 'string', required: true } }, materials: [], targets: ['project'], prerequisites: [], operations: [{ id: 'write', purpose: 'Write fixture', kind: 'file.write', scope: 'project', target: { root: 'project', segments: [{ literal: `${id}.txt` }] }, content: { input: 'directory' }, requires: [], checks: [] }], checks: [] });
const selection = id => ({ id, managementId: id, organizationSelectionId: `team-${id}`, scope: 'project', configuration: { directory: '.claude' }, requires: [], recipe: { inline: recipe(id) } });
const policy = { schema: 'urn:aihq:core:execution-policy:1.3.0', mode: 'enterprise', selections: [selection('a'), selection('b')] };
async function authority() {
  return { schema: 'urn:aihq:core:organization-policy:1.0.0', id: 'team', selections: await Promise.all(policy.selections.map(async s => ({ selectionId: s.organizationSelectionId, recipeIdentity: (await deriveRecipeIdentity({ recipe: s.recipe.inline })).value.recipeIdentity, scopes: ['project'], inputs: { directory: { fixed: '.claude' } }, lifecycle: { replace: true, remove: true } }))) };
}
test('one changed allowance affects only its selection and keeps advisory outcomes separate', async () => {
  const organization = await authority();
  const admitted = await previewPolicyAuthority({ policy, organization });
  assert.equal(admitted.status, 'ok'); assert.equal(admitted.value.admitted, true);
  organization.selections[0].inputs.directory.fixed = '.other';
  const denied = await previewPolicyAuthority({ policy, organization });
  assert.equal(denied.value.admitted, false);
  assert.deepEqual(denied.value.affectedChoices.map(s => s.id), ['a']);
  assert.deepEqual(denied.value.stillValidChoices.map(s => s.id), ['b']);
  assert.equal(denied.value.advisory, true);
  assert.ok(denied.value.affectedChoices[0].diagnostics.some(d => d.reason === 'input-value'));
  assert.equal(policy.selections[0].configuration.directory, '.claude');
});

test('changing one organization root identity preserves the separate authority identities of its dependencies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ui6-origins-'));
  const f = await organizationFixture(root);
  const result = await previewPolicyAuthority({ policy: f.updated.policy, organization: f.documents.recovery, recipeMaterials: f.recipeMaterials });
  assert.equal(result.status, 'ok');
  assert.equal(result.value.admitted, true, JSON.stringify(result));
  const prior = f.policy.selections.find(s => s.recipe.reference.path.includes('mattpocock.domain-modeling'));
  const next = f.updated.policy.selections.find(s => s.recipe.reference.path.includes('mattpocock.domain-modeling'));
  assert.equal(next.organizationSelectionId, prior.organizationSelectionId);
});

test('host refresh never uses imported provenance or cached admission when authority is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  const source = { provider: 'github', repository: { owner: 'fixture', name: 'authority' }, path: 'org.json', revision: { kind: 'branch', value: 'main' } };
  let document = await authority(), available = true, commit = 'a'.repeat(40);
  // External HTTP boundary only; public Harness reader/Core validators remain real.
  globalThis.fetch = async url => {
    assert.equal(new URL(url).origin, 'https://api.github.com');
    assert.ok(new URL(url).pathname.startsWith('/repos/fixture/authority/'));
    if (!available) return Response.json({ message: 'Fixture unavailable' }, { status: 404 });
    const bytes = Buffer.from(JSON.stringify(document));
    const blob = createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex');
    const path = new URL(url).pathname;
    const data = path.includes('/blobs/') ? { sha: blob, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') }
      : path.includes('/trees/') ? { sha: 'b'.repeat(40), truncated: false, tree: [{ path: 'org.json', mode: '100644', type: 'blob', sha: blob, size: bytes.length }] }
      : path.includes('/commits/') ? { sha: commit, tree: { sha: 'b'.repeat(40) } }
      : { ref: 'refs/heads/main', object: { type: 'commit', sha: commit } };
    return Response.json(data);
  };
  try {
    const projectRoot = await mkdtemp(join(tmpdir(), 'ui6-host-'));
    const host = createHost({ projectRoot, organizationSource: source, controls: { logging: 'off' } });
    const policyText = JSON.stringify({ ...policy, metadata: { provenance: { repository: 'attacker/authority' } } });
    const first = await host.inspectAuthority({ policyText });
    assert.equal(first.status, 'ok', JSON.stringify(first)); assert.equal(first.value.admitted, true);
    assert.equal(first.value.authority.source.repository.owner, 'fixture');
    const ready = await host.prepareSession({ policyText }); assert.equal(ready.status, 'ready', JSON.stringify(ready));
    document.selections.shift(); commit = 'c'.repeat(40);
    const withdrawn = await host.inspectAuthority({ policyText });
    assert.deepEqual(withdrawn.value.affectedChoices.map(s => s.id), ['a']);
    assert.deepEqual(withdrawn.value.stillValidChoices.map(s => s.id), ['b']);
    const stale = await host.applyApproved({ sessionId: ready.sessionId, reviewDigest: ready.review.reviewDigest });
    assert.equal(stale.completion, 'rejected'); assert.ok(stale.diagnostics.some(d => d.code === 'REVIEW_STALE'));
    await assert.rejects(readFile(join(projectRoot, 'a.txt')), { code: 'ENOENT' });
    available = false;
    const unavailable = await host.inspectAuthority({ policyText });
    assert.equal(unavailable.status, 'refused'); assert.equal(unavailable.diagnostics[0].code, 'AUTHORITY_UNAVAILABLE');
    const blocked = await host.prepareSession({ policyText }); assert.equal(blocked.status, 'blocked');
    assert.ok(blocked.diagnostics.some(d => d.code === 'AUTHORITY_UNAVAILABLE'));
  } finally { globalThis.fetch = originalFetch; }
});
