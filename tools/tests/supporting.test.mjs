import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supportingMaterial } from '../../src/catalog/supporting.js';

const RELEASE = 'a'.repeat(64), OTHER = 'b'.repeat(64);
const fact = (client, support, capability = 'skill-material-format') => ({ client, support, capability, surface: 'project', ...(support === 'unsupported' ? { reason: 'Not for this tool.' } : {}) });
const item = (id, kind, { facts, requires = [], release = RELEASE } = {}) => ({
  id, kind, label: id, root: { releaseSha256: release, itemId: id },
  dependencies: { requires: requires.map(ref => typeof ref === 'string' ? { itemId: ref } : ref), optional: [], conflicts: [] },
  metadata: facts ? { discovery: { clientCapabilities: facts } } : {},
});
const key = value => `${value.root.releaseSha256}/${value.id}`;
const supporting = items => [...supportingMaterial(items)].map(entryId => entryId.split('/')[1]).sort();

test('notices, references and templates are supporting material by their declared kind', () => {
  const items = [item('anthropic.notice.shadcn', 'notice'), item('x.reference', 'reference'), item('ecc.template.api-review', 'template', { facts: [fact('claude-code', 'supported')] }),
    item('anthropic.skill.web-artifacts-builder', 'skill', { facts: [fact('claude-code', 'supported')], requires: ['anthropic.notice.shadcn'] })];
  assert.deepEqual(supporting(items), ['anthropic.notice.shadcn', 'ecc.template.api-review', 'x.reference']);
});

test('an instruction other content in its release requires is supporting, even where the Catalog marks it supported', () => {
  // ecc.notices is filed as an instruction marked supported for claude-code; only its "required by" edges show its role.
  const items = [item('ecc.notices', 'instruction', { facts: [fact('claude-code', 'supported', 'instruction-material')] }),
    item('ecc.rule.common', 'instruction', { facts: [fact('claude-code', 'supported', 'instruction-material')], requires: ['ecc.notices'] }),
    item('ecc.skill.api-design', 'skill', { facts: [fact('claude-code', 'supported')], requires: ['ecc.notices'] })];
  assert.deepEqual(supporting(items), ['ecc.notices'], 'a rule nothing requires stays choosable content');
});

test("a hook's script files are supporting: required by a hook the Catalog supports, supported for no tool itself", () => {
  const items = [item('extensions.hook-source.git-guard', 'hook', { facts: [fact('claude-code', 'unsupported', 'automatic-hook-activation'), fact('kiro-ide', 'unsupported', 'automatic-hook-activation')] }),
    item('extensions.claude.hook.git-guard', 'hook', { facts: [fact('claude-code', 'supported', 'automatic-hook-activation')], requires: ['extensions.hook-source.git-guard'] })];
  assert.deepEqual(supporting(items), ['extensions.hook-source.git-guard']);
});

test('content that other content needs stays choosable content', () => {
  const items = [
    item('extensions.matt.grilling', 'skill', { facts: [fact('claude-code', 'supported')] }),
    item('extensions.matt.grill-me', 'skill', { facts: [fact('claude-code', 'supported')], requires: ['extensions.matt.grilling'] }),
    // An agent supported for no tool, needed by a command: still an agent, not a supporting file.
    item('extensions.kiro.agent.code-reviewer', 'agent', { facts: [fact('kiro-ide', 'unsupported', 'native-agent-registration')] }),
    item('extensions.kiro.command.ship', 'command', { facts: [fact('kiro-ide', 'unsupported', 'native-command-registration')], requires: ['extensions.kiro.agent.code-reviewer'] }),
    item('extensions.template.complete', 'framework', { requires: ['extensions.matt.grill-me', 'extensions.matt.grilling'] }),
  ];
  assert.deepEqual(supporting(items), []);
});

test('only a requirement in the same release counts', () => {
  const crossRelease = { itemId: 'extensions.notices', release: { manifest: { path: 'release/release-extensions.json' } } };
  const items = [item('extensions.notices', 'instruction', { release: OTHER }), item('ecc.skill.uses-other', 'skill', { requires: [crossRelease] })];
  assert.deepEqual(supporting(items), []);
  assert.deepEqual([...supportingMaterial([...items, item('extensions.skill.x', 'skill', { release: OTHER, requires: ['extensions.notices'] })])], [key(items[0])]);
});

test("an item's details say what comes with it, from the items the Catalog resolved for it", async () => {
  const { comesWith } = await import('../../src/catalog/supporting.js');
  const notices = item('extensions.notices', 'instruction'), grilling = item('extensions.matt.grilling', 'skill', { requires: ['extensions.notices'] });
  notices.label = 'Extensions licenses and upstream notices'; grilling.label = 'grilling';
  const items = [notices, grilling, item('extensions.matt.grill-me', 'skill', { requires: ['extensions.notices', 'extensions.matt.grilling'] })];
  const ref = value => ({ releaseSha256: RELEASE, itemId: value.id, scope: 'project' });
  const supporting = supportingMaterial(items);
  assert.deepEqual(comesWith({ needs: [ref(notices), ref(grilling)], items, supporting }),
    ['Comes with 1 supporting file: Extensions licenses and upstream notices.', 'Also adds 1 item it needs: grilling.']);
  assert.deepEqual(comesWith({ needs: [], items, supporting }), ['Needs no other items.']);
  // A needed item the installed catalog does not list is named by its id, never dropped.
  assert.deepEqual(comesWith({ needs: [{ releaseSha256: OTHER, itemId: 'other.notices', scope: 'project' }, ref(notices)], items, supporting }),
    ['Comes with 1 supporting file: Extensions licenses and upstream notices.', 'Also adds 1 item it needs: other.notices.']);
});
