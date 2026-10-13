// TEST FIXTURE ONLY: emulated GitHub organization transport. No live organization,
// credentials, publication or native client. Public Core still performs admission.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInstalledRelease } from '@aihq/catalog/node';
import { listItems } from '@aihq/catalog/reader';
import { parsePolicy } from '@aihq/core/contracts';
import { createHost } from './host.mjs';
import { authorOrganizationPolicy, deriveExecutionPolicy } from './fixture-admin.mjs';
const [policyPath, outputPath] = process.argv.slice(2);
if (!policyPath || !outputPath) throw new Error('Usage: node prove-enterprise-fixture.mjs policy.json new-output-directory');
const output = resolve(outputPath); await mkdir(output);
const target = join(output, 'project'); await mkdir(target);
const installed = await readInstalledRelease({ root: dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'))), sourceInput: 'catalog' });
assert.equal(installed.valid, true);
const parsed = parsePolicy(await readFile(policyPath, 'utf8')); assert.equal(parsed.valid, true);
const items = listItems(installed.release);
const choices = parsed.document.selections.map(selection => {
  const item = items.find(item => item.recipe.path === selection.recipe.reference.path);
  assert.ok(item);
  return { ...selection, itemId: item.id, organizationSelectionId: selection.id };
});
const permitted = choices.map(choice => ({ selectionId: choice.id, itemId: choice.itemId, scopes: ['project'],
  inputs: { agentDirectory: { fixed: '.claude' } } }));
const authored = await authorOrganizationPolicy({ release: installed.release, id: 'local-test-organization', permitted });
assert.equal(authored.valid, true, JSON.stringify(authored.diagnostics));
const derived = await deriveExecutionPolicy({ release: installed.release, organization: authored.document, choices, materialSource: installed.source });
assert.equal(derived.valid, true, JSON.stringify(derived.diagnostics));
const policy = { ...derived.policy, schema: 'urn:aihq:core:execution-policy:1.3.0', metadata: parsed.document.metadata };
const commit = 'a'.repeat(40), tree1 = '1'.padStart(40, '0'), tree2 = '2'.padStart(40, '0');
const organizationSource = { provider: 'github', repository: { owner: 'example-org', name: 'org-policy' }, path: 'policy/org.json', revision: { kind: 'commit', value: commit } };
const routes = document => {
  const bytes = Buffer.from(JSON.stringify(document));
  const blob = createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex');
  const base = '/repos/example-org/org-policy/git';
  return new Map([
    [`${base}/commits/${commit}`, { sha: commit, tree: { sha: tree1 } }],
    [`${base}/trees/${tree1}`, { sha: tree1, truncated: false, tree: [{ path: 'policy', mode: '040000', type: 'tree', sha: tree2 }] }],
    [`${base}/trees/${tree2}`, { sha: tree2, truncated: false, tree: [{ path: 'org.json', mode: '100644', type: 'blob', sha: blob, size: bytes.length }] }],
    [`${base}/blobs/${blob}`, { sha: blob, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') }]
  ]);
};
let currentRoutes = routes(authored.document);
const originalFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async url => {
  const address = new URL(String(url));
  assert.equal(address.origin, 'https://api.github.com');
  calls++;
  const body = currentRoutes.get(address.pathname);
  return new Response(JSON.stringify(body ?? { message: 'not found in fixture' }), { status: body ? 200 : 404, headers: {'content-type': 'application/json'} });
};
try {
  const host = createHost({ projectRoot: target, materialRoots: installed.materialRoots, organizationSource, controls: { logging: 'off' } });
  const policyText = JSON.stringify(policy);
  const preparation = await host.prepareSession({ policyText });
  assert.equal(preparation.status, 'ready', JSON.stringify(preparation.diagnostics));
  assert.ok(preparation.review.operations.every(operation => operation.scope === 'project' && operation.kind === 'file.write'
    && operation.checks.every(check => check.kind === 'file.sha256')), 'Fixture Apply is limited to project file writes and hash checks.');
  const outside = structuredClone(policy); outside.selections[0].configuration.agentDirectory = '.outside-policy';
  const denied = await host.prepareSession({ policyText: JSON.stringify(outside) });
  assert.notEqual(denied.status, 'ready');
  assert.ok(denied.diagnostics.some(diagnostic => diagnostic.code === 'AUTHORITY_DENIED'));
  const withdrawn = structuredClone(authored.document); withdrawn.selections = [];
  currentRoutes = routes(withdrawn);
  const changedAuthority = await host.applyApproved({ sessionId: preparation.sessionId, reviewDigest: preparation.review.reviewDigest, origin: 'automation' });
  assert.equal(changedAuthority.completion, 'rejected');
  currentRoutes = routes(authored.document);
  const readyAgain = await host.prepareSession({ policyText });
  assert.equal(readyAgain.status, 'ready');
  assert.ok(readyAgain.review.operations.every(operation => operation.scope === 'project' && operation.kind === 'file.write'
    && operation.checks.every(check => check.kind === 'file.sha256')), 'Fixture Apply is limited to project file writes and hash checks.');
  const applied = await host.applyApproved({ sessionId: readyAgain.sessionId, reviewDigest: readyAgain.review.reviewDigest, origin: 'automation' });
  assert.equal(applied.completion, 'complete', JSON.stringify(applied.diagnostics));
  for (const [name,value] of Object.entries({ organization: authored.document, policy, preparation, denied, changedAuthority, applied })) await writeFile(join(output, `${name}.json`), JSON.stringify(value, null, 2));
  const summary = { fixture: 'emulated GitHub REST transport; fictional local test organization', target,
    admission: preparation.status, outOfPolicy: denied.status, changedAuthority: changedAuthority.completion,
    admittedApply: applied.completion, fixtureRequests: calls, liveOrganizationChanged: false };
  await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary, null, 2));
} finally { globalThis.fetch = originalFetch; }
