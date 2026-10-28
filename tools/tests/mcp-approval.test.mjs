import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mcpApprovalView, approveOneServer } from '../../src/app/mcp-approval.js';

const claude = { id: 'claude', label: 'Claude Code' };
const mcpItem = { id: 'grill-server', kind: 'mcp-server' };
const fit = permissionStep => ({ item: { framework: 'ecc', itemId: 'grill-server' }, ...(permissionStep ? { permissionStep } : {}) });

test('non-MCP items and MCP items without a permission step carry no approval row', () => {
  assert.equal(mcpApprovalView({ id: 'x', kind: 'skill' }, fit('Approve in the tool.'), { approvalShape: 'object-keyed' }, claude).state, 'empty');
  assert.equal(mcpApprovalView(mcpItem, fit(undefined), { approvalShape: 'object-keyed' }, claude).state, 'empty');
});

test('the card words the need from Harness compatibility: still needs your OK in {tool}, requirements verbatim', () => {
  const view = mcpApprovalView(mcpItem, fit('Run /mcp and allow grill-server.'), { approvalShape: 'object-keyed' }, claude);
  assert.equal(view.state, 'checked');
  assert.equal(view.approvable, true);
  assert.match(view.words, /^Still needs your OK in Claude Code$/);
  assert.equal(view.requirements, 'Run /mcp and allow grill-server.');
});

test('an unwritable approval shape offers no tick and says to approve in the tool', () => {
  for (const shape of [null, 'other']) {
    const view = mcpApprovalView(mcpItem, fit('Open Settings and enable grill-server.'), { approvalShape: shape }, claude);
    assert.equal(view.state, 'checked');
    assert.equal(view.approvable, false, `shape ${shape}`);
    assert.match(view.words, /^Approve in Claude Code instead$/);
    assert.match(view.reason, /^Core cannot write Claude Code's approval for one server\./);
    assert.equal(view.requirements, 'Open Settings and enable grill-server.');
  }
});

test('empty, loading, unavailable and failed states are explicit', () => {
  assert.equal(mcpApprovalView(mcpItem, undefined, undefined, claude).state, 'loading');
  assert.equal(mcpApprovalView(mcpItem, undefined, { status: 'read' }, claude).state, 'unavailable');
  assert.equal(mcpApprovalView(mcpItem, undefined, { status: 'failed', reason: 'Compatibility could not be checked.' }, claude).state, 'failed');
  assert.match(mcpApprovalView(mcpItem, undefined, { status: 'failed', reason: 'x' }, claude).words, /^Couldn't check what Claude Code needs\./);
});

test('cross-server isolation: the opt-in names exactly one server and forwards the public render', async () => {
  const calls = [];
  const renderDelivery = request => { calls.push(request); return { status: 'rendered', recipe: { schema: 'urn:aihq:core:recipe:1.4.0' } }; };
  const answer = await approveOneServer(renderDelivery, { tool: 'claude', item: mcpItem, grantApproval: { framework: 'ecc', itemId: 'grill-server' } });
  assert.equal(answer.status, 'rendered');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].grantApproval, { framework: 'ecc', itemId: 'grill-server' }, 'exactly the one server, never a list');
  await assert.rejects(() => approveOneServer(renderDelivery, { grantApproval: { framework: 'ecc' } }), /Name the one MCP server/);
  await assert.rejects(() => approveOneServer(renderDelivery, { grantApproval: { framework: 'ecc', itemId: 'a', extra: 1 } }), /Name the one MCP server/);
  assert.equal(calls.length, 1, 'rejected opt-ins never reach the public render');
});
