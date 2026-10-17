// Bounded improvement trials: a person plans one trial of a suggested Catalog item, defines the quality it must meet before
// anything is compared, records what was observed for the baseline and the trial, and then keeps, revises or stops it. Pure and
// bounded: it reads the saved envelope, the inventories and the enforcement mechanisms the host says it has, calls no model and
// reads no network, and writes only a new envelope revision through recordTrial. Keeping a trial adds the one suggested item at
// the chosen scope through the ordinary draft edit and nothing else; stopping ends the evaluation and says nothing about
// anything being undone, which is tracked separately as a restoration. Core's claim and calculation format carries the evidence.
import { CLAIMS_SCHEMA, projectClaims, validateClaimSet } from '@aihq/core/report';
import { resolveSelections } from '@aihq/catalog/reader';
import { object, only, refuse, digestJson as digest } from './primitives.mjs';
import { editDraft } from './headless.mjs';
import { readJourneyEnvelope, writeJourneyEnvelope, projectJourneyEnvelope, DRAFT_RECORD_SCHEMA, JOURNEY_RECORD_KINDS } from './journey.mjs';
import { isUtcTimestamp } from './maintenance-record.mjs';
import { IMPROVEMENT_SUGGESTION_RECORD_SCHEMA, IMPROVEMENT_DISMISSAL_RECORD_SCHEMA, SUGGESTION_FIELDS, suggestionProblem, suggestionDerivedProblem } from './improvement-record.mjs';
import { TRIAL_RECORD_SCHEMA, TRIAL_DIMENSIONS, MAX_OBSERVATIONS, targetKey, trialId, observationId, observationProblem, proposalProblem, restorationProblem, mechanismValid, sealTrial } from './trial-record.mjs';
export const TRIAL_SCHEMA = TRIAL_RECORD_SCHEMA;
// The shipped host can enforce nothing, so every bound it records is advisory and no cap is ever claimed.
export const TRIAL_MECHANISMS_NONE = Object.freeze([]);
export const TRIAL_PRODUCER = Object.freeze({ id: 'aih-ui/trial', version: '1.0.0' });
export const DIMENSION_LABELS = Object.freeze({ setup: 'Setup', indexing: 'Indexing', 'runtime-context': 'Runtime/context (configured material size, not usage)', maintenance: 'Maintenance' });
const isSuggestion = record => record.schema === IMPROVEMENT_SUGGESTION_RECORD_SCHEMA;
const isDismissal = record => record.schema === IMPROVEMENT_DISMISSAL_RECORD_SCHEMA;
const isTrial = record => record.schema === TRIAL_RECORD_SCHEMA;
const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const byProposed = (a, b) => a.proposedAt < b.proposedAt ? -1 : a.proposedAt > b.proposedAt ? 1 : byId(a, b);
const text = (value, max) => typeof value === 'string' && value.length >= 1 && value.length <= max;
const DRIFTED = 'The draft changed since this trial was proposed, so the configured size it started from is no longer available; revise the trial to measure again.';
const ref = claim => ({ id: claim.id, revision: claim.revision });
// ---- Evaluation ----------------------------------------------------------------------------------------------------------
const OUTCOMES = { met: 'qualifying-improvement', 'not-met': 'no-qualifying-improvement', unknown: 'inconclusive' };
// What one option achieved against the quality checks defined at proposal; an unrecorded or unknown check is unknown, never passed.
function qualityOf(record, option) {
  const checks = record.quality.checks.map(({ id, text }) => {
    const found = record.observations.find(o => o.option === option && o.target.check === id);
    return { id, text, result: found && found.kind !== 'unknown' ? found.value.amount : 'unknown' };
  });
  const count = result => checks.filter(check => check.result === result).length, failed = count('failed'), passed = count('passed');
  return { state: failed > 0 ? 'not-met' : passed === checks.length ? 'met' : 'unknown', passed, failed, unknown: count('unknown'), checks };
}
const boundText = (bound, mechanisms) => {
  const head = `${bound.label}: ${bound.value} ${bound.unit}`, { enforcement } = bound;
  if (enforcement.kind === 'advisory') return `${head} — advisory (not enforced)`;
  const { label, id } = enforcement.mechanism;
  return mechanisms === undefined || mechanisms.some(mechanism => mechanism.id === id) ? `${head} — enforced by ${label}`
    : `${head} — recorded as enforced by ${label}, but that mechanism is not available here, so it is not a cap`;
};
// One Core claim per observation. Core rejects shared object references, so every claim gets fresh copies.
async function claimOf(record, observation, target) {
  const unknown = observation.kind === 'unknown', check = observation.target.check !== undefined;
  return { id: `${record.id}/${observation.option}/${targetKey(observation.target)}`, revision: await digest(observation), producer: { ...TRIAL_PRODUCER }, recordSchema: TRIAL_RECORD_SCHEMA,
    subject: { kind: 'trial-option', id: `${record.id}/${observation.option}` }, scope: { kind: record.scope === 'user' ? 'user-content' : 'repository', targets: [target] },
    sources: [{ id: record.id, schema: TRIAL_RECORD_SCHEMA }], observation: `${record.id}/${observation.option}/${targetKey(observation.target)}`, capturedAt: new Date(observation.recordedAt).toISOString(),
    measure: check ? 'trial-quality-check' : `trial-overhead/${observation.target.dimension}`, kind: observation.kind,
    ...(unknown ? { unknownReason: observation.unknownReason } : { value: { ...observation.value } }), ...(observation.method ? { method: { ...observation.method } } : {}),
    coverage: unknown ? { state: 'unknown', reason: 'This was not observed.' } : { state: 'complete', reason: 'Recorded for this trial.' },
    authentication: { status: 'not-authenticated' }, applicability: { state: 'current', reason: 'Recorded for this trial.', inputs: [] } };
}
// Quality first: the outcome rests on the trial's own quality checks alone. Only then are the overhead observations put through Core's
// context-change calculation, and each row copies Core's result; nothing here recomputes a difference or a percentage.
export async function evaluateTrial(record, { mechanisms } = {}) {
  const options = { baseline: qualityOf(record, 'baseline'), trial: qualityOf(record, 'trial') };
  const quality = { defined: { outcome: record.quality.outcome, checks: record.quality.checks.map(check => ({ ...check })) }, options };
  const outcome = OUTCOMES[options.trial.state];
  const target = record.change.itemId, claims = new Map();
  for (const observation of record.observations) claims.set(`${observation.option}/${targetKey(observation.target)}`, await claimOf(record, observation, target));
  const calculations = TRIAL_DIMENSIONS.filter(dimension => claims.has(`baseline/${dimension}`) && claims.has(`trial/${dimension}`))
    .map(dimension => ({ id: `${record.id}/${dimension}`, method: 'context-change', version: '1.0.0', before: ref(claims.get(`baseline/${dimension}`)), after: ref(claims.get(`trial/${dimension}`)) }));
  const claimSet = { schema: CLAIMS_SCHEMA, claims: [...claims.values()], calculations };
  const validation = validateClaimSet(claimSet);
  if (!validation.valid) throw new Error(`The trial claim set is not valid: ${validation.errors.join('; ')}`);
  const projection = projectClaims(claimSet);
  const observed = (option, dimension) => record.observations.find(o => o.option === option && o.target.dimension === dimension);
  const overhead = TRIAL_DIMENSIONS.map(dimension => {
    const [baseline, trial] = [observed('baseline', dimension), observed('trial', dimension)], result = projection.calculations.find(entry => entry.id === `${record.id}/${dimension}`);
    const sides = { ...(baseline ? { baseline: structuredClone(baseline) } : {}), ...(trial ? { trial: structuredClone(trial) } : {}) };
    if (!result) return { dimension, label: DIMENSION_LABELS[dimension], status: 'not-observed', reason: baseline ? trial ? 'not-observed' : 'trial-not-observed' : trial ? 'baseline-not-observed' : 'not-observed', ...sides };
    const { status, reason, before, after, unit, absoluteDifference, direction, percentage, percentageReason } = result;
    return { dimension, label: DIMENSION_LABELS[dimension], status, reason, ...(status === 'available' ? { before, after, unit, absoluteDifference, direction, percentage, ...(percentageReason ? { percentageReason } : {}) } : {}), ...sides };
  });
  return { quality, outcome, overhead, narrower: record.narrower ? structuredClone(record.narrower) : null,
    bounds: record.bounds.map(bound => ({ ...structuredClone(bound), text: boundText(bound, mechanisms) })), unknowns: [...record.unknowns], claimSet, projection };
}
// ---- Reading -------------------------------------------------------------------------------------------------------------
const mechanismsProblem = mechanisms => !Array.isArray(mechanisms) || mechanisms.length > 16 || !mechanisms.every(mechanismValid) || new Set(mechanisms.map(m => m.id)).size !== mechanisms.length;
async function load(envelopeBytes) {
  if (!(envelopeBytes instanceof Uint8Array)) return refuse('INPUT_INVALID', '/envelopeBytes', 'Supply original journey envelope bytes.');
  const read = await readJourneyEnvelope(envelopeBytes);
  if (read.status !== 'ok') return read;
  const draft = read.value.records.find(record => record.schema === DRAFT_RECORD_SCHEMA);
  if (!draft) return refuse('INPUT_INVALID', '/records', 'Envelope has no unresolved-draft record.', envelopeBytes);
  return { status: 'ok', value: { read: read.value, draft }, diagnostics: read.diagnostics };
}
// Each trial with the suggestion record beside it (any revision; undefined only if the envelope was edited by hand) and its evaluation, oldest proposal first.
async function present(records, mechanisms) {
  const suggestions = new Map(records.filter(isSuggestion).map(record => [record.id, record]));
  return Promise.all(records.filter(isTrial).sort(byProposed).map(async record => {
    const suggestion = suggestions.get(record.suggestion.id);
    return { record: structuredClone(record), suggestion: structuredClone(suggestion), evaluation: await evaluateTrial(record, { mechanisms }) };
  }));
}
// Read-only: nothing is written and nothing is changed. `mechanisms` are the enforcement mechanisms the host can apply.
export async function readTrials({ envelopeBytes, mechanisms = TRIAL_MECHANISMS_NONE } = {}) {
  const loaded = await load(envelopeBytes);
  if (loaded.status !== 'ok') return loaded;
  if (mechanismsProblem(mechanisms)) return refuse('INPUT_INVALID', '/mechanisms', 'Supply at most 16 unique enforcement mechanisms, each {id,label}.', envelopeBytes);
  return { status: 'ok', diagnostics: loaded.diagnostics, value: { trials: await present(loaded.value.read.records, mechanisms), mechanisms: structuredClone(mechanisms) } };
}
// ---- Configured size -----------------------------------------------------------------------------------------------------
const size = descriptors => descriptors.reduce((total, descriptor) => total + descriptor.byteLength, 0);
// Configured material size, never observed usage, of the draft the trial was proposed against: the recipe and materials of every pinned item, and what the tested item adds
// (itself and what it requires, unless already pinned). A size that cannot be known is unknown with its reason.
const UNRESOLVED = 'Catalog cannot resolve what the suggested item requires at this scope from the supplied inventories, so the configured size with the suggested item is unknown.';
const sized = item => !!item && Number.isSafeInteger(item.recipe?.byteLength) && (item.materials ?? []).every(m => Number.isSafeInteger(m.byteLength));
function configuredSize({ draft, change, scope, inventories }) {
  const pins = draft.intent.pins, pinned = new Set(pins.map(pin => `${pin.releaseSha256}/${pin.itemId}`));
  const baseline = pins.reduce((total, pin) => total + pin.recipe.byteLength + size(pin.materials), 0);
  const entry = Array.isArray(inventories) ? inventories.find(candidate => candidate.release?.sha256 === change.releaseSha256) : undefined;
  if (!entry) return { baseline, unknown: 'The suggested item is not in the supplied inventories, so its configured size is unknown.' };
  const trial = items => baseline + items.reduce((total, { item }) => total + item.recipe.byteLength + size(item.materials), 0);
  // Catalog's required closure when every release it needs is supplied, each item in the release Catalog resolved it from.
  const releases = {};
  for (const candidate of inventories) if (candidate?.release && !Object.hasOwn(releases, candidate.release.sha256)) releases[candidate.release.sha256] = candidate.release;
  // Catalog refuses (never throws for) inventories it did not check, an unavailable release, an input the item needs or a scope it does not admit.
  const resolved = resolveSelections({ releases, roots: [{ releaseSha256: change.releaseSha256, itemId: change.itemId, scope, configuration: {} }], skips: [] });
  const unknownSize = id => ({ baseline, unknown: `The size of ${id} is not known, so the configured size with the suggested item is unknown.` });
  if (resolved.status !== 'ok') {
    // Catalog names the required release or item it could not resolve; any other refusal leaves what the item adds unknown as a whole.
    const unavailable = resolved.diagnostics.find(d => (d.code === 'RELEASE_UNAVAILABLE' || d.code === 'ITEM_UNAVAILABLE') && typeof d.reference?.itemId === 'string');
    return unavailable ? unknownSize(unavailable.reference.itemId) : { baseline, unknown: UNRESOLVED };
  }
  const closure = new Map();
  for (const { item: ref } of resolved.value.inclusions) {
    const key = `${ref.releaseSha256}/${ref.itemId}`;
    if (!closure.has(key)) closure.set(key, { key, itemId: ref.itemId, item: releases[ref.releaseSha256].items.find(item => item.id === ref.itemId) });
  }
  const missing = [...closure.values()].find(({ item }) => !sized(item));
  return missing ? unknownSize(missing.itemId) : { baseline, trial: trial([...closure.values()].filter(({ key }) => !pinned.has(key))) };
}
// ---- Recording -----------------------------------------------------------------------------------------------------------
const PROPOSAL_FIELDS = ['scope', 'task', 'quality', 'conditions'];
const stateIs = (trial, ...states) => states.includes(trial.state);
// One of the lifecycle operations becomes a new envelope revision. `inventories` are the checked inventories (needed to keep a
// trial, to measure configured size and to check a scope); `mechanisms` are the enforcement mechanisms the host can apply (none by
// default, so an `enforced` bound is refused).
export async function recordTrial({ envelopeBytes, operation, inventories, mechanisms = TRIAL_MECHANISMS_NONE, now } = {}) {
  const loaded = await load(envelopeBytes);
  if (loaded.status !== 'ok') return loaded;
  const { read, draft } = loaded.value;
  const fail = (path, message, code = 'INPUT_INVALID') => refuse(code, path, message, envelopeBytes);
  const invalid = message => fail('/operation/type', message, 'TRIAL_TRANSITION_INVALID');
  if (!read.supported) return refuse('JOURNEY_RECORD_UNSUPPORTED', '/records', 'The envelope has required records this version cannot change; it is read-only.', envelopeBytes);
  if (!isUtcTimestamp(now)) return fail('/now', 'Supply the record time as an ISO UTC timestamp.');
  if (mechanismsProblem(mechanisms)) return fail('/mechanisms', 'Supply at most 16 unique enforcement mechanisms, each {id,label}.');
  const types = { propose: [PROPOSAL_FIELDS.concat('suggestion'), ['bounds', 'unknowns']], start: [['id']], observe: [['id', 'observation']], 'measure-context': [['id']], keep: [['id'], ['reason']],
    revise: [['id', 'proposal'], ['reason']], stop: [['id'], ['reason', 'restoration']], restoration: [['id', 'status'], ['effects', 'note']], 'accept-narrower': [['id', 'qualification']] };
  if (!object(operation) || typeof operation.type !== 'string' || !Object.hasOwn(types, operation.type)) return fail('/operation/type', `Supply one of: ${Object.keys(types).join(', ')}.`);
  // Quality is defined before any comparison, so a proposal without it is refused whatever else it holds.
  const qualityGiven = quality => object(quality) && text(quality.outcome, 1000) && Array.isArray(quality.checks) && quality.checks.length > 0;
  const noQuality = () => fail('/operation/quality', 'Define the quality the trial must meet, an outcome and at least one check, before anything is compared.', 'TRIAL_QUALITY_REQUIRED');
  if (operation.type === 'propose' && !qualityGiven(operation.quality)) return noQuality();
  if (operation.type === 'revise' && object(operation.proposal) && !qualityGiven(operation.proposal.quality)) return fail('/operation/proposal/quality', 'Define the quality the revised trial must meet, an outcome and at least one check.', 'TRIAL_QUALITY_REQUIRED');
  const [required, optional = []] = types[operation.type];
  if (!only(operation, ['type', ...required], optional)) return fail('/operation', `Supply {type,${required.join(',')}${optional.length ? `,${optional.map(name => `${name}?`).join(',')}` : ''}}.`);
  if (operation.reason !== undefined && !text(operation.reason, 1000)) return fail('/operation/reason', 'Supply a reason of 1 to 1000 characters.');
  const suggestions = read.records.filter(isSuggestion), dismissals = read.records.filter(isDismissal), trials = read.records.filter(isTrial);
  const find = () => {
    const found = typeof operation.id === 'string' ? trials.find(trial => trial.id === operation.id) : undefined;
    return found ? { found } : { refused: fail('/operation/id', 'No recorded trial has that id.') };
  };
  // The proposal fields of a new trial, checked as the record will be, with each bound's enforcement checked against the host's mechanisms.
  const proposed = (fields, path) => {
    if (!only(fields, PROPOSAL_FIELDS, ['bounds', 'unknowns', ...(path === '/operation' ? ['type', 'suggestion'] : [])])) return { refused: fail(path, `Supply only the trial's ${PROPOSAL_FIELDS.join(', ')}, bounds and unknowns.`) };
    if (fields.bounds === undefined || (Array.isArray(fields.bounds) && fields.bounds.length === 0)) return { refused: fail(`${path}/bounds`, 'A trial needs at least one advisory or enforced bound, such as a time box or a spending limit.', 'TRIAL_BOUND_REQUIRED') };
    const normal = { scope: fields.scope, task: fields.task, quality: fields.quality, conditions: fields.conditions, bounds: fields.bounds, unknowns: fields.unknowns ?? [] };
    const problem = proposalProblem(normal);
    if (problem !== null) return { refused: fail(`${path}${problem}`, 'Supply a valid trial: a scope, a task, the quality it must meet, the comparison conditions, bounds and unknown costs.') };
    const bounds = [];
    for (const [index, bound] of normal.bounds.entries()) {
      if (bound.enforcement.kind === 'advisory') { bounds.push(structuredClone(bound)); continue; }
      const mechanism = mechanisms.find(candidate => candidate.id === bound.enforcement.mechanism.id);
      if (!mechanism) return { refused: fail(`${path}/bounds/${index}/enforcement`, `No enforcement mechanism "${bound.enforcement.mechanism.id}" is available here, so this bound cannot be claimed as enforced. Record it as advisory.`, 'TRIAL_BOUND_UNENFORCEABLE') };
      bounds.push({ ...structuredClone(bound), enforcement: { kind: 'enforced', mechanism: { id: mechanism.id, label: mechanism.label } } });
    }
    return { fields: { ...normal, bounds } };
  };
  const scopeOffered = (change, scope, path) => {
    const entry = Array.isArray(inventories) ? inventories.find(candidate => candidate.release?.sha256 === change.releaseSha256) : undefined;
    const item = entry?.release?.items?.find(candidate => candidate.id === change.itemId);
    return item && !item.scopes.includes(scope) ? fail(path, `${change.itemId} is not offered at the ${scope} scope.`) : null;
  };
  const baselineOf = async () => ({ savedIntentSha256: read.envelope.savedIntent.sha256, draftSha256: await digest(draft.intent) });
  // The trial records the suggestion revision it was planned from and carries the change it tests, so it never reads the current suggestion again.
  const newTrial = async (suggestion, change, fields, extra = {}) => {
    const trial = { id: '', schema: TRIAL_RECORD_SCHEMA, required: false, revision: '', suggestion: { id: suggestion.id, revision: suggestion.revision }, change: { ...change }, scope: fields.scope, baseline: await baselineOf(),
      task: fields.task, quality: fields.quality, conditions: fields.conditions, bounds: fields.bounds, unknowns: fields.unknowns, state: 'proposed', proposedAt: now, observations: [], ...extra };
    trial.id = await trialId(trial);
    return trial;
  };
  // The snapshot a decision keeps: what the evidence said at that moment, whether or not it showed an improvement.
  const decide = async (trial, state, extra = {}) => ({ ...trial, state, decidedAt: now, evidence: { outcome: (await evaluateTrial(trial)).outcome, evaluatedAt: now },
    ...(operation.reason !== undefined ? { reason: operation.reason } : {}), ...extra });
  // Every trial written is sealed with the revision of exactly what is written.
  const settle = async (updated, { base = read, suggestions: nextSuggestions = suggestions } = {}) => {
    const next = await Promise.all(updated.map(sealTrial));
    const others = base.records.filter(record => Object.hasOwn(JOURNEY_RECORD_KINDS, record.schema) && !isSuggestion(record) && !isTrial(record) && !isDismissal(record));
    const records = [...others, ...[...nextSuggestions].sort(byId), ...base.records.filter(isDismissal), ...[...trials.filter(trial => !next.some(changed => changed.id === trial.id)), ...next].sort(byId)];
    const written = await writeJourneyEnvelope({ savedIntentBytes: base.savedIntentBytes, records, previous: base });
    if (written.status !== 'ok') return { ...written, originalBytes: envelopeBytes.slice() };
    const { envelope, envelopeBytes: bytes } = written.value;
    return { status: 'ok', diagnostics: [], value: { envelopeBytes: bytes, envelope, projection: projectJourneyEnvelope(envelope), record: structuredClone(next.at(-1)), trials: await present(envelope.records, mechanisms) } };
  };
  const withObservations = async (trial, additions) => {
    const kept = trial.observations.filter(o => !additions.some(added => added.option === o.option && targetKey(added.target) === targetKey(o.target)));
    return { ...trial, observations: [...kept, ...await Promise.all(additions.map(async added => ({ ...added, id: await observationId(added), source: added.source ?? 'person', recordedAt: now })))] };
  };
  const { type } = operation;
  if (type === 'propose') {
    const { suggestion } = operation;
    if (!only(suggestion, SUGGESTION_FIELDS)) return fail('/operation/suggestion', `Supply only the suggestion's ${SUGGESTION_FIELDS.join(', ')}.`);
    const saved = { id: suggestion.id, schema: IMPROVEMENT_SUGGESTION_RECORD_SCHEMA, required: false, rulesVersion: suggestion.rulesVersion, revision: suggestion.revision, scope: suggestion.scope,
      change: suggestion.change, triggers: suggestion.triggers, goal: suggestion.goal, references: suggestion.references, facts: suggestion.facts, unknowns: suggestion.unknowns, recordedAt: now };
    const problem = suggestionProblem(saved) ?? await suggestionDerivedProblem(saved);
    if (problem !== null) return fail(`/operation/suggestion${problem}`, 'Supply a valid improvement suggestion.');
    const checked = proposed(operation, '/operation');
    if (checked.refused) return checked.refused;
    const { content: _content, ...change } = saved.change;
    const outside = scopeOffered(change, checked.fields.scope, '/operation/scope');
    if (outside) return outside;
    // One suggestion record per suggestion id. Trials keep their own change, so they may name an older revision; a dismissal binds the
    // revision it dismissed, so a changed suggestion has to be shown again first.
    if (dismissals.some(other => other.suggestion.id === saved.id && other.suggestion.revision !== saved.revision))
      return fail('/operation/suggestion', 'A dismissal still refers to a different revision of this suggestion. Show the suggestion again first, then plan the trial.', 'TRIAL_SUGGESTION_CHANGED');
    const trial = await newTrial(saved, change, checked.fields);
    if (trials.some(other => other.id === trial.id)) return fail('/operation', 'That trial is already planned.');
    return settle([trial], { suggestions: [...suggestions.filter(record => record.id !== saved.id), saved] });
  }
  const { found: trial, refused } = find();
  if (refused) return refused;
  if (type === 'start') {
    if (!stateIs(trial, 'proposed')) return invalid(`A ${trial.state} trial cannot be started; only a proposed trial can.`);
    return settle([{ ...trial, state: 'started', startedAt: now }]);
  }
  if (type === 'observe' || type === 'measure-context') {
    if (!stateIs(trial, 'started')) return invalid(`Observations are recorded only while a trial is started; this one is ${trial.state}.`);
    const checks = trial.quality.checks.map(check => check.id);
    let additions;
    if (type === 'observe') {
      const { observation } = operation;
      if (!only(observation, ['option', 'target', 'kind'], ['value', 'method', 'unknownReason'])) return fail('/operation/observation', 'Supply {option,target,kind,value?,method?,unknownReason?}.');
      const full = { ...observation, id: await observationId(observation), source: 'person', recordedAt: now }, problem = observationProblem(full, checks);
      if (problem !== null) return fail(`/operation/observation${problem}`, 'Supply a valid observation for a quality check or an overhead dimension.');
      additions = [{ ...observation, source: 'person' }];
    } else {
      // Sizes are the configured size of the draft the trial started from; once the draft is another one, neither side is known.
      const measured = await digest(draft.intent) === trial.baseline.draftSha256 ? configuredSize({ draft, change: trial.change, scope: trial.scope, inventories }) : { unknown: DRIFTED };
      const side = (option, amount, reason) => ({ option, target: { dimension: 'runtime-context' }, source: 'host', ...(amount !== undefined ? { kind: 'measured', value: { amount, unit: 'bytes' } } : { kind: 'unknown', unknownReason: reason }) });
      additions = [side('baseline', measured.baseline, measured.unknown), side('trial', measured.trial, measured.unknown)];
    }
    const observed = await withObservations(trial, additions);
    return observed.observations.length > MAX_OBSERVATIONS ? fail('/operation', `A trial keeps at most ${MAX_OBSERVATIONS} observations.`) : settle([observed]);
  }
  if (type === 'keep') {
    if (!stateIs(trial, 'started')) return invalid(`Only a started trial can be kept; this one is ${trial.state}.`);
    const { change } = trial, root = { releaseSha256: change.releaseSha256, itemId: change.itemId, scope: trial.scope };
    // The ordinary draft edit adds the one suggested item at the chosen scope first; if it refuses, nothing changes.
    const edited = await editDraft({ envelopeBytes, inventories, operation: { type: 'select', root: { ...root, itemSha256: change.itemSha256 } } });
    if (edited.status !== 'ok') return { ...edited, originalBytes: envelopeBytes.slice() };
    const reread = await load(edited.value.envelopeBytes);
    if (reread.status !== 'ok') return { ...reread, originalBytes: envelopeBytes.slice() };
    const adopted = { root, draftSha256: await digest(reread.value.draft.intent) };
    return settle([await decide(trial, 'kept', { adopted })], { base: reread.value.read });
  }
  if (type === 'revise') {
    if (!stateIs(trial, 'proposed', 'started')) return invalid(`Only a proposed or started trial can be revised; this one is ${trial.state}.`);
    const checked = proposed(operation.proposal, '/operation/proposal');
    if (checked.refused) return checked.refused;
    const outside = scopeOffered(trial.change, checked.fields.scope, '/operation/proposal/scope');
    if (outside) return outside;
    const next = await newTrial(trial.suggestion, trial.change, checked.fields, { revises: trial.id });
    if (trials.some(other => other.id === next.id)) return fail('/operation', 'That trial is already planned.');
    const revised = await decide(trial, 'revised', { revisedBy: next.id });
    const settled = await settle([revised, next]);
    return settled.status === 'ok' ? { ...settled, value: { ...settled.value, revised: structuredClone(settled.value.envelope.records.find(record => record.id === revised.id)) } } : settled;
  }
  if (type === 'stop') {
    if (!stateIs(trial, 'proposed', 'started')) return invalid(`Only a proposed or started trial can be stopped; this one is ${trial.state}.`);
    // Stopping ends the evaluation. A restoration is recorded only when one was asked for, and says nothing about the stop.
    let restoration;
    if (operation.restoration !== undefined) {
      const { restoration: given } = operation;
      if (!only(given, ['status'], ['effects', 'note'])) return fail('/operation/restoration', 'Supply {status,effects?,note?}.');
      restoration = { status: given.status, effects: given.effects ?? [], ...(given.note !== undefined ? { note: given.note } : {}), recordedAt: now };
      if (restorationProblem(restoration) !== null) return fail('/operation/restoration', 'Supply a restoration status, up to 16 effects of 1 to 300 characters and a note of 1 to 1000.');
    }
    return settle([await decide(trial, 'stopped', restoration ? { restoration } : {})]);
  }
  if (type === 'restoration') {
    if (!stateIs(trial, 'stopped')) return invalid(`A restoration is tracked only for a stopped trial; this one is ${trial.state}.`);
    const restoration = { status: operation.status, effects: operation.effects ?? [], ...(operation.note !== undefined ? { note: operation.note } : {}), recordedAt: now };
    if (restorationProblem(restoration) !== null) return fail('/operation/status', 'Supply a restoration status, up to 16 effects of 1 to 300 characters and a note of 1 to 1000.');
    return settle([{ ...trial, restoration }]);
  }
  // accept-narrower
  if (stateIs(trial, 'proposed')) return invalid('A narrower outcome can be accepted once the trial has started.');
  if (!text(operation.qualification, 1000)) return fail('/operation/qualification', 'Describe the narrower outcome in 1 to 1000 characters.');
  const outcome = trial.evidence ? trial.evidence.outcome : (await evaluateTrial(trial)).outcome;
  if (outcome === 'qualifying-improvement') return invalid('The trial already met its quality bar, so there is nothing narrower to accept.');
  return settle([{ ...trial, narrower: { qualification: operation.qualification, acceptedAt: now } }]);
}
// Convenience for the first operation: plan one trial of a suggestion.
export function proposeTrial({ envelopeBytes, suggestion, scope, task, quality, conditions, bounds, unknowns, inventories, mechanisms, now } = {}) {
  return recordTrial({ envelopeBytes, operation: { type: 'propose', suggestion, scope, task, quality, conditions, ...(bounds !== undefined ? { bounds } : {}), ...(unknowns !== undefined ? { unknowns } : {}) }, inventories, mechanisms, now });
}
