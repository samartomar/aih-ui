// Shape of the optional reviewed-batch record a journey envelope carries: a durable description of one multi-scope change
// (scopes, shared inputs, ordered actions, dependency edges, disclosed checks and the continuation choice). It never holds a
// session id, review digest, prepared handle, run id or outcome. Internal to the journey reader and the batch module (not a
// package export): both validate records with exactly these rules.
import { digestBytes, hash, only } from './intake.mjs';
import { isUtcTimestamp, UPDATE_CATEGORIES } from './maintenance-record.mjs';
import { sameRoot } from './workspace-record.mjs';
export const BATCH_RECORD_SCHEMA = 'urn:aihq:workbench:journey-record:reviewed-batch:1.0.0';
export const CONTINUATIONS = ['stop', 'continue-independent'];
export const SCOPE_ROLES = ['existing', 'added'];
export const CHECK_KINDS = ['shared-input', 'unrelated-state', 'conflict', 'core-review'];
export const MAX_SCOPES = 16, MAX_INPUTS = 64, MAX_ACTIONS = 256;
const idPattern = /^[\w.-]{1,180}$/;
// Same canonical JSON as headless `stable`; kept local so this module has no host dependency.
const stable = value => JSON.stringify(value, (_key, member) => member && typeof member === 'object' && !Array.isArray(member)
  ? Object.fromEntries(Object.entries(member).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : member);
const slug = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
const absoluteRoot = value => typeof value === 'string' && value.length >= 1 && value.length <= 1024 && !/[\x00-\x1f]/.test(value) && /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(value);
const list = (value, min, max, each) => Array.isArray(value) && value.length >= min && value.length <= max && value.every(each);
const ascending = (items, key = item => item) => items.every((item, index) => index === 0 || key(items[index - 1]) < key(item));
const digest = async value => (await digestBytes(new TextEncoder().encode(stable(value)))).slice(0, 32);
// JSON pointer (relative to the record) of the first violation of the closed batch shape, else null.
export function batchProblem(record) {
  if (!only(record, ['id', 'schema', 'required', 'recordedAt', 'categories', 'continuation', 'scopes', 'inputs', 'actions', 'checks'], ['supersedes'])) return '';
  if (record.schema !== BATCH_RECORD_SCHEMA) return '/schema';
  if (typeof record.id !== 'string' || !/^batch-[a-f0-9]{32}$/.test(record.id)) return '/id';
  if (record.required !== false) return '/required';
  if (!isUtcTimestamp(record.recordedAt)) return '/recordedAt';
  if (!list(record.categories, 1, UPDATE_CATEGORIES.length, category => UPDATE_CATEGORIES.includes(category)) || !ascending(record.categories)) return '/categories';
  if (!CONTINUATIONS.includes(record.continuation)) return '/continuation';
  if (record.supersedes !== undefined && (typeof record.supersedes !== 'string' || !/^batch-[a-f0-9]{32}$/.test(record.supersedes) || record.supersedes === record.id)) return '/supersedes';
  const { scopes, inputs, actions, checks } = record;
  if (!list(scopes, 1, MAX_SCOPES, scope => only(scope, ['id', 'role', 'client', 'target']) && slug(scope.id) && SCOPE_ROLES.includes(scope.role)
    && typeof scope.client === 'string' && scope.client.length >= 1 && scope.client.length <= 128 && !/[\x00-\x1f]/.test(scope.client)
    && only(scope.target, ['kind', 'root']) && scope.target.kind === 'project' && absoluteRoot(scope.target.root)) || !ascending(scopes, scope => scope.id)) return '/scopes';
  if (scopes.some((scope, index) => scopes.slice(0, index).some(earlier => sameRoot(earlier.target.root, scope.target.root)))) return '/scopes';
  if (!list(inputs, 0, MAX_INPUTS, input => only(input, ['id', 'kind', 'sha256', 'byteLength']) && slug(input.id) && input.kind === 'material' && hash(input.sha256)
    && Number.isSafeInteger(input.byteLength) && input.byteLength >= 0) || !ascending(inputs, input => input.id)) return '/inputs';
  const sortedSlugs = value => list(value, 0, MAX_ACTIONS, slug) && ascending(value);
  if (!Array.isArray(actions) || actions.length < 1 || actions.length > MAX_ACTIONS) return '/actions';
  const scopeIds = new Set(scopes.map(scope => scope.id)), inputIds = new Set(inputs.map(input => input.id));
  const earlier = new Set(), usedScopes = new Set(), usedInputs = new Set(), usedCategories = new Set();
  for (const [index, action] of actions.entries()) {
    const path = `/actions/${index}`;
    if (!only(action, ['id', 'scope', 'category', 'selection', 'inputs', 'requires'], ['retain']) || !slug(action.id) || earlier.has(action.id)) return path;
    if (!scopeIds.has(action.scope)) return `${path}/scope`;
    if (!record.categories.includes(action.category)) return `${path}/category`;
    if (!only(action.selection, ['id', 'sha256']) || typeof action.selection.id !== 'string' || !idPattern.test(action.selection.id) || !hash(action.selection.sha256)) return `${path}/selection`;
    if (!sortedSlugs(action.inputs) || action.inputs.some(id => !inputIds.has(id))) return `${path}/inputs`;
    // Array order is the reviewed execution order, so every requirement must already have appeared (which also rules out a cycle).
    if (!sortedSlugs(action.requires) || action.requires.some(id => !earlier.has(id))) return `${path}/requires`;
    if (action.retain !== undefined && action.retain !== true) return `${path}/retain`;
    earlier.add(action.id); usedScopes.add(action.scope); usedCategories.add(action.category);
    for (const id of action.inputs) usedInputs.add(id);
  }
  if (usedScopes.size !== scopes.length) return '/scopes';
  if (usedInputs.size !== inputs.length) return '/inputs';
  if (usedCategories.size !== record.categories.length) return '/categories';
  const subjects = { 'shared-input': inputIds, 'unrelated-state': scopeIds, conflict: scopeIds, 'core-review': earlier };
  if (!list(checks, 0, 512, check => only(check, ['id', 'kind', 'subject']) && /^check-[a-f0-9]{32}$/.test(check.id) && CHECK_KINDS.includes(check.kind) && subjects[check.kind].has(check.subject)) || !ascending(checks, check => check.id)) return '/checks';
  return null;
}
export const batchId = async ({ categories, continuation, scopes, inputs, actions, supersedes }) =>
  `batch-${await digest({ categories, continuation, scopes, inputs, actions, ...(supersedes !== undefined ? { supersedes } : {}) })}`;
const checkId = async check => `check-${await digest(check)}`;
// Every check the host performs for this batch, disclosed up front: nothing is hidden or pruned.
export async function deriveChecks({ scopes, inputs, actions }) {
  const all = [...inputs.map(input => ({ kind: 'shared-input', subject: input.id })),
    ...scopes.flatMap(scope => [{ kind: 'unrelated-state', subject: scope.id }, { kind: 'conflict', subject: scope.id }]),
    ...actions.map(action => ({ kind: 'core-review', subject: action.id }))];
  return (await Promise.all(all.map(async check => ({ id: await checkId(check), ...check })))).sort((a, b) => a.id < b.id ? -1 : 1);
}
// JSON pointer of the first derived value that disagrees with the record's content, else null (run after batchProblem).
export async function batchDerivedProblem(record) {
  if (record.id !== await batchId(record)) return '/id';
  return stable(record.checks) === stable(await deriveChecks(record)) ? null : '/checks';
}
