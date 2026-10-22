import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogToolView, declaredTools, filterByTools, toolLine, toolRelation, toolsNotice } from '../../src/catalog/tool-match.js';
import { toolWarning } from '../../src/app/install-panel.js';

const fact = (client, surface) => ({ capability: 'skill-material-format', client, surface, support: 'supported' });
const item = (id, ...facts) => ({ id, label: 'grill-me', metadata: facts.length ? { discovery: { clientCapabilities: facts } } : {} });
const claudeCopy = item('extensions.matt.grill-me', fact('claude-code', '.claude/skills'), { ...fact('claude-code', '.claude/skills'), capability: 'automatic-guardrails' });
const kiroCopy = item('extensions.kiro.matt.grill-me', fact('kiro-ide', '.kiro/skills'));
const codexCopy = item('extensions.codex.thing', fact('codex', '.codex'));
const anyTool = item('extensions.notices', fact('generic', 'project'));
const undeclared = item('mattpocock.grill-me');
const core = { coreIds: ['claude', 'codex', 'kiro', 'copilot'], selected: ['claude'], labels: { claude: 'Claude Code' } };
const entries = [claudeCopy, kiroCopy, codexCopy, anyTool, undeclared].map(authoringItem => ({ authoringItem }));

test('a card names the tool and folder the Catalog declares, once per tool', () => {
  assert.deepEqual(declaredTools(claudeCopy), [{ client: 'claude-code', surface: '.claude/skills' }]);
  assert.equal(toolLine(claudeCopy), 'For claude-code · .claude/skills');
  assert.equal(toolLine(kiroCopy), 'For kiro-ide · .kiro/skills');
  assert.equal(toolLine(anyTool), 'For any AI tool');
  assert.equal(toolLine(undeclared), 'Tool not declared');
});

test('names are compared exactly: claude-code is not translated to claude', () => {
  assert.equal(toolRelation(codexCopy, { ...core, selected: ['codex'] }), 'selected');
  assert.equal(toolRelation(codexCopy, core), 'other');
  assert.equal(toolRelation(claudeCopy, core), 'unmatched');
  assert.equal(toolRelation(kiroCopy, core), 'unmatched');
  assert.equal(toolRelation(anyTool, core), 'any');
  assert.equal(toolRelation(undeclared, core), 'any');
});

test('the header tools hide only content clearly for an unselected Core tool, and the notice says so only when it hides something', () => {
  const shown = filterByTools(entries, { mode: 'mine', ...core }).map(entry => entry.authoringItem.id);
  assert.deepEqual(shown, ['extensions.matt.grill-me', 'extensions.kiro.matt.grill-me', 'extensions.notices', 'mattpocock.grill-me']);
  assert.equal(filterByTools(entries, { mode: 'all', ...core }).length, 5);
  assert.equal(filterByTools(entries, { mode: 'mine', ...core, selected: [] }).length, 5, 'no tools chosen: nothing hidden');
  assert.equal(filterByTools(entries, { mode: 'mine', ...core, coreIds: [] }).length, 5, 'no Core list: nothing hidden');
  assert.match(toolsNotice(entries, { mode: 'mine', ...core }), /^1 item the Catalog lists only for Core tools you did not choose in Settings \(codex\) is also hidden\.$/);
  const noCodex = entries.filter(entry => entry.authoringItem !== codexCopy);
  assert.equal(toolsNotice(noCodex, { mode: 'mine', ...core }), '', 'hides nothing, so says nothing');
  assert.equal(toolsNotice(entries, { mode: 'all', ...core }), '');
});

test('the chosen Catalog tool is the real filter, whatever its support value, with undeclared items behind a counted switch', () => {
  const ids = view => view.entries.map(entry => entry.authoringItem.id);
  const unsupported = item('extensions.kiro.agent', { ...fact('kiro-ide', 'agents'), support: 'unsupported' });
  const all = [...entries, { authoringItem: unsupported }];
  const claudeView = catalogToolView(all, { tool: 'claude-code', mode: 'mine' });
  assert.deepEqual(ids(claudeView), ['extensions.matt.grill-me']);
  assert.equal(claudeView.undeclared, 2, 'no tool, or only generic');
  assert.equal(claudeView.filtered, true);
  assert.deepEqual(ids(catalogToolView(all, { tool: 'claude-code', mode: 'mine', showUndeclared: true })), ['extensions.matt.grill-me', 'extensions.notices', 'mattpocock.grill-me']);
  assert.deepEqual(ids(catalogToolView(all, { tool: 'kiro-ide', mode: 'mine' })), ['extensions.kiro.matt.grill-me', 'extensions.kiro.agent']);
  assert.equal(catalogToolView(all, { tool: 'claude-code', mode: 'all' }).entries.length, 6, 'Show all');
  const none = catalogToolView(all, { tool: '', mode: 'mine' });
  assert.equal(none.entries.length, 6, 'no tool chosen: nothing hidden');
  assert.equal(none.filtered, false);
  assert.equal(none.undeclared, 2);
});

test('Install warns only about a chosen item that does not declare the chosen Catalog tool', () => {
  assert.equal(toolWarning([claudeCopy], { catalogTool: 'claude-code' }), '', 'the correct copy gets no warning');
  assert.equal(toolWarning([kiroCopy], { catalogTool: 'claude-code' }), 'Not listed for claude-code: grill-me (kiro-ide).');
  assert.equal(toolWarning([claudeCopy, undeclared, anyTool], { catalogTool: 'claude-code' }), 'Not listed for claude-code: grill-me (no declared tool), grill-me (any AI tool).');
  assert.equal(toolWarning([kiroCopy], {}), '', 'no Catalog tool chosen: nothing to compare');
  assert.equal(toolWarning([kiroCopy], { ...core }), '', 'the header Core ids are never compared with Catalog names');
});

test('the Catalog tool defaults to the person\'s saved choice while the Catalog declares it, otherwise to none', async () => {
  const { defaultCatalogTool } = await import('../../src/catalog/catalog-tool.js');
  const declared = ['claude-code', 'codex', 'kiro-ide'];
  assert.equal(defaultCatalogTool(declared, 'kiro-ide'), 'kiro-ide');
  assert.equal(defaultCatalogTool(declared, 'retired-tool'), '');
  assert.equal(defaultCatalogTool(declared, ''), '', 'no saved choice: no filter, and no guess from the header tools');
});
