import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthoringClient } from '../../src/app/authoring-client.js';
import { groupUpdates, updateLabel, dispositionText, factText, categoryLine, updatesState, checkedLine, UPDATES_NOTE, createUpdatesView } from '../../src/app/updates-view.js';

const subject = { kind: 'selection', itemId: 'notes', releaseSha256: 'a', itemSha256: 'b' };
const update = (id, disposition, attention = null) => ({ id, category: 'content', subject, scope: 'project', candidate: { ...subject, kind: 'content-revision', releaseSha256: id },
  package: { name: 'Notes', version: id }, disposition: disposition ? { id, disposition, deferUntil: disposition === 'defer' ? '2026-11-01' : undefined } : null,
  attention, promoted: !!attention, facts: [{ kind: 'authority', message: 'Organization origin' }, { kind: 'evidence', message: 'Review needs reconsideration' }] });
const categories = [{ category: 'content', selected: true, state: 'checked' }, ...['software', 'client', 'environment'].map(category => ({ category, selected: false, state: 'not-selected' }))];
const checked = { checkedAt: '2026-10-15T12:00:00Z', categories, updates: [update('old', 'skip'), update('new', null, 'new')], preserved: [] };
const ok = value => ({ status: 'ok', value });
const draft = { envelopeBytes: [1], savedIntentBytes: [9], projection: { revision: { sequence: 1 } }, roots: [subject], unresolved: [], compile: { status: 'available' }, intent: { roots: [subject] } };
const reply = value => ({ ok: true, json: async () => value });
function service(t, ...script) {
  const calls = [], previous = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    const next = script.shift();
    if (next instanceof Error) throw next;
    return next?.ok !== undefined ? next : reply(await next);
  };
  t.after(() => { globalThis.fetch = previous; }); return calls;
}

test('groups every disposition and preserves a newer candidate beside a skipped revision', () => {
  const rows = [update('new', null, 'new'), update('reached', 'defer', 'defer-date-reached'), update('kept', 'keep-current'), update('old', 'skip'), update('later', 'defer')];
  const preserved = ['not-offered', 'unknown', 'orphaned'].map(state => ({ record: { ...update(state, 'skip'), disposition: 'skip' }, state }));
  const groups = groupUpdates({ updates: rows, preserved });
  assert.deepEqual(groups.map(group => [group.label, group.rows.length]), [['Needs attention', 2], ['Kept current', 1], ['Skipped revisions', 1], ['Deferred', 1], ['Preserved choices', 3]]);
  assert.match(dispositionText(rows[4]), /2026-11-01/);
  assert.match(dispositionText(rows[2]), /remains available/i);
  assert.match(dispositionText(rows[1]), /date reached/i);
  for (const group of groups.slice(0, 4)) for (const row of group.rows) assert.deepEqual(row.facts.map(factText), ['Authority: Organization origin', 'Evidence: Review needs reconsideration']);
  assert.match(updateLabel(rows[0], { items: [{ id: 'notes', label: 'Team notes', root: { releaseSha256: 'a' } }] }), /Team notes/);
});

test('category lines explain checked, unavailable readers, offline sources and not selected', () => {
  assert.match(categoryLine(categories[0]), /Content: checked/);
  assert.match(categoryLine({ category: 'content', state: 'unknown', reason: 'sources-unavailable' }), /unknown.*sources.*unavailable/i);
  assert.match(categoryLine({ category: 'software', state: 'unknown', reason: 'no-supported-reader' }), /unknown.*no supported reader/i);
  assert.match(categoryLine(categories[1]), /not selected/);
});

test('failed and offline checks retain rows and their actual check time, never claim no updates', () => {
  const success = updatesState(null, ok(checked), ['content']);
  for (const failure of [{ status: 'refused' }, null, ok({ ...checked, checkedAt: '2026-10-16T12:00:00Z', updates: [], categories: [{ category: 'content', selected: true, state: 'unknown', reason: 'sources-unavailable' }] })]) {
    const state = updatesState(success, failure, ['content']);
    assert.deepEqual(state.value.updates, checked.updates);
    assert.equal(state.value.checkedAt, checked.checkedAt);
    assert.equal(state.unknown, true);
    assert.match(checkedLine(state), /as of 2026-10-15T12:00:00Z/);
    assert.doesNotMatch(checkedLine(state), /no updates/i);
  }
  assert.match(checkedLine(updatesState(null, null, ['content'])), /could not be completed.*updates are unknown/i);
});

