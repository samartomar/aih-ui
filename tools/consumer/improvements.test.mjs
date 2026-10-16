import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInstalledRelease } from '@aihq/catalog/node';
import { freshAuthoring, composeAuthoring, openDraft, editDraft, stable } from './headless.mjs';
import * as publicApi from './improvements.mjs';
import { readJourneyEnvelope, writeJourneyEnvelope, JOURNEY_RECORD_KINDS } from './journey.mjs';
import { recordMaintenance } from './maintenance.mjs';
import { digestBytes } from './intake.mjs';
import { createMixedService } from './mixed-service.mjs';
import { suggestionRevision } from './improvement-record.mjs';
import { suggestImprovements, lead, classifyImprovement, improvementPrompt, GOAL_RULES, UNKNOWNS, IMPROVEMENT_RULES_VERSION, MAX_ALTERNATIVES } from './improvement-rules.mjs';
import { checkImprovements, recordImprovement, projectDismissals, IMPROVEMENT_SUGGESTION_SCHEMA, IMPROVEMENT_DISMISSAL_SCHEMA } from './improvements.mjs';
const encode = value => new TextEncoder().encode(value), decode = bytes => new TextDecoder().decode(bytes);
const NOW = '2026-10-16T09:00:00Z';
const valueOf = result => { assert.equal(result.status, 'ok', JSON.stringify(result.diagnostics)); return result.value; };

// ---- Synthetic catalog for the rule tables -------------------------------------------------------------------------
const hex = n => n.toString(16).padStart(64, '0');
const item = (id, extra = {}) => ({ id, label: `Label ${id}`, description: `About ${id}.`, scopes: ['project'], recipe: { sha256: hex(1), byteLength: 100 },
  materials: [{ sha256: hex(2), byteLength: 10 }, { sha256: hex(3), byteLength: 20 }], dependencies: { requires: [], optional: [], conflicts: [] }, itemSha256: hex(4), root: { releaseSha256: hex(9) }, ...extra });
const GOAL_ITEMS = [...new Set(GOAL_RULES.map(rule => rule.itemId))];
const catalog = () => [...GOAL_ITEMS, 'aihq.client.claude', 'aihq.client.codex'].map(id => item(id));
const intentOf = ({ roots = [], pins = [], exclusions = [] } = {}) => ({ ...freshAuthoring(), roots, pins, exclusions });
const rootOf = (itemId, reason) => ({ releaseSha256: hex(9), itemId, itemSha256: hex(4), scope: 'project', configuration: {}, originIds: ['direct'], ...(reason ? { reason } : {}) });
const savedReason = (rule, goal) => `guided-setup rules 1.0.0: ${rule}. Goal: ${goal}. Project: JavaScript.`;
const suggest = async (options = {}) => suggestImprovements({ intent: intentOf(), items: catalog(), clients: [], ...options });
const byItem = (suggestions, itemId) => suggestions.find(s => s.change.itemId === itemId);
const shownItem = (checked, itemId) => byItem([checked.leading, ...checked.alternatives, ...checked.dismissed].filter(Boolean), itemId);

test('the rules version and goal table are fixed and every rule names a distinct, well-formed reason', () => {
  assert.equal(IMPROVEMENT_RULES_VERSION, '1.0.0');
  assert.deepEqual(GOAL_RULES.map(rule => [rule.id, rule.itemId]), [['goal.fix', 'mattpocock.diagnosing-bugs'], ['goal.test', 'mattpocock.tdd'], ['goal.regressions', 'mattpocock.tdd'],
    ['goal.review', 'mattpocock.code-review'], ['goal.refactor', 'mattpocock.improve-codebase-architecture'], ['goal.plan', 'mattpocock.grill-me'], ['goal.context', 'aihq.project-context']]);
  for (const rule of GOAL_RULES) assert.match(rule.id, /^[a-z][a-z0-9.-]{0,63}$/);
});

test('every goal rule fires on each of its phrases, from a request and from a saved reason, with the exact reason text', async () => {
  for (const rule of GOAL_RULES) for (const phrase of rule.phrases) {
    const text = `we need ${phrase} here`;
    const asked = byItem(await suggest({ goal: text }), rule.itemId);
    assert.ok(asked, `${rule.id}: ${phrase}`);
    const trigger = asked.triggers.find(t => t.key === `goal:${rule.id}`);
    assert.deepEqual(trigger, { ruleId: rule.id, key: `goal:${rule.id}`, text: `You asked about “${text}”, which mentions “${phrase}”.` }, `${rule.id}: ${phrase}`);
    assert.deepEqual(asked.references, [{ kind: 'request', ref: 'goal' }, { kind: 'catalog-item', ref: rule.itemId }]);
    assert.equal(asked.goal, text);
    const saved = byItem(await suggest({ intent: intentOf({ roots: [rootOf('x.root', savedReason(rule.id, text))] }) }), rule.itemId);
    assert.ok(saved, `${rule.id}: saved ${phrase}`);
    assert.deepEqual(saved.triggers.find(t => t.key === `goal:${rule.id}`), { ruleId: rule.id, key: `goal:${rule.id}`, text: `Your saved goal “${text}” mentions “${phrase}”.` });
    assert.deepEqual(saved.references, [{ kind: 'saved-reason', ref: 'x.root' }, { kind: 'catalog-item', ref: rule.itemId }]);
    assert.equal(saved.goal, text);
  }
});

test('matching is whole-word, case-insensitive, space-tolerant and bounded', async () => {
  for (const goal of ['the contest is the latest', 'inspector gadget', 'a specific thing', 'slowly', 'attestation', 'bugfix', '']) assert.deepEqual(await suggest({ goal }), [], goal);
  assert.equal(byItem(await suggest({ goal: 'ADD TESTS' }), 'mattpocock.tdd').triggers[0].text, 'You asked about “ADD TESTS”, which mentions “tests”.');
  assert.ok(byItem(await suggest({ goal: 'open a  pull\trequest' }), 'mattpocock.code-review'));
  assert.ok(byItem(await suggest({ goal: 'time to clean up' }), 'mattpocock.improve-codebase-architecture'));
  // Whitespace collapses in the goal that is kept; an over-long goal is cut at 300 characters.
  assert.equal(byItem(await suggest({ goal: '  add   tests ' }), 'mattpocock.tdd').goal, 'add tests');
  assert.equal(byItem(await suggest({ goal: `tests ${'x'.repeat(400)}` }), 'mattpocock.tdd').goal.length, 300);
  // A reason that is not in the guided-setup format is not a goal.
  for (const reason of ['I want tests', 'guided-setup rules 1.0.0: goal.test. Goal: no goal given. Project: x.', 'guided-setup rules 1: goal.test. Goal: tests. Project: x.', undefined])
    assert.deepEqual(await suggest({ intent: intentOf({ roots: [rootOf('x.root', reason)] }) }), [], String(reason));
});

test('reasons for one item merge into one suggestion; the same reason from a saved goal and a request is one reason', async () => {
  const merged = await suggest({ goal: 'tests and regressions' });
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].triggers.map(t => t.key), ['goal:goal.regressions', 'goal:goal.test']);
  assert.deepEqual(merged[0].triggers.map(t => t.ruleId), ['goal.regressions', 'goal.test']);
  const both = await suggest({ intent: intentOf({ roots: [rootOf('x.root', savedReason('goal.test', 'add tests to my app'))] }), goal: 'tests' });
  assert.equal(both.length, 1);
  assert.deepEqual(both[0].triggers, [{ ruleId: 'goal.test', key: 'goal:goal.test', text: 'You asked about “tests”, which mentions “tests”.' }]);
  assert.deepEqual(both[0].references, [{ kind: 'saved-reason', ref: 'x.root' }, { kind: 'request', ref: 'goal' }, { kind: 'catalog-item', ref: 'mattpocock.tdd' }]);
  assert.equal(both[0].goal, 'tests');
});

