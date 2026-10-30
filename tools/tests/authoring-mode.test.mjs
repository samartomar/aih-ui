import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authoringMode } from '../../src/app/setup-model.js';

test('an Enterprise setup composes an Enterprise policy for an Admin as for a Developer', () => {
  assert.equal(authoringMode({ experience: 'enterprise', role: 'admin', organization: { name: 'Gosam' } }), 'enterprise');
  assert.equal(authoringMode({ experience: 'enterprise', role: 'developer', organization: null }), 'enterprise');
  assert.equal(authoringMode({ experience: 'vibe' }), 'vibe');
  assert.equal(authoringMode(null), 'vibe');
});
