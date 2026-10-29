// Q3 regression: the one-server MCP approval must be artifact/revision-guarded and must preserve an open draft.
// Run: node --test tools/tests/authoring-approval.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthoringClient } from '../../src/app/authoring-client.js';

const POLICY = { policyBytes: [7, 8, 9], intent: { roots: [{ itemId: 'a' }] } };
const DRAFT = { envelopeBytes: [3, 4], savedIntentBytes: [7, 8, 9], projection: { revision: { sequence: 2 } }, intent: { roots: [{ itemId: 'a' }] } };
const reply = value => ({ ok: true, status: 200, json: async () => value });

/** fetch stub keyed by the authoring operation in the URL; `handlers` may return a promise for slow replies. */
function stubFetch(handlers) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const operation = String(url).replace('/api/authoring-', '');
    calls.push(operation);
    const handler = handlers[operation];
    if (!handler) throw new Error('unexpected operation ' + operation);
    return reply(await handler(JSON.parse(init.body)));
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

async function startedClient(handlers) {
  const stub = stubFetch(handlers);
  const client = createAuthoringClient();
  try { await client.newDraft(); } finally { /* keep stub for the test body */ }
  return { client, stub };
}

test('recordApproval adopts an ordinary edit like publish (no draft forced)', async () => {
  const { client, stub } = await startedClient({
    new: async () => ({ status: 'ok', value: POLICY }),
    edit: async () => ({ status: 'ok', value: { policyBytes: [10, 11], intent: { roots: [] } } }),
  });
  try {
    const result = await client.recordApproval({ type: 'mcp-approval', granted: true });
    assert.equal(result.status, 'ok');
    assert.equal(client.draft, undefined);
    assert.deepEqual([...client.bytes], [10, 11]);
  } finally { stub.restore(); }
});

test('recordApproval preserves an open draft instead of discarding it', async () => {
  const { client, stub } = await startedClient({
    new: async () => ({ status: 'ok', value: POLICY }),
    'draft-open': async () => ({ status: 'ok', value: DRAFT }),
    'draft-edit': async () => ({ status: 'ok', value: { envelopeBytes: [5, 6], savedIntentBytes: [7, 8, 9], projection: { revision: { sequence: 3 } }, intent: { roots: [] } } }),
  });
  try {
    await client.openDraft();
    assert.ok(client.draft, 'draft open');
    const result = await client.recordApproval({ type: 'mcp-approval', granted: true });
    assert.equal(result.status, 'ok');
    assert.ok(client.draft, 'the open draft must survive the approval');
    assert.deepEqual([...client.draft.envelopeBytes], [5, 6]);
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
    client.invalidate(); // the artifact moved while the approval was out
    resolveEdit();
    const result = await pending;
    assert.equal(result.status, 'superseded');
    assert.deepEqual([...client.bytes], [7, 8, 9], 'stale approval must not be adopted');
  } finally { stub.restore(); }
});
