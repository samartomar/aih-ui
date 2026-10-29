import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const files = ['tools/consumer/authoring-page.test.mjs', 'tools/consumer/organization-author.test.mjs'];

test('item-0 tests use prepared Catalog content, never legacy release exports', async () => {
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /releaseExport:\s*['"`]\.\/release-(?:extensions|ecc|superpowers|anthropic)\.json['"`]/, file);
    assert.match(source, /installedFamilies\(/, file);
  }
});