test('an offline check lists each retained choice once, not again as an unknown preserved choice', () => {
  const success = updatesState(null, ok(checked), ['content']);
  const offline = ok({ ...checked, updates: [], categories: [{ category: 'content', selected: true, state: 'unknown', reason: 'sources-unavailable' }],
    preserved: [{ record: checked.updates[0].disposition, state: 'unknown' }, { record: { id: 'elsewhere', disposition: 'skip' }, state: 'unknown' }] });
  const state = updatesState(success, offline, ['content']);
  assert.deepEqual(state.value.updates, checked.updates);
  assert.deepEqual(state.value.preserved.map(entry => entry.record.id), ['elsewhere']);
});

test('check sends exactly the selected categories and discards responses after a draft change', async t => {
  let resolve; const late = new Promise(done => { resolve = done; });
  const calls = service(t, ok(draft), late);
  const client = createAuthoringClient(); await client.openDraft(Uint8Array.of(1));
  const check = client.checkMaintenance(['software']); client.invalidate(); resolve(ok(checked));
  assert.deepEqual(await check, { status: 'superseded' });
  assert.equal(calls[1].url, '/api/authoring-maintenance-check');
  assert.deepEqual(calls[1].body.categories, ['software']);
  assert.deepEqual(calls[1].body.envelopeBytes, [1]); assert.equal('policyBytes' in calls[1].body, false);
});

test('record adopts only the new envelope fields and preserves saved intent and draft details', async t => {
  const operation = { type: 'clear', id: 'old' };
  const next = { envelopeBytes: [2], envelope: { revision: { sequence: 2 } }, projection: { revision: { sequence: 2 } }, record: null, dispositions: [] };
  const calls = service(t, ok(draft), ok(next));
  const client = createAuthoringClient(); await client.openDraft(Uint8Array.of(1)); const revision = client.revision;
  await client.recordDisposition(operation);
  assert.equal(calls[1].url, '/api/authoring-maintenance-record');
  assert.deepEqual(calls[1].body.operation, operation); assert.deepEqual(calls[1].body.envelopeBytes, [1]); assert.equal('policyBytes' in calls[1].body, false);
  assert.ok(client.revision > revision); assert.equal(client.draft.projection.revision.sequence, 2);
  assert.deepEqual(client.draft.envelopeBytes, Uint8Array.of(2)); assert.deepEqual(client.draft.savedIntentBytes, Uint8Array.of(9));
  for (const key of ['roots', 'unresolved', 'compile', 'intent']) assert.deepEqual(client.draft[key], draft[key]);
  assert.equal(client.draft.fromPolicy, true); assert.deepEqual(client.bytes, Uint8Array.of(9));
});

class Node {
  constructor(tag, className, text = '') { this.tag = tag; this.className = className; this.textContent = text; this.children = []; this.dataset = {}; this.listeners = {}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, action) { this.listeners[name] = action; }
}
const elements = root => [root, ...root.children.flatMap(elements)];
const textOf = root => elements(root).map(node => node.textContent).join(' ');
function view(client) {
  const el = (tag, cls, text) => new Node(tag, cls, text);
  const button = (label, action) => { const node = el('button', '', label); node.addEventListener('click', action); return node; };
  return createUpdatesView({ client, el, button, showStatus() {} });
}

test('the DOM shows facts in every group, preserved states, and read-only/save copy', async () => {
  const value = { ...checked, updates: [update('new', null, 'new'), update('keep', 'keep-current'), update('skip', 'skip'), update('defer', 'defer')],
    preserved: ['not-offered', 'unknown', 'orphaned'].map(state => ({ record: { id: state, category: 'content', subject, scope: 'project', candidate: { ...subject, releaseSha256: state }, disposition: 'skip' }, state })) };
  const client = { draft, catalog: { items: [{ id: 'notes', label: 'Team notes', root: { releaseSha256: 'a' } }] }, revision: 1, checkMaintenance: async () => ok(value) };
  const built = view(client); await built.open();
  const text = textOf(built.node);
  for (const label of ['Needs attention', 'Kept current', 'Skipped revisions', 'Deferred', '2026-11-01', 'Team notes', 'not offered', 'unknown', 'no longer']) assert.ok(text.includes(label), label);
  assert.equal(elements(built.node).filter(node => node.textContent === 'Authority: Organization origin').length, 4);
  assert.equal(elements(built.node).filter(node => node.textContent === 'Evidence: Review needs reconsideration').length, 4);
  assert.match(UPDATES_NOTE, /opening.*Check now.*only read/i); assert.match(UPDATES_NOTE, /nothing is applied or scheduled/i);
  assert.match(UPDATES_NOTE, /date.*opened or checked/i); assert.match(UPDATES_NOTE, /save the draft/i);
});

