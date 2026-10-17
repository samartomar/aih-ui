import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInstalledRelease } from '@aihq/catalog/node';
import { resolveSelections, validateSelectionSet } from '@aihq/catalog/reader';
import { parsePolicy } from '@aihq/core/contracts';
import { freshAuthoring, composeAuthoring, readAuthoring, recordReview, inspectReviewEvidence, editAuthoring } from 'aih-ui/authoring';
import { intakeDeclaration } from 'aih-ui/intake';
// Application-internal: subject identities through Core's deriveRecipeIdentity, outside the package entries.
import { describeAuthoringSubject } from './review-bindings.mjs';
import { noteFixture } from './note-fixture.mjs';
import { createMixedService } from './mixed-service.mjs';
import { scaleInventories, scaleFramework, rootFor, encode, digest } from './scale-fixture.mjs';
import { proveScaleBrowser } from './scale-browser.mjs';
// The proof's own SHA-256 over Web Crypto; the ./intake entry publishes only intakeDeclaration.
const digestBytes = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');

const output = process.argv[2];
if (!output || !process.env.REVIEW_EVIDENCE_FILE) throw new Error('Supply an output directory and REVIEW_EVIDENCE_FILE containing original checked review-note evidence.');
await mkdir(output, { recursive: true });
const receipt = { node: process.version, syntheticExecution: 'disabled: no projectRoot, material roots, Prepare or Apply', cases: [], limits: [
  'Functional local authoring only; synthetic data establishes no real framework or native support.',
  'No all-inventory execution, arbitrary material capacity, universal client support or latency promise.',
  'Outputs are draft policies and checked content descriptions, never authority handles.'
] };
const save = (name, value) => writeFile(join(output, name), JSON.stringify(value, null, 2) + '\n');
const passed = name => { receipt.cases.push(name); console.log(name); };
const success = result => { assert.equal(result.status, 'ok', JSON.stringify(result.diagnostics)); return result.value; };
try {
  const catalogRoot = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
  const installed = await readInstalledRelease({ root: catalogRoot, sourceInput: 'maintained' });
  assert.equal(installed.valid, true, JSON.stringify(installed.diagnostics));
  const maintained = { release: installed.release, materialSource: installed.source };
  const snapshot = await noteFixture();
  const notes = success(await intakeDeclaration({ ...snapshot, input: { id: 'notes', kind: 'local', locator: { input: 'notes' }, resolvedIdentity: { sha256: await digestBytes(snapshot.declarationBytes) } }, materialSource: { kind: 'local', input: 'notes' } }));
  // Reuse the page's ordinary authored template identity, without adding a route.
  await createMixedService(maintained, { suppliedInventories: [notes, notes] });
  const { inventories, frameworks } = await scaleInventories(maintained, notes);
  assert.equal(inventories.reduce((sum, i) => sum + i.release.items.length, 0), 1800);
  for (const [index, framework] of frameworks.entries()) await writeFile(join(output, `framework-${index + 1}.snapshot.json`), JSON.stringify(framework.snapshot));
  const intent = freshAuthoring(), template = notes.templates[0];
  intent.origins.push({ id: 'note-template', kind: 'template', releaseSha256: notes.release.sha256, templateId: template.id, templateSha256: template.sha256 });
  intent.roots.push({ ...rootFor(notes, 'consumer-proof.review-note', ['direct', 'note-template']), reason: 'Retain independent material with shared template ownership.' });
  for (const [index, framework] of frameworks.entries()) {
    for (let item = 2; item <= (index < 2 ? 50 : 49); item++) intent.roots.push(rootFor(framework.inventory, `scale${index + 1}.item${String(item).padStart(3, '0')}`, ['direct'], item === 2 ? { directory: 'chosen' } : {}));
    intent.exclusions.push({ originId: 'direct', releaseSha256: framework.inventory.release.sha256, itemId: `scale${index + 1}.item${String(framework.inventory.release.items.length - 1).padStart(3, '0')}`, scope: 'project', reason: 'Deliberate optional skip.' });
  }
  const releases = Object.fromEntries(inventories.map(i => [i.release.sha256, i.release]));
  const resolution = success(resolveSelections({ releases, roots: intent.roots.map(({ releaseSha256, itemId, scope, configuration }) => ({ releaseSha256, itemId, scope, configuration })), skips: intent.exclusions.map(({ releaseSha256, itemId, scope }) => ({ releaseSha256, itemId, scope })) }));
  assert.equal(resolution.selections.length, 300);
  assert.equal(intent.roots.length, 291);
  assert.equal(validateSelectionSet({ releases, selections: resolution.selections }).valid, true);
  assert.equal(resolution.optional.length, 6); assert.ok(resolution.optional.every(s => s.skipped));
  let saved = success(await composeAuthoring({ intent, inventories }));
  passed('1800 checked inventory items; 291 roots resolve to 300 selected items with required closure and six optional skips');

  const evidenceBytes = new Uint8Array(await readFile(process.env.REVIEW_EVIDENCE_FILE));
  await writeFile(join(output, 'review-evidence.original.json'), evidenceBytes);
  const inspected = success(await inspectReviewEvidence({ evidenceBytes, inventory: notes, itemId: 'consumer-proof.review-note' }));
  assert.equal(inspected.sourceAssociation, 'matched'); assert.ok(inspected.bindings.length);
  const target = { releaseSha256: notes.release.sha256, itemId: 'consumer-proof.review-note' };
  for (const [index, disposition] of ['false-alarm', 'accepted-risk'].entries()) saved = success(await recordReview({ policyBytes: saved.policyBytes, inventories, evidenceBytes, target, finding: inspected.bindings[0].finding,
    decision: { id: `scale-review-${index}`, owner: { kind: 'individual', id: 'fixture-reviewer' }, actor: 'fixture-reviewer', recordedAt: '2026-10-13T18:00:00Z', disposition, reason: 'Functional fixture decision over retained checked evidence; no human authenticity claimed.', ...(index ? { supersedes: 'scale-review-0' } : {}) }, reviewEvidence: [evidenceBytes] }));
  assert.equal(saved.intent.reviews.records.length, 1); assert.equal(saved.intent.reviews.history.length, 1);
  const enriched = structuredClone(saved.policy);
  enriched.metadata.unrelated = { retained: 'Unicode bytes — preserved' }; enriched.evidence = []; enriched.managedSelections = []; enriched.removals = [{ managementId: 'retired-unrelated', scope: 'project' }];
  const originalBytes = encode(JSON.stringify(enriched, null, 2).replaceAll('\n', '\r\n') + '\r\n');
  saved = success(await composeAuthoring({ basePolicyBytes: originalBytes, intent: saved.intent, inventories, reviewEvidence: [evidenceBytes] }));
  for (const field of ['evidence', 'managedSelections', 'removals']) assert.deepEqual(saved.policy[field], enriched[field]);
  assert.deepEqual(saved.policy.metadata.unrelated, enriched.metadata.unrelated);
  assert.equal(parsePolicy(new TextDecoder().decode(saved.policyBytes)).valid, true);
  const policyPath = join(output, 'policy.saved.json'); await writeFile(policyPath, saved.policyBytes);
  const fileBytes = new Uint8Array(await readFile(policyPath));
  const reopened = success(await readAuthoring({ policyBytes: fileBytes, inventories, reviewEvidence: [evidenceBytes] }));
  assert.equal(reopened.editing, 'available', JSON.stringify(reopened.diagnostics));
  assert.deepEqual(reopened.originalBytes, fileBytes); assert.deepEqual(reopened.intent, saved.intent); assert.deepEqual(reopened.policy, saved.policy);
  assert.equal(reopened.policy.selections.length, 300);
  passed('actual 300-selection saved file reopens with exact pins/source inputs, configuration, skips, origins, current review/history and unrelated fields');

  const materialRecords = [];
  for (const inventory of inventories) for (const item of inventory.release.items) {
    const descriptors = [item.recipe, ...item.materials];
    for (const descriptor of descriptors) {
      const bytes = inventory === maintained ? new Uint8Array(await readFile(join(catalogRoot, descriptor.path))) : inventory.materials.find(m => m.path === descriptor.path)?.bytes;
      assert.ok(bytes); assert.equal(bytes.length, descriptor.byteLength); assert.equal(digest(bytes), descriptor.sha256);
      materialRecords.push({ releaseSha256: inventory.release.sha256, itemId: item.id, ...descriptor });
    }
  }
  const identities = [];
  for (const pin of saved.intent.pins) {
    const inventory = inventories.find(i => i.release.sha256 === pin.releaseSha256);
    if (inventory === maintained) inventory.materials = [{ ...pin.recipe, bytes: new Uint8Array(await readFile(join(catalogRoot, pin.recipe.path))) }];
    identities.push(success(await describeAuthoringSubject({ inventory, itemId: pin.itemId })));
  }
  await save('material-descriptors.json', materialRecords); await save('selected-identities.json', identities);
  const uniqueMaterials = [...new Map(materialRecords.map(m => [`${m.releaseSha256}/${m.path}`, m])).values()];
  receipt.inventory = inventories.map(i => ({ sha256: i.release.sha256, byteLength: i.release.byteLength, package: i.release.package, items: i.release.items.length, input: i.input, materialSource: i.materialSource }));
  receipt.counts = { inventoryItems: 1800, maintainedItems: maintained.release.items.length, independentItems: 1, syntheticItems: 1753, roots: intent.roots.length, selectedItemsIncludingClosure: 300, dependencyOnlyItems: 300 - intent.roots.length, inclusionPaths: resolution.inclusions.length, optionalSkips: 6, uniqueMaterialFilesIncludingRecipes: uniqueMaterials.length };
  receipt.bytes = { policy: fileBytes.length, intent: encode(saved.intent).length, releaseManifests: inventories.reduce((sum, i) => sum + i.release.byteLength, 0), inventoryMaterialsIncludingRecipes: uniqueMaterials.reduce((sum, m) => sum + m.byteLength, 0), selectedRecipeBytes: saved.intent.pins.reduce((sum, p) => sum + p.recipe.byteLength, 0), selectedMaterialDescriptorBytes: saved.intent.pins.reduce((sum, p) => sum + p.materials.reduce((n, m) => n + m.byteLength, 0), 0), reviewEvidence: evidenceBytes.length };
  receipt.identities = { savedPolicySha256: digest(fileBytes), evidenceSha256: digest(evidenceBytes), evidenceAuthentication: inspected.producerAuthentication };
  passed('every inventory recipe/material descriptor matches actual UTF-8 bytes; all 300 selected recipe identities derive through public Core');

  const refusals = [];
  const refusal = async (name, candidate, expected) => {
    const options = { basePolicyBytes: fileBytes, intent: candidate, inventories, reviewEvidence: [evidenceBytes] };
    const first = await composeAuthoring(options), second = await composeAuthoring(options);
    assert.equal(first.status, 'refused'); assert.equal(first.value, undefined); assert.equal(first.policyBytes, undefined);
    assert.ok(first.diagnostics.some(d => d.code === expected), JSON.stringify(first.diagnostics)); assert.deepEqual(first.diagnostics, second.diagnostics); assert.deepEqual(first.originalBytes, fileBytes);
    assert.deepEqual(new Uint8Array(await readFile(policyPath)), fileBytes);
    refusals.push({ name, candidateIntentUtf8Bytes: encode(candidate).length, diagnostics: first.diagnostics, originalSha256: digest(first.originalBytes) });
  };
  const collision = structuredClone(saved.intent), firstFramework = frameworks[0].inventory;
  collision.roots.push(rootFor(firstFramework, firstFramework.release.items.at(-1).id));
  await refusal('declared item conflict', collision, 'ITEM_CONFLICT');
  const requiredSkip = structuredClone(saved.intent); requiredSkip.exclusions.push({ originId: 'direct', releaseSha256: firstFramework.release.sha256, itemId: 'scale1.item001', scope: 'project' });
  await refusal('required dependency cannot be skipped', requiredSkip, 'REQUIRED_ITEM_SKIPPED');
  const conflicting = await editAuthoring({ policyBytes: fileBytes, inventories, reviewEvidence: [evidenceBytes], operation: { type: 'select', root: { ...rootFor(notes, 'consumer-proof.review-note'), configuration: { conflicting: true } } } });
  assert.equal(conflicting.status, 'refused'); assert.equal(conflicting.value, undefined); assert.deepEqual(conflicting.originalBytes, fileBytes);
  const conflictingAgain = await editAuthoring({ policyBytes: fileBytes, inventories, reviewEvidence: [evidenceBytes], operation: { type: 'select', root: { ...rootFor(notes, 'consumer-proof.review-note'), configuration: { conflicting: true } } } });
  assert.deepEqual(conflicting.diagnostics, conflictingAgain.diagnostics);
  refusals.push({ name: 'shared-origin configuration conflict', diagnostics: conflicting.diagnostics, originalSha256: digest(conflicting.originalBytes) });
  const oversized = structuredClone(saved.intent); oversized.roots[0].reason = 'é'.repeat(425001);
  await refusal('consumer intent byte bound', oversized, 'POLICY_BOUND_EXCEEDED');
  const padded = structuredClone(saved.policy); padded.metadata.padding = 'é'.repeat(500001);
  const paddedBytes = encode(padded), coreBound = await readAuthoring({ policyBytes: paddedBytes, inventories, reviewEvidence: [evidenceBytes] });
  assert.equal(coreBound.status, 'refused'); assert.equal(coreBound.value, undefined); assert.deepEqual(coreBound.originalBytes, paddedBytes);
  const coreBoundAgain = await readAuthoring({ policyBytes: paddedBytes, inventories, reviewEvidence: [evidenceBytes] }); assert.deepEqual(coreBoundAgain.diagnostics, coreBound.diagnostics);
  refusals.push({ name: 'Core execution policy byte bound', originalUtf8Bytes: paddedBytes.length, originalSha256: digest(paddedBytes), diagnostics: coreBound.diagnostics });
  await writeFile(join(output, 'policy.refused-oversized.json'), paddedBytes); await save('refusals.json', refusals);
  passed('deterministic collision/configuration/required-skip and multibyte consumer/Core bound refusals retain exact original inputs without partial policies');

  // Data-only expansion through precisely the same producer and consumer code.
  const seventh = await scaleFramework(7, 300, frameworks[0].inventory), expandedInventories = [...inventories, seventh.inventory];
  const expandedIntent = structuredClone(saved.intent); expandedIntent.roots.push(rootFor(seventh.inventory, 'scale7.item001'));
  const expanded = success(await composeAuthoring({ basePolicyBytes: fileBytes, intent: expandedIntent, inventories: expandedInventories, reviewEvidence: [evidenceBytes] }));
  assert.equal(expanded.policy.selections.length, 301); assert.deepEqual(expanded.intent.reviews, saved.intent.reviews);
  const expandedRead = success(await readAuthoring({ policyBytes: expanded.policyBytes, inventories: expandedInventories, reviewEvidence: [evidenceBytes] })); assert.equal(expandedRead.editing, 'available');
  await writeFile(join(output, 'framework-7.snapshot.json'), JSON.stringify(seventh.snapshot)); await writeFile(join(output, 'policy.seventh.json'), expanded.policyBytes);
  receipt.expansion = { inventoryItems: 2100, selectedItemsIncludingClosure: 301, roots: expanded.intent.roots.length, policyBytes: expanded.policyBytes.length, releaseSha256: seventh.inventory.release.sha256, releaseBytes: seventh.inventory.release.byteLength, policySha256: digest(expanded.policyBytes), dataOnly: true };
  passed('seventh compatible synthetic framework adds ordinary data; 301 selections prove 300 is not an item cap');
  receipt.browser = await proveScaleBrowser({ output, policyPath, frameworks, evidencePath: join(output, 'review-evidence.original.json'), expected: saved, inventories, evidenceBytes });
  passed('actual browser download and fresh context import agree with public headless read at 300 selected items');
  receipt.status = 'passed';
} catch (error) {
  receipt.status = 'failed'; receipt.error = { message: error.message, stack: error.stack }; throw error;
} finally { await save('functional-scale.json', receipt); }
