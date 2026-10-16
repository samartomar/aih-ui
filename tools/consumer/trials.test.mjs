import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInstalledRelease } from '@aihq/catalog/node';
import { validateClaimSet } from '@aihq/core/report';
import { freshAuthoring, composeAuthoring, openDraft, editDraft, stable } from './headless.mjs';
import * as publicApi from './trials.mjs';
import { recordTrial, proposeTrial, readTrials, evaluateTrial, TRIAL_SCHEMA, TRIAL_MECHANISMS_NONE } from './trials.mjs';
import { readJourneyEnvelope, writeJourneyEnvelope, JOURNEY_RECORD_KINDS, DRAFT_RECORD_SCHEMA } from './journey.mjs';
import { checkImprovements, recordImprovement, IMPROVEMENT_SUGGESTION_SCHEMA, IMPROVEMENT_DISMISSAL_SCHEMA } from './improvements.mjs';
import { editWorkspace, exportWorkspace } from './workspace.mjs';
import { digestBytes } from './intake.mjs';
import { createMixedService } from './mixed-service.mjs';
import { TRIAL_RECORD_SCHEMA, trialProblem, trialId, trialRevision } from './trial-record.mjs';
import { suggestionRevision } from './improvement-record.mjs';
const encode = value => new TextEncoder().encode(value), decode = bytes => new TextDecoder().decode(bytes);
const valueOf = result => { assert.equal(result.status, 'ok', JSON.stringify(result.diagnostics)); return result.value; };
// A distinct instant per step, so every proposal has its own identity.
const at = n => new Date(Date.UTC(2026, 9, 16, 9, 0, n)).toISOString().replace('.000Z', 'Z');

