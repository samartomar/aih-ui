import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planBatch, readBatch, setContinuation, projectBatch } from './batch.mjs';
import { batchId, batchProblem, batchDerivedProblem, BATCH_RECORD_SCHEMA } from './batch-record.mjs';
import { readJourneyEnvelope, JOURNEY_RECORD_KINDS } from './journey.mjs';
import { digestBytes } from './intake.mjs';
import { stable } from './headless.mjs';
import { createHost } from './host.mjs';
import { createBatchHost } from './batch-host.mjs';
import { batchFixture } from './batch-fixture.mjs';

const encode = value => new TextEncoder().encode(value), decode = bytes => new TextDecoder().decode(bytes);
const scratch = () => mkdtemp(join(tmpdir(), 'ui35-'));
// The pure tests only read the fixture's bytes, so one fixture without applied state serves them all.
let pureFixture;
const pure = () => pureFixture ??= scratch().then(root => batchFixture(root, { applyEarlier: false }));
const valueOf = result => { assert.equal(result.status, 'ok', JSON.stringify(result.diagnostics)); return result.value; };
async function resign(bytes, mutate) {
  const doc = JSON.parse(decode(bytes));
  await mutate(doc);
  const { sha256: _omitted, ...revision } = doc.revision;
  doc.revision.sha256 = await digestBytes(encode(stable({ ...doc, revision })));
  return encode(JSON.stringify(doc, null, 2) + '\n');
}
const recordOf = doc => doc.records.find(r => r.schema === BATCH_RECORD_SCHEMA);

test('a planned batch reopens from the envelope bytes alone and its closed record refuses session state', async () => {
  const f = await pure();
  assert.equal(JOURNEY_RECORD_KINDS[BATCH_RECORD_SCHEMA].kind, 'reviewed-batch');
  const opened = valueOf(await readJourneyEnvelope(f.envelopeBytes)), record = opened.records.find(r => r.schema === BATCH_RECORD_SCHEMA);
  assert.equal(record.required, false);
  assert.deepEqual(record.actions.map(a => a.id), ['b-core', 'b-dependent', 'a-extra', 'b-proc'], 'array order is the reviewed execution order');
  assert.deepEqual(record.checks.map(c => c.kind).sort(), ['conflict', 'conflict', 'core-review', 'core-review', 'core-review', 'core-review', 'shared-input', 'unrelated-state', 'unrelated-state']);
  const read = valueOf(await readBatch({ envelopeBytes: f.envelopeBytes }));
  assert.equal(read.record.id, f.batchId);
  assert.equal(read.projection.id, f.batchId);
  assert.doesNotMatch(JSON.stringify(read.projection), /sessionId|reviewDigest|handle|runId/);
  for (const field of ['sessionId', 'reviewDigest']) {
    const withState = await resign(f.envelopeBytes, doc => { recordOf(doc)[field] = 'x'; });
    const refused = await readJourneyEnvelope(withState);
    assert.equal(refused.status, 'refused', field);
    assert.match(refused.diagnostics[0].path, /^\/records\/\d+$/);
  }
});

