import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmUpdate, previewUpdate, updateEntry } from '../../src/app/installed-update.js';

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
// Core checks a replacement's binding and Scan records as at install. A replacement rendered for a binding Core no
// longer ships is a conflict in a partial review, named in its entry; it is stale at Apply, so it cannot be confirmed.
test('a replacement Core finds rendered for another binding cannot be confirmed, and says why in Core\'s words', async () => {
  const conflict = { code: 'STATE_CONFLICT', reason: 'binding-changed', message: 'coding-style was rendered for another binding of claude; render it again.' };
  const preview = await ask({ schema: 'urn:aihq:core:managed-update-preparation:1.1.0', disposition: 'prepared', diagnostics: [], reviewDigest: 'd',
    updates: [{ managementId: 'm-rule', disposition: 'prepared', members: [{ action: 'replace', path: '.claude/rules/typescript/coding-style.md' }], diagnostics: [conflict] }],
    preparation: { status: 'partial', sessionId: 's', review: { reviewDigest: 'd', conflicts: [conflict] }, diagnostics: [conflict] } });
  assert.equal(preview.canConfirm, false);
  assert.equal(preview.steps[0].state, 'blocked');
  assert.equal(preview.message, 'Update cannot go ahead: coding-style (typescript): coding-style was rendered for another binding of claude; render it again. Nothing was updated.');
});
// A refused preparation is no update at all: the request is not prepared and each entry carries Core's reasons.
test('a preparation Core refused names each entry\'s reason', async () => {
  const preview = await ask({ schema: 'urn:aihq:core:managed-update-preparation:1.1.0', disposition: 'not-prepared', diagnostics: [],
    updates: [{ managementId: 'm-rule', disposition: 'invalid', members: [], diagnostics: [{ code: 'INPUT_INVALID', reason: 'scan-record-mismatch', message: 'The Scan record for coding-style does not match its bytes.' }] }] });
  assert.equal(preview.canConfirm, false);
  assert.equal(preview.message, 'Update cannot go ahead: coding-style (typescript): The Scan record for coding-style does not match its bytes. Nothing was updated.');
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

// Pending owner approval as contract amendment 3.2.3 row 26: a requirement the newer item adds is named, not dropped.
test('an update whose newer item needs something not installed names it and goes no further', async () => {
  const nameOf = ref => ({ 'ecc.rule.README': 'README' })[ref.itemId];
  const sent = [];
  const preview = await previewUpdate({ entries: [entry], tool: 'claude-code', nameOf, request: async (operation, body) => { sent.push(operation); return { disposition: 'invalid',
    diagnostics: [{ code: 'INPUT_INVALID', reason: 'requirement-not-installed', managementId: 'm-rule', item: { framework: 'ecc', itemId: 'ecc.rule.README' }, message: 'ecc.rule.README is not installed.' }] }; } });
  assert.equal(preview.canConfirm, false);
  assert.equal(preview.message, 'Update cannot go ahead: coding-style (typescript) needs README, which is not installed. Nothing was updated.');
  assert.deepEqual(sent, ['update']);
});
test('an update whose newer item needs an installed item it did not need before says so', async () => {
  const nameOf = () => 'README';
  const preview = await previewUpdate({ entries: [entry], tool: 'claude-code', nameOf, request: async () => ({ disposition: 'invalid',
    diagnostics: [{ code: 'INPUT_INVALID', reason: 'requirement-not-recorded', managementId: 'm-rule', item: { framework: 'ecc', itemId: 'ecc.rule.README' }, message: 'x' }] }) });
  assert.equal(preview.message, 'Update cannot go ahead: coding-style (typescript) now needs README, which it did not need when it was installed. Nothing was updated.');
});

// The page sends the item and its recorded identities; the configuration comes from the host's record of the install,
// never from the setup open in the page.
test('an update entry carries no configuration of its own', () => {
  const item = { name: 'Working rules', managementId: 'project--aihq.catalog--project-basics.working-rules', scope: 'project', itemId: 'project-basics.working-rules', origins: [] };
  const offered = { root: { releaseSha256: 'a'.repeat(64), itemId: 'project-basics.working-rules', scope: 'project', configuration: { projectFolder: 'from-the-catalog-card' } } };
  const entry = updateEntry({ item, offered });
  assert.equal(entry.managementId, item.managementId);
  assert.equal(Object.hasOwn(entry, 'configuration'), false);
  assert.equal(Object.hasOwn(entry.replacement, 'configuration'), false);
  assert.deepEqual(entry.replacement, { releaseSha256: 'a'.repeat(64), itemId: 'project-basics.working-rules', scope: 'project' });
});
