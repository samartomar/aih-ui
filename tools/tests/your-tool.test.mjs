import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { yourToolModel } from '../../src/catalog/your-tool.js';

const declared = ['claude-code', 'codex', 'copilot-vscode', 'generic', 'kiro-ide'];
const base = { declared, tool: '', coreIds: ['claude', 'codex'], coreLabels: { claude: 'Claude Code' }, coreSelected: [], undeclared: 7, showUndeclared: false, shown: 40 };

test('the header control lists the Catalog\'s declared tool names, without generic, and says what generic is', () => {
  const model = yourToolModel(base);
  assert.deepEqual(model.options.map(option => option.value), ['claude-code', 'codex', 'copilot-vscode', 'kiro-ide']);
  assert.match(model.genericNote, /generic/);
  assert.match(model.genericNote, /not one tool/i);
});

test('with no tool chosen it says "Choose your tool" and the page says content is not filtered', () => {
  const model = yourToolModel(base);
  assert.equal(model.value, 'Choose your tool');
  assert.match(model.status, /not filtered/i);
  assert.equal(model.options.some(option => option.checked), false);
});

test('a chosen tool is the value, is checked, and the page says what is shown and what is not', () => {
  const model = yourToolModel({ ...base, tool: 'claude-code' });
  assert.equal(model.value, 'claude-code');
  assert.deepEqual(model.options.filter(option => option.checked).map(option => option.value), ['claude-code']);
  assert.match(model.status, /claude-code/);
  assert.match(model.status, /7 with no declared tool are hidden/);
  assert.match(model.undeclaredLabel, /Show 7 with no declared tool/);
  assert.match(model.status, /supported for claude-code according to the Catalog/);
  assert.match(yourToolModel({ ...base, tool: 'claude-code', notSupported: 117 }).status, /117 not marked supported for claude-code are hidden; Advanced shows them\./);
  assert.match(yourToolModel({ ...base, tool: 'claude-code', notSupported: 117, showUnsupported: true }).status, /117 not marked supported for claude-code are shown\./);
  assert.match(yourToolModel({ ...base, tool: 'claude-code', showUndeclared: true }).status, /7 with no declared tool are shown\./);
});

test('the Core tool label shows only when the person chose Core tools in Settings, never derived from the Catalog name', () => {
  assert.equal(yourToolModel({ ...base, tool: 'claude-code' }).core, '');
  assert.equal(yourToolModel({ ...base, tool: '', coreSelected: ['claude'] }).core, 'Core: Claude Code');
  assert.equal(yourToolModel({ ...base, tool: 'kiro-ide', coreSelected: ['claude', 'codex'] }).core, 'Core: Claude Code, codex');
  // A saved Core choice this Core no longer lists is not shown as a Core tool.
  assert.equal(yourToolModel({ ...base, coreSelected: ['gone'] }).core, '');
});

test('showing every tool (from Advanced) is said in the header and the page', () => {
  const model = yourToolModel({ ...base, tool: 'codex', mode: 'all' });
  assert.match(model.status, /every tool/i);
});

test('the header holds one tool control; the Core Tools chip and the tool line are under Settings and Advanced', () => {
  const html = readFileSync(new URL('../../src/index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const header = /<header[\s\S]*?<\/header>/.exec(html)[0];
  assert.match(header, /id="your-tool-trigger"/);
  const settings = /<div id="workspace-actions"[\s\S]*?<\/div>\n<\/div>/.exec(html)[0];
  assert.match(settings, /id="ai-tools-trigger"/, 'the Core Tools chip is in the Settings menu');
  const cards = /<div class="catalog-cards-region[\s\S]*?id="cards-grid"/.exec(html)[0];
  assert.doesNotMatch(cards, /catalog-tools-bar|browse-target/, 'the cards area has no separate tool line');
  const advanced = /<details id="catalog-advanced"[\s\S]*?<\/details>\n<\/div>/.exec(html)[0];
  assert.match(advanced, /id="catalog-tools-bar"/);
  assert.match(advanced, /id="browse-target"/);
});
