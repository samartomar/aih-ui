// Several tools under an Enterprise organisation policy, against the real Core and Catalog. The organisation policy is
// the one the Workbench's own organisation author exports; an item it permits is permitted for every tool the
// organisation targets, each tool by its own entry, so every tool's copy of the item is admitted and installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeAuthoring, editAuthoring, freshAuthoring } from './headless.mjs';
import { installedFamilies } from './installed-families.mjs';
import { runOrganizationAuthor } from './organization-author.mjs';
import { readJourneyEnvelope } from './journey.mjs';
import { createHost } from './host.mjs';
import * as harness from '@aihq/core/harness';

const catalogRoot = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
const inventories = await installedFamilies({ root: catalogRoot, sourceInput: 'managed-inventory-index' });
const superpowers = inventories.find(entry => entry.family === 'Superpowers'), ecc = inventories.find(entry => entry.family === 'ECC');
const skill = superpowers.release.items.find(item => item.id === 'superpowers.skill.brainstorming');
const ENTERPRISE = new TextEncoder().encode(JSON.stringify({ schema: 'urn:aihq:core:execution-policy:1.3.0', mode: 'enterprise', selections: [], metadata: { 'aih.workbench': freshAuthoring() } }));
const rootOf = (entry, item) => ({ releaseSha256: entry.release.sha256, itemId: item.id, itemSha256: item.itemSha256, scope: 'project', configuration: {} });
const host = (projectRoot, organizationSource) => createHost({ projectRoot, organizationSource, controls: { logging: 'off' }, inventories,
  materialRoots: { ...Object.fromEntries(inventories.map(entry => [entry.materialSource.input, catalogRoot])), catalog: catalogRoot },
  recipeMaterials: inventories.flatMap(entry => entry.materials) });

// The Admin's path: a baseline that permits the item, targeting Claude Code and Codex CLI, exported by the Workbench.
async function authoredPolicy(clients) {
  let state = await runOrganizationAuthor('organization-new', {}, { inventories });
  assert.equal(state.status, 'ok', JSON.stringify(state));
  const edit = async operation => {
    state = await runOrganizationAuthor('organization-edit', { envelopeBytes: [...state.value.envelopeBytes], operation }, { inventories });
    assert.equal(state.status, 'ok', JSON.stringify(state.diagnostics ?? state));
    return state;
  };
  await edit({ kind: 'set-policy-id', policyId: 'gosam-baseline' });
  await edit({ kind: 'set-source', source: { provider: 'github', repository: { owner: 'samartomar', name: 'test' }, path: 'org/baseline.json', revision: { kind: 'branch', value: 'main' } } });
  await edit({ kind: 'add-entry', releaseSha256: superpowers.release.sha256, itemId: skill.id, scope: 'project' });
  const record = (await readJourneyEnvelope(Uint8Array.from(state.value.envelopeBytes))).value.records.find(value => value.id === 'organization-draft');
  await edit({ kind: 'set-obligation', entryId: record.entries[0].id, obligation: 'permitted' });
  for (const client of clients) await edit({ kind: 'add-target', scope: 'project', client });
  const exported = await runOrganizationAuthor('organization-export', { envelopeBytes: [...state.value.envelopeBytes] }, { inventories });
  assert.equal(exported.status, 'ok', JSON.stringify(exported.diagnostics ?? exported));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(exported.value.candidateBytes)));
}

test('an exported baseline permits the item for each targeted tool, by its own entry', async () => {
  const organization = await authoredPolicy(['claude', 'codex']);
  const ids = organization.selections.map(entry => entry.selectionId);
  for (const tool of ['claude', 'codex']) {
    assert.ok(ids.some(id => id.endsWith(`--${skill.id}--${tool}`)), `${tool}: ${ids.join(', ')}`);
    assert.ok(ids.some(id => id.endsWith(`--superpowers.notices--${tool}`)), `${tool} dependency: ${ids.join(', ')}`);
  }
  const identities = organization.selections.filter(entry => entry.selectionId.includes(skill.id)).map(entry => entry.recipeIdentity);
  assert.equal(new Set(identities).size, identities.length, 'each tool is permitted by that tool\'s own rendered recipe');
});

