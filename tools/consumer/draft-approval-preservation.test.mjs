// Q3 (connected, draft preservation) regression: ticking/unticking the one MCP server inside an OPEN
// DRAFT must preserve the draft's live pending choices (roots/exclusions not yet in the saved base) and
// every recorded choice, render the approval through the public renderer, and refuse stale replies.
// Drives the real UI-owned consumer functions (openDraft/editDraft/editAuthoring/composeAuthoring) with
// only the transport stubbed; the checked ECC prepared fixture supplies the MCP server.
// Runs in the consumer context.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { readInstalledPreparedContent } from '@aihq/catalog/node';
import { parsePolicy } from '@aihq/core/contracts';
import { composeAuthoring, openDraft, editDraft, editAuthoring, freshAuthoring } from './headless.mjs';
import { pinSelectedRecipes } from './selected-recipe.mjs';
import { writeJourneyEnvelope, DRAFT_RECORD_SCHEMA } from './journey.mjs';
import { MAINTENANCE_CHECK_RECORD_SCHEMA, MAINTENANCE_CHECK_RECORD_ID } from './maintenance-record.mjs';
import { renderDelivery, toolBindings } from '@aihq/core/harness';
import { resolveSelections } from '@aihq/catalog/reader';
import { createAuthoringClient } from '../page/app/authoring-client.js';

const catalogRoot = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
const prepared = await readInstalledPreparedContent({ root: catalogRoot, frameworkId: 'ecc', sourceInput: 'draft-approval-preservation' });
if (!prepared.valid) throw new Error('ECC prepared fixture unavailable');
const claudeBinding = toolBindings.find(binding => binding.tool === 'claude');
const renderable = item => item.kind === 'mcp-server' && renderDelivery({ tool: 'claude', item, binding: claudeBinding, scope: 'project', grantApproval: { framework: prepared.release.framework.id, itemId: item.id } }).status === 'rendered';
const resolvableWith = (a, b) => {
  const releases = { [prepared.release.sha256]: prepared.release };
  const roots = [a, b].filter(Boolean).map(item => ({ releaseSha256: prepared.release.sha256, itemId: item.id, scope: 'project', configuration: {} }));
  return resolveSelections({ releases, roots, skips: [] }).status === 'ok';
};
const mcpServers = prepared.release.items.filter(renderable);
const mcp = mcpServers.find(candidate => resolvableWith(candidate, undefined));
const secondMcp = mcpServers.find(candidate => candidate !== mcp && resolvableWith(mcp, candidate));
if (!mcp || !secondMcp) throw new Error('ECC fixture needs two jointly resolvable renderable MCP servers');
const plainSkills = prepared.release.items.filter(item => item.kind === 'skill' && !Object.keys(item.inputs ?? {}).length);
const skill = plainSkills[0], skipped = plainSkills[1];
if (!mcp || !skill || !skipped) throw new Error('ECC fixture lacks the required items');
const inventories = [{ release: prepared.release, family: prepared.release.framework.name, materialSource: { kind: 'local', input: 'draft-approval-preservation' }, materials: [], fixture: 'draft approval preservation regression' }];
const rootOf = item => ({ releaseSha256: prepared.release.sha256, itemId: item.id, itemSha256: item.itemSha256, scope: 'project', configuration: {}, originIds: ['direct'] });
const baseIntent = () => { const intent = freshAuthoring(); intent.roots.push(rootOf(mcp)); pinSelectedRecipes(intent, inventories, rootOf(mcp), 'claude'); return intent; };
const approvalOp = granted => ({ type: 'mcp-approval', root: { releaseSha256: prepared.release.sha256, itemId: mcp.id, scope: 'project' }, granted });

