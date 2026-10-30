import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePolicy } from '@aihq/core/contracts';
import { updateReplacement, updateRequirements } from './host.mjs';

// A Catalog 1.7 item rendered from Core's binding is composed as an execution policy 1.6.0 selection; Core's
// prepareUpdate reads replacements as 1.4.0 selections and refused it as "/selections/0/bindingDigest".
const rendered = {
  id: 'rule', managementId: 'project--aihq.catalog--ecc.rule.typescript.coding-style', scope: 'project', configuration: { keep: true },
  requires: ['notices', 'other-replacement'], recipe: { inline: { schema: 'urn:aihq:core:recipe:1.0.0', id: 'rule' } },
  item: { framework: 'ecc', itemId: 'ecc.rule.typescript.coding-style', contentSha256: 'a'.repeat(64), behaviourSha256: 'b'.repeat(64) },
  tool: 'claude', name: 'coding-style', kind: 'rule',
  origins: [{ reasonIncluded: 'in-set', set: { framework: 'ecc', setId: 'ecc.rules.typescript', setSha256: 'c'.repeat(64) } }],
  bindingDigest: 'd'.repeat(64), scanRecords: [], itemMaterials: []
};

test('an update replacement is the 1.4.0 selection Core reads, keeping configuration and origins', () => {
  const replacement = updateReplacement(rendered, new Set(['rule', 'other-replacement']));
  for (const field of ['bindingDigest', 'scanRecords', 'itemMaterials']) assert.equal(Object.hasOwn(replacement, field), false, field);
  assert.deepEqual(replacement.configuration, rendered.configuration);
  assert.deepEqual(replacement.origins, rendered.origins);
  assert.deepEqual(replacement.item, rendered.item);
  assert.deepEqual(replacement.recipe, rendered.recipe);
  // Only other replacements may be required; Core keeps the edge to the installed document from the install.
  assert.deepEqual(replacement.requires, ['other-replacement']);
});

test('Core accepts the replacement in the 1.4.0 policy its update preparation builds', () => {
  const policy = selection => ({ schema: 'urn:aihq:core:execution-policy:1.4.0', mode: 'vibe', selections: [selection] });
  const refused = validatePolicy(policy({ ...rendered, requires: [] }));
  assert.equal(refused.valid, false, 'the unprojected selection is refused');
  assert.ok(refused.diagnostics.some(item => item.path === '/selections/0/bindingDigest'), JSON.stringify(refused.diagnostics));
  const accepted = validatePolicy(policy(updateReplacement(rendered, new Set(['rule']))));
  assert.equal(accepted.diagnostics.some(item => item.path === '/selections/0/bindingDigest'), false, JSON.stringify(accepted.diagnostics));
});

// A replacement's required selections: Core keeps the edges recorded at install, so only those to selections still
// installed may be left to it; anything else the newer item requires stops the update before Core is asked.
const rule = { id: 'rule', managementId: 'project--rule', scope: 'project', requires: ['notices', 'readme', 'other'] };
const policySelections = [rule,
  { id: 'notices', managementId: 'project--notices', scope: 'project', item: { framework: 'ecc', itemId: 'ecc.notices' } },
  { id: 'readme', managementId: 'project--readme', scope: 'project', item: { framework: 'ecc', itemId: 'ecc.rule.README' } },
  { id: 'other', managementId: 'project--other', scope: 'project', item: { framework: 'ecc', itemId: 'ecc.other' } }];

test('a requirement recorded at install and still installed is left to Core; another replacement is kept', () => {
  const missing = updateRequirements({ selection: { ...rule, requires: ['notices', 'other'] }, policySelections, replacementIds: new Set(['rule', 'other']),
    recordedRequires: ['project:project--notices'], installed: new Set(['project:project--notices', 'project:project--rule']) });
  assert.deepEqual(missing, []);
});

test('a requirement the newer item adds, not installed, is named as missing', () => {
  const missing = updateRequirements({ selection: { ...rule, requires: ['notices', 'readme'] }, policySelections, replacementIds: new Set(['rule']),
    recordedRequires: ['project:project--notices'], installed: new Set(['project:project--notices', 'project:project--rule']) });
  assert.deepEqual(missing, [{ item: { framework: 'ecc', itemId: 'ecc.rule.README' }, installed: false }]);
});

test('an installed selection the item did not require at install is not dropped either', () => {
  const missing = updateRequirements({ selection: { ...rule, requires: ['readme'] }, policySelections, replacementIds: new Set(['rule']),
    recordedRequires: [], installed: new Set(['project:project--readme']) });
  assert.deepEqual(missing, [{ item: { framework: 'ecc', itemId: 'ecc.rule.README' }, installed: true }]);
});

test('without a record of the install, no requirement is dropped', () => {
  const missing = updateRequirements({ selection: { ...rule, requires: ['notices'] }, policySelections, replacementIds: new Set(['rule']),
    recordedRequires: undefined, installed: new Set(['project:project--notices']) });
  assert.deepEqual(missing, [{ item: { framework: 'ecc', itemId: 'ecc.notices' }, installed: true }]);
});
