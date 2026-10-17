import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAuthoringClient } from '../../src/app/authoring-client.js';
import * as improvements from '../../src/app/improvements-view.js';

const { createImprovementsView, groupImprovements, promotionText, dismissOperation, restoreOperation, referenceText } = improvements;
const ok = value => ({ status: 'ok', value });
const draft = { envelopeBytes: [1], savedIntentBytes: [9], projection: { revision: { sequence: 1 } }, intent: { roots: [] } };
const record = { id: 'suggestion-one', revision: 'a'.repeat(64), rulesVersion: '1.0.0', scope: 'project',
  change: { kind: 'add-item', itemId: 'test.item', content: { recipeSha256: 'b'.repeat(64), materials: [] } },
  triggers: [{ ruleId: 'goal.test', key: 'goal:goal.test', text: 'Your goal mentions tests.' }], goal: 'tests',
  references: [{ kind: 'request', ref: 'goal' }], facts: [{ kind: 'scope', text: 'Applies in this project only.' }], unknowns: ['Whether it improves your results is unknown until you try it.'] };
const suggestion = { ...record, label: 'Test helper', description: 'Test advice', prompt: 'Suggested by the AIH Workbench improvement rules 1.0.0 (fixed rules; no AI model was used). Start your reply with “AI advice:”.', dismissal: null,
  promotion: { reasons: ['a new reason applies', 'Shown again: content changed'] } };
const checked = { rulesVersion: '1.0.0', checkedAt: '2026-10-16T12:00:00Z', leading: suggestion, alternatives: [], dismissed: [], preserved: [] };
function service(t, ...script) {
  const calls = [], previous = globalThis.fetch;
  globalThis.fetch = async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => await script.shift() }; };
  t.after(() => { globalThis.fetch = previous; }); return calls;
}
class Node {
  constructor(tag, cls, text = '') { this.tag = tag; this.className = cls; this.textContent = text; this.children = []; this.listeners = {}; this.dataset = {}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, action) { this.listeners[name] = action; }
}
const elements = node => [node, ...node.children.flatMap(elements)];
const textOf = node => elements(node).map(node => node.textContent).join(' ');
const find = (built, text) => elements(built.node).find(node => node.tag === 'button' && node.textContent === text);
function view(client, options = {}) {
  const el = (tag, cls, text) => new Node(tag, cls, text);
  const button = (label, action) => { const node = el('button', '', label); node.addEventListener('click', action); return node; };
  return createImprovementsView({ client, el, button, showStatus() {}, loadClients: async () => ['codex'], ...options });
}

test('groups leading, at most three alternatives, dismissed and preserved; explains promotions', () => {
  const groups = groupImprovements({ ...checked, alternatives: [suggestion, suggestion, suggestion, suggestion], dismissed: [suggestion], preserved: [{ suggestion, dismissal: {}, state: 'not-current' }] });
  assert.deepEqual(groups.map(({ label, rows }) => [label, rows.length]), [['Leading suggestion', 1], ['Alternatives', 3], ['Dismissed', 1], ['Preserved dismissals', 1]]);
  assert.deepEqual(promotionText(suggestion), ['Shown again: a new reason applies', 'Shown again: content changed']);
  assert.deepEqual(promotionText({}), []);
});

test('dismiss operations whitelist record fields and restore targets the stable suggestion id', () => {
  assert.deepEqual(dismissOperation({ ...suggestion, schema: 'unused', required: false, recordedAt: 'unused', extra: 'unused' }), { type: 'dismiss', suggestion: record });
  assert.deepEqual(dismissOperation(suggestion, 'Later'), { type: 'dismiss', suggestion: record, reason: 'Later' });
  const { goal, ...withoutGoal } = record;
  assert.deepEqual(dismissOperation({ ...withoutGoal, label: 'Renamed' }), { type: 'dismiss', suggestion: withoutGoal });
  assert.deepEqual(restoreOperation(record.id), { type: 'restore', id: record.id });
});

