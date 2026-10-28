import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstRunForSets, firstRunWords } from '../../tools/consumer/first-run.mjs';

const sha = 'a'.repeat(64);
const inventory = (sets, items = []) => [{ release: { framework: { id: 'ecc' }, sets, items } }];
const starter = { setId: 'starter', setSha256: sha, firstRun: { framework: 'ecc', itemId: 'ecc.setup' } };
const plain = { setId: 'plain', setSha256: 'b'.repeat(64) };

test('an exact set match resolves the declared first step to the checked item’s name and kind', () => {
  const result = firstRunForSets(inventory([starter], [{ id: 'ecc.setup', label: 'Set up ECC', kind: 'skill' }]), [{ framework: 'ecc', setId: 'starter', setSha256: sha }]);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.value[0].firstRun, { itemId: 'ecc.setup', name: 'Set up ECC', kind: 'skill' });
  assert.match(firstRunWords(result.value)[0], /^First step: Set up ECC \(skill\)/);
});

test('a set without firstRun, a wrong digest, or an unresolvable reference stays explicitly unavailable — never inferred', () => {
  const result = firstRunForSets(inventory([plain, starter, { setId: 'broken', setSha256: 'c'.repeat(64), firstRun: { framework: 'ecc', itemId: 'ecc.gone' } }], [{ id: 'ecc.setup' }]), [
    { framework: 'ecc', setId: 'plain', setSha256: 'b'.repeat(64) },
    { framework: 'ecc', setId: 'starter', setSha256: 'f'.repeat(64) },
    { framework: 'ecc', setId: 'broken', setSha256: 'c'.repeat(64) },
    { framework: 'missing', setId: 'starter', setSha256: sha },
  ]);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.value.map(entry => entry.firstRun), [null, null, null, null]);
  assert.match(firstRunWords(result.value)[0], /^First-step guidance unavailable for set plain: This set declares no first step\.$/);
  assert.match(firstRunWords(result.value)[1], /unavailable in the checked sources/);
  assert.match(firstRunWords(result.value)[2], /does not resolve to an item/);
  assert.match(firstRunWords(result.value)[3], /unavailable in the checked sources/);
});

test('malformed set references refuse instead of guessing', () => {
  assert.equal(firstRunForSets(inventory([starter]), [{ framework: 'ecc', setId: 'starter' }]).status, 'refused');
  assert.equal(firstRunForSets(inventory([starter]), 'nope').status, 'refused');
});
