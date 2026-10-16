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
