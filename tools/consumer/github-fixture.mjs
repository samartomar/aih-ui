// Controlled GitHub REST transport. Public Core still reads and validates bytes.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInstalledRelease } from '@aihq/catalog/node';
import { deriveRecipeIdentity } from '@aihq/core/contracts';
import { composeAuthoring, freshAuthoring } from './headless.mjs';
const sha1 = bytes => createHash('sha1').update(bytes).digest('hex');
export function createGitHubFixture({ owner = 'fixture-org', name = 'authority', path = 'policy/organization.json', ref = 'main' } = {}) {
  const source = { provider: 'github', repository: { owner, name }, path, revision: { kind: 'branch', value: ref } };
  const requests = [], base = `/repos/${owner}/${name}/git`;
  let routes, generation = 0, originalFetch;
  function publish(document) {
    const bytes = Buffer.from(JSON.stringify(document) + '\n');
    const blobId = sha1(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]));
    const resolvedCommit = sha1(`fixture commit ${++generation} ${blobId}`);
    const parts = path.split('/'), trees = parts.map((_, i) => sha1(`fixture tree ${generation} ${i}`));
    routes = new Map([
      [`${base}/ref/heads/${ref}`, { ref: `refs/heads/${ref}`, object: { type: 'commit', sha: resolvedCommit } }],
      [`${base}/commits/${resolvedCommit}`, { sha: resolvedCommit, tree: { sha: trees[0] } }],
      [`${base}/blobs/${blobId}`, { sha: blobId, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') }],
      ...parts.map((part, i) => [`${base}/trees/${trees[i]}`, { sha: trees[i], truncated: false, tree: [{ path: part, mode: i === parts.length - 1 ? '100644' : '040000', type: i === parts.length - 1 ? 'blob' : 'tree', sha: trees[i + 1] ?? blobId, ...(i === parts.length - 1 ? { size: bytes.length } : {}) }] }])
    ]);
    return { resolvedCommit, blobId, contentDigest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
  }
  publish({ schema: 'urn:aihq:core:organization-policy:1.0.0', id: 'controlled-organization', selections: [] });
  return { source, requests, publish,
    install() {
      if (originalFetch) throw Error('Fixture already installed.');
      originalFetch = globalThis.fetch;
      globalThis.fetch = async (input, options) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
        if (url.origin !== 'https://api.github.com') return originalFetch(input, options);
        requests.push(url.pathname);
        const body = routes.get(url.pathname);
        return Response.json(body ?? { message: 'Not found in controlled fixture' }, { status: body ? 200 : 404 });
      };
    },
    restore() { if (originalFetch) { globalThis.fetch = originalFetch; originalFetch = undefined; } }
  };
}

// A single maintained root; dependency allowances come from its composed policy.
export async function enterpriseFixture() {
  const root = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
  const installed = await readInstalledRelease({ root, sourceInput: 'maintained' });
  if (!installed.valid) throw Error(JSON.stringify(installed.diagnostics));
  const materials = await Promise.all(installed.release.items.map(item => item.recipe).map(async recipe => ({ ...recipe, bytes: new Uint8Array(await readFile(join(root, recipe.path))) })));
  const inventory = { release: installed.release, materialSource: installed.source, materials };
  const intent = freshAuthoring(), item = installed.release.items.find(item => item.id === 'mattpocock.code-review');
  intent.roots.push({ releaseSha256: installed.release.sha256, itemId: item.id, itemSha256: item.itemSha256, scope: 'project', configuration: { agentDirectory: '.claude' }, originIds: ['direct'] });
  const basePolicyBytes = new TextEncoder().encode(JSON.stringify({ schema: 'urn:aihq:core:execution-policy:1.3.0', mode: 'enterprise', selections: [], metadata: { 'aih.workbench': freshAuthoring() } }));
  const composed = await composeAuthoring({ basePolicyBytes, intent, inventories: [inventory] });
  if (composed.status !== 'ok') throw Error(JSON.stringify(composed));
  const document = { schema: 'urn:aihq:core:organization-policy:1.0.0', id: 'controlled-organization', selections: await Promise.all(composed.value.policy.selections.map(async selection => {
    const reference = selection.recipe.reference;
    const identity = await deriveRecipeIdentity({ reference, recipeBytes: materials.find(material => material.sha256 === reference.sha256).bytes });
    if (identity.status !== 'ok') throw Error(JSON.stringify(identity));
    return { selectionId: selection.organizationSelectionId, recipeIdentity: identity.value.recipeIdentity, scopes: ['project'], inputs: Object.fromEntries(Object.entries(selection.configuration).map(([key, value]) => [key, { fixed: value }])), lifecycle: { replace: true, remove: true } };
  })) };
  return { ...composed.value, document };
}