test('malformed batch records refuse the envelope', async () => {
  const f = await pure();
  const swap = record => { record.actions = [record.actions[1], record.actions[0], ...record.actions.slice(2)]; };
  const cases = {
    'bad id derivation': { at: '/id', mutate: record => { record.id = `batch-${'0'.repeat(32)}`; }, rederive: false },
    'requires not earlier in order': { at: '/actions/0/requires', mutate: swap },
    'cycle': { at: '/actions/0/requires', mutate: record => { record.actions[0].requires = ['b-dependent']; } },
    'unknown scope': { at: '/actions/0/scope', mutate: record => { record.actions[0].scope = 'scope-z'; } },
    'unknown input': { at: '/actions/0/inputs', mutate: record => { record.actions[0].inputs = ['nope']; } },
    'unused input': { at: '/inputs', mutate: record => { record.inputs.push({ id: 'unused', kind: 'material', sha256: 'a'.repeat(64), byteLength: 1 }); } },
    'unused scope': { at: '/scopes', mutate: record => { record.scopes.push({ id: 'scope-c', role: 'added', client: 'gemini', target: { kind: 'project', root: record.scopes[0].target.root + '-c' } }); } },
    'duplicate root': { at: '/scopes', mutate: record => { record.scopes[1].target.root = record.scopes[0].target.root.toUpperCase(); } },
    'category not selected': { at: '/actions/0/category', mutate: record => { record.actions[0].category = 'content'; } },
    'continuation': { at: '/continuation', mutate: record => { record.continuation = 'carry-on'; } },
    'derived check id': { at: '/checks', mutate: record => { record.checks[0].id = `check-${'1'.repeat(32)}`; }, rederive: false },
    'retain is only true': { at: '/actions/0/retain', mutate: record => { record.actions[0].retain = false; } }
  };
  for (const [name, { at, mutate, rederive = true }] of Object.entries(cases)) {
    // Re-derive the id after the edit so the rule under test, not the id, is what refuses.
    let problem;
    const result = await readJourneyEnvelope(await resign(f.envelopeBytes, async doc => { const record = recordOf(doc); mutate(record); if (rederive) record.id = await batchId(record); problem = batchProblem(record) ?? await batchDerivedProblem(record); }));
    assert.equal(problem, at, `${name}: the rule that refuses`);
    assert.equal(result.status, 'refused', name);
    assert.equal(result.diagnostics[0].code, 'INPUT_INVALID', name);
    assert.match(result.diagnostics[0].path, /^\/records\/\d+/, name);
  }
});

test('planning binds real selections of the saved policy and mirrors Core requires as action requires', async () => {
  const f = await pure(), plan = f.plan;
  const refused = async (mutate, path) => {
    const input = structuredClone(plan); input.savedPolicyBytes = plan.savedPolicyBytes; mutate(input);
    const result = await planBatch(input);
    assert.equal(result.status, 'refused'); assert.equal(result.diagnostics[0].code, 'INPUT_INVALID'); assert.equal(result.diagnostics[0].path, path); return result;
  };
  await refused(input => { input.actions[0].selection.id = 'ghost'; }, '/actions/0/selection');
  await refused(input => { input.actions[0].selection.sha256 = 'b'.repeat(64); }, '/actions/0/selection');
  await refused(input => { input.actions[1].requires = []; }, '/actions/1/requires');
  await refused(input => { input.now = '2026-13-01T00:00:00Z'; }, '/now');
  await refused(input => { input.continuation = 'whatever'; }, '/continuation');
  // Changed policy bytes under an existing envelope are not silently re-bound.
  const other = await planBatch({ ...plan, envelopeBytes: f.envelopeBytes, savedPolicyBytes: encode(decode(plan.savedPolicyBytes).replace('"vibe"', '"vibe" ')) });
  assert.equal(other.status, 'refused'); assert.equal(other.diagnostics[0].code, 'JOURNEY_REFERENCE_MISMATCH');
});

