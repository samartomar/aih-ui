import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmUpdate } from '../../src/app/installed-update.js';

test('an all-kept update result is kept, not updated', async () => {
  const entry = { name: 'Note', managementId: 'm-note', scope: 'project', replacement: {} };
  const preview = { canConfirm: true, entries: [entry], steps: [{ members: [] }], scope: 'project', sessionId: 'session', review: { reviewDigest: 'digest' } };
  const result = await confirmUpdate({ preview, request: async () => ({ completion: 'complete', diagnostics: [], members: [{ managementId: 'm-note', path: '/project/NOTE.md', outcome: 'kept', check: 'present-matching' }] }) });
  assert.equal(result.outcome, 'kept');
  assert.equal(result.results[0].state, 'kept');
  assert.match(result.message, /\/project\/NOTE\.md: kept/);
});
