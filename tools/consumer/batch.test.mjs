import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { planBatch, readBatch, setContinuation, projectBatch } from './batch.mjs';
import { batchId, batchProblem, batchDerivedProblem, BATCH_RECORD_SCHEMA } from './batch-record.mjs';
import { readJourneyEnvelope, JOURNEY_RECORD_KINDS } from './journey.mjs';
import { digestBytes } from './intake.mjs';
import { stable } from './headless.mjs';
import { createHost } from './host.mjs';
import { createBatchHost } from './batch-host.mjs';
import { batchFixture } from './batch-fixture.mjs';
import { homeEnvironment } from './home-environment.mjs';
import { replaceEnvelope, revisionOf } from './envelope-file.mjs';

// Core keeps ownership records, recovery manifests, snapshots and run history under the current account's `~/.aih/core`, even
// with logging off. It resolves the account home with os.homedir() whenever it is used (not at import), so pointing this
// test process (node --test gives each file its own) at a disposable home before the first Core call keeps every record here.
const FIXTURE_HOME = mkdtempSync(join(tmpdir(), 'ui35-home-'));
Object.assign(process.env, homeEnvironment(FIXTURE_HOME));

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
    'duplicate root': { at: '/scopes', mutate: record => { record.scopes[1].target.root = record.scopes[0].target.root; } },
    // Drive and UNC roots compare case-insensitively; POSIX roots are case-sensitive, so only a drive root is tested this way.
    'duplicate drive root in another case': { at: '/scopes', mutate: record => { record.scopes[0].target.root = 'C:/work/batch-a'; record.scopes[1].target.root = 'c:\\WORK\\batch-a\\'; } },
    'category not selected': { at: '/actions/0/category', mutate: record => { record.actions[0].category = 'content'; } },
    'continuation': { at: '/continuation', mutate: record => { record.continuation = 'carry-on'; } },
    'derived check id': { at: '/checks', mutate: record => { record.checks[0].id = `check-${'1'.repeat(32)}`; }, rederive: false },
    'retain is only true': { at: '/actions/0/retain', mutate: record => { record.actions[0].retain = false; } },
    'control character in a client': { at: '/scopes', mutate: record => { record.scopes[0].client = 'claude'; } },
    'control character in a root': { at: '/scopes', mutate: record => { record.scopes[0].target.root += ''; } }
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

test('planning refuses a selection whose Core requires no action of the batch covers', async () => {
  const f = await pure(), plan = f.plan;
  // b-dependent needs b-core in Core's policy; with b-core gone from the batch the host would run it without its prerequisite.
  const uncovered = await planBatch({ ...plan, actions: plan.actions.filter(a => a.id !== 'b-core').map(a => a.id === 'b-dependent' ? { ...a, requires: [] } : a) });
  assert.equal(uncovered.status, 'refused'); assert.equal(uncovered.diagnostics[0].code, 'INPUT_INVALID');
  assert.equal(uncovered.diagnostics[0].path, '/actions/0/requires'); assert.match(uncovered.diagnostics[0].message, /b-core/);
  // A prerequisite in another scope is not the prerequisite: each scope is prepared and applied on its own.
  const elsewhere = await planBatch({ ...plan, actions: plan.actions.map(a => a.id === 'b-core' ? { ...a, scope: 'scope-a' } : a) });
  assert.equal(elsewhere.status, 'refused'); assert.equal(elsewhere.diagnostics[0].path, '/actions/1/requires');
});