test('the continuation choice is a person edit: a new record replaces the old one and unknown optional records are kept', async () => {
  const f = await pure();
  const edited = valueOf(await setContinuation({ envelopeBytes: f.envelopeBytes, batchId: f.batchId, continuation: 'continue-independent', now: '2026-10-16T09:30:00Z' }));
  assert.notEqual(edited.record.id, f.batchId);
  assert.equal(edited.record.continuation, 'continue-independent');
  const records = valueOf(await readJourneyEnvelope(edited.envelopeBytes)).records.filter(r => r.schema === BATCH_RECORD_SCHEMA);
  assert.deepEqual(records.map(r => r.id), [edited.record.id]);
  assert.equal(valueOf(await readBatch({ envelopeBytes: edited.envelopeBytes })).record.id, edited.record.id);
  assert.equal((await readBatch({ envelopeBytes: edited.envelopeBytes, batchId: f.batchId })).status, 'refused');
  assert.equal(projectBatch(edited.record).continuation, 'continue-independent');
  const noted = await resign(f.envelopeBytes, doc => { doc.records.push({ id: 'note', schema: 'urn:aihq:workbench:journey-record:annotation:1.0.0', required: false, text: 'kept verbatim' }); });
  const kept = valueOf(await setContinuation({ envelopeBytes: noted, batchId: f.batchId, continuation: 'continue-independent', now: '2026-10-16T09:30:00Z' }));
  assert.deepEqual(JSON.parse(decode(kept.envelopeBytes)).records.filter(r => r.id === 'note'), [{ id: 'note', schema: 'urn:aihq:workbench:journey-record:annotation:1.0.0', required: false, text: 'kept verbatim' }]);
});

test('the shipped batch schema is closed and wired into the envelope schema', async t => {
  const read = async name => { for (const base of ['../../schemas/', '../schemas/']) { try { return JSON.parse(await readFile(new URL(`${base}${name}`, import.meta.url), 'utf8')); } catch { /* next layout */ } } };
  const schema = await read('journey-record-reviewed-batch-1.0.0.json'), envelope = await read('journey-envelope-1.0.0.json');
  if (!schema || !envelope) return t.skip('schema files are not present in this consumer layout; tools/write-authoring-schemas.mjs --check verifies them');
  assert.equal(schema.$id, BATCH_RECORD_SCHEMA);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.required.const, false);
  for (const forbidden of ['sessionId', 'reviewDigest', 'handle', 'runId', 'outcome']) assert.equal(forbidden in schema.properties, false, forbidden);
  assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).filter(k => k !== 'supersedes').sort());
  assert.ok(envelope.properties.records.items.allOf.some(entry => entry.if.properties.schema.const === BATCH_RECORD_SCHEMA && entry.then.$ref === BATCH_RECORD_SCHEMA));
});

// ---- Against Core: fixture client homes under a scratch folder; each scenario has its own. Core's Prepare (about 0.6 s per selection) and Apply (about 2.7 s) dominate the time. ----
const NOW = '2026-10-16T09:00:00Z', CONTROLS = { logging: 'off' };
const hostOf = (f, extra = {}) => createBatchHost({ materialRoots: f.materialRoots, controls: CONTROLS, ...extra });
const approve = f => ({ batchId: f.batchId });
// Every file under a folder with its raw bytes, read independently of the host's own snapshot.
async function tree(root, prefix = '', found = new Map()) {
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await tree(root, rel, found); else found.set(rel, await readFile(join(root, rel)));
  }
  return found;
}
const same = (before, after) => before.size === after.size && [...before].every(([path, bytes]) => after.get(path)?.equals(bytes));
const byId = report => Object.fromEntries(report.actions.map(a => [a.id, a]));
const outcomes = report => report.actions.map(a => a.outcome);
// A one-action-per-scope plan (B's b-core and A's a-extra) for the scenarios that need no more: every Core call costs real time.
async function slim(f) {
  const plan = { ...f.plan, actions: f.plan.actions.filter(a => ['b-core', 'a-extra'].includes(a.id)) };
  const planned = valueOf(await planBatch(plan));
  return { envelopeBytes: planned.envelopeBytes, batchId: planned.record.id, plan };
}
const noHandles = value => assert.doesNotMatch(JSON.stringify(value), /sessionId|reviewDigest|prepared handle/);

