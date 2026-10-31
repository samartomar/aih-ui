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
const dispositionRecord = 'urn:aihq:workbench:journey-record:maintenance-disposition:1.0.0', checkRecord = 'urn:aihq:workbench:journey-record:maintenance-check:1.0.0';
const organizationRecord = 'urn:aihq:workbench:journey-record:organization-draft:1.0.0';
const suggestionRecord = 'urn:aihq:workbench:journey-record:improvement-suggestion:1.0.0', dismissalRecord = 'urn:aihq:workbench:journey-record:improvement-dismissal:1.0.0';
const workspaceRecord = 'urn:aihq:workbench:journey-record:workspace-declaration:1.0.0', bindingRecord = 'urn:aihq:workbench:journey-record:local-binding:1.0.0';
const batchRecord = 'urn:aihq:workbench:journey-record:reviewed-batch:1.0.0', trialRecord = 'urn:aihq:workbench:journey-record:improvement-trial:1.0.0';
const utcTimestamp = { type: 'string', pattern: '^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d(?:\\.\\d+)?Z$' };
const updateCategory = { enum: ['content', 'software', 'client', 'environment'] };
const recordUrn = { type: 'string', pattern: String.raw`^urn:aihq:workbench:journey-record:[a-z0-9-]+:\d+\.\d+\.\d+$` };
// Maintenance disposition: an optional record of what a person chose to do about one exact available update.
// The reader (tools/consumer/maintenance-record.mjs) also enforces what a schema cannot express, so a record this
// schema accepts can still be refused when the Workbench opens it:
//   - its id is derived from (category, subject, scope, candidate);
//   - the candidate must differ from the subject (release or item digest);
//   - recordedAt and deferUntil must be a real calendar timestamp and date (the patterns accept 2026-02-30).
const dispositionRef = kind => shape({ kind, releaseSha256: hash, itemId: id, itemSha256: hash });
const disposition = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: dispositionRecord, ...shape({
  id: { type: 'string', pattern: '^disposition-[a-f0-9]{32}$' }, schema: { const: dispositionRecord }, required: { const: false },
  category: updateCategory,
  subject: dispositionRef({ enum: ['selection'] }), scope, candidate: dispositionRef({ enum: ['content-revision'] }),
  disposition: { enum: ['keep-current', 'skip', 'defer'] },
  recordedAt: utcTimestamp,
  reason: string, deferUntil: { type: 'string', pattern: '^\\d{4}-\\d\\d-\\d\\d$' }
}, ['reason', 'deferUntil']), allOf: [{ if: { required: ['deferUntil'] }, then: { properties: { disposition: { const: 'defer' } } } }] };
// Maintenance check: the optional note of the last successful check, one fixed-id record per envelope. The reader also
// requires a real calendar timestamp for checkedAt and each category at most once.
const check = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: checkRecord, ...shape({
  id: { const: 'maintenance-check' }, schema: { const: checkRecord }, required: { const: false }, checkedAt: utcTimestamp,
  categories: { type: 'array', minItems: 1, maxItems: 4, items: { ...shape({ category: updateCategory, state: { enum: ['checked', 'unknown', 'not-selected'] },
    reason: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,63}$' } }, ['reason']), allOf: [{ if: { required: ['reason'] }, then: { properties: { state: { const: 'unknown' } } } }] } }
}) };
// Organization draft: the baseline an organization author is composing, one fixed-id required record per envelope.
// Everything not yet decided is simply absent. The reader (tools/consumer/organization-draft-record.mjs) also enforces
// what a schema cannot express, so a record this schema accepts can still be refused when the Workbench opens it:
//   - entry and target ids are derived (sha256 of the stable item/scope or scope/client/repository, first 32 hex);
//   - entry and target ids are unique, a source path has no empty, "." or ".." segment, and a repository name is not "." or "..";
//   - a branch or tag value has no "..", "//", leading "-" or leading/trailing "/".
// Selector values, obligations and the exported document are validated by Core when previewed or exported.
const orgStrings = (maxItems, maxLength) => ({ type: 'array', minItems: 1, maxItems, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength } });
const orgPermission = { oneOf: [shape({ fixed: {} }), shape({ choices: { type: 'array', minItems: 1, maxItems: 256, uniqueItems: true } }), shape({ allowDeclared: { const: true } })] };
const orgSource = shape({ provider: { const: 'github' },
  repository: shape({ owner: { type: 'string', pattern: '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$' }, name: { type: 'string', pattern: '^[A-Za-z0-9._][A-Za-z0-9._-]{0,99}$' } }),
  path: { type: 'string', maxLength: 512, pattern: '^[A-Za-z0-9._][A-Za-z0-9._-]*(?:/[A-Za-z0-9._][A-Za-z0-9._-]*)*\\.json$' },
  revision: { ...shape({ kind: { enum: ['branch', 'tag', 'commit'] }, value: { type: 'string', minLength: 1, maxLength: 200, pattern: '^[A-Za-z0-9._/-]+$' } }),
    allOf: [{ if: { required: ['kind'], properties: { kind: { const: 'commit' } } }, then: { properties: { value: { pattern: '^[0-9a-f]{40}$' } } } }] } });
const organizationEntry = shape({ id: { type: 'string', pattern: '^entry-[a-f0-9]{32}$' }, item: shape({ releaseSha256: hash, itemId: id, itemSha256: hash }), scope,
  obligation: { enum: ['required', 'recommended', 'permitted', 'prohibited'] }, clients: orgStrings(64, 128), repositories: orgStrings(4096, 512),
  inputs: { type: 'object', propertyNames: id, additionalProperties: orgPermission } }, ['obligation', 'clients', 'repositories']);
const organizationTarget = shape({ id: { type: 'string', pattern: '^target-[a-f0-9]{32}$' }, scope, client: { type: 'string', minLength: 1, maxLength: 128 },
  repository: { type: 'string', minLength: 1, maxLength: 512 } }, ['client', 'repository']);
const organizationDraft = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: organizationRecord, ...shape({
  id: { const: 'organization-draft' }, schema: { const: organizationRecord }, required: { const: true }, policyId: id, source: orgSource,
  entries: array(organizationEntry), targets: { type: 'array', maxItems: 64, items: organizationTarget }
}, ['policyId', 'source']) };
// Improvement suggestion: the suggestion a person dismissed, kept so a later check can tell whether anything material
// changed. The reader (tools/consumer/improvement-record.mjs) also enforces what a schema cannot express, so a record
// this schema accepts can still be refused when the Workbench opens it:
//   - id is derived from (kind, item, scope); revision from the id, the content and the sorted trigger keys;
//   - content.materials (also each required item's) are sorted and unique, content.requires is sorted by unique itemId, and trigger keys are unique;
//   - recordedAt must be a real calendar timestamp.
const suggestionText = (maxLength = 1000) => ({ type: 'string', minLength: 1, maxLength });
const suggestionDigests = { type: 'array', maxItems: 256, uniqueItems: true, items: hash };
const improvementSuggestion = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: suggestionRecord, ...shape({
  id: { type: 'string', pattern: '^suggestion-[a-f0-9]{32}$' }, schema: { const: suggestionRecord }, required: { const: false },
  rulesVersion: { type: 'string', pattern: String.raw`^\d+\.\d+\.\d+$` }, revision: hash, scope,
  change: shape({ kind: { const: 'add-item' }, itemId: id, releaseSha256: hash, itemSha256: hash,
    content: shape({ recipeSha256: hash, materials: suggestionDigests, requires: { type: 'array', maxItems: 256, items: shape({ itemId: id, recipeSha256: hash, materials: suggestionDigests }) } }) }),
  triggers: { type: 'array', minItems: 1, maxItems: 16, items: shape({ ruleId: { type: 'string', pattern: '^[a-z][a-z0-9.-]{0,63}$' },
    key: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,31}:[\\w.@-]{1,180}$' }, text: suggestionText() }) },
  goal: suggestionText(300),
  references: { type: 'array', maxItems: 32, items: shape({ kind: { enum: ['setting', 'saved-reason', 'request', 'catalog-item'] }, ref: suggestionText(300) }) },
  facts: { type: 'array', maxItems: 16, items: shape({ kind: { enum: ['overhead', 'scope', 'dependency'] }, text: suggestionText() }) },
  unknowns: { type: 'array', maxItems: 16, items: suggestionText() },
  recordedAt: utcTimestamp
}) };
// Improvement dismissal: one record per suggestion, binding the exact suggestion revision it dismissed. The reader also
// requires its id to derive from the suggestion id and a suggestion record with the same id and revision in the same envelope.
const improvementDismissal = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: dismissalRecord, ...shape({
  id: { type: 'string', pattern: '^dismissal-[a-f0-9]{32}$' }, schema: { const: dismissalRecord }, required: { const: false },
  suggestion: shape({ id: { type: 'string', pattern: '^suggestion-[a-f0-9]{32}$' }, revision: hash }), recordedAt: utcTimestamp, reason: suggestionText()
}, ['reason']) };
// Improvement trial: one bounded trial of a suggested item. The quality it must meet is defined at proposal and never changes
// afterwards (a revision is a new trial); observations are for the baseline and the trial option; stop, restoration and the
// evidence snapshot are separate facts. The reader (tools/consumer/trial-record.mjs) also enforces what a schema cannot express,
// so a record this schema accepts can still be refused when the Workbench opens it:
//   - id derives from the suggestion (id and revision), scope and proposedAt; each observation id derives from its option and target;
//   - revision is the sha256 of the record's canonical JSON without revision (id included), recomputed by every write;
//   - at least one bound is required (a trial with none is not bounded);
//   - the suggestion record with the same id (any revision; the trial names the one it was planned from) must sit in the same envelope;
//   - revises and revisedBy name another trial, never the record itself;
//   - check ids and bound ids are unique, and there is at most one observation per (option, target);
//   - a check observation names a quality check of this trial, with unit "outcome" and amount "passed" or "failed"; a dimension
//     observation has a numeric amount;
//   - startedAt is required when started or kept and absent when proposed (a trial stopped or revised while still proposed never
//     started); observations exist only once it started;
//   - every timestamp must be a real calendar timestamp.
// When recording (not when reading), the change is copied from the suggestion at proposal and an enforced bound is refused unless
// the host names that mechanism; a stored enforced bound whose mechanism the host lacks is shown as not a cap.
const trialId = { type: 'string', pattern: '^trial-[a-f0-9]{32}$' }, trialSlug = { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$' };
const trialDecided = { enum: ['kept', 'revised', 'stopped'] };
const trialObservation = { ...shape({ id: trialSlug, option: { enum: ['baseline', 'trial'] }, target: { oneOf: [shape({ dimension: { enum: ['setup', 'indexing', 'runtime-context', 'maintenance'] } }), shape({ check: trialSlug })] },
  kind: { enum: ['measured', 'estimated', 'declared', 'unknown'] }, value: shape({ amount: { anyOf: [{ type: 'number', minimum: 0 }, { enum: ['passed', 'failed'] }] }, unit: suggestionText(32) }),
  method: shape({ id: trialSlug, version: { type: 'string', pattern: String.raw`^\d+\.\d+\.\d+$` } }), unknownReason: suggestionText(300), source: { enum: ['person', 'host'] }, recordedAt: utcTimestamp }, ['value', 'method', 'unknownReason']),
  allOf: [{ if: { properties: { kind: { const: 'unknown' } }, required: ['kind'] }, then: { required: ['unknownReason'], properties: { value: false, method: false } }, else: { required: ['value'], properties: { unknownReason: false } } },
    { if: { properties: { kind: { const: 'estimated' } }, required: ['kind'] }, then: { required: ['method'] }, else: { properties: { method: false } } }] };
const improvementTrial = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: trialRecord, ...shape({
  id: trialId, schema: { const: trialRecord }, required: { const: false }, revision: hash, suggestion: shape({ id: { type: 'string', pattern: '^suggestion-[a-f0-9]{32}$' }, revision: hash }),
  change: shape({ kind: { const: 'add-item' }, itemId: id, releaseSha256: hash, itemSha256: hash }), scope,
  baseline: shape({ savedIntentSha256: hash, draftSha256: hash }), task: suggestionText(),
  quality: shape({ outcome: suggestionText(), checks: { type: 'array', minItems: 1, maxItems: 16, items: shape({ id: trialSlug, text: suggestionText(300) }) } }), conditions: suggestionText(),
  bounds: { type: 'array', minItems: 1, maxItems: 16, items: shape({ id: trialSlug, label: suggestionText(120), unit: suggestionText(32), value: { type: 'number', minimum: 0 },
    enforcement: { oneOf: [shape({ kind: { const: 'advisory' } }), shape({ kind: { const: 'enforced' }, mechanism: shape({ id: trialSlug, label: suggestionText(120) }) })] } }) },
  unknowns: { type: 'array', maxItems: 16, items: suggestionText(300) }, state: { enum: ['proposed', 'started', 'kept', 'revised', 'stopped'] },
  proposedAt: utcTimestamp, startedAt: utcTimestamp, decidedAt: utcTimestamp, observations: { type: 'array', maxItems: 256, items: trialObservation },
  evidence: shape({ outcome: { enum: ['qualifying-improvement', 'no-qualifying-improvement', 'inconclusive'] }, evaluatedAt: utcTimestamp }),
  narrower: shape({ qualification: suggestionText(), acceptedAt: utcTimestamp }), reason: suggestionText(), revises: trialId, revisedBy: trialId,
  adopted: shape({ root: shape({ ...ref, scope }), draftSha256: hash }),
  restoration: shape({ status: { enum: ['proposed', 'pending', 'completed', 'partial', 'unsupported'] }, effects: { type: 'array', maxItems: 16, items: suggestionText(300) }, note: suggestionText(), recordedAt: utcTimestamp }, ['note'])
}, ['startedAt', 'decidedAt', 'evidence', 'narrower', 'reason', 'revises', 'revisedBy', 'adopted', 'restoration']), allOf: [
  { if: { required: ['state'], properties: { state: trialDecided } }, then: { required: ['decidedAt', 'evidence'] }, else: { properties: { decidedAt: false, evidence: false, reason: false } } },
  { if: { required: ['state'], properties: { state: { enum: ['started', 'kept'] } } }, then: { required: ['startedAt'] } },
  { if: { required: ['state'], properties: { state: { const: 'proposed' } } }, then: { properties: { startedAt: false, observations: { maxItems: 0 } } } },
  { if: { required: ['state'], properties: { state: { const: 'kept' } } }, then: { required: ['adopted'] }, else: { properties: { adopted: false } } },
  { if: { required: ['state'], properties: { state: { const: 'revised' } } }, then: { required: ['revisedBy'] }, else: { properties: { revisedBy: false } } },
  { if: { required: ['state'], properties: { state: { const: 'stopped' } } }, then: {}, else: { properties: { restoration: false } } }] };
