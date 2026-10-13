// Authored consumer schemas; owning Catalog/Core validators check referenced data.
import { mkdirSync, writeFileSync } from 'node:fs';
const string = { type: 'string', minLength: 1, maxLength: 1000 }, id = { type: 'string', pattern: '^[\\w.-]{1,180}$' }, hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const shape = (properties, optional = []) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties).filter(k => !optional.includes(k)), properties });
const array = items => ({ type: 'array', maxItems: 4096, items });
const scope = { enum: ['project', 'user'] }, ref = { releaseSha256: hash, itemId: id };
const descriptor = shape({ id, schema: string, path: string, sha256: hash, byteLength: { type: 'integer', minimum: 0 } }, ['id', 'schema']);
const material = shape({ id, sha256: hash, byteLength: { type: 'integer', minimum: 0 } });
const reviewRecord = shape({ id, owner: shape({ kind: { enum: ['individual', 'organization'] }, id: string }), actor: string,
  recordedAt: { type: 'string', pattern: '^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d(?:\\.\\d+)?Z$' },
  disposition: { enum: ['false-alarm', 'accepted-risk'] }, reason: string,
  subject: shape({ ...ref, itemSha256: hash, recipeIdentity: string, materials: array(material) }),
  finding: shape({ detectorId: string, ruleId: string, findingId: string }),
  evidence: shape(Object.fromEntries(['observationIdentity', 'detectorIdentity', 'rulesIdentity', 'configurationIdentity', 'profileIdentity', 'scopeIdentity', 'coverageIdentity'].map(k => [k, string]))),
  state: { enum: ['current', 'reconsider'] }, supersedes: id }, ['supersedes']);
const review = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:aihq:workbench:review-decisions:1.0.0',
  ...shape({ schema: { const: 'urn:aihq:workbench:review-decisions:1.0.0' }, records: array(reviewRecord), history: array(reviewRecord) }) };
const input = (kind, locator, resolvedIdentity) => shape({ id, kind: { const: kind }, locator, resolvedIdentity, releaseSha256: hash });
const saved = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:aihq:workbench:saved-intent:3.0.0', ...shape({
  schema: { const: 'urn:aihq:workbench:saved-intent:3.0.0' },
  origins: array({ oneOf: [shape({ id, kind: { const: 'direct' } }), shape({ id, kind: { const: 'template' }, releaseSha256: hash, templateId: id, templateSha256: hash }),
    shape({ id, kind: { const: 'organization' }, organizationPolicySha256: hash, organizationSelectionId: id })] }),
  roots: array(shape({ ...ref, itemSha256: hash, scope, configuration: { type: 'object' }, originIds: { type: 'array', minItems: 1, uniqueItems: true, items: id }, reason: string }, ['reason'])),
  exclusions: array(shape({ originId: id, ...ref, scope, reason: string }, ['reason'])),
  pins: array(shape({ ...ref, itemSha256: hash, recipe: descriptor, materials: array({ ...descriptor, required: [...descriptor.required, 'id'] }) })),
  provenance: array(shape({ releaseSha256: hash, package: shape({ name: string, version: string }), sources: { type: 'array', items: { type: 'object' } }, materialSource: { type: 'object' } }, ['package'])),
  inputs: array({ oneOf: [input('local', shape({ input: id }), shape({ sha256: hash })),
    input('git', shape({ repository: string, ref: string }, ['ref']), shape({ revision: { type: 'string', pattern: '^[a-f0-9]{40,64}$' }, sha256: hash })),
    input('npm', shape({ name: string, range: string }, ['range']), shape({ version: string, integrity: { type: 'string', pattern: '^sha(256|384|512)-[A-Za-z0-9+/]+={0,2}$' }, sha256: hash })),
    input('organization', shape({ authorityId: id, sourceId: id }), shape({ revision: string, sha256: hash }))] }),
  reviews: { $ref: review.$id }
}) };
mkdirSync(new URL('../schemas/', import.meta.url), { recursive: true });
for (const [name, schema] of [['saved-intent-3.0.0', saved], ['review-decisions-1.0.0', review]]) writeFileSync(new URL(`../schemas/${name}.json`, import.meta.url), JSON.stringify(schema, null, 2) + '\n');
