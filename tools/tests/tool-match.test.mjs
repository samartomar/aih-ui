import { test } from 'node:test';
import assert from 'node:assert/strict';
import { declaredTools, filterByTools, toolLine, toolRelation, toolsNotice } from '../../src/catalog/tool-match.js';
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

test('"your tools" hides only content clearly for an unselected tool, and says what it cannot decide', () => {
  const shown = filterByTools(entries, { mode: 'mine', ...core }).map(entry => entry.authoringItem.id);
  assert.deepEqual(shown, ['extensions.matt.grill-me', 'extensions.kiro.matt.grill-me', 'extensions.notices', 'mattpocock.grill-me']);
  assert.equal(filterByTools(entries, { mode: 'all', ...core }).length, 5);
  assert.equal(filterByTools(entries, { mode: 'mine', ...core, selected: [] }).length, 5, 'no tools chosen: nothing hidden');
  assert.equal(filterByTools(entries, { mode: 'mine', ...core, coreIds: [] }).length, 5, 'no Core list: nothing hidden');
  const notice = toolsNotice(filterByTools(entries, { mode: 'mine', ...core }), { mode: 'mine', ...core });
  assert.match(notice.showing, /Showing content for your tools: Claude Code \(claude\)/);
  assert.match(notice.unmatched, /2 items name a tool the Catalog calls claude-code, kiro-ide, which does not match Core's tool names/);
  assert.match(toolsNotice(entries, { mode: 'all', ...core }).showing, /all tools/);
});

test('Install warns when an item is for another tool, and when a name cannot be confirmed', () => {
  assert.equal(toolWarning([codexCopy], { ...core, selected: ['codex'] }), '');
  assert.match(toolWarning([codexCopy], core), /Not for your tools: grill-me is for codex\. Your tools: Claude Code \(claude\)\./);
  assert.match(toolWarning([kiroCopy], core), /Check the tool: grill-me is for kiro-ide\. .*cannot confirm they match/);
  assert.equal(toolWarning([anyTool, undeclared], core), '');
  assert.equal(toolWarning([kiroCopy], { ...core, selected: [] }), '', 'no tools chosen: nothing to compare');
});
