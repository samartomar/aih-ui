import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthoringClient } from '../../src/app/authoring-client.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const response = value => ({ ok: true, json: async () => value });
const value = number => ({ policyBytes: [number], intent: { roots: [{ itemId: String(number) }] } });
function requests(t) {
  const pending = []; const previous = globalThis.fetch;
  globalThis.fetch = () => { const request = deferred(); pending.push(request); return request.promise; };
  t.after(() => { globalThis.fetch = previous; }); return pending;
}
test('older catalog loads cannot replace the latest rendered inventory', async t => {
  const pending = requests(t), client = createAuthoringClient();
  const first = client.loadCatalog(), second = client.loadCatalog();
  pending[1].resolve(response({ items: ['latest'] })); await second;
  pending[0].resolve(response({ items: ['old'] })); await first;
  assert.deepEqual(client.catalog.items, ['latest']);
});
test('draft import invalidates a pending choice and preserves exact imported bytes', async t => {
  const pending = requests(t), client = createAuthoringClient(); client.publish(value(1));
  const selection = client.propose({ type: 'select' }); client.importBytes(Uint8Array.of(2));
  pending[0].resolve(response({ status: 'ok', value: value(3) })); await selection;
  assert.equal(client.candidate, undefined); assert.deepEqual(client.bytes, Uint8Array.of(2));
});
test('failed exact-source reopen discards prior editable intent', async t => {
  const pending = requests(t), client = createAuthoringClient(); client.publish(value(1));
  const reopened = client.reopen(); pending[0].resolve(response({ status: 'ok', value: { editing: 'unavailable', diagnostics: [{ code: 'SOURCE_REVISION_UNAVAILABLE' }] } })); await reopened;
  assert.equal(client.intent, undefined); assert.deepEqual(client.bytes, Uint8Array.of(1));
});
test('a new draft response cannot overwrite a later imported artifact', async t => {
  const pending = requests(t), client = createAuthoringClient(); client.publish(value(1));
  const created = client.newDraft(); client.importBytes(Uint8Array.of(2));
  pending[0].resolve(response({ status: 'ok', value: value(3) })); await created;
  assert.deepEqual(client.bytes, Uint8Array.of(2)); assert.equal(client.intent, undefined);
});
test('a folder catalog refresh cannot render after a newer draft revision', async t => {
  const pending = requests(t), client = createAuthoringClient(); client.publish(value(1));
  const refreshed = client.loadCatalog({ expectedRevision: client.revision }); client.importBytes(Uint8Array.of(2));
  pending[0].resolve(response({ items: ['older-folder'] })); assert.equal(await refreshed, undefined);
  assert.equal(client.catalog, undefined);
});
test('a delayed host preparation cannot restore approval after a draft import', async t => {
  const pending = requests(t), client = createAuthoringClient(); client.publish(value(1));
  const preparation = client.requestHost('prepare'); client.importBytes(Uint8Array.of(2));
  pending[0].resolve(response({ status: 'ready', sessionId: 'stale-session' }));
  assert.deepEqual(await preparation, { status: 'superseded' });
});
test('only the latest host request can present a prepared approval', async t => {
  const pending = requests(t), client = createAuthoringClient(); client.publish(value(1));
  const preparation = client.requestHost('prepare'), authority = client.requestHost('authority');
  pending[1].resolve(response({ status: 'ok', value: {} })); await authority;
  pending[0].resolve(response({ status: 'ready', sessionId: 'stale-session' }));
  assert.deepEqual(await preparation, { status: 'superseded' });
});
test('refreshing judgments keeps a compiled draft policy and its executable intent', async t => {
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  const envelope = new TextEncoder().encode(JSON.stringify({ schema: 'urn:aihq:workbench:journey-envelope:1.0.0' }));
  const draft = { envelopeBytes: [...envelope], savedIntentBytes: [1], projection: { revision: { sequence: 2 } }, intent: { roots: [{ itemId: 'a' }] }, reviewJudgments: [] };
  const judged = [{ recordId: 'r', applicability: 'changed' }], bodies = [];
  const replies = [draft, { policyBytes: [2], intent: { roots: [{ itemId: 'a' }] }, scope: [{ itemId: 'a' }] }, { editing: 'available', reviewJudgments: judged, reviewSummary: { changed: 1 } }];
  globalThis.fetch = async (url, init) => { bodies.push([url, JSON.parse(init.body)]); return response({ status: 'ok', value: replies.shift() }); };
  const client = createAuthoringClient(); client.importBytes(envelope); await client.reopen(); await client.compileDraft();
  client.setReviewEvidence([Uint8Array.of(9)]); await client.refreshJudgments();
  assert.deepEqual(client.bytes, Uint8Array.of(2)); assert.ok(client.compiled); assert.deepEqual(client.intent, { roots: [{ itemId: 'a' }] });
  assert.deepEqual(client.reviewJudgments, judged);
  assert.equal(bodies.at(-1)[0], '/api/authoring-read'); assert.deepEqual(bodies.at(-1)[1].policyBytes, [2]); assert.deepEqual(bodies.at(-1)[1].reviewEvidence, [[9]]);
});
test('recording an update choice adopts the judgments of the draft it returns', async t => {
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  const envelope = new TextEncoder().encode(JSON.stringify({ schema: 'urn:aihq:workbench:journey-envelope:1.0.0' }));
  const draft = { envelopeBytes: [...envelope], savedIntentBytes: [1], projection: { revision: { sequence: 2 } }, intent: { roots: [{ itemId: 'a' }] }, reviewJudgments: [] };
  const judged = [{ recordId: 'r', applicability: 'changed' }];
  const replies = [draft, { draft: { ...draft, projection: { revision: { sequence: 3 } }, reviewJudgments: judged, reviewSummary: { changed: 1 } } }];
  globalThis.fetch = async () => response({ status: 'ok', value: replies.shift() });
  const client = createAuthoringClient(); client.importBytes(envelope); await client.reopen();
  assert.equal((await client.recordDisposition({ type: 'clear', id: 'one' })).status, 'ok');
  assert.deepEqual(client.reviewJudgments, judged);
});


