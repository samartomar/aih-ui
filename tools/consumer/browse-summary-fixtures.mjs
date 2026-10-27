// Public Scan decision-table specimens. Authentication is fixture input only;
// these summaries never describe the actual prepared content or grant trust.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { summariseItem } from '@aihq/scan/read';
import { stable } from './primitives.mjs';
export async function summaryFixtures() {
  const data = JSON.parse(await readFile(new URL(import.meta.resolve('@aihq/scan/schemas/item-summary/1.0.0.fixtures.json')), 'utf8'));
  const cases = [];
  for (const specimen of data.cases.filter(value => value.expectation === 'accept')) {
    const input = structuredClone(specimen.input);
    for (const candidate of input.assessmentsInput.assessments) if ('document' in candidate) {
      candidate.bytes = new TextEncoder().encode(stable(candidate.document)); delete candidate.document;
    }
    const result = await summariseItem(input);
    assert.equal(result.status, 'summarised'); assert.deepEqual(result.summary, specimen.value);
    cases.push({ row: specimen.row, name: specimen.name, result });
  }
  return cases;
}

export async function fallbackFixture() {
  const { readInstalledPreparedContent } = await import('@aihq/catalog/node');
  const { checkCompatibility, toolBindings } = await import('@aihq/core/harness');
  const { dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
  const read = await readInstalledPreparedContent({ root, frameworkId: 'superpowers', sourceInput: 'public-fallback-specimen' });
  assert.equal(read.valid, true);
  const item = read.release.items.find(item => item.fallback);
  const fallback = read.release.items.find(candidate => candidate.id === item.fallback.itemId);
  const platform = { os: 'windows', arch: 'x64' };
  const checked = checkCompatibility({ tool: 'kiro', platform, binding: toolBindings.find(binding => binding.tool === 'kiro'), items: [{ item, fallback }] });
  assert.equal(checked.status, 'checked'); assert.equal(checked.items[0].boundAs?.kind, fallback.kind);
  return { releaseSha256: read.release.sha256, platform, compatibility: { items: checked.items, sets: checked.sets, checks: [] } };
}
