// Workspace declaration and local checkout bindings: which repositories belong to one workspace and how they relate
// (portable, in the journey envelope), and which local folder a person deliberately bound to each repository (local
// state, never shared and never execution permission). Pure and bounded: it reads the saved envelope and the
// observations it is handed, never touches a folder, Git or the network, and writes only a new envelope revision.
import { only } from './intake.mjs';
import { refuse, stable } from './headless.mjs';
import { readJourneyEnvelope, writeJourneyEnvelope, projectJourneyEnvelope, JOURNEY_RECORD_KINDS } from './journey.mjs';
import { isUtcTimestamp } from './maintenance-record.mjs';
import { unsafeText, parseIdentity, WORKSPACE_DECLARATION_RECORD_SCHEMA, LOCAL_BINDING_RECORD_SCHEMA, WORKSPACE_DECLARATION_RECORD_ID, RELATIONSHIP_KINDS, BINDING_REASONS, MAX_MEMBERS, MAX_RELATIONSHIPS, MAX_BINDINGS,
  declarationProblem, declarationDerivedProblem, bindingProblem, bindingDerivedProblem, memberProblem, edgeProblem, observationProblem, relationshipId, workspaceId, workspaceRevision,
  bindingId, remoteIdentity, sameIdentity, identityOf, sameRoot, digest } from './workspace-record.mjs';
