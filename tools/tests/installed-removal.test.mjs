import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmRemoval, previewRemoval } from '../../src/app/installed-removal.js';

const entries = [
  { name: 'chosen', managementId: 'm-chosen', scope: 'project' },
  { name: 'needed', managementId: 'm-needed', scope: 'project' },
];
const ready = (overrides = {}) => ({
  disposition: 'prepared', diagnostics: [],
  removals: entries.map((entry, index) => ({ managementId: entry.managementId, disposition: 'prepared', change: 'remove-selection', diagnostics: [],
    members: [{ kind: 'file', path: `/project/${index}.md`, action: 'remove', operationId: `lifecycle/remove-${index}` }] })),
  preparation: { status: 'ready', sessionId: 'session-1', review: { reviewDigest: 'digest-1', operations: [] } },
  ...overrides,
});

test('several items are prepared once through removal 1.2 and applied once with absent outcomes', async () => {
  const calls = [];
  const request = async (operation, body) => {
    calls.push([operation, body]);
    if (operation === 'remove') return ready();
    return { completion: 'complete', diagnostics: [], members: entries.flatMap((entry, index) => [
      { managementId: entry.managementId, path: `/project/${index}.md`, intent: 'remove', outcome: 'claim-removed', check: 'absent' },
    ]) };
  };
  const preview = await previewRemoval({ entries, request, mode: 'vibe' });
  assert.equal(preview.canConfirm, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1].removals.map(entry => entry.managementId), ['m-chosen', 'm-needed']);
  const result = await confirmRemoval({ preview, request, mode: 'vibe' });
  assert.equal(calls.filter(([operation]) => operation === 'apply').length, 1);
  assert.equal(result.outcome, 'removed');
  // `removed` is the contract's state for a Core-confirmed absence; it has no sentence of its own.
  assert.equal(result.message, 'chosen: removed needed: removed');
  assert.doesNotMatch(result.message, /unverified/i);
});

test('set origins and kept members retain their exact Core actions and reasons', async () => {
  const origin = { set: { framework: 'extensions', setId: 'productivity', setSha256: 'a'.repeat(64) } };
  const request = async operation => {
    if (operation === 'remove') return ready({ removals: entries.map((entry, index) => ({ managementId: entry.managementId, disposition: 'prepared', change: 'remove-origin', diagnostics: [],
      members: [{ kind: 'file', path: `/project/${index}.md`, action: 'keep-shared', reason: 'shared-content', operationId: null }] })) });
    return { completion: 'complete', diagnostics: [], members: entries.map((entry, index) => ({ managementId: entry.managementId, path: `/project/${index}.md`, outcome: 'kept', check: 'unchecked' })) };
  };
  // The panel supplies the contract's sentence with the other set's Catalog name.
  const withOrigins = entries.map(entry => ({ ...entry, origin, kept: 'Kept; also part of productivity' }));
  const preview = await previewRemoval({ entries: withOrigins, request, mode: 'vibe' });
  assert.deepEqual(preview.selectors.map(entry => entry.origin), [origin, origin]);
  // An origin-only release is its step's message, not a separate kept line.
  assert.deepEqual(preview.kept, []);
  assert.deepEqual(preview.steps.map(step => [step.state, step.change, step.message]),
    [['kept-shared', 'remove-origin', 'Kept; also part of productivity'], ['kept-shared', 'remove-origin', 'Kept; also part of productivity']]);
  assert.deepEqual(preview.steps.flatMap(step => step.files.map(file => [file.action, file.reason])), [['keep-shared', 'shared-content'], ['keep-shared', 'shared-content']]);
  const result = await confirmRemoval({ preview, request, mode: 'vibe' });
  assert.equal(result.outcome, 'nothing-removed');
  assert.equal(result.message, 'chosen: Kept; also part of productivity needed: Kept; also part of productivity');
});

test('a complete run with no member evidence cannot confirm absence', async () => {
  const request = async operation => operation === 'remove' ? ready() : { completion: 'complete', diagnostics: [], members: [] };
  const preview = await previewRemoval({ entries: [entries[0]], request, mode: 'vibe' });
  const result = await confirmRemoval({ preview, request, mode: 'vibe' });
  assert.equal(result.outcome, 'failed');
  assert.equal(result.results[0].state, 'failed');
  assert.match(result.results[0].message, /Couldn't confirm it's gone\./);
});