test('the client rule fires for each declared client whose item is offered, once', async () => {
  const suggestions = await suggest({ clients: ['codex', 'zed', 'claude', 'claude'] });
  assert.deepEqual(suggestions.map(s => s.change.itemId), ['aihq.client.claude', 'aihq.client.codex']);
  for (const [id, client] of [['aihq.client.claude', 'claude'], ['aihq.client.codex', 'codex']]) {
    const s = byItem(suggestions, id);
    assert.deepEqual(s.triggers, [{ ruleId: 'client.instructions', key: `client:${client}`, text: `You use ${client} (Workbench setup), but this policy does not give it the shared project instructions.` }]);
    assert.deepEqual(s.references, [{ kind: 'setting', ref: 'clients' }, { kind: 'catalog-item', ref: id }]);
    assert.equal(s.goal, undefined);
  }
});

test('an item that is absent, a root, a pin of any release, or excluded is never suggested', async () => {
  const absent = catalog().filter(i => i.id !== 'mattpocock.tdd');
  assert.deepEqual(await suggest({ items: absent, goal: 'tests' }), []);
  assert.deepEqual(await suggest({ intent: intentOf({ roots: [rootOf('mattpocock.tdd')] }), goal: 'tests' }), []);
  assert.deepEqual(await suggest({ intent: intentOf({ pins: [{ releaseSha256: hex(8), itemId: 'mattpocock.tdd', itemSha256: hex(5) }] }), goal: 'tests' }), []);
  assert.deepEqual(await suggest({ intent: intentOf({ exclusions: [{ originId: 'direct', releaseSha256: hex(9), itemId: 'mattpocock.tdd', scope: 'project' }] }), goal: 'tests' }), []);
  assert.deepEqual(await suggest({ intent: intentOf({ roots: [rootOf('aihq.client.claude')] }), clients: ['claude'] }), []);
  // No substitution: a related item that is offered is not offered in its place.
  assert.deepEqual((await suggest({ items: absent, goal: 'tests' })).map(s => s.change.itemId), []);
  // An item offering no scope cannot be proposed.
  assert.deepEqual(await suggest({ items: [item('mattpocock.tdd', { scopes: [] })], goal: 'tests' }), []);
  // The first supplied inventory offering an id wins.
  const first = item('mattpocock.tdd', { root: { releaseSha256: hex(7) } });
  assert.equal(byItem(await suggest({ items: [first, ...catalog()], goal: 'tests' }), 'mattpocock.tdd').change.releaseSha256, hex(7));
});

test('scope is the smallest useful one the item supports', async () => {
  const scoped = scopes => suggest({ items: [item('mattpocock.tdd', { scopes })], goal: 'tests' }).then(list => list[0]);
  assert.equal((await scoped(['project'])).scope, 'project');
  assert.equal((await scoped(['user', 'project'])).scope, 'project');
  const user = await scoped(['user']);
  assert.equal(user.scope, 'user');
  assert.deepEqual(user.facts.find(f => f.kind === 'scope').text, 'Applies to your user account on this computer; every project of that account is affected.');
  assert.equal((await scoped(['project'])).facts.find(f => f.kind === 'scope').text, 'Applies in this project only; other repositories and AI clients are unchanged.');
});

test('suggestions are ranked: a request first, then more reasons, then a saved goal before client-only, then item id', async () => {
  const intent = intentOf({ roots: [rootOf('x.root', savedReason('goal.review', 'review my code'))] });
  const ranked = await suggest({ intent, clients: ['claude'], goal: 'fix the regressions and tests' });
  // tdd: request, two reasons; diagnosing-bugs: request, one; code-review: saved goal; client item: client only.
  assert.deepEqual(ranked.map(s => s.change.itemId), ['mattpocock.tdd', 'mattpocock.diagnosing-bugs', 'mattpocock.code-review', 'aihq.client.claude']);
  const equal = await suggest({ goal: 'fix tests review refactor plan context' });
  assert.deepEqual(equal.map(s => s.change.itemId), ['aihq.project-context', 'mattpocock.code-review', 'mattpocock.diagnosing-bugs', 'mattpocock.grill-me', 'mattpocock.improve-codebase-architecture', 'mattpocock.tdd']);
  assert.deepEqual(await suggest({ goal: 'fix tests review refactor plan context' }), equal);
  const { leading, alternatives } = lead(equal);
  assert.equal(leading, equal[0]); assert.deepEqual(alternatives, equal.slice(1, 4)); assert.equal(MAX_ALTERNATIVES, 3);
  assert.deepEqual(lead([]), { leading: null, alternatives: [] });
  assert.deepEqual(lead(equal.slice(0, 2)), { leading: equal[0], alternatives: [equal[1]] });
  // A saved goal outranks a client-only reason even when the item id sorts later.
  const saved = await suggest({ intent: intentOf({ roots: [rootOf('x.root', savedReason('goal.fix', 'fix bugs'))] }), clients: ['claude'] });
  assert.deepEqual(saved.map(s => s.change.itemId), ['mattpocock.diagnosing-bugs', 'aihq.client.claude']);
});

test('facts come from Catalog data and unknowns are always stated', async () => {
  const tdd = item('mattpocock.tdd', { dependencies: { requires: [{ itemId: 'dep.a' }, { itemId: 'dep.missing' }], optional: [], conflicts: [{ itemId: 'rival.tool' }] } });
  const depA = item('dep.a', { label: 'Dep A', dependencies: { requires: [{ itemId: 'dep.b' }, { itemId: 'mattpocock.tdd' }], optional: [], conflicts: [] } });
  const depB = item('dep.b', { label: 'Dep B', materials: [], recipe: { sha256: hex(1), byteLength: 5 } });
  const items = [tdd, depA, depB];
  const [s] = await suggest({ items, goal: 'tests' });
  // Item 3 files / 130 bytes, Dep A 3 files / 130 bytes, Dep B 1 file / 5 bytes.
  assert.deepEqual(s.facts.map(f => f.kind), ['overhead', 'scope', 'dependency']);
  assert.equal(s.facts[0].text, 'Adds 7 files, 265 bytes in total, and needs 2 other items: Dep A, Dep B.');
  assert.equal(s.facts[2].text, 'Needs dep.missing, which the supplied Catalog does not offer.');
  assert.deepEqual(s.unknowns, UNKNOWNS);
  assert.deepEqual(UNKNOWNS, ['Whether it improves your results is unknown until you try it.', 'Actual usage and cost are unknown; no usage data is read.',
    'Recurring friction is not checked: this Workbench has no evidence source for it yet.']);
  // What the policy already selects is not counted again (nor what that item needs), and a selected conflict is a stated fact.
  const pin = itemId => ({ releaseSha256: hex(9), itemId, itemSha256: hex(4) });
  const [kept] = await suggest({ items, goal: 'tests', intent: intentOf({ pins: [pin('dep.a'), pin('dep.b'), pin('rival.tool')] }) });
  assert.equal(kept.facts[0].text, 'Adds 3 files, 130 bytes in total, and needs 0 other items.');
  const [partly] = await suggest({ items, goal: 'tests', intent: intentOf({ pins: [pin('dep.b')] }) });
  assert.equal(partly.facts[0].text, 'Adds 6 files, 260 bytes in total, and needs 1 other item: Dep A.');
  assert.ok(kept.facts.some(f => f.text === 'Conflicts with rival.tool, which this policy already selects.'));
  const [alone] = await suggest({ goal: 'tests' });
  assert.equal(alone.facts[0].text, 'Adds 3 files, 130 bytes in total, and needs 0 other items.');
  assert.deepEqual(alone.facts.map(f => f.kind), ['overhead', 'scope']);
});

