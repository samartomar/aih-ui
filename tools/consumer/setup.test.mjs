import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInstalledRelease } from '@aihq/catalog/node';
import { listItems } from '@aihq/catalog/reader';
import { composeSetup, reopenSetup, reviewSetupUpdate } from './setup.mjs';
const installed = await readInstalledRelease({ root: dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'))), sourceInput: 'catalog' });
assert.equal(installed.valid, true, JSON.stringify(installed.diagnostics));
const { release, source: materialSource } = installed;
const items = listItems(release);
const root = items.find(item => item.id === 'mattpocock.grill-with-docs') ?? items.find(item => item.dependencies.requires.length && Object.keys(item.inputs).length === 0);
assert.ok(root, 'a configurable public dependent item is present');
const skipped = items.find(item => item.id === 'mattpocock.code-review') ?? items.find(item => item.id !== root.id && !root.dependencies.requires.some(ref => ref.itemId === item.id));
const choices = { release, materialSource, mode: 'vibe', roots: [{ itemId: root.id, scope: root.scopes[0], configuration: {} }], excludedItemIds: [skipped.id] };

test('explicit root expands required dependencies and independent skip survives exact save/reopen', () => {
  const authored = composeSetup(choices);
  assert.equal(authored.valid, true, JSON.stringify(authored.diagnostics));
  assert.equal(authored.policy.selections.length, 1 + root.dependencies.requires.length);
  assert.ok(!authored.policy.selections.some(selection => selection.id.endsWith(`--${skipped.id}`)));
  const reopened = reopenSetup({ release, materialSource, policyText: authored.policyText });
  assert.equal(reopened.editable, true, JSON.stringify(reopened.diagnostics));
  assert.equal(reopened.policyText, authored.policyText);
  assert.deepEqual(reopened.intent.excludedItemIds, [skipped.id]);
});

test('contradictory intent, required exclusions and malformed roots are refused', () => {
  const authored = composeSetup(choices);
  authored.policy.selections[0].configuration = { unexpected: 'contradiction' };
  assert.equal(reopenSetup({ release, materialSource, policyText: JSON.stringify(authored.policy) }).valid, false);
  assert.equal(composeSetup({ ...choices, excludedItemIds: [root.dependencies.requires[0].itemId] }).valid, false);
  assert.equal(composeSetup({ ...choices, roots: [null] }).valid, false);
});

test('reopen preserves annotations and plain policies keep unavailable editing honest', () => {
  const authored = composeSetup(choices);
  authored.policy.metadata.other = { note: 'preserve me' };
  const policyText = JSON.stringify(authored.policy);
  const reopened = reopenSetup({ release, materialSource, policyText });
  assert.equal(reopened.editable, true);
  assert.deepEqual(reopened.policy.metadata.other, { note: 'preserve me' });
  assert.equal(reopened.policyText, policyText);
  delete authored.policy.metadata;
  const plain = reopenSetup({ release, materialSource, policyText: JSON.stringify(authored.policy) });
  assert.equal(plain.valid, true); assert.equal(plain.editable, false);
});

test('reviewed same-source update preserves exclusions and original JSON', () => {
  const authored = composeSetup(choices);
  const update = reviewSetupUpdate({ previousRelease: release, release, materialSource, policyText: authored.policyText });
  assert.equal(update.valid, true, JSON.stringify(update.diagnostics));
  assert.equal(update.originalPolicyText, authored.policyText);
  assert.deepEqual(update.policy.metadata['aih.workbench'].excludedItemIds, [skipped.id]);
  assert.ok(update.changes.every(change => change.state === 'unchanged'));
});
