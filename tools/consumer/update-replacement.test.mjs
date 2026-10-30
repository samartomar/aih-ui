import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePolicy } from '@aihq/core/contracts';
import { updateReplacement } from './host.mjs';

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
