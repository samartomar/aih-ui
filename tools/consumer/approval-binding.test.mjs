// Q2 (connected) regression through the real consumer authoring chain: a renderer-produced one-server
// approval survives unchanged, same-ID tampered executable operations do not, and an explicit untick
// revokes. Uses the real checked ECC prepared fixture and the public Harness renderer — no mocks of Core.
// Runs in the consumer context (check:workbench copies it beside the other consumer tests).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { readAuthoring, composeAuthoring, editAuthoring, freshAuthoring } from './headless.mjs';
import { pinSelectedRecipes } from './selected-recipe.mjs';
import { readInstalledPreparedContent } from '@aihq/catalog/node';
import { parsePolicy, validateRecipe } from '@aihq/core/contracts';

const catalogRoot = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
const prepared = await readInstalledPreparedContent({ root: catalogRoot, frameworkId: 'ecc', sourceInput: 'approval-binding-test' });
if (!prepared.valid) throw new Error('ECC prepared fixture unavailable: ' + JSON.stringify(prepared.diagnostics));
const mcp = prepared.release.items.find(item => item.kind === 'mcp-server');
if (!mcp) throw new Error('ECC fixture carries no MCP server item');
const inventories = [{ release: prepared.release, family: prepared.release.framework.name, materialSource: { kind: 'local', input: 'approval-binding-test' }, materials: [], fixture: 'approval binding regression' }];
const root = { releaseSha256: prepared.release.sha256, itemId: mcp.id, itemSha256: mcp.itemSha256, scope: 'project', configuration: {}, originIds: ['direct'] };
const freshIntent = () => { const intent = freshAuthoring(); intent.roots.push(structuredClone(root)); pinSelectedRecipes(intent, inventories, root, 'claude'); return intent; };
const approvalOp = granted => ({ type: 'mcp-approval', root: { releaseSha256: prepared.release.sha256, itemId: mcp.id, scope: 'project' }, granted });

test('a ticked one-server approval is renderer-produced, retained unchanged on read, and revocable', async () => {
  const composed = await composeAuthoring({ intent: freshIntent(), inventories });
  assert.equal(composed.status, 'ok', JSON.stringify(composed.diagnostics));
  const ticked = await editAuthoring({ policyBytes: composed.value.policyBytes, inventories, operation: approvalOp(true), tool: 'claude', grantApproval: { framework: prepared.release.framework.id, itemId: mcp.id } });
  assert.equal(ticked.status, 'ok', JSON.stringify(ticked.diagnostics));
  const selection = ticked.value.policy.selections.find(entry => entry.item?.itemId === mcp.id);
  assert.ok(selection?.recipe?.inline, 'the ticked selection carries the rendered inline recipe');
  assert.match(selection.recipe.inline.id, new RegExp(`^claude\\.${mcp.id}$`));
  assert.ok(selection.recipe.inline.operations.some(operation => operation.id === 'approve-server'), 'the rendered approval operation is present');

  // Read back without granting again: the recorded approval stands only because the public renderer
  // reproduces it exactly for this checked item/tool/scope.
  const read = await readAuthoring({ policyBytes: ticked.value.policyBytes, inventories });
  assert.equal(read.status, 'ok', JSON.stringify(read.diagnostics));
  assert.equal(read.value.editing, 'available', JSON.stringify(read.value.diagnostics));
  const reread = read.value.policy.selections.find(entry => entry.item?.itemId === mcp.id);
  assert.ok(reread?.recipe?.inline, 'the verified approval recipe is retained on read');
  assert.equal(reread.tool, 'claude');

  // An explicit untick revokes: the approval operation is gone and the selection returns to its reference.
  const unticked = await editAuthoring({ policyBytes: ticked.value.policyBytes, inventories, operation: approvalOp(false), tool: 'claude', revokeApproval: { framework: prepared.release.framework.id, itemId: mcp.id } });
  assert.equal(unticked.status, 'ok', JSON.stringify(unticked.diagnostics));
  const undone = unticked.value.policy.selections.find(entry => entry.item?.itemId === mcp.id);
  assert.ok(!JSON.stringify(undone?.recipe ?? {}).includes('approve-server'), 'untick removes the approval');
});

