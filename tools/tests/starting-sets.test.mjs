// Starting sets (#134): framework and template items are whole sets a person adds in one click. Which tool a set is
// for is worked out from the items Catalog's resolver says it requires, never from its label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStartingSet, startingSetIds, setFit, setBrings, optionalFor, setAddedMessage, fitNote } from '../../src/catalog/starting-sets.js';

const RELEASE = 'a'.repeat(64), OTHER = 'b'.repeat(64);
const fact = (client, support, capability = 'skill-material-format') => ({ client, support, capability, surface: 'project', ...(support === 'unsupported' ? { reason: 'Not for this tool.' } : {}) });
const item = (id, kind, { facts, requires = [], optional = [], release = RELEASE, label = id, inputs = {} } = {}) => ({
  id, kind, label, inputs, root: { releaseSha256: release, itemId: id, scope: 'project', configuration: {} },
  dependencies: { requires: requires.map(itemId => ({ itemId })), optional: optional.map(itemId => ({ itemId })), conflicts: [] },
  metadata: facts ? { discovery: { clientCapabilities: facts } } : {},
});
const ref = (id, release = RELEASE) => ({ releaseSha256: release, itemId: id, scope: 'project' });
const cc = [fact('claude-code', 'supported'), fact('kiro-ide', 'unsupported')];
const kiro = [fact('kiro-ide', 'supported'), fact('claude-code', 'unsupported')];

const items = [
  item('extensions.template.complete', 'framework', { label: 'claude-code whole workflow convenience template', requires: ['extensions.notices', 'skill.a', 'skill.b', 'agent.a', 'command.a'], optional: ['hook.a', 'hook.kiro'] }),
  item('extensions.kiro.template.complete', 'framework', { label: 'claude-code (mislabelled) whole set', requires: ['extensions.notices', 'kiro.skill.a'] }),
  item('ecc.template.api-review', 'template', { requires: ['skill.a'] }),
  item('extensions.notices', 'instruction'),
  item('skill.a', 'skill', { facts: cc }), item('skill.b', 'skill', { facts: [fact('claude-code', 'supported'), fact('generic', 'supported')] }),
  item('agent.a', 'agent', { facts: cc }), item('command.a', 'command', { facts: cc }),
  item('kiro.skill.a', 'skill', { facts: kiro }),
  item('hook.a', 'hook', { facts: [fact('claude-code', 'supported', 'automatic-hook-activation')], label: 'git-guard hook group',
    inputs: { hookCommand: { type: 'string', required: true, minLength: 1, description: 'Reviewed Node command for git-guard.' } } }),
  item('hook.kiro', 'hook', { facts: [fact('kiro-ide', 'supported', 'automatic-hook-activation')] }),
  item('undeclared.set', 'framework', { requires: ['extensions.notices'] }),
];
const byId = id => items.find(value => value.id === id);
const supporting = new Set([`${RELEASE}/extensions.notices`]);
const completeNeeds = ['extensions.notices', 'skill.a', 'skill.b', 'agent.a', 'command.a'].map(id => ref(id));

test('framework and template items are starting sets, by their declared kind only', () => {
  assert.equal(isStartingSet(byId('extensions.template.complete')), true);
  assert.equal(isStartingSet(byId('ecc.template.api-review')), true);
  assert.equal(isStartingSet(byId('skill.a')), false);
  assert.deepEqual([...startingSetIds(items)].map(key => key.split('/')[1]).sort(),
    ['ecc.template.api-review', 'extensions.kiro.template.complete', 'extensions.template.complete', 'undeclared.set']);
});

