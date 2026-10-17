import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInstalledRelease } from '@aihq/catalog/node';
import { digestBytes } from './primitives.mjs';
import { freshAuthoring, composeAuthoring, openDraft, compileDraft } from './headless.mjs';
import { intakeDeclaration } from './intake.mjs';
import { noteFixture } from './note-fixture.mjs';

const rootIds = ['mattpocock.tdd', 'mattpocock.implement', 'aihq.client.claude'];
const dependencyIds = ['mattpocock.code-review', 'aihq.project-context-pointer.claude-md', 'aihq.project-context'];
// Mirrors the exact format choiceReason (src/app/guided-rules.js) writes for the guided fixture project.
const reason = rule => `guided-setup rules 1.1.0: ${rule}. Goal: add tests to my react app. Project: JavaScript, TypeScript, React, Vitest.`;
const reasons = [reason('goal.test'), reason('goal.build'), reason('client.claude')];
const decode = bytes => new TextDecoder().decode(bytes);
function valueOf(result) {
  assert.equal(result.status, 'ok', JSON.stringify(result.diagnostics));
  return result.value;
}
async function setup() {
  const installed = await readInstalledRelease({
    root: dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'))), sourceInput: 'maintained'
  });
  assert.equal(installed.valid, true, JSON.stringify(installed.diagnostics));
  const maintained = { release: installed.release, materialSource: installed.source };
  for (const id of [...rootIds, ...dependencyIds]) {
    assert.ok(maintained.release.items.some(item => item.id === id), `Installed maintained Catalog release is missing required guided-setup item: ${id}`);
  }
  const inventories = [maintained], intent = freshAuthoring();
  intent.roots = rootIds.map((itemId, index) => ({
    releaseSha256: maintained.release.sha256, itemId,
    itemSha256: maintained.release.items.find(item => item.id === itemId).itemSha256,
    scope: 'project', configuration: {}, originIds: ['direct'], reason: reasons[index]
  }));
  const base = valueOf(await composeAuthoring({ intent: freshAuthoring(), inventories }));
  const composed = valueOf(await composeAuthoring({ basePolicyBytes: base.policyBytes, intent, inventories }));
  const draft = valueOf(await openDraft({ bytes: composed.policyBytes, inventories }));
  return { maintained, inventories, intent, base, composed, draft };
}
function sameRoots(actual, expected) {
  const sorted = roots => [...roots].sort((a, b) => a.itemId.localeCompare(b.itemId));
  assert.deepEqual(sorted(actual), sorted(expected));
  for (const root of expected) {
    const saved = actual.find(candidate => candidate.itemId === root.itemId);
    assert.deepEqual(new TextEncoder().encode(saved.reason), new TextEncoder().encode(root.reason));
  }
}

test('guided save records exact root reasons and keeps required dependencies as pins', async () => {
  const { maintained, intent, composed, draft } = await setup();
  assert.equal(draft.envelope.executable, false);
  assert.equal(draft.envelope.records.length, 1);
  const [record] = draft.envelope.records;
  assert.equal(record.schema, 'urn:aihq:workbench:journey-record:unresolved-draft:1.0.0');
  sameRoots(composed.intent.roots, intent.roots);
  sameRoots(draft.intent.roots, intent.roots);
  sameRoots(record.intent.roots, intent.roots);
  for (const itemId of dependencyIds) {
    assert.equal(draft.intent.roots.some(root => root.itemId === itemId), false);
    const item = maintained.release.items.find(item => item.id === itemId);
    const pin = draft.intent.pins.find(pin => pin.itemId === itemId);
    assert.ok(pin, `Required dependency must be pinned: ${itemId}`);
    assert.equal(pin.releaseSha256, maintained.release.sha256);
    assert.equal(pin.itemSha256, item.itemSha256);
  }
});

