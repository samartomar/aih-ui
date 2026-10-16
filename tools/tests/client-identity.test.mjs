import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adapterClientIds, adapterFor, adapterTargetOf, describeClientIdentity } from '../../src/app/client-identity.js';

const adapter = (id, clientId, extra = {}) => ({ id, kind: 'client-adapter', label: id, ...(clientId === undefined ? {} : { clientId }), ...extra });
const skill = id => ({ id, kind: 'skill', label: id });

test('an adapter names its target from clientId, never from its item id', () => {
  assert.deepEqual(adapterTargetOf(adapter('aihq.client.claude', 'claude')), { state: 'declared', clientId: 'claude' });
  assert.deepEqual(adapterTargetOf(adapter('vendor.wiring-one', 'claude')), { state: 'declared', clientId: 'claude' });
  assert.deepEqual(adapterTargetOf(adapter('aihq.client.y', 'z')), { state: 'declared', clientId: 'z' });
});

test('an adapter without clientId (an earlier release format) has no declared target and nothing is derived from its id', () => {
  assert.deepEqual(adapterTargetOf(adapter('aihq.client.claude')), { state: 'undeclared' });
  assert.deepEqual(adapterTargetOf(adapter('aihq.client.claude', '')), { state: 'undeclared' });
  assert.deepEqual(adapterTargetOf(adapter('aihq.client.claude', 7)), { state: 'undeclared' });
  assert.deepEqual(adapterTargetOf(adapter('aihq.client.claude', 'Claude Code')), { state: 'undeclared' });
});

test('only a client-adapter has a target; a clientId on any other kind is not read', () => {
  assert.equal(adapterTargetOf(skill('mattpocock.tdd')), null);
  assert.equal(adapterTargetOf({ ...skill('aihq.client.claude'), clientId: 'claude' }), null);
  assert.equal(adapterTargetOf(null), null);
  assert.equal(adapterTargetOf(undefined), null);
});

test('adapterFor finds the adapter whose clientId matches, wherever its id points', () => {
  const items = [skill('mattpocock.tdd'), adapter('aihq.client.y', 'z'), adapter('vendor.claude-wiring', 'claude'), adapter('aihq.client.codex', 'codex')];
  assert.equal(adapterFor(items, 'claude').id, 'vendor.claude-wiring');
  assert.equal(adapterFor(items, 'z').id, 'aihq.client.y');
  assert.equal(adapterFor(items, 'y'), undefined, 'an id that looks like aihq.client.y does not make y a target');
  assert.equal(adapterFor(items, 'zed'), undefined);
});

test('adapterFor never matches an adapter without a declared clientId, nor a non-adapter item named like one', () => {
  const items = [adapter('aihq.client.claude'), { ...skill('aihq.client.codex'), clientId: 'codex' }];
  assert.equal(adapterFor(items, 'claude'), undefined);
  assert.equal(adapterFor(items, 'codex'), undefined);
});

test('the first adapter offered for a client is the one found', () => {
  const first = adapter('a.one', 'claude'), second = adapter('b.two', 'claude');
  assert.equal(adapterFor([first, second], 'claude'), first);
});

test('adapterClientIds lists each declared target once, sorted, and skips undeclared adapters', () => {
  const items = [adapter('x.b', 'codex'), adapter('x.a', 'claude'), adapter('x.c', 'claude'), adapter('aihq.client.old'), skill('s')];
  assert.deepEqual(adapterClientIds(items), ['claude', 'codex']);
  assert.deepEqual(adapterClientIds(undefined), []);
});

const CORE = ['claude', 'codex'];

test('a declared target Core lists: target shown, Core-supported, and nothing says it is installed', () => {
  const facts = describeClientIdentity({ item: adapter('aihq.client.claude', 'claude'), coreClients: CORE });
  assert.deepEqual([facts.target.state, facts.target.clientId], ['declared', 'claude']);
  assert.equal(facts.core.state, 'supported');
  assert.equal(facts.installed.state, 'not-checked');
  assert.match(facts.installed.text, /not checked/i);
  assert.doesNotMatch(facts.installed.text, /\b(found|detected|is installed|is connected)\b/i);
});

test('a declared target Core does not list is shown as not Core-supported, not hidden and not an error', () => {
  const facts = describeClientIdentity({ item: adapter('vendor.other', 'other'), coreClients: CORE });
  assert.equal(facts.target.state, 'declared');
  assert.match(facts.target.text, /other/);
  assert.equal(facts.core.state, 'not-supported');
  assert.match(facts.core.text, /not Core-supported/i);
  assert.equal(facts.installed.state, 'not-checked');
});

test('an adapter without clientId says its target is not declared, and Core support is unknown rather than guessed from the id', () => {
  const facts = describeClientIdentity({ item: adapter('aihq.client.claude'), coreClients: CORE });
  assert.equal(facts.target.state, 'undeclared');
  assert.match(facts.target.text, /not declared/i);
  assert.equal(facts.target.clientId, undefined);
  assert.equal(facts.core.state, 'unknown');
  assert.equal(facts.installed.state, 'not-checked');
});

test('when Core publishes no list, support is unknown for any target', () => {
  for (const coreClients of [null, undefined, 'claude']) {
    const facts = describeClientIdentity({ item: adapter('aihq.client.claude', 'claude'), coreClients });
    assert.equal(facts.core.state, 'unknown');
    assert.match(facts.core.text, /unknown/i);
  }
});

test('installed or connected comes only from an observation, and a Core list or a target never supplies one', () => {
  const item = adapter('aihq.client.claude', 'claude');
  assert.equal(describeClientIdentity({ item, coreClients: CORE }).installed.state, 'not-checked');
  assert.equal(describeClientIdentity({ item, coreClients: CORE, observation: null }).installed.state, 'not-checked');
  assert.equal(describeClientIdentity({ item, coreClients: CORE, observation: 'present' }).installed.state, 'found');
  assert.equal(describeClientIdentity({ item, coreClients: CORE, observation: 'broken' }).installed.state, 'found-failed');
  assert.equal(describeClientIdentity({ item, coreClients: CORE, observation: 'absent' }).installed.state, 'not-found');
  // An observation changes only the installed fact.
  const seen = describeClientIdentity({ item: adapter('vendor.other', 'other'), coreClients: CORE, observation: 'present' });
  assert.equal(seen.installed.state, 'found');
  assert.equal(seen.core.state, 'not-supported');
});

test('a non-adapter item has no identity to describe', () => {
  assert.equal(describeClientIdentity({ item: skill('mattpocock.tdd'), coreClients: CORE }), null);
});

test('the headless copy is the same source as the browser module, so the two cannot drift', async () => {
  const [page, headless] = await Promise.all(['../../src/app/client-identity.js', '../consumer/client-identity.mjs']
    .map(path => readFile(new URL(path, import.meta.url), 'utf8')));
  const lf = text => text.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
  assert.equal(lf(headless), lf(page));
  assert.doesNotMatch(page, /^\s*import\b|\bdocument\b|\bwindow\b|node:|\bprocess\b|\bBuffer\b/m);
});