// ---- Fixture: a draft with two unrelated choices and two suggestions from the installed maintained Catalog ---------------
let installedPromise;
const installed = () => installedPromise ??= readInstalledRelease({ root: dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'))), sourceInput: 'maintained' });
const withoutDisplay = ({ label: _label, description: _description, prompt: _prompt, dismissal: _dismissal, promotion: _promotion, client: _client, ...fields }) => fields;
async function scenario() {
  const found = await installed();
  assert.equal(found.valid, true, JSON.stringify(found.diagnostics));
  const maintained = { release: found.release, materialSource: found.source }, inventories = [maintained], intent = freshAuthoring();
  intent.roots = ['mattpocock.implement', 'aihq.project-context'].map(itemId => ({ releaseSha256: maintained.release.sha256, itemId, itemSha256: maintained.release.items.find(i => i.id === itemId).itemSha256,
    scope: 'project', configuration: {}, originIds: ['direct'] }));
  const base = valueOf(await composeAuthoring({ intent: freshAuthoring(), inventories }));
  const composed = valueOf(await composeAuthoring({ basePolicyBytes: base.policyBytes, intent, inventories }));
  const open = valueOf(await openDraft({ bytes: composed.policyBytes, inventories }));
  // An unrelated skip in the draft, so "nothing else changed" has an exclusion to hold.
  const skipped = valueOf(await editDraft({ envelopeBytes: open.envelopeBytes, inventories, operation: { type: 'skip', exclusion: { originId: 'direct', releaseSha256: maintained.release.sha256, itemId: 'mattpocock.wait-what', scope: 'project' } } }));
  const checked = valueOf(await checkImprovements({ envelopeBytes: skipped.envelopeBytes, inventories, goal: 'add tests to my app', clients: ['claude'], now: at(0) }));
  const all = [checked.leading, ...checked.alternatives];
  const tdd = all.find(s => s.change.itemId === 'mattpocock.tdd'), claude = all.find(s => s.change.itemId === 'aihq.client.claude');
  assert.ok(tdd && claude, all.map(s => s.change.itemId).join());
  return { maintained, inventories, policyBytes: composed.policyBytes, envelopeBytes: skipped.envelopeBytes, tdd: withoutDisplay(tdd), claude: withoutDisplay(claude) };
}
let scenarioPromise;
const shared = () => scenarioPromise ??= scenario();
const proposal = (s, extra = {}) => ({ type: 'propose', suggestion: s.tdd, scope: 'project', task: 'Add tests to a small module.',
  quality: { outcome: 'The new tests catch a seeded regression.', checks: [{ id: 'catches-regression', text: 'A seeded regression fails a test.' }, { id: 'stays-green', text: 'The tests pass on the unchanged module.' }] },
  conditions: 'Same task, same client, same repository state.', bounds: [{ id: 'context', label: 'Context budget', unit: 'tokens', value: 20000, enforcement: { kind: 'advisory' } }],
  unknowns: ['Model spending: no cost source is connected.'], ...extra });
const revision = s => { const { type: _type, suggestion: _suggestion, ...fields } = proposal(s); return fields; };
let clock = 1;
const tick = () => at(clock++);
const record = async (s, bytes, operation, options = {}) => valueOf(await recordTrial({ envelopeBytes: bytes, operation, inventories: s.inventories, now: tick(), ...options }));
const refused = async (s, bytes, operation, options = {}) => {
  const result = await recordTrial({ envelopeBytes: bytes, operation, inventories: s.inventories, now: tick(), ...options });
  assert.equal(result.status, 'refused', JSON.stringify(operation));
  assert.deepEqual(result.originalBytes, bytes, 'the original bytes are preserved');
  return result.diagnostics[0];
};
const proposed = async (s, extra = {}, bytes = s.envelopeBytes) => { const r = await record(s, bytes, proposal(s, extra)); return { ...r, id: r.record.id }; };
const started = async (s, extra = {}) => { const p = await proposed(s, extra); const r = await record(s, p.envelopeBytes, { type: 'start', id: p.id }); return { ...r, id: p.id }; };
const outcome = (id, option, checkId, amount) => ({ type: 'observe', id, observation: { option, target: { check: checkId }, kind: 'measured', value: { amount, unit: 'outcome' } } });
const overhead = (id, option, dimension, amount, unit, kind = 'measured', extra = {}) => ({ type: 'observe', id, observation: { option, target: { dimension }, kind, value: { amount, unit }, ...extra } });
async function observeAll(s, bytes, id, operations) { for (const operation of operations) bytes = (await record(s, bytes, { ...operation, id })).envelopeBytes; return bytes; }
const passAll = (s, bytes, id, option = 'trial') => observeAll(s, bytes, id, [outcome(id, option, 'catches-regression', 'passed'), outcome(id, option, 'stays-green', 'passed')]);
// A Catalog change, faked: new content (so a new revision) and an item digest the inventories do not know, so anything that wrongly
// read the suggestion instead of the trial's own change would select the wrong item.
async function changedSuggestion(suggestion) {
  const changed = { ...suggestion, change: { ...suggestion.change, itemSha256: 'c'.repeat(64), content: { ...suggestion.change.content, recipeSha256: 'e'.repeat(64) } } };
  changed.revision = await suggestionRevision(changed);
  return changed;
}
const trialOf = (envelope, id) => envelope.records.find(r => r.id === id);
const draftIntent = envelope => envelope.records.find(r => r.schema === DRAFT_RECORD_SCHEMA).intent;
async function resign(bytes, mutate) {
  const doc = JSON.parse(decode(bytes));
  mutate(doc);
  const { sha256: _omitted, ...revision } = doc.revision;
  doc.revision.sha256 = await digestBytes(encode(stable({ ...doc, revision })));
  return encode(JSON.stringify(doc, null, 2) + '\n');
}

// ---- 1. Lifecycle ---------------------------------------------------------------------------------------------------------
test('propose, start and keep: the quality is recorded first, the suggestion sits beside the trial, and only keeping changes the draft', async () => {
  const s = await shared();
  const p = await proposed(s);
  assert.equal(p.record.state, 'proposed'); assert.equal(p.record.schema, TRIAL_SCHEMA); assert.equal(p.record.required, false);
  assert.match(p.id, /^trial-[a-f0-9]{32}$/);
  assert.deepEqual(p.record.suggestion, { id: s.tdd.id, revision: s.tdd.revision });
  const { content: _content, ...tested } = s.tdd.change;
  assert.deepEqual(p.record.change, tested, 'the trial carries the change it tests, without the content digests of the suggestion');
  assert.deepEqual(p.record.observations, []); assert.equal('startedAt' in p.record, false);
  assert.equal(p.record.baseline.savedIntentSha256, p.envelope.savedIntent.sha256);
  assert.equal(p.record.baseline.draftSha256, await digestBytes(encode(stable(draftIntent(p.envelope)))));
  assert.equal(p.envelope.records.filter(r => r.schema === IMPROVEMENT_SUGGESTION_SCHEMA).map(r => r.id).join(), s.tdd.id);
  assert.deepEqual(draftIntent(p.envelope), draftIntent(valueOf(await readJourneyEnvelope(s.envelopeBytes)).envelope), 'proposing changes no choice');
  const go = await record(s, p.envelopeBytes, { type: 'start', id: p.id });
  assert.equal(go.record.state, 'started'); assert.match(go.record.startedAt, /^2026-10-16T/);
  let bytes = await passAll(s, go.envelopeBytes, p.id);
  bytes = await observeAll(s, bytes, p.id, [outcome(p.id, 'baseline', 'catches-regression', 'failed'), outcome(p.id, 'baseline', 'stays-green', 'passed')]);
  assert.deepEqual(draftIntent(valueOf(await readJourneyEnvelope(bytes)).envelope), draftIntent(p.envelope), 'observing changes no choice');
  const kept = await record(s, bytes, { type: 'keep', id: p.id, reason: 'The tests caught the regression.' });
  assert.equal(kept.record.state, 'kept'); assert.equal(kept.record.reason, 'The tests caught the regression.');
  assert.equal(kept.record.evidence.outcome, 'qualifying-improvement'); assert.equal(kept.record.decidedAt, kept.record.evidence.evaluatedAt);
  assert.deepEqual(kept.record.adopted.root, { releaseSha256: s.tdd.change.releaseSha256, itemId: 'mattpocock.tdd', scope: 'project' });
  assert.equal(kept.record.adopted.draftSha256, await digestBytes(encode(stable(draftIntent(kept.envelope)))));
  assert.equal(kept.trials.length, 1); assert.equal(kept.trials[0].evaluation.outcome, 'qualifying-improvement');
  // The new bytes read back as written, and a second reading agrees.
  const again = valueOf(await readTrials({ envelopeBytes: kept.envelopeBytes }));
  assert.deepEqual(again.trials.map(t => t.record), [kept.record]); assert.deepEqual(again.mechanisms, []);
  assert.equal(again.trials[0].suggestion.id, s.tdd.id);
});

test('revise: the old trial is revised and points at the new proposed trial, which points back; a proposed trial can be revised too', async () => {
  const s = await shared();
  const go = await started(s), change = { scope: 'project', task: 'Add tests to a larger module.', quality: { outcome: 'Tests catch two seeded regressions.', checks: [{ id: 'catches-both', text: 'Both seeded regressions fail a test.' }] },
    conditions: 'Same client, larger module.', bounds: [{ id: 'time-box', label: 'Time box', unit: 'hours', value: 2, enforcement: { kind: 'advisory' } }], unknowns: [] };
  const revised = await record(s, go.envelopeBytes, { type: 'revise', id: go.id, reason: 'The module was too small.', proposal: change });
  const old = trialOf(revised.envelope, go.id), next = revised.record;
  assert.equal(old.state, 'revised'); assert.equal(old.revisedBy, next.id); assert.equal(old.reason, 'The module was too small.'); assert.equal(old.evidence.outcome, 'inconclusive');
  assert.equal(next.state, 'proposed'); assert.equal(next.revises, old.id); assert.notEqual(next.id, old.id);
  assert.deepEqual(next.quality, change.quality); assert.deepEqual(next.suggestion, old.suggestion); assert.deepEqual(next.observations, []);
  assert.deepEqual(revised.revised, old);
  assert.equal(revised.trials.length, 2);
  const fromProposed = await proposed(s);
  const second = await record(s, fromProposed.envelopeBytes, { type: 'revise', id: fromProposed.id, proposal: change });
  assert.equal(trialOf(second.envelope, fromProposed.id).state, 'revised'); assert.equal('startedAt' in trialOf(second.envelope, fromProposed.id), false);
  // Quality may change only by revising: a revision defines its own quality, and without one it is refused.
  const noQuality = await refused(s, go.envelopeBytes, { type: 'revise', id: go.id, proposal: { ...change, quality: undefined } });
  assert.equal(noQuality.code, 'TRIAL_QUALITY_REQUIRED');
});

test('stop ends the evaluation from a proposed or a started trial and requests no restoration unless asked', async () => {
  const s = await shared();
  const fromStarted = await started(s), stopped = await record(s, fromStarted.envelopeBytes, { type: 'stop', id: fromStarted.id, reason: 'No longer needed.' });
  assert.equal(stopped.record.state, 'stopped'); assert.equal(stopped.record.reason, 'No longer needed.'); assert.equal(stopped.record.evidence.outcome, 'inconclusive');
  assert.equal('restoration' in stopped.record, false, 'stopping never sets a restoration on its own');
  assert.equal('adopted' in stopped.record, false);
  assert.deepEqual(draftIntent(stopped.envelope), draftIntent(valueOf(await readJourneyEnvelope(s.envelopeBytes)).envelope), 'stopping changes no choice');
  const fromProposed = await proposed(s), early = await record(s, fromProposed.envelopeBytes, { type: 'stop', id: fromProposed.id });
  assert.equal(early.record.state, 'stopped'); assert.equal('startedAt' in early.record, false); assert.equal('reason' in early.record, false);
});

test('invalid transitions are refused with TRIAL_TRANSITION_INVALID and leave the original bytes', async () => {
  const s = await shared(), seen = [];
  const refusedAs = async (bytes, operation) => { const d = await refused(s, bytes, operation); assert.equal(d.code, 'TRIAL_TRANSITION_INVALID', JSON.stringify(operation)); assert.equal(d.path, '/operation/type'); seen.push(operation.type); };
  const observation = { option: 'trial', target: { check: 'stays-green' }, kind: 'measured', value: { amount: 'passed', unit: 'outcome' } };
  const p = await proposed(s), id = p.id;
  for (const operation of [{ type: 'keep', id }, { type: 'observe', id, observation }, { type: 'measure-context', id }, { type: 'restoration', id, status: 'completed' }, { type: 'accept-narrower', id, qualification: 'Narrower.' }])
    await refusedAs(p.envelopeBytes, operation);
  const go = await started(s);
  for (const operation of [{ type: 'start', id: go.id }, { type: 'restoration', id: go.id, status: 'pending' }]) await refusedAs(go.envelopeBytes, operation);
  const kept = await record(s, await passAll(s, go.envelopeBytes, go.id), { type: 'keep', id: go.id });
  for (const operation of [{ type: 'start', id: go.id }, { type: 'stop', id: go.id }, { type: 'keep', id: go.id }, { type: 'observe', id: go.id, observation }, { type: 'measure-context', id: go.id },
    { type: 'revise', id: go.id, proposal: revision(s) }, { type: 'restoration', id: go.id, status: 'completed' }, { type: 'accept-narrower', id: go.id, qualification: 'Narrower.' }]) await refusedAs(kept.envelopeBytes, operation);
  const stopFlow = await started(s), stopped = await record(s, stopFlow.envelopeBytes, { type: 'stop', id: stopFlow.id });
  for (const operation of [{ type: 'start', id: stopFlow.id }, { type: 'keep', id: stopFlow.id }, { type: 'stop', id: stopFlow.id }, { type: 'observe', id: stopFlow.id, observation }, { type: 'revise', id: stopFlow.id, proposal: revision(s) }])
    await refusedAs(stopped.envelopeBytes, operation);
  const missing = await refused(s, p.envelopeBytes, { type: 'start', id: 'trial-00000000000000000000000000000000' });
  assert.equal(missing.code, 'INPUT_INVALID'); assert.equal(missing.path, '/operation/id');
  assert.equal((await refused(s, p.envelopeBytes, { type: 'delete', id })).path, '/operation/type');
  assert.equal((await refused(s, p.envelopeBytes, { type: 'start', id, extra: true })).path, '/operation');
  assert.ok(seen.length >= 17);
});

test('operations need a recorded time, supported records and valid mechanisms', async () => {
  const s = await shared();
  assert.equal((await recordTrial({ envelopeBytes: s.envelopeBytes, operation: proposal(s), inventories: s.inventories, now: 'yesterday' })).diagnostics[0].path, '/now');
  assert.equal((await recordTrial({ envelopeBytes: s.envelopeBytes, operation: proposal(s), inventories: s.inventories, now: at(1), mechanisms: [{ id: 'Bad Id', label: 'x' }] })).diagnostics[0].path, '/mechanisms');
  assert.equal((await recordTrial({ envelopeBytes: 'nope', operation: proposal(s), now: at(1) })).diagnostics[0].path, '/envelopeBytes');
  assert.equal((await readTrials({ envelopeBytes: s.envelopeBytes, mechanisms: 'none' })).diagnostics[0].path, '/mechanisms');
  const future = await resign(s.envelopeBytes, doc => { doc.records.push({ id: 'future-required', schema: 'urn:aihq:workbench:journey-record:future-required:1.0.0', required: true }); });
  const read = await recordTrial({ envelopeBytes: future, operation: proposal(s), inventories: s.inventories, now: at(1) });
  assert.equal(read.diagnostics[0].code, 'JOURNEY_RECORD_UNSUPPORTED'); assert.deepEqual(read.originalBytes, future);
  assert.equal(valueOf(await readTrials({ envelopeBytes: future })).trials.length, 0, 'reading still works');
});

// ---- 2. Inconclusive keep -------------------------------------------------------------------------------------------------
test('an inconclusive keep keeps the choice but claims no improvement', async () => {
  const s = await shared();
  const go = await started(s);
  // Nothing observed: the quality is unknown, so the evidence is inconclusive; keeping is still the person's decision.
  const none = await record(s, go.envelopeBytes, { type: 'keep', id: go.id });
  assert.equal(none.record.state, 'kept'); assert.equal(none.record.evidence.outcome, 'inconclusive');
  assert.equal(none.trials[0].evaluation.outcome, 'inconclusive'); assert.equal(none.trials[0].evaluation.quality.options.trial.state, 'unknown');
  assert.equal(draftIntent(none.envelope).roots.some(r => r.itemId === 'mattpocock.tdd' && r.scope === 'project'), true, 'the chosen item is adopted');
  assert.equal(none.record.adopted.root.itemId, 'mattpocock.tdd');
  // An observation recorded as unknown, and one check missing, are inconclusive too; a passed check never fills the gap.
  const partial = await started(s);
  let bytes = await observeAll(s, partial.envelopeBytes, partial.id, [outcome(partial.id, 'trial', 'catches-regression', 'passed'),
    { type: 'observe', observation: { option: 'trial', target: { check: 'stays-green' }, kind: 'unknown', unknownReason: 'The suite was not run.' } }]);
  const kept = await record(s, bytes, { type: 'keep', id: partial.id });
  assert.equal(kept.record.evidence.outcome, 'inconclusive');
  const quality = kept.trials[0].evaluation.quality.options.trial;
  assert.deepEqual([quality.state, quality.passed, quality.failed, quality.unknown], ['unknown', 1, 0, 1]);
  for (const t of [none, kept]) assert.notEqual(t.trials[0].evaluation.outcome, 'qualifying-improvement');
});

// ---- 3. Stop with partial restoration ---------------------------------------------------------------------------------------
test('a stop with partial restoration keeps the restoration separate from the stop, and a later restoration update changes neither the state nor the evidence', async () => {
  const s = await shared();
  const go = await started(s);
  const stopped = await record(s, go.envelopeBytes, { type: 'stop', id: go.id, reason: 'Not worth it.', restoration: { status: 'partial', effects: ['The project instruction file was edited.', 'A hook was added.'], note: 'Only the hook was reverted.' } });
  assert.equal(stopped.record.state, 'stopped');
  assert.equal(stopped.record.restoration.status, 'partial'); assert.deepEqual(stopped.record.restoration.effects, ['The project instruction file was edited.', 'A hook was added.']);
  assert.equal(stopped.record.restoration.note, 'Only the hook was reverted.'); assert.match(stopped.record.restoration.recordedAt, /^2026-10-16T/);
  assert.equal('adopted' in stopped.record, false, 'a stop is never read as a reversal or an adoption');
  const done = await record(s, stopped.envelopeBytes, { type: 'restoration', id: go.id, status: 'completed', effects: [] });
  assert.equal(done.record.restoration.status, 'completed'); assert.deepEqual(done.record.restoration.effects, []); assert.equal('note' in done.record.restoration, false);
  for (const field of ['state', 'evidence', 'decidedAt', 'reason', 'observations', 'quality']) assert.deepEqual(done.record[field], stopped.record[field], field);
  for (const status of ['proposed', 'pending', 'completed', 'partial', 'unsupported']) {
    const moved = await record(s, done.envelopeBytes, { type: 'restoration', id: go.id, status, effects: ['Something.'] });
    assert.equal(moved.record.restoration.status, status); assert.equal(moved.record.state, 'stopped');
  }
  assert.equal((await refused(s, stopped.envelopeBytes, { type: 'restoration', id: go.id, status: 'undone' })).path, '/operation/status');
  assert.equal((await refused(s, go.envelopeBytes, { type: 'stop', id: go.id, restoration: { status: 'partial', effects: new Array(17).fill('x') } })).path, '/operation/restoration');
  assert.equal((await refused(s, go.envelopeBytes, { type: 'stop', id: go.id, restoration: { status: 'partial', extra: 1 } })).path, '/operation/restoration');
});

// ---- 4. Quality before comparison -------------------------------------------------------------------------------------------
test('a trial cannot be proposed without the quality it must meet, and the quality cannot be changed afterwards', async () => {
  const s = await shared();
  for (const quality of [undefined, null, {}, { outcome: 'Fewer regressions.', checks: [] }, { outcome: '', checks: [{ id: 'a', text: 'b' }] }, { checks: [{ id: 'a', text: 'b' }] }]) {
    const d = await refused(s, s.envelopeBytes, proposal(s, { quality }));
    assert.equal(d.code, 'TRIAL_QUALITY_REQUIRED'); assert.equal(d.path, '/operation/quality');
  }
  const { quality: _omitted, ...withoutQuality } = proposal(s);
  assert.equal((await refused(s, s.envelopeBytes, withoutQuality)).code, 'TRIAL_QUALITY_REQUIRED');
  assert.equal((await refused(s, s.envelopeBytes, proposal(s, { quality: { outcome: 'x', checks: [{ id: 'Bad Id', text: 'b' }] } }))).path, '/operation/quality/checks');
  assert.equal((await refused(s, s.envelopeBytes, proposal(s, { quality: { outcome: 'x', checks: [{ id: 'a', text: 'b' }, { id: 'a', text: 'c' }] } }))).path, '/operation/quality/checks');
  // Observations wait for the start, and a check outside the defined quality cannot be observed.
  const p = await proposed(s);
  assert.equal((await refused(s, p.envelopeBytes, outcome(p.id, 'trial', 'stays-green', 'passed'))).code, 'TRIAL_TRANSITION_INVALID');
  const go = await record(s, p.envelopeBytes, { type: 'start', id: p.id });
  const extra = await refused(s, go.envelopeBytes, outcome(p.id, 'trial', 'invented-check', 'passed'));
  assert.equal(extra.path, '/operation/observation/target');
  const edit = await refused(s, go.envelopeBytes, { type: 'observe', id: p.id, quality: { outcome: 'Lower the bar.', checks: [{ id: 'easy', text: 'Easy.' }] }, observation: {} });
  assert.equal(edit.path, '/operation');
  for (const bad of [{ option: 'both', target: { check: 'stays-green' }, kind: 'measured', value: { amount: 'passed', unit: 'outcome' } },
    { option: 'trial', target: { check: 'stays-green' }, kind: 'measured', value: { amount: 'maybe', unit: 'outcome' } },
    { option: 'trial', target: { check: 'stays-green' }, kind: 'measured', value: { amount: 'passed', unit: 'bytes' } },
    { option: 'trial', target: { dimension: 'indexing' }, kind: 'measured', value: { amount: 'passed', unit: 'bytes' } },
    { option: 'trial', target: { dimension: 'indexing' }, kind: 'measured', value: { amount: -1, unit: 'bytes' } },
    { option: 'trial', target: { dimension: 'speed' }, kind: 'measured', value: { amount: 1, unit: 'bytes' } },
    { option: 'trial', target: { dimension: 'indexing' }, kind: 'estimated', value: { amount: 1, unit: 'bytes' } },
    { option: 'trial', target: { dimension: 'indexing' }, kind: 'unknown' },
    { option: 'trial', target: { dimension: 'indexing' }, kind: 'unknown', unknownReason: 'x', value: { amount: 1, unit: 'bytes' } }])
    assert.equal((await refused(s, go.envelopeBytes, { type: 'observe', id: p.id, observation: bad })).code, 'INPUT_INVALID', JSON.stringify(bad));
});

test('the evaluation settles the quality first, and the outcome rests on the trial quality alone, not on any overhead', async () => {
  const s = await shared();
  const go = await started(s);
  // Overhead only: it dropped sharply, but no quality check was observed, so nothing qualifies.
  const bytes = await observeAll(s, go.envelopeBytes, go.id, [overhead(go.id, 'baseline', 'runtime-context', 1000, 'bytes'), overhead(go.id, 'trial', 'runtime-context', 100, 'bytes')]);
  const evaluation = (await evaluateTrial(trialOf(valueOf(await readJourneyEnvelope(bytes)).envelope, go.id)));
  assert.deepEqual(Object.keys(evaluation).slice(0, 3), ['quality', 'outcome', 'overhead'], 'quality is computed and reported before the overhead');
  assert.equal(evaluation.outcome, 'inconclusive');
  assert.equal(evaluation.overhead.find(row => row.dimension === 'runtime-context').direction, 'decrease');
  assert.deepEqual(evaluation.quality.defined.checks.map(c => c.id), ['catches-regression', 'stays-green']);
  // The baseline quality never decides the outcome: a failing baseline with a passing trial qualifies, and a passing baseline with a failing trial does not.
  const mixed = async (baseline, trial) => {
    const p = await started(s);
    const done = await observeAll(s, p.envelopeBytes, p.id, ['catches-regression', 'stays-green'].flatMap(id => [outcome(p.id, 'baseline', id, baseline), outcome(p.id, 'trial', id, trial)]));
    return (await evaluateTrial(trialOf(valueOf(await readJourneyEnvelope(done)).envelope, p.id))).outcome;
  };
  assert.equal(await mixed('failed', 'passed'), 'qualifying-improvement');
  assert.equal(await mixed('passed', 'failed'), 'no-qualifying-improvement');
  assert.equal(await mixed('failed', 'failed'), 'no-qualifying-improvement');
  assert.equal(await mixed('passed', 'passed'), 'qualifying-improvement');
});

// ---- 5. No qualifying improvement and a narrower accepted outcome ------------------------------------------------------------
test('a failed trial check is no qualifying improvement even when the overhead decreased, and a deliberately narrower outcome is recorded without rewriting the evidence', async () => {
  const s = await shared();
  const go = await started(s);
  const bytes = await observeAll(s, go.envelopeBytes, go.id, [outcome(go.id, 'trial', 'catches-regression', 'failed'), outcome(go.id, 'trial', 'stays-green', 'passed'),
    overhead(go.id, 'baseline', 'runtime-context', 5000, 'bytes'), overhead(go.id, 'trial', 'runtime-context', 2000, 'bytes')]);
  const live = (await readTrials({ envelopeBytes: bytes })).value.trials[0].evaluation;
  assert.equal(live.outcome, 'no-qualifying-improvement'); assert.equal(live.quality.options.trial.state, 'not-met');
  const row = live.overhead.find(r => r.dimension === 'runtime-context');
  assert.deepEqual([row.status, row.direction, row.absoluteDifference], ['available', 'decrease', 3000], 'the overhead is shown, but never as an improvement');
  const narrower = await record(s, bytes, { type: 'accept-narrower', id: go.id, qualification: 'Fine for modules that already have a test suite.' });
  assert.equal(narrower.record.state, 'started'); assert.deepEqual(narrower.record.narrower, { qualification: 'Fine for modules that already have a test suite.', acceptedAt: narrower.record.narrower.acceptedAt });
  assert.equal(narrower.trials[0].evaluation.outcome, 'no-qualifying-improvement'); assert.equal(narrower.trials[0].evaluation.narrower.qualification, 'Fine for modules that already have a test suite.');
  const kept = await record(s, narrower.envelopeBytes, { type: 'keep', id: go.id });
  assert.equal(kept.record.evidence.outcome, 'no-qualifying-improvement', 'keeping with a narrower outcome does not rewrite the evidence');
  assert.equal(kept.record.narrower.qualification, 'Fine for modules that already have a test suite.');
  // A decided trial can still record a narrower outcome, again without touching the evidence.
  const stopped = await record(s, bytes, { type: 'stop', id: go.id });
  const later = await record(s, stopped.envelopeBytes, { type: 'accept-narrower', id: go.id, qualification: 'Only for small modules.' });
  assert.deepEqual(later.record.evidence, stopped.record.evidence); assert.equal(later.record.state, 'stopped');
  // It is refused when the trial already met its quality bar, and the qualification must be text.
  const winner = await started(s), won = await passAll(s, winner.envelopeBytes, winner.id);
  assert.equal((await refused(s, won, { type: 'accept-narrower', id: winner.id, qualification: 'Narrower.' })).code, 'TRIAL_TRANSITION_INVALID');
  const decided = await record(s, won, { type: 'keep', id: winner.id });
  assert.equal((await refused(s, decided.envelopeBytes, { type: 'accept-narrower', id: winner.id, qualification: 'Narrower.' })).code, 'TRIAL_TRANSITION_INVALID');
  assert.equal((await refused(s, bytes, { type: 'accept-narrower', id: go.id, qualification: '' })).path, '/operation/qualification');
});

// ---- 6. Bounds ----------------------------------------------------------------------------------------------------------------
test('every bound shows its unit, its value and whether it is advisory or enforced; without a mechanism there is no cap', async () => {
  const s = await shared();
  const bounds = [{ id: 'context', label: 'Context budget', unit: 'tokens', value: 20000, enforcement: { kind: 'advisory' } }, { id: 'minutes', label: 'Setup time', unit: 'minutes', value: 15, enforcement: { kind: 'advisory' } }];
  const p = await proposed(s, { bounds });
  assert.deepEqual(p.trials[0].evaluation.bounds.map(b => b.text), ['Context budget: 20000 tokens — advisory (not enforced)', 'Setup time: 15 minutes — advisory (not enforced)']);
  assert.deepEqual(p.trials[0].evaluation.unknowns, ['Model spending: no cost source is connected.']);
  const enforced = { id: 'spend', label: 'Spending cap', unit: 'usd', value: 5, enforcement: { kind: 'enforced', mechanism: { id: 'budget-proxy', label: 'Budget proxy' } } };
  const d = await refused(s, s.envelopeBytes, proposal(s, { bounds: [enforced] }));
  assert.equal(d.code, 'TRIAL_BOUND_UNENFORCEABLE'); assert.equal(d.path, '/operation/bounds/0/enforcement');
  assert.equal((await refused(s, s.envelopeBytes, proposal(s, { bounds: [bounds[0], enforced] }), { mechanisms: [{ id: 'other', label: 'Other' }] })).code, 'TRIAL_BOUND_UNENFORCEABLE');
  // With a mechanism the host can apply, an enforced bound is accepted and its text names the mechanism.
  const mechanisms = [{ id: 'budget-proxy', label: 'Budget proxy' }];
  const accepted = valueOf(await recordTrial({ envelopeBytes: s.envelopeBytes, operation: proposal(s, { bounds: [enforced, bounds[0]] }), inventories: s.inventories, mechanisms, now: tick() }));
  assert.deepEqual(accepted.record.bounds[0].enforcement, { kind: 'enforced', mechanism: { id: 'budget-proxy', label: 'Budget proxy' } });
  assert.deepEqual(accepted.trials[0].evaluation.bounds.map(b => b.text), ['Spending cap: 5 usd — enforced by Budget proxy', 'Context budget: 20000 tokens — advisory (not enforced)']);
  // The host's label is the one recorded, whatever the operation said.
  const relabelled = valueOf(await recordTrial({ envelopeBytes: s.envelopeBytes, operation: proposal(s, { bounds: [{ ...enforced, enforcement: { kind: 'enforced', mechanism: { id: 'budget-proxy', label: 'My own label' } } }] }), inventories: s.inventories, mechanisms, now: tick() }));
  assert.equal(relabelled.record.bounds[0].enforcement.mechanism.label, 'Budget proxy');
  // Read where the mechanism is gone: the record says enforced, but no cap is claimed.
  const gone = valueOf(await readTrials({ envelopeBytes: accepted.envelopeBytes })).trials[0].evaluation.bounds[0].text;
  assert.match(gone, /not available here, so it is not a cap/);
  assert.equal(valueOf(await readTrials({ envelopeBytes: accepted.envelopeBytes, mechanisms })).trials[0].evaluation.bounds[0].text, 'Spending cap: 5 usd — enforced by Budget proxy');
  // Malformed bounds are refused as such.
  for (const bound of [{ ...bounds[0], value: -1 }, { ...bounds[0], value: Infinity }, { ...bounds[0], value: '5' }, { ...bounds[0], unit: '' }, { ...bounds[0], enforcement: { kind: 'hard-cap' } }, { ...bounds[0], enforcement: { kind: 'advisory', mechanism: { id: 'x', label: 'y' } } }, { id: 'x' }])
    assert.equal((await refused(s, s.envelopeBytes, proposal(s, { bounds: [bound] }))).path, '/operation/bounds', JSON.stringify(bound));
  assert.equal((await refused(s, s.envelopeBytes, proposal(s, { bounds: [bounds[0], bounds[0]] }))).path, '/operation/bounds');
});

// ---- 7. Keep changes only the chosen scope --------------------------------------------------------------------------------------
test('keeping a trial adds the suggested item at the chosen scope and leaves every unrelated selection, origin, exclusion and pin as it was', async () => {
  const s = await shared(), go = await started(s), bytes = await passAll(s, go.envelopeBytes, go.id);
  const beforeEnvelope = valueOf(await readJourneyEnvelope(bytes)).envelope, before = draftIntent(beforeEnvelope);
  assert.ok(before.roots.length >= 2, 'at least two unrelated choices'); assert.equal(before.exclusions.length, 1, 'and an unrelated skip');
  assert.equal(before.roots.some(r => r.itemId === 'mattpocock.tdd'), false);
  const kept = await record(s, bytes, { type: 'keep', id: go.id }), after = draftIntent(kept.envelope);
  const key = r => `${r.releaseSha256}/${r.itemId}/${r.scope}`;
  assert.equal(after.roots.length, before.roots.length + 1, 'exactly one root was added');
  for (const root of before.roots) assert.deepEqual(after.roots.find(r => key(r) === key(root)), root, `${root.itemId} is untouched`);
  const [added] = after.roots.filter(r => !before.roots.some(old => key(old) === key(r)));
  assert.deepEqual(added, { releaseSha256: s.tdd.change.releaseSha256, itemId: 'mattpocock.tdd', itemSha256: s.tdd.change.itemSha256, scope: 'project', configuration: {}, originIds: ['direct'] });
  assert.equal(after.roots.some(r => r.itemId === 'mattpocock.tdd' && r.scope === 'user'), false, 'the other scope was not added');
  assert.deepEqual(after.origins, before.origins); assert.deepEqual(after.exclusions, before.exclusions);
  for (const pin of before.pins) assert.deepEqual(after.pins.find(p => p.itemId === pin.itemId && p.releaseSha256 === pin.releaseSha256), pin, `${pin.itemId} stays pinned`);
  assert.deepEqual(after.pins.filter(p => !before.pins.some(old => old.itemId === p.itemId)).map(p => p.itemId), ['mattpocock.tdd']);
  for (const field of ['schema', 'provenance', 'inputs', 'reviews']) assert.deepEqual(after[field], before[field], field);
  assert.equal(kept.envelope.savedIntent.sha256, beforeEnvelope.savedIntent.sha256, 'the saved policy bytes are untouched');
  assert.equal(kept.record.adopted.root.scope, 'project');
  // The scope is the person's choice and must be one the item offers; the maintained Catalog offers this item at the project scope only.
  const d = await refused(s, s.envelopeBytes, proposal(s, { scope: 'user' }));
  assert.equal(d.path, '/operation/scope'); assert.equal(d.code, 'INPUT_INVALID');
  // If the draft edit refuses, nothing is recorded: a keep without the checked inventories cannot resolve the item.
  await refused(s, bytes, { type: 'keep', id: go.id }, { inventories: [] });
});

// ---- 8. Core report evidence --------------------------------------------------------------------------------------------------------
test('the evaluation is a valid Core claim set and its overhead rows copy Core\'s context-change results', async () => {
  const s = await shared(), go = await started(s);
  const method = { id: 'rough-count', version: '1.0.0' };
  const bytes = await observeAll(s, go.envelopeBytes, go.id, [outcome(go.id, 'trial', 'catches-regression', 'passed'), outcome(go.id, 'trial', 'stays-green', 'passed'),
    overhead(go.id, 'baseline', 'runtime-context', 4000, 'bytes'), overhead(go.id, 'trial', 'runtime-context', 6000, 'bytes'),
    overhead(go.id, 'baseline', 'setup', 10, 'minutes', 'declared'), overhead(go.id, 'trial', 'setup', 15, 'minutes', 'declared'),
    overhead(go.id, 'baseline', 'indexing', 100, 'bytes'),
    overhead(go.id, 'baseline', 'maintenance', 30, 'minutes', 'estimated', { method }), overhead(go.id, 'trial', 'maintenance', 45, 'minutes', 'estimated', { method })]);
  const { evaluation } = valueOf(await readTrials({ envelopeBytes: bytes })).trials[0];
  assert.deepEqual(validateClaimSet(evaluation.claimSet), { valid: true, errors: [] });
  assert.equal(evaluation.claimSet.claims.length, 9); assert.equal(evaluation.claimSet.calculations.length, 3);
  assert.deepEqual(evaluation.claimSet.calculations.map(c => c.method), ['context-change', 'context-change', 'context-change']);
  for (const claim of evaluation.claimSet.claims) {
    assert.equal(claim.recordSchema, TRIAL_SCHEMA); assert.deepEqual(claim.producer, { id: 'aih-ui/trial', version: '1.0.0' }); assert.match(claim.revision, /^[a-f0-9]{64}$/);
    assert.deepEqual(claim.scope, { kind: 'repository', targets: ['mattpocock.tdd'] }); assert.deepEqual(claim.sources, [{ id: go.id, schema: TRIAL_SCHEMA }]);
    assert.equal(claim.observation, claim.id); assert.deepEqual(claim.authentication, { status: 'not-authenticated' });
    assert.match(claim.measure, /^trial-quality-check$|^trial-overhead\/(setup|indexing|runtime-context|maintenance)$/);
  }
  const claim = evaluation.claimSet.claims.find(c => c.id === `${go.id}/baseline/runtime-context`);
  assert.deepEqual(claim.subject, { kind: 'trial-option', id: `${go.id}/baseline` }); assert.deepEqual(claim.value, { amount: 4000, unit: 'bytes' }); assert.equal(claim.kind, 'measured');
  assert.ok(evaluation.claimSet.claims.find(c => c.id === `${go.id}/trial/check:catches-regression`), 'a check claim is named by its check');
  const core = id => evaluation.projection.calculations.find(r => r.id === `${go.id}/${id}`), row = dimension => evaluation.overhead.find(r => r.dimension === dimension);
  // Measured bytes: available, copied from Core (a positive percentage is a decrease, so this increase is negative).
  const bytesRow = row('runtime-context'), bytesCore = core('runtime-context');
  assert.equal(bytesCore.status, 'available');
  for (const field of ['status', 'reason', 'before', 'after', 'unit', 'absoluteDifference', 'direction', 'percentage']) assert.deepEqual(bytesRow[field], bytesCore[field], field);
  assert.deepEqual([bytesRow.before, bytesRow.after, bytesRow.absoluteDifference, bytesRow.direction, bytesRow.percentage], [4000, 6000, 2000, 'increase', -50]);
  assert.match(bytesRow.label, /configured material size, not usage/);
  // Declared minutes: Core does not compare them, and none of its numbers are derived here.
  const declared = row('setup');
  assert.deepEqual([declared.status, declared.reason], ['unavailable', 'unsupported-kind']); assert.equal(core('setup').reason, 'unsupported-kind');
  for (const field of ['before', 'after', 'unit', 'absoluteDifference', 'direction', 'percentage']) assert.equal(field in declared, false, field);
  assert.equal(declared.baseline.value.amount, 10); assert.equal(declared.trial.value.amount, 15);
  // Estimates from the same method are compared by Core.
  assert.deepEqual([row('maintenance').status, row('maintenance').absoluteDifference, row('maintenance').direction], ['available', 15, 'increase']);
  // A missing side is not observed, never zero.
  assert.deepEqual([row('indexing').status, row('indexing').reason, 'absoluteDifference' in row('indexing')], ['not-observed', 'trial-not-observed', false]);
  assert.equal(core('indexing'), undefined);
  assert.deepEqual(evaluation.overhead.map(r => r.dimension), ['setup', 'indexing', 'runtime-context', 'maintenance']);
  // Other Core reasons are passed through whatever they are, and a zero baseline has no percentage.
  const mismatch = await started(s);
  const odd = await observeAll(s, mismatch.envelopeBytes, mismatch.id, [overhead(mismatch.id, 'baseline', 'setup', 5, 'bytes'), overhead(mismatch.id, 'trial', 'setup', 5, 'bytes', 'estimated', { method }),
    overhead(mismatch.id, 'baseline', 'indexing', 5, 'bytes'), { type: 'observe', observation: { option: 'trial', target: { dimension: 'indexing' }, kind: 'unknown', unknownReason: 'Not measured.' } },
    overhead(mismatch.id, 'baseline', 'maintenance', 0, 'bytes'), overhead(mismatch.id, 'trial', 'maintenance', 7, 'bytes')]);
  const rows = valueOf(await readTrials({ envelopeBytes: odd })).trials[0].evaluation.overhead;
  assert.equal(rows.find(r => r.dimension === 'setup').reason, 'incomparable-kind'); assert.equal(rows.find(r => r.dimension === 'indexing').reason, 'unknown-value');
  const zero = rows.find(r => r.dimension === 'maintenance');
  assert.deepEqual([zero.status, zero.percentage, zero.percentageReason], ['available', null, 'zero-baseline']);
  // A trial at the user scope is a user-content claim, never "all".
  const user = await evaluateTrial({ ...trialOf(valueOf(await readJourneyEnvelope(bytes)).envelope, go.id), scope: 'user' });
  assert.equal(user.claimSet.claims.every(c => c.scope.kind === 'user-content'), true);
  // The evaluation is plain data a service can send.
  assert.deepEqual(JSON.parse(JSON.stringify(evaluation)), evaluation);
});

test('measure-context records host-measured configured sizes, and says so when a size is unknown', async () => {
  const s = await shared();
  const sizeOf = ids => ids.reduce((total, id) => { const item = s.maintained.release.items.find(i => i.id === id); return total + item.recipe.byteLength + item.materials.reduce((sum, m) => sum + m.byteLength, 0); }, 0);
  const pinned = pins => pins.reduce((total, pin) => total + pin.recipe.byteLength + pin.materials.reduce((sum, m) => sum + m.byteLength, 0), 0);
  const go = await started(s), measured = await record(s, go.envelopeBytes, { type: 'measure-context', id: go.id });
  const base = pinned(draftIntent(measured.envelope).pins);
  assert.equal(measured.record.observations.length, 2);
  for (const observation of measured.record.observations) {
    assert.deepEqual([observation.source, observation.kind, observation.target, observation.value.unit], ['host', 'measured', { dimension: 'runtime-context' }, 'bytes']);
    assert.match(observation.id, /^obs-/);
  }
  const amounts = Object.fromEntries(measured.record.observations.map(o => [o.option, o.value.amount]));
  assert.deepEqual(amounts, { baseline: base, trial: base + sizeOf(['mattpocock.tdd']) });
  const row = measured.trials[0].evaluation.overhead.find(r => r.dimension === 'runtime-context');
  assert.deepEqual([row.status, row.direction, row.absoluteDifference], ['available', 'increase', sizeOf(['mattpocock.tdd'])]);
  // Measuring again replaces the host's observations rather than adding to them.
  assert.equal((await record(s, measured.envelopeBytes, { type: 'measure-context', id: go.id })).record.observations.length, 2);
  // What a suggestion requires counts too, unless it is already pinned: project-context is a pin, its pointer and the client item are not.
  const planned = valueOf(await recordTrial({ envelopeBytes: s.envelopeBytes, operation: proposal(s, { suggestion: s.claude }), inventories: s.inventories, now: tick() }));
  const running = await record(s, planned.envelopeBytes, { type: 'start', id: planned.record.id });
  const closure = await record(s, running.envelopeBytes, { type: 'measure-context', id: planned.record.id });
  assert.equal(closure.record.observations.find(o => o.option === 'trial').value.amount, base + sizeOf(['aihq.client.claude', 'aihq.project-context-pointer.claude-md']), 'the pinned project-context is not counted twice');
  // Without the checked inventories the trial size is unknown, with the reason; the baseline is still measured from the pins.
  const blind = await record(s, go.envelopeBytes, { type: 'measure-context', id: go.id }, { inventories: [] });
  const trialSide = blind.record.observations.find(o => o.option === 'trial'), baselineSide = blind.record.observations.find(o => o.option === 'baseline');
  assert.deepEqual([trialSide.kind, 'value' in trialSide, trialSide.source], ['unknown', false, 'host']); assert.match(trialSide.unknownReason, /not in the supplied inventories/);
  assert.equal(baselineSide.value.amount, base);
  const unknown = blind.trials[0].evaluation.overhead.find(r => r.dimension === 'runtime-context');
  assert.deepEqual([unknown.status, unknown.reason], ['unavailable', 'unknown-value']);
});

// ---- 9. The journey envelope --------------------------------------------------------------------------------------------------------
test('the trial kind is registered, optional, and round-trips through the journey envelope with its suggestion beside it', async () => {
  const s = await shared();
  assert.equal(TRIAL_SCHEMA, 'urn:aihq:workbench:journey-record:improvement-trial:1.0.0'); assert.equal(TRIAL_RECORD_SCHEMA, TRIAL_SCHEMA);
  assert.deepEqual(JOURNEY_RECORD_KINDS[TRIAL_SCHEMA], { kind: 'improvement-trial', version: '1.0.0', required: false });
  const go = await started(s), bytes = await passAll(s, go.envelopeBytes, go.id);
  const read = valueOf(await readJourneyEnvelope(bytes));
  assert.equal(read.supported, true);
  const written = valueOf(await writeJourneyEnvelope({ savedIntentBytes: read.savedIntentBytes, records: read.records, previous: read }));
  assert.deepEqual(written.envelope.records, read.records);
  assert.deepEqual(valueOf(await readJourneyEnvelope(written.envelopeBytes)).records, read.records);
  // The suggestion record with the same id must sit beside the trial, on read and on write.
  const missing = await resign(bytes, doc => { doc.records = doc.records.filter(r => r.schema !== IMPROVEMENT_SUGGESTION_SCHEMA); });
  const absent = await readJourneyEnvelope(missing);
  assert.equal(absent.status, 'refused'); assert.equal(absent.diagnostics[0].code, 'INPUT_INVALID'); assert.match(absent.diagnostics[0].path, /^\/records\/\d+\/suggestion$/);
  const writtenAlone = await writeJourneyEnvelope({ savedIntentBytes: read.savedIntentBytes, records: read.records.filter(r => r.schema !== IMPROVEMENT_SUGGESTION_SCHEMA) });
  assert.equal(writtenAlone.status, 'refused'); assert.match(writtenAlone.diagnostics[0].path, /^\/records\/\d+\/suggestion$/);
  // A trial that names another revision of the suggestion beside it is still linked (the revision records what was trialled); another suggestion id is not.
  const older = structuredClone(read.records.find(r => r.id === go.id)); older.suggestion.revision = 'b'.repeat(64); older.id = await trialId(older); older.revision = await trialRevision(older);
  const oldRevision = await resign(bytes, doc => { doc.records[doc.records.findIndex(r => r.id === go.id)] = older; });
  assert.equal(valueOf(await readJourneyEnvelope(oldRevision)).records.some(r => r.id === older.id), true);
  const relinked = structuredClone(older); relinked.suggestion.id = `suggestion-${'b'.repeat(32)}`; relinked.id = await trialId(relinked); relinked.revision = await trialRevision(relinked);
  const other = await resign(bytes, doc => { doc.records[doc.records.findIndex(r => r.id === go.id)] = relinked; });
  assert.match((await readJourneyEnvelope(other)).diagnostics[0].path, /^\/records\/\d+\/suggestion$/);
  // Ids derive from the record's own fields: a tampered trial or observation id is refused.
  const tamperedId = await resign(bytes, doc => { doc.records.find(r => r.id === go.id).id = `trial-${'a'.repeat(32)}`; });
  const idRefusal = await readJourneyEnvelope(tamperedId);
  assert.equal(idRefusal.status, 'refused'); assert.match(idRefusal.diagnostics[0].path, /^\/records\/\d+\/id$/);
  const tamperedObservation = await resign(bytes, doc => { doc.records.find(r => r.id === go.id).observations[0].id = 'obs-forged'; });
  assert.match((await readJourneyEnvelope(tamperedObservation)).diagnostics[0].path, /^\/records\/\d+\/observations\/0\/id$/);
  const tamperedScope = await resign(bytes, doc => { doc.records.find(r => r.id === go.id).scope = 'user'; });
  assert.match((await readJourneyEnvelope(tamperedScope)).diagnostics[0].path, /^\/records\/\d+\/id$/);
  const forged = structuredClone(read.records.find(r => r.id === go.id)); forged.id = `trial-${'c'.repeat(32)}`;
  assert.match((await writeJourneyEnvelope({ savedIntentBytes: read.savedIntentBytes, records: [...read.records, forged], previous: read })).diagnostics[0].path, /^\/records\/\d+\/id$/);
});

test('the closed trial shape refuses what the lifecycle cannot produce', async () => {
  const s = await shared(), go = await started(s), bytes = await passAll(s, go.envelopeBytes, go.id);
  const good = trialOf(valueOf(await readJourneyEnvelope(bytes)).envelope, go.id);
  assert.equal(trialProblem(good), null);
  const problem = mutate => { const copy = structuredClone(good); mutate(copy); return trialProblem(copy); };
  assert.equal(problem(t => { t.extra = 1; }), '');
  assert.equal(problem(t => { t.required = true; }), '/required');
  assert.equal(problem(t => { t.state = 'kept'; }), '/decidedAt');
  assert.equal(problem(t => { t.state = 'proposed'; }), '/startedAt');
  assert.equal(problem(t => { delete t.startedAt; }), '/startedAt');
  assert.equal(problem(t => { t.restoration = { status: 'partial', effects: [], recordedAt: t.proposedAt }; }), '/restoration');
  assert.equal(problem(t => { t.adopted = { root: { releaseSha256: 'a'.repeat(64), itemId: 'x', scope: 'project' }, draftSha256: 'a'.repeat(64) }; }), '/adopted');
  assert.equal(problem(t => { t.reason = 'Early.'; }), '/reason');
  assert.equal(problem(t => { t.observations[0].target = { check: 'not-defined' }; }), '/observations');
  assert.equal(problem(t => { t.observations.push(structuredClone(t.observations[0])); }), '/observations');
  assert.equal(problem(t => { t.quality.checks = []; }), '/quality/checks');
  assert.equal(problem(t => { delete t.change; }), '', 'the change is part of the closed shape');
  assert.equal(problem(t => { t.change.content = {}; }), '/change');
  assert.equal(problem(t => { t.change.kind = 'remove-item'; }), '/change');
  assert.equal(problem(t => { t.change.itemSha256 = 'nope'; }), '/change');
  assert.equal(problem(t => { t.bounds = [{ id: 'cap', label: 'Cap', unit: 'usd', value: 1, enforcement: { kind: 'enforced' } }]; }), '/bounds');
  assert.equal(problem(t => { t.proposedAt = '2026-13-01T00:00:00Z'; }), '/proposedAt');
  assert.equal(problem(t => { t.bounds = []; }), '/bounds', 'a bounded trial has at least one bound');
  assert.equal(problem(t => { delete t.revision; }), '', 'the revision is part of the closed shape');
  assert.equal(problem(t => { t.revision = 'nope'; }), '/revision');
  const decided = trialOf(valueOf(await readJourneyEnvelope((await record(s, bytes, { type: 'keep', id: go.id })).envelopeBytes)).envelope, go.id);
  assert.equal(trialProblem(decided), null);
  const kept = mutate => { const copy = structuredClone(decided); mutate(copy); return trialProblem(copy); };
  assert.equal(kept(t => { delete t.adopted; }), '/adopted'); assert.equal(kept(t => { delete t.evidence; }), '/evidence'); assert.equal(kept(t => { t.revisedBy = 'trial-' + 'b'.repeat(32); }), '/revisedBy');
  assert.equal(kept(t => { t.evidence.outcome = 'improved'; }), '/evidence');
});

test('an unknown future trial version is preserved verbatim through trial and improvement writes', async () => {
  const s = await shared();
  const future = { id: 'future-trial', schema: 'urn:aihq:workbench:journey-record:improvement-trial:2.0.0', required: false, anything: { goes: ['here'] } };
  const withFuture = await resign(s.envelopeBytes, doc => { doc.records.push(structuredClone(future)); });
  const read = await readJourneyEnvelope(withFuture);
  assert.equal(valueOf(read).supported, true); assert.equal(read.value.records.some(r => r.schema === TRIAL_SCHEMA), false);
  assert.ok(read.diagnostics.some(d => d.code === 'JOURNEY_RECORD_PRESERVED'));
  const p = await proposed(s, {}, withFuture), go = await record(s, p.envelopeBytes, { type: 'start', id: p.id }), kept = await record(s, go.envelopeBytes, { type: 'keep', id: p.id });
  for (const r of [p, go, kept]) assert.deepEqual(r.envelope.records.find(x => x.id === 'future-trial'), future);
  assert.equal(valueOf(await readTrials({ envelopeBytes: withFuture })).trials.length, 0, 'an unknown version is not read as a trial');
});

test('restoring a dismissed suggestion that a trial was planned from keeps the suggestion record, and drops the dismissal only', async () => {
  const s = await shared();
  const dismissed = valueOf(await recordImprovement({ envelopeBytes: s.envelopeBytes, operation: { type: 'dismiss', suggestion: s.tdd, reason: 'Later.' }, now: tick() }));
  const p = await proposed(s, {}, dismissed.envelopeBytes);
  assert.equal(p.envelope.records.filter(r => r.schema === IMPROVEMENT_DISMISSAL_SCHEMA).length, 1);
  const restored = valueOf(await recordImprovement({ envelopeBytes: p.envelopeBytes, operation: { type: 'restore', id: s.tdd.id }, now: tick() }));
  assert.deepEqual(restored.dismissals, []);
  assert.equal(restored.envelope.records.some(r => r.schema === IMPROVEMENT_SUGGESTION_SCHEMA && r.id === s.tdd.id), true, 'the trial still has its suggestion');
  assert.equal(restored.envelope.records.some(r => r.id === p.id), true);
  assert.equal(valueOf(await readTrials({ envelopeBytes: restored.envelopeBytes })).trials[0].suggestion.id, s.tdd.id);
  // With no trial, restore still removes the suggestion record with the dismissal.
  const plain = valueOf(await recordImprovement({ envelopeBytes: dismissed.envelopeBytes, operation: { type: 'restore', id: s.tdd.id }, now: tick() }));
  assert.equal(plain.envelope.records.some(r => r.schema === IMPROVEMENT_SUGGESTION_SCHEMA), false);
  // A dismissal binds the revision it dismissed, so a changed suggestion has to be shown again before a trial can be planned from it.
  const changed = await changedSuggestion(s.tdd);
  const d = await refused(s, p.envelopeBytes, proposal(s, { suggestion: changed }));
  assert.equal(d.code, 'TRIAL_SUGGESTION_CHANGED'); assert.equal(d.path, '/operation/suggestion'); assert.match(d.message, /Show the suggestion again first/);
});

test('a Catalog change that gives the suggestion a new revision locks nothing: a second trial can be planned, the old one keeps the change it tested, and a dismissal can name the new revision', async () => {
  const s = await shared(), changed = await changedSuggestion(s.tdd);
  assert.notEqual(changed.revision, s.tdd.revision);
  const first = await started(s), second = await record(s, first.envelopeBytes, proposal(s, { suggestion: changed, task: 'Add tests after the Catalog changed.' }));
  assert.equal(second.record.suggestion.revision, changed.revision); assert.equal(second.trials.length, 2);
  const suggestionRecords = second.envelope.records.filter(r => r.schema === IMPROVEMENT_SUGGESTION_SCHEMA);
  assert.deepEqual(suggestionRecords.map(r => [r.id, r.revision]), [[s.tdd.id, changed.revision]], 'one suggestion record, now at the new revision');
  const before = trialOf(second.envelope, first.id);
  assert.deepEqual(before.suggestion, { id: s.tdd.id, revision: s.tdd.revision }); assert.equal(before.change.itemSha256, s.tdd.change.itemSha256);
  assert.equal(second.record.change.itemSha256, 'c'.repeat(64), 'the new trial carries the change of the new suggestion');
  // Evaluation and measuring use the trial's own change, never the current suggestion record.
  const read = valueOf(await readTrials({ envelopeBytes: second.envelopeBytes }));
  assert.equal(read.trials.find(t => t.record.id === first.id).suggestion.revision, changed.revision);
  const measured = await record(s, second.envelopeBytes, { type: 'measure-context', id: first.id });
  assert.equal(trialOf(measured.envelope, first.id).observations.find(o => o.option === 'trial').kind, 'measured');
  // Keeping the old trial selects the change it tested, not the changed suggestion's.
  const kept = await record(s, measured.envelopeBytes, { type: 'keep', id: first.id });
  assert.deepEqual(kept.record.adopted.root, { releaseSha256: s.tdd.change.releaseSha256, itemId: 'mattpocock.tdd', scope: 'project' });
  const added = draftIntent(kept.envelope).roots.find(r => r.itemId === 'mattpocock.tdd');
  assert.equal(added.itemSha256, s.tdd.change.itemSha256);
  // Dismissing at the new revision while a trial still names the old one works, and the trial stays readable and linked.
  const open = await proposed(s);
  const dismissed = valueOf(await recordImprovement({ envelopeBytes: open.envelopeBytes, operation: { type: 'dismiss', suggestion: changed, reason: 'Not now.' }, now: tick() }));
  assert.deepEqual(dismissed.envelope.records.filter(r => r.schema === IMPROVEMENT_SUGGESTION_SCHEMA).map(r => r.revision), [changed.revision]);
  assert.equal(trialOf(dismissed.envelope, open.id).suggestion.revision, s.tdd.revision);
  assert.equal(valueOf(await readTrials({ envelopeBytes: dismissed.envelopeBytes })).trials.length, 1);
  // A trial of the revision the dismissal names is fine; the older revision is not, until the suggestion is shown again.
  assert.equal((await record(s, dismissed.envelopeBytes, proposal(s, { suggestion: changed, task: 'Another task.' }))).trials.length, 2);
  assert.equal((await refused(s, dismissed.envelopeBytes, proposal(s))).code, 'TRIAL_SUGGESTION_CHANGED');
  // Restoring the dismissal keeps the suggestion record while any trial names its id.
  const restored = valueOf(await recordImprovement({ envelopeBytes: dismissed.envelopeBytes, operation: { type: 'restore', id: s.tdd.id }, now: tick() }));
  assert.equal(restored.envelope.records.filter(r => r.schema === IMPROVEMENT_SUGGESTION_SCHEMA).length, 1);
});

// ---- 10. Portable export -----------------------------------------------------------------------------------------------------------
test('the default sharing export carries trial records, and a trial whose text looks like a local path is refused by the export guard', async () => {
  const s = await shared(), go = await started(s), bytes = await passAll(s, go.envelopeBytes, go.id);
  const declared = valueOf(await editWorkspace({ envelopeBytes: bytes, operation: { type: 'declare', label: 'Shop' }, now: tick() }));
  const exported = valueOf(await exportWorkspace({ envelopeBytes: declared.envelopeBytes }));
  assert.deepEqual(exported.excluded, { bindings: 0, batches: 0, unknownRecords: 0 });
  assert.deepEqual(exported.envelope.records.find(r => r.id === go.id), declared.envelope.records.find(r => r.id === go.id));
  assert.ok(exported.envelope.records.some(r => r.schema === IMPROVEMENT_SUGGESTION_SCHEMA));
  for (const extra of [{ task: 'Compare the tests in /home/alice/private-checkout.' }, { conditions: 'Run with token=abcdef123456 set.' }, { unknowns: ['Costs live in C:\\Users\\alice\\notes.'] }]) {
    const unsafe = await proposed(s, extra), withDeclaration = valueOf(await editWorkspace({ envelopeBytes: unsafe.envelopeBytes, operation: { type: 'declare', label: 'Shop' }, now: tick() }));
    const refusal = await exportWorkspace({ envelopeBytes: withDeclaration.envelopeBytes });
    assert.equal(refusal.status, 'refused'); assert.equal(refusal.diagnostics[0].code, 'WORKSPACE_EXPORT_UNSAFE'); assert.deepEqual(refusal.originalBytes, withDeclaration.envelopeBytes);
    assert.match(refusal.diagnostics[0].path, /^\/records\/\d+\/(task|conditions|unknowns\/0)$/);
    for (const leaked of ['alice', 'abcdef123456']) assert.equal(JSON.stringify(refusal.diagnostics).includes(leaked), false, leaked);
  }
});

// ---- 11. The service --------------------------------------------------------------------------------------------------------------------
test('host routes: trials-read and trials-record through the mixed service, including an ordinary saved policy', async () => {
  const s = await shared(), service = await createMixedService(s.maintained);
  const empty = valueOf(await service.run('trials-read', { envelopeBytes: [...s.envelopeBytes] }));
  assert.deepEqual(empty, { trials: [], mechanisms: [] });
  const proposedBy = valueOf(await service.run('trials-record', { envelopeBytes: [...s.envelopeBytes], operation: proposal(s) }));
  assert.equal(proposedBy.record.state, 'proposed'); assert.equal(proposedBy.draft.editing, 'available'); assert.deepEqual(proposedBy.draft.envelopeBytes, proposedBy.envelopeBytes);
  assert.equal(proposedBy.trials.length, 1); assert.equal(proposedBy.envelope.revision.sequence, valueOf(await readJourneyEnvelope(s.envelopeBytes)).envelope.revision.sequence + 1);
  let bytes = [...proposedBy.envelopeBytes];
  const step = async operation => { const r = valueOf(await service.run('trials-record', { envelopeBytes: bytes, operation })); bytes = [...r.envelopeBytes]; return r; };
  const id = proposedBy.record.id;
  await step({ type: 'start', id });
  await step(outcome(id, 'trial', 'catches-regression', 'passed')); await step(outcome(id, 'trial', 'stays-green', 'passed'));
  await step({ type: 'measure-context', id });
  const keptBy = await step({ type: 'keep', id });
  assert.equal(keptBy.record.state, 'kept'); assert.equal(keptBy.draft.envelope.records.find(r => r.id === id).adopted.root.itemId, 'mattpocock.tdd');
  assert.equal(draftIntent(keptBy.draft.envelope).roots.some(r => r.itemId === 'mattpocock.tdd'), true);
  const read = valueOf(await service.run('trials-read', { envelopeBytes: bytes }));
  assert.deepEqual(read.mechanisms, []); assert.equal(read.trials.length, 1); assert.equal(read.trials[0].evaluation.outcome, 'qualifying-improvement');
  assert.deepEqual(read.trials[0].evaluation.bounds.map(b => b.text), ['Context budget: 20000 tokens — advisory (not enforced)']);
  assert.deepEqual(JSON.parse(JSON.stringify(read)), read, 'the read is plain data');
  // The shipped host has no mechanism, so an enforced bound is refused, and the refusal keeps the input.
  const enforced = { id: 'spend', label: 'Spending cap', unit: 'usd', value: 5, enforcement: { kind: 'enforced', mechanism: { id: 'budget-proxy', label: 'Budget proxy' } } };
  const noCap = await service.run('trials-record', { envelopeBytes: [...s.envelopeBytes], operation: proposal(s, { bounds: [enforced] }) });
  assert.equal(noCap.status, 'refused'); assert.equal(noCap.diagnostics[0].code, 'TRIAL_BOUND_UNENFORCEABLE'); assert.deepEqual(noCap.originalBytes, s.envelopeBytes);
  // An ordinary saved policy with no draft open is wrapped by the same open path; a read writes nothing, a record saves it as a draft.
  const policy = [...s.policyBytes];
  assert.deepEqual(valueOf(await service.run('trials-read', { bytes: policy })), { trials: [], mechanisms: [] });
  const saved = valueOf(await service.run('trials-record', { bytes: policy, operation: proposal(s) }));
  assert.equal(saved.draft.envelope.records.some(r => r.schema === TRIAL_SCHEMA), true); assert.deepEqual(saved.draft.savedIntentBytes, s.policyBytes);
  assert.equal(valueOf(await service.run('trials-read', { envelopeBytes: [...saved.envelopeBytes] })).trials.length, 1);
  // Refusals.
  assert.equal((await service.run('trials-read', { envelopeBytes: 'nope' })).diagnostics[0].path, '/envelopeBytes');
  assert.equal((await service.run('trials-record', { goal: 'x' })).diagnostics[0].path, '/envelopeBytes');
  const bad = await service.run('trials-record', { envelopeBytes: [...s.envelopeBytes], operation: { type: 'start', id: 'trial-00000000000000000000000000000000' } });
  assert.equal(bad.status, 'refused'); assert.equal(bad.diagnostics[0].path, '/operation/id');
  assert.equal((await service.run('trials-record', { bytes: [1, 2, 3], operation: proposal(s) })).status, 'refused');
});

// ---- Shipped schema, public entry and purity ---------------------------------------------------------------------------------------
test('the shipped trial schema agrees structurally with the runtime records', async t => {
  let schema, journey;
  for (const base of ['../../schemas/', '../schemas/']) {
    try {
      schema = JSON.parse(await readFile(new URL(`${base}journey-record-improvement-trial-1.0.0.json`, import.meta.url), 'utf8'));
      journey = JSON.parse(await readFile(new URL(`${base}journey-envelope-1.0.0.json`, import.meta.url), 'utf8'));
      break;
    } catch { /* try next layout */ }
  }
  if (!schema) return t.skip('schema file is not present in this consumer layout; tools/write-authoring-schemas.mjs --check verifies it');
  const s = await shared(), go = await started(s);
  const measured = await record(s, go.envelopeBytes, { type: 'measure-context', id: go.id });
  const kept = await record(s, await passAll(s, measured.envelopeBytes, go.id), { type: 'keep', id: go.id, reason: 'Worked.' });
  // A trial that fails its quality check, kept with a deliberately narrower outcome.
  const weak = await started(s), failing = await observeAll(s, weak.envelopeBytes, weak.id, [outcome(weak.id, 'trial', 'catches-regression', 'failed')]);
  const narrowed = await record(s, failing, { type: 'accept-narrower', id: weak.id, qualification: 'Small modules only.' });
  const second = await started(s), revised = await record(s, second.envelopeBytes, { type: 'revise', id: second.id, proposal: revision(s) });
  const stopper = await started(s), stopped = await record(s, stopper.envelopeBytes, { type: 'stop', id: stopper.id, restoration: { status: 'partial', effects: ['An edit.'], note: 'Half done.' } });
  const records = [kept.record, narrowed.record, trialOf(revised.envelope, second.id), revised.record, stopped.record];
  assert.equal(schema.$id, TRIAL_SCHEMA); assert.equal(schema.properties.schema.const, TRIAL_SCHEMA); assert.equal(schema.additionalProperties, false); assert.equal(schema.properties.required.const, false);
  assert.deepEqual(Object.keys(schema.properties).sort(), [...new Set(records.flatMap(r => Object.keys(r)))].sort());
  const optional = ['startedAt', 'decidedAt', 'evidence', 'narrower', 'reason', 'revises', 'revisedBy', 'adopted', 'restoration'];
  assert.deepEqual([...schema.required].sort(), Object.keys(kept.record).filter(k => !optional.includes(k)).sort());
  for (const r of records) { assert.match(r.id, new RegExp(schema.properties.id.pattern)); assert.match(r.proposedAt, new RegExp(schema.properties.proposedAt.pattern)); }
  assert.deepEqual(schema.properties.state.enum, ['proposed', 'started', 'kept', 'revised', 'stopped']);
  assert.deepEqual(schema.properties.scope.enum, ['project', 'user']);
  assert.deepEqual([...schema.properties.baseline.required].sort(), Object.keys(kept.record.baseline).sort());
  assert.deepEqual([...schema.properties.quality.required].sort(), Object.keys(kept.record.quality).sort());
  assert.deepEqual([...schema.properties.bounds.items.required].sort(), Object.keys(kept.record.bounds[0]).sort());
  assert.equal(schema.properties.bounds.minItems, 1); assert.equal(schema.properties.revision.pattern, '^[a-f0-9]{64}$');
  for (const r of records) assert.match(r.revision, new RegExp(schema.properties.revision.pattern));
  assert.deepEqual([...schema.properties.adopted.required].sort(), Object.keys(kept.record.adopted).sort());
  assert.deepEqual([...schema.properties.evidence.required].sort(), Object.keys(kept.record.evidence).sort());
  assert.deepEqual([...schema.properties.narrower.required].sort(), Object.keys(narrowed.record.narrower).sort());
  assert.deepEqual([...schema.properties.restoration.required].sort(), ['effects', 'recordedAt', 'status']);
  assert.deepEqual(Object.keys(schema.properties.restoration.properties).sort(), Object.keys(stopped.record.restoration).sort());
  assert.deepEqual(schema.properties.restoration.properties.status.enum, ['proposed', 'pending', 'completed', 'partial', 'unsupported']);
  assert.deepEqual(schema.properties.evidence.properties.outcome.enum, ['qualifying-improvement', 'no-qualifying-improvement', 'inconclusive']);
  const observation = schema.properties.observations.items;
  assert.deepEqual(Object.keys(observation.properties).sort(), [...new Set(kept.record.observations.flatMap(o => Object.keys(o))), 'method', 'unknownReason'].sort());
  assert.deepEqual([...observation.required].sort(), ['id', 'kind', 'option', 'recordedAt', 'source', 'target']);
  assert.deepEqual(observation.properties.source.enum, ['person', 'host']);
  assert.deepEqual(observation.properties.target.oneOf.map(target => Object.keys(target.properties)[0]), ['dimension', 'check']);
  assert.deepEqual(observation.properties.target.oneOf[0].properties.dimension.enum, ['setup', 'indexing', 'runtime-context', 'maintenance']);
  for (const o of kept.record.observations) assert.match(o.id, new RegExp(observation.properties.id.pattern));
  const rules = journey.properties.records.items.allOf.map(rule => [rule.if.properties.schema.const, rule.then.$ref]);
  assert.ok(rules.some(([a, b]) => a === TRIAL_SCHEMA && b === TRIAL_SCHEMA));
});

test('the public entry exposes the trial operations only, and the trial modules import only the allowed seams and call nothing outside', async () => {
  assert.deepEqual(Object.keys(publicApi).sort(), ['DIMENSION_LABELS', 'TRIAL_MECHANISMS_NONE', 'TRIAL_PRODUCER', 'TRIAL_SCHEMA', 'evaluateTrial', 'proposeTrial', 'readTrials', 'recordTrial']);
  assert.deepEqual([...TRIAL_MECHANISMS_NONE], []); assert.equal(Object.isFrozen(TRIAL_MECHANISMS_NONE), true);
  const allowed = [/^\.\/intake\.mjs$/, /^\.\/journey\.mjs$/, /^\.\/headless\.mjs$/, /^\.\/maintenance-record\.mjs$/, /^\.\/improvement-record\.mjs$/, /^\.\/workspace-record\.mjs$/, /^\.\/trial-record\.mjs$/, /^@aihq\/core\/report$/];
  for (const name of ['trial-record.mjs', 'trials.mjs']) {
    const source = await readFile(new URL(`./${name}`, import.meta.url), 'utf8');
    const specifiers = [...source.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s+'([^']+)'/gm)].map(match => match[1]);
    assert.ok(specifiers.length > 0, name);
    for (const specifier of specifiers) assert.ok(allowed.some(pattern => pattern.test(specifier)), `${name} imports ${specifier}`);
    assert.equal(/\bimport\s*\(/.test(source), false, `${name} dynamic import`);
    for (const forbidden of [/fetch\(/, /node:/, /child_process/, /http/i, /WebSocket/, /XMLHttpRequest/, /setTimeout/, /setInterval/, /Math\.random/, /Date\.now/, /new Date\(\)/, /\bprocess\b/, /\bBuffer\b/, /\bwindow\b/, /\bdocument\b/, /localStorage/])
      assert.doesNotMatch(source, forbidden, `${name} ${forbidden}`);
  }
});

test('planning, evaluating and keeping a trial never touch the network or a model', async () => {
  const s = await shared(), TRAPPED = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'], saved = Object.fromEntries(TRAPPED.map(name => [name, globalThis[name]])), calls = [];
  for (const name of TRAPPED) globalThis[name] = function trapped(...args) { calls.push([name, args]); throw new Error(`trials must not use ${name}`); };
  try {
    const go = await started(s), bytes = await passAll(s, go.envelopeBytes, go.id);
    await record(s, bytes, { type: 'measure-context', id: go.id }); await record(s, bytes, { type: 'keep', id: go.id }); valueOf(await readTrials({ envelopeBytes: bytes }));
    valueOf(await proposeTrial({ envelopeBytes: s.envelopeBytes, suggestion: s.tdd, scope: 'project', task: 'x', quality: { outcome: 'y', checks: [{ id: 'z', text: 'w' }] }, conditions: 'c', bounds: [{ id: 'time-box', label: 'Time box', unit: 'hours', value: 2, enforcement: { kind: 'advisory' } }], inventories: s.inventories, now: tick() }));
  } finally { for (const name of TRAPPED) { if (saved[name] === undefined) delete globalThis[name]; else globalThis[name] = saved[name]; } }
  assert.deepEqual(calls, []);
});

// ---- 12. Spec review: baseline drift, at least one bound, an explicit revision, one-sided overhead --------------------------------------
test('measure-context never measures against a draft the trial did not start from: both sides are unknown with the reason, and revising measures again', async () => {
  const s = await shared(), go = await started(s), digestOf = async intent => digestBytes(encode(stable(intent)));
  // Another trial of a different item is kept, which edits the draft this trial was proposed against.
  const other = await record(s, go.envelopeBytes, proposal(s, { suggestion: s.claude, task: 'Set up the client.' })), otherId = other.record.id;
  const running = await record(s, other.envelopeBytes, { type: 'start', id: otherId }), adopted = await record(s, running.envelopeBytes, { type: 'keep', id: otherId });
  assert.notEqual(trialOf(adopted.envelope, go.id).baseline.draftSha256, await digestOf(draftIntent(adopted.envelope)), 'the draft moved on after the trial was proposed');
  const measured = await record(s, adopted.envelopeBytes, { type: 'measure-context', id: go.id });
  assert.deepEqual(measured.record.observations.map(o => o.option).sort(), ['baseline', 'trial']);
  for (const observation of measured.record.observations) {
    assert.deepEqual([observation.source, observation.kind, observation.target, 'value' in observation], ['host', 'unknown', { dimension: 'runtime-context' }, false]);
    assert.match(observation.unknownReason, /The draft changed since this trial was proposed/); assert.match(observation.unknownReason, /revise the trial to measure again/);
  }
  const row = measured.trials.find(t => t.record.id === go.id).evaluation.overhead.find(r => r.dimension === 'runtime-context');
  assert.deepEqual([row.status, row.reason], ['unavailable', 'unknown-value']);
  for (const field of ['before', 'after', 'absoluteDifference', 'direction', 'percentage']) assert.equal(field in row, false, `${field} is never claimed for an unknown size`);
  // A trial proposed against the unchanged draft still measures.
  const fresh = await started(s), same = await record(s, fresh.envelopeBytes, { type: 'measure-context', id: fresh.id });
  assert.deepEqual(same.record.observations.map(o => o.kind), ['measured', 'measured']);
  // Revising proposes against the current draft, so the revised trial can be measured.
  const revised = await record(s, measured.envelopeBytes, { type: 'revise', id: go.id, proposal: revision(s) });
  const running2 = await record(s, revised.envelopeBytes, { type: 'start', id: revised.record.id }), again = await record(s, running2.envelopeBytes, { type: 'measure-context', id: revised.record.id });
  assert.equal(again.record.baseline.draftSha256, await digestOf(draftIntent(again.envelope)));
  assert.deepEqual(again.record.observations.map(o => o.kind), ['measured', 'measured']);
});

test('a bounded trial needs at least one bound: proposing and revising without one is refused as TRIAL_BOUND_REQUIRED', async () => {
  const s = await shared();
  const { bounds: _omitted, ...withoutBounds } = proposal(s);
  for (const operation of [withoutBounds, proposal(s, { bounds: [] }), proposal(s, { bounds: undefined })]) {
    const d = await refused(s, s.envelopeBytes, operation);
    assert.equal(d.code, 'TRIAL_BOUND_REQUIRED'); assert.equal(d.path, '/operation/bounds'); assert.match(d.message, /at least one advisory or enforced bound/);
  }
  const go = await started(s), { bounds: _bounds, ...noBounds } = revision(s);
  for (const fields of [noBounds, { ...noBounds, bounds: [] }]) {
    const d = await refused(s, go.envelopeBytes, { type: 'revise', id: go.id, proposal: fields });
    assert.equal(d.code, 'TRIAL_BOUND_REQUIRED'); assert.equal(d.path, '/operation/proposal/bounds');
  }
  const viaHelper = await proposeTrial({ envelopeBytes: s.envelopeBytes, suggestion: s.tdd, scope: 'project', task: 'x', quality: { outcome: 'y', checks: [{ id: 'z', text: 'w' }] }, conditions: 'c', inventories: s.inventories, now: tick() });
  assert.equal(viaHelper.status, 'refused'); assert.equal(viaHelper.diagnostics[0].code, 'TRIAL_BOUND_REQUIRED');
  // Quality is still required first, and a malformed bound list is still ordinary invalid input.
  assert.equal((await refused(s, s.envelopeBytes, proposal(s, { quality: undefined, bounds: [] }))).code, 'TRIAL_QUALITY_REQUIRED');
  assert.equal((await refused(s, s.envelopeBytes, proposal(s, { bounds: 'none' }))).code, 'INPUT_INVALID');
  // One advisory bound is enough.
  assert.equal((await proposed(s)).record.bounds.length, 1);
});

test('the trial revision is derived from the record, recomputed by every write, and a record whose revision does not derive is refused', async () => {
  const s = await shared(), p = await proposed(s);
  const derive = async trial => { const { revision: _omitted, ...rest } = trial; return digestBytes(encode(stable(rest))); };
  assert.match(p.record.revision, /^[a-f0-9]{64}$/); assert.equal(p.record.revision, await derive(p.record), 'the revision is the digest of the record without it');
  // Every lifecycle write and every observation gives the trial a new revision, and each one derives.
  const seen = [p.record.revision];
  const steps = [{ type: 'start', id: p.id }, outcome(p.id, 'trial', 'catches-regression', 'passed'), outcome(p.id, 'trial', 'catches-regression', 'failed'), overhead(p.id, 'baseline', 'setup', 10, 'minutes', 'declared'),
    { type: 'measure-context', id: p.id }, { type: 'accept-narrower', id: p.id, qualification: 'Small modules only.' }, { type: 'stop', id: p.id, restoration: { status: 'pending' } }, { type: 'restoration', id: p.id, status: 'completed', effects: [] }];
  let bytes = p.envelopeBytes, last;
  for (const operation of steps) {
    last = await record(s, bytes, operation); bytes = last.envelopeBytes;
    assert.equal(last.record.revision, await derive(last.record), operation.type);
    assert.equal(seen.includes(last.record.revision), false, `${operation.type} gives a new revision`); seen.push(last.record.revision);
  }
  // A kept trial and a revision (both trials) are sealed as well.
  const go = await started(s), kept = await record(s, go.envelopeBytes, { type: 'keep', id: go.id });
  assert.equal(kept.record.revision, await derive(kept.record)); assert.notEqual(kept.record.revision, trialOf(go.envelope, go.id).revision);
  const second = await started(s), revised = await record(s, second.envelopeBytes, { type: 'revise', id: second.id, proposal: revision(s) });
  for (const trial of [revised.revised, revised.record]) assert.equal(trial.revision, await derive(trial));
  assert.notEqual(revised.revised.revision, trialOf(second.envelope, second.id).revision);
  // It round-trips through read and write unchanged.
  const read = valueOf(await readJourneyEnvelope(bytes));
  assert.equal(trialOf(read.envelope, p.id).revision, last.record.revision);
  const written = valueOf(await writeJourneyEnvelope({ savedIntentBytes: read.savedIntentBytes, records: read.records, previous: read }));
  assert.equal(trialOf(written.envelope, p.id).revision, last.record.revision);
  assert.equal(valueOf(await readTrials({ envelopeBytes: written.envelopeBytes })).trials.find(t => t.record.id === p.id).record.revision, last.record.revision);
  // Edited without recomputing the revision, a trial is refused on read, and on write.
  const refusedRead = async mutate => { const result = await readJourneyEnvelope(await resign(kept.envelopeBytes, doc => mutate(doc.records.find(r => r.id === go.id)))); assert.equal(result.status, 'refused'); return result.diagnostics[0]; };
  for (const mutate of [trial => { trial.task = 'A different task.'; }, trial => { trial.evidence.outcome = 'no-qualifying-improvement'; }, trial => { trial.reason = 'Edited later.'; }, trial => { trial.bounds[0].value = 1; }]) {
    const d = await refusedRead(mutate); assert.equal(d.code, 'INPUT_INVALID'); assert.match(d.path, /^\/records\/\d+\/revision$/);
  }
  assert.match((await refusedRead(trial => { delete trial.revision; })).path, /^\/records\/\d+$/, 'a record without a revision is not a closed trial');
  const readKept = valueOf(await readJourneyEnvelope(kept.envelopeBytes)), stale = structuredClone(readKept.records.find(r => r.id === go.id)); stale.task = 'A different task.';
  const refusedWrite = await writeJourneyEnvelope({ savedIntentBytes: readKept.savedIntentBytes, records: readKept.records.map(r => r.id === go.id ? stale : r), previous: readKept });
  assert.equal(refusedWrite.status, 'refused'); assert.match(refusedWrite.diagnostics[0].path, /^\/records\/\d+\/revision$/);
});

test('an overhead row with one recorded side carries that side, with its unknown reason, and says which side is missing', async () => {
  const s = await shared(), go = await started(s);
  const bytes = await observeAll(s, go.envelopeBytes, go.id, [overhead(go.id, 'baseline', 'indexing', 100, 'bytes'),
    { type: 'observe', observation: { option: 'trial', target: { dimension: 'maintenance' }, kind: 'unknown', unknownReason: 'Provider invoice unavailable' } }]);
  const rows = valueOf(await readTrials({ envelopeBytes: bytes })).trials[0].evaluation.overhead, row = dimension => rows.find(r => r.dimension === dimension);
  assert.deepEqual([row('indexing').status, row('indexing').reason, row('indexing').baseline.value.amount, 'trial' in row('indexing')], ['not-observed', 'trial-not-observed', 100, false]);
  assert.deepEqual([row('maintenance').status, row('maintenance').reason, row('maintenance').trial.unknownReason, 'baseline' in row('maintenance')], ['not-observed', 'baseline-not-observed', 'Provider invoice unavailable', false]);
  assert.deepEqual([row('setup').status, row('setup').reason, 'baseline' in row('setup'), 'trial' in row('setup')], ['not-observed', 'not-observed', false, false]);
});
