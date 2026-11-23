import assert from 'node:assert/strict';
import test from 'node:test';
import { selectedToolRecipes } from '../../src/approved/tool-setup.js';

test('eligible tool recipes start selected and exclusions apply to exact Catalog identities', () => {
  const first = { id: 'release-a/serena.ai-setup.serena', kind: 'ai-setup' };
  const second = { id: 'release-b/serena.ai-setup.serena', kind: 'ai-setup' };
  const support = { id: 'release-a/serena.mcp.serena', kind: 'mcp' };
  const items = [first, support, second];

  assert.deepEqual(selectedToolRecipes(items), [first, second]);
  assert.deepEqual(selectedToolRecipes(items, [first.id]), [second]);
  assert.deepEqual(selectedToolRecipes(items, [first.id, second.id]), []);
});