test('client checks draft envelopes and ordinary policy bytes with clients and goal, and adopts records', async t => {
  const adopted = { ...draft, envelopeBytes: [2] };
  const calls = service(t, ok(checked), ok({ draft: adopted }), ok(checked), ok({ envelopeBytes: [3], envelope: { records: [] }, projection: { revision: { sequence: 3 } } }));
  const client = createAuthoringClient(); client.publish({ policyBytes: [7], intent: { roots: [] } });
  await client.checkImprovements({ clients: ['codex'], goal: 'tests' });
  assert.equal(calls[0].url, '/api/authoring-improvements-check');
  assert.deepEqual(calls[0].body, { reviewEvidence: [], bytes: [7], clients: ['codex'], goal: 'tests' });
  await client.recordImprovement(dismissOperation(suggestion));
  assert.equal(calls[1].url, '/api/authoring-improvements-record'); assert.deepEqual(calls[1].body.operation, dismissOperation(suggestion));
  assert.deepEqual(client.draft.envelopeBytes, Uint8Array.of(2)); assert.deepEqual(client.bytes, Uint8Array.of(9)); assert.equal(client.intent, undefined);
  await client.checkImprovements({ clients: ['claude'], labels: { claude: 'Claude Code' } });
  assert.deepEqual(calls[2].body, { reviewEvidence: [], envelopeBytes: [2], clients: ['claude'], labels: { claude: 'Claude Code' } });
  await client.recordImprovement(restoreOperation(record.id));
  assert.deepEqual(client.draft.envelopeBytes, Uint8Array.of(3)); assert.deepEqual(client.draft.savedIntentBytes, Uint8Array.of(9));
  const empty = createAuthoringClient();
  assert.equal((await empty.checkImprovements({ clients: [] })).status, 'refused');
  assert.equal((await empty.recordImprovement(restoreOperation('x'))).status, 'refused');
});

test('improvement and maintenance records share one serialized envelope queue', async t => {
  let finish;
  const calls = service(t, ok(draft), new Promise(resolve => { finish = resolve; }), ok({ envelopeBytes: [3] }));
  const client = createAuthoringClient(); await client.openDraft(Uint8Array.of(1));
  const first = client.recordImprovement(dismissOperation(suggestion));
  const second = client.recordDisposition({ type: 'clear', id: 'old' });
  assert.equal(calls.length, 2);
  finish(ok({ envelopeBytes: [2] })); await first; await second;
  assert.equal(calls[2].url, '/api/authoring-maintenance-record'); assert.deepEqual(calls[2].body.envelopeBytes, [2]);
  assert.deepEqual(client.draft.envelopeBytes, Uint8Array.of(3));
});

test('improvement checks and records cannot replace a later imported artifact', async t => {
  let finish;
  const calls = service(t, new Promise(resolve => { finish = resolve; }));
  const client = createAuthoringClient(); client.publish({ policyBytes: [7], intent: {} });
  const checking = client.checkImprovements({ clients: [] }); client.importBytes(Uint8Array.of(8)); finish(ok(checked));
  assert.deepEqual(await checking, { status: 'superseded' }); assert.equal(calls.length, 1);
  client.publish({ policyBytes: [7], intent: {} });
  let resolveRecord;
  service(t, new Promise(resolve => { resolveRecord = resolve; }));
  const recording = client.recordImprovement(dismissOperation(suggestion)); client.importBytes(Uint8Array.of(8)); resolveRecord(ok({ draft }));
  assert.deepEqual(await recording, { status: 'superseded' }); assert.equal(client.draft, undefined);
});

