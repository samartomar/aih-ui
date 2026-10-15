import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthoringClient, isJourneyEnvelope, importLimitError } from '../../src/app/authoring-client.js';

const encode = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
const policy = encode({ schema: 'urn:aihq:core:execution-policy:1.3.0', mode: 'project', selections: [] });
const envelope = encode({ schema: 'urn:aihq:workbench:journey-envelope:1.0.0', executable: false });
const root = (itemId, status = 'resolved') => ({ releaseSha256: 'a'.repeat(64), itemId, scope: 'project', configuration: {}, status });
// An opened or edited draft as the service returns it: byte arrays, never the policy of record.
const draftValue = (sequence, ...roots) => ({ envelopeBytes: [...encode(`envelope-${sequence}`)], savedIntentBytes: [...policy], editing: roots.some(r => r.status === 'unresolved') ? 'unresolved' : 'available',
  intent: { roots }, roots, unresolved: [], projection: { revision: { sequence } }, compile: { status: 'refused', reasons: [] }, originalBytes: [1] });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const reply = value => ({ ok: true, json: async () => value });
// Records each request and answers from a script of values or deferred promises, in order.
function service(t, ...script) {
  const calls = [], previous = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, body: options.body ? JSON.parse(options.body) : undefined });
    const next = script[calls.length - 1];
    return reply(await next);
  };
  t.after(() => { globalThis.fetch = previous; });
  return calls;
}
const ok = value => ({ status: 'ok', value, diagnostics: [] });

test('journey envelopes are told apart from policies by their schema, including unsupported versions', () => {
  assert.equal(isJourneyEnvelope(envelope), true);
  assert.equal(isJourneyEnvelope(encode({ schema: 'urn:aihq:workbench:journey-envelope:9.0.0' })), true);
  assert.equal(isJourneyEnvelope(policy), false);
  assert.equal(isJourneyEnvelope(encode('not json')), false);
  assert.equal(isJourneyEnvelope(Uint8Array.of(0xff, 0xfe)), false);
  assert.equal(isJourneyEnvelope(encode({ nested: { schema: 'urn:aihq:workbench:journey-envelope:1.0.0' } })), false);
});

test('an unresolved read opens a draft; the policy stays the original bytes and no intent is editable', async t => {
  const calls = service(t, { status: 'ok', value: { editing: 'unresolved' } }, ok(draftValue(1, root('mine', 'unresolved'), root('shared'))));
  const client = createAuthoringClient(); client.importBytes(policy);
  const result = await client.reopen();
  assert.deepEqual(calls.map(call => call.url), ['/api/authoring-read', '/api/authoring-draft-open']);
  assert.deepEqual(calls[1].body.bytes, [...policy]);
  assert.equal(result.value.editing, 'unresolved');
  assert.equal(client.draft.roots.length, 2);
  assert.deepEqual(client.draft.envelopeBytes, encode('envelope-1'));
  assert.deepEqual(client.bytes, policy);
  assert.equal(client.intent, undefined); assert.equal(client.draft.originalBytes, undefined);
});

test('an available policy reopens exactly as before and opens no draft', async t => {
  const calls = service(t, { status: 'ok', value: { editing: 'available', intent: { roots: [] } } });
  const client = createAuthoringClient(); client.importBytes(policy);
  await client.reopen();
  assert.equal(calls.length, 1); assert.equal(client.draft, undefined); assert.deepEqual(client.intent, { roots: [] });
});

test('an imported envelope opens straight as a draft without a policy read', async t => {
  const calls = service(t, ok(draftValue(3, root('shared'))));
  const client = createAuthoringClient(); client.importBytes(envelope);
  await client.reopen();
  assert.deepEqual(calls.map(call => call.url), ['/api/authoring-draft-open']);
  assert.deepEqual(calls[0].body.bytes, [...envelope]);
  assert.deepEqual(client.bytes, policy, 'The envelope itself is never the current policy.');
  assert.equal(client.draft.editing, 'available');
});

test('a draft opened for an older import cannot overwrite a newer import', async t => {
  const first = deferred(), calls = service(t, first.promise);
  const client = createAuthoringClient(); client.importBytes(envelope);
  const opening = client.reopen(); client.importBytes(Uint8Array.of(2));
  first.resolve(ok(draftValue(1, root('late'))));
  assert.deepEqual(await opening, { status: 'superseded' });
  assert.equal(calls.length, 1); assert.equal(client.draft, undefined); assert.deepEqual(client.bytes, Uint8Array.of(2));
});

test('importing a file discards an open draft and any compiled policy', async t => {
  service(t, ok(draftValue(1, root('shared'))));
  const client = createAuthoringClient(); client.importBytes(envelope); await client.reopen();
  assert.ok(client.draft); client.importBytes(Uint8Array.of(7));
  assert.equal(client.draft, undefined); assert.equal(client.compiled, undefined);
});

