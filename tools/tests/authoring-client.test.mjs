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