test('planning binds shared inputs to exactly the material sources the recipe of the selection uses', async () => {
  const f = await pure(), plan = f.plan;
  const refused = async (input, path) => { const result = await planBatch(input); assert.equal(result.status, 'refused'); assert.equal(result.diagnostics[0].code, 'INPUT_INVALID'); assert.equal(result.diagnostics[0].path, path); return result; };
  await refused({ ...plan, actions: plan.actions.map(a => a.id === 'b-core' ? { ...a, inputs: [] } : a) }, '/actions/0/inputs');
  await refused({ ...plan, actions: plan.actions.map(a => a.id === 'b-proc' ? { ...a, inputs: ['shared'] } : a) }, '/actions/3/inputs');
  // A selection whose recipe cannot be inspected through its declared fields is unsupported in a batch, not assumed to need nothing.
  const edited = async (id, change) => {
    const policy = JSON.parse(decode(plan.savedPolicyBytes)), selection = policy.selections.find(s => s.id === id);
    change(selection);
    const sha256 = await digestBytes(encode(stable(selection)));
    return { ...plan, savedPolicyBytes: encode(JSON.stringify(policy)), actions: plan.actions.map(a => a.selection.id === id ? { ...a, selection: { id, sha256 } } : a) };
  };
  await refused(await edited('b-proc', selection => { selection.recipe = { reference: 'elsewhere' }; }), '/actions/3/selection');
  await refused(await edited('b-core', selection => { selection.recipe.inline.materials = selection.recipe.inline.materials.map(({ source: _source, ...material }) => material); }), '/actions/0/selection');
  // An archive material is pinned by its own digest in the selection, so it needs no shared input.
  const archived = await edited('a-extra', selection => { selection.recipe.inline.materials[0].source = { kind: 'archive', url: 'https://example.invalid/shared.tgz', sha256: 'c'.repeat(64), byteLength: 12 }; });
  valueOf(await planBatch({ ...archived, actions: archived.actions.map(a => a.id === 'a-extra' ? { ...a, inputs: [] } : a) }));
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
  for (const [name, pattern, good] of [['client', schema.properties.scopes.items.properties.client.pattern, 'claude'], ['root', schema.properties.scopes.items.properties.target.properties.root.pattern, 'C:\\work\\a']]) {
    assert.ok(new RegExp(pattern).test(good), name);
    for (const bad of ['\x00', '\x1f', '\x7f']) assert.equal(new RegExp(pattern).test(good + bad), false, `${name} refuses U+${bad.charCodeAt(0).toString(16)}`);
  }
  assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).filter(k => k !== 'supersedes').sort());
  assert.ok(envelope.properties.records.items.allOf.some(entry => entry.if.properties.schema.const === BATCH_RECORD_SCHEMA && entry.then.$ref === BATCH_RECORD_SCHEMA));
});

