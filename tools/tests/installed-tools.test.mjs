import test from 'node:test';
import assert from 'node:assert/strict';
import { groupInstalled } from '../../src/app/installed-list.js';
import { previewRemoval } from '../../src/app/installed-removal.js';
import { previewUpdate, updateEntries } from '../../src/app/installed-update.js';

// One item installed for Claude Code and Codex CLI: the lead selection and its `--codex` copy, each with the notices
// file it needs, as an Add for several tools composes them (tools/consumer/headless.mjs).
const item = itemId => ({ framework: 'superpowers', itemId });
const selection = (itemId, tool, requires = []) => {
  const suffix = tool === 'claude' ? '' : `--${tool}`;
  return { id: `s-${itemId}${suffix}`, managementId: `m-${itemId}${suffix}`, scope: 'project', tool, item: item(itemId), requires: requires.map(other => `s-${other}${suffix}`) };
};
const policy = { selections: [selection('brainstorming', 'claude', ['notices']), selection('notices', 'claude'), selection('brainstorming', 'codex', ['notices']), selection('notices', 'codex')] };
const intent = { roots: [{ itemId: 'brainstorming' }], pins: [] };
const recorded = (entry, updateState = 'current') => ({ managementId: entry.managementId, scope: entry.scope, tool: entry.tool, item: entry.item, name: entry.item.itemId,
  updateState, origins: entry.item.itemId === 'brainstorming' ? [{ reasonIncluded: 'chosen' }] : [{ reasonIncluded: 'required-by', requiredBy: item('brainstorming') }],
  members: [{ path: `/p/${entry.managementId}`, fileState: 'matches' }] });
const inventory = (updateState) => ({ status: 'complete', selections: policy.selections.map(entry => recorded(entry, entry.item.itemId === 'brainstorming' ? updateState : 'current')) });
const toolName = id => ({ claude: 'Claude Code', codex: 'Codex CLI' })[id] ?? id;

test('an item installed for several tools is one row that names its tools', () => {
  for (const view of [groupInstalled({ inventory: inventory(), policy, intent, toolName }), groupInstalled({ inventory: inventory(), toolName })]) {
    assert.equal(view.groups.length, 1, JSON.stringify(view.groups.map(group => group.managementId)));
    const [row] = view.groups;
    assert.equal(row.managementId, 'm-brainstorming');
    assert.deepEqual(row.tools, ['claude', 'codex']);
    assert.deepEqual(row.toolNames, ['Claude Code', 'Codex CLI']);
    assert.deepEqual(view.others, []);
  }
});

test('Remove on that row asks Core about every copy in one request, and the confirmation lists each', async () => {
  const [row] = groupInstalled({ inventory: inventory(), policy, intent, toolName }).groups;
  assert.deepEqual(row.removes.map(entry => entry.managementId).sort(), ['m-brainstorming', 'm-brainstorming--codex', 'm-notices', 'm-notices--codex']);
  const calls = [];
  const request = async (operation, body) => {
    calls.push(body);
    return { disposition: 'prepared', diagnostics: [], removals: body.removals.map((removal, index) => ({ managementId: removal.managementId, disposition: 'prepared', change: 'remove-selection', diagnostics: [],
      members: [{ kind: 'file', path: `/p/${index}`, action: 'remove' }] })), preparation: { status: 'ready', sessionId: 's', review: { reviewDigest: 'd', operations: [] } } };
  };
  const preview = await previewRemoval({ entries: row.removes, request, mode: 'vibe' });
  assert.equal(calls.length, 1, 'one request');
  assert.deepEqual(calls[0].removals.map(removal => removal.managementId).sort(), ['m-brainstorming', 'm-brainstorming--codex', 'm-notices', 'm-notices--codex']);
  assert.equal(preview.canConfirm, true);
  assert.equal(preview.steps.length, 4);
  // Each copy is named with its tool in the confirmation.
  assert.ok(preview.steps.some(step => /Codex CLI/.test(step.entry.name)), preview.steps.map(step => step.entry.name).join(', '));
});

test('Update on that row sends every copy with an update, each with its recorded tool, in one request', async () => {
  const [row] = groupInstalled({ inventory: inventory('update-available'), policy, intent, toolName }).groups;
  const offered = { root: { releaseSha256: 'newer', itemId: 'brainstorming', itemSha256: 'x', scope: 'project', configuration: {} } };
  const entries = updateEntries({ item: row, offered });
  assert.deepEqual(entries.map(entry => [entry.managementId, entry.tool]), [['m-brainstorming', 'claude'], ['m-brainstorming--codex', 'codex']]);
  const calls = [];
  await previewUpdate({ entries, request: async (operation, body) => { calls.push(body); return { disposition: 'invalid', diagnostics: [] }; }, tool: 'claude', mode: 'vibe' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].updates.map(update => [update.managementId, update.tool]), [['m-brainstorming', 'claude'], ['m-brainstorming--codex', 'codex']]);
  assert.ok(calls[0].updates.every(update => update.copies === undefined), 'only the update itself is sent');
});