/** The real service seam: transport stubbed, every operation executed by the actual consumer functions. */
function stubTransport() {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const operation = String(url).replace('/api/authoring-', '');
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push({ operation, body });
    let result;
    if (operation === 'catalog') result = { frameworks: [], items: [] };
    else if (operation === 'draft-open') result = await openDraft({ bytes: Uint8Array.from(body.bytes), inventories });
    else if (operation === 'draft-edit') result = await editDraft({ envelopeBytes: Uint8Array.from(body.envelopeBytes), inventories, operation: body.operation, ...(body.tool !== undefined ? { tool: body.tool } : {}) });
    else if (operation === 'edit') result = await editAuthoring({ policyBytes: Uint8Array.from(body.policyBytes), inventories, operation: body.operation, ...(body.tool !== undefined ? { tool: body.tool } : {}) });
    else throw new Error('unexpected operation ' + operation);
    return { ok: true, status: 200, json: async () => result };
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

// The saved base is composed for the tool the approval is rendered for: a rendered policy (1.5) needs the composing tool.
/** A REAL envelope whose draft record carries pending choices that the saved base does NOT contain. */
async function draftWithPendingChoice() {
  const intent = baseIntent();
  const saved = await composeAuthoring({ intent, inventories, tool: 'claude' });
  assert.equal(saved.status, 'ok', JSON.stringify(saved.diagnostics));
  const pending = structuredClone(intent);
  pending.roots.push(rootOf(skill)); // selected after the base was saved: pending, not in savedIntentBytes
  pending.exclusions.push({ originId: 'direct', releaseSha256: prepared.release.sha256, itemId: skipped.id, scope: 'project', reason: 'TEST pending exclusion' });
  const written = await writeJourneyEnvelope({ savedIntentBytes: saved.value.policyBytes, records: [{ id: 'draft', schema: DRAFT_RECORD_SCHEMA, required: true, intent: pending }] });
  assert.equal(written.status, 'ok', JSON.stringify(written.diagnostics));
  return { envelopeBytes: written.value.envelopeBytes, pendingRootId: skill.id };
}

const b64 = bytes => Buffer.from(bytes).toString('base64');
function stubSessionStorage(envelopeBytes) {
  const original = globalThis.sessionStorage;
  globalThis.sessionStorage = { getItem: key => key === 'aih.workbench.accepted.v1' ? JSON.stringify({ base64: b64(envelopeBytes), dirty: true }) : null, setItem: () => {}, removeItem: () => {} };
  return () => { if (original === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = original; };
}

async function recoveredDraft() {
  const { envelopeBytes, pendingRootId } = await draftWithPendingChoice();
  const restoreStorage = stubSessionStorage(envelopeBytes);
  const stub = stubTransport();
  const client = createAuthoringClient();
  try { await client.start(); } finally { restoreStorage(); } // recovery path adopts the envelope as an open draft
  return { client, stub, pendingRootId };
}

test('ticking the server inside an open draft preserves pending roots, exclusions, and renders the approval', async () => {
  const { client, stub, pendingRootId } = await recoveredDraft();
  try {
    assert.ok(client.draft, 'draft recovered');
    client.setTool('claude');
    assert.ok(client.draft.intent.roots.some(root => root.itemId === pendingRootId), 'pending root lives in the live draft intent');
    const ticked = await client.recordApproval(approvalOp(true));
    assert.equal(ticked.status, 'ok', JSON.stringify(ticked.diagnostics));
    assert.ok(client.draft, 'the draft stays open');
    assert.ok(client.draft.intent.roots.some(root => root.itemId === pendingRootId), 'the pending root survives the approval');
    assert.equal(client.draft.intent.exclusions.length, 1, 'the pending exclusion survives the approval');
    const edit = stub.calls.find(call => call.operation === 'draft-edit');
    assert.ok(edit, 'the approval went through the draft-edit route');
    assert.equal(edit.body.tool, 'claude', 'the chosen tool rides the approval request for the renderer');
    const parsed = parsePolicy(new TextDecoder().decode(ticked.value.savedIntentBytes));
    assert.equal(parsed.valid, true, JSON.stringify(parsed.diagnostics));
    const mcpSelection = parsed.document.selections.find(entry => entry.item?.itemId === mcp.id);
    assert.ok(mcpSelection?.recipe?.inline?.operations?.some(operation => operation.id === 'approve-server'), 'the approval is rendered into the draft');
    const unticked = await client.recordApproval(approvalOp(false));
    assert.equal(unticked.status, 'ok', JSON.stringify(unticked.diagnostics));
    assert.ok(client.draft.intent.roots.some(root => root.itemId === pendingRootId), 'pending root intact after untick');
    assert.equal(client.draft.intent.exclusions.length, 1, 'pending exclusion intact after untick');
    const after = await editDraft({ envelopeBytes: Uint8Array.from(client.draft.envelopeBytes), inventories, operation: approvalOp(false), tool: 'claude' });
    assert.equal(after.status, 'ok');
    const afterParsed = parsePolicy(new TextDecoder().decode(after.value.savedIntentBytes));
    const selection = afterParsed.document.selections.find(entry => entry.item?.itemId === mcp.id);
    assert.ok(!JSON.stringify(selection?.recipe ?? {}).includes('approve-server'), 'untick revokes inside the draft');
  } finally { stub.restore(); }
});

test('the ordinary (non-draft) approval path sends policyBytes and no body.bytes', async () => {
  const stub = stubTransport();
  try {
    delete globalThis.sessionStorage; // this leg starts from a plain policy, not a recovered draft
    const client = createAuthoringClient();
    // Prime an ordinary policy through the real edit seam via recovery of a plain policy is complex;
    // drive newDraft through the transport instead.
    globalThis.fetch = async (url, init) => {
      const operation = String(url).replace('/api/authoring-', '');
      const body = init.body ? JSON.parse(init.body) : {};
      stub.calls.push({ operation, body });
      if (operation === 'catalog') return { ok: true, status: 200, json: async () => ({ frameworks: [], items: [] }) };
      if (operation === 'new') {
        const intent = baseIntent();
        const saved = await composeAuthoring({ intent, inventories, tool: 'claude' });
        return { ok: true, status: 200, json: async () => ({ status: 'ok', value: { policyBytes: [...saved.value.policyBytes], intent: saved.value.intent } }) };
      }
      if (operation === 'edit') return { ok: true, status: 200, json: async () => editAuthoring({ policyBytes: Uint8Array.from(body.policyBytes), inventories, operation: body.operation, ...(body.tool !== undefined ? { tool: body.tool } : {}) }) };
      throw new Error('unexpected ' + operation);
    };
    await client.start();
    client.setTool('claude');
    assert.equal(client.draft, undefined);
    const ticked = await client.recordApproval(approvalOp(true));
    assert.equal(ticked.status, 'ok', JSON.stringify(ticked.diagnostics));
    const edit = stub.calls.find(call => call.operation === 'edit');
    assert.ok(Array.isArray(edit.body.policyBytes), 'policyBytes present');
    assert.equal(edit.body.bytes, undefined, 'body.bytes is not the contract');
  } finally { stub.restore(); }
});

test('ticking one server preserves the other server\'s recorded approval byte-for-byte, plus pending choices and other records', async () => {
  // Base policy: A approved, B not; then a draft envelope carrying pending choices and a second record.
  const intent = baseIntent();
  intent.roots.push(rootOf(secondMcp));
  pinSelectedRecipes(intent, inventories, rootOf(secondMcp), 'claude');
  const saved = await composeAuthoring({ intent, inventories, tool: 'claude', grantApproval: { framework: prepared.release.framework.id, itemId: mcp.id } });
  assert.equal(saved.status, 'ok', JSON.stringify(saved.diagnostics));
  const baseParsed = parsePolicy(new TextDecoder().decode(saved.value.policyBytes));
  const baseRecipeA = JSON.stringify(baseParsed.document.selections.find(entry => entry.item?.itemId === mcp.id).recipe);
  const pending = structuredClone(intent);
  pending.roots.push(rootOf(skill));
  pending.exclusions.push({ originId: 'direct', releaseSha256: prepared.release.sha256, itemId: skipped.id, scope: 'project', reason: 'TEST pending exclusion' });
  const secondRecord = { id: MAINTENANCE_CHECK_RECORD_ID, schema: MAINTENANCE_CHECK_RECORD_SCHEMA, required: false, checkedAt: '2026-10-29T00:00:00.000Z', categories: [{ category: 'content', state: 'checked' }] };
  const written = await writeJourneyEnvelope({ savedIntentBytes: saved.value.policyBytes, records: [{ id: 'draft', schema: DRAFT_RECORD_SCHEMA, required: true, intent: pending }, secondRecord] });
  assert.equal(written.status, 'ok', JSON.stringify(written.diagnostics));
  const restoreStorage = stubSessionStorage(written.value.envelopeBytes);
  const stub = stubTransport();
  const client = createAuthoringClient();
  try {
    await client.start();
    client.setTool('claude');
    assert.ok(client.draft.intent.roots.some(root => root.itemId === skill.id), 'pending root present');
    const tickB = await client.recordApproval({ type: 'mcp-approval', root: { releaseSha256: prepared.release.sha256, itemId: secondMcp.id, scope: 'project' }, granted: true });
    assert.equal(tickB.status, 'ok', JSON.stringify(tickB.diagnostics));
    const after = parsePolicy(new TextDecoder().decode(tickB.value.savedIntentBytes));
    const recipeA = JSON.stringify(after.document.selections.find(entry => entry.item?.itemId === mcp.id).recipe);
    const recipeB = after.document.selections.find(entry => entry.item?.itemId === secondMcp.id).recipe;
    assert.equal(recipeA, baseRecipeA, 'the other server\'s recorded approval is preserved byte-for-byte');
    assert.ok(recipeB?.inline?.operations?.some(operation => operation.id === 'approve-server'), 'only B gains the approval');
    assert.ok(client.draft.intent.roots.some(root => root.itemId === skill.id), 'pending root survives');
    assert.equal(client.draft.intent.exclusions.length, 1, 'pending exclusion survives');
    const reloaded = await import('./journey.mjs').then(m => m.readJourneyEnvelope(client.draft.envelopeBytes));
    assert.equal(reloaded.value.records.length, 2, 'the second envelope record is preserved');
    const untickB = await client.recordApproval({ type: 'mcp-approval', root: { releaseSha256: prepared.release.sha256, itemId: secondMcp.id, scope: 'project' }, granted: false });
    assert.equal(untickB.status, 'ok', JSON.stringify(untickB.diagnostics));
    const undone = parsePolicy(new TextDecoder().decode(untickB.value.savedIntentBytes));
    assert.equal(JSON.stringify(undone.document.selections.find(entry => entry.item?.itemId === mcp.id).recipe), baseRecipeA, 'A still byte-for-byte after B untick');
    assert.ok(!JSON.stringify(undone.document.selections.find(entry => entry.item?.itemId === secondMcp.id).recipe).includes('approve-server'), 'B approval revoked');
  } finally { restoreStorage(); stub.restore(); }
});

test('a stale approval reply across a newly opened artifact is refused and the draft is untouched', async () => {
  const { client, stub, pendingRootId } = await recoveredDraft();
  try {
    let resolveEdit;
    const gate = new Promise(resolve => { resolveEdit = resolve; });
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const operation = String(url).replace('/api/authoring-', '');
      if (operation !== 'draft-edit') return original(url, init);
      const body = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => { await gate; return editDraft({ envelopeBytes: Uint8Array.from(body.envelopeBytes), inventories, operation: body.operation }); } };
    };
    client.setTool('claude');
    const pending = client.recordApproval(approvalOp(true));
    client.invalidate();
    resolveEdit();
    const result = await pending;
    assert.equal(result.status, 'superseded');
    assert.ok(client.draft.intent.roots.some(root => root.itemId === pendingRootId), 'draft choices untouched by the stale reply');
  } finally { stub.restore(); }
});
