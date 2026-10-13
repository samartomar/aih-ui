import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { readRelease } from '@aihq/catalog/reader';
import { freshIntent, composeIntent, reopenIntent, transactIntent, reviewIntentUpdate, itemKey, indexReleases } from './saved-intent.mjs';
import { journeyFixture, scaleFixture, rootFor, sha256 } from './intent-fixtures.mjs';
const output = resolve(process.argv[2] ?? 'saved-intent-output');
mkdirSync(output, { recursive: true });
const store = (name, value) => writeFileSync(join(output, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
const okay = result => { assert.equal(result.valid, true, JSON.stringify(result.diagnostics)); return result; };
const f = journeyFixture(), [shared, app] = f.entries;
const skip = rootFor(shared, 'shared.optional'); delete skip.scope; delete skip.configuration;
const original = okay(composeIntent({ index: f.index, templates: f.templates, capture: true, intent: { ...freshIntent(),
  roots: [rootFor(app, 'app.alpha'), rootFor(app, 'app.beta'), rootFor(shared, 'shared.retired')], exclusions: [skip] } }));
assert.equal(okay(reopenIntent({ index: f.index, templates: f.templates, policyText: original.policyText })).policyText, original.policyText);
const removal = okay(transactIntent({ index: f.index, templates: f.templates, policyText: original.policyText,
  operation: { type: 'remove-root', key: itemKey(rootFor(app, 'app.alpha')), scope: 'project' } }));
assert.ok(removal.policy.selections.some(value => value.id.endsWith('--shared.base')));
const updateArgs = { previousIndex: f.index, index: f.nextIndex, templates: f.templates, policyText: original.policyText, replacements: f.replacements };
const review = reviewIntentUpdate(updateArgs);
assert.equal(review.valid, false);
const resolutions = Object.fromEntries(review.changes.filter(change => change.state !== 'unchanged').map(change => [change.key, change.state === 'missing' ? 'remove' : 'accept']));
const updated = okay(reviewIntentUpdate({ ...updateArgs, resolutions }));
store('policy.previous.json', original.policyText); store('policy.updated.json', updated.policyText); store('policy.removed-root.json', removal.policyText);
store('journey.json', { selected: original.policy.selections.length, optional: original.optional, sharedRemoval: removal.impact,
  changedAndMissing: review.changes, resolutions, acceptedCandidateRequiresAcceptance: updated.requiresAcceptance, provenance: original.intent.provenance });

// Measure parsing/indexing separately from warm indexed composition. Fixture creation is excluded.
const entries = scaleFixture();
const begin = performance.now();
const parsed = entries.map(entry => ({ materialSource: entry.materialSource, release: okay(readRelease(entry.bytes, { expectedSha256: sha256(entry.bytes) })).release }));
const parsedAt = performance.now();
const index = indexReleases(parsed), indexedAt = performance.now();
const roots = parsed.flatMap(entry => [rootFor(entry, entry.release.items.at(-1).id)]);
const intent = { ...freshIntent(), roots };
const timings = [];
let selected;
for (let iteration = 0; iteration < 25; iteration++) {
  const start = performance.now(); selected = okay(composeIntent({ index, intent, capture: true })); timings.push(performance.now() - start);
}
timings.sort((a,b) => a-b);
const all = composeIntent({ index, intent: { ...freshIntent(), roots: parsed.flatMap(entry => entry.release.items.map(item => rootFor(entry, item.id))) }, capture: true });
const seventh = scaleFixture(7), expanded = indexReleases(seventh);
const expandedSelection = okay(composeIntent({ index: expanded, intent: { ...freshIntent(), roots: seventh.map(entry => rootFor(entry, entry.release.items.at(-1).id)) }, capture: true }));
const measurements = { illustrative: true, frameworkCount: 6, itemsPerFramework: 300, inventoryItems: index.items.size,
  releaseBytes: entries.reduce((sum, entry) => sum + entry.bytes.length, 0), coldParseMs: parsedAt - begin, coldIndexMs: indexedAt - parsedAt,
  warmRuns: timings.length, warmSelectionMedianMs: timings[12], warmSelectionP95Ms: timings[23], warmSelectionMinimumMs: timings[0],
  selectedRoots: roots.length, ...selected.measurement,
  selectAll1800: { valid: all.valid, measurement: all.measurement, diagnostics: all.diagnostics },
  seventhFrameworkAsData: { inventoryItems: expanded.items.size, selectedRoots: 7, ...expandedSelection.measurement,
    consumerOrCoreChanges: false }, routineLLMCalls: 0 };
store('measurements.json', measurements); store('policy.six-frameworks.json', selected.policyText); store('policy.seven-frameworks.json', expandedSelection.policyText);
console.log(JSON.stringify({ output, measurements }, null, 2));
