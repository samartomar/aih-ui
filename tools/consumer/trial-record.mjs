// Shape of the optional improvement-trial record a journey envelope carries: one bounded trial of a suggested change, from
// the quality it must meet (defined before anything is compared), through the options' observations, to the person's
// decision. Internal to the journey reader and the trials module (not a package export): both validate records with exactly
// these rules. A record never holds a local path, binding or credential; stop and restoration are separate facts. Its `revision` is
// the digest of the record without it, so any change to a trial that does not recompute it is refused.
import { digestBytes, hash, object, only } from './intake.mjs';
import { isUtcTimestamp } from './maintenance-record.mjs';
import { isSlug } from './workspace-record.mjs';
import { IMPROVEMENT_SUGGESTION_RECORD_SCHEMA } from './improvement-record.mjs';
export const TRIAL_RECORD_SCHEMA = 'urn:aihq:workbench:journey-record:improvement-trial:1.0.0';
export const TRIAL_STATES = ['proposed', 'started', 'kept', 'revised', 'stopped'];
export const TRIAL_DIMENSIONS = ['setup', 'indexing', 'runtime-context', 'maintenance'];
export const TRIAL_OPTIONS = ['baseline', 'trial'];
export const OBSERVATION_KINDS = ['measured', 'estimated', 'declared', 'unknown'];
export const OBSERVATION_SOURCES = ['person', 'host'];
export const EVIDENCE_OUTCOMES = ['qualifying-improvement', 'no-qualifying-improvement', 'inconclusive'];
export const RESTORATION_STATUSES = ['proposed', 'pending', 'completed', 'partial', 'unsupported'];
export const TRIAL_ID_PATTERN = /^trial-[a-f0-9]{32}$/;
export const MAX_OBSERVATIONS = 256;
const suggestionIdPattern = /^suggestion-[a-f0-9]{32}$/, versionPattern = /^\d+\.\d+\.\d+$/, itemIdPattern = /^[\w.-]{1,180}$/;
// Same canonical JSON as headless `stable`; kept local so this module has no host dependency.
const stable = value => JSON.stringify(value, (_key, member) => member && typeof member === 'object' && !Array.isArray(member)
  ? Object.fromEntries(Object.entries(member).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : member);
export const digest = async value => digestBytes(new TextEncoder().encode(stable(value)));
const text = (value, max) => typeof value === 'string' && value.length >= 1 && value.length <= max;
const list = (value, max, each, min = 0) => Array.isArray(value) && value.length >= min && value.length <= max && value.every(each);
const unique = values => new Set(values).size === values.length;
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const scopes = ['project', 'user'];
// The key a target is known by: the dimension itself, or `check:` and the quality check id.
export const targetKey = target => target.dimension !== undefined ? target.dimension : `check:${target.check}`;
const isTarget = (target, checks) => only(target, ['dimension']) ? TRIAL_DIMENSIONS.includes(target.dimension) : only(target, ['check']) && isSlug(target.check) && checks.includes(target.check);
// JSON pointer (relative to the quality) of the first violation of the closed quality shape, else null.
export function qualityProblem(quality) {
  if (!only(quality, ['outcome', 'checks'])) return '';
  if (!text(quality.outcome, 1000)) return '/outcome';
  if (!list(quality.checks, 16, check => only(check, ['id', 'text']) && isSlug(check.id) && text(check.text, 300), 1) || !unique(quality.checks.map(check => check.id))) return '/checks';
  return null;
}
export const mechanismValid = mechanism => only(mechanism, ['id', 'label']) && isSlug(mechanism.id) && text(mechanism.label, 120);
// JSON pointer (relative to the bound) of the first violation of the closed bound shape, else null.
export function boundProblem(bound) {
  if (!only(bound, ['id', 'label', 'unit', 'value', 'enforcement'])) return '';
  if (!isSlug(bound.id)) return '/id';
  if (!text(bound.label, 120)) return '/label';
  if (!text(bound.unit, 32)) return '/unit';
  if (!amount(bound.value)) return '/value';
  const { enforcement } = bound;
  if (!(only(enforcement, ['kind']) && enforcement.kind === 'advisory') && !(only(enforcement, ['kind', 'mechanism']) && enforcement.kind === 'enforced' && mechanismValid(enforcement.mechanism))) return '/enforcement';
  return null;
}
export const proposalProblem = fields => {
  if (!scopes.includes(fields.scope)) return '/scope';
  if (!text(fields.task, 1000)) return '/task';
  const quality = qualityProblem(fields.quality);
  if (quality !== null) return `/quality${quality}`;
  if (!text(fields.conditions, 1000)) return '/conditions';
  if (!list(fields.bounds, 16, bound => boundProblem(bound) === null, 1) || !unique(fields.bounds.map(bound => bound.id))) return '/bounds';
  if (!list(fields.unknowns, 16, unknown => text(unknown, 300))) return '/unknowns';
  return null;
};
// JSON pointer (relative to the observation) of the first violation of the closed observation shape, else null. `checks` are the
// quality check ids a check observation may name.
export function observationProblem(observation, checks) {
  if (!only(observation, ['id', 'option', 'target', 'kind', 'source', 'recordedAt'], ['value', 'method', 'unknownReason'])) return '';
  if (!isSlug(observation.id)) return '/id';
  if (!TRIAL_OPTIONS.includes(observation.option)) return '/option';
  if (!isTarget(observation.target, checks)) return '/target';
  if (!OBSERVATION_KINDS.includes(observation.kind)) return '/kind';
  if (!OBSERVATION_SOURCES.includes(observation.source)) return '/source';
  if (!isUtcTimestamp(observation.recordedAt)) return '/recordedAt';
  if (observation.kind === 'unknown') {
    if ('value' in observation) return '/value';
    if (!text(observation.unknownReason, 300)) return '/unknownReason';
    return 'method' in observation ? '/method' : null;
  }
  if ('unknownReason' in observation) return '/unknownReason';
  const { value } = observation, outcome = observation.target.check !== undefined;
  if (!only(value, ['amount', 'unit']) || !text(value.unit, 32)) return '/value';
  if (outcome ? value.unit !== 'outcome' || !['passed', 'failed'].includes(value.amount) : !amount(value.amount)) return '/value';
  if (observation.kind === 'estimated') return only(observation.method, ['id', 'version']) && isSlug(observation.method.id) && versionPattern.test(observation.method.version) ? null : '/method';
  return 'method' in observation ? '/method' : null;
}
const restorationShape = restoration => only(restoration, ['status', 'effects', 'recordedAt'], ['note']) && RESTORATION_STATUSES.includes(restoration.status)
  && list(restoration.effects, 16, effect => text(effect, 300)) && (restoration.note === undefined || text(restoration.note, 1000)) && isUtcTimestamp(restoration.recordedAt);
export const restorationProblem = restoration => restorationShape(restoration) ? null : '';
// The change a trial tests, copied from its suggestion at proposal (the suggestion's change without its content digests).
const changeShape = change => only(change, ['kind', 'itemId', 'releaseSha256', 'itemSha256']) && change.kind === 'add-item' && typeof change.itemId === 'string' && itemIdPattern.test(change.itemId) && hash(change.releaseSha256) && hash(change.itemSha256);
const rootRef = root => only(root, ['releaseSha256', 'itemId', 'scope']) && hash(root.releaseSha256) && typeof root.itemId === 'string' && itemIdPattern.test(root.itemId) && scopes.includes(root.scope);
// JSON pointer (relative to the record) of the first violation of the closed trial shape, else null.
export function trialProblem(record) {
  if (!only(record, ['id', 'schema', 'required', 'revision', 'suggestion', 'change', 'scope', 'baseline', 'task', 'quality', 'conditions', 'bounds', 'unknowns', 'state', 'proposedAt', 'observations'],
    ['startedAt', 'decidedAt', 'evidence', 'narrower', 'reason', 'revises', 'revisedBy', 'adopted', 'restoration'])) return '';
  if (record.schema !== TRIAL_RECORD_SCHEMA) return '/schema';
  if (typeof record.id !== 'string' || !TRIAL_ID_PATTERN.test(record.id)) return '/id';
  if (record.required !== false) return '/required';
  if (!hash(record.revision)) return '/revision';
  if (!only(record.suggestion, ['id', 'revision']) || typeof record.suggestion.id !== 'string' || !suggestionIdPattern.test(record.suggestion.id) || !hash(record.suggestion.revision)) return '/suggestion';
  if (!changeShape(record.change)) return '/change';
  if (!only(record.baseline, ['savedIntentSha256', 'draftSha256']) || !hash(record.baseline.savedIntentSha256) || !hash(record.baseline.draftSha256)) return '/baseline';
  const proposal = proposalProblem(record);
  if (proposal !== null) return proposal;
  const { state } = record, decided = ['kept', 'revised', 'stopped'].includes(state);
  if (!TRIAL_STATES.includes(state)) return '/state';
  if (!isUtcTimestamp(record.proposedAt)) return '/proposedAt';
  // A trial revised or stopped while still proposed never started; every other state past `proposed` did.
  if ('startedAt' in record ? state === 'proposed' || !isUtcTimestamp(record.startedAt) : state === 'started' || state === 'kept') return '/startedAt';
  if (decided !== ('decidedAt' in record) || (decided && !isUtcTimestamp(record.decidedAt))) return '/decidedAt';
  if (decided !== ('evidence' in record) || (decided && (!only(record.evidence, ['outcome', 'evaluatedAt']) || !EVIDENCE_OUTCOMES.includes(record.evidence.outcome) || !isUtcTimestamp(record.evidence.evaluatedAt)))) return '/evidence';
  if (record.narrower !== undefined && (!only(record.narrower, ['qualification', 'acceptedAt']) || !text(record.narrower.qualification, 1000) || !isUtcTimestamp(record.narrower.acceptedAt))) return '/narrower';
  if (record.reason !== undefined && (!text(record.reason, 1000) || !decided)) return '/reason';
  if (record.revises !== undefined && (typeof record.revises !== 'string' || !TRIAL_ID_PATTERN.test(record.revises) || record.revises === record.id)) return '/revises';
  if ((state === 'revised') !== ('revisedBy' in record) || ('revisedBy' in record && (typeof record.revisedBy !== 'string' || !TRIAL_ID_PATTERN.test(record.revisedBy) || record.revisedBy === record.id))) return '/revisedBy';
  if ((state === 'kept') !== ('adopted' in record) || (state === 'kept' && (!only(record.adopted, ['root', 'draftSha256']) || !rootRef(record.adopted.root) || !hash(record.adopted.draftSha256)))) return '/adopted';
  if ('restoration' in record && (state !== 'stopped' || !restorationShape(record.restoration))) return '/restoration';
  const checks = record.quality.checks.map(check => check.id);
  if (!list(record.observations, MAX_OBSERVATIONS, observation => observationProblem(observation, checks) === null) || (record.observations.length > 0 && !('startedAt' in record))) return '/observations';
  if (!unique(record.observations.map(observation => observation.id)) || !unique(record.observations.map(observation => `${observation.option}/${targetKey(observation.target)}`))) return '/observations';
  return null;
}
// One trial per (suggestion revision, scope, proposal time): proposing the same thing at the same instant is the same trial.
export async function trialId({ suggestion, scope, proposedAt }) { return `trial-${(await digest({ suggestion: { id: suggestion.id, revision: suggestion.revision }, scope, proposedAt })).slice(0, 32)}`; }
// One observation per (option, target); recording it again replaces it, so the id derives from exactly those.
export async function observationId({ option, target }) { return `obs-${(await digest({ option, target })).slice(0, 24)}`; }
// The revision names exactly this content: the digest of the stable record without its own `revision`, id included.
export async function trialRevision(record) { const { revision: _revision, ...content } = record; return digest(content); }
// The record with its revision recomputed; every write of a trial goes through this.
export async function sealTrial(record) { return { ...record, revision: await trialRevision(record) }; }
// Pointer of the first id or revision that does not derive from the record's own fields, else null.
export async function trialDerivedProblem(record) {
  if (record.id !== await trialId(record)) return '/id';
  for (const [index, observation] of record.observations.entries()) if (observation.id !== await observationId(observation)) return `/observations/${index}/id`;
  return record.revision === await trialRevision(record) ? null : '/revision';
}
// Index of the first trial in `records` with no suggestion record of the same id beside it, else -1. The trial records which revision it
// was planned from and carries the change it tests, so a later revision of the suggestion does not unlink it.
export function unlinkedTrial(records) {
  const suggestions = new Set(records.filter(r => r?.schema === IMPROVEMENT_SUGGESTION_RECORD_SCHEMA).map(r => r.id));
  return records.findIndex(r => r?.schema === TRIAL_RECORD_SCHEMA && (!object(r.suggestion) || !suggestions.has(r.suggestion.id)));
}
