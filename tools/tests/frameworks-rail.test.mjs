import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { familyLabel, frameworkRows } from '../../src/catalog/frameworks.js';
import { describeScope } from '../../src/catalog/selectors.js';

// Test-only items shaped like the consumer host's catalog: each carries the family the host gave its release.
const items = (family, count) => Array.from({ length: count }, (_, index) => ({ id: `${family}-${index}`, family }));
const catalog = [...items('Catalog', 4), ...items('Superpowers', 2), ...items('ECC', 5), ...items('Independent', 1),
  ...items('Anthropic', 3), ...items('Extensions', 6), ...items('Personal', 2)];

test('the left panel lists the frameworks only, in the owner\'s order, with their counts', () => {
  assert.deepEqual(frameworkRows(catalog), [
    { family: 'Extensions', label: 'AIH-Extensions', count: 6 },
    { family: 'ECC', label: 'ECC', count: 5 },
    { family: 'Anthropic', label: 'Anthropic', count: 3 },
    { family: 'Superpowers', label: 'Superpowers', count: 2 },
  ]);
});

test('the Catalog default release, the review-note fixture and personal content are not frameworks', () => {
  const families = frameworkRows(catalog).map(row => row.family);
  for (const family of ['Catalog', 'Independent', 'Personal']) assert.equal(families.includes(family), false, family);
});

test('a family installed later appears after the named ones, under its own name', () => {
  const rows = frameworkRows([...catalog, ...items('Future', 2)]);
  assert.deepEqual(rows.at(-1), { family: 'Future', label: 'Future', count: 2 });
});

test('a framework with no items is not listed', () => {
  assert.deepEqual(frameworkRows(items('ECC', 1)).map(row => row.family), ['ECC']);
});

test('family labels: the default release reads as other Catalog content, never as a framework', () => {
  assert.equal(familyLabel('Extensions'), 'AIH-Extensions');
  assert.equal(familyLabel('Catalog'), 'Other Catalog content');
  assert.equal(familyLabel('ECC'), 'ECC');
  assert.equal(familyLabel('Personal'), 'Personal');
  // The catalog scopes under Advanced name family releases the same way.
  assert.equal(describeScope({ type: 'family', identityKey: 'Catalog', source: {} }).name, 'Other Catalog content');
  assert.equal(describeScope({ type: 'family', identityKey: 'Extensions', source: {} }).name, 'AIH-Extensions');
});

// The page's own markup: where the framework list and the family dropdown sit.
const html = readFileSync(new URL('../../src/index.html', import.meta.url), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const section = id => {
  const start = html.indexOf(`id="${id}"`), tag = html.lastIndexOf('<', start), name = /<(\w+)/.exec(html.slice(tag))[1];
  let depth = 0;
  for (const match of html.slice(tag).matchAll(new RegExp(`<(/?)${name}\\b`, 'g'))) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return html.slice(tag, tag + match.index);
  }
  return html.slice(tag);
};

test('the framework list is in the left panel; the family dropdown is under Advanced', () => {
  assert.match(section('nav-rail'), /id="framework-list"/);
  assert.match(section('catalog-advanced'), /id="browse-family"/);
  assert.doesNotMatch(section('catalog-filter-disclosure'), /id="browse-family"/);
  // Until the Catalog publishes names (#119), the list says its names are the Workbench's own.
  assert.match(section('nav-rail'), /id="framework-list-title" title="Names supplied by the Workbench/);
});