test('guided envelope reopens with identical choices and can compile', async () => {
  const { inventories, intent, draft } = await setup();
  const reopened = valueOf(await openDraft({ bytes: draft.envelopeBytes, inventories }));
  sameRoots(reopened.intent.roots, intent.roots);
  assert.equal(reopened.editing, 'available');
  assert.equal(reopened.compile.status, 'available');
  const compiled = valueOf(await compileDraft({ envelopeBytes: reopened.envelopeBytes, inventories }));
  sameRoots(compiled.intent.roots, intent.roots);
});

test('guided unknown roots survive unavailable inventory and recover without substitution', async () => {
  const { maintained, inventories, intent, draft } = await setup();
  const snapshot = await noteFixture();
  const input = { id: 'notes', kind: 'local', locator: { input: 'notes' },
    resolvedIdentity: { sha256: await digestBytes(snapshot.declarationBytes) } };
  const notes = valueOf(await intakeDeclaration({ input, ...snapshot, materialSource: { kind: 'local', input: 'notes' } }));
  assert.notEqual(notes.release.sha256, maintained.release.sha256);
  const unavailable = [notes];
  const reopened = valueOf(await openDraft({ bytes: draft.envelopeBytes, inventories: unavailable }));
  assert.equal(reopened.editing, 'unresolved');
  sameRoots(reopened.intent.roots, intent.roots);
  assert.deepEqual(reopened.intent, draft.intent);
  assert.equal(reopened.roots.length, intent.roots.length);
  for (const root of reopened.roots) {
    assert.equal(root.status, 'unresolved');
    const original = intent.roots.find(candidate => candidate.itemId === root.itemId);
    assert.ok(original, 'No replacement root may be introduced');
    assert.equal(root.releaseSha256, original.releaseSha256);
    assert.equal(root.itemSha256, original.itemSha256);
    assert.equal(root.reason, original.reason);
  }
  assert.equal(reopened.compile.status, 'refused');
  const refused = await compileDraft({ envelopeBytes: reopened.envelopeBytes, inventories: unavailable });
  assert.equal(refused.status, 'refused');
  assert.equal(refused.value, undefined);
  assert.deepEqual(reopened.envelopeBytes, draft.envelopeBytes);
  const restored = valueOf(await openDraft({ bytes: reopened.envelopeBytes, inventories }));
  assert.equal(restored.editing, 'available');
  assert.equal(restored.compile.status, 'available');
  sameRoots(restored.intent.roots, intent.roots);
  assert.deepEqual(restored.intent, draft.intent);
});

test('guided saved-intent reasons allow 1000 characters and refuse 1001', async () => {
  const { inventories, intent, base } = await setup();
  intent.roots[0].reason = reasons[0].padEnd(1000, 'x');
  valueOf(await composeAuthoring({ basePolicyBytes: base.policyBytes, intent, inventories }));
  intent.roots[0].reason += 'x';
  const refused = await composeAuthoring({ basePolicyBytes: base.policyBytes, intent, inventories });
  assert.equal(refused.status, 'refused');
  assert.equal(refused.value, undefined);
  assert.equal(refused.diagnostics[0].code, 'FIELD_SEMANTICS_UNSUPPORTED');
  assert.equal(refused.diagnostics[0].path, '/metadata/aih.workbench');
});

test('guided envelope contains neither local paths nor fixture project content', async () => {
  const { draft } = await setup();
  const project = new URL('./fixtures/guided-project/', import.meta.url);
  const appText = await readFile(new URL('src/App.tsx', project), 'utf8');
  const texts = [decode(draft.envelopeBytes), decode(draft.savedIntentBytes)];
  function noAbsolutePaths(value) {
    if (typeof value === 'string') {
      assert.equal(isAbsolute(value) || win32.isAbsolute(value), false, 'Saved strings must not contain absolute local paths');
    } else if (value && typeof value === 'object') {
      for (const member of Object.values(value)) noAbsolutePaths(member);
    }
  }
  for (const text of texts) {
    assert.equal(text.includes(fileURLToPath(project)), false);
    assert.equal(text.includes(appText), false);
    assert.equal(text.includes(JSON.stringify(appText).slice(1, -1)), false);
    assert.equal(text.includes('Guided fixture app'), false);
    noAbsolutePaths(JSON.parse(text));
  }
});
