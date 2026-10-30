import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmUpdate, previewUpdate } from '../../src/app/installed-update.js';

test('an all-kept update result is kept, not updated', async () => {
  const entry = { name: 'Note', managementId: 'm-note', scope: 'project', replacement: {} };
  const preview = { canConfirm: true, entries: [entry], steps: [{ members: [] }], scope: 'project', sessionId: 'session', review: { reviewDigest: 'digest' } };
  const result = await confirmUpdate({ preview, request: async () => ({ completion: 'complete', diagnostics: [], members: [{ managementId: 'm-note', path: '/project/NOTE.md', outcome: 'kept', check: 'present-matching' }] }) });
  assert.equal(result.outcome, 'kept');
  assert.equal(result.results[0].state, 'kept');
  assert.match(result.message, /\/project\/NOTE\.md: kept/);
});
test('an update whose answer never arrived is unknown, never failed', async () => {
  const entry = { name: 'Note', managementId: 'm-note', scope: 'project', replacement: {} };
  const preview = { canConfirm: true, entries: [entry], steps: [{ members: [] }], scope: 'project', sessionId: 'session', review: { reviewDigest: 'digest' } };
  const sent = [];
  const result = await confirmUpdate({ preview, request: async (operation, body) => { sent.push(body); return { status: 'unknown', diagnostics: [{ code: 'APPLY_UNKNOWN', message: 'This page lost contact with the Workbench while it was running.' }] }; } });
  assert.equal(result.outcome, 'unknown');
  assert.equal(result.message, 'Update outcome unknown: This page lost contact with the Workbench while it was running.');
  assert.equal(sent[0].purpose, 'update');
});

// Whenever an Update cannot go ahead, the page says why in Core's own words; never a bare "cannot go ahead".
const entry = { name: 'coding-style (typescript)', managementId: 'm-rule', scope: 'project', replacement: {} };
const ask = response => previewUpdate({ entries: [entry], request: async () => response, tool: 'claude-code' });
test('a whole-request refusal names Core\'s reason', async () => {
  const preview = await ask({ disposition: 'unavailable', diagnostics: [{ code: 'PREREQUISITE_UNAVAILABLE', reason: 'ownership-unverifiable', message: 'Protected custody for this update could not be verified.' }] });
  assert.equal(preview.canConfirm, false);
  assert.equal(preview.message, 'Update cannot go ahead: Protected custody for this update could not be verified. Nothing was updated.');
});
test('a refused entry names Core\'s reason for it', async () => {
  const preview = await ask({ disposition: 'not-prepared', diagnostics: [], updates: [{ managementId: 'm-rule', disposition: 'invalid', members: [],
    diagnostics: [{ code: 'INPUT_INVALID', reason: 'replacement-item-changed', message: 'A replacement updates the same item for the same tool; another item needs its own management ID.' }] }] });
  assert.equal(preview.canConfirm, false);
  assert.match(preview.message, /^Update cannot go ahead: coding-style \(typescript\): A replacement updates the same item for the same tool; another item needs its own management ID\. Nothing was updated\.$/);
});
test('a prepared entry whose policy preparation was refused names the preparation\'s reason', async () => {
  const preview = await ask({ disposition: 'prepared', diagnostics: [], updates: [{ managementId: 'm-rule', disposition: 'prepared', members: [], diagnostics: [{ code: 'POLICY_INVALID', message: 'Selection rule requires unknown selection notices.' }] }],
    preparation: { status: 'invalid', diagnostics: [{ code: 'POLICY_INVALID', message: 'Selection rule requires unknown selection notices.' }] } });
  assert.equal(preview.canConfirm, false);
  assert.equal(preview.steps[0].state, 'blocked');
  assert.equal(preview.message, 'Update cannot go ahead: coding-style (typescript): Selection rule requires unknown selection notices. Nothing was updated.');
});
test('a refusal without Core diagnostics still says what Core answered', async () => {
  const preview = await ask({ disposition: 'prepared', diagnostics: [], updates: [{ managementId: 'm-rule', disposition: 'prepared', members: [], diagnostics: [] }], preparation: { status: 'blocked', diagnostics: [] } });
  assert.equal(preview.canConfirm, false);
  assert.doesNotMatch(preview.message, /^Update cannot go ahead\.$/);
  assert.match(preview.message, /Update cannot go ahead: .*blocked/);
});
test('a reviewable update asks the person to check the replacement', async () => {
  const preview = await ask({ disposition: 'prepared', diagnostics: [], updates: [{ managementId: 'm-rule', disposition: 'prepared', members: [], diagnostics: [], to: { name: 'coding-style (typescript)' } }],
    preparation: { status: 'ready', sessionId: 's', review: { reviewDigest: 'd' } } });
  assert.equal(preview.canConfirm, true);
  assert.equal(preview.message, 'Nothing has been updated yet. Check the replacement, then confirm.');
});
