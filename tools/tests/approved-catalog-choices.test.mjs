import assert from 'node:assert/strict';
import test from 'node:test';
import { browseSelections } from '../../src/approved/catalog-choices.js';

const itemId = 'guide.skill.example';
const original = 'a'.repeat(64) + '/' + itemId;
const pinned = new Set([original]);
const same = '1'.repeat(64);
const changed = '2'.repeat(64);

function source(revision, browseFingerprint) {
  const id = revision.repeat(64);
  return [{ id, browseFingerprint }, { id: id + '/' + itemId, itemId, framework: id }];
}

function catalog(...sources) {
  return { frameworks: sources.map(([framework]) => framework), items: sources.map(([, item]) => item) };
}

test('a saved exact choice supplies its provenance while its original Catalog document is still available', () => {
  const originalSource = source('a', same);
  const replacement = source('b', same);
  const earlier = browseSelections(catalog(originalSource, replacement), pinned, {});
  assert.deepEqual(earlier.saved, { [original]: same });
  assert.equal(earlier.replacements.size, 0);
  const current = browseSelections(catalog(replacement), pinned, earlier.saved);
  assert.deepEqual([...current.replacements], [[replacement[1].id, original]]);
  assert.deepEqual([...pinned], [original]);
});

test('missing provenance, a changed declaration and multiple identical candidates preserve the original unresolved choice', () => {
  const replacement = source('b', same);
  const changedSource = source('b', changed);
  const anotherMatch = source('c', same);
  const proof = { [original]: same };
  assert.equal(browseSelections(catalog(replacement), pinned, {}).replacements.size, 0);
  assert.equal(browseSelections(catalog(changedSource), pinned, proof).replacements.size, 0);
  assert.equal(browseSelections(catalog(replacement, anotherMatch), pinned, proof).replacements.size, 0);
});
