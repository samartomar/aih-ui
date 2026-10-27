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