test('identity ignores labels, descriptions, release and item digests and rule wording; revision tracks only material change', async () => {
  const base = (await suggest({ goal: 'add tests' }))[0];
  const same = async (items, options = {}) => {
    const [other] = await suggest({ items, goal: 'add tests', ...options });
    assert.equal(other.id, base.id); assert.equal(other.revision, base.revision);
    return other;
  };
  const changed = extra => catalog().map(i => i.id === 'mattpocock.tdd' ? { ...i, ...extra } : i);
  await same(changed({ label: 'Renamed', description: 'Changed.' }));
  await same(changed({ itemSha256: hex(44), root: { releaseSha256: hex(66) } }));
  // Different wording that hits the same rule, a different goal text, and the reasons in another order.
  await same(catalog(), { goal: 'write some tests please' });
  await same(changed({ materials: [{ sha256: hex(3), byteLength: 20 }, { sha256: hex(2), byteLength: 10 }] }));
  await same(changed({ materials: [{ sha256: hex(2), byteLength: 99 }, { sha256: hex(3), byteLength: 1 }] }));
  assert.match(base.id, /^suggestion-[a-f0-9]{32}$/); assert.match(base.revision, /^[a-f0-9]{64}$/);
  // A new reason, a new recipe digest or a new material digest changes the revision but not the id.
  const material = async items => (await suggest({ items, goal: 'add tests' }))[0];
  const withReason = (await suggest({ goal: 'add tests for regressions' }))[0];
  const withRecipe = await material(changed({ recipe: { sha256: hex(11), byteLength: 100 } }));
  const withMaterial = await material(changed({ materials: [{ sha256: hex(2), byteLength: 10 }, { sha256: hex(12), byteLength: 20 }] }));
  const fewer = await material(changed({ materials: [{ sha256: hex(2), byteLength: 10 }] }));
  for (const other of [withReason, withRecipe, withMaterial, fewer]) { assert.equal(other.id, base.id); assert.notEqual(other.revision, base.revision); }
  assert.equal(new Set([base, withReason, withRecipe, withMaterial, fewer].map(s => s.revision)).size, 5);
  // A different item or scope is a different suggestion.
  const user = (await suggest({ items: changed({ scopes: ['user'] }), goal: 'add tests' }))[0];
  assert.notEqual(user.id, base.id);
});

test('classification: unchanged or fewer reasons stay dismissed; a new reason or changed content shows it again with the reason', async () => {
  const saved = (await suggest({ goal: 'tests' }))[0];
  assert.deepEqual(classifyImprovement(saved, saved), { dismissed: true, reasons: [] });
  const wider = (await suggest({ goal: 'tests and regressions' }))[0];
  const fewer = classifyImprovement(saved, wider);
  assert.deepEqual(fewer, { dismissed: true, reasons: [] });
  const promoted = classifyImprovement(wider, saved);
  assert.equal(promoted.dismissed, false);
  assert.deepEqual(promoted.reasons, ['Shown again: a new reason applies — You asked about “tests and regressions”, which mentions “regressions”.']);
  const edited = { ...saved, revision: hex(5), change: { ...saved.change, content: { ...saved.change.content, recipeSha256: hex(77) } } };
  assert.deepEqual(classifyImprovement(saved, edited), { dismissed: false, reasons: ["Shown again: the suggested item's content changed since you dismissed it."] });
  const both = classifyImprovement({ ...wider, change: edited.change }, saved);
  assert.equal(both.reasons.length, 2);
});

