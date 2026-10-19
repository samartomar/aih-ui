import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceView } from '../../src/app/evidence-view.js';
test('history keeps an unavailable identity until Latest is chosen', () => {
  const selection = { status: 'selected', selectedScanId: 'S2', assessments: [{ summary: { scanId: 'S2' } }] };
  assert.deepEqual(evidenceView(selection, 'S1'), { scanId: 'S1', mode: 'history', unavailable: true, newer: true, entry: undefined });
  assert.equal(evidenceView(selection).scanId, 'S2');
});
