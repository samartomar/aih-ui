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
  // An offline response lists the envelope's recorded choices as preserved, so the retained rows keep their current choice.
  const offline = ok({ ...checked, checkedAt: '2026-10-16T12:00:00Z', updates: [], preserved: [{ record: checked.updates[0].disposition, state: 'unknown' }],
    categories: [{ category: 'content', selected: true, state: 'unknown', reason: 'sources-unavailable' }] });
  for (const failure of [{ status: 'refused' }, null, offline]) {
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

const policy = { roots: [subject] };
const offlineValue = (extra = {}) => ({ checkedAt: '2026-10-16T12:00:00Z', categories: [{ category: 'content', selected: true, state: 'unknown', reason: 'sources-unavailable' }],
  updates: [], preserved: [], ...extra });

test('choices recorded one after another never overwrite each other', async t => {
  let first, second;
  const done = { envelopeBytes: [2], projection: { revision: { sequence: 2 } }, dispositions: [] };
  const calls = service(t, ok(draft), new Promise(resolve => { first = resolve; }), new Promise(resolve => { second = resolve; }));
  const client = createAuthoringClient(); await client.openDraft(Uint8Array.of(1));
  const one = client.recordDisposition({ type: 'clear', id: 'one' }), two = client.recordDisposition({ type: 'clear', id: 'two' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls.length, 2, 'the second choice waits for the first');
  first(ok(done)); await one;
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(calls[2].body.envelopeBytes, [2], 'the second choice starts from the envelope the first produced');
  assert.deepEqual(calls[2].body.operation, { type: 'clear', id: 'two' });
  second(ok({ ...done, envelopeBytes: [3], projection: { revision: { sequence: 3 } } }));
  assert.equal((await two).status, 'ok'); assert.deepEqual(client.draft.envelopeBytes, Uint8Array.of(3));
});

test('a failed choice does not block the next one', async t => {
  const calls = service(t, ok(draft), new Error('network'), ok({ envelopeBytes: [2], projection: { revision: { sequence: 2 } }, dispositions: [] }));
  const client = createAuthoringClient(); await client.openDraft(Uint8Array.of(1));
  await assert.rejects(client.recordDisposition({ type: 'clear', id: 'one' }), /network/);
  assert.equal((await client.recordDisposition({ type: 'clear', id: 'two' })).status, 'ok');
  assert.deepEqual(calls[2].body.envelopeBytes, [1]);
});

test('a failure of a superseded choice is superseded, like a check', async t => {
  let fail;
  service(t, ok(draft), new Promise((_resolve, reject) => { fail = reject; }));
  const other = createAuthoringClient(); await other.openDraft(Uint8Array.of(1));
  const recording = other.recordDisposition({ type: 'clear', id: 'one' }); await new Promise(resolve => setTimeout(resolve, 0));
  other.importBytes(Uint8Array.of(8)); fail(new Error('late failure'));
  assert.deepEqual(await recording, { status: 'superseded' });
});

test('an ordinary policy is checked and recorded as its own bytes, and recording makes it a saved draft', async t => {
  const adopted = { ...draft, envelopeBytes: [2], projection: { revision: { sequence: 2 } } };
  const calls = service(t, ok(checked), ok({ envelopeBytes: [2], envelope: {}, projection: { revision: { sequence: 2 } }, record: null, dispositions: [], draft: adopted }), ok(adopted));
  const client = createAuthoringClient(); client.publish({ policyBytes: [7, 7], intent: policy });
  assert.equal(client.draft, undefined);
  await client.checkMaintenance(['content']);
  assert.equal(calls[0].url, '/api/authoring-maintenance-check');
  assert.deepEqual(calls[0].body.bytes, [7, 7]); assert.equal('envelopeBytes' in calls[0].body, false); assert.equal('policyBytes' in calls[0].body, false);
  const revision = client.revision;
  assert.equal((await client.recordDisposition({ type: 'clear', id: 'old' })).status, 'ok');
  assert.deepEqual(calls[1].body.bytes, [7, 7]); assert.equal('envelopeBytes' in calls[1].body, false);
  assert.ok(client.revision > revision);
  assert.deepEqual(client.draft.envelopeBytes, Uint8Array.of(2)); assert.equal(client.draft.fromPolicy, false);
  assert.equal(client.intent, undefined); assert.deepEqual(client.bytes, Uint8Array.of(9));
  // The saved draft reopens by revalidating its envelope, never by re-reading the plain policy.
  await client.reopen();
  assert.equal(calls[2].url, '/api/authoring-draft-open'); assert.deepEqual(calls[2].body.bytes, [2]);
  // Neither route works with nothing open.
  const empty = createAuthoringClient();
  assert.equal((await empty.checkMaintenance(['content'])).status, 'refused');
  assert.equal((await empty.recordDisposition({ type: 'clear', id: 'x' })).status, 'refused');
});

test('the update view is shown for an ordinary policy, and checks it on open', async () => {
  const calls = [];
  const client = { intent: policy, revision: 1, checkMaintenance: async selected => { calls.push(selected); return ok(checked); } };
  const built = view(client);
  assert.equal(built.node.hidden, false);
  await built.open();
  assert.deepEqual(calls, [['content']]); assert.match(textOf(built.node), /Skipped revisions/);
  client.intent = undefined; built.render();
  assert.equal(built.node.hidden, true);
});

test('with no configured source the category line says so and no update claim is made', async () => {
  const unconfigured = { ...checked, updates: [], categories: [{ category: 'content', selected: true, state: 'unknown', reason: 'no-configured-source' }] };
  assert.match(categoryLine(unconfigured.categories[0]), /unknown.*no update source is configured on this host/i);
  const built = view({ draft, revision: 1, checkMaintenance: async () => ok(unconfigured) }); await built.open();
  const text = textOf(built.node);
  assert.match(text, /no update source is configured on this host/); assert.match(text, /could not be completed.*updates are unknown/i);
  assert.doesNotMatch(text, /no updates were offered/i);
});

test('an offline first check after a reopen shows the recorded check time and states, with content unknown now', async () => {
  const lastCheck = { checkedAt: '2026-10-14T09:30:00Z', categories: [{ category: 'content', state: 'checked' }, { category: 'software', state: 'not-selected' }] };
  const state = updatesState(null, ok(offlineValue({ lastCheck })), ['content']);
  assert.equal(state.value.checkedAt, lastCheck.checkedAt);
  assert.match(checkedLine(state), /^Updates as of 2026-10-14T09:30:00Z\./); assert.match(checkedLine(state), /Some updates are unknown/);
  assert.equal(state.value.categories.find(row => row.category === 'content').state, 'unknown');
  const built = view({ draft, revision: 1, checkMaintenance: async () => ok(offlineValue({ lastCheck })) }); await built.open();
  const text = textOf(built.node);
  assert.match(text, /Updates as of 2026-10-14T09:30:00Z/); assert.match(text, /Content: unknown — sources are unavailable/);
  assert.match(text, /Recorded in this draft.*2026-10-14T09:30:00Z.*Content: checked/);
  // Nothing recorded and nothing seen: still unknown, with no time claimed.
  assert.equal(updatesState(null, ok(offlineValue()), ['content']).value.checkedAt, undefined);
});

test('saving notes the last successful check once, only when it is newer than the recorded one', async () => {
  const notes = [];
  const client = { draft, revision: 1, checkMaintenance: async () => ok({ ...checked, lastCheck: { checkedAt: '2026-10-14T00:00:00Z', categories: [{ category: 'content', state: 'checked' }] } }),
    recordDisposition: async operation => { notes.push(operation); return ok({}); } };
  const built = view(client);
  await built.noteCheck(); assert.deepEqual(notes, [], 'nothing was checked yet');
  await built.open();
  assert.deepEqual(notes, [], 'a check alone never records');
  await built.noteCheck();
  assert.equal(notes.length, 1);
  assert.deepEqual(notes[0], { type: 'note-check', checkedAt: '2026-10-15T12:00:00Z', categories: [
    { category: 'content', state: 'checked' }, { category: 'software', state: 'not-selected' }, { category: 'client', state: 'not-selected' }, { category: 'environment', state: 'not-selected' }] });
  await built.noteCheck(); assert.equal(notes.length, 1, 'the same check is not recorded twice');
  // An offline or failed check is not a successful one: it never replaces the recorded time.
  client.checkMaintenance = async () => ok(offlineValue());
  await built.check(); await built.noteCheck(); assert.equal(notes.length, 1);
});

test('a check already recorded in the envelope is not recorded again, and a refused note does not block saving', async () => {
  const notes = [];
  const client = { draft, revision: 1, checkMaintenance: async () => ok({ ...checked, lastCheck: { checkedAt: checked.checkedAt, categories: [{ category: 'content', state: 'checked' }] } }),
    recordDisposition: async operation => { notes.push(operation); return { status: 'refused', diagnostics: [{ message: 'read only' }] }; } };
  const built = view(client); await built.open(); await built.noteCheck();
  assert.deepEqual(notes, []);
  client.checkMaintenance = async () => ok({ ...checked, checkedAt: '2026-10-17T00:00:00Z' });
  await built.check(); await built.noteCheck();
  assert.equal(notes.length, 1);
  await assert.doesNotReject(built.noteCheck());
});

test('offline rows follow the current envelope: a cleared choice shows no choice, a newly recorded skip shows skipped', () => {
  const success = updatesState(null, ok({ ...checked, updates: [update('old', 'skip'), update('fresh', null, 'new')] }), ['content']);
  // The skip on `old` was revisited (cleared) and `fresh` was skipped while the source was unreachable.
  const skippedRecord = { id: 'fresh', category: 'content', subject, scope: 'project', candidate: { ...subject, kind: 'content-revision', releaseSha256: 'fresh' }, disposition: 'skip' };
  const offline = ok(offlineValue({ preserved: [{ record: skippedRecord, state: 'unknown' }] }));
  const state = updatesState(success, offline, ['content']);
  const old = state.value.updates.find(row => row.id === 'old'), fresh = state.value.updates.find(row => row.id === 'fresh');
  assert.equal(old.disposition, null); assert.equal(old.promoted, true); assert.equal(old.attention, 'new');
  assert.equal(fresh.disposition.disposition, 'skip'); assert.equal(fresh.promoted, false); assert.equal(fresh.attention, null);
  const groups = groupUpdates(state.value);
  assert.deepEqual(groups.map(group => [group.label, group.rows.map(row => row.id ?? row.record?.id)]),
    [['Needs attention', ['old']], ['Kept current', []], ['Skipped revisions', ['fresh']], ['Deferred', []], ['Preserved choices', []]]);
  assert.match(dispositionText(old), /New revision available/);
  // A defer whose date has been reached by the offline check's own time needs attention again.
  const deferred = { ...skippedRecord, id: 'old', disposition: 'defer', deferUntil: '2026-10-16' };
  const later = updatesState(success, ok(offlineValue({ preserved: [{ record: deferred, state: 'unknown' }] })), ['content']);
  const reached = later.value.updates.find(row => row.id === 'old');
  assert.equal(reached.attention, 'defer-date-reached'); assert.equal(reached.promoted, true);
  const future = updatesState(success, ok(offlineValue({ preserved: [{ record: { ...deferred, deferUntil: '2026-11-01' }, state: 'unknown' }] })), ['content']);
  assert.equal(future.value.updates.find(row => row.id === 'old').promoted, false);
  // With no response at all the current envelope's own dispositions are authoritative.
  const failed = updatesState(success, null, ['content'], []);
  assert.equal(failed.value.updates.find(row => row.id === 'old').disposition, null);
});
