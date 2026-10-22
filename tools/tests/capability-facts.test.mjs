import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capabilityFacts, declaredTargets, supportedEntries } from '../../src/catalog/authoring-model.js';

const fact = (client, support, reason) => ({ client, surface: '.claude/skills', capability: 'skill-material-format', support, ...(reason ? { reason } : {}) });
const item = (id, facts) => ({ id, metadata: facts === undefined ? {} : { discovery: { clientCapabilities: facts } } });
const claude = item('extensions.matt.grill-me', [fact('claude-code', 'supported'), fact('claude-code', 'unknown')]);
const kiro = item('extensions.kiro.matt.grill-me', [fact('kiro-ide', 'supported')]);
const undeclared = item('mattpocock.grill-me');
const entries = [claude, kiro, undeclared].map(authoringItem => ({ authoringItem }));

test('an item that declares nothing for the tool says "Not declared for <tool>", never an invented unknown', () => {
  assert.deepEqual(capabilityFacts(kiro, 'claude-code'), [{ support: 'not-declared', capability: 'Target support', surface: 'Not declared', reason: 'Not declared for claude-code.' }]);
  assert.equal(capabilityFacts(undeclared, 'claude-code')[0].support, 'not-declared');
  assert.equal(capabilityFacts(undeclared, '')[0].reason, 'No tool declared.');
  // A real unknown the producer declared stays unknown.
  assert.deepEqual(capabilityFacts(claude, 'claude-code').map(found => found.support), ['supported', 'unknown']);
  // An unusable declaration is still unknown: something was declared that cannot be read.
  assert.equal(capabilityFacts(item('x', [{ client: 'claude-code' }]), 'claude-code').at(-1).support, 'unknown');
});

test('the Support filter keeps declared unknowns and not-declared items apart', () => {
  const ids = list => list.map(entry => entry.authoringItem.id);
  assert.deepEqual(ids(supportedEntries(entries, 'claude-code', 'unknown')), ['extensions.matt.grill-me']);
  assert.deepEqual(ids(supportedEntries(entries, 'claude-code', 'not-declared')), ['extensions.kiro.matt.grill-me', 'mattpocock.grill-me']);
  assert.equal(supportedEntries(entries, 'claude-code', 'all').length, 3);
  assert.deepEqual(declaredTargets([claude, kiro, undeclared]), ['claude-code', 'kiro-ide']);
});
