import test from 'node:test';
import assert from 'node:assert/strict';
import { sourcePresentation } from '../../src/catalog/source-facts.js';
test('optional absence uses the exact source identifier and never copied delivery prose', () => {
  const shown = sourcePresentation({ id: 'catalog.id', label: 'Copied', description: 'Replacement', metadata: { sourceFacts: {
    identifier: 'commands/check.md', profile: 'claude-command', status: 'valid', diagnostics: [], name: { state: 'absent', required: false, locator: 'frontmatter.name' }, description: { state: 'absent', required: false, locator: 'frontmatter.description' }
  } } });
  assert.equal(shown.name, 'commands/check.md');
  assert.equal(shown.description, 'Description not declared (optional).');
});

test('unsupported interpretation and malformed presentation metadata remain explicit', () => {
  const facts = { profile: 'future-profile', status: 'unsupported', identifier: 'source/file', diagnostics: [{ field: 'profile', message: 'Unsupported source profile.' }],
    name: { state: 'absent', required: false, locator: 'name' }, description: { state: 'absent', required: false, locator: 'description' } };
  const shown = sourcePresentation({ id: 'stable.id', metadata: { sourceFacts: facts } });
  assert.equal(shown.name, 'source/file');
  assert.equal(shown.facts.status, 'unsupported');
  assert.equal(sourcePresentation({ id: 'stable.id', description: 'Unverified replacement', metadata: { sourceFacts: { ...facts, diagnostics: null } } }).description, 'Source facts unavailable (invalid metadata).');
});

test('an MCP server Catalog reads from a shared configuration key shows none of Catalog\'s provider note', () => {
  const note = 'Unsupported provider: token-optimizer-mcp 2.17.0 is not a maintained runnable baseline. Source configuration is retained as unverified bytes only.';
  const server = { id: 'ecc.mcp.token-optimizer', role: 'choosable', kind: 'mcp-server', nameBasis: 'key', name: 'token-optimizer', label: 'token-optimizer', description: note };
  assert.equal(sourcePresentation(server).description, 'Description not published.');
  const { role: _role, ...bare } = server;
  assert.equal(sourcePresentation(bare).description, 'Description not published.');
  // An authored description stays the item's own.
  const skill = { id: 'ecc.skill.x', role: 'choosable', kind: 'skill', nameBasis: 'authored', name: 'x', description: 'Does x.' };
  assert.equal(sourcePresentation(skill).description, 'Does x.');
});