// Workspace declaration: the portable record of which repositories make up one workspace and how they relate, one
// fixed-id optional record per envelope. It never holds a local path or a credential; the reader
// (tools/consumer/workspace-record.mjs) enforces what a schema cannot express, so a record this schema accepts can still be
// refused when the Workbench opens it:
//   - revision is the sha256 of the stable workspace, members and relationships; each relationship id is derived from (from, to, kind);
//   - members and relationships are sorted by id, aliases are sorted, unique and differ from the identity (case folds only on github.com, gitlab.com and bitbucket.org);
//   - relationship endpoints are declared members and differ from each other;
//   - every free-text field, instruction location and contract reference is refused when it holds a drive or UNC path, a
//     file: URL, a ~/ path, an absolute POSIX path of two or more segments, a URL with userinfo or a recognizable credential
//     (token, key or password assignments and common provider token prefixes); locations and contract paths are
//     repository-relative (no leading slash, no .. or . segment);
//   - recordedAt must be a real calendar timestamp.
// An empty members or confirmed list is valid, and relationships.status stays "unresolved" until the owner says otherwise.
const memberSlug = { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$' };
const repoIdentity = { type: 'string', maxLength: 512, pattern: String.raw`^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[1-9]\d{0,4})?(?:/[\w.+~-]+){2,}$` };
const repoPath = { type: 'string', minLength: 1, maxLength: 512, pattern: String.raw`^(?![/\\~])(?![A-Za-z]:)(?!.*\\)(?!.*(?:^|/)\.{0,2}(?:/|$))[^\x00-\x1f]+$` };
const contractRef = { anyOf: [repoPath, { type: 'string', maxLength: 300, pattern: String.raw`^urn:[A-Za-z0-9][A-Za-z0-9-]{0,31}:[\w.:@%/+-]+$` }] };
const knownField = (key, items, maxItems) => ({ oneOf: [shape({ status: { const: 'unresolved' } }),
  shape({ status: { const: 'known' }, [key]: { type: 'array', minItems: 1, maxItems, items } })] });
const workspaceMember = shape({ id: memberSlug, identity: repoIdentity, aliases: { type: 'array', maxItems: 16, uniqueItems: true, items: repoIdentity }, label: suggestionText(120),
  responsibilities: knownField('values', suggestionText(300), 32), instructions: knownField('locations', repoPath, 32), contracts: knownField('references', contractRef, 64) }, ['label']);
const relationshipEdge = extra => shape({ id: { type: 'string', pattern: '^relationship-[a-f0-9]{32}$' }, from: memberSlug, to: memberSlug,
  kind: { enum: ['depends-on', 'consumes-api', 'deploys', 'shares-contract'] }, ...extra });
const workspaceDeclaration = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: workspaceRecord, ...shape({
  id: { const: 'workspace-declaration' }, schema: { const: workspaceRecord }, required: { const: false },
  workspace: shape({ id: { type: 'string', pattern: '^workspace-[a-f0-9]{32}$' }, label: suggestionText(120) }, ['label']), revision: hash,
  members: { type: 'array', maxItems: 64, items: workspaceMember },
  relationships: shape({ status: { enum: ['unresolved', 'complete'] },
    confirmed: { type: 'array', maxItems: 256, items: relationshipEdge({ provenance: shape({ kind: { enum: ['owner', 'contract', 'instruction'] }, ref: suggestionText(300), recordedAt: utcTimestamp }, ['ref']) }) },
    suggested: { type: 'array', maxItems: 256, items: relationshipEdge({ reason: suggestionText(300) }) } })
}) };
// Local binding: local state that ties one declared member to one checkout folder; never part of a default sharing export
// and never portable execution permission. The reader also requires its id to derive from (workspace id, member id,
// checkout root), reasons to be sorted and empty exactly when the result is "matched", remotes to be sorted by unique name
// (a remote whose name cannot be carried is recorded as "(unrecognized)" with no identity),
// and verifiedAt to be a real calendar timestamp. A different worktree has a different root, so its own binding.
const bindingCommit = { type: 'string', pattern: '^(?:[a-f0-9]{40}|[a-f0-9]{64})$' }, nullable = schema => ({ oneOf: [schema, { type: 'null' }] });
const localBinding = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: bindingRecord, ...shape({
  id: { type: 'string', pattern: '^binding-[a-f0-9]{32}$' }, schema: { const: bindingRecord }, required: { const: false },
  workspace: shape({ id: { type: 'string', pattern: '^workspace-[a-f0-9]{32}$' }, revision: hash }),
  member: shape({ id: memberSlug, identity: repoIdentity }),
  checkout: shape({ root: { type: 'string', minLength: 1, maxLength: 1024, pattern: String.raw`^(?:[A-Za-z]:[\\/]|\\\\|/)` } }),
  observed: shape({ repository: nullable(repoIdentity),
    remotes: { type: 'array', maxItems: 32, items: shape({ name: { type: 'string', pattern: String.raw`^(?:[\w./-]{1,200}|\(unrecognized\))$` }, identity: nullable(repoIdentity) }) },
    revision: nullable(bindingCommit), branch: suggestionText(255),
    worktree: shape({ kind: { enum: ['main', 'linked'] }, gitDirSha256: hash }), workingState: shape({ clean: { type: 'boolean' }, sha256: hash }) }, ['branch']),
  verification: shape({ result: { enum: ['matched', 'confirmed'] }, reasons: { type: 'array', maxItems: 6, uniqueItems: true, items: { enum: ['additional-checkout', 'ambiguous-remote', 'fork', 'moved', 'no-remote', 'similar-name'] } }, verifiedAt: utcTimestamp }),
  replaces: { type: 'string', pattern: '^binding-[a-f0-9]{32}$' }
}, ['replaces']) };
// Reviewed batch: the durable description of one multi-scope change, one optional record per distinct plan. It is never a prepared
// handle: no session id, review digest, run id or outcome can appear (the shape is closed). It holds absolute target roots, so
// it is local state and the default sharing export leaves it out. The reader (tools/consumer/batch-record.mjs) also enforces what
// a schema cannot express, so a record this schema accepts can still be refused when the Workbench opens it:
//   - id derives from (categories, continuation, scopes, inputs, actions, supersedes); each check id derives from (kind, subject), and
//     the checks are exactly the set the batch discloses (one per input, two per scope, one per action);
//   - categories, scopes, inputs, action inputs, action requires and checks are sorted by id and unique, and no two scopes share a root;
//   - action order is the reviewed execution order: every required action appears earlier (so there is no cycle);
//   - action ids are unique, and a superseding batch names a different batch than itself;
//   - every action scope, category and input is declared, and every declared scope, category and input is used;
//   - recordedAt must be a real calendar timestamp.
// Against the envelope's saved policy, when the batch is read: each selection is bound by id and digest, every Core `requires` of a
// selection is covered by an action of the same scope that the action requires, and an action's inputs are exactly the local material
// sources its inline recipe declares.
const batchSlug = { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$' }, batchIdPattern = { type: 'string', pattern: '^batch-[a-f0-9]{32}$' };
const batchAction = shape({ id: batchSlug, scope: batchSlug, category: updateCategory, selection: shape({ id, sha256: hash }),
  inputs: { type: 'array', maxItems: 64, uniqueItems: true, items: batchSlug }, requires: { type: 'array', maxItems: 256, uniqueItems: true, items: batchSlug }, retain: { const: true } }, ['retain']);
const reviewedBatch = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: batchRecord, ...shape({
  id: batchIdPattern, schema: { const: batchRecord }, required: { const: false }, recordedAt: utcTimestamp,
  categories: { type: 'array', minItems: 1, maxItems: 4, uniqueItems: true, items: updateCategory }, continuation: { enum: ['stop', 'continue-independent'] },
  scopes: { type: 'array', minItems: 1, maxItems: 16, items: shape({ id: batchSlug, role: { enum: ['existing', 'added'] }, client: { type: 'string', minLength: 1, maxLength: 128, pattern: String.raw`^[^\x00-\x1f\x7f]+$` },
    target: shape({ kind: { const: 'project' }, root: { type: 'string', minLength: 1, maxLength: 1024, pattern: String.raw`^(?:[A-Za-z]:[\\/]|\\\\|/)[^\x00-\x1f\x7f]*$` } }) }) },
  inputs: { type: 'array', maxItems: 64, items: shape({ id: batchSlug, kind: { const: 'material' }, sha256: hash, byteLength: { type: 'integer', minimum: 0 } }) },
  actions: { type: 'array', minItems: 1, maxItems: 256, items: batchAction },
  checks: { type: 'array', maxItems: 512, items: shape({ id: { type: 'string', pattern: '^check-[a-f0-9]{32}$' }, kind: { enum: ['shared-input', 'unrelated-state', 'conflict', 'core-review'] }, subject: batchSlug }) },
  supersedes: batchIdPattern
}, ['supersedes']) };
const journey = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: journeyEnvelope, ...shape({
  schema: { const: journeyEnvelope },
  id: { type: 'string', pattern: '^journey-[a-f0-9]{32}$' },
  revision: shape({ sequence: { type: 'integer', minimum: 1 }, sha256: hash, previousSha256: hash }, ['previousSha256']),
  executable: { const: false },
  savedIntent: shape({ type: { const: 'urn:aihq:core:execution-policy-bytes' }, mediaType: { const: 'application/json' }, sha256: hash,
    byteLength: { type: 'integer', minimum: 0, maximum: 5242880 }, base64: { type: 'string', maxLength: 6990508, pattern: '^[A-Za-z0-9+/]*={0,2}$' } }),
  records: array({ if: { required: ['schema'], properties: { schema: { const: journeyRecord } } },
    then: shape({ id, schema: { const: journeyRecord }, required: { const: true }, savedIntentSha256: hash, intent: { $ref: saved.$id } }),
    else: { type: 'object', required: ['id', 'schema', 'required'], additionalProperties: true, properties: { id, schema: recordUrn, required: { type: 'boolean' } } },
    allOf: [dispositionRecord, checkRecord, organizationRecord, suggestionRecord, dismissalRecord, workspaceRecord, bindingRecord, batchRecord, trialRecord].map(urn => ({ if: { required: ['schema'], properties: { schema: { const: urn } } }, then: { $ref: urn } })) })
}) };
mkdirSync(new URL('../schemas/', import.meta.url), { recursive: true });
for (const [name, schema] of [['saved-intent-3.0.0', saved], ['review-decisions-1.0.0', review], ['journey-envelope-1.0.0', journey], ['journey-record-maintenance-disposition-1.0.0', disposition], ['journey-record-maintenance-check-1.0.0', check], ['journey-record-organization-draft-1.0.0', organizationDraft], ['journey-record-improvement-suggestion-1.0.0', improvementSuggestion], ['journey-record-improvement-dismissal-1.0.0', improvementDismissal], ['journey-record-workspace-declaration-1.0.0', workspaceDeclaration], ['journey-record-local-binding-1.0.0', localBinding], ['journey-record-reviewed-batch-1.0.0', reviewedBatch], ['journey-record-improvement-trial-1.0.0', improvementTrial]]) {
  const path = new URL(`../schemas/${name}.json`, import.meta.url), expected = JSON.stringify(schema, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8').replaceAll('\r\n', '\n') !== expected) throw new Error(`Schema is stale: ${name}`);
  } else writeFileSync(path, expected);
}
