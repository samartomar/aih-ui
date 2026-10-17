// Shapes of the optional improvement records a journey envelope carries: a suggestion the person dismissed and the
// dismissal itself. Internal to the journey reader and the improvements module (not a package export): both validate
// records with exactly these rules. Identity deliberately excludes labels, descriptions, release digests, rule texts and
// the rules version, so none of those changing (or a reopen) resets a dismissal.
import { digestBytes, hash, object, only } from './intake.mjs';
import { isUtcTimestamp } from './maintenance-record.mjs';
export const IMPROVEMENT_SUGGESTION_RECORD_SCHEMA = 'urn:aihq:workbench:journey-record:improvement-suggestion:1.0.0';
export const IMPROVEMENT_DISMISSAL_RECORD_SCHEMA = 'urn:aihq:workbench:journey-record:improvement-dismissal:1.0.0';
// The record's reason limit; the rules bound what they list by it.
export const MAX_TRIGGERS = 16;
export const SUGGESTION_FIELDS = ['id', 'revision', 'rulesVersion', 'scope', 'change', 'triggers', 'goal', 'references', 'facts', 'unknowns'];
const REFERENCE_KINDS = ['setting', 'saved-reason', 'request', 'catalog-item'], FACT_KINDS = ['overhead', 'scope', 'dependency'];
const idPattern = /^[\w.-]{1,180}$/, ruleIdPattern = /^[a-z][a-z0-9.-]{0,63}$/, keyPattern = /^[a-z][a-z0-9-]{0,31}:[\w.@-]{1,180}$/, versionPattern = /^\d+\.\d+\.\d+$/;
// Same canonical JSON as headless `stable`; kept local so this module has no host dependency.
const stable = value => JSON.stringify(value, (_key, member) => member && typeof member === 'object' && !Array.isArray(member)
  ? Object.fromEntries(Object.entries(member).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : member);
const digest = async value => digestBytes(new TextEncoder().encode(stable(value)));
const text = (value, max) => typeof value === 'string' && value.length >= 1 && value.length <= max;
const list = (value, max, each, min = 0) => Array.isArray(value) && value.length >= min && value.length <= max && value.every(each);
const sortedUnique = values => values.every((value, index) => index === 0 || values[index - 1] < value);
const digests = value => only(value, ['recipeSha256', 'materials']) && hash(value.recipeSha256) && list(value.materials, 256, hash) && sortedUnique(value.materials);
// The item's own digests and those of every item it requires, so a change to a needed item is a material change too.
const required = value => only(value, ['itemId', 'recipeSha256', 'materials']) && typeof value.itemId === 'string' && idPattern.test(value.itemId) && digests({ recipeSha256: value.recipeSha256, materials: value.materials });
const content = value => only(value, ['recipeSha256', 'materials', 'requires']) && digests({ recipeSha256: value.recipeSha256, materials: value.materials })
  && list(value.requires, 256, required) && sortedUnique(value.requires.map(r => r.itemId));
const change = value => only(value, ['kind', 'itemId', 'releaseSha256', 'itemSha256', 'content']) && value.kind === 'add-item'
  && typeof value.itemId === 'string' && idPattern.test(value.itemId) && hash(value.releaseSha256) && hash(value.itemSha256) && content(value.content);
const trigger = value => only(value, ['ruleId', 'key', 'text']) && typeof value.ruleId === 'string' && ruleIdPattern.test(value.ruleId)
  && typeof value.key === 'string' && keyPattern.test(value.key) && text(value.text, 1000);
// JSON pointer (relative to the record) of the first violation of the closed suggestion shape, else null.
export function suggestionProblem(record) {
  if (!only(record, ['id', 'schema', 'required', 'rulesVersion', 'revision', 'scope', 'change', 'triggers', 'goal', 'references', 'facts', 'unknowns', 'recordedAt'])) return '';
  if (record.schema !== IMPROVEMENT_SUGGESTION_RECORD_SCHEMA) return '/schema';
  if (typeof record.id !== 'string' || !/^suggestion-[a-f0-9]{32}$/.test(record.id)) return '/id';
  if (record.required !== false) return '/required';
  if (typeof record.rulesVersion !== 'string' || !versionPattern.test(record.rulesVersion)) return '/rulesVersion';
  if (!hash(record.revision)) return '/revision';
  if (!['project', 'user'].includes(record.scope)) return '/scope';
  if (!change(record.change)) return '/change';
  if (!list(record.triggers, MAX_TRIGGERS, trigger, 1) || new Set(record.triggers.map(t => t.key)).size !== record.triggers.length) return '/triggers';
  if (!text(record.goal, 300)) return '/goal';
  if (!list(record.references, 32, r => only(r, ['kind', 'ref']) && REFERENCE_KINDS.includes(r.kind) && text(r.ref, 300))) return '/references';
  if (!list(record.facts, 16, f => only(f, ['kind', 'text']) && FACT_KINDS.includes(f.kind) && text(f.text, 1000))) return '/facts';
  if (!list(record.unknowns, 16, u => text(u, 1000))) return '/unknowns';
  if (!isUtcTimestamp(record.recordedAt)) return '/recordedAt';
  return null;
}
// One suggestion per (kind, item, scope): the same item at the same scope is the same suggestion whatever its label says.
export async function suggestionId({ change: { kind, itemId }, scope }) { return `suggestion-${(await digest({ kind, itemId, scope })).slice(0, 32)}`; }
// The revision covers only material inputs: the item's recipe and material digests and the set of trigger keys.
export async function suggestionRevision({ id, change: { content }, triggers }) {
  return digest({ id, content, triggers: [...new Set(triggers.map(t => t.key))].sort() });
}
// Whether two suggested contents are the same, whatever the key order.
export const sameContent = (a, b) => stable(a) === stable(b);
// Pointer of the first id or revision that does not derive from the record's own fields, else null.
export async function suggestionDerivedProblem(record) {
  if (record.id !== await suggestionId(record)) return '/id';
  if (record.revision !== await suggestionRevision(record)) return '/revision';
  return null;
}
// JSON pointer (relative to the record) of the first violation of the closed dismissal shape, else null.
export function dismissalProblem(record) {
  if (!only(record, ['id', 'schema', 'required', 'suggestion', 'recordedAt'], ['reason'])) return '';
  if (record.schema !== IMPROVEMENT_DISMISSAL_RECORD_SCHEMA) return '/schema';
  if (typeof record.id !== 'string' || !/^dismissal-[a-f0-9]{32}$/.test(record.id)) return '/id';
  if (record.required !== false) return '/required';
  if (!only(record.suggestion, ['id', 'revision']) || typeof record.suggestion.id !== 'string' || !/^suggestion-[a-f0-9]{32}$/.test(record.suggestion.id) || !hash(record.suggestion.revision)) return '/suggestion';
  if (!isUtcTimestamp(record.recordedAt)) return '/recordedAt';
  if (record.reason !== undefined && !text(record.reason, 1000)) return '/reason';
  return null;
}
// One dismissal per suggestion; dismissing it again replaces the record.
export async function dismissalId({ suggestion }) { return `dismissal-${(await digest({ suggestion: suggestion.id })).slice(0, 32)}`; }
// A suggestion record without a dismissal is tolerated: later record kinds (a trial) may reference a suggestion revision.
// Index of the first dismissal in `records` with no suggestion record of the same id and revision beside it, else -1.
export function unlinkedDismissal(records) {
  const suggestions = new Map(records.filter(r => r?.schema === IMPROVEMENT_SUGGESTION_RECORD_SCHEMA).map(r => [r.id, r.revision]));
  return records.findIndex(r => r?.schema === IMPROVEMENT_DISMISSAL_RECORD_SCHEMA && (!object(r.suggestion) || suggestions.get(r.suggestion.id) !== r.suggestion.revision));
}
