import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { apply, prepareManagedRemoval, prepareUpdate } from '@aihq/core';
import { composeAuthoring, freshAuthoring } from './headless.mjs';
import { pinSelectedRecipes } from './selected-recipe.mjs';
import { installedFamilies } from './installed-families.mjs';
import { createHost, updateInputs, updateRequest, updateRequirements } from './host.mjs';

// The page's reading of an update, from the checkout AIH_REPO names (check-workbench sets it).
const repo = resolve(process.env.AIH_REPO ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const { previewUpdate } = await import(pathToFileURL(join(repo, 'src/app/installed-update.js')).href);

const POLICY_16 = 'urn:aihq:core:execution-policy:1.6.0';
const release = { framework: 'ecc', source: { kind: 'local', input: 'catalog' }, path: 'release/release-ecc.content.json', sha256: 'e'.repeat(64), byteLength: 10 };
// A Catalog 1.7 item rendered from Core's binding, as the composition gives it: an execution policy 1.6.0 selection
// that names its Catalog release instead of carrying a recipe.
const rendered = {
  id: 'rule', managementId: 'project--aihq.catalog--ecc.rule.typescript.coding-style', scope: 'project', configuration: { keep: true },
  requires: ['notices', 'other-replacement'],
  item: { framework: 'ecc', itemId: 'ecc.rule.typescript.coding-style', contentSha256: 'a'.repeat(64), behaviourSha256: 'b'.repeat(64) },
  tool: 'claude', name: 'coding-style', kind: 'rule',
  origins: [{ reasonIncluded: 'in-set', set: { framework: 'ecc', setId: 'ecc.rules.typescript', setSha256: 'c'.repeat(64) } }],
  bindingDigest: 'd'.repeat(64), scanRecords: [], itemMaterials: []
};
const other = { ...rendered, id: 'other-replacement', managementId: 'project--other', requires: [] };

test('an update is sent as an install is: the 1.6.0 selection with its policy, binding, Scan records and materials', () => {
  const sent = updateRequest({ project: '/project', scope: 'project', updates: [
    { managementId: rendered.managementId, selection: rendered, policy: { schema: POLICY_16, catalogReleases: [release] } },
    { managementId: other.managementId, selection: other, policy: { schema: POLICY_16, catalogReleases: [release] } }] });
  assert.deepEqual(sent.request.policy, { schema: POLICY_16, catalogReleases: [release] }, 'the release named once');
  const [replacement] = sent.request.updates.map(update => update.replacement);
  for (const field of ['bindingDigest', 'scanRecords', 'itemMaterials', 'configuration', 'origins', 'item']) assert.deepEqual(replacement[field], rendered[field], field);
  assert.equal(Object.hasOwn(replacement, 'recipe'), false, 'Core renders the recipe from the named release');
  // Only other replacements may be required; Core keeps the edge to the installed document from the install.
  assert.deepEqual(replacement.requires, ['other-replacement']);
  assert.deepEqual(sent.request.target, { project: '/project' });
});

test('two replacements naming different bytes for one Catalog release are not sent', () => {
  const sent = updateRequest({ project: '/project', scope: 'project', updates: [
    { managementId: rendered.managementId, selection: { ...rendered, requires: [] }, policy: { schema: POLICY_16, catalogReleases: [release] } },
    { managementId: other.managementId, selection: other, policy: { schema: POLICY_16, catalogReleases: [{ ...release, sha256: 'f'.repeat(64) }] } }] });
  assert.equal(sent.request, undefined);
  assert.deepEqual(sent.diagnostics.map(item => item.reason), ['catalog-release-conflict']);
});

// A replacement's required selections: Core keeps the edges recorded at install, so only those to selections still
// installed may be left to it; anything else the newer item requires stops the update before Core is asked.
const rule = { id: 'rule', managementId: 'project--rule', scope: 'project', requires: ['notices', 'readme', 'other'] };
const policySelections = [rule,
  { id: 'notices', managementId: 'project--notices', scope: 'project', item: { framework: 'ecc', itemId: 'ecc.notices' } },
  { id: 'readme', managementId: 'project--readme', scope: 'project', item: { framework: 'ecc', itemId: 'ecc.rule.README' } },
  { id: 'other', managementId: 'project--other', scope: 'project', item: { framework: 'ecc', itemId: 'ecc.other' } }];

test('a requirement recorded at install and still installed is left to Core; another replacement is kept', () => {
  const missing = updateRequirements({ selection: { ...rule, requires: ['notices', 'other'] }, policySelections, replacementIds: new Set(['rule', 'other']),
    recordedRequires: ['project:project--notices'], installed: new Set(['project:project--notices', 'project:project--rule']) });
  assert.deepEqual(missing, []);
});

test('a requirement the newer item adds, not installed, is named as missing', () => {
  const missing = updateRequirements({ selection: { ...rule, requires: ['notices', 'readme'] }, policySelections, replacementIds: new Set(['rule']),
    recordedRequires: ['project:project--notices'], installed: new Set(['project:project--notices', 'project:project--rule']) });
  assert.deepEqual(missing, [{ item: { framework: 'ecc', itemId: 'ecc.rule.README' }, installed: false }]);
});

test('an installed selection the item did not require at install is not dropped either', () => {
  const missing = updateRequirements({ selection: { ...rule, requires: ['readme'] }, policySelections, replacementIds: new Set(['rule']),
    recordedRequires: [], installed: new Set(['project:project--readme']) });
  assert.deepEqual(missing, [{ item: { framework: 'ecc', itemId: 'ecc.rule.README' }, installed: true }]);
});

test('without a record of the install, no requirement is dropped', () => {
  const missing = updateRequirements({ selection: { ...rule, requires: ['notices'] }, policySelections, replacementIds: new Set(['rule']),
    recordedRequires: undefined, installed: new Set(['project:project--notices']) });
  assert.deepEqual(missing, [{ item: { framework: 'ecc', itemId: 'ecc.notices' }, installed: true }]);
});

// Real Catalog content and the installed Core: one ECC TypeScript rule installed through the host, then updated.
const catalogRoot = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
const inventories = await installedFamilies({ root: catalogRoot, sourceInput: 'update-replacement' });
const ecc = inventories.find(entry => entry.family === 'ECC');
const ruleItem = ecc.release.items.find(item => item.id === 'ecc.rule.typescript.coding-style');
const ruleRoot = { releaseSha256: ecc.release.sha256, itemId: ruleItem.id, itemSha256: ruleItem.itemSha256, scope: 'project', configuration: {}, originIds: ['direct'] };
const materialRoots = { ...Object.fromEntries(inventories.map(entry => [entry.materialSource.input, catalogRoot])), catalog: catalogRoot };

async function installedRule(t) {
  const scratch = await mkdtemp(join(tmpdir(), 'aih-update-replacement-')), projectRoot = join(scratch, 'project');
  await mkdir(projectRoot, { recursive: true });
  t.after(async () => { await rm(scratch, { recursive: true, force: true }); });
  const host = createHost({ projectRoot, materialRoots, recipeMaterials: inventories.flatMap(entry => entry.materials), controls: { logging: 'off' },
    inventories, installRecordRoot: join(scratch, 'store') });
  const intent = freshAuthoring(); intent.roots.push(ruleRoot); pinSelectedRecipes(intent, inventories, ruleRoot, 'claude');
  const composed = await composeAuthoring({ intent, inventories, tool: 'claude' });
  assert.equal(composed.status, 'ok', JSON.stringify(composed.diagnostics ?? []));
  const prepared = await host.prepareSession({ policyText: new TextDecoder().decode(composed.value.policyBytes) });
  assert.equal(prepared.status, 'ready', JSON.stringify(prepared.diagnostics));
  assert.equal((await host.applyApproved({ sessionId: prepared.sessionId, reviewDigest: prepared.review.reviewDigest })).completion, 'complete');
  const selection = composed.value.policy.selections.find(candidate => candidate.item?.itemId === ruleItem.id);
  const { configuration: _configuration, originIds: _origins, ...replacement } = ruleRoot;
  return { host, scratch, projectRoot, composed, selection, entry: { name: 'TypeScript and JavaScript Coding Style (typescript)', managementId: selection.managementId, scope: 'project', replacement } };
}
// The one record file of a test's store, read and rewritten as another program might leave it.
async function recordFile(scratch) {
  const directory = join(scratch, 'store', 'installed'), [name] = (await readdir(directory)).filter(file => file.endsWith('.json'));
  const path = join(directory, name);
  return { path, read: async () => JSON.parse(await readFile(path, 'utf8')), write: async document => writeFile(path, `${JSON.stringify(document, null, 2)}\n`) };
}
const refusedAs = result => [result.disposition, ...(result.diagnostics ?? []).map(item => item.reason)];

test('Core prepares the update as an install: managed update 1.1.0 for a 1.6.0 replacement, its binding and Scan state reviewed', async t => {
  const { host, selection, entry } = await installedRule(t);
  const result = await host.prepareUpdateSession({ updates: [{ ...entry, tool: 'claude' }], scope: 'project', tool: 'claude', mode: 'vibe' });
  assert.equal(result.schema, 'urn:aihq:core:managed-update-preparation:1.1.0', 'Core read a request that names its policy');
  assert.equal(result.disposition, 'prepared', JSON.stringify(result));
  assert.equal(result.preparation.status, 'ready', JSON.stringify(result.preparation.diagnostics));
  assert.equal(result.preparation.review.schema, 'urn:aihq:core:prepared-work:1.7.0');
  const reviewed = result.preparation.review.selections.find(candidate => candidate.managementId === selection.managementId);
  assert.ok(reviewed?.layout && reviewed.scanState, `the review names the replacement's binding and Scan state: ${JSON.stringify(reviewed)}`);
  assert.deepEqual(result.request, { policy: POLICY_16, catalogReleases: 1,
    replacements: [{ managementId: selection.managementId, recipe: 'rendered-by-core', bindingDigest: true, scanRecords: selection.scanRecords !== undefined, itemMaterials: selection.itemMaterials !== undefined }] });
  const preview = await previewUpdate({ entries: [entry], tool: 'claude', request: async () => result });
  assert.equal(preview.canConfirm, true, preview.message);
});

test('a replacement rendered for a binding Core no longer ships is refused, and the page says why in Core\'s words', async t => {
  const { projectRoot, composed, selection, entry } = await installedRule(t);
  const sent = updateRequest({ project: projectRoot, scope: 'project', updates: [{ managementId: selection.managementId,
    selection: { ...selection, requires: [], bindingDigest: '0'.repeat(64) }, policy: composed.value.policy }] });
  const result = await prepareUpdate(sent.request, { materialRoots, logging: 'off' });
  assert.equal(result.schema, 'urn:aihq:core:managed-update-preparation:1.1.0');
  const reasons = result.updates.flatMap(update => update.diagnostics.map(item => item.reason));
  assert.ok(reasons.includes('binding-changed'), JSON.stringify(result.updates));
  const preview = await previewUpdate({ entries: [entry], tool: 'claude', request: async () => result });
  assert.equal(preview.canConfirm, false);
  assert.equal(preview.steps[0].state, 'blocked');
  const words = result.updates[0].diagnostics.find(item => item.reason === 'binding-changed').message;
  assert.match(words, /was rendered for another binding/);
  assert.equal(preview.message, `Update cannot go ahead: TypeScript and JavaScript Coding Style (typescript): ${words.replace(/\.$/, '')}. Nothing was updated.`);
});

// An install record describes an installation only while Core still shows it: a removal through the Workbench drops the
// entry, and an entry that no longer matches what Core's inventory shows is never used.
test('a removal through the Workbench drops the item from the install record, so it is not updated from it', async t => {
  const { host, scratch, selection } = await installedRule(t);
  const key = `project:${selection.managementId}`;
  assert.ok((await (await recordFile(scratch)).read()).selections[key], 'the install is recorded');
  const removal = await host.prepareRemovalSession({ removals: [{ managementId: selection.managementId }], scope: 'project', mode: 'vibe' });
  assert.equal(removal.preparation?.status, 'ready', JSON.stringify(removal));
  assert.equal((await host.applyApproved({ sessionId: removal.preparation.sessionId, reviewDigest: removal.preparation.review.reviewDigest })).completion, 'complete');
  assert.equal((await (await recordFile(scratch)).read()).selections[key], undefined, 'the removed item is no longer recorded');
});

test('an install record that no longer matches what Core shows installed is refused as not recorded', async t => {
  const { host, scratch, projectRoot, selection, entry } = await installedRule(t);
  // Removed and installed again outside this Workbench: Core's claim now records other origins than the Workbench's install.
  const removal = await prepareManagedRemoval({ target: { project: projectRoot }, removals: [{ managementId: selection.managementId }], scope: 'project', mode: 'vibe' }, { logging: 'off' });
  assert.equal((await apply(removal.preparation.prepared, { approved: true, origin: 'interactive', reviewDigest: removal.preparation.review.reviewDigest }, { logging: 'off' })).completion, 'complete');
  const other = createHost({ projectRoot, materialRoots, recipeMaterials: inventories.flatMap(item => item.materials), controls: { logging: 'off' }, inventories });
  const root = { ...ruleRoot, originIds: ['direct'] }, intent = freshAuthoring(); intent.roots.push(root); pinSelectedRecipes(intent, inventories, root, 'claude');
  const composed = await composeAuthoring({ intent, inventories, tool: 'claude' });
  const policy = { ...composed.value.policy, selections: composed.value.policy.selections.map(candidate => candidate.id === selection.id
    ? { ...candidate, origins: [{ reasonIncluded: 'in-set', set: { framework: 'ecc', setId: 'ecc.rules.typescript', setSha256: ecc.release.sets.find(set => set.id === 'ecc.rules.typescript').setSha256 } }] } : candidate) };
  const prepared = await other.prepareSession({ policyText: JSON.stringify(policy) });
  assert.equal(prepared.status, 'ready', JSON.stringify(prepared.diagnostics));
  assert.equal((await other.applyApproved({ sessionId: prepared.sessionId, reviewDigest: prepared.review.reviewDigest })).completion, 'complete');
  assert.ok((await (await recordFile(scratch)).read()).selections[`project:${selection.managementId}`], 'the Workbench\'s earlier entry is still on disk');
  const result = await host.prepareUpdateSession({ updates: [{ ...entry, tool: 'claude' }], scope: 'project', tool: 'claude', mode: 'vibe' });
  assert.deepEqual(refusedAs(result), ['invalid', 'install-not-recorded'], JSON.stringify(result));
  assert.equal(result.schema, undefined, 'Core was not asked');
});

// The same check install runs before Core: an input the newer item requires that the recorded configuration and the host's
// private inputs do not supply, with the private inputs kept to the replacement's own selection. Catalog's reader accepts
// only its own release handles, so the newer item is the installed rule's Catalog entry with two required inputs added.
test('an update whose newer item needs an input the install did not record is named "Needs", as install names it', async t => {
  const { composed, selection, entry } = await installedRule(t);
  const required = { teamName: { type: 'string', required: true }, apiToken: { type: 'string', required: true, sensitive: true } };
  const newer = inventories.map(source => source !== ecc ? source : { ...source, release: { ...source.release,
    items: source.release.items.map(item => item.id !== ruleItem.id ? item : { ...item, requirements: { ...item.requirements, inputs: required } }) } });
  const replacement = composed.value.policy.selections.find(candidate => candidate.id === selection.id);
  const held = { [selection.id]: { apiToken: 'secret' }, 'another-selection': { teamName: 'not this one' } };
  const supplied = updateInputs({ updates: [{ managementId: selection.managementId, selection: replacement }], inventories: newer, held });
  assert.deepEqual(supplied.privateInputs, { [selection.id]: { apiToken: 'secret' } }, 'only the replacement\'s own private inputs are offered');
  assert.deepEqual(supplied.needs.map(need => [need.managementId, need.inputs]), [[selection.managementId, ['teamName']]]);
  assert.deepEqual(supplied.diagnostics.map(item => [item.reason, item.message]), [['input-needed', 'TypeScript and JavaScript Coding Style: Needs teamName']]);
  const missing = updateInputs({ updates: [{ managementId: selection.managementId, selection: replacement }], inventories: newer, held: {} });
  assert.deepEqual(missing.diagnostics.map(item => item.message), ['TypeScript and JavaScript Coding Style: Needs teamName, Needs apiToken']);
  const preview = await previewUpdate({ entries: [entry], tool: 'claude', request: async () => ({ disposition: 'invalid', needs: missing.needs, diagnostics: missing.diagnostics }) });
  assert.equal(preview.message, 'Update cannot go ahead: TypeScript and JavaScript Coding Style: Needs teamName, Needs apiToken. Nothing was updated.');
  assert.deepEqual(updateInputs({ updates: [{ managementId: selection.managementId, selection: replacement }], inventories, held }).needs, [], 'the installed item needs nothing');
});

// Core's update request names no organization and prepares only Vibe policy, so an Enterprise setup cannot update here.
test('an update in an Enterprise setup is refused before Core is asked', async t => {
  const { host, entry } = await installedRule(t);
  const result = await host.prepareUpdateSession({ updates: [{ ...entry, tool: 'claude' }], scope: 'project', tool: 'claude', mode: 'enterprise' });
  assert.deepEqual(refusedAs(result), ['unavailable', 'enterprise-update-unavailable'], JSON.stringify(result));
  assert.equal(result.schema, undefined, 'Core was not asked');
});
