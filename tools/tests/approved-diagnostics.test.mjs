import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diagnosticLines } from '../../src/approved/reports.js';

test('machine check observations are readable text without objects, shown as Core words them', () => {
  const lines = diagnosticLines({
    observations: [{ id: 'node', detail: {} }, { id: 'node', detail: 'Selected host node.exe, which is not in any PATH entry.' },
      { id: 'other', detail: 'Core text with PATH entry ? is not reworded.' }, { id: 'kept', detail: 'Selected host node; PATH entry 2 for the host.' },
      { id: 'empty', detail: '  ' }, {}],
    diagnostics: [{ code: 'A', message: {}, reason: 'Offline inspection.' }, { code: 'B', message: '{}' }, null],
  });
  assert.deepEqual(lines, ['Selected host node.exe, which is not in any PATH entry.', 'Core text with PATH entry ? is not reworded.',
    'Selected host node; PATH entry 2 for the host.', 'Offline inspection.']);
  for (const line of lines) assert.doesNotMatch(line, /\{\}|\[object/);
  assert.deepEqual(diagnosticLines({}), []);
});
