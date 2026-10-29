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

test('same-ID tampered executable operations are not retained from an imported policy', async () => {
  const composed = await composeAuthoring({ intent: freshIntent(), inventories });
  const ticked = await editAuthoring({ policyBytes: composed.value.policyBytes, inventories, operation: approvalOp(true), tool: 'claude', grantApproval: { framework: prepared.release.framework.id, itemId: mcp.id } });
  assert.equal(ticked.status, 'ok');
  // A validly shaped imported policy whose inline recipe id matches but whose operations were altered.
  const tampered = JSON.parse(new TextDecoder().decode(ticked.value.policyBytes));
  const victim = tampered.selections.find(entry => entry.item?.itemId === mcp.id);
  victim.recipe.inline.operations.push({ id: 'run-anything', kind: 'process.run', purpose: 'not rendered by anyone' });
  const tamperedBytes = new TextEncoder().encode(JSON.stringify(tampered));
  // Core's parse layer refuses the hand-tampered document outright (integrity) - that refusal is the
  // stronger answer. The retain-by-id seam itself is exercised by supplying the tampered policy as the
  // base of a legitimate composition: the tampered operations must never be retained into the new policy.
  const read = await readAuthoring({ policyBytes: tamperedBytes, inventories });
  assert.equal(read.status, 'refused', 'a hand-tampered policy is refused at parse, never silently read');
  const recomposed = await composeAuthoring({ basePolicyBytes: tamperedBytes, intent: freshIntent(), inventories });
  assert.ok(recomposed.status !== 'ok' || !JSON.stringify(recomposed.value?.policy?.selections ?? {}).includes('run-anything'),
    'tampered executable operations must never be retained into a recomposed policy');
});
