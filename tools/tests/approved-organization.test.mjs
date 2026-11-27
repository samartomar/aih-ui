import assert from 'node:assert/strict';
import { test } from 'node:test';

// The organization screen reads the page address when it loads.
globalThis.location ??= { search: '' };
const { checkSelection, companionNotice, normalizeSelection, publisherFacts, toolSetupCompanions } = await import('../../src/approved/organization.js');

const data = { clients: [{ id: 'codex' }], items: [{ id: 'release/item' }],
  packages: { core: { version: '1' }, catalog: { version: '2' }, scan: { version: '3' } } };
const selection = { format: 'aih-workbench-team-selection/1', organization: ' Fixture Org ', source: '', clients: ['codex'],
  items: ['release/item'], versions: { core: '1', catalog: '2', scan: '3' } };

test('a team selection needs no typed policy owner', () => {
  const current = normalizeSelection(selection);
  assert.equal(Object.hasOwn(current, 'owner'), false);
  assert.equal(current.organization, 'Fixture Org');
  assert.deepEqual(checkSelection(current, data), []);
});

test('an earlier saved selection with an owner still opens without keeping it', () => {
  const earlier = normalizeSelection({ ...selection, owner: 'Fixture Steward' });
  assert.deepEqual(earlier, normalizeSelection(selection));
  assert.throws(() => normalizeSelection({ ...selection, owner: 7 }), /team selection/);
});

test('the member sees the verified publisher with the policy change, or why it is not verified', () => {
  const commit = 'c'.repeat(40), branch = 'b'.repeat(40);
  assert.deepEqual(publisherFacts({ status: 'verified', commit, login: 'fixture-admin', pull: 1 }, commit),
    { rows: [['Published by', 'fixture-admin · merged pull request #1 · policy change ccccccc']], branch: null, note: null });
  const later = publisherFacts({ status: 'verified', commit, login: 'fixture-admin', pull: 1 }, branch);
  assert.deepEqual(later.branch, ['Branch commit read', branch]);
  assert.equal(later.note, 'Later commits on this branch did not change the policy file.');
  const notFound = publisherFacts({ status: 'not-found', commit, author: 'pusher' }, commit);
  assert.deepEqual(notFound.rows, [['Published by', 'Not verified: no merged pull request was found for policy change ccccccc'],
    ['Commit author (unverified)', 'pusher']]);
  assert.ok(!notFound.rows[0][1].includes('pusher'));
  const failed = publisherFacts({ status: 'lookup-failed', commit, author: 'pusher' }, commit);
  assert.deepEqual(failed.rows, [['Published by', 'GitHub could not be checked for the merged pull request. Try again.'],
    ['Commit author (unverified)', 'pusher']]);
  assert.ok(!failed.rows.flat().join(' ').includes('No merged pull request'), 'A failed lookup is not reported as not found.');
  const unknown = publisherFacts({ status: 'lookup-failed', commit: null }, branch);
  assert.deepEqual(unknown, { rows: [['Published by', 'GitHub could not be checked for the merged pull request. Try again.']],
    branch: ['Branch commit read', branch], note: null });
  assert.deepEqual(publisherFacts({ status: 'no-commit', commit: null }, branch).rows,
    [['Published by', 'Not verified: no commit on this branch changed the policy file.']]);
  assert.equal(publisherFacts(undefined, branch).rows[0][1], 'GitHub could not be checked for the merged pull request. Try again.');
});

test('the administrator review names each companion MCP item a Tool Setup recipe configures', () => {
  const recipe = { id: 'r/serena.ai-setup.serena', itemId: 'serena.ai-setup.serena', title: 'Serena', kind: 'ai-setup', framework: 'r', mcpItem: 'serena.mcp.serena' };
  const mcp = { id: 'r/serena.mcp.serena', itemId: 'serena.mcp.serena', title: 'Serena MCP', kind: 'mcp', framework: 'r' };
  const elsewhere = { ...mcp, id: 'o/serena.mcp.serena', framework: 'o' };
  const catalog = { items: [recipe, mcp, elsewhere] };
  assert.deepEqual(toolSetupCompanions({ items: [recipe.id] }, catalog), [{ item: 'serena.mcp.serena', title: 'Serena MCP', recipeTitle: 'Serena' }]);
  assert.deepEqual(toolSetupCompanions({ items: [recipe.id, mcp.id] }, catalog), [], 'An explicitly chosen MCP item is not a companion.');
  assert.deepEqual(toolSetupCompanions({ items: [mcp.id] }, catalog), []);
  assert.equal(companionNotice({ item: 'serena.mcp.serena', title: 'Serena MCP', recipeTitle: 'Serena' }),
    'Serena includes its MCP server configuration (Serena MCP), which members cannot install on its own.');
  // A shared title names the MCP item by its plain Catalog ID instead of repeating itself.
  assert.equal(companionNotice({ item: 'serena.mcp.serena', title: 'Serena', recipeTitle: 'Serena' }),
    'Serena includes its MCP server configuration (serena.mcp.serena), which members cannot install on its own.');
});
