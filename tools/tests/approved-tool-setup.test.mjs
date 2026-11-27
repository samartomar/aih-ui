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

test('an organization policy offers each recipe only for the CLI targets it permits', async () => {
  const { offeredToolRecipes, recipePermitted } = await import('../../src/approved/tool-setup.js');
  const serena = { id: 'release-a/serena.ai-setup.serena', kind: 'ai-setup' };
  const graph = { id: 'release-a/crg.ai-setup.code-review-graph', kind: 'ai-setup' };
  const prohibited = { id: 'release-a/cbm.ai-setup.codebase-memory-mcp', kind: 'ai-setup' };
  const individual = { items: [serena, graph, prohibited] };
  assert.deepEqual(offeredToolRecipes(individual, []), [serena, graph, prohibited]);
  const member = { items: [serena, graph], itemClients: { [serena.id]: ['claude-code', 'codex'], [graph.id]: ['codex'] } };
  assert.deepEqual(offeredToolRecipes(member, ['claude-code', 'codex']), [serena, graph]);
  assert.deepEqual(offeredToolRecipes(member, ['claude-code']), [serena]);
  assert.deepEqual(offeredToolRecipes(member, []), []);
  assert.equal(recipePermitted(member, graph, 'claude-code'), false);
  assert.equal(recipePermitted(member, prohibited, 'codex'), false);
  assert.equal(recipePermitted(individual, prohibited, 'codex'), true);
});