test('an Enterprise setup for Claude Code and Codex CLI is admitted by the authored baseline and installs for both', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'aih-enterprise-tools-')), project = join(scratch, 'project'), file = join(scratch, 'organization.json');
  await mkdir(project, { recursive: true }); t.after(() => rm(scratch, { recursive: true, force: true }));
  await writeFile(file, JSON.stringify(await authoredPolicy(['claude', 'codex'])));
  const base = await composeAuthoring({ intent: freshAuthoring(), inventories, basePolicyBytes: ENTERPRISE });
  for (const tools of [['claude', 'codex'], ['codex']]) {
    const added = await editAuthoring({ policyBytes: base.value.policyBytes, inventories, tool: tools[0], tools, operation: { type: 'select', root: rootOf(superpowers, skill) } });
    assert.equal(added.status, 'ok', JSON.stringify(added.diagnostics ?? []));
    const mine = added.value.policy.selections.filter(selection => selection.item?.itemId === skill.id);
    assert.deepEqual(mine.map(selection => selection.tool).sort(), [...tools].sort());
    for (const selection of mine) assert.match(selection.organizationSelectionId, new RegExp(`--${selection.tool}$`));
    const target = join(project, tools.join('-')); await mkdir(target, { recursive: true });
    const installing = host(target, { provider: 'local', path: file });
    const prepared = await installing.prepareSession({ policyText: new TextDecoder().decode(added.value.policyBytes) });
    assert.equal(prepared.status, 'ready', `${tools.join(', ')}: ${JSON.stringify(prepared.diagnostics ?? prepared).slice(0, 1500)}`);
    const applied = await installing.applyApproved({ sessionId: prepared.sessionId, reviewDigest: prepared.review.reviewDigest });
    assert.equal(applied.completion, 'complete', JSON.stringify(applied).slice(0, 1500));
    const listed = await installing.managedInventory();
    assert.deepEqual(listed.selections.filter(selection => selection.item?.itemId === skill.id).map(selection => selection.tool).sort(), [...tools].sort());
  }
});

test('a set Add takes only the chosen tools that pass the card\'s fit: no compatibility blocker and Core renders it', async () => {
  // Added together, ECC's TypeScript and Python rules share folders in Kiro CLI: Core's check blocks them there (same-folder)
  // although Core renders each one.
  const sets = ['ecc.rules.typescript', 'ecc.rules.python'].map(id => ecc.release.sets.find(set => set.id === id));
  const operation = { type: 'select-sets', releaseSha256: ecc.release.sha256, tool: 'kiro', sets: sets.map(set => ({ release: { releaseSha256: ecc.release.sha256, scope: 'project' }, setId: set.id, setSha256: set.setSha256, options: {}, members: [] })) };
  const empty = await composeAuthoring({ intent: freshAuthoring(), inventories });
  const added = await editAuthoring({ policyBytes: empty.value.policyBytes, inventories, tool: 'kiro', tools: ['kiro', 'claude'], operation });
  assert.equal(added.status, 'ok', JSON.stringify(added.diagnostics ?? []));
  const chosen = [...new Set(added.value.policy.selections.map(selection => selection.item.itemId))].map(id => ecc.release.items.find(item => item.id === id));
  const kiro = harness.checkCompatibility({ tool: 'kiro', platform: { os: ({ win32: 'windows', darwin: 'macos' })[process.platform] ?? process.platform, arch: process.arch },
    binding: harness.toolBindings.find(binding => binding.tool === 'kiro'), nativeRoutes: ecc.release.nativeRoutes === undefined ? [] : [{ framework: ecc.release.framework.id, lines: ecc.release.nativeRoutes }],
    items: chosen.map(item => ({ item })) });
  const blocked = kiro.items.filter(entry => entry.support === 'none' || entry.notRendered || entry.staticBlockers?.length).map(entry => entry.item.itemId);
  assert.ok(blocked.length > 0, 'Core blocks some of them for Kiro CLI');
  const toolsOf = id => added.value.policy.selections.filter(selection => selection.item.itemId === id).map(selection => selection.tool);
  for (const id of blocked) {
    assert.ok(!toolsOf(id).includes('kiro'), `${id} is not installed for Kiro CLI, which Core blocks`);
    assert.ok(toolsOf(id).includes('claude'), `${id} goes to Claude Code`);
  }
});