// ---- Records and the installed maintained Catalog ------------------------------------------------------------------
let installedPromise;
const installed = () => installedPromise ??= readInstalledRelease({ root: dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'))), sourceInput: 'maintained' });
async function scenario({ rootIds = ['mattpocock.implement'], goal = 'add tests to my app', rule = 'goal.test' } = {}) {
  const found = await installed();
  assert.equal(found.valid, true, JSON.stringify(found.diagnostics));
  const maintained = { release: found.release, materialSource: found.source }, inventories = [maintained], intent = freshAuthoring();
  intent.roots = rootIds.map(itemId => ({ releaseSha256: maintained.release.sha256, itemId, itemSha256: maintained.release.items.find(i => i.id === itemId).itemSha256,
    scope: 'project', configuration: {}, originIds: ['direct'], reason: savedReason(rule, goal) }));
  const base = valueOf(await composeAuthoring({ intent: freshAuthoring(), inventories }));
  const composed = valueOf(await composeAuthoring({ basePolicyBytes: base.policyBytes, intent, inventories }));
  const open = valueOf(await openDraft({ bytes: composed.policyBytes, inventories }));
  return { maintained, inventories, policyBytes: composed.policyBytes, envelopeBytes: open.envelopeBytes, open };
}
const check = async (s, bytes, options = {}) => valueOf(await checkImprovements({ envelopeBytes: bytes, inventories: s.inventories, now: NOW, ...options }));
const dismissOperation = (suggestion, reason) => {
  const { label: _label, description: _description, prompt: _prompt, dismissal: _dismissal, promotion: _promotion, ...fields } = suggestion;
  return { type: 'dismiss', suggestion: fields, ...(reason !== undefined ? { reason } : {}) };
};
const record = async (bytes, operation, now = NOW) => valueOf(await recordImprovement({ envelopeBytes: bytes, operation, now }));
const dismissLeading = async (s, bytes = s.envelopeBytes, options = {}) => {
  const checked = await check(s, bytes, options);
  return { checked, recorded: await record(bytes, dismissOperation(checked.leading, 'Not for this project.')) };
};
async function resign(bytes, mutate) {
  const doc = JSON.parse(decode(bytes));
  mutate(doc);
  const { sha256: _omitted, ...revision } = doc.revision;
  doc.revision.sha256 = await digestBytes(encode(stable({ ...doc, revision })));
  return encode(JSON.stringify(doc, null, 2) + '\n');
}

test('the rule table points at items the installed maintained Catalog really offers, and the check explains from it', async () => {
  const s = await scenario(), offered = new Set(s.maintained.release.items.map(i => i.id));
  for (const rule of GOAL_RULES) assert.ok(offered.has(rule.itemId), rule.itemId);
  const before = s.envelopeBytes.slice();
  const value = await check(s, s.envelopeBytes, { clients: ['claude', 'not-a-client'], goal: 'fewer regressions' });
  assert.deepEqual(s.envelopeBytes, before);
  assert.equal(value.rulesVersion, '1.0.0'); assert.equal(value.checkedAt, NOW); assert.deepEqual(value.mutations, []);
  assert.deepEqual(value.reads, ['envelope', 'supplied-inventories', 'declared-clients', 'request-goal']);
  // implement is the root; tdd arises from the saved goal and the request (two reasons), the client wiring from setup.
  assert.equal(value.leading.change.itemId, 'mattpocock.tdd');
  assert.deepEqual(value.leading.triggers.map(t => t.key), ['goal:goal.regressions', 'goal:goal.test']);
  assert.equal(value.leading.label, s.maintained.release.items.find(i => i.id === 'mattpocock.tdd').label);
  assert.equal(value.leading.scope, 'project'); assert.equal(value.leading.dismissal, null); assert.equal(value.leading.promotion, undefined);
  assert.equal(value.leading.rulesVersion, '1.0.0'); assert.equal(value.leading.change.releaseSha256, s.maintained.release.sha256);
  assert.match(value.leading.facts[0].text, /^Adds \d+ files, \d+ bytes in total, and needs 0 other items\.$/);
  assert.deepEqual(value.alternatives.map(a => a.change.itemId), ['aihq.client.claude']);
  assert.match(value.alternatives[0].facts[0].text, /^Adds \d+ files, \d+ bytes in total, and needs [1-9]\d* other items?: /);
  assert.deepEqual([value.dismissed, value.preserved], [[], []]);
  assert.equal(value.leading.prompt, improvementPrompt(value.leading));
  const quiet = await check(s, s.envelopeBytes);
  assert.deepEqual(quiet.reads, ['envelope', 'supplied-inventories', 'declared-clients']);
  assert.equal(quiet.leading.change.itemId, 'mattpocock.tdd'); assert.deepEqual(quiet.alternatives, []);
  assert.equal(JSON.stringify(value).includes('base64'), false);
});

test('a first check with nothing to say returns no suggestion and a dismissal round-trips as records', async () => {
  const s = await scenario({ goal: 'ship it', rule: 'goal.build' });
  const none = await check(s, s.envelopeBytes);
  assert.equal(none.leading, null); assert.deepEqual([none.alternatives, none.dismissed, none.preserved], [[], [], []]);
  const { checked, recorded } = await dismissLeading(await scenario(), undefined, { goal: 'tests' });
  assert.equal(recorded.record.schema, IMPROVEMENT_DISMISSAL_SCHEMA); assert.equal(recorded.envelope.revision.sequence, 2);
  const suggestion = recorded.envelope.records.find(r => r.schema === IMPROVEMENT_SUGGESTION_SCHEMA);
  assert.equal(suggestion.recordedAt, NOW); assert.equal(suggestion.required, false); assert.equal(suggestion.id, checked.leading.id); assert.equal(suggestion.revision, checked.leading.revision);
  assert.deepEqual(recorded.record, { id: recorded.record.id, schema: IMPROVEMENT_DISMISSAL_SCHEMA, required: false, suggestion: { id: suggestion.id, revision: suggestion.revision },
    recordedAt: NOW, reason: 'Not for this project.' });
  assert.match(recorded.record.id, /^dismissal-[a-f0-9]{32}$/);
  assert.deepEqual(projectDismissals(recorded.envelope), [recorded.record]); assert.deepEqual(recorded.dismissals, [recorded.record]);
  assert.deepEqual(recorded.projection.records.map(r => [r.id, r.required, r.supported]), [['draft', true, true], [suggestion.id, false, true], [recorded.record.id, false, true]]);
  assert.equal(JSON.stringify(projectDismissals(recorded.envelope)).includes('base64'), false);
});

test('closed-shape refusals: malformed suggestion and dismissal records are refused on write and on read', async () => {
  const s = await scenario(), { recorded } = await dismissLeading(s, undefined, { goal: 'tests' });
  const read = valueOf(await readJourneyEnvelope(recorded.envelopeBytes)), [draft, suggestion, dismissal] = read.records;
  assert.equal(read.supported, true);
  const accepted = await writeJourneyEnvelope({ savedIntentBytes: read.savedIntentBytes, records: [draft, suggestion, dismissal] });
  assert.equal(accepted.status, 'ok', JSON.stringify(accepted.diagnostics));
  const longText = 'x'.repeat(1001);
  const bad = [r => { r.required = true; }, r => { r.extra = 1; }, r => { delete r.unknowns; }, r => { r.rulesVersion = '1.0'; }, r => { r.scope = 'team'; }, r => { r.revision = 'abc'; },
    r => { r.change.kind = 'remove-item'; }, r => { r.change.extra = 1; }, r => { r.change.releaseSha256 = 'nope'; }, r => { r.change.itemId = 'bad id'; },
    r => { r.change.content.materials = [hex(2), hex(1)]; }, r => { r.change.content.materials = [hex(1), hex(1)]; }, r => { r.change.content.recipeSha256 = 'x'; },
    r => { r.triggers = []; }, r => { r.triggers.push(structuredClone(r.triggers[0])); }, r => { r.triggers[0].key = 'Bad Key'; }, r => { r.triggers[0].ruleId = 'Rule'; }, r => { r.triggers[0].text = ''; },
    r => { r.triggers[0].text = longText; }, r => { r.goal = 'x'.repeat(301); }, r => { r.goal = ''; }, r => { r.references = [{ kind: 'url', ref: 'x' }]; }, r => { r.references = [{ kind: 'setting' }]; },
    r => { r.facts = [{ kind: 'quality', text: 'x' }]; }, r => { r.unknowns = ['']; }, r => { r.recordedAt = '2026-10-16'; }, r => { r.recordedAt = '2026-02-30T00:00:00Z'; }];
  for (const [n, mutate] of bad.entries()) {
    const changed = structuredClone(suggestion); mutate(changed);
    const written = await writeJourneyEnvelope({ savedIntentBytes: read.savedIntentBytes, records: [draft, changed, dismissal] });
    assert.equal(written.status, 'refused', `write ${n}`); assert.equal(written.diagnostics[0].code, 'INPUT_INVALID', `write ${n}`); assert.match(written.diagnostics[0].path, /^\/records\/1/, `write ${n}`);
    const bytes = await resign(recorded.envelopeBytes, doc => mutate(doc.records[1]));
    const refused = await readJourneyEnvelope(bytes);
    assert.equal(refused.status, 'refused', `read ${n}`); assert.equal(refused.diagnostics[0].code, 'INPUT_INVALID', `read ${n}`); assert.match(refused.diagnostics[0].path, /^\/records\/1/, `read ${n}`);
    assert.deepEqual(refused.originalBytes, bytes);
  }
  const badDismissal = [r => { r.required = true; }, r => { r.extra = 1; }, r => { r.reason = ''; }, r => { r.reason = longText; }, r => { r.recordedAt = 'now'; }, r => { r.suggestion.extra = 1; },
    r => { r.suggestion.revision = 'abc'; }, r => { r.suggestion.id = 'suggestion-x'; }, r => { delete r.suggestion; }];
  for (const [n, mutate] of badDismissal.entries()) {
    const changed = structuredClone(dismissal); mutate(changed);
    const written = await writeJourneyEnvelope({ savedIntentBytes: read.savedIntentBytes, records: [draft, suggestion, changed] });
    assert.equal(written.status, 'refused', `write ${n}`); assert.match(written.diagnostics[0].path, /^\/records\/2/, `write ${n}`);
    const refused = await readJourneyEnvelope(await resign(recorded.envelopeBytes, doc => mutate(doc.records[2])));
    assert.equal(refused.status, 'refused', `read ${n}`); assert.match(refused.diagnostics[0].path, /^\/records\/2/, `read ${n}`);
  }
});

test('ids and revisions are derived: a stale or invented one is refused on write and on read', async () => {
  const s = await scenario(), { recorded } = await dismissLeading(s, undefined, { goal: 'tests' });
  const read = valueOf(await readJourneyEnvelope(recorded.envelopeBytes)), [draft, suggestion, dismissal] = read.records;
  const write = records => writeJourneyEnvelope({ savedIntentBytes: read.savedIntentBytes, records });
  const wrongId = `suggestion-${'2'.repeat(32)}`;
  for (const [path, mutate] of [['/records/1/id', r => { r.id = wrongId; }], ['/records/1/revision', r => { r.revision = hex(3); }],
    ['/records/1/id', r => { r.change.itemId = 'mattpocock.code-review'; }], ['/records/1/revision', r => { r.change.content.recipeSha256 = hex(5); }],
    ['/records/1/revision', r => { r.triggers[0].key = 'goal:goal.fix'; }]]) {
    const changed = structuredClone(suggestion); mutate(changed);
    // Keep the dismissal consistent with the edited suggestion so only the derivation is wrong.
    const linked = { ...dismissal, suggestion: { id: changed.id, revision: changed.revision } };
    const refused = await write([draft, changed, linked]);
    assert.equal(refused.status, 'refused', path); assert.equal(refused.diagnostics[0].code, 'INPUT_INVALID'); assert.equal(refused.diagnostics[0].path, path);
    const bytes = await resign(recorded.envelopeBytes, doc => { mutate(doc.records[1]); doc.records[2].suggestion = { id: changed.id, revision: changed.revision }; });
    const onRead = await readJourneyEnvelope(bytes);
    assert.equal(onRead.status, 'refused'); assert.equal(onRead.diagnostics[0].code, 'INPUT_INVALID'); assert.equal(onRead.diagnostics[0].path, path);
  }
  const wrongDismissal = { ...dismissal, id: `dismissal-${'2'.repeat(32)}` };
  const refused = await write([draft, suggestion, wrongDismissal]);
  assert.equal(refused.status, 'refused'); assert.equal(refused.diagnostics[0].path, '/records/2/id');
  const onRead = await readJourneyEnvelope(await resign(recorded.envelopeBytes, doc => { doc.records[2].id = wrongDismissal.id; }));
  assert.equal(onRead.status, 'refused'); assert.equal(onRead.diagnostics[0].path, '/records/2/id');
});

test('a dismissal needs the exact suggestion it dismissed beside it, on write and on read', async () => {
  const s = await scenario(), { recorded } = await dismissLeading(s, undefined, { goal: 'tests' });
  const read = valueOf(await readJourneyEnvelope(recorded.envelopeBytes)), [draft, suggestion, dismissal] = read.records;
  const write = records => writeJourneyEnvelope({ savedIntentBytes: read.savedIntentBytes, records });
  const orphan = await write([draft, dismissal]);
  assert.equal(orphan.status, 'refused'); assert.equal(orphan.diagnostics[0].code, 'INPUT_INVALID'); assert.equal(orphan.diagnostics[0].path, '/records/1/suggestion');
  const stale = await write([draft, suggestion, { ...dismissal, suggestion: { ...dismissal.suggestion, revision: hex(6) } }]);
  assert.equal(stale.status, 'refused'); assert.equal(stale.diagnostics[0].path, '/records/2/suggestion');
  const onRead = await readJourneyEnvelope(await resign(recorded.envelopeBytes, doc => { doc.records.splice(1, 1); }));
  assert.equal(onRead.status, 'refused'); assert.equal(onRead.diagnostics[0].code, 'INPUT_INVALID'); assert.equal(onRead.diagnostics[0].path, '/records/1/suggestion');
  const staleRead = await readJourneyEnvelope(await resign(recorded.envelopeBytes, doc => { doc.records[2].suggestion.revision = hex(6); }));
  assert.equal(staleRead.status, 'refused'); assert.equal(staleRead.diagnostics[0].path, '/records/2/suggestion');
  // A suggestion alone is allowed: it is only a dismissal that needs one.
  assert.equal((await write([draft, suggestion])).status, 'ok');
  // check and record refuse such an envelope without reading further.
  const refused = await checkImprovements({ envelopeBytes: await resign(recorded.envelopeBytes, doc => { doc.records.splice(1, 1); }), inventories: s.inventories, now: NOW });
  assert.equal(refused.status, 'refused'); assert.ok(refused.originalBytes);
});

test('record operations are closed, validated and leave the envelope bytes unchanged when refused', async () => {
  const s = await scenario(), checked = await check(s, s.envelopeBytes, { goal: 'tests' }), good = dismissOperation(checked.leading);
  const refuseWith = async (operation, path, now = NOW) => {
    const refused = await recordImprovement({ envelopeBytes: s.envelopeBytes, operation, now });
    assert.equal(refused.status, 'refused', String(JSON.stringify(operation)).slice(0, 120)); assert.equal(refused.diagnostics[0].code, 'INPUT_INVALID'); assert.equal(refused.diagnostics[0].path, path);
    assert.deepEqual(refused.originalBytes, s.envelopeBytes);
  };
  await refuseWith(undefined, '/operation/type'); await refuseWith({ type: 'clear' }, '/operation/type');
  await refuseWith(good, '/now', 'yesterday');
  await refuseWith({ ...good, extra: 1 }, '/operation');
  await refuseWith({ type: 'dismiss' }, '/operation');
  await refuseWith({ ...good, reason: '' }, '/operation/reason');
  await refuseWith({ ...good, reason: 'x'.repeat(1001) }, '/operation/reason');
  // Display-only fields are not part of the operation.
  for (const extra of ['label', 'description', 'prompt', 'dismissal', 'promotion']) await refuseWith({ ...good, suggestion: { ...good.suggestion, [extra]: 'x' } }, '/operation/suggestion');
  await refuseWith({ ...good, suggestion: { ...good.suggestion, id: `suggestion-${'4'.repeat(32)}` } }, '/operation/suggestion/id');
  await refuseWith({ ...good, suggestion: { ...good.suggestion, revision: hex(7) } }, '/operation/suggestion/revision');
  await refuseWith({ ...good, suggestion: { ...good.suggestion, scope: 'team' } }, '/operation/suggestion/scope');
  const { goal: _goal, ...withoutGoal } = good.suggestion;
  assert.equal((await recordImprovement({ envelopeBytes: s.envelopeBytes, operation: { ...good, suggestion: withoutGoal }, now: NOW })).status, 'ok');
  await refuseWith({ type: 'restore' }, '/operation');
  await refuseWith({ type: 'restore', id: good.suggestion.id }, '/operation/id');
  await refuseWith({ type: 'restore', id: good.suggestion.id, extra: 1 }, '/operation');
  assert.equal((await recordImprovement({ envelopeBytes: 'nope', operation: good, now: NOW })).status, 'refused');
  const noDraft = valueOf(await readJourneyEnvelope(s.envelopeBytes));
  const withoutDraftBytes = await resign(s.envelopeBytes, doc => { doc.records = doc.records.filter(r => r.id !== 'draft'); });
  assert.equal(noDraft.supported, true);
  assert.equal((await recordImprovement({ envelopeBytes: withoutDraftBytes, operation: good, now: NOW })).status, 'refused');
  assert.equal((await checkImprovements({ envelopeBytes: withoutDraftBytes, inventories: s.inventories, now: NOW })).status, 'refused');
});

test('check inputs are validated like the maintenance check', async () => {
  const s = await scenario();
  for (const [options, path] of [[{ now: 'today' }, '/now'], [{ inventories: [{ release: {} }] }, '/inventories'], [{ inventories: 'x' }, '/inventories'],
    [{ inventories: [...s.inventories, ...s.inventories] }, '/inventories'], [{ clients: 'claude' }, '/clients'], [{ clients: ['Claude'] }, '/clients'], [{ clients: [1] }, '/clients'],
    [{ clients: Array.from({ length: 33 }, (_, i) => `c${i}`) }, '/clients'], [{ goal: 5 }, '/goal'], [{ goal: 'x'.repeat(301) }, '/goal']]) {
    const refused = await checkImprovements({ envelopeBytes: s.envelopeBytes, inventories: s.inventories, now: NOW, ...options });
    assert.equal(refused.status, 'refused', path); assert.equal(refused.diagnostics[0].path, path); assert.deepEqual(refused.originalBytes, s.envelopeBytes);
  }
  assert.equal((await checkImprovements({ inventories: s.inventories, now: NOW })).diagnostics[0].path, '/envelopeBytes');
  // An empty goal is no request; a goal at the limit is accepted.
  assert.deepEqual((await check(s, s.envelopeBytes, { goal: '  ' })).reads, ['envelope', 'supplied-inventories', 'declared-clients']);
  assert.equal((await checkImprovements({ envelopeBytes: s.envelopeBytes, inventories: s.inventories, now: NOW, goal: 'x'.repeat(300) })).status, 'ok');
});

test('a dismissal survives reopening: dismissed again for the same goal, shown on a new reason, restored on request', async () => {
  const s = await scenario(), { checked, recorded } = await dismissLeading(s);
  assert.equal(checked.leading.change.itemId, 'mattpocock.tdd');
  // Reopen from the written bytes, through the draft reader and the journey reader.
  const reopened = valueOf(await openDraft({ bytes: recorded.envelopeBytes, inventories: s.inventories }));
  assert.deepEqual(reopened.envelopeBytes, recorded.envelopeBytes);
  assert.equal(valueOf(await readJourneyEnvelope(reopened.envelopeBytes)).records.length, 3);
  const after = await check(s, reopened.envelopeBytes);
  assert.equal(after.leading, null); assert.deepEqual(after.alternatives, []); assert.deepEqual(after.preserved, []);
  assert.equal(after.dismissed.length, 1);
  const [shown] = after.dismissed;
  assert.equal(shown.id, checked.leading.id); assert.equal(shown.revision, checked.leading.revision);
  assert.deepEqual(shown.dismissal, recorded.record); assert.equal(shown.dismissal.reason, 'Not for this project.'); assert.equal(shown.promotion, undefined);
  // The same goal again, as a request, is the same reason: still dismissed.
  const same = await check(s, reopened.envelopeBytes, { goal: 'add tests to my app' });
  assert.equal(same.leading, null); assert.deepEqual(same.dismissed.map(d => d.id), [shown.id]); assert.equal(same.dismissed[0].promotion, undefined);
  // A request that adds a new reason shows it again, saying which.
  const again = await check(s, reopened.envelopeBytes, { goal: 'fewer regressions' });
  assert.equal(again.leading.id, shown.id); assert.deepEqual(again.dismissed, []);
  assert.deepEqual(again.leading.promotion, { reasons: ['Shown again: a new reason applies — You asked about “fewer regressions”, which mentions “regressions”.'] });
  assert.deepEqual(again.leading.dismissal, recorded.record); assert.deepEqual(again.leading.triggers.map(t => t.key), ['goal:goal.regressions', 'goal:goal.test']);
  // The check itself wrote nothing; the saved dismissal is unchanged.
  assert.deepEqual(valueOf(await readJourneyEnvelope(reopened.envelopeBytes)).records, recorded.envelope.records);
  // Dismissing it again binds the new revision and replaces the record (one per suggestion).
  const second = await record(reopened.envelopeBytes, dismissOperation(again.leading), '2026-10-17T10:00:00Z');
  assert.equal(second.record.id, recorded.record.id); assert.notEqual(second.record.suggestion.revision, recorded.record.suggestion.revision);
  assert.equal(second.envelope.records.filter(r => r.schema === IMPROVEMENT_SUGGESTION_SCHEMA).length, 1); assert.equal(second.dismissals.length, 1);
  const quiet = await check(s, second.envelopeBytes, { goal: 'fewer regressions' });
  assert.equal(quiet.leading, null); assert.equal(quiet.dismissed.length, 1);
  // Only reasons removed (the request is gone): it stays dismissed rather than flickering back.
  assert.equal((await check(s, second.envelopeBytes)).leading, null);
  // Restore on request: the dismissal and its suggestion record go, and it is active again with no dismissal.
  const restored = await record(second.envelopeBytes, { type: 'restore', id: shown.id });
  assert.equal(restored.record.id, second.record.id); assert.deepEqual(restored.dismissals, []);
  assert.deepEqual(restored.envelope.records.map(r => r.id), ['draft']);
  const active = await check(s, restored.envelopeBytes);
  assert.equal(active.leading.id, shown.id); assert.equal(active.leading.dismissal, null); assert.equal(active.leading.promotion, undefined); assert.deepEqual(active.dismissed, []);
  assert.deepEqual(restored.envelope.savedIntent, recorded.envelope.savedIntent);
});

test('changed content shows a dismissed suggestion again, with the reason; a dismissal whose suggestion no longer arises is preserved', async () => {
  const s = await scenario(), { checked, recorded } = await dismissLeading(s);
  const read = valueOf(await readJourneyEnvelope(recorded.envelopeBytes)), [draft, saved, dismissal] = read.records;
  // Pretend the dismissed content was an older revision of the item.
  const older = { ...structuredClone(saved), change: { ...saved.change, content: { ...saved.change.content, recipeSha256: hex(77) } } };
  older.revision = await suggestionRevision(older);
  const written = valueOf(await writeJourneyEnvelope({ savedIntentBytes: read.savedIntentBytes, previous: read,
    records: [draft, older, { ...dismissal, suggestion: { id: older.id, revision: older.revision } }] }));
  const shown = await check(s, written.envelopeBytes);
  assert.equal(shown.leading.id, checked.leading.id); assert.deepEqual(shown.leading.promotion, { reasons: ["Shown again: the suggested item's content changed since you dismissed it."] });
  // A request-only suggestion, dismissed, is preserved (never dropped) once the request is gone.
  const asked = await check(s, s.envelopeBytes, { goal: 'time to refactor' });
  const review = shownItem(asked, 'mattpocock.improve-codebase-architecture');
  const withReview = await record(s.envelopeBytes, dismissOperation(review));
  const gone = await check(s, withReview.envelopeBytes);
  assert.equal(gone.dismissed.length, 0); assert.equal(gone.preserved.length, 1);
  assert.equal(gone.preserved[0].state, 'not-current'); assert.equal(gone.preserved[0].dismissal.id, withReview.record.id); assert.equal(gone.preserved[0].suggestion.id, review.id);
  // And on request it can be shown again.
  const back = await check(s, withReview.envelopeBytes, { goal: 'time to refactor' });
  assert.deepEqual([back.dismissed.map(d => d.id), back.preserved], [[review.id], []]);
  const restored = await record(withReview.envelopeBytes, { type: 'restore', id: review.id });
  assert.deepEqual(restored.dismissals, []);
});

test('other records travel with improvement records: maintenance notes, unknown optional records, draft edits', async () => {
  const s = await scenario(), { recorded } = await dismissLeading(s);
  const categories = [{ category: 'content', state: 'checked' }];
  const noted = valueOf(await recordMaintenance({ envelopeBytes: recorded.envelopeBytes, operation: { type: 'note-check', checkedAt: '2026-10-15T08:00:00Z', categories }, now: NOW }));
  const improvements = envelope => envelope.records.filter(r => r.schema === IMPROVEMENT_SUGGESTION_SCHEMA || r.schema === IMPROVEMENT_DISMISSAL_SCHEMA);
  assert.deepEqual(improvements(noted.envelope), improvements(recorded.envelope));
  // A maintenance record is carried through a dismissal, then a restore.
  const dismissedAfter = await record(noted.envelopeBytes, dismissOperation(shownItem(await check(s, noted.envelopeBytes, { goal: 'time to refactor' }), 'mattpocock.improve-codebase-architecture')));
  assert.deepEqual(dismissedAfter.envelope.records.find(r => r.id === 'maintenance-check'), noted.envelope.records.find(r => r.id === 'maintenance-check'));
  assert.equal(dismissedAfter.dismissals.length, 2);
  const restored = await record(dismissedAfter.envelopeBytes, { type: 'restore', id: dismissedAfter.dismissals.find(d => d.id !== recorded.record.id).suggestion.id });
  assert.deepEqual(restored.envelope.records.find(r => r.id === 'maintenance-check'), noted.envelope.records.find(r => r.id === 'maintenance-check'));
  assert.deepEqual(improvements(restored.envelope), improvements(recorded.envelope));
  // An unknown optional record is preserved exactly.
  const future = { id: 'future-note', schema: 'urn:aihq:workbench:journey-record:future-note:1.0.0', required: false, anything: { goes: [1, 2] } };
  const withFuture = await resign(recorded.envelopeBytes, doc => { doc.records.push(future); });
  const kept = await record(withFuture, dismissOperation(shownItem(await check(s, withFuture, { goal: 'time to refactor' }), 'mattpocock.improve-codebase-architecture')));
  assert.deepEqual(kept.envelope.records.find(r => r.id === 'future-note'), future);
  assert.equal(kept.dismissals.length, 2);
  const unsupported = await resign(recorded.envelopeBytes, doc => { doc.records.push({ ...future, id: 'must-know', required: true }); });
  const readOnly = await recordImprovement({ envelopeBytes: unsupported, operation: { type: 'restore', id: recorded.record.suggestion.id }, now: NOW });
  assert.equal(readOnly.status, 'refused'); assert.equal(readOnly.diagnostics[0].code, 'JOURNEY_RECORD_UNSUPPORTED'); assert.deepEqual(readOnly.originalBytes, unsupported);
  // A draft edit carries the dismissal through; saved intent changes do not reset it.
  const edited = valueOf(await editDraft({ envelopeBytes: recorded.envelopeBytes, inventories: s.inventories,
    operation: { type: 'remove-root', root: { releaseSha256: s.maintained.release.sha256, itemId: 'mattpocock.implement', scope: 'project' } } }));
  assert.deepEqual(improvements(edited.envelope), improvements(recorded.envelope));
  assert.equal(edited.envelope.revision.sequence, recorded.envelope.revision.sequence + 1);
});

test('registry and public entry: both kinds are optional, the entry exposes only the check, the record and the prompt', () => {
  for (const [urn, kind] of [[IMPROVEMENT_SUGGESTION_SCHEMA, 'improvement-suggestion'], [IMPROVEMENT_DISMISSAL_SCHEMA, 'improvement-dismissal']]) assert.deepEqual(JOURNEY_RECORD_KINDS[urn], { kind, version: '1.0.0', required: false });
  assert.equal(IMPROVEMENT_SUGGESTION_SCHEMA, 'urn:aihq:workbench:journey-record:improvement-suggestion:1.0.0');
  assert.equal(IMPROVEMENT_DISMISSAL_SCHEMA, 'urn:aihq:workbench:journey-record:improvement-dismissal:1.0.0');
  assert.deepEqual(Object.keys(publicApi).sort(), ['IMPROVEMENT_DISMISSAL_SCHEMA', 'IMPROVEMENT_RULES_VERSION', 'IMPROVEMENT_SUGGESTION_SCHEMA', 'checkImprovements', 'improvementPrompt', 'projectDismissals', 'recordImprovement']);
});

// ---- No network, no model, no upload -------------------------------------------------------------------------------
const TRAPPED = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'], saved = Object.fromEntries(TRAPPED.map(name => [name, globalThis[name]]));
test.afterEach(() => { for (const name of TRAPPED) { if (saved[name] === undefined) delete globalThis[name]; else globalThis[name] = saved[name]; } });
function trapNetwork() {
  const calls = [];
  for (const name of TRAPPED) globalThis[name] = function trapped(...args) { calls.push([name, args]); throw new Error(`improvements must not use ${name}`); };
  return calls;
}

test('checking, dismissing and building the prompt never touch the network or a model', async () => {
  const s = await scenario(), calls = trapNetwork(), timers = [];
  const { setTimeout: realTimeout, setInterval: realInterval } = globalThis;
  globalThis.setTimeout = (...args) => { timers.push('setTimeout'); return realTimeout(...args); };
  globalThis.setInterval = (...args) => { timers.push('setInterval'); return realInterval(...args); };
  try {
    const checked = await check(s, s.envelopeBytes, { clients: ['claude'], goal: 'fewer regressions and tests' });
    for (const suggestion of [checked.leading, ...checked.alternatives]) assert.equal(typeof improvementPrompt(suggestion), 'string');
    const recorded = await record(s.envelopeBytes, dismissOperation(checked.leading));
    await check(s, recorded.envelopeBytes); await record(recorded.envelopeBytes, { type: 'restore', id: checked.leading.id });
    const service = await createMixedService(s.maintained);
    valueOf(await service.run('improvements-check', { envelopeBytes: [...s.envelopeBytes], goal: 'tests' }));
  } finally { globalThis.setTimeout = realTimeout; globalThis.setInterval = realInterval; }
  assert.deepEqual(calls, []);
  assert.deepEqual(timers, []);
});

test('the improvement modules import only the allowed seams and contain no network, process or random calls', async () => {
  const allowed = [/^\.\/intake\.mjs$/, /^\.\/journey\.mjs$/, /^\.\/headless\.mjs$/, /^\.\/intent-shape\.mjs$/, /^\.\/maintenance-record\.mjs$/, /^\.\/improvement-[a-z]+\.mjs$/, /^@aihq\/catalog\/reader$/];
  for (const name of ['improvement-record.mjs', 'improvement-rules.mjs', 'improvements.mjs']) {
    const source = await readFile(new URL(`./${name}`, import.meta.url), 'utf8');
    const specifiers = [...source.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s+'([^']+)'/gm)].map(match => match[1]);
    assert.ok(specifiers.length > 0, name);
    for (const specifier of specifiers) assert.ok(allowed.some(pattern => pattern.test(specifier)), `${name} imports ${specifier}`);
    assert.equal(/\bimport\s*\(/.test(source), false, `${name} dynamic import`);
    for (const forbidden of [/fetch\(/, /node:/, /child_process/, /http/i, /WebSocket/, /XMLHttpRequest/, /setTimeout/, /setInterval/, /Math\.random/, /Date\.now/, /new Date\(\)/, /\bprocess\b/, /\bBuffer\b/, /\bwindow\b/, /\bdocument\b/, /localStorage/])
      assert.doesNotMatch(source, forbidden, `${name} ${forbidden}`);
  }
  const rules = await readFile(new URL('./improvement-rules.mjs', import.meta.url), 'utf8');
  assert.deepEqual([...rules.matchAll(/^import\b[^;]*?\bfrom\s+'([^']+)'/gm)].map(m => m[1]), ['./improvement-record.mjs']);
});

// ---- The copy-only prompt ------------------------------------------------------------------------------------------
test('the prompt is attributed, tells the AI to change nothing, and carries no policy bytes, base64 or paths', async () => {
  const s = await scenario(), calls = trapNetwork();
  const checked = await check(s, s.envelopeBytes, { clients: ['claude'], goal: 'fewer regressions' });
  const bytesText = decode(s.policyBytes);
  for (const suggestion of [checked.leading, ...checked.alternatives]) {
    const prompt = suggestion.prompt;
    assert.equal(prompt, improvementPrompt(suggestion));
    assert.ok(prompt.includes('Suggested by the AIH Workbench improvement rules 1.0.0 (fixed rules; no AI model was used).'));
    assert.match(prompt, /Do not install, change or run anything/); assert.match(prompt, /do not ask me to upload/);
    assert.ok(prompt.includes('Start your reply with “AI advice:”.'));
    assert.ok(prompt.includes(suggestion.label)); assert.ok(prompt.includes(suggestion.change.itemId));
    for (const trigger of suggestion.triggers) assert.ok(prompt.includes(trigger.text));
    for (const fact of suggestion.facts) assert.ok(prompt.includes(fact.text));
    for (const unknown of suggestion.unknowns) assert.ok(prompt.includes(unknown));
    // No bytes of the policy or the envelope, no digests, no encoded blobs and no file paths.
    assert.equal(prompt.includes(bytesText.slice(0, 80)), false);
    for (const forbidden of [/base64/i, /urn:aihq/, /[a-f0-9]{64}/, /[A-Za-z0-9+/]{40,}={0,2}/, /[A-Za-z]:[\\/]/, /\\\\/, /(?:^|\s)\.{0,2}\/[\w.-]+\//, /release\/materials/, /savedIntent/, /"schema"/])
      assert.doesNotMatch(prompt, forbidden, String(forbidden));
  }
  assert.equal(checked.leading.rulesVersion, IMPROVEMENT_RULES_VERSION);
  assert.deepEqual(calls, []);
  // Display-only: the dismissal operation drops the prompt, so it is never stored.
  const operation = dismissOperation(checked.leading);
  assert.equal(JSON.stringify(operation).includes('AI advice'), false);
});

// ---- Host route through the mixed service ---------------------------------------------------------------------------
test('host route: improvements-check and improvements-record through the mixed service, including an ordinary saved policy', async () => {
  const s = await scenario(), service = await createMixedService(s.maintained);
  const checked = valueOf(await service.run('improvements-check', { envelopeBytes: [...s.envelopeBytes], clients: ['claude'], goal: 'fewer regressions' }));
  assert.equal(checked.leading.change.itemId, 'mattpocock.tdd'); assert.deepEqual(checked.mutations, []);
  assert.deepEqual(checked.reads, ['envelope', 'supplied-inventories', 'declared-clients', 'request-goal']);
  assert.equal(checked.checkedAt, new Date(checked.checkedAt).toISOString());
  const recorded = valueOf(await service.run('improvements-record', { envelopeBytes: [...s.envelopeBytes], operation: dismissOperation(checked.leading, 'Later.') }));
  assert.equal(recorded.envelope.revision.sequence, 2); assert.equal(recorded.dismissals.length, 1);
  assert.equal(recorded.draft.editing, 'available'); assert.deepEqual(recorded.draft.envelopeBytes, recorded.envelopeBytes);
  const after = valueOf(await service.run('improvements-check', { envelopeBytes: [...recorded.envelopeBytes], goal: 'fewer regressions' }));
  assert.equal(after.dismissed.length, 1); assert.equal(after.dismissed[0].dismissal.reason, 'Later.');
  const restored = valueOf(await service.run('improvements-record', { envelopeBytes: [...recorded.envelopeBytes], operation: { type: 'restore', id: checked.leading.id } }));
  assert.deepEqual(restored.dismissals, []);
  // Refusals keep the input.
  const refused = await service.run('improvements-check', { envelopeBytes: 'nope' });
  assert.equal(refused.status, 'refused'); assert.equal(refused.diagnostics[0].path, '/envelopeBytes');
  const bad = await service.run('improvements-record', { envelopeBytes: [...s.envelopeBytes], operation: { type: 'dismiss', suggestion: {} } });
  assert.equal(bad.status, 'refused'); assert.equal(bad.diagnostics[0].path, '/operation/suggestion');
  assert.equal((await service.run('improvements-check', { categories: [] })).diagnostics[0].path, '/envelopeBytes');
  // An ordinary saved policy with no draft open is wrapped by the same open path; a check writes nothing.
  const policy = [...s.policyBytes];
  const ordinary = valueOf(await service.run('improvements-check', { bytes: policy, goal: 'fewer regressions' }));
  assert.equal(ordinary.leading.change.itemId, 'mattpocock.tdd'); assert.equal(ordinary.leading.dismissal, null);
  // Recording on it turns the saved policy into a draft that carries the dismissal and reopens with it.
  const saved = valueOf(await service.run('improvements-record', { bytes: policy, operation: dismissOperation(ordinary.leading) }));
  assert.equal(saved.dismissals.length, 1); assert.equal(saved.draft.envelope.records.some(r => r.schema === IMPROVEMENT_DISMISSAL_SCHEMA), true);
  assert.deepEqual(saved.draft.savedIntentBytes, s.policyBytes);
  const reopened = valueOf(await service.run('improvements-check', { envelopeBytes: [...saved.envelopeBytes] }));
  assert.equal(reopened.leading, null); assert.deepEqual(reopened.dismissed.map(d => d.id), [ordinary.leading.id]);
  const refusedPolicy = await service.run('improvements-check', { bytes: [1, 2, 3] });
  assert.equal(refusedPolicy.status, 'refused');
  assert.equal((await service.run('improvements-check', { goal: 'tests' })).diagnostics[0].path, '/envelopeBytes');
});

// ---- Shipped schemas ------------------------------------------------------------------------------------------------
test('shipped suggestion and dismissal schemas agree structurally with the runtime records', async t => {
  let suggestionSchema, dismissalSchema, journey;
  for (const base of ['../../schemas/', '../schemas/']) {
    try {
      suggestionSchema = JSON.parse(await readFile(new URL(`${base}journey-record-improvement-suggestion-1.0.0.json`, import.meta.url), 'utf8'));
      dismissalSchema = JSON.parse(await readFile(new URL(`${base}journey-record-improvement-dismissal-1.0.0.json`, import.meta.url), 'utf8'));
      journey = JSON.parse(await readFile(new URL(`${base}journey-envelope-1.0.0.json`, import.meta.url), 'utf8'));
      break;
    } catch { /* try next layout */ }
  }
  if (!suggestionSchema) return t.skip('schema file is not present in this consumer layout; tools/write-authoring-schemas.mjs --check verifies it');
  const s = await scenario(), { recorded } = await dismissLeading(s, undefined, { goal: 'tests' });
  const [, suggestion, dismissal] = recorded.envelope.records;
  assert.equal(suggestionSchema.$id, IMPROVEMENT_SUGGESTION_SCHEMA); assert.equal(suggestionSchema.properties.schema.const, IMPROVEMENT_SUGGESTION_SCHEMA);
  assert.equal(dismissalSchema.$id, IMPROVEMENT_DISMISSAL_SCHEMA); assert.equal(dismissalSchema.properties.schema.const, IMPROVEMENT_DISMISSAL_SCHEMA);
  for (const schema of [suggestionSchema, dismissalSchema]) { assert.equal(schema.additionalProperties, false); assert.equal(schema.properties.required.const, false); }
  assert.deepEqual(Object.keys(suggestionSchema.properties).sort(), Object.keys(suggestion).sort());
  assert.deepEqual([...suggestionSchema.required].sort(), Object.keys(suggestion).filter(k => k !== 'goal').sort());
  assert.deepEqual(Object.keys(dismissalSchema.properties).sort(), [...Object.keys(dismissal), 'reason'].filter((k, i, all) => all.indexOf(k) === i).sort());
  assert.deepEqual([...dismissalSchema.required].sort(), Object.keys(dismissal).filter(k => k !== 'reason').sort());
  assert.match(suggestion.id, new RegExp(suggestionSchema.properties.id.pattern)); assert.match(dismissal.id, new RegExp(dismissalSchema.properties.id.pattern));
  assert.match(suggestion.rulesVersion, new RegExp(suggestionSchema.properties.rulesVersion.pattern)); assert.match(suggestion.recordedAt, new RegExp(suggestionSchema.properties.recordedAt.pattern));
  assert.match(suggestion.revision, new RegExp(suggestionSchema.properties.revision.pattern));
  assert.deepEqual(suggestionSchema.properties.scope.enum, ['project', 'user']);
  assert.deepEqual([...suggestionSchema.properties.change.required].sort(), Object.keys(suggestion.change).sort());
  assert.deepEqual([...suggestionSchema.properties.change.properties.content.required].sort(), Object.keys(suggestion.change.content).sort());
  const trigger = suggestionSchema.properties.triggers.items;
  assert.deepEqual([...trigger.required].sort(), Object.keys(suggestion.triggers[0]).sort());
  for (const entry of suggestion.triggers) { assert.match(entry.key, new RegExp(trigger.properties.key.pattern)); assert.match(entry.ruleId, new RegExp(trigger.properties.ruleId.pattern)); }
  assert.deepEqual(suggestionSchema.properties.references.items.properties.kind.enum, ['setting', 'saved-reason', 'request', 'catalog-item']);
  assert.deepEqual(suggestionSchema.properties.facts.items.properties.kind.enum, ['overhead', 'scope', 'dependency']);
  assert.deepEqual([...dismissalSchema.properties.suggestion.required].sort(), Object.keys(dismissal.suggestion).sort());
  const rules = journey.properties.records.items.allOf.map(rule => [rule.if.properties.schema.const, rule.then.$ref]);
  for (const urn of [IMPROVEMENT_SUGGESTION_SCHEMA, IMPROVEMENT_DISMISSAL_SCHEMA]) assert.ok(rules.some(([a, b]) => a === urn && b === urn), urn);
});
