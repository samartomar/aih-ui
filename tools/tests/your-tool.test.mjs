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

test('the header holds one tool list; the Core tools are under Settings, Advanced, as "Tools to set up on this machine"', () => {
  const html = readFileSync(new URL('../../src/index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const header = /<header[\s\S]*?<\/header>/.exec(html)[0].replace(/<!--[\s\S]*?-->/g, '');
  assert.match(header, /id="your-tool-trigger"/);
  const trigger = /<button[^>]*id="your-tool-trigger"[\s\S]*?<\/button>/.exec(header)[0];
  assert.doesNotMatch(trigger, /your-tool-core|Core/, 'no Core suffix beside Your tool');
  const settings = /<div id="workspace-actions"[\s\S]*?<\/details>/.exec(header)[0];
  const advanced = /<details id="settings-advanced"[\s\S]*?<\/details>/.exec(settings)?.[0];
  assert.ok(advanced, 'Settings has an Advanced part');
  assert.match(advanced, /<summary[^>]*>Advanced<\/summary>/);
  for (const id of ['ai-tools-trigger', 'ai-tools-count', 'ai-tools-pop', 'ai-tools-list', 'ai-tools-note', 'your-tool-core'])
    assert.match(advanced, new RegExp(`id="${id}"`), `${id} is in Settings, Advanced`);
  assert.match(advanced, /Tools to set up on this machine/);
  assert.match(advanced, /Check this machine/);
  assert.match(advanced, /Get started/);
  const outside = settings.replace(advanced, '');
  assert.doesNotMatch(outside, /ai-tools-trigger|Core tools/, 'the Core tools list is not outside Advanced');
  const cards = /<div class="catalog-cards-region[\s\S]*?id="cards-grid"/.exec(html)[0];
  assert.doesNotMatch(cards, /catalog-tools-bar|browse-target/, 'the cards area has no separate tool line');
  const catalogAdvanced = /<details id="catalog-advanced"[\s\S]*?<\/details>\n<\/div>/.exec(html)[0];
  assert.match(catalogAdvanced, /id="catalog-tools-bar"/);
  assert.match(catalogAdvanced, /id="browse-target"/);
});

test('with nothing saved in this browser for this address, the page says the choice is remembered here', () => {
  const model = yourToolModel({ ...base, place: '127.0.0.1:4895' });
  assert.equal(model.value, 'Choose your tool');
  assert.match(model.status, /remembered in this browser for this address \(127\.0\.0\.1:4895\)/);
  assert.doesNotMatch(yourToolModel({ ...base, tool: 'claude-code', place: '127.0.0.1:4895' }).status, /remembered/);
});

test('a saved tool the Catalog no longer declares is said plainly when it is cleared', () => {
  const model = yourToolModel({ ...base, forgotten: 'old-tool', place: 'localhost:4895' });
  assert.equal(model.value, 'Choose your tool');
  assert.match(model.status, /Your saved tool old-tool is no longer in the Catalog, so it was cleared\./);
});