test('COPY-ONLY: asking and copying writes the read-only prompt once with no transport or execution', async t => {
  const client = { draft, revision: 1, checkImprovements: async () => ok(checked) };
  const built = view(client); await built.open();
  const forbidden = [], copies = [];
  const replace = (name, value) => { const previous = Object.getOwnPropertyDescriptor(globalThis, name); Object.defineProperty(globalThis, name, { configurable: true, value }); t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else delete globalThis[name]; }); };
  replace('fetch', () => { forbidden.push('fetch'); });
  replace('window', { open: () => { forbidden.push('open'); } });
  replace('navigator', { clipboard: { writeText: async text => { copies.push(text); } }, sendBeacon: () => { forbidden.push('beacon'); } });
  client.checkImprovements = () => { forbidden.push('check'); };
  client.recordImprovement = () => { forbidden.push('record'); };
  await find(built, 'Ask your AI client').listeners.click();
  const textarea = elements(built.node).find(node => node.tag === 'textarea');
  assert.equal(textarea.readOnly, true); assert.equal(textarea.value, suggestion.prompt);
  assert.match(textOf(built.node), /AI advice — paste this into an AI client you already use/);
  await find(built, 'Copy prompt').listeners.click();
  assert.deepEqual(copies, [suggestion.prompt]); assert.match(copies[0], /Suggested by the AIH Workbench improvement rules/); assert.match(copies[0], /AI advice/);
  assert.deepEqual(forbidden, []);
});

test('dismiss, show again and suggest use injected clients, goal and closed operations', async () => {
  const calls = [];
  const client = { draft, revision: 1, checkImprovements: async input => { calls.push(input); return ok({ ...checked, dismissed: [suggestion], preserved: [{ suggestion: record, dismissal: { reason: 'Later' }, state: 'not-current' }] }); },
    recordImprovement: async operation => { calls.push(operation); return ok({}); } };
  const built = view(client); await built.open();
  assert.deepEqual(calls[0], { clients: ['codex'] });
  for (const text of ['Leading suggestion', 'Dismissed', 'Preserved dismissals', 'Test helper', 'Your goal mentions tests.', 'Applies in this project only.', 'Whether it improves your results is unknown', 'Shown again: a new reason applies', 'Later']) assert.ok(textOf(built.node).includes(text), text);
  assert.ok(elements(built.node).some(node => node.dataset.suggestionId === suggestion.id));
  await find(built, 'Dismiss').listeners.click();
  assert.deepEqual(calls[1], dismissOperation(suggestion)); assert.deepEqual(calls[2], { clients: ['codex'] });
  await find(built, 'Show again').listeners.click();
  assert.deepEqual(calls[3], restoreOperation(record.id)); assert.deepEqual(calls[4], { clients: ['codex'], goal: 'tests' }); // its typed goal is restored
  elements(built.node).find(node => node.id === 'policy-improvements-goal').value = 'fewer regressions';
  await find(built, 'Suggest').listeners.click();
  assert.deepEqual(calls[5], { clients: ['codex'], goal: 'fewer regressions' });
  // A preserved dismissal's suggestion no longer arises: its action forgets the choice and is named so.
  const buttons = elements(built.node).filter(node => node.tag === 'button').map(node => node.textContent);
  assert.equal(buttons.filter(text => text === 'Show again').length, 1); assert.equal(buttons.filter(text => text === 'Forget dismissal').length, 1);
  await find(built, 'Forget dismissal').listeners.click();
  assert.deepEqual(calls[6], restoreOperation(record.id));
});

test('a check says once what it covered, with or without a suggestion, and not before a check or after the result is retired', async () => {
  const coverage = [{ trigger: 'content-change', state: 'unknown', reason: 'no-configured-source', text: 'Content changes were not checked: no update source is configured.' },
    { trigger: 'recurring-friction', state: 'unknown', reason: 'history-unavailable', text: 'Recurring friction was not checked: this host supplied no stored Core results.' }];
  const results = [ok({ ...checked, coverage }), ok({ ...checked, leading: null, coverage }), ok({ ...checked, leading: null })];
  const client = { draft, revision: 1, checkImprovements: async () => results.shift() };
  const built = view(client), area = () => elements(built.node).find(node => node.id === 'policy-improvements-coverage');
  assert.equal(area().children.length, 0);
  await built.open();
  assert.deepEqual(area().children.map(node => node.textContent), coverage.map(entry => entry.text));
  assert.equal(textOf(built.node).split(coverage[0].text).length, 2);
  // Nothing suggested still says what was and was not checked.
  await find(built, 'Suggest').listeners.click();
  assert.ok(textOf(built.node).includes('No improvements were suggested by the fixed rules.'));
  assert.deepEqual(area().children.map(node => node.textContent), coverage.map(entry => entry.text));
  // A result without coverage shows none, and a changed policy retires the shown coverage with its suggestions.
  await find(built, 'Suggest').listeners.click();
  assert.equal(area().children.length, 0);
  client.revision = 2; built.render();
  assert.equal(area().children.length, 0);
});

