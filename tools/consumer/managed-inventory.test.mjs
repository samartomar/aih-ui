import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeAuthoring, freshAuthoring, readAuthoring } from './headless.mjs';
import { pinSelectedRecipes } from './selected-recipe.mjs';
import { installedFamilies } from './installed-families.mjs';
import { createHost } from './host.mjs';
import { homeEnvironment } from './home-environment.mjs';
import { readInstalledPreparedContent } from '@aihq/catalog/node';

const catalogRoot = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
const inventories = await installedFamilies({ root: catalogRoot, sourceInput: 'managed-inventory-index' });
const source = inventories.find(entry => entry.family === 'ECC');
const item = source.release.items.find(item => item.kind === 'skill' && !Object.keys(item.inputs ?? {}).length);
const root = { releaseSha256: source.release.sha256, itemId: item.id, itemSha256: item.itemSha256, scope: 'project', configuration: {}, originIds: ['direct'] };

test('real Catalog content composes recipe-less execution policy 1.6 naming its release, and survives read-back', async () => {
  const intent = freshAuthoring(); intent.roots.push(root);
  const composed = await composeAuthoring({ intent, inventories, tool: 'claude' });
  assert.equal(composed.status, 'ok', JSON.stringify(composed.diagnostics ?? []));
  assert.equal(composed.value.policy.schema, 'urn:aihq:core:execution-policy:1.6.0');
  const prepared = await readInstalledPreparedContent({ root: catalogRoot, frameworkId: 'ecc' });
  assert.deepEqual(composed.value.policy.catalogReleases, [{ framework: 'ecc', source: { kind: 'local', input: 'catalog' },
    path: prepared.provenance.contentPath, sha256: prepared.provenance.contentSha256, byteLength: prepared.provenance.contentByteLength }]);
  const selection = composed.value.policy.selections.find(candidate => candidate.item?.itemId === item.id);
  assert.ok(selection, 'the real ECC item is selected');
  assert.match(selection.bindingDigest, /^[a-f0-9]{64}$/);
  assert.equal(selection.recipe, undefined, 'Core renders the recipe at Prepare');
  assert.equal(selection.tool, 'claude');
  if (item.scan?.length) {
    assert.deepEqual(selection.scanRecords, item.scan);
    assert.deepEqual(selection.itemMaterials, item.materials.map(material => ({
      materialId: material.id, relPath: material.relPath, path: material.packagePath,
      sha256: material.sha256, byteLength: material.byteLength, role: material.role,
    })));
  } else {
    assert.equal(selection.scanRecords, undefined);
    assert.equal(selection.itemMaterials, undefined);
  }
  const reopened = await readAuthoring({ policyBytes: composed.value.policyBytes, inventories });
  assert.equal(reopened.status, 'ok', JSON.stringify(reopened.diagnostics ?? []));
  assert.equal(reopened.value.editing, 'available', JSON.stringify(reopened.value.diagnostics ?? []));
  assert.deepEqual(reopened.value.policy.selections.find(candidate => candidate.item?.itemId === item.id), selection);
});

function host(projectRoot, offered) {
  return createHost({ projectRoot,
    materialRoots: { ...Object.fromEntries(inventories.map(entry => [entry.materialSource.input, catalogRoot])), catalog: catalogRoot },
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

test('a recipe-less supporting document finished on its own is prepared beside the item requiring it', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'aih-recipeless-finish-')), projectRoot = join(scratch, 'project');
  await mkdir(projectRoot, { recursive: true });
  t.after(async () => { await rm(scratch, { recursive: true, force: true }); });
  const requiring = source.release.items.find(candidate => candidate.id === 'ecc.skill.accessibility');
  const requiringRoot = { releaseSha256: source.release.sha256, itemId: requiring.id, itemSha256: requiring.itemSha256, scope: 'project', configuration: {}, originIds: ['direct'] };
  const intent = freshAuthoring(); intent.roots.push(requiringRoot); pinSelectedRecipes(intent, inventories, requiringRoot, 'claude');
  const composed = await composeAuthoring({ intent, inventories, tool: 'claude' });
  assert.equal(composed.status, 'ok', JSON.stringify(composed.diagnostics ?? []));
  const notices = composed.value.policy.selections.find(selection => selection.kind === 'document');
  assert.ok(notices && notices.recipe === undefined && notices.origins.some(origin => origin.reasonIncluded === 'required-by'), 'the notices document is a recipe-less supporting document');
  const finished = await host(projectRoot, inventories).prepareFinishSession({ policyText: new TextDecoder().decode(composed.value.policyBytes), managementId: notices.managementId });
  assert.equal(finished.status, 'ready', JSON.stringify(finished.diagnostics));
  // The same document operations the whole setup prepares for it, and nothing for the requiring item.
  const whole = await host(projectRoot, inventories).prepareSession({ policyText: new TextDecoder().decode(composed.value.policyBytes) });
  assert.equal(whole.status, 'ready', JSON.stringify(whole.diagnostics));
  const of = (review, selectionId) => review.operations.filter(operation => operation.id.startsWith(`${selectionId}/`))
    .map(({ id, kind, target }) => ({ id, kind, target }));
  assert.ok(of(finished.review, notices.id).length > 0);
  assert.deepEqual(of(finished.review, notices.id), of(whole.review, notices.id));
  assert.equal(finished.review.operations.length, of(finished.review, notices.id).length, 'only the document is prepared');
});

