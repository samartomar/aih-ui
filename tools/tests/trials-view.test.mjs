import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthoringClient } from '../../src/app/authoring-client.js';
import * as trials from '../../src/app/trials-view.js';
import { createImprovementsView } from '../../src/app/improvements-view.js';
const { proposeOperation, boundText, outcomeText, stateText, restorationText, overheadText, createTrialsView } = trials;
const ok = value => ({ status: 'ok', value });
const suggestion = { id: 'suggestion-one', revision: 'r', rulesVersion: '1', scope: 'project', change: { itemId: 'helper' }, triggers: [], references: [], facts: [], unknowns: [], label: 'Helper', prompt: 'private presentation' };
const quality = { outcome: 'Correct result', checks: [{ id: 'check-1', text: 'Tests pass' }] };
const change = { kind: 'add-item', itemId: 'helper', releaseSha256: 'a'.repeat(64), itemSha256: 'b'.repeat(64) };
const record = { id: 'trial-one', change, scope: 'project', state: 'proposed', proposedAt: '2026-10-16T12:00:00Z', quality, bounds: [], unknowns: [] };
const evaluation = { outcome: 'inconclusive', quality: { options: { baseline: { state: 'unknown', passed: 0, failed: 0, unknown: 1 }, trial: { state: 'unknown', passed: 0, failed: 0, unknown: 1 } } }, overhead: [] };
class Node {
  constructor(tag, cls, text = '') { Object.assign(this, { tag, className: cls, textContent: text, children: [], listeners: {}, dataset: {} }); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, action) { this.listeners[name] = action; }
}
const elements = node => [node, ...node.children.flatMap(elements)];
const textOf = node => elements(node).map(n => n.textContent).join(' ');
const find = (view, text) => elements(view.node).find(n => n.tag === 'button' && n.textContent === text);
const field = (view, label) => elements(view.node).find(n => n['aria-label'] === label);
const el = (tag, cls, text) => new Node(tag, cls, text);
const button = (label, action) => { const n = el('button', '', label); n.addEventListener('click', action); return n; };
function view(state = 'proposed', options = {}) {
  const calls = [], statuses = [];
  const client = { draft: {}, revision: 1, readTrials: async () => ok({ trials: [{ record: { ...record, state }, suggestion, evaluation }], mechanisms: [] }), recordTrial: async op => { calls.push(op); return ok({}); }, ...options };
  return { ...createTrialsView({ client, el, button, showStatus: text => statuses.push(text) }), calls, statuses, client };
}
test('exact bound, outcome, state and restoration wording', () => {
  const bound = { label: 'Time box', value: 2, unit: 'hours', enforcement: { kind: 'advisory' } };
  assert.equal(boundText(bound), 'Time box: 2 hours — advisory (not enforced)');
  assert.equal(boundText({ ...bound, enforcement: { kind: 'enforced', mechanism: { label: 'Timer' } } }), 'Time box: 2 hours — enforced by Timer');
  assert.equal(outcomeText(evaluation), "Inconclusive: the trial's quality is not known yet.");
  assert.equal(outcomeText({ outcome: 'no-qualifying-improvement' }), 'No demonstrated qualifying improvement: the trial did not meet the quality bar.');
  assert.equal(outcomeText({ outcome: 'qualifying-improvement' }), 'The trial met the quality bar.');
  assert.equal(stateText({ state: 'kept', evidence: { outcome: 'inconclusive' } }), 'Kept. The evidence is inconclusive: this does not show an improvement.');
  assert.equal(stateText({ state: 'kept', evidence: { outcome: 'no-qualifying-improvement' } }), 'Kept without a demonstrated qualifying improvement.');
  assert.equal(stateText({ state: 'kept', evidence: { outcome: 'qualifying-improvement' } }), 'Kept. The trial met the quality bar.');
  assert.equal(stateText({ state: 'stopped' }), 'Stopped. Evaluation ended. This does not mean anything was undone.');
  for (const state of ['proposed', 'started', 'revised']) assert.equal(stateText({ state }), `${state[0].toUpperCase()}${state.slice(1)}.`);
  assert.equal(restorationText({}), 'No restoration requested.');
  for (const status of ['proposed', 'pending', 'completed', 'partial', 'unsupported']) assert.equal(restorationText({ restoration: { status } }), `Restoration: ${status} (recorded by you)`);
});
test('overhead uses Core results, including unavailable values and zero baseline', () => {
  // Core's percentage is (before − after) / before × 100: negative for an increase.
  const row = { status: 'available', before: 24009, after: 36362, unit: 'bytes', absoluteDifference: 12353, direction: 'increase', percentage: -51.451539006206005 };
  assert.equal(overheadText(row), '24009 → 36362 bytes, increase of 12353 bytes (51.5% more than the baseline)');
  assert.equal(overheadText({ ...row, before: 20, after: 15, absoluteDifference: 5, direction: 'decrease', percentage: 25 }), '20 → 15 bytes, decrease of 5 bytes (25% less than the baseline)');
  assert.equal(overheadText({ ...row, after: 24009, absoluteDifference: 0, direction: 'unchanged', percentage: 0 }), '24009 → 24009 bytes, unchanged');
  assert.equal(overheadText({ ...row, before: 0, after: 15, absoluteDifference: 15, percentage: null }), '0 → 15 bytes, increase of 15 bytes (no percentage: zero baseline)');
  assert.equal(overheadText({ status: 'not-observed' }), 'not observed');
  assert.equal(overheadText({ status: 'not-observed', reason: 'not-observed' }), 'not observed');
  assert.equal(overheadText({ status: 'unavailable', reason: 'unsupported-unit', baseline: { value: { amount: 10, unit: 'min' } }, trial: { value: { amount: 15, unit: 'min' } } }), '10 min → 15 min — not compared by Core (unsupported-unit)');
});
test('propose operation whitelists suggestion fields and includes the plan', () => {
  const form = { scope: 'user', task: 'Task', quality, conditions: 'Same client', bounds: [], unknowns: ['Cost unknown'] };
  const { label, prompt, ...saved } = suggestion;
  assert.deepEqual(proposeOperation(suggestion, form), { type: 'propose', suggestion: saved, ...form });
});
test('planning requires quality and a bound before proposing, supports rows and no cap wording', async () => {
  const built = view(); await built.open(); built.plan(suggestion);
  assert.equal(find(built, 'Propose trial').disabled, true);
  field(built, 'Acceptable outcome').value = 'Correct'; await field(built, 'Acceptable outcome').listeners.input();
  assert.equal(find(built, 'Propose trial').disabled, true);
  field(built, 'Quality check 1').value = 'Pass'; await field(built, 'Quality check 1').listeners.input();
  assert.equal(find(built, 'Propose trial').disabled, true, 'quality alone is not enough: the prefilled bound has no value yet');
  field(built, 'Bound 1 value').value = '2'; await field(built, 'Bound 1 value').listeners.input();
  assert.equal(find(built, 'Propose trial').disabled, false);
  assert.match(textOf(built.node), /No enforcement mechanism is available here, so no bound is a cap\./);
  await find(built, 'Add quality check').listeners.click(); assert.ok(field(built, 'Quality check 2'));
  await find(built, 'Propose trial').listeners.click();
  assert.equal(built.calls[0].type, 'propose'); assert.equal(built.calls[0].quality.checks[0].text, 'Pass');
  assert.deepEqual(built.calls[0].bounds, [{ id: 'bound-1', label: 'Time box', value: 2, unit: 'hours', enforcement: { kind: 'advisory' } }]);
});
test('the plan starts with one advisory bound row and needs a labelled, non-negative, finite, united bound', async () => {
  const built = view(); await built.open(); built.plan(suggestion);
  assert.deepEqual(['Bound 1 label', 'Bound 1 value', 'Bound 1 unit', 'Bound 1 enforcement'].map(label => field(built, label).value), ['Time box', '', 'hours', 'advisory']);
  assert.equal(field(built, 'Bound 2 label'), undefined);
  field(built, 'Acceptable outcome').value = 'Correct'; await field(built, 'Acceptable outcome').listeners.input();
  field(built, 'Quality check 1').value = 'Pass'; await field(built, 'Quality check 1').listeners.input();
  const disabled = () => find(built, 'Propose trial').disabled;
  const setBound = async (name, value) => { field(built, name).value = value; await field(built, name).listeners.input(); };
  for (const bad of ['', '  ', '-1', 'abc', 'Infinity']) { await setBound('Bound 1 value', bad); assert.equal(disabled(), true, `value ${JSON.stringify(bad)}`); }
  await setBound('Bound 1 value', '0'); assert.equal(disabled(), false, 'zero is a valid bound');
  await setBound('Bound 1 label', ' '); assert.equal(disabled(), true); await setBound('Bound 1 label', 'Time box'); assert.equal(disabled(), false);
  await setBound('Bound 1 unit', ''); assert.equal(disabled(), true); await setBound('Bound 1 unit', 'hours'); assert.equal(disabled(), false);
  // Removing the only bound leaves the plan unproposable; a row left incomplete beside a complete one is not recorded.
  await find(built, 'Remove bound').listeners.click(); assert.equal(disabled(), true);
  await find(built, 'Add bound').listeners.click(); assert.equal(field(built, 'Bound 1 label').value, ''); assert.equal(disabled(), true);
  await setBound('Bound 1 label', 'Spend'); await setBound('Bound 1 value', '5'); await setBound('Bound 1 unit', 'USD'); assert.equal(disabled(), false);
  await find(built, 'Add bound').listeners.click(); assert.equal(disabled(), false);
  await find(built, 'Propose trial').listeners.click();
  assert.deepEqual(built.calls[0].bounds, [{ id: 'bound-2', label: 'Spend', value: 5, unit: 'USD', enforcement: { kind: 'advisory' } }]);
});
test('lifecycle controls follow state; stopped restoration leaves disposition unchanged', async () => {
  for (const state of ['proposed', 'started', 'kept', 'revised', 'stopped']) {
    const built = view(state); await built.open();
    for (const label of ['Start', 'Revise', 'Stop', 'Keep', 'Record observation', 'Measure configured context', 'Record restoration', 'Accept narrower outcome']) {
      const expected = state === 'proposed' ? ['Start', 'Revise', 'Stop'] : state === 'started' ? ['Revise', 'Stop', 'Keep', 'Record observation', 'Measure configured context', 'Accept narrower outcome'] : state === 'stopped' ? ['Record restoration', 'Accept narrower outcome'] : state === 'kept' ? ['Accept narrower outcome'] : [];
      assert.equal(!!find(built, label), expected.includes(label), `${state}: ${label}`);
    }
    if (state === 'stopped') {
      field(built, 'Restoration status').value = 'partial'; field(built, 'Restoration effects').value = 'Files remain';
      await find(built, 'Record restoration').listeners.click();
      assert.deepEqual(built.calls[0], { type: 'restoration', id: record.id, status: 'partial', effects: ['Files remain'] });
      assert.ok(textOf(built.node).includes(stateText({ state })));
    }
  }
});
test('kept inconclusive wording makes no extra improvement claim; quality precedes overhead', async () => {
  const built = view('kept', { readTrials: async () => ok({ trials: [{ record: { ...record, state: 'kept', evidence: { outcome: 'inconclusive' } }, suggestion: { change: { itemId: 'helper' } }, evaluation }], mechanisms: [] }) });
  await built.open(); const text = textOf(built.node);
  assert.equal((text.match(/improv/gi) ?? []).length, 1);
  assert.ok(text.indexOf('Quality') < text.indexOf('Overhead'));
});
test('client uses trial endpoints and supersedes reads after revision changes', async t => {
  const previous = globalThis.fetch, calls = []; let finish;
  globalThis.fetch = async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => calls.length === 3 ? new Promise(resolve => { finish = resolve; }) : ok(calls.length === 1 ? { trials: [], mechanisms: [] } : { draft: { envelopeBytes: [2], savedIntentBytes: [9] } }) }; };
  t.after(() => { globalThis.fetch = previous; });
  const client = createAuthoringClient(); client.publish({ policyBytes: [7], intent: {} });
  await client.readTrials(); await client.recordTrial({ type: 'start', id: 'x' });
  assert.equal(calls[0].url, '/api/authoring-trials-read'); assert.deepEqual(calls[0].body.bytes, [7]);
  assert.equal(calls[1].url, '/api/authoring-trials-record'); assert.deepEqual(client.draft.envelopeBytes, Uint8Array.of(2));
  const reading = client.readTrials(); await Promise.resolve(); client.invalidate(); finish(ok({ trials: [] })); assert.equal((await reading).status, 'superseded');
});
test('Plan a trial appears only for active suggestions with callback', async () => {
  const calls = [], client = { draft: {}, revision: 1, checkImprovements: async () => ok({ leading: suggestion, dismissed: [suggestion], preserved: [{ suggestion }] }) };
  for (const enabled of [false, true]) {
    const built = createImprovementsView({ client, el, button, showStatus() {}, loadClients: async () => [], ...(enabled ? { onPlanTrial: s => calls.push(s) } : {}) }); await built.open();
    assert.equal(elements(built.node).filter(n => n.tag === 'button' && n.textContent === 'Plan a trial').length, enabled ? 1 : 0);
    if (enabled) await find(built, 'Plan a trial').listeners.click();
  }
  assert.deepEqual(calls, [suggestion]);
});
test('recording makes all controls inert, refusal preserves cards, and changed revisions retire them', async () => {
  let finish;
  const built = view('started', { recordTrial: () => new Promise(resolve => { finish = resolve; }) });
  await built.open(); const recording = find(built, 'Keep').listeners.click();
  assert.ok(elements(built.node).filter(n => ['button', 'input', 'select', 'textarea'].includes(n.tag)).every(n => n.disabled));
  finish({ status: 'refused', diagnostics: [{ message: 'Cannot keep this item.' }] }); await recording;
  assert.equal(built.statuses.at(-1), 'Cannot keep this item.'); assert.ok(find(built, 'Keep'));
  built.client.revision++; built.render(); assert.equal(find(built, 'Keep'), undefined);
  built.client.draft = undefined; built.render(); assert.equal(built.node.hidden, true);
});
test('observations send quality results, estimation methods and explicit unknowns', async () => {
  const built = view('started'); await built.open();
  field(built, 'Observation target').value = 'check:check-1'; field(built, 'Observation kind').value = 'estimated';
  field(built, 'Method id').value = 'review'; field(built, 'Method version').value = '1.0.0';
  await find(built, 'Record observation').listeners.click();
  assert.deepEqual(built.calls[0], { type: 'observe', id: record.id, observation: { option: 'baseline', target: { check: 'check-1' }, kind: 'estimated', value: { amount: 'passed', unit: 'outcome' }, method: { id: 'review', version: '1.0.0' } } });
  field(built, 'Observation kind').value = 'unknown'; field(built, 'Unknown reason').value = 'No measurement';
  await find(built, 'Record observation').listeners.click();
  assert.deepEqual(built.calls[1].observation, { option: 'baseline', target: { dimension: 'setup' }, kind: 'unknown', unknownReason: 'No measurement' });
});
test('planning offers only mechanisms reported by the last read and keeps removed row ids unique', async () => {
  const built = view('proposed', { readTrials: async () => ok({ trials: [], mechanisms: [{ id: 'timer', label: 'Timer' }] }) }); await built.open(); built.plan(suggestion);
  const enforcement = field(built, 'Bound 1 enforcement');
  assert.deepEqual(enforcement.children.map(n => n.textContent), ['Advisory (not enforced)', 'Enforced by Timer']);
  enforcement.value = 'timer'; field(built, 'Bound 1 label').value = 'Time'; field(built, 'Bound 1 value').value = '2'; field(built, 'Bound 1 unit').value = 'hours';
  field(built, 'Acceptable outcome').value = 'Correct'; field(built, 'Quality check 1').value = 'Pass';
  await find(built, 'Add quality check').listeners.click(); await find(built, 'Remove quality check').listeners.click();
  field(built, 'Quality check 1').value = 'Pass again';
  await find(built, 'Propose trial').listeners.click();
  assert.deepEqual(built.calls[0].bounds[0], { id: 'bound-1', label: 'Time', value: 2, unit: 'hours', enforcement: { kind: 'enforced', mechanism: { id: 'timer', label: 'Timer' } } });
  assert.equal(built.calls[0].quality.checks[0].id, 'check-2');
});
test('superseded view reads do not display stale trials, and list order is newest first', async () => {
  let finish;
  const built = view('proposed', { readTrials: () => new Promise(resolve => { finish = resolve; }) });
  const opening = built.open(); built.client.revision++; finish(ok({ trials: [{ record, suggestion, evaluation }], mechanisms: [] })); await opening;
  assert.equal(find(built, 'Start'), undefined);
  built.client.readTrials = async () => ok({ trials: [{ record, suggestion, evaluation }, { record: { ...record, id: 'newest', proposedAt: '2026-10-17T12:00:00Z' }, suggestion, evaluation }], mechanisms: [] });
  await built.open(); assert.deepEqual(elements(built.node).filter(n => n.dataset.trialId).map(n => n.dataset.trialId), ['newest', 'trial-one']);
});
test('start, context measurement, keep, stop and narrower controls record closed operations', async () => {
  const proposed = view(); await proposed.open(); await find(proposed, 'Start').listeners.click();
  assert.deepEqual(proposed.calls[0], { type: 'start', id: record.id });
  const started = view('started'); await started.open(); await find(started, 'Measure configured context').listeners.click();
  assert.deepEqual(started.calls[0], { type: 'measure-context', id: record.id });
  field(started, 'Decision reason').value = 'Worth keeping'; await find(started, 'Keep').listeners.click();
  assert.deepEqual(started.calls[1], { type: 'keep', id: record.id, reason: 'Worth keeping' });
  field(started, 'Request restoration').value = 'proposed'; await find(started, 'Stop').listeners.click();
  assert.deepEqual(started.calls[2], { type: 'stop', id: record.id, restoration: { status: 'proposed' } });
  field(started, 'Narrower outcome qualification').value = 'Only useful for this task'; await find(started, 'Accept narrower outcome').listeners.click();
  assert.deepEqual(started.calls[3], { type: 'accept-narrower', id: record.id, qualification: 'Only useful for this task' });
  const qualifying = view('started', { readTrials: async () => ok({ trials: [{ record: { ...record, state: 'started' }, suggestion, evaluation: { ...evaluation, outcome: 'qualifying-improvement' } }], mechanisms: [] }) });
  await qualifying.open(); assert.equal(find(qualifying, 'Accept narrower outcome'), undefined);
});
test('revision starts from the existing quality bar and bounds; refusal preserves typed proposal', async () => {
  const bounds = [{ id: 'time', label: 'Time box', unit: 'hours', value: 2, enforcement: { kind: 'advisory' } }];
  const calls = [], built = view('proposed', { readTrials: async () => ok({ trials: [{ record: { ...record, bounds }, suggestion, evaluation }], mechanisms: [] }), recordTrial: async operation => { calls.push(operation); return { status: 'refused', diagnostics: [{ message: 'Try again' }] }; } });
  await built.open(); await find(built, 'Revise').listeners.click();
  assert.equal(field(built, 'Acceptable outcome').value, quality.outcome);
  assert.equal(field(built, 'Quality check 1').value, quality.checks[0].text);
  assert.deepEqual(['Bound 1 label', 'Bound 1 value', 'Bound 1 unit'].map(label => field(built, label).value), ['Time box', '2', 'hours']);
  assert.equal(find(built, 'Propose revision').disabled, false);
  field(built, 'Acceptable outcome').value = 'Updated quality'; await find(built, 'Propose revision').listeners.click();
  assert.equal(calls[0].type, 'revise'); assert.deepEqual(calls[0].proposal.bounds, bounds);
  assert.equal(field(built, 'Acceptable outcome').value, 'Updated quality'); assert.equal(built.statuses.at(-1), 'Try again');
});
test('narrower acceptance and restoration effects remain separate from outcome and disposition', async () => {
  const stopped = { ...record, state: 'stopped', evidence: { outcome: 'no-qualifying-improvement' }, narrower: { qualification: 'For examples only' }, restoration: { status: 'partial', effects: ['One file remains'] }, reason: 'Quality failed' };
  const built = view('stopped', { readTrials: async () => ok({ trials: [{ record: stopped, suggestion, evaluation }], mechanisms: [] }) }); await built.open();
  const text = textOf(built.node);
  for (const line of ['Accepted a narrower outcome: For examples only', 'Decision reason: Quality failed', 'One file remains', stateText(stopped), restorationText(stopped), outcomeText(evaluation, stopped)]) assert.ok(text.includes(line), line);
});
test('a kept trial without a qualifying outcome can still accept a narrower outcome; a qualifying one cannot', async () => {
  const kept = (outcome, extra = {}) => view('kept', { readTrials: async () => ok({ trials: [{ record: { ...record, state: 'kept', evidence: { outcome }, ...extra }, suggestion, evaluation: { ...evaluation, outcome } }], mechanisms: [] }) });
  const inconclusive = kept('inconclusive'); await inconclusive.open();
  field(inconclusive, 'Narrower outcome qualification').value = 'Small modules only'; await find(inconclusive, 'Accept narrower outcome').listeners.click();
  assert.deepEqual(inconclusive.calls[0], { type: 'accept-narrower', id: record.id, qualification: 'Small modules only' });
  assert.ok(find(inconclusive, 'Accept narrower outcome'));
  const failed = kept('no-qualifying-improvement'); await failed.open(); assert.ok(find(failed, 'Accept narrower outcome'));
  const qualifying = kept('qualifying-improvement'); await qualifying.open(); assert.equal(find(qualifying, 'Accept narrower outcome'), undefined);
});
test('the card heading falls back to the trial change when the suggestion has no label', async () => {
  const heading = async (shown, extra = {}) => { const built = view('proposed', { readTrials: async () => ok({ trials: [{ record: { ...record, ...extra }, suggestion: shown, evaluation }], mechanisms: [] }) }); await built.open(); return elements(built.node).find(n => n.tag === 'h4' && n.textContent !== 'Plan a trial').textContent; };
  assert.equal(await heading({ ...suggestion, label: 'Helper skill' }), 'Helper skill');
  assert.equal(await heading({ change: { itemId: 'other-current-item' } }), 'helper');
  assert.equal(await heading(undefined), 'helper');
});
test('bounds are worded as the module words them, preferring the evaluation text', async () => {
  const bounds = [{ id: 'time', label: 'Time box', unit: 'hours', value: 2, enforcement: { kind: 'advisory' } }, { id: 'spend', label: 'Spending', unit: 'USD', value: 5, enforcement: { kind: 'enforced', mechanism: { id: 'meter', label: 'Meter' } } }];
  const withBounds = texts => view('proposed', { readTrials: async () => ok({ trials: [{ record: { ...record, bounds }, suggestion, evaluation: { ...evaluation, bounds: texts } }], mechanisms: [] }) });
  const plain = withBounds(undefined); await plain.open();
  assert.match(textOf(plain.node), /Time box: 2 hours — advisory \(not enforced\)/); assert.match(textOf(plain.node), /Spending: 5 USD — enforced by Meter/);
  const worded = withBounds([{ ...bounds[0], text: 'Time box: 2 hours — advisory (not enforced)' }, { ...bounds[1], text: 'Spending: 5 USD — recorded as enforced by Meter, but that mechanism is not available here, so it is not a cap' }]); await worded.open();
  assert.match(textOf(worded.node), /recorded as enforced by Meter, but that mechanism is not available here, so it is not a cap/);
  assert.doesNotMatch(textOf(worded.node), /Spending: 5 USD — enforced by Meter/);
});
test('an overhead row with one recorded side shows that side and says which side is missing', async () => {
  const unknown = { kind: 'unknown', unknownReason: 'Provider invoice unavailable' }, measured = { kind: 'measured', value: { amount: 100, unit: 'bytes' } };
  assert.equal(overheadText({ status: 'not-observed', reason: 'trial-not-observed', baseline: unknown }), 'Baseline: unknown (Provider invoice unavailable); trial: not observed — not compared');
  assert.equal(overheadText({ status: 'not-observed', reason: 'trial-not-observed', baseline: measured }), 'Baseline: 100 bytes; trial: not observed — not compared');
  assert.equal(overheadText({ status: 'not-observed', reason: 'baseline-not-observed', trial: unknown }), 'Baseline: not observed; trial: unknown (Provider invoice unavailable) — not compared');
  assert.equal(overheadText({ status: 'not-observed', reason: 'baseline-not-observed', trial: measured }), 'Baseline: not observed; trial: 100 bytes — not compared');
  assert.equal(overheadText({ status: 'not-observed', reason: 'not-observed' }), 'not observed');
  const overhead = [{ dimension: 'indexing', label: 'Indexing', status: 'not-observed', reason: 'trial-not-observed', baseline: unknown }, { dimension: 'maintenance', label: 'Maintenance', status: 'not-observed', reason: 'baseline-not-observed', trial: measured }];
  const built = view('started', { readTrials: async () => ok({ trials: [{ record: { ...record, state: 'started' }, suggestion, evaluation: { ...evaluation, overhead } }], mechanisms: [] }) }); await built.open();
  const text = textOf(built.node);
  assert.match(text, /Indexing: Baseline: unknown \(Provider invoice unavailable\); trial: not observed — not compared/);
  assert.match(text, /Maintenance: Baseline: not observed; trial: 100 bytes — not compared/);
  assert.match(text, /Setup: not observed/); assert.match(text, /Runtime\/context \(configured material size, not usage\): not observed/);
});


test('stale trial records have an in-place refresh action and required-criteria feedback', async () => {
  const built = view(); await built.open(); built.plan(suggestion);
  assert.match(textOf(built.node), /To propose this trial, add an acceptable outcome/);
  assert.match(find(built, 'Propose trial').title, /non-negative value and unit/);
  built.client.revision++; built.render();
  assert.match(textOf(built.node), /Select Refresh trials/);
  await find(built, 'Refresh trials').listeners.click();
  assert.ok(find(built, 'Start'));
});