test('mixed absent and kept members are partly removed and name the kept member', async () => {
  const origin = { set: { framework: 'extensions', setId: 'productivity', setSha256: 'a'.repeat(64) } };
  const request = async operation => {
    if (operation === 'remove') return ready({ removals: [{ managementId: 'm-chosen', disposition: 'prepared', diagnostics: [], members: [
      { kind: 'file', path: '/project/gone.md', action: 'remove' },
      { kind: 'file', path: '/project/shared.md', action: 'keep-shared', reason: 'another-origin' },
    ] }] });
    return { completion: 'complete', diagnostics: [], members: [
      { managementId: 'm-chosen', path: '/project/gone.md', outcome: 'removed', check: 'absent' },
      { managementId: 'm-chosen', path: '/project/shared.md', outcome: 'kept', check: 'unchecked' },
    ] };
  };
  const preview = await previewRemoval({ entries: [{ ...entries[0], origin }], request, mode: 'vibe' });
  const result = await confirmRemoval({ preview, request, mode: 'vibe' });
  assert.equal(result.outcome, 'removed');
  assert.equal(result.results[0].state, 'partially-removed');
  // The contract's sentence is "Partly removed; kept: {members}", with nothing after the members.
  assert.equal(result.results[0].message, 'chosen: Partly removed; kept: /project/shared.md');
});

test('a member without an action remains readable and unconfirmed', async () => {
  const request = async operation => operation === 'remove'
    ? ready({ removals: [{ managementId: 'm-chosen', disposition: 'prepared', diagnostics: [], members: [{ kind: 'file', path: '/project/unknown.md' }] }] })
    : { completion: 'complete', diagnostics: [], members: [{ managementId: 'm-chosen', path: '/project/unknown.md', outcome: 'kept', check: 'unchecked' }] };
  const preview = await previewRemoval({ entries: [entries[0]], request, mode: 'vibe' });
  const result = await confirmRemoval({ preview, request, mode: 'vibe' });
  assert.equal(result.results[0].state, 'failed');
});

test('restored members are reported from run result 1.4', async () => {
  const request = async operation => operation === 'remove' ? ready() : { completion: 'complete', diagnostics: [], members: [{ managementId: 'm-chosen', path: '/project/0.md', outcome: 'restored', check: 'present-matching' }] };
  const preview = await previewRemoval({ entries: [entries[0]], request, mode: 'vibe' });
  const result = await confirmRemoval({ preview, request, mode: 'vibe' });
  assert.equal(result.results[0].state, 'restored');
});

test('a blocked removal has no Apply and preserves Core diagnostics', async () => {
  const calls = [];
  const request = async (operation, body) => {
    calls.push(operation);
    return { disposition: 'not-prepared', diagnostics: [{ message: 'Edited files need reconciliation.' }], removals: entries.map(entry => ({ managementId: entry.managementId, disposition: 'reconcile-required', diagnostics: [{ message: 'Edited files need reconciliation.' }], members: [] })) };
  };
  const preview = await previewRemoval({ entries, request, mode: 'vibe' });
  assert.equal(preview.canConfirm, false);
  const result = await confirmRemoval({ preview, request, mode: 'vibe' });
  assert.equal(result.outcome, 'nothing-removed');
  assert.match(result.message, /Edited files need reconciliation/);
  assert.equal(calls.includes('apply'), false);
});

test('stale Apply is not retried silently and keeps the original reason', async () => {
  const request = async operation => operation === 'remove' ? ready()
    : { status: 'refused', diagnostics: [{ code: 'REVIEW_STALE', message: 'The reviewed files changed.' }] };
  const preview = await previewRemoval({ entries: [entries[0]], request, mode: 'vibe' });
  const result = await confirmRemoval({ preview, request, mode: 'vibe' });
  assert.equal(result.outcome, 'failed');
  assert.match(result.message, /The reviewed files changed/);
});
test("a removal whose answer never arrived is unknown, never Couldn't confirm it's gone", async () => {
  const calls = [];
  const request = async (operation, body) => { calls.push([operation, body]); return operation === 'remove' ? ready()
    : { status: 'unknown', diagnostics: [{ code: 'APPLY_UNKNOWN', message: 'This page lost contact with the Workbench while it was running.' }] }; };
  const preview = await previewRemoval({ entries, request, mode: 'vibe' });
  const result = await confirmRemoval({ preview, request, mode: 'vibe' });
  assert.equal(result.outcome, 'unknown');
  assert.equal(result.message, 'Removal outcome unknown: This page lost contact with the Workbench while it was running.');
  assert.deepEqual(result.results, []);
  assert.equal(calls.at(-1)[1].purpose, 'remove');
});

