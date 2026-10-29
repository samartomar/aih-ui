// Q3 regression (connected): the one-server MCP approval must use the real service request shape and must
// preserve an open draft through the legitimate edit -> draft-open rewrap, with revision guards intact.
// Run: node --test tools/tests/authoring-approval.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthoringClient } from '../../src/app/authoring-client.js';

const POLICY = { policyBytes: [7, 8, 9], intent: { roots: [{ itemId: 'a' }] } };
const EDITED = { policyBytes: [10, 11, 12], intent: { roots: [{ itemId: 'a' }] } };
const reply = value => ({ ok: true, status: 200, json: async () => value });

/** fetch stub that records full request bodies so the exact service contract is asserted. */
function stubFetch(handlers) {
  const bodies = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const operation = String(url).replace('/api/authoring-', '');
    const body = JSON.parse(init.body);
    bodies.push({ operation, body });
    const handler = handlers[operation];
    if (!handler) throw new Error('unexpected operation ' + operation);
    return reply(await handler(body));
  };
  return { bodies, restore: () => { globalThis.fetch = original; } };
}

async function startedClient(handlers) {
  const stub = stubFetch(handlers);
  const client = createAuthoringClient();
  await client.newDraft();
  return { client, stub };
}

test('ordinary approval edit sends the real edit contract: policyBytes present, no bytes field', async () => {
  const { client, stub } = await startedClient({
    new: async () => ({ status: 'ok', value: POLICY }),
    edit: async () => ({ status: 'ok', value: EDITED }),
  });
  try {
    const result = await client.recordApproval({ type: 'mcp-approval', granted: true });
    assert.equal(result.status, 'ok');
    const edit = stub.bodies.find(entry => entry.operation === 'edit');
    assert.ok(edit, 'edit request made');
    assert.ok(Array.isArray(edit.body.policyBytes), 'policyBytes must be present (the service reads it)');
    assert.deepEqual(edit.body.policyBytes, [7, 8, 9], 'edits the open artifact bytes');
    assert.equal(edit.body.bytes, undefined, 'body.bytes is not the service contract');
    assert.deepEqual(edit.body.operation, { type: 'mcp-approval', granted: true });
    assert.equal(client.draft, undefined);
    assert.deepEqual([...client.bytes], [10, 11, 12]);
  } finally { stub.restore(); }
});

test('draft approval goes through the draft-edit route and adopts the presented draft', async () => {
  const { client, stub } = await startedClient({
    new: async () => ({ status: 'ok', value: POLICY }),
    'draft-open': async body => ({ status: 'ok', value: { envelopeBytes: body.bytes, savedIntentBytes: body.bytes, projection: { revision: { sequence: 2 } }, intent: { roots: [{ itemId: 'a' }] } } }),
    'draft-edit': async body => ({ status: 'ok', value: { envelopeBytes: [5, 6], savedIntentBytes: [13, 14, 15], projection: { revision: { sequence: 5 } }, intent: { roots: [{ itemId: 'a' }] }, editing: 'available' } }),
  });
  try {
    await client.openDraft();
    assert.ok(client.draft);
    const result = await client.recordApproval({ type: 'mcp-approval', granted: true });
    assert.equal(result.status, 'ok');
    const edit = stub.bodies.find(entry => entry.operation === 'draft-edit');
    assert.ok(Array.isArray(edit.body.envelopeBytes), 'the draft envelope rides the request');
    assert.equal(edit.body.policyBytes, undefined, 'a draft edit does not resend the base policy');
    assert.deepEqual(edit.body.operation, { type: 'mcp-approval', granted: true });
    assert.ok(client.draft, 'the presented draft is adopted; the draft stays open');
    assert.deepEqual([...client.draft.envelopeBytes], [5, 6]);
    assert.deepEqual([...client.draft.savedIntentBytes], [13, 14, 15]);
  } finally { stub.restore(); }
});

test('off then on then off: each approval edit is serialized and adopts only the latest artifact', async () => {
  const { client, stub } = await startedClient({
    new: async () => ({ status: 'ok', value: POLICY }),
    edit: async body => ({ status: 'ok', value: { policyBytes: [...body.policyBytes, body.operation.granted ? 1 : 0], intent: { roots: [] } } }),
  });
  try {
    await client.recordApproval({ type: 'mcp-approval', granted: true });
    await client.recordApproval({ type: 'mcp-approval', granted: false });
    await client.recordApproval({ type: 'mcp-approval', granted: true });
    const edits = stub.bodies.filter(entry => entry.operation === 'edit');
    assert.equal(edits.length, 3);
    assert.deepEqual([...client.bytes], [7, 8, 9, 1, 0, 1], 'each edit adopted the previous artifact (serialized, in order)');
  } finally { stub.restore(); }
});

test('a late approval reply cannot replace a newly opened artifact', async () => {
  let resolveEdit;
  const { client, stub } = await startedClient({
    new: async () => ({ status: 'ok', value: POLICY }),
    edit: () => new Promise(resolve => { resolveEdit = () => resolve({ status: 'ok', value: { policyBytes: [99], intent: { roots: [] } } }); }),
  });
  try {
    const pending = client.recordApproval({ type: 'mcp-approval', granted: true });
    client.invalidate();
    resolveEdit();
    const result = await pending;
    assert.equal(result.status, 'superseded');
    assert.deepEqual([...client.bytes], [7, 8, 9], 'stale approval must not be adopted');
  } finally { stub.restore(); }
});
