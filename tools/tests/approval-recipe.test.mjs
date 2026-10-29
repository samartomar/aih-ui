// Q2 regression: a recorded inline approval recipe stands only while it matches the public renderer's
// current output for the checked item/tool/scope — never by recipe id alone.
// Run: node --test tools/tests/approval-recipe.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalRecipeStands } from '../consumer/approval-recipe.mjs';

const item = { id: 'ecc.mcp.browser-use', kind: 'mcp-server' };
const renderedRecipe = { schema: 'urn:aihq:core:recipe:1.4.0', id: 'claude.ecc.mcp.browser-use', operations: [{ id: 'approve-server' }, { id: 'register-server' }] };
const prior = { tool: 'claude', item: { framework: 'ecc', itemId: item.id }, recipe: { inline: renderedRecipe } };
const renderDelivery = recipe => ({ tool, args }) => ({ status: 'rendered', recipe });
const bindings = [{ tool: 'claude' }];
const base = { prior, item, scope: 'project', toolBindings: bindings };

test('an unchanged renderer output keeps the recorded approval recipe', () => {
  assert.equal(approvalRecipeStands({ ...base, renderDelivery: renderDelivery(renderedRecipe) }), true);
});

test('altered executable operations with the same recipe id do NOT stand', () => {
  const tampered = { ...renderedRecipe, operations: [{ id: 'approve-server' }, { id: 'register-server' }, { id: 'run-anything', kind: 'process.run' }] };
  assert.equal(approvalRecipeStands({ ...base, renderDelivery: renderDelivery(tampered) }), false);
});

test('a renderer refusal or a missing binding or a non-mcp kind never stands', () => {
  assert.equal(approvalRecipeStands({ ...base, renderDelivery: () => ({ status: 'refused', reason: 'shape' }) }), false);
  assert.equal(approvalRecipeStands({ ...base, toolBindings: [], renderDelivery: renderDelivery(renderedRecipe) }), false);
  assert.equal(approvalRecipeStands({ ...base, item: { ...item, kind: 'skill' }, renderDelivery: renderDelivery(renderedRecipe) }), false);
});