test('a schema-valid same-ID recipe with altered executable content is not retained (blocked, not silently editable)', async () => {
  const composed = await composeAuthoring({ intent: freshIntent(), inventories });
  const ticked = await editAuthoring({ policyBytes: composed.value.policyBytes, inventories, operation: approvalOp(true), tool: 'claude', grantApproval: { framework: prepared.release.framework.id, itemId: mcp.id } });
  assert.equal(ticked.status, 'ok');
  // A validly shaped imported policy whose inline recipe id matches, but whose executable content was
  // altered (the registered server URL). Both the recipe schema and the policy parse accept it - the
  // checked-renderer binding is what must catch it.
  const tampered = JSON.parse(new TextDecoder().decode(ticked.value.policyBytes));
  const victim = tampered.selections.find(entry => entry.item?.itemId === mcp.id);
  const register = victim.recipe.inline.operations.find(operation => operation.id === 'register-server');
  const urlEntry = register.entries.find(entry => entry.path.join('/') === `mcpServers/${mcp.name ?? mcp.id}/url`);
  assert.ok(urlEntry, 'the fixture registers a url entry');
  urlEntry.value.literal = 'https://tampered.example/v3/mcp';
  assert.equal(validateRecipe(victim.recipe.inline).valid, true, 'the tampered recipe stays schema-valid (the premise of the attack)');
  const tamperedBytes = new TextEncoder().encode(JSON.stringify(tampered));
  assert.equal(parsePolicy(new TextDecoder().decode(tamperedBytes)).valid, true, 'the tampered policy parses');
  const read = await readAuthoring({ policyBytes: tamperedBytes, inventories });
  assert.equal(read.status, 'ok');
  assert.equal(read.value.editing, 'unavailable', 'a recipe the renderer does not reproduce must not stay silently editable');
  assert.match(JSON.stringify(read.value.diagnostics), /contradict|metadata|selection/i);
  // And the tampered content never becomes the retained recipe of any editable composition.
  const retained = JSON.stringify(read.value.policy.selections.find(entry => entry.item?.itemId === mcp.id)?.recipe ?? {});
  assert.ok(!retained.includes('tampered.example') || read.value.editing !== 'available',
    'the tampered executable content must never ride the id-match into an editable policy');
});

test('a supported scope transition does not transplant the saved approval', async () => {
  // Genuine connected transition (Q2 residual): the supported operations change scope by dropping the
  // project root and selecting the same item at user scope - never an invented in-place edit.
  const composed = await composeAuthoring({ intent: freshIntent(), inventories, tool: 'claude', grantApproval: { framework: prepared.release.framework.id, itemId: mcp.id } });
  assert.equal(composed.status, 'ok');
  const moved = freshIntent();
  moved.roots = moved.roots.map(root => ({ ...root, scope: 'user' }));
  const recomposed = await composeAuthoring({ basePolicyBytes: composed.value.policyBytes, intent: moved, inventories, tool: 'claude' });
  assert.equal(recomposed.status, 'ok', JSON.stringify(recomposed.diagnostics ?? []));
  const selection = recomposed.value.policy.selections.find(entry => entry.item?.itemId === mcp.id);
  assert.equal(selection?.scope, 'user');
  assert.ok(!JSON.stringify(selection?.recipe ?? {}).includes('approve-server'), 'the recorded approval must not be transplanted across a scope transition');
});

test('an approval edit refuses to mix the requested tool with the recorded recipe tool', async () => {
  const composed = await composeAuthoring({ intent: freshIntent(), inventories });
  const ticked = await editAuthoring({ policyBytes: composed.value.policyBytes, inventories, operation: approvalOp(true), tool: 'claude', grantApproval: { framework: prepared.release.framework.id, itemId: mcp.id } });
  assert.equal(ticked.status, 'ok');
  const mixed = await editAuthoring({ policyBytes: ticked.value.policyBytes, inventories, operation: approvalOp(true), tool: 'codex', grantApproval: { framework: prepared.release.framework.id, itemId: mcp.id } });
  assert.equal(mixed.status, 'refused');
  assert.deepEqual(mixed.originalBytes, ticked.value.policyBytes, 'the original selection and recipe bytes are retained');
  assert.match(mixed.diagnostics.map(diagnostic => diagnostic.message).join(' '), /recorded tool claude.*requested tool codex/);
});

test('exact unchanged approval survives; a fresh policy under another tool carries no approval', async () => {
  // A fresh policy under another tool carries no approval (the supported scope-transition case is
  // exercised separately above).
  const composed = await composeAuthoring({ intent: freshIntent(), inventories });
  const ticked = await editAuthoring({ policyBytes: composed.value.policyBytes, inventories, operation: approvalOp(true), tool: 'claude', grantApproval: { framework: prepared.release.framework.id, itemId: mcp.id } });
  assert.equal(ticked.status, 'ok');
  // Exact unchanged approval on read: retained, editing available.
  const read = await readAuthoring({ policyBytes: ticked.value.policyBytes, inventories });
  assert.equal(read.value.editing, 'available', JSON.stringify(read.value.diagnostics));
  // Changed composing tool: the saved selection keeps its recorded claude identity (no rebind), and a
  // fresh compose under another tool carries no claude approval.
  const other = await composeAuthoring({ intent: freshIntent(), inventories, tool: 'codex' });
  assert.equal(other.status, 'ok');
  const foreign = other.value.policy.selections.find(entry => entry.item?.itemId === mcp.id);
  assert.ok(!JSON.stringify(foreign?.recipe ?? {}).includes('approve-server'), 'a fresh policy under another tool carries no approval');
});