test('with a draft open, a proposal goes through the draft edit and accepting adopts the new revision', async t => {
  const edited = draftValue(2, root('mine', 'unresolved'), root('shared'), root('added'));
  const calls = service(t, ok(draftValue(1, root('mine', 'unresolved'), root('shared'))), ok({ ...edited, changes: { addedRoots: [root('added')] } }));
  const client = createAuthoringClient(); client.importBytes(envelope); await client.reopen();
  const operation = { type: 'select', root: { releaseSha256: 'a'.repeat(64), itemId: 'added', scope: 'project' } };
  const result = await client.propose(operation);
  assert.equal(calls[1].url, '/api/authoring-draft-edit');
  assert.deepEqual(calls[1].body.envelopeBytes, [...encode('envelope-1')]); assert.deepEqual(calls[1].body.operation, operation);
  assert.equal(result.status, 'ok');
  assert.equal(client.candidate.roots.length, 3);
  assert.equal(client.draft.roots.length, 2, 'The open draft is retained until the change is accepted.');
  client.accept();
  assert.equal(client.draft.roots.length, 3); assert.equal(client.candidate, undefined);
  assert.deepEqual(client.draft.envelopeBytes, encode('envelope-2')); assert.deepEqual(client.bytes, policy);
});

test('a refused draft edit keeps the draft and offers nothing to accept', async t => {
  const refused = { status: 'refused', diagnostics: [{ code: 'DEPENDENCY_RETAINED', message: 'still required by notes' }] };
  service(t, ok(draftValue(1, root('mine', 'unresolved'))), refused);
  const client = createAuthoringClient(); client.importBytes(envelope); await client.reopen();
  const result = await client.propose({ type: 'remove-root', root: root('mine') });
  assert.equal(result.diagnostics[0].code, 'DEPENDENCY_RETAINED');
  assert.equal(client.candidate, undefined); assert.equal(client.draft.roots.length, 1);
});

test('a delayed draft edit cannot propose after a newer draft change', async t => {
  const late = deferred(), calls = service(t, ok(draftValue(1, root('shared'))), late.promise);
  const client = createAuthoringClient(); client.importBytes(envelope); await client.reopen();
  const proposal = client.propose({ type: 'select', root: root('x') }); client.invalidate();
  late.resolve(ok(draftValue(2, root('shared'), root('x'))));
  assert.deepEqual(await proposal, { status: 'superseded' });
  assert.equal(calls.length, 2); assert.equal(client.candidate, undefined);
});

test('a successful compile publishes the executable policy while the draft stays savable', async t => {
  const compiled = encode({ schema: 'urn:aihq:core:execution-policy:1.3.0', mode: 'project', selections: [{ id: 'shared' }] });
  const scope = [{ releaseSha256: 'a'.repeat(64), itemId: 'shared', scope: 'project' }];
  const calls = service(t, ok(draftValue(1, root('mine', 'unresolved'), root('shared'))), ok({ policyBytes: [...compiled], intent: { roots: [root('shared')] }, scope, reviewsReconsidered: [] }));
  const client = createAuthoringClient(); client.importBytes(envelope); await client.reopen();
  const result = await client.compileDraft(scope);
  assert.equal(calls[1].url, '/api/authoring-draft-compile'); assert.deepEqual(calls[1].body.roots, scope);
  assert.equal(result.status, 'ok');
  assert.deepEqual(client.bytes, compiled); assert.deepEqual(client.intent, { roots: [root('shared')] });
  assert.equal(client.compiled.whole, false);
  assert.deepEqual(client.draft.envelopeBytes, encode('envelope-1'));
});

test('a refused compile leaves the current policy and draft untouched', async t => {
  const refused = { status: 'refused', diagnostics: [{ code: 'SCOPE_UNRESOLVED', message: 'unresolved root mine' }] };
  const calls = service(t, ok(draftValue(1, root('mine', 'unresolved'))), refused);
  const client = createAuthoringClient(); client.importBytes(envelope); await client.reopen();
  const result = await client.compileDraft();
  assert.equal('roots' in calls[1].body, false, 'The whole draft is requested by omitting the scope.');
  assert.equal(result.diagnostics[0].code, 'SCOPE_UNRESOLVED');
  assert.deepEqual(client.bytes, policy); assert.equal(client.intent, undefined); assert.equal(client.compiled, undefined);
});

test('editing a draft after a compile withdraws the compiled policy', async t => {
  const compiled = encode({ schema: 'urn:aihq:core:execution-policy:1.3.0', mode: 'project', selections: [] });
  service(t, ok(draftValue(1, root('shared'))), ok({ policyBytes: [...compiled], intent: { roots: [root('shared')] }, scope: [root('shared')] }),
    ok(draftValue(2, root('shared'), root('added'))));
  const client = createAuthoringClient(); client.importBytes(envelope); await client.reopen();
  await client.compileDraft(); assert.deepEqual(client.bytes, compiled); assert.equal(client.compiled.whole, true);
  await client.propose({ type: 'select', root: root('added') }); client.accept();
  assert.deepEqual(client.bytes, policy); assert.equal(client.intent, undefined); assert.equal(client.compiled, undefined);
});