test('the UI pins the shipped suggestion and dismissal record URNs', async () => {
  for (const [urn, name] of [[improvements.SUGGESTION_RECORD, 'suggestion'], [improvements.DISMISSAL_RECORD, 'dismissal']]) {
    const schema = JSON.parse(await readFile(new URL(`../../schemas/journey-record-improvement-${name}-1.0.0.json`, import.meta.url), 'utf8'));
    assert.equal(urn, schema.$id);
  }
});

test('published clients filter saved suggestions and supply labels while naming unlisted settings', async () => {
  const calls = [], saved = ['claude', 'gone'];
  const client = { intent: {}, revision: 1, checkImprovements: async input => { calls.push(input); return ok(checked); } };
  const built = view(client, { loadClients: async () => saved });
  built.setTargets({ state: 'published', targets: ['claude', 'codex'], labels: { claude: 'Claude Code', codex: 'Codex', gone: 'Gone' } });
  await built.open();
  // Saved clients are filtered by Core's list; the list itself is not sent, because the host reads Core's support from the installed Core.
  assert.deepEqual(calls, [{ clients: ['claude'], labels: { claude: 'Claude Code' } }]);
  const note = elements(built.node).find(node => node.id === 'policy-improvements-unlisted');
  assert.equal(note.hidden, false);
  assert.equal(note.textContent, 'Saved AI client gone is not listed by the installed Core, so no suggestion is made for it. Your saved setup is unchanged.');
  assert.deepEqual(saved, ['claude', 'gone']);
  client.intent = undefined; built.render();
  assert.equal(note.hidden, true); assert.equal(note.textContent, '');
});

test('an unavailable client list sends all saved clients without labels or an unlisted note', async () => {
  const calls = [], client = { intent: {}, revision: 1, checkImprovements: async input => { calls.push(input); return ok(checked); } };
  const built = view(client, { loadClients: async () => ['claude', 'gone'] });
  built.setTargets({ state: 'unavailable', reason: 'No list published' });
  await built.open();
  assert.deepEqual(calls, [{ clients: ['claude', 'gone'] }]);
  const note = elements(built.node).find(node => node.id === 'policy-improvements-unlisted');
  assert.equal(note.hidden, true); assert.equal(note.textContent, '');
});

test('changing published clients retires shown suggestions until another check', async () => {
  const client = { intent: {}, revision: 1, checkImprovements: async () => ok(checked) };
  const built = view(client); await built.open();
  assert.match(textOf(built.node), /Test helper/);
  built.setTargets({ state: 'published', targets: ['claude'], labels: {} });
  assert.equal(find(built, 'Dismiss'), undefined); assert.doesNotMatch(textOf(built.node), /Test helper/);
  assert.match(textOf(built.node), /open policy or its inputs changed since the last check; Suggest again/);
  await built.check(); assert.match(textOf(built.node), /Test helper/);
});

test('a list arriving during a check checks again under that list, and pluralises unlisted clients', async () => {
  const finishes = [], calls = [];
  const client = { intent: {}, revision: 1, checkImprovements: input => { calls.push(input); return new Promise(resolve => { finishes.push(resolve); }); } };
  const built = view(client, { loadClients: async () => ['gone', 'other'] });
  const running = built.open(); await new Promise(resolve => setTimeout(resolve, 0));
  built.setTargets({ state: 'published', targets: ['claude'], labels: {} });
  finishes[0](ok(checked)); await running; await new Promise(resolve => setTimeout(resolve, 0));
  // The first answer was for the old list; the check made under the new list sends no unlisted client.
  assert.deepEqual(calls.map(call => call.clients), [['gone', 'other'], []]);
  assert.equal(find(built, 'Dismiss'), undefined); assert.match(textOf(built.node), /Checking improvements/);
  finishes[1](ok(checked)); await new Promise(resolve => setTimeout(resolve, 0));
  assert.notEqual(find(built, 'Dismiss'), undefined); assert.equal(find(built, 'Suggest').disabled, false);
  const note = elements(built.node).find(node => node.id === 'policy-improvements-unlisted');
  assert.equal(note.textContent, 'Saved AI clients gone, other are not listed by the installed Core, so no suggestions are made for them. Your saved setup is unchanged.');
  built.setTargets({ state: 'unavailable' }); assert.equal(note.hidden, true); assert.equal(note.textContent, '');
});

