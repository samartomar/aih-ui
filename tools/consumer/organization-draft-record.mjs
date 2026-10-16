// Shape of the organization-draft journey record: the baseline an organization author is composing, kept
// beside the empty Enterprise starting policy it travels with. Internal to the journey reader and the
// organization author (not a package export): both validate the record with exactly these rules.
// Structural only. Core validates selector values, obligations and the exported document.
import { digestBytes, object, only } from './intake.mjs';
export const ORGANIZATION_DRAFT_RECORD_SCHEMA = 'urn:aihq:workbench:journey-record:organization-draft:1.0.0';
export const ORGANIZATION_DRAFT_RECORD_ID = 'organization-draft';
export const ORGANIZATION_OBLIGATIONS = ['required', 'recommended', 'permitted', 'prohibited'];
export const ORGANIZATION_SCOPES = ['project', 'user'];
export const ORGANIZATION_REVISION_KINDS = ['branch', 'tag', 'commit'];
const MAX_ENTRIES = 4096, MAX_TARGETS = 64;
const idPattern = /^[\w.-]{1,180}$/, hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
// Same canonical JSON as headless `stable`; kept local so this module has no host dependency.
const stable = value => JSON.stringify(value, (_key, member) => member && typeof member === 'object' && !Array.isArray(member)
  ? Object.fromEntries(Object.entries(member).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : member);
const digest = async value => (await digestBytes(new TextEncoder().encode(stable(value)))).slice(0, 32);
export async function organizationEntryId({ releaseSha256, itemId, scope }) { return `entry-${await digest({ releaseSha256, itemId, scope })}`; }
export async function organizationTargetId({ scope, client, repository }) {
  return `target-${await digest({ scope, ...(client !== undefined ? { client } : {}), ...(repository !== undefined ? { repository } : {}) })}`;
}
// A source is copied into git and gh commands, so only characters that no shell treats specially are accepted.
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, NAME = /^[A-Za-z0-9._-]{1,100}$/, SEGMENT = /^[A-Za-z0-9._-]+$/, REF = /^[A-Za-z0-9._/-]{1,200}$/, COMMIT = /^[0-9a-f]{40}$/;
const dots = value => value === '.' || value === '..';
const pathOk = value => typeof value === 'string' && value.length <= 512 && value.endsWith('.json') && value.split('/').every(part => SEGMENT.test(part) && !dots(part));
const refOk = value => typeof value === 'string' && REF.test(value) && !value.includes('..') && !value.includes('//') && !value.startsWith('/') && !value.endsWith('/') && !value.startsWith('-');
export function organizationSourceProblem(source) {
  if (!only(source, ['provider', 'repository', 'path', 'revision']) || source.provider !== 'github') return '';
  const { repository, revision } = source;
  if (!only(repository, ['owner', 'name']) || typeof repository.owner !== 'string' || !OWNER.test(repository.owner)
    || typeof repository.name !== 'string' || !NAME.test(repository.name) || dots(repository.name)) return '';
  if (!pathOk(source.path)) return '';
  if (!only(revision, ['kind', 'value']) || !ORGANIZATION_REVISION_KINDS.includes(revision.kind)) return '';
  if (revision.kind === 'commit' ? typeof revision.value !== 'string' || !COMMIT.test(revision.value) : !refOk(revision.value)) return '';
  return null;
}
const boundedStrings = (value, count, length) => Array.isArray(value) && value.length >= 1 && value.length <= count
  && value.every(member => typeof member === 'string' && member.length >= 1 && member.length <= length) && new Set(value).size === value.length;
// One permission per recipe input name; `fixed` carries any JSON value, so only its container is checked here.
export function organizationPermissionProblem(permission) {
  if (only(permission, ['fixed'])) return null;
  if (only(permission, ['choices'])) {
    const { choices } = permission;
    return Array.isArray(choices) && choices.length >= 1 && choices.length <= 256 && new Set(choices.map(stable)).size === choices.length ? null : '';
  }
  return only(permission, ['allowDeclared']) && permission.allowDeclared === true ? null : '';
}
function entryProblem(entry) {
  if (!only(entry, ['id', 'item', 'scope', 'inputs'], ['obligation', 'clients', 'repositories'])) return '';
  if (typeof entry.id !== 'string' || !/^entry-[a-f0-9]{32}$/.test(entry.id)) return '/id';
  const { item } = entry;
  if (!only(item, ['releaseSha256', 'itemId', 'itemSha256']) || !hash(item.releaseSha256) || typeof item.itemId !== 'string' || !idPattern.test(item.itemId) || !hash(item.itemSha256)) return '/item';
  if (!ORGANIZATION_SCOPES.includes(entry.scope)) return '/scope';
  if (entry.obligation !== undefined && !ORGANIZATION_OBLIGATIONS.includes(entry.obligation)) return '/obligation';
  if (entry.clients !== undefined && !boundedStrings(entry.clients, 64, 128)) return '/clients';
  if (entry.repositories !== undefined && !boundedStrings(entry.repositories, 4096, 512)) return '/repositories';
  if (!object(entry.inputs)) return '/inputs';
  for (const [name, permission] of Object.entries(entry.inputs)) if (!idPattern.test(name) || organizationPermissionProblem(permission) !== null) return `/inputs/${name}`;
  return null;
}
function targetProblem(target) {
  if (!only(target, ['id', 'scope'], ['client', 'repository'])) return '';
  if (typeof target.id !== 'string' || !/^target-[a-f0-9]{32}$/.test(target.id)) return '/id';
  if (!ORGANIZATION_SCOPES.includes(target.scope)) return '/scope';
  if (target.client !== undefined && (typeof target.client !== 'string' || target.client.length < 1 || target.client.length > 128)) return '/client';
  if (target.repository !== undefined && (typeof target.repository !== 'string' || target.repository.length < 1 || target.repository.length > 512)) return '/repository';
  return null;
}
// JSON pointer (relative to the record) of the first violation of the closed record shape, else null.
export function organizationDraftProblem(record) {
  if (!only(record, ['id', 'schema', 'required', 'entries', 'targets'], ['policyId', 'source'])) return '';
  if (record.schema !== ORGANIZATION_DRAFT_RECORD_SCHEMA) return '/schema';
  if (record.id !== ORGANIZATION_DRAFT_RECORD_ID) return '/id';
  if (record.required !== true) return '/required';
  if (record.policyId !== undefined && (typeof record.policyId !== 'string' || !idPattern.test(record.policyId))) return '/policyId';
  if (record.source !== undefined && organizationSourceProblem(record.source) !== null) return '/source';
  if (!Array.isArray(record.entries) || record.entries.length > MAX_ENTRIES) return '/entries';
  if (!Array.isArray(record.targets) || record.targets.length > MAX_TARGETS) return '/targets';
  const entryIds = new Set(), targetIds = new Set();
  for (const [index, entry] of record.entries.entries()) {
    const problem = entryProblem(entry);
    if (problem !== null) return `/entries/${index}${problem}`;
    if (entryIds.has(entry.id)) return `/entries/${index}/id`;
    entryIds.add(entry.id);
  }
  for (const [index, target] of record.targets.entries()) {
    const problem = targetProblem(target);
    if (problem !== null) return `/targets/${index}${problem}`;
    if (targetIds.has(target.id)) return `/targets/${index}/id`;
    targetIds.add(target.id);
  }
  return null;
}
// Ids are derived, so a well-formed id that names something else is as malformed as a bad pattern.
export async function organizationDraftDerivedProblem(record) {
  for (const [index, entry] of record.entries.entries()) if (entry.id !== await organizationEntryId({ ...entry.item, scope: entry.scope })) return `/entries/${index}/id`;
  for (const [index, target] of record.targets.entries()) if (target.id !== await organizationTargetId(target)) return `/targets/${index}/id`;
  return null;
}
