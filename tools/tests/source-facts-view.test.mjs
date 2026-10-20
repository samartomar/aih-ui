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