for (const failure of [new Error('offline'), { ok: false, json: async () => ({ error: 'unavailable' }) }, { status: 'refused' }]) test(`view retains the last success after ${failure.message ?? failure.status ?? 'HTTP failure'}`, async t => {
  service(t, ok(draft), ok(checked), failure);
  const client = createAuthoringClient(); await client.openDraft(Uint8Array.of(1));
  const built = view(client); await built.open(); await built.check();
  const text = textOf(built.node);
  assert.match(text, /as of 2026-10-15T12:00:00Z/); assert.match(text, /unknown/i); assert.match(text, /Skipped revisions/); assert.doesNotMatch(text, /no updates/i);
});

test('checkbox selection stays page-owned and record actions recheck with only that selection', async () => {
  const calls = [];
  const client = { draft, revision: 1, checkMaintenance: async selected => { calls.push(selected); return ok(checked); }, recordDisposition: async operation => { calls.push(operation); return ok({}); } };
  const built = view(client); await built.open();
  const boxes = elements(built.node).filter(node => node.type === 'checkbox');
  assert.deepEqual(boxes.map(node => node.checked), [true, false, false, false]);
  boxes[1].checked = true; await boxes[1].listeners.change();
  await built.check();
  assert.deepEqual(calls[1], ['content', 'software']);
  assert.deepEqual(boxes.map(node => node.checked), [true, true, false, false]);
  const skip = elements(built.node).find(node => node.tag === 'button' && node.textContent === 'Skip this revision');
  await skip.listeners.click();
  assert.equal(calls[2].type, 'set'); assert.equal(calls[2].disposition, 'skip'); assert.deepEqual(calls[3], ['content', 'software']);
});

test('first check failure and first offline result say the check could not be completed', async () => {
  for (const result of [null, ok({ ...checked, updates: [], categories: [{ category: 'content', selected: true, state: 'unknown', reason: 'sources-unavailable' }] })]) {
    const built = view({ draft, revision: 1, checkMaintenance: async () => result }); await built.open();
    assert.match(textOf(built.node), /could not be completed.*updates are unknown/i);
    assert.doesNotMatch(textOf(built.node), /no updates/i);
  }
});

test('a stale failed check cannot replace the current view and an older check cannot replace a newer check', async () => {
  let resolve; const late = new Promise(done => { resolve = done; });
  let count = 0;
  const client = { draft, revision: 1, checkMaintenance: async () => ++count === 1 ? late : ok(checked) };
  const built = view(client), first = built.open(); await built.check(); resolve(ok({ ...checked, updates: [] })); await first;
  assert.match(textOf(built.node), /Skipped revisions/);
  client.checkMaintenance = async () => { client.revision++; throw new Error('old failure'); };
  await built.check(); assert.match(textOf(built.node), /Skipped revisions/);
});

test('stale disposition response cannot adopt over a newer import', async t => {
  let resolve; const late = new Promise(done => { resolve = done; });
  service(t, ok(draft), late);
  const client = createAuthoringClient(); await client.openDraft(Uint8Array.of(1));
  const recording = client.recordDisposition({ type: 'clear', id: 'old' }); client.importBytes(Uint8Array.of(8));
  resolve(ok({ envelopeBytes: [2], projection: { revision: { sequence: 2 } }, dispositions: [] }));
  assert.deepEqual(await recording, { status: 'superseded' }); assert.equal(client.draft, undefined); assert.deepEqual(client.bytes, Uint8Array.of(8));
});

test('refused recording leaves the envelope and saved intent untouched', async t => {
  service(t, ok(draft), { status: 'refused', diagnostics: [{ message: 'Invalid date' }] });
  const client = createAuthoringClient(); await client.openDraft(Uint8Array.of(1));
  assert.equal((await client.recordDisposition({ type: 'set' })).status, 'refused');
  assert.deepEqual(client.draft.envelopeBytes, Uint8Array.of(1)); assert.deepEqual(client.draft.savedIntentBytes, Uint8Array.of(9));
});

test('adopting a recorded choice invalidates checks begun during its request', async t => {
  let finishRecord, finishCheck;
  const recorded = new Promise(done => { finishRecord = done; }), checkedLate = new Promise(done => { finishCheck = done; });
  service(t, ok(draft), recorded, checkedLate);
  const client = createAuthoringClient(); await client.openDraft(Uint8Array.of(1));
  const record = client.recordDisposition({ type: 'clear', id: 'old' }), check = client.checkMaintenance(['content']);
  finishRecord(ok({ envelopeBytes: [2], projection: { revision: { sequence: 2 } }, dispositions: [] })); await record;
  finishCheck(ok(checked)); assert.deepEqual(await check, { status: 'superseded' });
});
