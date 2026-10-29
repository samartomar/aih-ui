// Q4/Q5 regressions: authorized compose/edit records newly resolved origins instead of refusing them,
// while read/import stays strict; excludedItems follow the live intent (unskip clears the record).
// Runs in the consumer context.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readInstalledPreparedContent } from '@aihq/catalog/node';
import { composeAuthoring, readAuthoring, editAuthoring, freshAuthoring } from './headless.mjs';
import { pinSelectedRecipes } from './selected-recipe.mjs';
import { selectSetChoices } from './set-choices.mjs';
import { stable } from './primitives.mjs';
import { installedFamilies } from './installed-families.mjs';
import { compileReleaseSets } from '@aihq/catalog/producer';
import { readReleaseContent, readReleaseSets } from '@aihq/catalog/reader';

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
  // The provenance that genuinely changes is the SHARED DEPENDENCY's: one required-by origin per
  // requirer, so adding a second requirer changes its resolved origins exactly.
  const shared = first.dependencies?.requires?.[0]?.itemId;
  assert.ok(shared, 'the fixture skill requires shared content');
  const originOf = (policy, itemId) => JSON.stringify(policy.selections.find(entry => entry.item?.itemId === itemId)?.origins);
  const before = originOf(base.value.policy, shared);
  const expanded = await editAuthoring({ policyBytes: base.value.policyBytes, inventories, operation: { type: 'select', root: rootOf(second) }, tool: 'claude' });
  assert.equal(expanded.status, 'ok', JSON.stringify(expanded.diagnostics ?? []));
  const after = originOf(expanded.value.policy, shared);
  assert.ok(after && after !== 'undefined', 'origins recorded after the authorized change');
  assert.notEqual(after, before, 'the shared dependency\'s resolved provenance genuinely changed: the former strict-origin refusal would have rejected this exact transition');
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

test('effective cross-framework false members become qualified execution-policy exclusions', async () => {
  const families = await installedFamilies({ root: catalogRoot, sourceInput: 'cross-framework-exclusions' });
  const owner = families.find(entry => entry.family === 'Extensions'), source = families.find(entry => entry.family === 'ECC');
  const ownerBytes = await readFile(`${catalogRoot}/release/release-extensions.content.json`);
  const baseDocument = JSON.parse(ownerBytes.toString('utf8')); delete baseDocument.sets;
  const baseBytes = new TextEncoder().encode(stable(baseDocument) + '\n');
  const baseRead = readReleaseContent(baseBytes, { expectedSha256: createHash('sha256').update(baseBytes).digest('hex') });
  assert.equal(baseRead.valid, true, JSON.stringify(baseRead.diagnostics ?? []));
  const baseRelease = baseRead.release;
  const ordinary = baseRelease.items.find(item => item.kind === 'skill' && !Object.keys(item.inputs ?? {}).length);
  const item = source.release.items.find(item => item.kind === 'skill' && !Object.keys(item.inputs ?? {}).length);
  const set = { id: 'cross-skill', name: 'Cross-framework skill fixture', description: 'Checked selection-only regression fixture.', offer: 'pre-ticked', members: [
    { item: { framework: baseRelease.framework.id, itemId: ordinary.id }, optional: false, defaultOn: true },
    { item: { framework: source.release.framework.id, itemId: item.id, releaseVersion: source.release.framework.version, contentSha256: item.contentSha256, behaviourSha256: item.behaviourSha256 }, optional: true, defaultOn: false },
  ] };
  const built = compileReleaseSets({ release: baseRelease, sets: [set] });
  assert.equal(built.status, 'ok', JSON.stringify(built));
  const checked = readReleaseSets(built.value.bytes, { expectedSha256: built.value.sha256, release: baseRelease });
  assert.equal(checked.valid, true, JSON.stringify(checked.diagnostics ?? []));
  const exactRelease = checked.release ?? checked.value.release;
  const exactSet = exactRelease.sets.find(value => value.id === set.id);
  const fixture = families.map(entry => entry === owner ? { ...entry, release: exactRelease } : entry);
  const members = [{ item: { framework: item.framework ?? source.release.framework.id, itemId: item.id }, include: false }];
  const intent = freshAuthoring();
  const selected = selectSetChoices({ intent, inventories: fixture, sets: [{ release: { releaseSha256: exactRelease.sha256, scope: 'project' }, setId: exactSet.id, setSha256: exactSet.setSha256, options: {}, members }], tool: 'claude' });
  assert.equal(selected.status, 'ok', JSON.stringify(selected.diagnostics ?? []));
  const composed = await composeAuthoring({ intent, inventories: fixture, tool: 'claude' });
  assert.equal(composed.status, 'ok', JSON.stringify(composed.diagnostics ?? []));
  assert.ok(composed.value.policy.excludedItems.some(ref => ref.framework === source.release.framework.id && ref.itemId === item.id),
    'the request-only cross-framework false member is an effective qualified exclusion');
});