test('all six positive timings stay on the prepare run id and later inventory reads do not accumulate', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'aih-install-timings-')), projectRoot = join(scratch, 'project');
  await mkdir(projectRoot, { recursive: true });
  t.after(async () => { await rm(scratch, { recursive: true, force: true }); });
  const installedHost = host(projectRoot);
  for (const phase of ['resolve', 'compatibility', 'render']) await installedHost.measure(phase, async () => { await new Promise(resolve => setTimeout(resolve, 2)); });
  const policy = { schema: 'urn:aihq:core:execution-policy:1.5.0', mode: 'vibe', selections: [{
    id: 'guidance', managementId: 'guidance', scope: 'project', configuration: { text: 'Timing fixture.\n' }, requires: [],
    recipe: { inline: { schema: 'urn:aihq:core:recipe:1.3.0', id: 'timing-fixture', description: 'Timing fixture',
      inputs: { text: { type: 'string', required: true } }, materials: [], targets: ['project'], prerequisites: [],
      operations: [{ id: 'write', purpose: 'Write timing fixture', kind: 'file.write', scope: 'project',
        target: { root: 'project', segments: [{ literal: 'TIMING.md' }] }, content: { input: 'text' }, requires: [], checks: [] }], checks: [] } },
  }] };
  const prepared = await installedHost.prepareSession({ policyText: JSON.stringify(policy) });
  assert.equal(prepared.status, 'ready', JSON.stringify(prepared));
  const applied = await installedHost.applyApproved({ sessionId: prepared.sessionId, reviewDigest: prepared.review.reviewDigest });
  assert.equal(applied.completion, 'complete', JSON.stringify(applied));
  await installedHost.managedInventory();
  const timing = installedHost.installTimings(prepared.runId);
  assert.ok(timing, 'timings are keyed by the prepare run id');
  for (const phase of ['resolve', 'compatibility', 'render', 'prepare', 'apply', 'inventory']) assert.ok(timing[phase] > 0, `${phase} was ${timing[phase]}`);
  const inventory = timing.inventory;
  await installedHost.managedInventory();
  assert.equal(installedHost.installTimings(prepared.runId).inventory, inventory);
});

test('managed inventory includes real project and user scope receipts', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'aih-managed-scopes-')), projectRoot = join(scratch, 'project');
  await mkdir(projectRoot, { recursive: true });
  const previous = Object.fromEntries(Object.keys(homeEnvironment(join(scratch, 'home'))).map(key => [key, process.env[key]]));
  Object.assign(process.env, homeEnvironment(join(scratch, 'home')));
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(scratch, { recursive: true, force: true });
  });
  const selection = (scope, root, path) => ({ id: scope, managementId: scope, scope, configuration: { text: `${scope}.\n` }, requires: [],
    recipe: { inline: { schema: 'urn:aihq:core:recipe:1.3.0', id: scope, description: scope,
      inputs: { text: { type: 'string', required: true } }, materials: [], targets: [scope], prerequisites: [],
      operations: [{ id: 'write', purpose: `Write ${scope}`, kind: 'file.write', scope,
        target: { root, segments: (Array.isArray(path) ? path : [path]).map(literal => ({ literal })) }, content: { input: 'text' }, requires: [], checks: [] }], checks: [] } } });
  const policy = { schema: 'urn:aihq:core:execution-policy:1.5.0', mode: 'vibe', selections: [
    selection('project', 'project', 'PROJECT.md'), selection('user', 'userHome', ['.claude', 'USER.md']),
  ] };
  const installedHost = host(projectRoot);
  const prepared = await installedHost.prepareSession({ policyText: JSON.stringify(policy) });
  assert.equal(prepared.status, 'ready', JSON.stringify(prepared));
  const applied = await installedHost.applyApproved({ sessionId: prepared.sessionId, reviewDigest: prepared.review.reviewDigest });
  assert.equal(applied.completion, 'complete', JSON.stringify(applied));
  const inventory = await installedHost.managedInventory();
  assert.deepEqual(inventory.selections.map(entry => entry.scope).sort(), ['project', 'user']);
});