describe('reviewed batch against Core', () => {
  it('adds B as one reviewed batch, leaves every unrelated A file byte-identical and completes B', async () => {
    const f = await batchFixture(await scratch()), small = await slim(f);
    const host = hostOf(f), before = await tree(f.homes.a), beforeB = await tree(f.homes.b);
    assert.ok(before.has('notes/user.md') && before.has('.claude/user-settings.json') && before.has('.claude/a-earlier.md'), 'A holds a user file and an earlier managed selection');
    const review = await host.reviewBatch(small);
    assert.equal(review.status, 'ok'); assert.equal(review.ready, true); assert.deepEqual(review.conflicts, []);
    assert.deepEqual(review.scopes.map(s => [s.id, s.client, s.listed, s.prepare]), [['scope-a', 'claude', true, 'ready'], ['scope-b', 'codex', true, 'ready']]);
    assert.deepEqual(review.scopes.map(s => s.operations.map(o => [o.action, o.effects])), [[['a-extra', 'create-file']], [['b-core', 'create-file']]]);
    assert.ok(review.scopes.every(s => !('installed' in s) && !('connected' in s)));
    assert.equal(review.checks.length, small.plan.actions.length + small.plan.inputs.length + 2 * small.plan.scopes.length);
    assert.ok(same(before, await tree(f.homes.a)) && same(beforeB, await tree(f.homes.b)), 'a review writes nothing');
    const report = await host.runBatch({ ...small, approve: { batchId: small.batchId } });
    assert.equal(report.status, 'ok', JSON.stringify(report.diagnostics));
    assert.deepEqual(outcomes(report), ['completed', 'completed']);
    assert.deepEqual(report.counts, { completed: 2, failed: 0, untouched: 0, cancelled: 0, unknown: 0 });
    assert.equal(report.atomic, false);
    assert.deepEqual(report.scopes.map(s => s.unrelated.outcome), ['untouched', 'untouched']);
    const after = await tree(f.homes.a);
    for (const [path, bytes] of before) assert.ok(after.get(path)?.equals(bytes), `${path} is byte-identical`);
    assert.deepEqual([...after.keys()].filter(path => !before.has(path)), ['.claude/a-extra.md']);
    assert.equal((await readFile(join(f.homes.b, '.codex', 'b-core.md'), 'utf8')), 'shared bytes');
    noHandles([review, report]);
  });

  it('shows A/B conflicts before apply and applies nothing while any remains', async () => {
    const f = await batchFixture(await scratch(), { conflict: true, applyEarlier: false }), small = await slim(f);
    const host = hostOf(f), before = [await tree(f.homes.a), await tree(f.homes.b)];
    const review = await host.reviewBatch(small);
    assert.equal(review.ready, false);
    assert.deepEqual(review.conflicts.map(c => [c.kind, c.scope, c.action]), [['core-conflict', 'scope-b', 'b-core']]);
    assert.equal(review.checks.find(c => c.kind === 'conflict' && c.subject === 'scope-b').state, 'failed');
    const refused = await host.runBatch({ ...small, approve: { batchId: small.batchId } });
    assert.equal(refused.status, 'refused'); assert.equal(refused.diagnostics[0].code, 'BATCH_CONFLICTS');
    assert.equal((await host.runBatch({ ...small, approve: { batchId: `batch-${'0'.repeat(32)}` } })).diagnostics[0].code, 'BATCH_APPROVAL_REQUIRED');
    assert.ok(same(before[0], await tree(f.homes.a)) && same(before[1], await tree(f.homes.b)), 'nothing was written in either home');
    // Overlapping roots and a client Core does not list are conflicts of their own; so is drifted shared material.
    const nested = join(f.homes.a, 'nested');
    await mkdir(nested);
    const scopes = [small.plan.scopes[0], { ...small.plan.scopes[1], client: 'made-up-client', target: { kind: 'project', root: nested } }];
    const overlap = valueOf(await planBatch({ ...small.plan, savedPolicyBytes: undefined, envelopeBytes: small.envelopeBytes, scopes }));
    const second = await host.reviewBatch({ envelopeBytes: overlap.envelopeBytes, batchId: overlap.record.id });
    const kinds = new Set(second.conflicts.map(c => c.kind));
    for (const kind of ['client-not-listed', 'nested-roots', 'target-in-other-scope']) assert.ok(kinds.has(kind), kind);
    assert.equal(second.scopes[1].listed, false);
    await writeFile(join(f.materialRoot, 'shared.txt'), 'drifted');
    assert.ok((await host.reviewBatch(small)).conflicts.some(c => c.kind === 'shared-input' && c.input === 'shared' && c.reason === 'changed'));
  });

  it('stops a failed action and its dependents and leaves the rest untouched when the batch says stop', async () => {
    const f = await batchFixture(await scratch(), { applyEarlier: false });
    const host = hostOf(f, { faults: { 'b-core': 'stale-target' } }), before = [await tree(f.homes.a), await tree(f.homes.b)];
    const report = await host.runBatch({ envelopeBytes: f.envelopeBytes, batchId: f.batchId, approve: approve(f) });
    assert.equal(report.status, 'ok', JSON.stringify(report.diagnostics));
    assert.deepEqual(outcomes(report), ['failed', 'cancelled', 'untouched', 'untouched']);
    const actions = byId(report);
    assert.equal(actions['b-core'].reason, 'REVIEW_STALE');
    assert.equal(actions['b-core'].core.completion, 'rejected');
    assert.equal(actions['b-core'].core.operations[0].application, 'not-attempted');
    assert.equal(actions['b-dependent'].reason, 'dependency-failed'); assert.equal(actions['b-dependent'].core, undefined);
    assert.deepEqual([actions['a-extra'].reason, actions['b-proc'].reason], ['stopped-by-choice', 'stopped-by-choice']);
    assert.deepEqual(report.counts, { completed: 0, failed: 1, untouched: 2, cancelled: 1, unknown: 0 });
    assert.deepEqual(report.scopes.map(s => s.unrelated.outcome), ['untouched', 'untouched']);
    assert.ok(same(before[0], await tree(f.homes.a)) && same(before[1], await tree(f.homes.b)), 'nothing was written, and the injected fault left nothing behind');
  });

  it('continues independent actions under the allow choice, reports each outcome as observed, then recovers from current state in a new host', async () => {
    const f = await batchFixture(await scratch(), { applyEarlier: false });
    const first = valueOf(await setContinuation({ envelopeBytes: f.envelopeBytes, batchId: f.batchId, continuation: 'continue-independent', now: NOW }));
    const seen = [], capture = id => root => {
      const inner = createHost({ projectRoot: root, materialRoots: f.materialRoots, controls: CONTROLS });
      return { ...inner, prepareSession: async input => { const result = await inner.prepareSession(input); seen.push({ host: id, sessionId: result.sessionId }); return result; } };
    };
    const everything = async () => [await tree(f.homes.a), await tree(f.homes.b)];
    const start = await everything();
    const host = hostOf(f, { faults: { 'b-core': 'stale-target' }, hostFor: capture('first') });
    const report = await host.runBatch({ envelopeBytes: first.envelopeBytes, batchId: first.record.id, approve: { batchId: first.record.id } });
    assert.equal(report.status, 'ok', JSON.stringify(report.diagnostics));
    assert.deepEqual(outcomes(report), ['failed', 'cancelled', 'completed', 'unknown']);
    const actions = byId(report);
    assert.equal(actions['b-proc'].reason, 'exit-code');
    assert.equal(actions['b-proc'].core.completion, 'incomplete'); assert.equal(actions['b-proc'].core.operations[0].effectsUncertain, true);
    assert.equal(actions['a-extra'].core.completion, 'complete');
    assert.deepEqual(report.counts, { completed: 1, failed: 1, untouched: 0, cancelled: 1, unknown: 1 });
    assert.deepEqual(report.scopes.map(s => s.unrelated.outcome), ['untouched', 'untouched']);
    // The person edits a file a completed action wrote, and the process can now succeed.
    const edited = join(f.homes.a, '.claude', 'a-extra.md');
    await writeFile(edited, 'edited by the person\n');
    await writeFile(f.procMarker, 'ok');
    const sessions = seen.filter(s => s.host === 'first').map(s => s.sessionId);
    // A new host instance, from the envelope bytes alone. It is not trusted with the report: a lying outcome changes nothing.
    const reopened = hostOf(f, { hostFor: capture('second') });
    const lying = { ...report, actions: report.actions.map(a => ({ ...a, outcome: 'completed' })) };
    const recovered = await reopened.recoverBatch({ envelopeBytes: first.envelopeBytes, batchId: first.record.id, outcome: lying, now: '2026-10-16T10:00:00Z' });
    assert.equal(recovered.status, 'ok', JSON.stringify(recovered.diagnostics));
    assert.equal(recovered.record.supersedes, first.record.id);
    assert.deepEqual(recovered.record.actions.map(a => [a.id, a.retain === true]), [['b-core', false], ['b-dependent', false], ['a-extra', true], ['b-proc', false]]);
    assert.deepEqual(recovered.record.inputs, first.record.inputs, 'the shared input a retained selection still uses stays declared');
    assert.deepEqual(recovered.record.actions[2].inputs, ['shared']);
    assert.equal(recovered.review.ready, true);
    assert.deepEqual(recovered.review.scopes.flatMap(s => s.operations.map(o => o.action)).sort(), ['b-core', 'b-dependent', 'b-proc']);
    assert.deepEqual(recovered.review.scopes[0].retained, ['a-extra']);
    const read = valueOf(await readBatch({ envelopeBytes: recovered.envelopeBytes }));
    assert.equal(read.record.id, recovered.record.id); assert.equal(read.current, true);
    assert.deepEqual(read.batches.map(b => [b.id, b.current]), [[first.record.id, false], [recovered.record.id, true]]);
    // A fresh run (no fault) completes the remaining actions and keeps earlier effects and the edit.
    const again = await reopened.runBatch({ envelopeBytes: recovered.envelopeBytes, batchId: recovered.record.id, approve: { batchId: recovered.record.id } });
    assert.equal(again.status, 'ok', JSON.stringify(again.diagnostics));
    assert.deepEqual(outcomes(again), ['completed', 'completed', 'untouched', 'completed']);
    assert.equal(byId(again)['a-extra'].reason, 'retained-earlier-result');
    assert.deepEqual(again.counts, { completed: 3, failed: 0, untouched: 1, cancelled: 0, unknown: 0 });
    assert.equal(await readFile(edited, 'utf8'), 'edited by the person\n');
    const [a, b] = await everything();
    for (const [path, bytes] of start[0]) if (path !== '.claude/a-extra.md') assert.ok(a.get(path)?.equals(bytes), `${path} survived`);
    assert.equal(b.get('.codex/b-core.md').toString(), 'shared bytes'); assert.equal(b.get('.codex/b-dependent.md').toString(), 'shared bytes');
    // Reopening replayed nothing: every Prepare was fresh, no handle is stored or returned, and an old session is lost on a new host.
    const earlier = new Set(report.actions.flatMap(x => x.core?.runId ?? [])), later = again.actions.flatMap(x => x.core?.runId ?? []);
    assert.ok(later.length === 3 && later.every(id => !earlier.has(id)), 'a run after reopening has its own Core run ids');
    const second = seen.filter(s => s.host === 'second').map(s => s.sessionId);
    assert.ok(second.length > 0 && second.every(id => !sessions.includes(id)));
    const lost = await createHost({ projectRoot: f.homes.b, controls: CONTROLS }).applyApproved({ sessionId: sessions[0], reviewDigest: 'a'.repeat(64) });
    assert.equal(lost.status, 'lost');
    noHandles([report, recovered, again]);
  });
});