export const WORKSPACE_DECLARATION_SCHEMA = WORKSPACE_DECLARATION_RECORD_SCHEMA;
export const LOCAL_BINDING_SCHEMA = LOCAL_BINDING_RECORD_SCHEMA;
export { RELATIONSHIP_KINDS, BINDING_REASONS, remoteIdentity, sameIdentity };
const isDeclaration = record => record.schema === WORKSPACE_DECLARATION_RECORD_SCHEMA;
const isBinding = record => record.schema === LOCAL_BINDING_RECORD_SCHEMA;
const family = /^urn:aihq:workbench:journey-record:(?:workspace-declaration|local-binding):/;
const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const OPERATIONS = ['declare', 'set-label', 'set-member', 'remove-member', 'set-relationship', 'remove-relationship', 'suggest-relationship', 'set-relationship-status'];
const MEMBER_FIELDS = ['responsibilities', 'instructions', 'contracts'];
// Pure validators for one record: `{ valid, problem }` where problem is the JSON pointer of the first violation.
export async function validateDeclaration(record) {
  const problem = declarationProblem(record) ?? await declarationDerivedProblem(record);
  return { valid: problem === null, problem };
}
export async function validateBinding(record) {
  const problem = bindingProblem(record) ?? await bindingDerivedProblem(record);
  return { valid: problem === null, problem };
}
// A record of this family with a version this module does not interpret; its bytes are kept and no operation changes it.
const unsupportedIn = records => records.flatMap((record, index) => family.test(record.schema) && !Object.hasOwn(JOURNEY_RECORD_KINDS, record.schema) ? [{ index, id: record.id, schema: record.schema }] : []);
async function load(envelopeBytes) {
  if (!(envelopeBytes instanceof Uint8Array)) return refuse('INPUT_INVALID', '/envelopeBytes', 'Supply original journey envelope bytes.');
  const read = await readJourneyEnvelope(envelopeBytes);
  if (read.status !== 'ok') return read;
  const { records } = read.value;
  return { status: 'ok', value: { read: read.value, declaration: records.find(isDeclaration) ?? null, bindings: records.filter(isBinding), unsupported: unsupportedIn(records) }, diagnostics: read.diagnostics };
}
const blocked = (loaded, envelopeBytes, { binding = true } = {}) => {
  const found = loaded.unsupported.find(entry => binding || !/:local-binding:/.test(entry.schema));
  return found ? refuse('WORKSPACE_VERSION_UNSUPPORTED', `/records/${found.index}`, `Record ${found.id} has workspace schema ${found.schema}, which this version cannot interpret; the envelope is read-only here and its bytes are unchanged.`, envelopeBytes) : null;
};
// ---- Projection ----------------------------------------------------------------------------------------------------
const shownBinding = (binding, detail) => ({ ...structuredClone(binding), ...(detail ?? { status: 'unverified' }) });
function projection({ declaration, bindings, unsupported }, details = {}) {
  const attached = new Set(), members = (declaration?.members ?? []).map(member => {
    const own = bindings.filter(binding => binding.member.id === member.id && binding.workspace.id === declaration.workspace.id);
    own.forEach(binding => attached.add(binding.id));
    return { ...structuredClone(member), bindings: own.map(binding => shownBinding(binding, details[binding.id])) };
  });
  const relationships = declaration ? structuredClone(declaration.relationships) : { status: 'unresolved', confirmed: [], suggested: [] };
  const shown = relationships.status === 'complete' ? 'complete' : 'unresolved';
  const unresolved = declaration ? [...members.flatMap(member => MEMBER_FIELDS.filter(field => member[field].status === 'unresolved').map(field => ({ memberId: member.id, field }))),
    ...(shown === 'unresolved' ? [{ memberId: null, field: 'relationships' }] : [])] : [];
  return { workspace: declaration ? structuredClone(declaration.workspace) : null, revision: declaration?.revision ?? null, members, relationships: { ...relationships, shown }, unresolved,
    // Bindings whose member is no longer declared: kept as local state and shown so they can be removed.
    detached: bindings.filter(binding => !attached.has(binding.id)).map(binding => shownBinding(binding, details[binding.id])),
    bindings: bindings.length, unsupported: unsupported.map(({ id, schema }) => ({ id, schema })) };
}
// Display projection of an envelope object (already validated by the journey reader); every binding is unverified.
export function projectWorkspace(envelope) {
  const records = Array.isArray(envelope?.records) ? envelope.records : [];
  const unsupported = unsupportedIn(records);
  return projection({ declaration: unsupported.some(entry => /:workspace-declaration:/.test(entry.schema)) ? null : records.find(isDeclaration) ?? null,
    bindings: records.filter(isBinding), unsupported });
}
// Bounded read: no folder, Git or network access. A declaration with no relationships is valid and shown unresolved.
export async function readWorkspace({ envelopeBytes } = {}) {
  const loaded = await load(envelopeBytes);
  if (loaded.status !== 'ok') return loaded;
  const { declaration, bindings, unsupported } = loaded.value;
  const hidden = unsupported.some(entry => /:workspace-declaration:/.test(entry.schema));
  return { status: 'ok', diagnostics: loaded.diagnostics, value: projection({ declaration: hidden ? null : declaration, bindings, unsupported }) };
}
async function write(loaded, envelopeBytes, declaration, bindings, previous = loaded.read) {
  const { read } = loaded;
  const records = [...read.records.filter(record => Object.hasOwn(JOURNEY_RECORD_KINDS, record.schema) && !isDeclaration(record) && !isBinding(record)), ...(declaration ? [declaration] : []), ...[...bindings].sort(byId)];
  const written = await writeJourneyEnvelope({ savedIntentBytes: read.savedIntentBytes, records, previous });
  if (written.status !== 'ok') return { ...written, originalBytes: envelopeBytes.slice() };
  const { envelope, envelopeBytes: bytes } = written.value;
  return { status: 'ok', diagnostics: [], value: { envelopeBytes: bytes, envelope, projection: projectJourneyEnvelope(envelope), workspace: projectWorkspace(envelope) } };
}
// ---- Editing the declaration ---------------------------------------------------------------------------------------
const problemOf = (path, message) => ({ problem: [path, message] });
const unjudged = relationships => ({ ...relationships, status: 'unresolved' });
const memberOf = async (body, operation) => {
  if (!only(operation, ['type', 'member'])) return problemOf('/operation', 'Supply {type,member}.');
  const input = operation.member;
  if (!only(input, ['id', 'identity'], ['aliases', 'label', ...MEMBER_FIELDS])) return problemOf('/operation/member', 'Supply {id,identity,aliases?,label?,responsibilities?,instructions?,contracts?}.');
  // A pasted remote URL is reduced to host/owner/name here, so its credentials are dropped before anything is stored.
  const identity = identityOf(input.identity), aliases = input.aliases === undefined ? [] : Array.isArray(input.aliases) ? input.aliases.map(identityOf) : [null];
  if (identity === null) return problemOf('/operation/member/identity', 'Supply the repository as host/owner/name or a remote URL.');
  if (aliases.includes(null)) return problemOf('/operation/member/aliases', 'Supply each alias as host/owner/name or a remote URL.');
  const member = { id: input.id, identity, aliases: aliases.sort(), ...(input.label !== undefined ? { label: input.label } : {}),
    ...Object.fromEntries(MEMBER_FIELDS.map(field => [field, input[field] ?? { status: 'unresolved' }])) };
  const problem = memberProblem(member);
  if (problem !== null) return problemOf(`/operation/member${problem}`, 'Supply a valid workspace member: slug id, repository identity, and no local paths or credentials.');
  if (!body.members.some(existing => existing.id === member.id) && body.members.length >= MAX_MEMBERS) return problemOf('/operation/member', `A workspace has at most ${MAX_MEMBERS} members.`);
  // Adding a member, or changing which repository one is, leaves its relationships unjudged: "complete" no longer holds.
  const previous = body.members.find(existing => existing.id === member.id);
  const moved = !previous || !sameIdentity(previous.identity, member.identity) || previous.aliases.length !== member.aliases.length || previous.aliases.some(alias => !member.aliases.some(other => sameIdentity(alias, other)));
  return { members: [...body.members.filter(existing => existing.id !== member.id), member].sort(byId), ...(moved ? { relationships: unjudged(body.relationships) } : {}) };
};
const edgeOf = async (operation, fields, now, ids) => {
  const input = operation.relationship, shapes = { confirmed: ['from', 'to', 'kind', 'provenance'], suggested: ['from', 'to', 'kind', 'reason'] };
  if (!only(operation, ['type', 'relationship']) || !only(input, shapes[fields])) return problemOf('/operation', `Supply {type,relationship:{${shapes[fields].join(',')}}}.`);
  const edge = { id: await relationshipId(input), from: input.from, to: input.to, kind: input.kind };
  if (fields === 'confirmed') {
    const given = input.provenance;
    if (!only(given, ['kind'], ['ref', 'recordedAt'])) return problemOf('/operation/relationship/provenance', 'Supply provenance {kind,ref?}.');
    edge.provenance = { kind: given.kind, ...(given.ref !== undefined ? { ref: given.ref } : {}), recordedAt: given.recordedAt ?? now };
  } else edge.reason = input.reason;
  const problem = edgeProblem(edge, ids, fields === 'confirmed' ? ['provenance'] : ['reason']);
  return problem === null ? { edge } : problemOf('/operation/relationship','Supply a relationship between two declared members, of a known kind, with no local paths or credentials.');
};
const edit = {
  async 'set-label'(body, operation) {
    if (!only(operation, ['type', 'label']) || typeof operation.label !== 'string') return problemOf('/operation', 'Supply {type,label}.');
    const label = operation.label.trim(), { label: _previous, ...rest } = body.workspace;
    return { workspace: label === '' ? rest : { ...rest, label } };
  },
  'set-member': memberOf,
  async 'remove-member'(body, operation) {
    if (!only(operation, ['type', 'id'])) return problemOf('/operation', 'Supply {type,id}.');
    if (!body.members.some(member => member.id === operation.id)) return problemOf('/operation/id', 'No declared member has that id.');
    const touches = edge => edge.from === operation.id || edge.to === operation.id, { confirmed, suggested } = body.relationships;
    return { members: body.members.filter(member => member.id !== operation.id), relationships: { ...body.relationships, confirmed: confirmed.filter(edge => !touches(edge)), suggested: suggested.filter(edge => !touches(edge)), status: 'unresolved' } };
  },
  async 'set-relationship'(body, operation, now) {
    const built = await edgeOf(operation, 'confirmed', now, new Set(body.members.map(member => member.id)));
    if (built.problem) return built;
    const { confirmed, suggested } = body.relationships, { edge } = built;
    if (!confirmed.some(existing => existing.id === edge.id) && confirmed.length >= MAX_RELATIONSHIPS) return problemOf('/operation/relationship', `A workspace has at most ${MAX_RELATIONSHIPS} confirmed relationships.`);
    // Confirming a relationship settles any suggestion of it.
    return { relationships: { ...body.relationships, confirmed: [...confirmed.filter(existing => existing.id !== edge.id), edge].sort(byId), suggested: suggested.filter(existing => existing.id !== edge.id) } };
  },
  async 'suggest-relationship'(body, operation, now) {
    const built = await edgeOf(operation, 'suggested', now, new Set(body.members.map(member => member.id)));
    if (built.problem) return built;
    const { confirmed, suggested } = body.relationships, { edge } = built;
    if (confirmed.some(existing => existing.id === edge.id)) return problemOf('/operation/relationship', 'That relationship is already confirmed.');
    if (!suggested.some(existing => existing.id === edge.id) && suggested.length >= MAX_RELATIONSHIPS) return problemOf('/operation/relationship', `A workspace has at most ${MAX_RELATIONSHIPS} suggested relationships.`);
    return { relationships: { ...body.relationships, suggested: [...suggested.filter(existing => existing.id !== edge.id), edge].sort(byId) } };
  },
  async 'remove-relationship'(body, operation) {
    if (!only(operation, ['type', 'id'])) return problemOf('/operation', 'Supply {type,id}.');
    const { confirmed, suggested } = body.relationships;
    if (![...confirmed, ...suggested].some(edge => edge.id === operation.id)) return problemOf('/operation/id', 'No relationship has that id.');
    return { relationships: { ...body.relationships, confirmed: confirmed.filter(edge => edge.id !== operation.id), suggested: suggested.filter(edge => edge.id !== operation.id) } };
  },
  // The only way a relationship set becomes "complete": an explicit owner action, never a default.
  async 'set-relationship-status'(body, operation) {
    if (!only(operation, ['type', 'status']) || !['unresolved', 'complete'].includes(operation.status)) return problemOf('/operation/status', 'Supply a status of unresolved or complete.');
    return { relationships: { ...body.relationships, status: operation.status } };
  }
};
// An edit becomes a new envelope revision; the saved intent, the draft and every other record are untouched.
export async function editWorkspace({ envelopeBytes, operation, now } = {}) {
  const loaded = await load(envelopeBytes);
  if (loaded.status !== 'ok') return loaded;
  const fail = (path, message) => refuse('INPUT_INVALID', path, message, envelopeBytes);
  const refused = blocked(loaded.value, envelopeBytes);
  if (refused) return refused;
  const { read, declaration, bindings } = loaded.value;
  if (!isUtcTimestamp(now)) return fail('/now', 'Supply the record time as an ISO UTC timestamp.');
  if (!operation || typeof operation !== 'object' || !OPERATIONS.includes(operation.type)) return fail('/operation/type', `Supply one of: ${OPERATIONS.join(', ')}.`);
  let next;
  if (operation.type === 'declare') {
    if (!only(operation, ['type'], ['label'])) return fail('/operation', 'Supply {type,label?}.');
    if (declaration) return refuse('WORKSPACE_ALREADY_DECLARED', '/operation/type', 'This envelope already declares a workspace.', envelopeBytes);
    const label = typeof operation.label === 'string' && operation.label.trim() !== '' ? operation.label.trim() : undefined;
    if (operation.label !== undefined && typeof operation.label !== 'string') return fail('/operation/label', 'Supply a label of 1 to 120 characters.');
    next = { id: WORKSPACE_DECLARATION_RECORD_ID, schema: WORKSPACE_DECLARATION_RECORD_SCHEMA, required: false,
      workspace: { id: await workspaceId({ label, createdAt: now }), ...(label !== undefined ? { label } : {}) }, members: [], relationships: { status: 'unresolved', confirmed: [], suggested: [] } };
  } else {
    if (!declaration) return refuse('WORKSPACE_NOT_DECLARED', '/records', 'Declare a workspace before changing it.', envelopeBytes);
    const changed = await edit[operation.type](declaration, operation, now);
    if (changed.problem) return fail(...changed.problem);
    next = { ...declaration, ...changed };
  }
  next.revision = await workspaceRevision(next);
  const problem = declarationProblem(next);
  if (problem !== null) return fail('/operation', `The change would make the declaration invalid (${problem || 'shape'}); check local paths, credentials and lengths.`);
  return write(loaded.value, envelopeBytes, next, bindings);
}
// ---- Deliberate binding --------------------------------------------------------------------------------------------
const observationDigest = async ({ observedAt: _observedAt, ...rest }) => digest(rest);
const editDistance = (a, b) => {
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
};
// Names that differ only in case or `-_.`, or by at most two edits when both are at least five characters.
const similarName = (a, b) => {
  const x = a.toLowerCase(), y = b.toLowerCase(), squash = value => value.replace(/[-_.]/g, '');
  return x !== y && (squash(x) === squash(y) || (Math.min(x.length, y.length) >= 5 && editDistance(x, y) <= 2));
};
// How a found identity relates to a declared one, when it is not the same: a fork keeps the name under another owner (or
// host); a similar name keeps host and owner. Never an automatic match.
const relation = (found, declared) => {
  const a = parseIdentity(found), b = parseIdentity(declared);
  if (a.name.toLowerCase() === b.name.toLowerCase()) return 'fork';
  return a.host.toLowerCase() === b.host.toLowerCase() && a.owner.toLowerCase() === b.owner.toLowerCase() && similarName(a.name, b.name) ? 'similar-name' : null;
};
// What a checkout's remotes say about a member: the distinct resolved identities, which one matches the member exactly, and whether
// that is ambiguous (several identities, a remote that resolves to none next to a resolved one, or an identity another member declares).
function survey(declaration, member, remotes) {
  const declared = [member.identity, ...member.aliases], others = declaration.members.filter(entry => entry.id !== member.id), found = [];
  const owned = identity => others.some(other => [other.identity, ...other.aliases].some(value => sameIdentity(value, identity)));
  for (const remote of remotes) if (remote.identity !== null && !found.some(identity => sameIdentity(identity, remote.identity))) found.push(remote.identity);
  const exact = found.find(identity => declared.some(value => sameIdentity(value, identity)));
  return { declared, found, exact, owned, ambiguous: found.length > 0 && (found.length > 1 || remotes.some(remote => remote.identity === null) || (exact !== undefined && owned(exact))) };
}
function evaluate({ declaration, bindings, memberId, observation, replaces }) {
  const refused = (code, message) => ({ outcome: 'refused', reasons: [], repository: null, refusal: { code, message } });
  const member = declaration.members.find(entry => entry.id === memberId);
  if (!member) return refused('WORKSPACE_MEMBER_UNKNOWN', 'No declared member has that id.');
  const replaced = replaces === undefined ? null : bindings.find(binding => binding.id === replaces && binding.member.id === memberId);
  if (replaces !== undefined && !replaced) return refused('WORKSPACE_BINDING_UNKNOWN', 'The binding to replace is not one of this member\'s bindings.');
  if (bindings.some(binding => binding.member.id !== memberId && sameRoot(binding.checkout.root, observation.root)))
    return refused('CHECKOUT_BOUND_TO_OTHER_MEMBER', 'This checkout folder is already bound to another member; remove that binding first.');
  const { declared, found, exact, owned, ambiguous } = survey(declaration, member, observation.remotes), reasons = new Set();
  let repository = null;
  if (found.length === 0) reasons.add('no-remote');
  else if (exact !== undefined) repository = exact;
  else {
    if (found.some(owned)) return refused('WORKSPACE_REPOSITORY_MISMATCH', 'This checkout\'s repository is another declared member\'s repository.');
    const related = found.flatMap(identity => { const kinds = declared.map(value => relation(identity, value)).filter(Boolean); return kinds.length ? [{ identity, kind: kinds.includes('fork') ? 'fork' : 'similar-name' }] : []; });
    if (related.length === 0) return refused('WORKSPACE_REPOSITORY_MISMATCH', 'This checkout\'s repository is neither the declared repository nor one of its confirmed aliases.');
    repository = related[0].identity;
    for (const { kind } of related) reasons.add(kind);
  }
  if (ambiguous) reasons.add('ambiguous-remote');
  if (replaced && !sameRoot(replaced.checkout.root, observation.root)) reasons.add('moved');
  // A second checkout of a member that is already bound is deliberate; a moved one says so with `replaces`.
  else if (replaces === undefined && bindings.some(binding => binding.member.id === memberId && !sameRoot(binding.checkout.root, observation.root))
    && !bindings.some(binding => binding.member.id === memberId && sameRoot(binding.checkout.root, observation.root))) reasons.add('additional-checkout');
  return { outcome: reasons.size ? 'confirm' : 'ready', reasons: [...reasons].sort(), repository, member, replaced };
}
const bindingInput = async ({ envelopeBytes, memberId, observation, replaces }) => {
  const loaded = await load(envelopeBytes);
  if (loaded.status !== 'ok') return { loaded };
  const fail = (path, message) => ({ loaded: refuse('INPUT_INVALID', path, message, envelopeBytes) });
  const refused = blocked(loaded.value, envelopeBytes);
  if (refused) return { loaded: refused };
  if (!loaded.value.declaration) return { loaded: refuse('WORKSPACE_NOT_DECLARED', '/records', 'Declare a workspace before binding a checkout.', envelopeBytes) };
  if (typeof memberId !== 'string') return fail('/memberId', 'Supply the member id.');
  if (observationProblem(observation) !== null) return fail('/observation', 'Supply a checkout observation from the host.');
  if (replaces !== undefined && typeof replaces !== 'string') return fail('/replaces', 'Supply the id of the binding to replace.');
  const { declaration, bindings } = loaded.value;
  return { loaded, plan: evaluate({ declaration, bindings, memberId, observation, replaces }), observationSha256: await observationDigest(observation) };
};
// Pure and read-only: what binding this observation would mean. `confirm` lists every reason a person must accept first.
export async function planBinding({ envelopeBytes, memberId, observation, replaces } = {}) {
  const { loaded, plan, observationSha256 } = await bindingInput({ envelopeBytes, memberId, observation, replaces });
  if (!plan) return loaded;
  const { outcome, reasons, refusal, repository } = plan;
  return { status: 'ok', diagnostics: [], value: { outcome, reasons, observationSha256, observed: { ...structuredClone(observation), repository }, ...(refusal ? { refusal } : {}) } };
}
// Records the binding from a fresh observation. A new or ambiguous identity needs the person's confirmation of exactly
// these observed facts; a confirmation made for a different observation is stale and never reused.
export async function bindCheckout({ envelopeBytes, memberId, observation, replaces, confirmation, now } = {}) {
  const { loaded, plan, observationSha256 } = await bindingInput({ envelopeBytes, memberId, observation, replaces });
  if (!plan) return loaded;
  const fail = (path, message) => refuse('INPUT_INVALID', path, message, envelopeBytes);
  if (!isUtcTimestamp(now)) return fail('/now', 'Supply the verification time as an ISO UTC timestamp.');
  if (plan.outcome === 'refused') return refuse(plan.refusal.code, '/memberId', plan.refusal.message, envelopeBytes);
  if (plan.outcome === 'confirm') {
    const required = message => refuse('WORKSPACE_CONFIRMATION_REQUIRED', '/confirmation', message, envelopeBytes);
    if (!only(confirmation, ['observationSha256', 'reasons']) || !Array.isArray(confirmation.reasons)) return required(`Confirm the observed checkout (${plan.reasons.join(', ')}) before binding it.`);
    if (confirmation.observationSha256 !== observationSha256) return refuse('WORKSPACE_CONFIRMATION_STALE', '/confirmation/observationSha256', 'The checkout changed since it was inspected; inspect it again and confirm what you see now.', envelopeBytes);
    if (stable([...confirmation.reasons].sort()) !== stable(plan.reasons)) return required(`Confirm exactly what was found: ${plan.reasons.join(', ')}.`);
  }
  const { declaration, bindings } = loaded.value, { member, replaced } = plan;
  const record = { id: await bindingId({ workspaceId: declaration.workspace.id, memberId, root: observation.root }), schema: LOCAL_BINDING_RECORD_SCHEMA, required: false,
    workspace: { id: declaration.workspace.id, revision: declaration.revision }, member: { id: memberId, identity: member.identity }, checkout: { root: observation.root },
    observed: { repository: plan.repository, remotes: structuredClone(observation.remotes), revision: observation.revision, ...(observation.branch !== undefined ? { branch: observation.branch } : {}),
      worktree: structuredClone(observation.worktree), workingState: structuredClone(observation.workingState) },
    verification: { result: plan.outcome === 'confirm' ? 'confirmed' : 'matched', reasons: plan.reasons, verifiedAt: now } };
  if (replaced && replaced.id !== record.id) record.replaces = replaced.id;
  const refreshed = binding => binding.id === record.id || binding.id === replaced?.id || (binding.member.id === memberId && sameRoot(binding.checkout.root, observation.root));
  if (bindings.filter(binding => !refreshed(binding)).length >= MAX_BINDINGS) return fail('/memberId', `At most ${MAX_BINDINGS} checkouts can be bound.`);
  const written = await write(loaded.value, envelopeBytes, declaration, [...bindings.filter(binding => !refreshed(binding)), record]);
  return written.status === 'ok' ? { ...written, value: { ...written.value, binding: structuredClone(record) } } : written;
}
export async function unbindCheckout({ envelopeBytes, bindingId: id, now } = {}) {
  const loaded = await load(envelopeBytes);
  if (loaded.status !== 'ok') return loaded;
  const fail = (path, message) => refuse('INPUT_INVALID', path, message, envelopeBytes);
  const refused = blocked(loaded.value, envelopeBytes);
  if (refused) return refused;
  if (!isUtcTimestamp(now)) return fail('/now', 'Supply the record time as an ISO UTC timestamp.');
  const { declaration, bindings } = loaded.value, removed = bindings.find(binding => binding.id === id);
  if (!removed) return fail('/bindingId', 'No recorded binding has that id.');
  const written = await write(loaded.value, envelopeBytes, declaration, bindings.filter(binding => binding !== removed));
  return written.status === 'ok' ? { ...written, value: { ...written.value, binding: structuredClone(removed) } } : written;
}
// ---- Verification --------------------------------------------------------------------------------------------------
const identities = observation => observation.remotes.flatMap(remote => remote.identity === null ? [] : [remote.identity]);
function statusOf(binding, declaration, observation) {
  const member = declaration?.members.find(entry => entry.id === binding.member.id && binding.workspace.id === declaration.workspace.id);
  const { repository } = binding.observed;
  if (!member || !sameIdentity(member.identity, binding.member.identity)
    || (binding.verification.reasons.every(reason => reason === 'additional-checkout' || reason === 'moved') && ![member.identity, ...member.aliases].some(value => sameIdentity(value, repository)))) return { status: 'declaration-changed' };
  if (observation === undefined) return { status: 'unverified' };
  if (observation.status === 'refused') return { status: 'missing', code: observation.diagnostics?.[0]?.code ?? 'CHECKOUT_UNAVAILABLE' };
  const now = identities(observation);
  const same = repository === null ? now.length === 0 : now.some(identity => sameIdentity(identity, repository));
  // The recorded remotes must still be the observed ones (by name and identity), and no ambiguity may be new since the person confirmed.
  const remotes = observation.remotes.length === binding.observed.remotes.length && observation.remotes.every((remote, index) => {
    const recorded = binding.observed.remotes[index];
    return remote.name === recorded.name && (remote.identity === null || recorded.identity === null ? remote.identity === recorded.identity : sameIdentity(remote.identity, recorded.identity));
  });
  const blurred = survey(declaration, member, observation.remotes).ambiguous && !binding.verification.reasons.includes('ambiguous-remote');
  if (!same || !remotes || blurred || !sameRoot(observation.root, binding.checkout.root) || observation.worktree.gitDirSha256 !== binding.observed.worktree.gitDirSha256 || observation.worktree.kind !== binding.observed.worktree.kind)
    return { status: 'identity-changed', recorded: { repository, root: binding.checkout.root }, observed: { repository: now[0] ?? null, root: observation.root } };
  const changes = [...(observation.revision !== binding.observed.revision ? [{ field: 'revision', recorded: binding.observed.revision, observed: observation.revision }] : []),
    ...(observation.workingState.sha256 !== binding.observed.workingState.sha256 ? [{ field: 'workingState', recorded: structuredClone(binding.observed.workingState), observed: structuredClone(observation.workingState) }] : [])];
  return changes.length ? { status: 'changed', changes } : { status: 'current' };
}
// Read-only: compares each recorded binding with the observation the host just made of its folder. `observations` maps
// a binding id to an observation or to the host's refusal; a binding with none is unverified, never assumed current.
export async function verifyBindings({ envelopeBytes, observations = {} } = {}) {
  const loaded = await load(envelopeBytes);
  if (loaded.status !== 'ok') return loaded;
  const fail = (path, message) => refuse('INPUT_INVALID', path, message, envelopeBytes);
  const refused = blocked(loaded.value, envelopeBytes);
  if (refused) return refused;
  if (!observations || typeof observations !== 'object' || Array.isArray(observations)) return fail('/observations', 'Supply observations keyed by binding id.');
  const { declaration, bindings } = loaded.value, statuses = {};
  for (const binding of bindings) {
    const observation = Object.hasOwn(observations, binding.id) ? observations[binding.id] : undefined;
    if (observation !== undefined && observation?.status !== 'refused' && observationProblem(observation) !== null) return fail(`/observations/${binding.id}`, 'Supply a checkout observation or the host refusal.');
    statuses[binding.id] = statusOf(binding, declaration, observation);
  }
  return { status: 'ok', diagnostics: [], value: { statuses, projection: projection({ ...loaded.value }, statuses) } };
}
// ---- Default sharing export ----------------------------------------------------------------------------------------
// The kinds of record this build knows to be portable: everything the sharing export may carry. Any other kind of record, known or not, stays local.
const PORTABLE_KINDS = ['unresolved-draft', 'maintenance-disposition', 'maintenance-check', 'improvement-suggestion', 'improvement-dismissal', 'organization-draft', 'workspace-declaration'];
const isPortable = record => Object.hasOwn(JOURNEY_RECORD_KINDS, record.schema) && PORTABLE_KINDS.includes(JOURNEY_RECORD_KINDS[record.schema].kind);
const isLocal = record => record.schema.startsWith('urn:aihq:workbench:journey-record:local-binding:');
// A reviewed batch (of any version) holds absolute target roots, so it is local state like a binding and never part of the default export.
const isBatch = record => record.schema.startsWith('urn:aihq:workbench:journey-record:reviewed-batch:');
const note = (found, pointer) => { if (found.length < 20 && !found.includes(pointer)) found.push(pointer); };
// JSON pointers (at most 20) of the strings and keys in `value` that hold a local path or a credential; the values are never reported, and an
// unsafe key is reported as `~unsafe-key` instead of itself.
function unsafePointers(value, pointer, found, depth = 0) {
  if (found.length >= 20) return;
  if (depth > 64) note(found, pointer);
  else if (typeof value === 'string') { if (unsafeText(value)) note(found, pointer); }
  else if (Array.isArray(value)) value.forEach((item, index) => unsafePointers(item, `${pointer}/${index}`, found, depth + 1));
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    const hidden = unsafeText(key);
    if (hidden) note(found, `${pointer}/~unsafe-key`);
    unsafePointers(item, hidden ? `${pointer}/~unsafe-key` : `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`, found, depth + 1);
  }
}
// The default sharing export is a defined portable artifact: a new revision with only the records of kinds this build knows to be
// portable. Every local binding (of any version) is left out, since bindings hold absolute local paths, and so is every optional record
// of an unknown kind, since nothing says what it carries. An unknown required record cannot be left out, so it refuses the export. A
// declaration of a version this module cannot read refuses too. Everything that remains, with the decoded saved intent, must pass the
// same text guard (values and keys) as the declaration or nothing is exported; the original bytes stay and only JSON pointers are reported.
export async function exportWorkspace({ envelopeBytes } = {}) {
  const loaded = await load(envelopeBytes);
  if (loaded.status !== 'ok') return loaded;
  const refused = blocked(loaded.value, envelopeBytes, { binding: false });
  if (refused) return refused;
  const { read, declaration } = loaded.value, records = read.envelope.records;
  const required = records.findIndex(record => record.required && !isPortable(record) && !isLocal(record));
  if (required >= 0) return refuse('WORKSPACE_EXPORT_UNSAFE', `/records/${required}`, `Sharing is refused: the required record at /records/${required} has a schema (${records[required].schema}) that this version cannot establish as portable, and it cannot be left out. This file is unchanged.`, envelopeBytes);
  const excluded = { bindings: records.filter(isLocal).length, batches: records.filter(isBatch).length, unknownRecords: records.filter(record => !isLocal(record) && !isBatch(record) && !Object.hasOwn(JOURNEY_RECORD_KINDS, record.schema)).length };
  const portable = records.filter(isPortable), previous = { ...read, supported: true, records: portable, envelope: { ...read.envelope, records: portable } };
  const written = await write({ ...loaded.value, read: previous }, envelopeBytes, declaration, [], previous);
  if (written.status !== 'ok') return written;
  const found = [];
  unsafePointers(written.value.envelope.records, '/records', found);
  let intent;
  try { intent = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(read.savedIntentBytes)); } catch { note(found, '/savedIntent'); }
  if (intent !== undefined) unsafePointers(intent, '/savedIntent', found);
  if (found.length > 0) return refuse('WORKSPACE_EXPORT_UNSAFE', found[0], `Sharing is refused: ${found.length >= 20 ? 'at least 20' : found.length} values look like local paths or credentials (at ${found.join(', ')}). Remove them and export again; this file is unchanged.`, envelopeBytes);
  return { ...written, value: { ...written.value, excluded } };
}