// Core's removal preparation 1.2.0 (Core dev.53+): a supporting item the request frees without naming it (here the
// shared notices) is removed with the removal that freed it, and that entry lists its members. The run result then
// names those members under the freed item's own management id; they are tied back to the entry by operationId.
const grill = { name: 'grill-me', managementId: 'project--aihq.catalog--extensions.matt.grill-me', scope: 'project' };
const grilling = { name: 'grilling', managementId: 'project--aihq.catalog--extensions.matt.grilling', scope: 'project' };
const NOTICES = 'project--aihq.catalog--extensions.notices';
const folded = {
  schema: 'urn:aihq:core:managed-removal-preparation:1.2.0', disposition: 'prepared', target: { project: '/project' }, scope: 'project', mode: 'vibe', diagnostics: [],
  removals: [
    { managementId: grill.managementId, disposition: 'prepared', change: 'remove-selection', diagnostics: [], members: [
      { kind: 'file', path: '/project/.claude/skills/grill-me/SKILL.md', action: 'remove', operationId: 'lifecycle/remove-0' },
      // The freed notices, folded under the removal that freed them.
      { kind: 'file', path: '/project/.claude/skills/grill-me/extensions.notices/NOTICE.md', action: 'remove', operationId: 'lifecycle/remove-1' },
      { kind: 'file', path: '/project/.claude/skills/grill-me/extensions.notices/LICENSE', action: 'remove', operationId: 'lifecycle/remove-2' }] },
    // Interrupted before any of its files were written: Core prepares it with no members.
    { managementId: grilling.managementId, disposition: 'prepared', change: 'remove-selection', diagnostics: [], members: [] }],
  reviewDigest: 'digest-1',
  preparation: { status: 'ready', sessionId: 'session-1', review: { reviewDigest: 'digest-1', operations: [] } },
};
const foldedRun = check => ({ schema: 'urn:aihq:core:run-result:1.4.0', completion: 'complete', diagnostics: [], members: [
  { operationId: 'lifecycle/remove-0', selectionId: null, managementId: grill.managementId, scope: 'project', kind: 'file', path: '/project/.claude/skills/grill-me/SKILL.md', intent: 'remove', outcome: 'claim-removed', check: 'absent' },
  { operationId: 'lifecycle/remove-1', selectionId: null, managementId: NOTICES, scope: 'project', kind: 'file', path: '/project/.claude/skills/grill-me/extensions.notices/NOTICE.md', intent: 'remove', outcome: 'claim-removed', check },
  { operationId: 'lifecycle/remove-2', selectionId: null, managementId: NOTICES, scope: 'project', kind: 'file', path: '/project/.claude/skills/grill-me/extensions.notices/LICENSE', intent: 'remove', outcome: 'claim-removed', check: 'absent' }] });

test('a freed item folded under the removal that freed it counts toward that removal, and an empty prepared removal completes as removed', async () => {
  const request = async operation => operation === 'remove' ? folded : foldedRun('absent');
  const preview = await previewRemoval({ entries: [grill, grilling], request, mode: 'vibe' });
  assert.equal(preview.canConfirm, true);
  const result = await confirmRemoval({ preview, request, mode: 'vibe' });
  assert.equal(result.outcome, 'removed');
  assert.equal(result.message, 'grill-me: removed grilling: removed');
});

test('a folded freed member Core could not confirm absent leaves the removal that freed it unconfirmed', async () => {
  const request = async operation => operation === 'remove' ? folded : foldedRun('present');
  const preview = await previewRemoval({ entries: [grill, grilling], request, mode: 'vibe' });
  const result = await confirmRemoval({ preview, request, mode: 'vibe' });
  assert.equal(result.outcome, 'failed');
  assert.match(result.results[0].message, /^grill-me: Couldn't confirm it's gone\./);
  assert.equal(result.results[1].message, 'grilling: removed');
});

test('an empty prepared removal is not confirmed by an incomplete run', async () => {
  const request = async operation => operation === 'remove' ? folded : { ...foldedRun('absent'), completion: 'partial' };
  const preview = await previewRemoval({ entries: [grill, grilling], request, mode: 'vibe' });
  const result = await confirmRemoval({ preview, request, mode: 'vibe' });
  assert.match(result.results[1].message, /^grilling: Couldn't confirm it's gone\./);
});
