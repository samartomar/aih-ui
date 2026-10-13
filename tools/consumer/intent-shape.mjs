import { hash, object, only, checkInput } from './intake.mjs';
const id = value => typeof value === 'string' && /^[\w.-]{1,180}$/.test(value);
const scope = value => ['project', 'user'].includes(value);
const descriptor = value => only(value, ['path', 'sha256', 'byteLength'], ['id', 'schema']) && typeof value.path === 'string' && hash(value.sha256) && Number.isSafeInteger(value.byteLength) && value.byteLength >= 0;
const material = value => only(value, ['id', 'sha256', 'byteLength']) && id(value.id) && hash(value.sha256) && Number.isSafeInteger(value.byteLength) && value.byteLength >= 0;
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 1000;
const unique = (values, key) => new Set(values.map(key)).size === values.length;
export const rootKey = value => `${value.releaseSha256}/${value.itemId}/${value.scope}`;
export const pinKey = value => `${value.releaseSha256}/${value.itemId}`;
export function checkReview(review) {
  if (!only(review, ['schema', 'records', 'history']) || review.schema !== 'urn:aihq:workbench:review-decisions:1.0.0' || !Array.isArray(review.records) || !Array.isArray(review.history)) return false;
  const all = [...review.records, ...review.history];
  return all.length <= 4096 && unique(all, r => r?.id) && all.every(r => only(r, ['id', 'owner', 'actor', 'recordedAt', 'disposition', 'reason', 'subject', 'finding', 'evidence', 'state'], ['supersedes'])
    && id(r.id) && only(r.owner, ['kind', 'id']) && ['individual', 'organization'].includes(r.owner.kind) && identity(r.owner.id)
    && identity(r.actor) && identity(r.reason) && typeof r.recordedAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(r.recordedAt) && !Number.isNaN(Date.parse(r.recordedAt))
    && ['false-alarm', 'accepted-risk'].includes(r.disposition) && ['current', 'reconsider'].includes(r.state)
    && only(r.subject, ['releaseSha256', 'itemId', 'itemSha256', 'recipeIdentity', 'materials']) && hash(r.subject.releaseSha256) && id(r.subject.itemId) && hash(r.subject.itemSha256)
    && identity(r.subject.recipeIdentity) && Array.isArray(r.subject.materials) && r.subject.materials.every(material) && unique(r.subject.materials, m => m.id)
    && r.subject.materials.every((m, i, list) => i === 0 || list[i - 1].id < m.id)
    && only(r.finding, ['detectorId', 'ruleId', 'findingId']) && Object.values(r.finding).every(identity)
    && only(r.evidence, ['observationIdentity', 'detectorIdentity', 'rulesIdentity', 'configurationIdentity', 'profileIdentity', 'scopeIdentity', 'coverageIdentity']) && Object.values(r.evidence).every(identity)
    && (r.supersedes === undefined || (r.supersedes !== r.id && review.history.some(prior => prior.id === r.supersedes))));
}
export function checkIntentShape(intent) {
  if (!only(intent, ['schema', 'origins', 'roots', 'exclusions', 'pins', 'provenance', 'inputs', 'reviews']) || intent.schema !== 'urn:aihq:workbench:saved-intent:3.0.0') return false;
  if (['origins', 'roots', 'exclusions', 'pins', 'provenance', 'inputs'].some(field => !Array.isArray(intent[field]) || intent[field].length > 4096)) return false;
  if (['origins', 'roots', 'exclusions', 'pins', 'provenance', 'inputs'].some(field => intent[field].some(value => !object(value)))) return false;
  if (new TextEncoder().encode(JSON.stringify(intent)).length > 850_000 || !checkReview(intent.reviews)) return false;
  if (!unique(intent.origins, o => o?.id) || !intent.origins.every(o => id(o.id) && (o.kind === 'direct' ? only(o, ['id', 'kind'])
    : o.kind === 'template' ? only(o, ['id', 'kind', 'releaseSha256', 'templateId', 'templateSha256']) && hash(o.releaseSha256) && id(o.templateId) && hash(o.templateSha256)
    : o.kind === 'organization' && only(o, ['id', 'kind', 'organizationPolicySha256', 'organizationSelectionId']) && hash(o.organizationPolicySha256) && id(o.organizationSelectionId)))) return false;
  const ref = r => object(r) && hash(r.releaseSha256) && id(r.itemId);
  if (!unique(intent.roots, rootKey) || !intent.roots.every(r => only(r, ['releaseSha256', 'itemId', 'itemSha256', 'scope', 'configuration', 'originIds'], ['reason']) && ref(r) && hash(r.itemSha256) && scope(r.scope) && object(r.configuration)
    && Array.isArray(r.originIds) && r.originIds.length > 0 && unique(r.originIds, v => v) && r.originIds.every(origin => intent.origins.some(o => o.id === origin)) && (r.reason === undefined || identity(r.reason)))) return false;
  if (!unique(intent.exclusions, r => `${r.originId}/${rootKey(r)}`) || !intent.exclusions.every(r => only(r, ['originId', 'releaseSha256', 'itemId', 'scope'], ['reason']) && ref(r) && scope(r.scope) && intent.origins.some(o => o.id === r.originId) && (r.reason === undefined || identity(r.reason)))) return false;
  if (!unique(intent.pins, pinKey) || !intent.pins.every(p => only(p, ['releaseSha256', 'itemId', 'itemSha256', 'recipe', 'materials']) && ref(p) && hash(p.itemSha256) && descriptor(p.recipe) && Array.isArray(p.materials) && p.materials.every(m => descriptor(m) && id(m.id)))) return false;
  if (!unique(intent.inputs, i => i?.id) || !intent.inputs.every(i => checkInput(i))) return false;
  return unique(intent.provenance, p => p?.releaseSha256) && intent.provenance.every(p => only(p, ['releaseSha256', 'sources', 'materialSource'], ['package']) && hash(p.releaseSha256) && Array.isArray(p.sources) && object(p.materialSource));
}