test('a set fits a tool when every item it requires that declares a tool is supported for it; the label is never read', () => {
  assert.equal(setFit({ set: byId('extensions.template.complete'), needs: completeNeeds, items, tool: 'claude-code' }).status, 'fits');
  const other = setFit({ set: byId('extensions.template.complete'), needs: completeNeeds, items, tool: 'kiro-ide' });
  assert.equal(other.status, 'other-tool'); assert.deepEqual(other.notSupported, ['skill.a', 'skill.b', 'agent.a', 'command.a']);
  // Labelled claude-code, but what it requires is for kiro-ide.
  const mislabelled = setFit({ set: byId('extensions.kiro.template.complete'), needs: [ref('extensions.notices'), ref('kiro.skill.a')], items, tool: 'claude-code' });
  assert.equal(mislabelled.status, 'other-tool');
  assert.equal(setFit({ set: byId('extensions.kiro.template.complete'), needs: [ref('extensions.notices'), ref('kiro.skill.a')], items, tool: 'kiro-ide' }).status, 'fits');
  // Nothing it requires declares a tool: the Catalog does not say it fits any.
  assert.equal(setFit({ set: byId('undeclared.set'), needs: [ref('extensions.notices')], items, tool: 'claude-code' }).status, 'undeclared');
  // A required item the installed catalog does not hold cannot be checked, so the set is not said to fit.
  assert.equal(setFit({ set: byId('ecc.template.api-review'), needs: [ref('skill.a'), ref('missing', OTHER)], items, tool: 'claude-code' }).status, 'unknown');
});

test('what a set brings is counted by kind, with its supporting files and the optional items for the tool', () => {
  const brings = setBrings({ needs: completeNeeds, items, supporting, optional: optionalFor(byId('extensions.template.complete'), items, 'claude-code') });
  assert.equal(brings.text, '2 skills, 1 agent, 1 command, plus 1 supporting file; 1 hook optional');
  assert.equal(brings.total, 5);
  assert.equal(setBrings({ needs: [ref('skill.a')], items, supporting, optional: [] }).text, '1 skill');
});

test('optional items are offered only where they are supported for the tool, with the inputs they need', () => {
  const offered = optionalFor(byId('extensions.template.complete'), items, 'claude-code');
  assert.deepEqual(offered.map(value => value.item.id), ['hook.a']);
  assert.deepEqual(offered[0].inputs, [{ name: 'hookCommand', description: 'Reviewed Node command for git-guard.', required: true, maxLength: undefined }]);
  assert.deepEqual(optionalFor(byId('extensions.template.complete'), items, 'kiro-ide').map(value => value.item.id), ['hook.kiro']);
  assert.deepEqual(optionalFor(byId('extensions.template.complete'), items, ''), []);
});

test('the confirmation after Add all lists what was added in counts', () => {
  assert.equal(setAddedMessage({ name: 'Whole set', brings: { text: '46 skills, 4 agents, 2 commands, plus 2 supporting files' }, optional: [] }),
    'Added Whole set to your setup: 46 skills, 4 agents, 2 commands, plus 2 supporting files.');
  assert.equal(setAddedMessage({ name: 'Whole set', brings: { text: '1 skill' }, optional: ['git-guard', 'lanes-card'] }),
    'Added Whole set to your setup: 1 skill, and 2 optional items (git-guard, lanes-card).');
  assert.equal(setAddedMessage({ name: 'Whole set', brings: { text: '1 skill' }, optional: [], draft: true }),
    'Added Whole set to your draft: 1 skill. Save the draft to keep it.');
});

test('the note under the sets says honestly how many do not fit the tool, and why', () => {
  assert.equal(fitNote({ tool: 'claude-code', statuses: ['fits', 'other-tool', 'other-tool', 'undeclared'] }),
    '2 more starting sets in this framework need items the Catalog does not mark supported for claude-code, and 1 has no item that declares a tool. Advanced shows them all.');
  assert.equal(fitNote({ tool: 'claude-code', statuses: ['fits'] }), '');
  assert.equal(fitNote({ tool: 'kiro-ide', statuses: ['other-tool'] }), 'No starting set in this framework fits kiro-ide: 1 needs items the Catalog does not mark supported for kiro-ide. Advanced shows them all.');
  assert.equal(fitNote({ tool: '', statuses: ['fits', 'other-tool'] }), 'This framework has 2 starting sets. Choose your tool in the header to see the ones that fit it.');
});
