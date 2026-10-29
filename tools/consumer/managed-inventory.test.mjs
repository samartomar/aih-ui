import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeAuthoring, freshAuthoring } from './headless.mjs';
import { pinSelectedRecipes } from './selected-recipe.mjs';
import { installedFamilies } from './installed-families.mjs';
import { createHost } from './host.mjs';

const catalogRoot = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
const inventories = await installedFamilies({ root: catalogRoot, sourceInput: 'managed-inventory-index' });
const source = inventories.find(entry => entry.family === 'ECC');
const item = source.release.items.find(item => item.kind === 'skill' && !Object.keys(item.inputs ?? {}).length);
const root = { releaseSha256: source.release.sha256, itemId: item.id, itemSha256: item.itemSha256, scope: 'project', configuration: {}, originIds: ['direct'] };

function host(projectRoot, offered) {
  return createHost({ projectRoot,
    materialRoots: Object.fromEntries(inventories.map(entry => [entry.materialSource.input, catalogRoot])),
    recipeMaterials: inventories.flatMap(entry => entry.materials), controls: { logging: 'off' },
    ...(offered === undefined ? {} : { inventories: offered }) });
}

test('managed inventory receives the current offered index and supersession facts', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'aih-managed-index-')), projectRoot = join(scratch, 'project');
  await mkdir(projectRoot, { recursive: true });
  t.after(async () => { await rm(scratch, { recursive: true, force: true }); });
  const intent = freshAuthoring(); intent.roots.push(root); pinSelectedRecipes(intent, inventories, root, 'claude');
  const composed = await composeAuthoring({ intent, inventories, tool: 'claude' });
  assert.equal(composed.status, 'ok', JSON.stringify(composed.diagnostics ?? []));
  const installedHost = host(projectRoot, inventories);
  const prepared = await installedHost.prepareSession({ policyText: new TextDecoder().decode(composed.value.policyBytes) });
  assert.equal(prepared.status, 'ready', JSON.stringify(prepared));
  const applied = await installedHost.applyApproved({ sessionId: prepared.sessionId, reviewDigest: prepared.review.reviewDigest });
  assert.equal(applied.completion, 'complete', JSON.stringify(applied));

  const updateState = async offered => {
    const result = await host(projectRoot, offered).managedInventory();
    assert.ok(['complete', 'incomplete'].includes(result.status), JSON.stringify(result.diagnostics));
    return result.selections.find(selection => selection.item?.itemId === item.id)?.updateState;
  };
  assert.equal(await updateState(inventories), 'current', 'the exact current offered item is current');
  assert.equal(await updateState([]), 'no-longer-offered', 'an explicitly empty current index is not unknown');
  const changed = inventories.map(entry => ({ ...entry, release: { ...entry.release, items: entry.release.items.map(candidate => candidate === item ? { ...candidate, contentSha256: '0'.repeat(64) } : candidate) } }));
  assert.equal(await updateState(changed), 'update-available', 'a different offered content identity is an update');
  const superseded = inventories.map(entry => ({ ...entry, release: { ...entry.release, items: entry.release.items.map(candidate => candidate !== item && candidate.kind === 'skill'
    ? { ...candidate, supersedes: [...(candidate.supersedes ?? []), { itemId: item.id }] } : candidate) } }));
  assert.equal(await updateState(superseded), 'superseded', 'a published survivor supersedes the installed item');
  assert.equal(await host(projectRoot).managedInventory().then(result => result.selections.find(selection => selection.item?.itemId === item.id)?.updateState),
    'unknown', 'without consumer index inputs Core keeps update state unknown');
});
