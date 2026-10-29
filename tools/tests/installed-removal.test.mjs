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
  assert.match(result.message, /chosen: absent.*needed: absent/);
  assert.doesNotMatch(result.message, /unverified/i);
});

test('set origins and kept members retain their exact Core actions and reasons', async () => {
  const origin = { set: { framework: 'extensions', setId: 'productivity', setSha256: 'a'.repeat(64) } };
  const request = async operation => {
    if (operation === 'remove') return ready({ removals: entries.map((entry, index) => ({ managementId: entry.managementId, disposition: 'prepared', change: 'remove-origin', diagnostics: [],
      members: [{ kind: 'file', path: `/project/${index}.md`, action: 'keep-shared', reason: 'shared-content', operationId: null }] })) });
    return { completion: 'complete', diagnostics: [], members: entries.map((entry, index) => ({ managementId: entry.managementId, path: `/project/${index}.md`, outcome: 'kept', check: 'unchecked' })) };
  };
  const withOrigins = entries.map(entry => ({ ...entry, origin }));
  const preview = await previewRemoval({ entries: withOrigins, request, mode: 'vibe' });
  assert.deepEqual(preview.selectors.map(entry => entry.origin), [origin, origin]);
  assert.deepEqual(preview.kept.map(item => item.reason), ['shared-content', 'shared-content']);
  const result = await confirmRemoval({ preview, request, mode: 'vibe' });
  assert.equal(result.outcome, 'nothing-removed');
  assert.match(result.message, /chosen: kept \(shared-content\)/);
});

test('a complete interrupted cleanup with no touched members is absent, not unverified', async () => {
  const request = async operation => operation === 'remove' ? ready() : { completion: 'complete', diagnostics: [], members: [] };
  const preview = await previewRemoval({ entries: [entries[0]], request, mode: 'vibe' });
  const result = await confirmRemoval({ preview, request, mode: 'vibe' });
  assert.equal(result.outcome, 'removed');
  assert.equal(result.results[0].state, 'absent');
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
