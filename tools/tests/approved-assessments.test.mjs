import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessmentRows } from '../service/assessment-rows.mjs';
import { renderWorkbenchOverview } from '../../src/report/render.js';

test('reads each exact Scan key once and projects only the fields the report needs', async () => {
  const calls = [];
  const result = await assessmentRows([
    { id: 'first-revision/one', scanKey: 'shared-key' },
    { id: 'second-revision/one', scanKey: 'shared-key' },
    { id: 'second-revision/two', scanKey: 'missing-key' },
    { id: 'second-revision/three', scanKey: 'unreadable-key' },
  ], async key => {
    calls.push(key);
    if (key === 'unreadable-key') throw new Error('private read error');
    if (key === 'missing-key') return { status: 'missing', artifact: 'private location' };
    return { status: 'read', summary: {
      label: 'CAUTION', coverage: 'complete', scannedAt: '2026-11-04T13:37:02Z', privateField: 'do not send',
    }, artifact: 'private location' };
  });
  assert.deepEqual(calls, ['shared-key', 'missing-key', 'unreadable-key']);
  assert.deepEqual(result, [
    { id: 'first-revision/one', status: 'read', label: 'CAUTION', coverage: 'complete', scannedAt: '2026-11-04T13:37:02Z' },
    { id: 'second-revision/one', status: 'read', label: 'CAUTION', coverage: 'complete', scannedAt: '2026-11-04T13:37:02Z' },
    { id: 'second-revision/two', status: 'missing' },
    { id: 'second-revision/three', status: 'failed' },
  ]);
});

test('V9 labels its exact Catalog scope, missing summaries and unchecked signatures', () => {
  const html = renderWorkbenchOverview({
    catalog: [{ id: 'visible/one', frameworkName: 'Visible framework' }, { id: 'visible/two' }],
    assessment: { status: 'read', checkedAt: '2026-11-23T00:00:00Z', assessments: [
      { id: 'visible/one', status: 'read', label: 'CAUTION', coverage: 'complete', scannedAt: '2026-11-04T13:37:02Z' },
      { id: 'visible/two', status: 'missing' },
      { id: 'hidden/one', status: 'read', label: 'SAFE', coverage: 'outside-role-coverage', scannedAt: '2025-01-01T00:00:00Z' },
    ] },
  });
  for (const fact of ['1 of 2 read', 'CAUTION', 'Missing summary', 'Signatures were not checked', 'Visible framework', '2026-11-04T13:37:02Z']) {
    assert.ok(html.includes(fact), fact);
  }
  assert.ok(!html.includes('outside-role-coverage'));
  assert.ok(!html.includes('2025-01-01T00:00:00Z'));
});