test('view discards older checks and resets hidden artifact state', async () => {
  let finish, count = 0;
  const client = { intent: {}, revision: 1, checkImprovements: async () => ++count === 1 ? new Promise(resolve => { finish = resolve; }) : ok(checked) };
  const built = view(client), first = built.open();
  await new Promise(resolve => setTimeout(resolve, 0));
  await built.check(); finish(ok({ ...checked, leading: null })); await first;
  assert.match(textOf(built.node), /Test helper/);
  client.intent = undefined; built.render(); assert.equal(built.node.hidden, true);
  client.intent = {}; built.render(); assert.doesNotMatch(textOf(built.node), /Test helper/);
});

test('suggestions checked for one revision are retired when the open policy changes, until suggested again', async () => {
  const client = { draft, revision: 1, checkImprovements: async () => ok(checked) };
  const built = view(client); await built.open();
  assert.match(textOf(built.node), /Test helper/); assert.ok(find(built, 'Dismiss'));
  client.revision = 2; built.render();
  assert.doesNotMatch(textOf(built.node), /Test helper/); assert.equal(find(built, 'Dismiss'), undefined);
  assert.match(textOf(built.node), /open policy or its inputs changed since the last check; Suggest again/);
  await find(built, 'Suggest').listeners.click();
  assert.match(textOf(built.node), /Test helper/); assert.doesNotMatch(textOf(built.node), /policy or its inputs changed/);
  // The view's own refused record raises the client revision but changes nothing: the cards stay, without the changed message.
  client.recordImprovement = async () => { client.revision++; built.render(); assert.match(textOf(built.node), /Test helper/); return { status: 'refused', diagnostics: [{ message: 'Refused for the test.' }] }; };
  await find(built, 'Dismiss').listeners.click();
  assert.match(textOf(built.node), /Test helper/); assert.doesNotMatch(textOf(built.node), /policy or its inputs changed/); built.render(); assert.ok(find(built, 'Dismiss'));
});

test('a record superseded by a real edit retires the cards for the changed policy', async () => {
  const client = { draft, revision: 1, checkImprovements: async () => ok(checked) };
  const built = view(client); await built.open();
  client.recordImprovement = async () => { client.revision++; built.render(); assert.equal(find(built, 'Dismiss').disabled, true, 'inert while recording'); client.revision++; return { status: 'superseded' }; };
  await find(built, 'Dismiss').listeners.click();
  assert.equal(find(built, 'Dismiss'), undefined); assert.match(textOf(built.node), /open policy or its inputs changed/);
});

test('a record request that fails leaves the cards usable for a retry', async () => {
  const statuses = [], client = { draft, revision: 1, checkImprovements: async () => ok(checked) };
  const built = view(client, { showStatus: message => statuses.push(message) }); await built.open();
  client.recordImprovement = async () => { client.revision++; built.render(); throw new Error('Failed to fetch'); };
  await find(built, 'Dismiss').listeners.click();
  assert.equal(find(built, 'Dismiss').disabled, false); assert.equal(find(built, 'Suggest').disabled, false);
  assert.match(textOf(built.node), /Test helper/); assert.ok(statuses.includes('Failed to fetch'));
});

test('a pending check does not keep cards for a revision that has changed', async () => {
  let finish;
  const client = { draft, revision: 1, checkImprovements: async () => ok(checked) };
  const built = view(client); await built.open();
  client.checkImprovements = () => new Promise(resolve => { finish = resolve; });
  const running = built.check(); await new Promise(resolve => setTimeout(resolve, 0));
  client.revision = 2; built.render();
  assert.equal(find(built, 'Dismiss'), undefined); assert.doesNotMatch(textOf(built.node), /Test helper/);
  finish(ok(checked)); await running;
  assert.equal(find(built, 'Dismiss'), undefined);
});

