// Shapes of the optional maintenance records a journey envelope carries. Internal to the journey reader and the
// maintenance module (not a package export): both validate records with exactly these rules.
import { digestBytes, hash, object, only } from './intake.mjs';
export const MAINTENANCE_DISPOSITION_RECORD_SCHEMA = 'urn:aihq:workbench:journey-record:maintenance-disposition:1.0.0';
export const MAINTENANCE_CHECK_RECORD_SCHEMA = 'urn:aihq:workbench:journey-record:maintenance-check:1.0.0';
export const MAINTENANCE_CHECK_RECORD_ID = 'maintenance-check';
export const UPDATE_CATEGORIES = ['content', 'software', 'client', 'environment'];
const SUBJECT_KINDS = ['selection'], CANDIDATE_KINDS = ['content-revision'], DISPOSITIONS = ['keep-current', 'skip', 'defer'];
const CHECK_STATES = ['checked', 'unknown', 'not-selected'];
const idPattern = /^[\w.-]{1,180}$/;
// Same canonical JSON as headless `stable`; kept local so this module has no host dependency.
const stable = value => JSON.stringify(value, (_key, member) => member && typeof member === 'object' && !Array.isArray(member)
  ? Object.fromEntries(Object.entries(member).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : member);
// A real UTC timestamp: the pattern alone would accept 2026-13-01.
export const isUtcTimestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value)
  && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
const calendarDate = value => typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const ref = (value, kinds) => only(value, ['kind', 'releaseSha256', 'itemId', 'itemSha256']) && kinds.includes(value.kind)
  && hash(value.releaseSha256) && typeof value.itemId === 'string' && idPattern.test(value.itemId) && hash(value.itemSha256);
// JSON pointer (relative to the record) of the first violation of the closed disposition shape, else null.
export function dispositionProblem(record) {
  if (!only(record, ['id', 'schema', 'required', 'category', 'subject', 'scope', 'candidate', 'disposition', 'recordedAt'], ['reason', 'deferUntil'])) return '';
  if (record.schema !== MAINTENANCE_DISPOSITION_RECORD_SCHEMA) return '/schema';
  if (typeof record.id !== 'string' || !/^disposition-[a-f0-9]{32}$/.test(record.id)) return '/id';
  if (record.required !== false) return '/required';
  if (!UPDATE_CATEGORIES.includes(record.category)) return '/category';
  if (!ref(record.subject, SUBJECT_KINDS)) return '/subject';
  if (!['project', 'user'].includes(record.scope)) return '/scope';
  if (!ref(record.candidate, CANDIDATE_KINDS)
    || (record.candidate.releaseSha256 === record.subject.releaseSha256 && record.candidate.itemSha256 === record.subject.itemSha256)) return '/candidate';
  if (!DISPOSITIONS.includes(record.disposition)) return '/disposition';
  if (!isUtcTimestamp(record.recordedAt)) return '/recordedAt';
  if (record.reason !== undefined && (typeof record.reason !== 'string' || record.reason.length < 1 || record.reason.length > 1000)) return '/reason';
  if (record.deferUntil !== undefined && (record.disposition !== 'defer' || !calendarDate(record.deferUntil))) return '/deferUntil';
  return null;
}
// One record per exact (category, subject, scope, candidate); setting it again replaces it.
export async function dispositionId({ category, subject, scope, candidate }) {
  return `disposition-${(await digestBytes(new TextEncoder().encode(stable({ category, subject, scope, candidate })))).slice(0, 32)}`;
}
// The category states of one check: each known category at most once, with a reason only where it is unknown.
const checkCategories = value => Array.isArray(value) && value.length >= 1 && value.length <= UPDATE_CATEGORIES.length
  && value.every(entry => object(entry) && only(entry, ['category', 'state'], ['reason']) && UPDATE_CATEGORIES.includes(entry.category) && CHECK_STATES.includes(entry.state)
    && (entry.reason === undefined || (entry.state === 'unknown' && typeof entry.reason === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(entry.reason))))
  && new Set(value.map(entry => entry.category)).size === value.length;
// JSON pointer (relative to the record) of the first violation of the closed check shape, else null.
export function checkProblem(record) {
  if (!only(record, ['id', 'schema', 'required', 'checkedAt', 'categories'])) return '';
  if (record.schema !== MAINTENANCE_CHECK_RECORD_SCHEMA) return '/schema';
  if (record.id !== MAINTENANCE_CHECK_RECORD_ID) return '/id';
  if (record.required !== false) return '/required';
  if (!isUtcTimestamp(record.checkedAt)) return '/checkedAt';
  if (!checkCategories(record.categories)) return '/categories';
  return null;
}
