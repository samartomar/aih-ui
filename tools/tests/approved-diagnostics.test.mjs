import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diagnosticLines } from '../../src/approved/reports.js';

test('machine check observations are readable text without objects or placeholders', () => {
  const lines = diagnosticLines({
    observations: [{ id: 'node', detail: {} }, { id: 'node', detail: 'Selected host node.exe; PATH entry ? for the host.' },
      { id: 'git', detail: 'Used git.exe from PATH entry ?.' }, { id: 'kept', detail: 'Selected host node; PATH entry 2 for the host.' },
      { id: 'empty', detail: '  ' }, {}],
    diagnostics: [{ code: 'A', message: {}, reason: 'Offline inspection.' }, { code: 'B', message: '{}' }, null],
  });
  assert.deepEqual(lines, ['Selected host node.exe; an unnumbered PATH entry for the host.', 'Used git.exe from PATH.',
    'Selected host node; PATH entry 2 for the host.', 'Offline inspection.']);
  for (const line of lines) assert.doesNotMatch(line, /\{\}|\?|\[object/);
  assert.deepEqual(diagnosticLines({}), []);
});