test('showing again a suggestion that arose from a typed goal checks with that goal', async () => {
  const calls = [], asked = { ...suggestion, goal: 'add tests', references: [{ kind: 'request', ref: 'goal' }], dismissal: { id: 'dismissal-x' } };
  const client = { draft, revision: 1, checkImprovements: async input => { calls.push(input); return ok({ ...checked, leading: null, alternatives: [], dismissed: [asked] }); },
    recordImprovement: async operation => { calls.push(operation); return ok({}); } };
  const built = view(client); await built.open();
  assert.equal(elements(built.node).find(node => node.id === 'policy-improvements-goal').value, '');
  await find(built, 'Show again').listeners.click();
  assert.deepEqual(calls.slice(1), [restoreOperation(asked.id), { clients: ['codex'], goal: 'add tests' }]);
});

test('an artifact change while settings load releases the pending Suggest control without checking stale input', async () => {
  let finish;
  const calls = [], client = { draft, revision: 1, checkImprovements: async input => { calls.push(input); return ok(checked); } };
  const built = view(client, { loadClients: () => new Promise(resolve => { finish = resolve; }) });
  const checking = built.open(); client.revision++; finish(['codex']); await checking;
  assert.equal(find(built, 'Suggest').disabled, false); assert.deepEqual(calls, []);
});

test('default clients come from saved setup and check failures leave suggestions unknown', async t => {
  const previous = globalThis.fetch, calls = [];
  globalThis.fetch = async url => { calls.push(url); return { ok: true, json: async () => ({ ok: true, state: 'saved', settings: { clients: ['claude'] } }) }; };
  t.after(() => { globalThis.fetch = previous; });
  const client = { draft, revision: 1, checkImprovements: async input => { calls.push(input); return ok(checked); } };
  const built = view(client, { loadClients: undefined }); await built.open();
  assert.deepEqual(calls, ['/api/workbench-settings', { clients: ['claude'] }]);
  client.checkImprovements = async () => { throw new Error('offline'); };
  await built.check(); assert.match(textOf(built.node), /could not be completed.*unknown/);
  assert.doesNotMatch(textOf(built.node), /Test helper|No improvements were suggested/);
  // No saved setup, or an unreadable one, means no declared clients rather than a failed check.
  globalThis.fetch = async url => { calls.push(url); return { ok: false, status: 404, json: async () => ({ ok: false, error: 'no setup' }) }; };
  client.checkImprovements = async input => { calls.push(input); return ok(checked); };
  calls.length = 0; await built.check();
  assert.deepEqual(calls, ['/api/workbench-settings', { clients: [] }]);
});

test('reasons name their source in words and keep the exact reference', () => {
  assert.equal(referenceText({ kind: 'saved-reason', ref: 'mattpocock.implement' }), 'From the reason saved with mattpocock.implement');
  assert.equal(referenceText({ kind: 'setting', ref: 'clients' }), 'From your Workbench setup');
  assert.equal(referenceText({ kind: 'request', ref: 'goal' }), 'From the goal you asked about');
  assert.equal(referenceText({ kind: 'catalog-item', ref: 'mattpocock.tdd' }), 'Catalog item mattpocock.tdd');
});

test('an adapter suggestion shows its target, Core support and installed state as three lines, and a dismissal never records them', async () => {
  const client = { target: { state: 'declared', clientId: 'other', text: 'Adapter target: other.' }, core: { state: 'not-supported', text: 'Not Core-supported: Core does not list other.' },
    installed: { state: 'not-checked', text: 'Installed or connected: not checked.' } };
  const withClient = { ...suggestion, client };
  const built = view({ intent: {}, revision: 1, checkImprovements: async () => ok({ ...checked, leading: withClient }) }, { loadClients: async () => ['codex'] });
  await built.open();
  const shown = textOf(built.node);
  for (const line of [client.target.text, client.core.text, client.installed.text]) assert.ok(shown.includes(line), line);
  assert.deepEqual(dismissOperation(withClient), { type: 'dismiss', suggestion: record });
});