test('a stale compile cannot publish a policy after the draft changed', async t => {
  const late = deferred(), calls = service(t, ok(draftValue(1, root('shared'))), late.promise);
  const client = createAuthoringClient(); client.importBytes(envelope); await client.reopen();
  const compiling = client.compileDraft(); client.invalidate();
  late.resolve(ok({ policyBytes: [9], intent: { roots: [] }, scope: [] }));
  assert.deepEqual(await compiling, { status: 'superseded' });
  assert.equal(calls.length, 2); assert.deepEqual(client.bytes, policy); assert.equal(client.compiled, undefined);
});

test('revalidating an open draft re-reads its envelope, not the original policy', async t => {
  const calls = service(t, ok(draftValue(1, root('shared'))), ok(draftValue(1, root('shared'))));
  const client = createAuthoringClient(); client.importBytes(envelope); await client.reopen();
  await client.reopen();
  assert.deepEqual(calls.map(call => call.url), ['/api/authoring-draft-open', '/api/authoring-draft-open']);
  assert.deepEqual(calls[1].body.bytes, [...encode('envelope-1')]);
});

test('an untouched draft of a plain policy revalidates as that policy and becomes ordinary editing once it resolves', async t => {
  const calls = service(t, { status: 'ok', value: { editing: 'unresolved' } }, ok(draftValue(1, root('mine', 'unresolved'))),
    { status: 'ok', value: { editing: 'available', intent: { roots: [root('mine')] } } });
  const client = createAuthoringClient(); client.importBytes(policy); await client.reopen();
  assert.ok(client.draft);
  await client.reopen();
  assert.deepEqual(calls.map(call => call.url), ['/api/authoring-read', '/api/authoring-draft-open', '/api/authoring-read']);
  assert.deepEqual(calls[2].body.policyBytes, [...policy]);
  assert.equal(client.draft, undefined); assert.deepEqual(client.intent, { roots: [root('mine')] });
});

test('an edited draft keeps its edits when it is revalidated', async t => {
  const calls = service(t, { status: 'ok', value: { editing: 'unresolved' } }, ok(draftValue(1, root('mine', 'unresolved'))),
    ok(draftValue(2, root('mine', 'unresolved'), root('added'))), ok(draftValue(2, root('mine'), root('added'))));
  const client = createAuthoringClient(); client.importBytes(policy); await client.reopen();
  await client.propose({ type: 'select', root: root('added') }); client.accept();
  await client.reopen();
  assert.equal(calls[3].url, '/api/authoring-draft-open');
  assert.deepEqual(calls[3].body.bytes, [...encode('envelope-2')]);
  assert.equal(client.draft.editing, 'available'); assert.equal(client.draft.roots.length, 2);
});

test('imports are bounded at 1 MB for a policy and 2 MB for a journey envelope', () => {
  const padded = (value, size) => { const bytes = new Uint8Array(size).fill(32); bytes.set(value); return bytes; };
  const bigEnvelope = padded(envelope, 1_500_000), bigPolicy = padded(policy, 1_500_000);
  assert.equal(importLimitError(bigEnvelope.length), undefined);
  assert.equal(importLimitError(bigEnvelope.length, bigEnvelope), undefined);
  assert.equal(importLimitError(2_000_000, padded(envelope, 2_000_000)), undefined);
  assert.match(importLimitError(bigPolicy.length, bigPolicy), /Policy exceeds the public byte limit of 1 MB/);
  assert.equal(importLimitError(1_000_000, padded(policy, 1_000_000)), undefined);
  assert.match(importLimitError(2_000_001), /2 MB for a journey envelope/);
  assert.match(importLimitError(2_000_001, padded(envelope, 2_000_001)), /2 MB for a journey envelope/);
});

test('draft requests carry the envelope alone and never repeat the saved policy bytes', async t => {
  const calls = service(t, ok(draftValue(1, root('mine', 'unresolved'), root('shared'))), ok(draftValue(2, root('mine', 'unresolved'), root('shared'))),
    ok({ policyBytes: [...policy], intent: { roots: [] }, scope: [] }));
  const client = createAuthoringClient(); client.importBytes(envelope);
  await client.reopen();
  await client.propose({ type: 'remove-root', root: root('mine') });
  await client.compileDraft();
  assert.deepEqual(calls.map(call => call.url), ['/api/authoring-draft-open', '/api/authoring-draft-edit', '/api/authoring-draft-compile']);
  for (const call of calls) assert.equal('policyBytes' in call.body, false, call.url);
});
