// Several chosen tools against the real Core and Catalog: an item goes to each chosen tool Core renders it for, and to no
// other. Core prepares and applies the result; the saved policy reads back as the same setup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeAuthoring, editAuthoring, freshAuthoring, readAuthoring } from './headless.mjs';
import { installedFamilies } from './installed-families.mjs';
import { browseContent } from './browse-content.mjs';
import { createHost } from './host.mjs';

const catalogRoot = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
const inventories = await installedFamilies({ root: catalogRoot, sourceInput: 'managed-inventory-index' });
const ecc = inventories.find(entry => entry.family === 'ECC');
const skill = ecc.release.items.find(item => item.kind === 'skill' && !Object.keys(item.requirements?.inputs ?? {}).length);
const server = ecc.release.items.find(item => item.kind === 'mcp-server' && !Object.keys(item.requirements?.inputs ?? {}).length);
const rootOf = item => ({ releaseSha256: ecc.release.sha256, itemId: item.id, itemSha256: item.itemSha256, scope: 'project', configuration: {}, originIds: ['direct'] });
const host = projectRoot => createHost({ projectRoot,
  materialRoots: { ...Object.fromEntries(inventories.map(entry => [entry.materialSource.input, catalogRoot])), catalog: catalogRoot },
  recipeMaterials: inventories.flatMap(entry => entry.materials), controls: { logging: 'off' }, inventories });

test('one Add for Claude Code and Codex CLI installs the item for both, and the policy reads back as the same setup', async t => {
  const intent = freshAuthoring(); intent.roots.push(rootOf(skill));
  const composed = await composeAuthoring({ intent, inventories, tool: 'claude', tools: ['claude', 'codex'] });
  assert.equal(composed.status, 'ok', JSON.stringify(composed.diagnostics ?? []));
  const mine = composed.value.policy.selections.filter(selection => selection.item?.itemId === skill.id);
  assert.deepEqual(mine.map(selection => selection.tool).sort(), ['claude', 'codex']);
  assert.equal(new Set(mine.map(selection => selection.managementId)).size, 2, 'each tool has its own management identity');
  const reopened = await readAuthoring({ policyBytes: composed.value.policyBytes, inventories });
  assert.equal(reopened.value.editing, 'available', JSON.stringify(reopened.value.diagnostics ?? []));

  const scratch = await mkdtemp(join(tmpdir(), 'aih-multi-tool-')), project = join(scratch, 'project');
  await mkdir(project, { recursive: true }); t.after(() => rm(scratch, { recursive: true, force: true }));
  const installing = host(project);
  const prepared = await installing.prepareSession({ policyText: new TextDecoder().decode(composed.value.policyBytes) });
  assert.equal(prepared.status, 'ready', JSON.stringify(prepared).slice(0, 2000));
  const applied = await installing.applyApproved({ sessionId: prepared.sessionId, reviewDigest: prepared.review.reviewDigest });
  assert.equal(applied.completion, 'complete', JSON.stringify(applied).slice(0, 2000));
  const listed = await installing.managedInventory();
  assert.deepEqual(listed.selections.filter(selection => selection.item?.itemId === skill.id).map(selection => selection.tool).sort(), ['claude', 'codex']);
  const dirName = skill.payload?.dirName ?? skill.id.split('.').at(-1);
  assert.ok(existsSync(join(project, '.claude/skills', dirName, 'SKILL.md')), 'Claude Code has the skill');
  assert.ok(existsSync(join(project, '.agents/skills', dirName, 'SKILL.md')), 'Codex CLI has the skill');
});

test('an MCP server Core cannot place for Codex CLI goes to Claude Code only, and a later Add keeps the saved tools', async () => {
  const empty = await composeAuthoring({ intent: freshAuthoring(), inventories });
  const added = await editAuthoring({ policyBytes: empty.value.policyBytes, inventories, tool: 'claude', tools: ['claude', 'codex'], operation: { type: 'select', root: rootOf(server) } });
  assert.equal(added.status, 'ok', JSON.stringify(added.diagnostics ?? []));
  assert.deepEqual(added.value.policy.selections.filter(selection => selection.item?.itemId === server.id).map(selection => selection.tool), ['claude']);
  // Codex alone first: Core refuses the server there, so it would not be addable with Codex as the only tool.
  const alone = await editAuthoring({ policyBytes: empty.value.policyBytes, inventories, tool: 'codex', operation: { type: 'select', root: rootOf(server) } });
  assert.equal(alone.status, 'refused');
  // Another Add with only Claude Code chosen leaves the server's saved tools as they were.
  const more = await editAuthoring({ policyBytes: added.value.policyBytes, inventories, tool: 'claude', operation: { type: 'select', root: rootOf(skill) } });
  assert.equal(more.status, 'ok', JSON.stringify(more.diagnostics ?? []));
  assert.deepEqual(more.value.policy.selections.filter(selection => selection.item?.itemId === skill.id).map(selection => selection.tool), ['claude']);
});

test('tools that share a project location each get their own copy of a skill', async () => {
  const intent = freshAuthoring(); intent.roots.push(rootOf(skill));
  const composed = await composeAuthoring({ intent, inventories, tool: 'codex', tools: ['codex', 'antigravity'] });
  assert.equal(composed.status, 'ok', JSON.stringify(composed.diagnostics ?? []));
  assert.deepEqual(composed.value.policy.selections.filter(selection => selection.item?.itemId === skill.id).map(selection => selection.tool), ['codex', 'antigravity'],
    'Core renders both to the same .agents paths and keeps a shared file while another selection owns it');
});

test('the browse answer judges each item in every chosen tool, from Core', async () => {
  const result = await browseContent(inventories, { tools: ['claude', 'codex', 'cursor'], releaseSha256: ecc.release.sha256 });
  assert.equal(result.status, 'read');
  assert.deepEqual(result.tools.map(tool => tool.id), ['claude', 'codex']);
  assert.deepEqual(result.refusedTools.map(tool => tool.id), ['cursor'], 'a tool Core has not observed gets no fit');
  const fitOf = item => Object.fromEntries(result.fit.find(entry => entry.itemId === item.id).tools.map(tool => [tool.tool, tool.fits]));
  assert.deepEqual(fitOf(skill), { claude: true, codex: true });
  assert.deepEqual(fitOf(server), { claude: true, codex: false });
  assert.match(result.fit.find(entry => entry.itemId === server.id).tools.find(tool => tool.tool === 'codex').reason, /project location/);
  assert.equal(result.recipes.find(recipe => recipe.itemId === skill.id).available, true, 'Core renders it, so no Catalog per-client recipe is needed');
});
