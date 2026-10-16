// Authored consumer schemas; owning Catalog/Core validators check referenced data.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
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
// Journey envelope: separately versioned wrapper that references exact saved-intent bytes and is never executable.
// These URNs mirror tools/consumer/journey.mjs (journey.test.mjs asserts they agree); that module needs the
// installed @aihq packages, which this repo-root script does not have.
const journeyRecord = 'urn:aihq:workbench:journey-record:unresolved-draft:1.0.0', journeyEnvelope = 'urn:aihq:workbench:journey-envelope:1.0.0';
const dispositionRecord = 'urn:aihq:workbench:journey-record:maintenance-disposition:1.0.0';
const recordUrn = { type: 'string', pattern: String.raw`^urn:aihq:workbench:journey-record:[a-z0-9-]+:\d+\.\d+\.\d+$` };
// Maintenance disposition: an optional record of what a person chose to do about one exact available update.
// Its id derives from (category, subject, scope, candidate), which a schema cannot express; the reader checks it.
const dispositionRef = kind => shape({ kind, releaseSha256: hash, itemId: id, itemSha256: hash });
const disposition = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: dispositionRecord, ...shape({
  id: { type: 'string', pattern: '^disposition-[a-f0-9]{32}$' }, schema: { const: dispositionRecord }, required: { const: false },
  category: { enum: ['content', 'software', 'client', 'environment'] },
  subject: dispositionRef({ enum: ['selection'] }), scope, candidate: dispositionRef({ enum: ['content-revision'] }),
  disposition: { enum: ['keep-current', 'skip', 'defer'] },
  recordedAt: { type: 'string', pattern: '^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d(?:\\.\\d+)?Z$' },
  reason: string, deferUntil: { type: 'string', pattern: '^\\d{4}-\\d\\d-\\d\\d$' }
}, ['reason', 'deferUntil']), allOf: [{ if: { required: ['deferUntil'] }, then: { properties: { disposition: { const: 'defer' } } } }] };
const journey = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: journeyEnvelope, ...shape({
  schema: { const: journeyEnvelope },
  id: { type: 'string', pattern: '^journey-[a-f0-9]{32}$' },
  revision: shape({ sequence: { type: 'integer', minimum: 1 }, sha256: hash, previousSha256: hash }, ['previousSha256']),
  executable: { const: false },
  savedIntent: shape({ type: { const: 'urn:aihq:core:execution-policy-bytes' }, mediaType: { const: 'application/json' }, sha256: hash,
    byteLength: { type: 'integer', minimum: 0, maximum: 1000000 }, base64: { type: 'string', maxLength: 1333336, pattern: '^[A-Za-z0-9+/]*={0,2}$' } }),
  records: array({ if: { required: ['schema'], properties: { schema: { const: journeyRecord } } },
    then: shape({ id, schema: { const: journeyRecord }, required: { const: true }, savedIntentSha256: hash, intent: { $ref: saved.$id } }),
    else: { type: 'object', required: ['id', 'schema', 'required'], additionalProperties: true, properties: { id, schema: recordUrn, required: { type: 'boolean' } } },
    allOf: [{ if: { required: ['schema'], properties: { schema: { const: dispositionRecord } } }, then: { $ref: dispositionRecord } }] })
}) };
mkdirSync(new URL('../schemas/', import.meta.url), { recursive: true });
for (const [name, schema] of [['saved-intent-3.0.0', saved], ['review-decisions-1.0.0', review], ['journey-envelope-1.0.0', journey], ['journey-record-maintenance-disposition-1.0.0', disposition]]) {
  const path = new URL(`../schemas/${name}.json`, import.meta.url), expected = JSON.stringify(schema, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8').replaceAll('\r\n', '\n') !== expected) throw new Error(`Schema is stale: ${name}`);
  } else writeFileSync(path, expected);
}