test('an unsupported required record keeps the batch readable but never runnable or recoverable', async () => {
  const f = await pure();
  const future = await resign(f.envelopeBytes, doc => { doc.records.push({ id: 'future', schema: 'urn:aihq:workbench:journey-record:future:1.0.0', required: true }); });
  const read = await readBatch({ envelopeBytes: future });
  assert.equal(read.status, 'ok'); assert.equal(read.value.supported, false);
  assert.deepEqual(read.diagnostics.map(d => [d.code, d.path]), [['JOURNEY_RECORD_UNSUPPORTED', '/records/1']]);
  assert.equal(valueOf(await readBatch({ envelopeBytes: f.envelopeBytes })).supported, true);
  // A host whose Prepare is always clean, so only the unsupported record can stop the review, and any Prepare after a refusal shows.
  let prepares = 0;
  const host = createBatchHost({ materialRoots: f.materialRoots, hostFor: () => ({ prepareSession: async () => { prepares++; return { status: 'ready', diagnostics: [], review: { operations: [] } }; } }) });
  for (const [name, call] of [['run', () => host.runBatch({ envelopeBytes: future, batchId: f.batchId, approve: { batchId: f.batchId } })], ['recover', () => host.recoverBatch({ envelopeBytes: future, batchId: f.batchId, now: NOW })]]) {
    const refused = await call();
    assert.equal(refused.status, 'refused', name); assert.equal(refused.diagnostics[0].code, 'JOURNEY_RECORD_UNSUPPORTED', name);
    assert.deepEqual(refused.originalBytes, future, `${name} keeps the original bytes`);
  }
  assert.equal(prepares, 0, 'a refusal prepares nothing');
  const review = await host.reviewBatch({ envelopeBytes: future, batchId: f.batchId });
  assert.equal(review.status, 'ok'); assert.equal(review.ready, false);
  assert.deepEqual(review.diagnostics.map(d => d.code), ['JOURNEY_RECORD_UNSUPPORTED']);
  assert.ok(prepares > 0 && review.conflicts.length === 0, 'the review still inspects read-only and finds no conflict of its own');
  const clean = await host.reviewBatch({ envelopeBytes: f.envelopeBytes, batchId: f.batchId });
  assert.equal(clean.ready, true); assert.deepEqual(clean.diagnostics, []);
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
  it('keeps every Core record inside the disposable account home', async () => {
    assert.equal(homedir().toLowerCase(), FIXTURE_HOME.toLowerCase());
    const f = await batchFixture(await scratch(), { applyEarlier: false }), small = await slim(f);
    const report = await hostOf(f).runBatch({ ...small, approve: { batchId: small.batchId } });
    assert.equal(report.status, 'ok', JSON.stringify(report.diagnostics));
    const core = await readdir(join(FIXTURE_HOME, '.aih', 'core'));
    assert.ok(core.length > 0, `Core wrote its records under the fixture home: ${core.join(', ')}`);
  });

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
    const host = hostOf(f, { faults: { 'b-core': 'stale-target' }, hostFor: capture('first') }), saved = [];
    const report = await host.runBatch({ envelopeBytes: first.envelopeBytes, batchId: first.record.id, approve: { batchId: first.record.id }, persist: async bytes => { saved.push(bytes); }, now: NOW });
    assert.equal(report.status, 'ok', JSON.stringify(report.diagnostics));
    assert.deepEqual(outcomes(report), ['failed', 'cancelled', 'completed', 'unknown']);
    // Running the opaque process spent its consent first: the saved record now keeps it, and the report names that record.
    assert.equal(saved.length, 1);
    const spent = valueOf(await readBatch({ envelopeBytes: saved[0] }));
    assert.equal(report.consumedBy, spent.record.id); assert.equal(spent.record.supersedes, first.record.id); assert.equal(spent.current, true);
    assert.deepEqual(spent.record.actions.map(a => [a.id, a.retain === true]), [['b-core', false], ['b-dependent', false], ['a-extra', false], ['b-proc', true]]);
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
    // Recovery takes no Run again choice (it is made when the batch is applied), so a caller that still sends one fails loudly.
    const stale = await reopened.recoverBatch({ envelopeBytes: saved[0], batchId: spent.record.id, rerun: ['b-proc'], now: '2026-10-16T10:00:00Z' });
    assert.equal(stale.status, 'refused'); assert.equal(stale.diagnostics[0].code, 'INPUT_INVALID'); assert.equal(stale.diagnostics[0].path, '/rerun');
    // b-proc is an opaque process Core cannot show as done, so recovery keeps it, whatever the report said.
    const recovered = await reopened.recoverBatch({ envelopeBytes: saved[0], batchId: spent.record.id, outcome: lying, now: '2026-10-16T10:00:00Z' });
    assert.equal(recovered.status, 'ok', JSON.stringify(recovered.diagnostics));
    assert.equal(recovered.record.supersedes, spent.record.id);
    assert.deepEqual(recovered.record.actions.map(a => [a.id, a.retain === true]), [['b-core', false], ['b-dependent', false], ['a-extra', true], ['b-proc', true]]);
    assert.deepEqual(recovered.record.inputs, first.record.inputs, 'the shared input a retained selection still uses stays declared');
    assert.deepEqual(recovered.record.actions[2].inputs, ['shared']);
    assert.equal(recovered.review.ready, true);
    assert.deepEqual(recovered.review.scopes.flatMap(s => s.operations.map(o => o.action)).sort(), ['b-core', 'b-dependent']);
    assert.deepEqual(recovered.review.scopes.map(s => s.retained), [['a-extra'], ['b-proc']]);
    const read = valueOf(await readBatch({ envelopeBytes: recovered.envelopeBytes }));
    assert.equal(read.record.id, recovered.record.id); assert.equal(read.current, true);
    assert.deepEqual(read.batches.map(b => [b.id, b.current]), [[first.record.id, false], [spent.record.id, false], [recovered.record.id, true]]);
    // A fresh run (no fault) that names b-proc in `rerun` completes the remaining actions and keeps earlier effects and the edit.
    // The record already keeps the process, so the choice spends nothing and is not saved anywhere.
    const again = await reopened.runBatch({ envelopeBytes: recovered.envelopeBytes, batchId: recovered.record.id, approve: { batchId: recovered.record.id }, rerun: ['b-proc'], persist: async bytes => { saved.push(bytes); }, now: NOW });
    assert.equal(again.status, 'ok', JSON.stringify(again.diagnostics));
    assert.equal(saved.length, 1); assert.equal(again.consumedBy, undefined);
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

  it('recovery keeps an unverifiable process, and its dependents wait for it', async () => {
    const f = await batchFixture(await scratch(), { applyEarlier: false });
    const chain = valueOf(await planBatch({ ...f.plan, scopes: [f.plan.scopes[1]], inputs: [], actions: [f.action('b-proc', 'scope-b', 'b-proc'), f.action('b-after-proc', 'scope-b', 'b-after-proc', ['b-proc'])] }));
    assert.deepEqual(chain.projection.actions.map(a => [a.id, a.unverifiable]), [['b-proc', true], ['b-after-proc', false]]);
    const host = hostOf(f), before = await tree(f.homes.b);
    const recovered = await host.recoverBatch({ envelopeBytes: chain.envelopeBytes, batchId: chain.record.id, now: NOW });
    assert.equal(recovered.status, 'ok', JSON.stringify(recovered.diagnostics));
    assert.deepEqual(recovered.record.actions.map(a => [a.id, a.retain === true]), [['b-proc', true], ['b-after-proc', false]]);
    assert.deepEqual(recovered.retained, ['b-proc']);
    assert.deepEqual(recovered.review.scopes[0].operations.map(o => o.action), ['b-after-proc']);
    assert.ok(same(before, await tree(f.homes.b)), 'recovery applies nothing');
    const report = await host.runBatch({ envelopeBytes: recovered.envelopeBytes, batchId: recovered.record.id, approve: { batchId: recovered.record.id } });
    assert.equal(report.status, 'ok', JSON.stringify(report.diagnostics));
    assert.deepEqual(outcomes(report), ['untouched', 'cancelled']);
    assert.deepEqual(report.actions.map(a => a.reason), ['retained-unverifiable', 'dependency-unverifiable']);
    assert.ok(same(before, await tree(f.homes.b)), 'neither the process nor its dependent ran');
  });

  // ---- Consent to run an opaque process: spent once against the stored batch, and a Run again choice lasts one call. ----
  const processOnly = async f => valueOf(await planBatch({ ...f.plan, scopes: [f.plan.scopes[1]], inputs: [], actions: [f.action('b-proc', 'scope-b', 'b-proc')] }));
  const run = (host, envelopeBytes, record, extra = {}) => host.runBatch({ envelopeBytes, batchId: record.id, approve: { batchId: record.id }, now: NOW, ...extra });
  const recordIn = async bytes => valueOf(await readBatch({ envelopeBytes: bytes })).record;
  // A tiny store holding the one envelope, with the contract `persist` documents: refuse unless the stored revision is the expected one.
  const storeOf = held => {
    const calls = [];
    return { calls, bytes: () => held, persist: async (next, { expectedRevisionSha256 } = {}) => {
      calls.push(expectedRevisionSha256);
      if (typeof expectedRevisionSha256 !== 'string') throw new TypeError('Name the revision digest the stored envelope must have.');
      if (revisionOf(held) !== expectedRevisionSha256) throw Object.assign(new Error('The stored batch changed.'), { code: 'BATCH_ENVELOPE_CHANGED' });
      held = next;
    } };
  };

  it('spends the consent to run an opaque process once, against the stored batch, and a Run again choice lasts one run', async () => {
    const f = await batchFixture(await scratch(), { applyEarlier: false });
    await writeFile(f.procMarker, 'ok');
    const planned = await processOnly(f), store = storeOf(planned.envelopeBytes);
    const report = await run(hostOf(f), planned.envelopeBytes, planned.record, { persist: store.persist });
    assert.equal(report.status, 'ok', JSON.stringify(report.diagnostics));
    assert.deepEqual(outcomes(report), ['completed']);
    assert.equal(await f.procCount(), 1);
    const stored = store.bytes(), spent = valueOf(await readBatch({ envelopeBytes: stored }));
    assert.equal(report.consumedBy, spent.record.id); assert.equal(spent.record.supersedes, planned.record.id); assert.equal(spent.current, true);
    assert.deepEqual(spent.record.actions.map(a => [a.id, a.retain === true]), [['b-proc', true]]);
    // Replay: the original bytes and approval, after the spend. The stored batch is newer, so the store refuses and nothing runs.
    const replay = await run(hostOf(f), planned.envelopeBytes, planned.record, { persist: store.persist });
    assert.deepEqual(replay.actions.map(a => [a.outcome, a.reason]), [['failed', 'consent-not-recorded']]);
    assert.equal(await f.procCount(), 1, 'the spent consent was not reused'); assert.equal(replay.consumedBy, undefined);
    assert.equal(store.bytes(), stored, 'the refused spend changed nothing');
    assert.deepEqual(store.calls, [revisionOf(planned.envelopeBytes), revisionOf(planned.envelopeBytes)], 'every spend names the revision its run started from');
    // Reload: a new host that has only the stored bytes. Applying does not run the process again, and the old record is superseded.
    const reloaded = hostOf(f);
    const review = await reloaded.reviewBatch({ envelopeBytes: stored });
    assert.equal(review.batchId, spent.record.id); assert.equal(review.ready, true); assert.deepEqual(review.scopes[0].retained, ['b-proc']);
    const plain = await run(reloaded, stored, spent.record, { persist: store.persist });
    assert.deepEqual(plain.actions.map(a => [a.outcome, a.reason]), [['untouched', 'retained-unverifiable']]);
    assert.equal(plain.consumedBy, undefined); assert.equal(await f.procCount(), 1, 'the process did not run again');
    assert.equal((await run(reloaded, stored, planned.record, { persist: store.persist })).diagnostics[0].code, 'BATCH_SUPERSEDED');
    // A Run again choice is an argument of one call: the review shows what it would run, the run does it once, and nothing is saved.
    const reviewed = await reloaded.reviewBatch({ envelopeBytes: stored, rerun: ['b-proc'] });
    assert.deepEqual([reviewed.ready, reviewed.scopes[0].operations.map(o => o.action), reviewed.scopes[0].retained], [true, ['b-proc'], []]);
    const chosen = await run(reloaded, stored, spent.record, { persist: store.persist, rerun: ['b-proc'] });
    assert.deepEqual(chosen.actions.map(a => [a.outcome, a.reason]), [['completed', null]]);
    assert.equal(chosen.consumedBy, undefined); assert.equal(await f.procCount(), 2);
    assert.equal(store.calls.length, 2, 'nothing more was persisted'); assert.equal(store.bytes(), stored);
    const after = await run(reloaded, store.bytes(), spent.record, { persist: store.persist });
    assert.deepEqual(after.actions.map(a => [a.outcome, a.reason]), [['untouched', 'retained-unverifiable']]);
    assert.equal(await f.procCount(), 2, 'the choice did not outlast its run');
  });

  it('refuses a Run again choice that names anything but a kept opaque action, before anything runs', async () => {
    const f = await pure(), host = hostOf(f);
    const kept = valueOf(await planBatch({ ...f.plan, actions: f.plan.actions.map(a => ['a-extra', 'b-proc'].includes(a.id) ? { ...a, retain: true } : a) }));
    const refusals = [['not kept yet', f.envelopeBytes, f.batchId, ['b-proc'], 0], ['verifiable, not kept', f.envelopeBytes, f.batchId, ['b-core'], 0], ['no such action', f.envelopeBytes, f.batchId, ['ghost'], 0],
      ['verifiable, kept', kept.envelopeBytes, kept.record.id, ['a-extra'], 0], ['one good name does not excuse a bad one', kept.envelopeBytes, kept.record.id, ['b-proc', 'a-extra'], 1]];
    for (const [name, envelopeBytes, batchId, rerun, index] of refusals) {
      const refused = await host.runBatch({ envelopeBytes, batchId, approve: { batchId }, rerun, now: NOW, persist: async () => assert.fail('nothing is spent') });
      assert.equal(refused.status, 'refused', name); assert.equal(refused.diagnostics[0].code, 'BATCH_RERUN_REFUSED', name); assert.equal(refused.diagnostics[0].path, `/rerun/${index}`, name);
    }
    const malformed = await host.runBatch({ envelopeBytes: kept.envelopeBytes, batchId: kept.record.id, approve: { batchId: kept.record.id }, rerun: 'b-proc' });
    assert.equal(malformed.diagnostics[0].code, 'INPUT_INVALID'); assert.equal(malformed.diagnostics[0].path, '/rerun');
  });

  it('replaces the envelope file only while its stored revision is the expected one', async () => {
    const f = await pure(), root = await scratch(), path = join(root, 'envelope.json');
    const edited = valueOf(await setContinuation({ envelopeBytes: f.envelopeBytes, batchId: f.batchId, continuation: 'continue-independent', now: NOW }));
    await writeFile(path, edited.envelopeBytes);
    await assert.rejects(replaceEnvelope(path, f.envelopeBytes, { expectedRevisionSha256: revisionOf(f.envelopeBytes) }), { code: 'BATCH_ENVELOPE_CHANGED' });
    assert.deepEqual(new Uint8Array(await readFile(path)), edited.envelopeBytes, 'a stale writer left the file as it was');
    await writeFile(`${path}.lock`, '');
    await assert.rejects(replaceEnvelope(path, f.envelopeBytes, { expectedRevisionSha256: revisionOf(edited.envelopeBytes) }), { code: 'BATCH_ENVELOPE_BUSY' });
    assert.deepEqual(new Uint8Array(await readFile(path)), edited.envelopeBytes, 'a held lock stops the write');
    await rm(`${path}.lock`);
    await replaceEnvelope(path, f.envelopeBytes, { expectedRevisionSha256: revisionOf(edited.envelopeBytes) });
    assert.deepEqual(new Uint8Array(await readFile(path)), f.envelopeBytes);
    assert.deepEqual((await readdir(root)).sort(), ['envelope.json'], 'no lock or temporary file is left behind');
  });

  it('does not run an opaque process whose consent could not be recorded, and holds its dependents', async () => {
    const f = await batchFixture(await scratch(), { applyEarlier: false });
    await writeFile(f.procMarker, 'ok');
    const chain = valueOf(await planBatch({ ...f.plan, scopes: [f.plan.scopes[1]], inputs: [], actions: [f.action('b-proc', 'scope-b', 'b-proc'), f.action('b-after-proc', 'scope-b', 'b-after-proc', ['b-proc'])] }));
    const before = await tree(f.homes.b);
    for (const [name, extra] of [['persist throws', { persist: async () => { throw new Error('disk full'); } }], ['no persist callback', {}]]) {
      const report = await run(hostOf(f), chain.envelopeBytes, chain.record, extra);
      assert.equal(report.status, 'ok', JSON.stringify(report.diagnostics));
      assert.deepEqual(report.actions.map(a => [a.id, a.outcome, a.reason]), [['b-proc', 'failed', 'consent-not-recorded'], ['b-after-proc', 'cancelled', 'dependency-failed']], name);
      assert.equal(report.consumedBy, undefined, name);
      assert.deepEqual([report.actions[0].core.runId, report.actions[0].core.diagnostics.map(d => d.code)], [null, ['BATCH_CONSENT_UNRECORDABLE']], `${name}: nothing was applied, and why`);
      assert.equal(await f.procCount(), 0, `${name}: the process did not run`);
    }
    assert.ok(same(before, await tree(f.homes.b)), 'neither the process nor its dependent wrote anything');
  });

  it('spends each opaque process its own consent in turn, as a chain of superseding records', async () => {
    const f = await batchFixture(await scratch(), { applyEarlier: false });
    await writeFile(f.procMarker, 'ok');
    const policy = JSON.parse(decode(f.savedPolicyBytes)), original = policy.selections.find(s => s.id === 'b-proc');
    const other = { ...structuredClone(original), id: 'b-proc-two', managementId: 'b-proc-two' }; other.recipe.inline.id = 'b-proc-two';
    policy.selections.push(other);
    const action = async selection => ({ id: selection.id, scope: 'scope-b', category: 'client', selection: { id: selection.id, sha256: await digestBytes(encode(stable(selection))) }, inputs: [], requires: [] });
    const planned = valueOf(await planBatch({ ...f.plan, savedPolicyBytes: encode(JSON.stringify(policy)), scopes: [f.plan.scopes[1]], inputs: [], actions: [await action(original), await action(other)] }));
    const saved = [], expected = [], report = await run(hostOf(f), planned.envelopeBytes, planned.record, { persist: async (bytes, { expectedRevisionSha256 }) => { saved.push(bytes); expected.push(expectedRevisionSha256); } });
    assert.equal(report.status, 'ok', JSON.stringify(report.diagnostics));
    assert.deepEqual(outcomes(report), ['completed', 'completed']);
    assert.deepEqual(expected, [revisionOf(planned.envelopeBytes), revisionOf(saved[0])], 'each spend expects the revision the previous write made');
    assert.equal(await f.procCount(), 2); assert.equal(saved.length, 2);
    const [one, two] = await Promise.all(saved.map(recordIn));
    assert.deepEqual([one.supersedes, two.supersedes], [planned.record.id, one.id]);
    assert.deepEqual(one.actions.map(a => a.retain === true), [true, false]); assert.deepEqual(two.actions.map(a => a.retain === true), [true, true]);
    assert.equal(report.consumedBy, two.id);
    assert.deepEqual(valueOf(await readBatch({ envelopeBytes: saved[1] })).batches.map(b => [b.id, b.current]), [[planned.record.id, false], [one.id, false], [two.id, true]]);
  });

  it('a retained result that no longer stands is a failure that stops the batch', async () => {
    const f = await batchFixture(await scratch(), { applyEarlier: false });
    const planned = valueOf(await planBatch({ ...f.plan, actions: [{ ...f.action('a-extra', 'scope-a', 'a-extra', [], ['shared']), retain: true }, f.action('b-core', 'scope-b', 'b-core', [], ['shared'])] }));
    const before = await tree(f.homes.b);
    const report = await hostOf(f).runBatch({ envelopeBytes: planned.envelopeBytes, batchId: planned.record.id, approve: { batchId: planned.record.id } });
    assert.equal(report.status, 'ok', JSON.stringify(report.diagnostics));
    assert.deepEqual(outcomes(report), ['failed', 'untouched']);
    assert.deepEqual(report.actions.map(a => a.reason), ['retained-result-missing', 'stopped-by-choice']);
    assert.deepEqual(report.counts, { completed: 0, failed: 1, untouched: 1, cancelled: 0, unknown: 0 });
    assert.ok(same(before, await tree(f.homes.b)), 'the stopped action wrote nothing');
  });
});
