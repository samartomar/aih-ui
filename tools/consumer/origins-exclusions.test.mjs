// Q4/Q5 regressions: authorized compose/edit records newly resolved origins instead of refusing them,
// while read/import stays strict; excludedItems follow the live intent (unskip clears the record).
// Runs in the consumer context.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { readInstalledPreparedContent } from '@aihq/catalog/node';
import { composeAuthoring, readAuthoring, editAuthoring, freshAuthoring } from './headless.mjs';
import { pinSelectedRecipes } from './selected-recipe.mjs';

const catalogRoot = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
const prepared = await readInstalledPreparedContent({ root: catalogRoot, frameworkId: 'ecc', sourceInput: 'origins-exclusions' });
if (!prepared.valid) throw new Error('ECC prepared fixture unavailable');
const inventories = [{ release: prepared.release, family: prepared.release.framework.name, materialSource: { kind: 'local', input: 'origins-exclusions' }, materials: [], fixture: 'origins/exclusions regression' }];
const skills = prepared.release.items.filter(item => item.kind === 'skill' && !Object.keys(item.inputs ?? {}).length);
const first = skills[0], second = skills[1];
const rootOf = item => ({ releaseSha256: prepared.release.sha256, itemId: item.id, itemSha256: item.itemSha256, scope: 'project', configuration: {}, originIds: ['direct'] });
const intentWith = items => { const intent = freshAuthoring(); for (const item of items) { intent.roots.push(rootOf(item)); pinSelectedRecipes(intent, inventories, rootOf(item), 'claude'); } return intent; };
const framework = prepared.release.framework.id;

test('Q4: an authorized edit that changes resolved origins composes and records the new origins; read stays strict', async () => {
  // first depends on shared content; adding second (which also depends on it) changes first's resolved origins.
  const base = await composeAuthoring({ intent: intentWith([first]), inventories, tool: 'claude' });
  assert.equal(base.status, 'ok', JSON.stringify(base.diagnostics));
  const expanded = await editAuthoring({ policyBytes: base.value.policyBytes, inventories, operation: { type: 'select', root: rootOf(second) }, tool: 'claude' });
  assert.equal(expanded.status, 'ok', JSON.stringify(expanded.diagnostics ?? []));
  const selection = expanded.value.policy.selections.find(entry => entry.item?.itemId === first.id);
  assert.ok(selection?.origins?.length, 'origins recorded after the authorized change');
  // Read back: strict - the recorded origins must match what the checked source resolves now (they do).
  const read = await readAuthoring({ policyBytes: expanded.value.policyBytes, inventories });
  assert.equal(read.value.editing, 'available', JSON.stringify(read.value.diagnostics));
  // Tampered origins on import are still refused on read: executable identity is unchanged but provenance lies.
  const tampered = JSON.parse(new TextDecoder().decode(expanded.value.policyBytes));
  const victim = tampered.selections.find(entry => entry.item?.itemId === first.id);
  victim.origins = [{ reasonIncluded: 'in-set', set: { framework, setId: 'bogus.set', setSha256: '0'.repeat(64) } }];
  const tamperedBytes = new TextEncoder().encode(JSON.stringify(tampered));
  const refused = await readAuthoring({ policyBytes: tamperedBytes, inventories });
  assert.equal(refused.value?.editing, 'unavailable', 'imported origin tampering must stay refused on read');
});

test('Q5: an unskip clears the authored excludedItems record; the skip no longer contradicts choices', async () => {
  const intent = intentWith([first]);
  intent.exclusions.push({ originId: 'direct', releaseSha256: prepared.release.sha256, itemId: second.id, scope: 'project', reason: 'left-out' });
  const skipped = await composeAuthoring({ intent, inventories, tool: 'claude' });
  assert.equal(skipped.status, 'ok', JSON.stringify(skipped.diagnostics));
  const excluded = skipped.value.policy.excludedItems ?? [];
  assert.ok(excluded.some(ref => ref.itemId === second.id && ref.framework === framework), 'the authored exclusion is recorded');
  // The person unskips: the intent exclusion goes away, so the policy record must too.
  const intentWithout = intentWith([first]);
  const unskipped = await composeAuthoring({ basePolicyBytes: skipped.value.policyBytes, intent: intentWithout, inventories, tool: 'claude' });
  assert.equal(unskipped.status, 'ok', JSON.stringify(unskipped.diagnostics ?? []));
  const after = unskipped.value.policy.excludedItems ?? [];
  assert.ok(!after.some(ref => ref.itemId === second.id), 'the unskipped item must not linger in excludedItems');
  assert.ok(after.every(ref => intentWithout.exclusions.some(ex => ex.itemId === ref.itemId)), 'excludedItems match the live intent exactly');
});
