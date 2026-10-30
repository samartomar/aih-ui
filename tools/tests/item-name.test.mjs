import test from 'node:test';
import assert from 'node:assert/strict';
import { replacedNames } from '../../src/catalog/item-name.js';

test('what an item replaces is named, by this Catalog\'s name or the name Catalog recorded for it, never by id', () => {
  const items = [{ id: 'ecc.rule.typescript.coding-style', name: 'coding-style', payload: { namespace: 'typescript' } }];
  const supersedes = [
    { itemId: 'ecc.rule.typescript.coding-style', name: 'old-coding-style', releaseSha256: 'a'.repeat(64) },
    { itemId: 'mattpocock.grill-me', name: 'grill-me', releaseSha256: 'b'.repeat(64) },
    { itemId: 'mattpocock.gone', releaseSha256: 'c'.repeat(64) },
  ];
  assert.deepEqual(replacedNames(supersedes, items), ['coding-style (typescript)', 'grill-me', '1 earlier item']);
  // Catalog's per-tool copies: two named alike, two matched by hash and named by nothing.
  const copies = [{ itemId: 'ecc.claude.mcp.browser-use', name: 'browser-use' }, { itemId: 'ecc.codex.mcp.browser-use', name: 'browser-use' },
    { itemId: 'extensions.copilot.agent.code-reviewer', match: 'hash' }, { itemId: 'extensions.codex.agent.code-reviewer', match: 'hash' }];
  assert.deepEqual(replacedNames(copies, items), ['browser-use', '2 earlier items']);
  assert.deepEqual(replacedNames([], items), []);
});