function sessionStorageFor(t) {
  const previous = globalThis.sessionStorage, values = new Map();
  globalThis.sessionStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  t.after(() => { if (previous === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = previous; });
  return values;
}

test('session recovery keeps accepted exact bytes and dirty state, never an unaccepted candidate', async t => {
  sessionStorageFor(t);
  const { recoverDraftSession } = await import('../../src/app/draft-session.js');
  const pending = requests(t), client = createAuthoringClient();
  client.publish(value(1));
  const proposed = client.propose({ type: 'select' });
  pending[0].resolve(response({ status: 'ok', value: value(2) })); await proposed;
  assert.deepEqual(recoverDraftSession().bytes, Uint8Array.of(1));
  client.discard(); assert.deepEqual(recoverDraftSession().bytes, Uint8Array.of(1));
  client.publish(value(3)); assert.equal(client.dirty, true);
  assert.equal(recoverDraftSession().dirty, true);
  client.markDownloaded(); assert.equal(recoverDraftSession().dirty, false);
  client.publish(value(4)); assert.equal(client.dirty, true);
  client.importBytes(Uint8Array.of(5)); assert.equal(client.dirty, false, 'opening a saved file starts a clean artifact');
});

test('startup consumes guided handoff and validates the exact bytes before permitting editing', async t => {
  sessionStorageFor(t);
  const { saveDraftHandoff, takeDraftHandoff } = await import('../../src/app/draft-session.js');
  const input = new TextEncoder().encode('{ "policy": "exact bytes" }');
  assert.equal(saveDraftHandoff(input), true);
  const calls = [], prior = globalThis.fetch;
  globalThis.fetch = async (url, options) => { calls.push({ url, body: options.body && JSON.parse(options.body) }); return response(url === '/api/authoring-catalog' ? { items: [] } : { status: 'ok', value: { editing: 'available', intent: { roots: [], pins: [] } } }); };
  t.after(() => { globalThis.fetch = prior; });
  const client = createAuthoringClient(); await client.start();
  assert.deepEqual(client.bytes, input); assert.ok(client.intent); assert.equal(client.dirty, true); assert.equal(client.startupSource, 'handoff');
  assert.equal(calls[1].url, '/api/authoring-read'); assert.deepEqual(calls[1].body.policyBytes, [...input]);
  assert.equal(takeDraftHandoff(), undefined);
});

test('maximum envelope recovery has a bounded base64 round trip and refuses malformed storage', async t => {
  const storage = sessionStorageFor(t);
  const { saveDraftSession, recoverDraftSession } = await import('../../src/app/draft-session.js');
  const bytes = new Uint8Array(2_000_000); bytes[17] = 255; bytes[1_999_999] = 127;
  assert.equal(saveDraftSession(bytes, true), true);
  assert.ok([...storage.values()][0].length < 2_700_000);
  assert.deepEqual(recoverDraftSession().bytes, bytes);
  assert.equal(saveDraftSession(new Uint8Array(2_000_001), true), false);
  for (const key of storage.keys()) storage.set(key, '{"base64":"not base64"}');
  assert.equal(recoverDraftSession(), undefined);
});


test('isolated guided clients neither restore nor overwrite the accepted Workbench session', async t => {
  const storage = sessionStorageFor(t);
  const { saveDraftSession, saveDraftHandoff, recoverDraftSession, takeDraftHandoff } = await import('../../src/app/draft-session.js');
  saveDraftSession(Uint8Array.of(42), true); saveDraftHandoff(Uint8Array.of(43));
  const prior = globalThis.fetch, calls = [];
  globalThis.fetch = async url => { calls.push(url); return response(url === '/api/authoring-catalog' ? { items: [] } : { status: 'ok', value: value(1) }); };
  t.after(() => { globalThis.fetch = prior; });
  const isolated = createAuthoringClient({ sessionRecovery: false }); await isolated.start(); isolated.publish(value(2));
  assert.deepEqual(recoverDraftSession().bytes, Uint8Array.of(42));
  assert.deepEqual(takeDraftHandoff(), Uint8Array.of(43));
  assert.deepEqual(calls, ['/api/authoring-catalog', '/api/authoring-new']);
  const accepted = [...storage.values()][0];
  globalThis.sessionStorage.setItem = () => { throw new Error('quota exceeded'); };
  assert.equal(saveDraftHandoff(new Uint8Array(2_000_000)), false);
  assert.deepEqual(recoverDraftSession().bytes, Uint8Array.of(42));
  assert.equal([...storage.values()][0], accepted);
});
test('a project folder change supersedes every host result still out, and an inventory read does not supersede Install', async t => {
  const pending = requests(t), client = createAuthoringClient();
  const preview = client.requestHost('prepare'), inventory = client.requestCurrent('managed');
  pending[1].resolve(response({ selections: ['folder-a'] }));
  pending[0].resolve(response({ status: 'ready', sessionId: 'a' }));
  assert.equal((await preview).sessionId, 'a');
  assert.deepEqual((await inventory).selections, ['folder-a']);
  const latePreview = client.requestHost('prepare'), lateInventory = client.requestCurrent('managed');
  client.discardHostWork();
  pending[2].resolve(response({ status: 'ready', sessionId: 'a2' })); pending[3].resolve(response({ selections: ['folder-a'] }));
  assert.equal((await latePreview).status, 'superseded');
  assert.equal((await lateInventory).status, 'superseded');
});

test('the header tool serializes as its canonical id, never the registry object', async t => {
  const previous = globalThis.fetch; const bodies = [];
  globalThis.fetch = (_url, init) => { bodies.push(JSON.parse(init.body)); return Promise.resolve(response({ status: 'ok', value: value(9) })); };
  t.after(() => { globalThis.fetch = previous; });
  const client = createAuthoringClient();
  client.setTool({ id: 'claude', label: 'Claude Code', surface: 'cli', observed: true }); // the header hands over the entry
  await client.request('edit', { operation: { type: 'select' } });
  assert.equal(bodies[0].tool, 'claude', 'a tool object becomes its canonical id');
  client.setTool('codex');
  await client.request('edit', { operation: { type: 'select' } });
  assert.equal(bodies[1].tool, 'codex', 'a string id is kept verbatim');
  client.setTool(null);
  await client.request('edit', { operation: { type: 'select' } });
  assert.equal(Object.hasOwn(bodies[2], 'tool'), false, 'no tool sends no tool field at all');
});

test('Q6-R2: setTool notifies subscribers and folderRevision is observable across discardHostWork', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ status: 'ok', value: { policyBytes: [1], intent: { roots: [] } } }) });
  try {
    const client = createAuthoringClient();
    await client.newDraft();
    let notified = 0;
    client.subscribe(() => { notified += 1; });
    client.setTool('claude');
    assert.equal(notified, 1, 'a tool change notifies every subscribed surface (drawer host facts, catalog re-read)');
    const before = client.folderRevision;
    client.discardHostWork();
    assert.ok(client.folderRevision > before, 'folderRevision moves on folder/host invalidation so browse keys can bind it');
  } finally { globalThis.fetch = original; }
});