test('Finish prepares only the interrupted management id, not the whole current setup', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'aih-finish-selection-')), projectRoot = join(scratch, 'project');
  await mkdir(projectRoot, { recursive: true });
  t.after(async () => { await rm(scratch, { recursive: true, force: true }); });
  const selection = (id, path, requires = []) => ({ id, managementId: id, scope: 'project', configuration: { text: `${id}.\n` }, requires,
    recipe: { inline: { schema: 'urn:aihq:core:recipe:1.3.0', id, description: id,
      inputs: { text: { type: 'string', required: true } }, materials: [], targets: ['project'], prerequisites: [],
      operations: [{ id: 'write', purpose: `Write ${id}`, kind: 'file.write', scope: 'project',
        target: { root: 'project', segments: [{ literal: path }] }, content: { input: 'text' }, requires: [], checks: [] }], checks: [] } } });
  const policy = { schema: 'urn:aihq:core:execution-policy:1.5.0', mode: 'vibe', selections: [
    selection('interrupted', 'FINISH.md', ['other']), selection('other', 'OTHER.md'),
  ] };
  const prepared = await host(projectRoot).prepareFinishSession({ policyText: JSON.stringify(policy), managementId: 'interrupted' });
  assert.equal(prepared.status, 'ready', JSON.stringify(prepared));
  assert.ok(prepared.review.operations.length > 0);
  assert.ok(prepared.review.operations.every(operation => operation.details?.target?.endsWith('FINISH.md')), JSON.stringify(prepared.review.operations));
});

test('Project basics facts are digest-bound in the composed selection and read-back', async () => {
  const prepared = await readInstalledPreparedContent({ root: catalogRoot, frameworkId: 'project-basics' });
  assert.equal(prepared.valid, true, JSON.stringify(prepared.diagnostics));
  const materials = await Promise.all(prepared.release.items.flatMap(item => item.materials).map(async material => ({
    ...material, path: material.packagePath, bytes: new Uint8Array(await readFile(join(catalogRoot, material.packagePath))),
  })));
  const inventory = { family: 'Project basics', release: prepared.release, materialSource: { kind: 'local', input: 'maintained' }, materials };
  const item = prepared.release.items.find(item => item.kind === 'rule' && item.payload?.placement === 'entry-block');
  const root = { releaseSha256: prepared.release.sha256, itemId: item.id, itemSha256: item.itemSha256, scope: 'project', configuration: {}, originIds: ['direct'] };
  const intent = freshAuthoring(); intent.roots.push(root);
  const projectFacts = { facts: [{ field: 'stack', value: 'node', confidence: 'detected' }, { field: 'packageManager', value: 'npm', confidence: 'inferred' }] };
  const composed = await composeAuthoring({ intent, inventories: [inventory], tool: 'claude', projectFacts });
  assert.equal(composed.status, 'ok', JSON.stringify(composed.diagnostics ?? []));
  const selection = composed.value.policy.selections.find(candidate => candidate.item?.itemId === item.id);
  assert.deepEqual(selection.projectFacts, projectFacts.facts);
  const reopened = await readAuthoring({ policyBytes: composed.value.policyBytes, inventories: [inventory] });
  assert.equal(reopened.value.editing, 'available', JSON.stringify(reopened.value.diagnostics ?? []));
  assert.deepEqual(reopened.value.policy.selections.find(candidate => candidate.item?.itemId === item.id).projectFacts, projectFacts.facts);
});
