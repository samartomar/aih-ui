// Organization baseline authoring: compose, preview and export a Core organization policy from Catalog items.
// The draft is a journey record beside the empty Enterprise starting policy. Everything Core decides (validity,
// admission, advisory and fulfillment results, contradictions) comes from @aihq/core/contracts; this module only
// chooses what to ask it. Nothing here publishes, authenticates, signs or changes the active authority.
import { parseOrganizationPolicy, previewOrganizationObligations } from '@aihq/core/contracts';
import { nativeClientIds } from '@aihq/core/harness';
import { isCheckedRelease, listItems } from '@aihq/catalog/reader';
import { refuse, ok, stable } from './primitives.mjs';
import { composeAuthoring, describeAuthoringSubject, freshAuthoring, managementIdOf } from './headless.mjs';
import { readJourneyEnvelope, writeJourneyEnvelope, projectJourneyEnvelope, isJourneyEnvelope, JOURNEY_RECORD_KINDS } from './journey.mjs';
import { ORGANIZATION_DRAFT_RECORD_SCHEMA, ORGANIZATION_DRAFT_RECORD_ID, ORGANIZATION_OBLIGATIONS, ORGANIZATION_SCOPES,
  organizationDraftProblem, organizationEntryId, organizationTargetId, organizationSourceProblem, organizationPermissionProblem, MAX_ENTRIES, MAX_TARGETS, idPattern, boundedStrings } from './organization-draft-record.mjs';
export const ORGANIZATION_POLICY_SCHEMA = 'urn:aihq:core:organization-policy:1.1.0';
const encode = value => new TextEncoder().encode(value);
const ENTERPRISE_BASE = encode(JSON.stringify({ schema: 'urn:aihq:core:execution-policy:1.3.0', mode: 'enterprise', selections: [], metadata: { 'aih.workbench': freshAuthoring() } }));
const PREVIEW_POLICY_ID = 'organization-baseline-preview';
const keyOf = ({ releaseSha256, itemId }) => `${releaseSha256}/${itemId}`;
const bytesOf = value => Array.isArray(value) && value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255) ? Uint8Array.from(value) : undefined;
const jsonValue = value => { try { return value !== undefined && JSON.stringify(value) !== undefined; } catch { return false; } };

// ---- Catalog access -----------------------------------------------------------
function catalogIndex(inventories) {
  const index = new Map();
  for (const inventory of Array.isArray(inventories) ? inventories : []) {
    if (!inventory || !isCheckedRelease(inventory.release)) continue;
    for (const item of listItems(inventory.release)) index.set(keyOf({ releaseSha256: inventory.release.sha256, itemId: item.id }), { inventory, item });
  }
  return index;
}
const labelOf = (item, fallback) => item?.label ?? fallback;
const found = (index, entry) => {
  const hit = index.get(keyOf(entry.item));
  return hit && hit.item.itemSha256 === entry.item.itemSha256 ? hit : null;
};

// ---- Loading and writing ------------------------------------------------------
const isRecord = record => record.schema === ORGANIZATION_DRAFT_RECORD_SCHEMA;
async function load(envelopeBytes) {
  if (!(envelopeBytes instanceof Uint8Array)) return refuse('INPUT_INVALID', '/envelopeBytes', 'Supply original journey envelope bytes.');
  if (!isJourneyEnvelope(envelopeBytes)) return refuse('INPUT_INVALID', '/envelopeBytes', 'These bytes are not a journey envelope; an organization baseline draft is opened from its saved envelope.', envelopeBytes);
  const read = await readJourneyEnvelope(envelopeBytes);
  if (read.status !== 'ok') return read;
  const record = read.value.records.find(isRecord);
  if (!record) return refuse('ORGANIZATION_DRAFT_MISSING', '/records', 'This envelope has no organization baseline draft.', envelopeBytes);
  return { status: 'ok', value: { read: read.value, record }, diagnostics: read.diagnostics };
}
// The saved intent of an organization draft is the empty Enterprise starting policy, composed exactly as a new Enterprise draft is.
async function startingPolicy(inventories) {
  const composed = await composeAuthoring({ intent: freshAuthoring(), inventories, basePolicyBytes: ENTERPRISE_BASE });
  return composed.status === 'ok' ? composed.value.policyBytes : composed;
}
async function write({ savedIntentBytes, record, previous }) {
  const others = (previous?.records ?? []).filter(other => Object.hasOwn(JOURNEY_RECORD_KINDS, other.schema) && !isRecord(other));
  return writeJourneyEnvelope({ savedIntentBytes, records: [record, ...others], ...(previous ? { previous } : {}) });
}

// ---- The draft as the page sees it -------------------------------------------
const enforcementOf = obligation => obligation === null || obligation === undefined ? null : obligation === 'recommended' ? 'advisory' : 'enforced';
function entryView(entry, index) {
  const hit = found(index, entry);
  const permissions = entry.inputs;
  const inputs = hit
    ? Object.entries(hit.item.inputs ?? {}).map(([name, spec]) => ({ name, description: spec.description ?? '', required: spec.required === true,
      ...(spec.default !== undefined ? { default: structuredClone(spec.default) } : {}), permission: permissions[name] ? structuredClone(permissions[name]) : null }))
    : Object.entries(permissions).map(([name, permission]) => ({ name, description: '', required: false, permission: structuredClone(permission) }));
  return { id: entry.id, item: { ...entry.item }, scope: entry.scope, label: labelOf(hit?.item, entry.item.itemId), kind: hit?.item.kind ?? null, available: !!hit,
    obligation: entry.obligation ?? null, enforcement: enforcementOf(entry.obligation), clients: entry.clients ? [...entry.clients] : null,
    repositories: entry.repositories ? [...entry.repositories] : null, inputs,
    dependencies: hit ? (hit.item.dependencies?.requires ?? []).map(dependency => dependency.itemId) : [], supportedScopes: hit ? [...hit.item.scopes] : [] };
}
// Inputs of a prohibited entry never reach the document, so a missing permission is not an open decision there.
function unresolvedOf(record, views) {
  const unresolved = [];
  if (record.policyId === undefined) unresolved.push({ path: '/policyId', message: 'Choose a policy id for the baseline.' });
  if (record.source === undefined) unresolved.push({ path: '/source', message: 'Choose the GitHub repository, path and ref the baseline will be read from.' });
  for (const [position, view] of views.entries()) {
    const base = `/entries/${position}`, name = `${view.label} (${view.scope})`;
    if (!view.available) unresolved.push({ path: `${base}/item`, entryId: view.id, message: `${view.item.itemId} is not available in the Catalog content this Workbench has loaded. The entry is kept exactly as saved; preview and export wait until that content is supplied again or the entry is removed.` });
    if (view.obligation === null) unresolved.push({ path: `${base}/obligation`, entryId: view.id, message: `Choose an obligation for ${name}.` });
    if (view.available && view.obligation !== 'prohibited') for (const input of view.inputs) if (input.permission === null)
      unresolved.push({ path: `${base}/inputs/${input.name}`, entryId: view.id, message: `Choose what developers may set for the ${input.name} input of ${name}.` });
  }
  return unresolved;
}
function draftOf({ read, record }, index) {
  const views = record.entries.map(entry => entryView(entry, index));
  return { projection: projectJourneyEnvelope(read.envelope), policyId: record.policyId ?? null, source: record.source ? structuredClone(record.source) : null,
    entries: views, targets: record.targets.map(target => ({ ...target })), unresolved: unresolvedOf(record, views) };
}
// Mirrors Core's diagnostic `reason`, which Core carries at the top level of a diagnostic.
const unknownClient = (path, subject) => ({ code: 'INPUT_INVALID', reason: 'unknown-client', path,
  message: `The organization ${subject} names a client that Core does not know.` });
function savedClientDiagnostics(record) {
  return [
    ...record.entries.flatMap((entry, index) => (entry.clients ?? []).flatMap((client, position) => nativeClientIds.includes(client) ? [] : [unknownClient(`/entries/${index}/clients/${position}`, 'entry')])),
    ...record.targets.flatMap((target, index) => target.client === undefined || nativeClientIds.includes(target.client) ? [] : [unknownClient(`/targets/${index}/client`, 'target')])
  ];
}
async function present({ envelopeBytes, loaded, inventories, diagnostics = [] }) {
  return { status: 'ok', diagnostics: [...diagnostics, ...savedClientDiagnostics(loaded.record)], value: { envelopeBytes: envelopeBytes.slice(), draft: draftOf(loaded, catalogIndex(inventories)) } };
}

// ---- Edit operations ----------------------------------------------------------
const closed = (operation, keys, optional = []) => operation && typeof operation === 'object' && !Array.isArray(operation)
  && Object.keys(operation).every(key => key === 'kind' || [...keys, ...optional].includes(key)) && keys.every(key => Object.hasOwn(operation, key));
const bad = (path, message, code = 'INPUT_INVALID') => ({ code, path, message });
const entryOf = (record, id) => record.entries.find(entry => entry.id === id);
// Each editor mutates the cloned record and returns a refusal, or null when the edit applies.
const EDITORS = {
  'set-policy-id'(record, operation) {
    if (!closed(operation, ['policyId'])) return bad('/operation', 'Supply {kind,policyId}.');
    if (operation.policyId === null) { delete record.policyId; return null; }
    if (typeof operation.policyId !== 'string' || !idPattern.test(operation.policyId)) return bad('/operation/policyId', 'A policy id is made of letters, digits, dots, underscores and hyphens.');
    // The id becomes the document's id, so Core decides whether it is one rather than the Workbench restating the rule.
    const core = parseOrganizationPolicy(JSON.stringify({ schema: ORGANIZATION_POLICY_SCHEMA, id: operation.policyId, selections: [] }));
    if (!core.valid) return bad('/operation/policyId', `Core does not accept this policy id (${core.diagnostics[0]?.reason ?? 'invalid'}).`);
    record.policyId = operation.policyId;
    return null;
  },
  'set-source'(record, operation) {
    if (!closed(operation, ['source'])) return bad('/operation', 'Supply {kind,source}.');
    if (operation.source === null) { delete record.source; return null; }
    if (organizationSourceProblem(operation.source) !== null) return bad('/operation/source', 'Supply a GitHub repository (owner and name), a .json path and a branch, tag or 40-character commit made of letters, digits, dots, underscores, hyphens and slashes.');
    const { provider, repository, path, revision } = operation.source;
    record.source = { provider, repository: { owner: repository.owner, name: repository.name }, path, revision: { kind: revision.kind, value: revision.value } };
    return null;
  },
  async 'add-entry'(record, operation, context) {
    if (!closed(operation, ['releaseSha256', 'itemId', 'scope'])) return bad('/operation', 'Supply {kind,releaseSha256,itemId,scope}.');
    if (!ORGANIZATION_SCOPES.includes(operation.scope)) return bad('/operation/scope', `Supply one of: ${ORGANIZATION_SCOPES.join(', ')}.`);
    const hit = context.index.get(keyOf(operation));
    if (!hit) return bad('/operation/itemId', `Exact Catalog item unavailable in the supplied inventories: ${keyOf(operation)}`, 'SOURCE_REVISION_UNAVAILABLE');
    if (record.entries.length >= MAX_ENTRIES) return bad('/operation', `A baseline holds at most ${MAX_ENTRIES} entries.`, 'POLICY_BOUND_EXCEEDED');
    const item = { releaseSha256: operation.releaseSha256, itemId: operation.itemId, itemSha256: hit.item.itemSha256 };
    const id = await organizationEntryId({ ...item, scope: operation.scope });
    if (entryOf(record, id)) return bad('/operation', `${operation.itemId} is already in this baseline for ${operation.scope} scope.`);
    record.entries.push({ id, item, scope: operation.scope, inputs: {} });
    return null;
  },
  'remove-entry'(record, operation) {
    if (!closed(operation, ['entryId'])) return bad('/operation', 'Supply {kind,entryId}.');
    if (!entryOf(record, operation.entryId)) return bad('/operation/entryId', 'No entry has that id.');
    record.entries = record.entries.filter(entry => entry.id !== operation.entryId);
    return null;
  },
  'set-obligation'(record, operation) {
    if (!closed(operation, ['entryId', 'obligation'])) return bad('/operation', 'Supply {kind,entryId,obligation}.');
    const entry = entryOf(record, operation.entryId);
    if (!entry) return bad('/operation/entryId', 'No entry has that id.');
    if (operation.obligation === null) { delete entry.obligation; return null; }
    if (!ORGANIZATION_OBLIGATIONS.includes(operation.obligation)) return bad('/operation/obligation', `Supply one of: ${ORGANIZATION_OBLIGATIONS.join(', ')}.`);
    entry.obligation = operation.obligation;
    return null;
  },
  'set-selectors'(record, operation) {
    if (!closed(operation, ['entryId'], ['clients', 'repositories'])) return bad('/operation', 'Supply {kind,entryId,clients?,repositories?}.');
    const entry = entryOf(record, operation.entryId);
    if (!entry) return bad('/operation/entryId', 'No entry has that id.');
    for (const [field, count, length] of [['clients', 64, 128], ['repositories', 4096, 512]]) {
      const value = operation[field];
      if (value === undefined) continue;
      if (value === null) delete entry[field];
      else if (!boundedStrings(value, count, length)) return bad(`/operation/${field}`, `Supply 1 to ${count} unique values of 1 to ${length} characters, or null to clear.`);
      else {
        if (field === 'clients') {
          const position = value.findIndex(client => !nativeClientIds.includes(client));
          if (position !== -1) return unknownClient(`/operation/clients/${position}`, 'entry');
        }
        entry[field] = [...value];
      }
    }
    return null;
  },
  'set-input'(record, operation, context) {
    if (!closed(operation, ['entryId', 'name', 'permission'])) return bad('/operation', 'Supply {kind,entryId,name,permission}.');
    const entry = entryOf(record, operation.entryId);
    if (!entry) return bad('/operation/entryId', 'No entry has that id.');
    const hit = found(context.index, entry);
    if (operation.permission === null) {
      if (typeof operation.name !== 'string' || !Object.hasOwn(entry.inputs, operation.name)) return bad('/operation/name', 'No permission is set for that input.');
      delete entry.inputs[operation.name];
      return null;
    }
    // Names come from the exact recipe; an entry whose content is unavailable keeps what it has and can only clear it.
    if (!hit) return bad('/operation/entryId', `${entry.item.itemId} is not available in the loaded Catalog content, so its inputs cannot be changed.`, 'SOURCE_REVISION_UNAVAILABLE');
    if (typeof operation.name !== 'string' || !Object.hasOwn(hit.item.inputs ?? {}, operation.name)) return bad('/operation/name', `${entry.item.itemId} declares no input named ${String(operation.name)}.`);
    const permission = operation.permission;
    if (organizationPermissionProblem(permission) !== null) return bad('/operation/permission', 'Supply {fixed}, {choices: [one or more unique values]} or {allowDeclared: true}.');
    const values = Object.hasOwn(permission, 'fixed') ? [permission.fixed] : Object.hasOwn(permission, 'choices') ? permission.choices : [];
    if (!values.every(jsonValue)) return bad('/operation/permission', 'Permission values must be JSON values.');
    entry.inputs[operation.name] = structuredClone(permission);
    return null;
  },
  async 'add-target'(record, operation) {
    if (!closed(operation, ['scope'], ['client', 'repository'])) return bad('/operation', 'Supply {kind,scope,client?,repository?}.');
    if (!ORGANIZATION_SCOPES.includes(operation.scope)) return bad('/operation/scope', `Supply one of: ${ORGANIZATION_SCOPES.join(', ')}.`);
    for (const [field, length] of [['client', 128], ['repository', 512]]) {
      const value = operation[field];
      if (value !== undefined && (typeof value !== 'string' || value.length < 1 || value.length > length)) return bad(`/operation/${field}`, `Supply 1 to ${length} characters.`);
    }
    // Core's nativeClientIds is the list Core checks a target client against; refuse with the reason Core gives.
    if (operation.client !== undefined && !nativeClientIds.includes(operation.client)) return unknownClient('/operation/client', 'target');
    if (record.targets.length >= MAX_TARGETS) return bad('/operation', `A baseline previews at most ${MAX_TARGETS} targets.`, 'POLICY_BOUND_EXCEEDED');
    const target = { scope: operation.scope, ...(operation.client !== undefined ? { client: operation.client } : {}), ...(operation.repository !== undefined ? { repository: operation.repository } : {}) };
    const id = await organizationTargetId(target);
    if (record.targets.some(existing => existing.id === id)) return bad('/operation', 'That target is already declared.');
    record.targets.push({ id, ...target });
    return null;
  },
  'remove-target'(record, operation) {
    if (!closed(operation, ['targetId'])) return bad('/operation', 'Supply {kind,targetId}.');
    if (!record.targets.some(target => target.id === operation.targetId)) return bad('/operation/targetId', 'No target has that id.');
    record.targets = record.targets.filter(target => target.id !== operation.targetId);
    return null;
  }
};
async function edit({ envelopeBytes, operation, inventories }) {
  const loaded = await load(envelopeBytes);
  if (loaded.status !== 'ok') return loaded;
  const { read, record } = loaded.value;
  const unchanged = refusal => ({ ...refusal, originalBytes: envelopeBytes.slice() });
  if (!read.supported) return unchanged(refuse('JOURNEY_RECORD_UNSUPPORTED', '/records', 'The envelope has required records this version cannot change; it is read-only.'));
  const editor = typeof operation?.kind === 'string' && Object.hasOwn(EDITORS, operation.kind) ? EDITORS[operation.kind] : undefined;
  if (!editor) return unchanged(refuse('INPUT_INVALID', '/operation/kind', `Supply one of: ${Object.keys(EDITORS).join(', ')}.`));
  const next = structuredClone(record);
  const problem = await editor(next, operation, { index: catalogIndex(inventories) });
  if (problem) return unchanged({ status: 'refused', diagnostics: [problem] });
  const shape = organizationDraftProblem(next);
  if (shape !== null) return unchanged(refuse('INPUT_INVALID', `/records/0${shape}`, 'The edit would leave the draft outside its closed shape.'));
  const written = await write({ savedIntentBytes: read.savedIntentBytes, record: next, previous: read });
  if (written.status !== 'ok') return unchanged(written);
  const reread = await readJourneyEnvelope(written.value.envelopeBytes);
  if (reread.status !== 'ok') return unchanged(reread);
  return present({ envelopeBytes: written.value.envelopeBytes, loaded: { read: reread.value, record: reread.value.records.find(isRecord) }, inventories });
}

// ---- Composition: the document an organization would publish -------------------
// Configuration for composing an entry comes from its own permissions, never invented: a fixed value, the first
// choice, or the Catalog default for an input the organization lets developers declare.
function exampleConfiguration(item, entry) {
  const configuration = {}, missing = [];
  for (const [name, spec] of Object.entries(item.inputs ?? {})) {
    const permission = entry.inputs[name];
    const value = permission && Object.hasOwn(permission, 'fixed') ? permission.fixed
      : permission && Object.hasOwn(permission, 'choices') ? permission.choices[0] : spec.default;
    if (value !== undefined) configuration[name] = structuredClone(value);
    else if (spec.required === true) missing.push(name);
  }
  return { configuration, missing };
}
async function composeRoots(roots, inventories) {
  const intent = freshAuthoring();
  intent.roots = roots.map(root => ({ releaseSha256: root.releaseSha256, itemId: root.itemId, itemSha256: root.itemSha256, scope: root.scope,
    configuration: structuredClone(root.configuration), originIds: ['direct'] }));
  return composeAuthoring({ intent, inventories, basePolicyBytes: ENTERPRISE_BASE });
}
// The composed selection for one item at one scope: its pin names the recipe, its scope and recipe pick the selection.
function selectionOf(composed, ref) {
  const pin = composed.intent.pins.find(candidate => candidate.releaseSha256 === ref.releaseSha256 && candidate.itemId === ref.itemId);
  return pin ? composed.policy.selections.find(selection => selection.scope === ref.scope && selection.recipe?.reference?.sha256 === pin.recipe.sha256) : undefined;
}
const sameRef = (a, b) => a.releaseSha256 === b.releaseSha256 && a.itemId === b.itemId && a.scope === b.scope;
async function identityOf(index, ref) {
  const hit = index.get(keyOf(ref));
  const described = hit ? await describeAuthoringSubject({ inventory: hit.inventory, itemId: ref.itemId }) : undefined;
  return described?.status === 'ok' ? described.value.recipeIdentity : undefined;
}
const catalogMessage = diagnostics => (diagnostics ?? []).map(diagnostic => diagnostic.message).filter(Boolean).join(' ') || 'Catalog could not compose this item.';

// Decide which entries can be part of a document and what Core-assigned identity each carries.
// A selection id is whatever ordinary Enterprise composition assigns the item at that scope, so a developer who
// composes the same item is admitted by the exported document. Dependencies are approved with their requirer.
async function assemble({ record, index, inventories }) {
  const omitted = [], problems = [], authored = [];
  for (const [position, entry] of record.entries.entries()) {
    const hit = found(index, entry);
    const label = labelOf(hit?.item, entry.item.itemId), base = { entryId: entry.id, itemId: entry.item.itemId, label };
    const omit = (reason, message, path = `/entries/${position}`) => { omitted.push({ ...base, reason, message }); if (reason === 'cannot-compose') problems.push({ path, entryId: entry.id, message }); };
    if (!hit) { omitted.push({ ...base, reason: 'item-unavailable', message: `${entry.item.itemId} is not available.` }); continue; }
    if (entry.obligation === undefined) { omitted.push({ ...base, reason: 'obligation-unset', message: `No obligation is chosen for ${label}.` }); continue; }
    const permissionsUnset = entry.obligation !== 'prohibited' && Object.keys(hit.item.inputs ?? {}).some(name => !entry.inputs[name]);
    if (permissionsUnset) { omitted.push({ ...base, reason: 'input-permission-unset', message: `Not every input of ${label} has a permission.` }); continue; }
    const supported = hit.item.scopes.includes(entry.scope), composeScope = supported ? entry.scope : hit.item.scopes[0];
    if (composeScope === undefined) { omit('cannot-compose', `${label} declares no scope Catalog can compose it at.`); continue; }
    const ref = { ...entry.item, scope: composeScope };
    // A prohibited entry never needs a configuration. Any other entry composes when its own permissions give it an example value.
    const { configuration, missing } = entry.obligation === 'prohibited' ? { configuration: null, missing: [] } : exampleConfiguration(hit.item, entry);
    const composes = entry.obligation !== 'prohibited' && !missing.length;
    let selectionId, recipeIdentity, dependencies = [], organizationId;
    if (composes) {
      const composed = await composeRoots([{ ...ref, configuration }], inventories);
      const selection = composed.status === 'ok' ? selectionOf(composed.value, ref) : undefined;
      recipeIdentity = selection ? await identityOf(index, ref) : undefined;
      if (!selection || !recipeIdentity) { omit('cannot-compose', composed.status === 'ok' ? `Catalog composed no selection for ${label}.` : catalogMessage(composed.diagnostics)); continue; }
      organizationId = selection.organizationSelectionId;
      if (supported) for (const inclusion of composed.value.inclusions) {
        if (!sameRef(inclusion.root, ref) || sameRef(inclusion.item, ref)) continue;
        const dependency = selectionOf(composed.value, inclusion.item), identity = dependency ? await identityOf(index, inclusion.item) : undefined;
        if (!dependency || !identity) { omit('cannot-compose', `Catalog composed no selection for the dependency ${inclusion.item.itemId} of ${label}.`); continue; }
        dependencies.push({ ref: inclusion.item, selectionId: dependency.organizationSelectionId, recipeIdentity: identity, configuration: structuredClone(dependency.configuration) });
      }
    } else {
      // The identity is the recipe's own and the id is the one ordinary composition assigns, so neither needs a runnable configuration.
      recipeIdentity = await identityOf(index, ref);
      if (!recipeIdentity) { omit('cannot-compose', `Exact recipe bytes for ${label} are not available.`); continue; }
      organizationId = managementIdOf({ scope: composeScope, packageName: hit.inventory.release.package.name, itemId: entry.item.itemId });
      if (entry.obligation !== 'prohibited') {
        omitted.push({ ...base, reason: 'needs-declared-value', message: `${label} requires ${missing.join(', ')} but Catalog declares no default and the baseline leaves the value to developers. The example selection leaves it out; Core still reports whether the requirement is fulfilled.` });
        // Dependencies come from Catalog's composition, which needs a value. Without one, the full dependency set cannot be checked
        // through Core (a transitive dependency may be prohibited), so an item with Catalog dependencies stays unresolved.
        if (supported && (hit.item.dependencies?.requires ?? []).length) problems.push({ path: `/entries/${position}/inputs/${missing[0]}`, entryId: entry.id, message: `${label} requires ${missing.join(', ')} and Catalog declares no default, so its dependencies cannot be composed and checked. Set a fixed value or choices so Catalog can compose its dependencies.` });
      }
    }
    // An unsupported scope cannot be composed, so the entry is named by Workbench marker plus the id Catalog assigned at a supported scope.
    selectionId = supported ? organizationId : `unsupported-${entry.scope}--${organizationId}`;
    authored.push({ entry, position, hit, label, supported, selectionId, recipeIdentity, configuration: composes ? configuration : null, dependencies });
  }
  return { authored, omitted, problems };
}
function documentOf({ record, authored, index, policyId }) {
  const selections = [], meta = [], taken = new Set();
  const take = (selectionId, value, detail) => { if (taken.has(selectionId)) return; taken.add(selectionId); selections.push(value); meta.push({ selectionId, ...detail }); };
  const authoredKeys = new Set(authored.map(({ entry }) => `${keyOf(entry.item)}@${entry.scope}`));
  for (const { entry, hit, selectionId, recipeIdentity } of authored) {
    const inputs = entry.obligation === 'prohibited' ? {} : Object.fromEntries(Object.keys(hit.item.inputs ?? {}).filter(name => entry.inputs[name]).map(name => [name, structuredClone(entry.inputs[name])]));
    take(selectionId, { selectionId, recipeIdentity, obligation: entry.obligation, scopes: [entry.scope], ...(entry.clients ? { clients: [...entry.clients] } : {}),
      ...(entry.repositories ? { repositories: [...entry.repositories] } : {}), inputs, ...(entry.obligation === 'prohibited' ? {} : { lifecycle: { replace: true, remove: true } }) },
    { releaseSha256: entry.item.releaseSha256, itemId: entry.item.itemId, itemSha256: entry.item.itemSha256, origin: 'authored', entryId: entry.id });
  }
  // An explicit entry for a dependency always wins; only an unmentioned dependency is approved with its requirer.
  const requiredBy = new Map();
  for (const { entry, dependencies } of authored) for (const dependency of dependencies) {
    if (authoredKeys.has(`${keyOf(dependency.ref)}@${dependency.ref.scope}`)) continue;
    requiredBy.set(dependency.selectionId, [...new Set([...(requiredBy.get(dependency.selectionId) ?? []), entry.item.itemId])]);
    const item = index.get(keyOf(dependency.ref))?.item;
    take(dependency.selectionId, { selectionId: dependency.selectionId, recipeIdentity: dependency.recipeIdentity, obligation: 'permitted', scopes: [dependency.ref.scope],
      inputs: Object.fromEntries(Object.entries(dependency.configuration).map(([name, value]) => [name, { fixed: value }])), lifecycle: { replace: true, remove: true } },
    { releaseSha256: dependency.ref.releaseSha256, itemId: dependency.ref.itemId, itemSha256: item?.itemSha256, origin: 'dependency', entryId: null });
  }
  for (const detail of meta) if (requiredBy.has(detail.selectionId)) detail.requiredBy = requiredBy.get(detail.selectionId);
  return { document: { schema: ORGANIZATION_POLICY_SCHEMA, id: policyId, selections }, meta };
}
function candidateOf({ document, meta, envelope }) {
  const withMetadata = { ...document, metadata: { 'aih.workbench': { journeyId: envelope.id, revisionSha256: envelope.revision.sha256,
    entries: meta.map(({ selectionId, releaseSha256, itemId, itemSha256, origin, requiredBy }) => ({ selectionId, releaseSha256, itemId, itemSha256, origin, ...(requiredBy ? { requiredBy } : {}) })) } } };
  const text = JSON.stringify(withMetadata, null, 2) + '\n';
  const parsed = parseOrganizationPolicy(text);
  return { document: withMetadata, text, bytes: encode(text), valid: parsed.valid === true, diagnostics: parsed.valid ? [] : parsed.diagnostics, parsed };
}
async function build({ loaded, inventories, preview }) {
  const { read, record } = loaded, index = catalogIndex(inventories);
  const draft = draftOf(loaded, index);
  const assembled = await assemble({ record, index, inventories });
  const candidate = candidateOf({ ...documentOf({ record, authored: assembled.authored, index, policyId: record.policyId ?? (preview ? PREVIEW_POLICY_ID : '') }), envelope: read.envelope });
  const unresolved = [...draft.unresolved, ...assembled.problems.filter(problem => !draft.unresolved.some(item => item.path === problem.path))];
  return { draft, index, assembled, candidate, unresolved };
}

// ---- Preview -------------------------------------------------------------------
const OBLIGATION_WORDS = {
  required: 'Required: developers must select it. Core reports whether the requirement is fulfilled.',
  recommended: 'Recommended: guidance only. Core reports whether a developer took it, and nothing blocks them.',
  permitted: 'Permitted: developers may select it, within the input values listed.',
  prohibited: 'Prohibited: developers cannot select it.'
};
async function recipeInputs(index, ref) {
  const hit = index.get(keyOf(ref));
  const bytes = hit?.inventory.materials?.find(material => material.path === hit.item.recipe.path)?.bytes;
  if (!bytes) return undefined;
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).inputs ?? {}; } catch { return undefined; }
}
const withItem = (record, meta, index) => {
  const detail = meta.find(item => item.selectionId === record.selectionId);
  const item = detail ? index.get(keyOf(detail))?.item : undefined;
  return { ...structuredClone(record), itemId: detail?.itemId ?? null, label: item?.label ?? detail?.itemId ?? null };
};
async function previewTarget({ target, built, compose, inheritedContradictions }) {
  const { candidate, assembled, index } = built, { parsed } = candidate;
  const meta = candidate.document.metadata['aih.workbench'].entries;
  const empty = { target: { ...target }, selection: [], advisory: [], fulfillment: [], contradictions: [...inheritedContradictions], unsupported: [], omitted: [] };
  const entryOmissions = assembled.omitted.map(({ entryId, itemId, label, reason }) => ({ entryId, itemId, label, reason }));
  const refused = diagnostics => ({ ...empty, status: 'refused', diagnostics, enforced: { admitted: false, diagnostics: [] }, omitted: entryOmissions });
  if (!parsed.valid) return refused(parsed.diagnostics);
  const organization = parsed.document;
  // What applies here is Core's call: ask it with no selections and read each entry's applicability.
  const applicability = previewOrganizationObligations({ organization, selections: [], lifecycle: [], target });
  if (applicability.status !== 'ok') return refused(applicability.diagnostics);
  const applies = new Map([...applicability.value.fulfillment, ...applicability.value.advisory].map(result => [result.selectionId, result]));
  const omitted = [...entryOmissions], unsupported = [], roots = [];
  for (const authored of assembled.authored) {
    const { entry, label } = authored;
    if (!['required', 'recommended'].includes(entry.obligation) || entry.scope !== target.scope) continue;
    const result = applies.get(authored.selectionId);
    if (!result || result.applicability === 'not-applicable') continue;
    const base = { entryId: entry.id, itemId: entry.item.itemId, label };
    if (result.applicability === 'unknown') { omitted.push({ ...base, reason: 'applicability-unknown' }); continue; }
    if (!authored.supported) {
      const published = authored.hit.item.scopes.join(' and ');
      const kind = entry.obligation === 'required' ? 'Required' : 'Recommended';
      unsupported.push({ ...base, obligation: entry.obligation, reason: 'scope-unsupported', status: result.status,
        message: `${kind} control unavailable: ${label} is ${entry.obligation} for ${entry.scope} scope, but Catalog publishes it only for ${published} scope. A developer in this target cannot select it, so Core reports it ${result.status}. Only the organization can revise this requirement; written guidance is not enforcement.` });
      continue;
    }
    // An entry with no example value is already listed as omitted; Core's fulfillment below still reports it.
    if (authored.configuration === null) continue;
    roots.push({ ...entry.item, scope: entry.scope, configuration: authored.configuration, label });
  }
  const selections = [], composedSelections = [];
  if (roots.length) {
    const composed = await compose(roots);
    if (composed.status !== 'ok') return { ...refused(composed.diagnostics), unsupported, omitted };
    const requirers = new Map();
    for (const inclusion of composed.value.inclusions) {
      const root = roots.find(candidateRoot => sameRef(candidateRoot, inclusion.root));
      if (!root || sameRef(inclusion.item, inclusion.root)) continue;
      const key = `${keyOf(inclusion.item)}@${inclusion.item.scope}`;
      requirers.set(key, [...new Set([...(requirers.get(key) ?? []), root.label])]);
    }
    for (const selection of composed.value.policy.selections) {
      const pin = composed.value.intent.pins.find(candidatePin => candidatePin.recipe.sha256 === selection.recipe?.reference?.sha256
        && composed.value.inclusions.some(inclusion => inclusion.item.releaseSha256 === candidatePin.releaseSha256 && inclusion.item.itemId === candidatePin.itemId && inclusion.item.scope === selection.scope));
      if (!pin) return { ...refused([bad('/selections', `Catalog composed a selection the Workbench could not name: ${selection.id}.`)]), unsupported, omitted };
      const ref = { releaseSha256: pin.releaseSha256, itemId: pin.itemId, scope: selection.scope };
      const identity = await identityOf(index, ref), inputs = await recipeInputs(index, ref);
      if (!identity || !inputs) return { ...refused([bad('/selections', `Exact recipe bytes for ${pin.itemId} are not available.`)]), unsupported, omitted };
      const rootHit = roots.some(root => sameRef(root, ref));
      const hit = index.get(keyOf(ref));
      composedSelections.push({ id: selection.id, organizationSelectionId: selection.organizationSelectionId, scope: selection.scope, recipeIdentity: identity, inputs,
        configuration: structuredClone(selection.configuration), privateInputs: [] });
      selections.push({ id: selection.id, itemId: ref.itemId, label: hit?.item.label ?? ref.itemId, scope: selection.scope, organizationSelectionId: selection.organizationSelectionId,
        configuration: structuredClone(selection.configuration), origin: rootHit ? 'authored' : 'dependency', requiredBy: requirers.get(`${keyOf(ref)}@${ref.scope}`) ?? [] });
    }
  }
  const core = previewOrganizationObligations({ organization, selections: composedSelections, lifecycle: [], target });
  if (core.status !== 'ok') return { ...refused(core.diagnostics), unsupported, omitted, selection: selections };
  const { enforced, advisory, fulfillment } = core.value;
  const contradictions = [...inheritedContradictions];
  for (const diagnostic of enforced.diagnostics) {
    const at = /^\/selections\/(\d+)/.exec(diagnostic.path ?? '');
    const picked = at ? selections[Number(at[1])] : undefined;
    if (diagnostic.reason === 'prohibited' && picked) contradictions.push({ itemId: picked.itemId, label: picked.label, requiredBy: [...picked.requiredBy], reason: 'prohibited',
      message: picked.requiredBy.length ? `${picked.label} is required by ${picked.requiredBy.join(', ')} but the organization prohibits it. Approve it, or change what requires it.`
        : `${picked.label} is selected for this target but the organization prohibits it.` });
  }
  return { target: { ...target }, status: 'ok', diagnostics: [], selection: selections, enforced: { admitted: enforced.admitted, diagnostics: structuredClone(enforced.diagnostics) },
    advisory: advisory.map(record => withItem(record, meta, index)), fulfillment: fulfillment.map(record => withItem(record, meta, index)),
    contradictions, unsupported, omitted };
}
// Each target is previewed independently; a target without an id was not declared by the author.
async function previewTargets({ built, inventories, targets }) {
  const { candidate } = built;
  // A document-level contradiction is Core's finding about the whole document; every target carries it.
  const inherited = candidate.valid ? [] : candidate.diagnostics.filter(diagnostic => diagnostic.reason === 'obligation-contradiction').map(diagnostic => ({
    itemId: null, label: null, requiredBy: [], reason: 'obligation-contradiction', message: diagnostic.message, path: diagnostic.path }));
  // Targets that select the same roots share one Catalog composition.
  const composed = new Map();
  const compose = roots => {
    const key = stable(roots.map(({ label: _label, ...root }) => root));
    if (!composed.has(key)) composed.set(key, composeRoots(roots, inventories));
    return composed.get(key);
  };
  const results = [];
  for (const { id, ...target } of targets) results.push({ ...(await previewTarget({ target, built, compose, inheritedContradictions: inherited })), target: { ...(id ? { id } : {}), ...target } });
  return results;
}
const declaredOf = ({ scope, client, repository }) => ({ scope, ...(client !== undefined ? { client } : {}), ...(repository !== undefined ? { repository } : {}) });
async function preview({ envelopeBytes, inventories }) {
  const loaded = await load(envelopeBytes);
  if (loaded.status !== 'ok') return loaded;
  const { record } = loaded.value;
  const built = await build({ loaded: loaded.value, inventories, preview: true });
  const unavailable = built.draft.unresolved.filter(item => item.path.endsWith('/item'));
  if (unavailable.length) return refuse('ORGANIZATION_DRAFT_UNRESOLVED', '/entries', `Preview waits for Catalog content that is unavailable: ${built.draft.entries.filter(entry => !entry.available).map(entry => entry.item.itemId).join(', ')}.`, envelopeBytes, { unresolved: unavailable });
  const { candidate } = built;
  const targets = await previewTargets({ built, inventories, targets: record.targets.map(target => ({ id: target.id, ...declaredOf(target) })) });
  const status = !candidate.valid ? 'invalid' : built.unresolved.length ? 'incomplete' : 'valid';
  return ok({ candidate: { status, diagnostics: structuredClone(candidate.diagnostics), unresolved: built.unresolved }, targets });
}

// ---- Export --------------------------------------------------------------------
const refName = revision => revision.kind === 'branch' ? `refs/heads/${revision.value}` : revision.kind === 'tag' ? `refs/tags/${revision.value}` : revision.value;
function handoffOf({ record, sequence, fileName, explanationFileName }) {
  const { source, policyId } = record, repository = `${source.repository.owner}/${source.repository.name}`, ref = refName(source.revision);
  const branch = `aih/organization-policy-${policyId}-r${sequence}`, { kind, value } = source.revision;
  const directory = source.path.includes('/') ? source.path.slice(0, source.path.lastIndexOf('/')) : null;
  const switchStep = kind === 'branch' ? `git switch ${value}` : kind === 'tag' ? `git switch --detach refs/tags/${value}` : `git switch --detach ${value}`;
  const gitSteps = [
    `# Run from the folder that holds ${fileName}.`,
    `git clone https://github.com/${repository}.git`, `cd ${source.repository.name}`, switchStep, `git switch -c ${branch}`,
    ...(directory ? [`mkdir -p ${directory}`] : []),
    `cp ../${fileName} ${source.path}`, `git add ${source.path}`,
    `git commit -m "Update organization baseline ${policyId}"`, `git push -u origin ${branch}`].join('\n');
  const fixed = kind === 'branch' ? [] : [`# The configured source reads the fixed ${kind} ${value}, not the default branch.`,
    `# After this is merged, ${kind === 'tag' ? `move the tag ${value} to the merged commit` : 'update AIH_ORGANIZATION_SOURCE to name the merged commit'}; until then developers keep reading the previous document.`];
  const prSteps = [...fixed, `gh pr create --repo ${repository} ${kind === 'branch' ? `--base ${value} ` : ''}--head ${branch} --title "Update organization baseline ${policyId}" --body-file ../${explanationFileName}`].join('\n');
  const location = `${repository}/${source.path}@${ref}`;
  return { source: structuredClone(source), repository, path: source.path, ref, location, gitSteps, prSteps,
    activation: `Exporting does not publish or activate this candidate. Developers are governed by it only after it is merged and is the document read at ${location}; until then Core keeps reading what that location holds today.` };
}
function explanationOf({ record, candidate, built, handoff, sequence }) {
  const { index } = built, lines = [`# Organization baseline ${record.policyId}`, '',
    `Revision ${sequence} of this draft, exported for review. It is a candidate document for \`${handoff.location}\`.`, '', handoff.activation, '', '## Entries', ''];
  const specs = candidate.document.selections;
  for (const [position, selection] of specs.entries()) {
    const detail = candidate.document.metadata['aih.workbench'].entries[position], item = index.get(keyOf(detail))?.item, label = item?.label ?? detail.itemId;
    const enforcement = selection.obligation === 'recommended' ? 'Advisory' : 'Enforced';
    lines.push(`### ${label}`, '', `- Item: \`${detail.itemId}\``, `- ${enforcement}: ${OBLIGATION_WORDS[selection.obligation]}`, `- Scope: ${selection.scopes.join(', ')}`);
    lines.push(`- Clients: ${selection.clients ? selection.clients.join(', ') : 'any'}`, `- Repositories: ${selection.repositories ? selection.repositories.join(', ') : 'any'}`);
    const inputs = Object.entries(selection.inputs);
    lines.push(`- Inputs: ${inputs.length ? inputs.map(([name, permission]) => `${name} ${Object.hasOwn(permission, 'fixed') ? `must be ${JSON.stringify(permission.fixed)}`
      : Object.hasOwn(permission, 'choices') ? `may be one of ${permission.choices.map(value => JSON.stringify(value)).join(', ')}` : 'may be any declared value'}`).join('; ') : 'none'}`);
    if (detail.origin === 'dependency') lines.push(`- Included as a dependency of: ${(detail.requiredBy ?? []).join(', ')}. The organization approves it together with what requires it.`);
    lines.push('');
  }
  if (!specs.length) lines.push('This baseline has no entries.', '');
  lines.push('## Where it is read', '', `- Repository: \`${handoff.repository}\``, `- Path: \`${handoff.path}\``, `- Ref: \`${handoff.ref}\``, '', '## Activation', '', handoff.activation, '');
  return lines.join('\n');
}
// The consistency gate asks Core about every target the selectors can distinguish. At each scope with entries that is the product of
// "undeclared" plus each client some entry names, and "undeclared" plus each repository some entry names; undeclared facts stay
// unknown to Core. Declared targets are previewed anyway, so a combination equal to one is not repeated.
const MAX_IMPLICIT_TARGETS = 1024;
function implicitTargets(record) {
  const declared = new Set(record.targets.map(target => JSON.stringify([target.scope, target.client ?? null, target.repository ?? null])));
  const targets = [];
  let combinations = 0;
  for (const scope of ORGANIZATION_SCOPES) {
    const entries = record.entries.filter(entry => entry.scope === scope);
    if (!entries.length) continue;
    const clients = [undefined, ...new Set(entries.flatMap(entry => entry.clients ?? []))], repositories = [undefined, ...new Set(entries.flatMap(entry => entry.repositories ?? []))];
    combinations += clients.length * repositories.length;
    if (combinations > MAX_IMPLICIT_TARGETS) continue;
    for (const client of clients) for (const repository of repositories)
      if (!declared.has(JSON.stringify([scope, client ?? null, repository ?? null]))) targets.push(declaredOf({ scope, client, repository }));
  }
  return { targets, combinations };
}
const targetWords = ({ scope, client, repository }) => `${scope} scope${client !== undefined ? `, client ${client}` : ''}${repository !== undefined ? `, repository ${repository}` : ''}`;
// One sentence per distinct finding, naming the first few targets it appears for.
function contradictionWords(contradictions) {
  const byMessage = new Map();
  for (const { message, target } of contradictions) byMessage.set(message, [...(byMessage.get(message) ?? []), targetWords(target)]);
  return [...byMessage].map(([message, targets]) => `${message} (${[...new Set(targets)].slice(0, 3).join('; ')}${new Set(targets).size > 3 ? `; and ${new Set(targets).size - 3} more` : ''})`).join(' ');
}
async function exportCandidate({ envelopeBytes, inventories }) {
  const loaded = await load(envelopeBytes);
  if (loaded.status !== 'ok') return loaded;
  const built = await build({ loaded: loaded.value, inventories, preview: false });
  const { record, read } = loaded.value;
  if (built.unresolved.length) return refuse('ORGANIZATION_DRAFT_UNRESOLVED', '/records', `The draft still has ${built.unresolved.length} unresolved ${built.unresolved.length === 1 ? 'item' : 'items'}: ${built.unresolved.map(item => item.path).join(', ')}.`, envelopeBytes, { unresolved: built.unresolved });
  const { candidate } = built;
  if (!candidate.valid) return refuse('ORGANIZATION_CANDIDATE_INVALID', '', 'Core refused the candidate organization policy.', envelopeBytes, { owner: 'core', diagnostics: candidate.diagnostics });
  // Every declared target is previewed, and so is every target the baseline's selectors can tell apart that no declared target covers,
  // so a contradiction cannot be exported just because nobody declared the target that shows it.
  const implicit = implicitTargets(record);
  if (implicit.combinations > MAX_IMPLICIT_TARGETS) return refuse('ORGANIZATION_CONSISTENCY_UNCHECKED', '/entries',
    `The clients and repositories named by this baseline's entries combine into ${implicit.combinations} distinct targets, more than the ${MAX_IMPLICIT_TARGETS} the Workbench can check for contradictions. Narrow the selectors (fewer clients or repositories on fewer entries) so every combination can be checked.`,
    envelopeBytes, { combinations: implicit.combinations, limit: MAX_IMPLICIT_TARGETS });
  const previewed = await previewTargets({ built, inventories, targets: [...record.targets.map(target => ({ id: target.id, ...declaredOf(target) })), ...implicit.targets] });
  const refusedTarget = previewed.find(target => target.status === 'refused');
  if (refusedTarget) return refuse('ORGANIZATION_TARGET_INVALID', '/targets', 'Core refused an organization preview target.', envelopeBytes,
    { owner: 'core', target: refusedTarget.target, diagnostics: refusedTarget.diagnostics });
  const contradictions = previewed.flatMap(target => target.contradictions.map(contradiction => ({ target: target.target, ...contradiction })));
  if (contradictions.length) return refuse('ORGANIZATION_CANDIDATE_CONTRADICTION', '/targets', `The candidate contradicts itself for ${contradictions.length === 1 ? 'a target' : 'targets'} developers can reach: ${contradictionWords(contradictions)}`, envelopeBytes, { contradictions });
  const sequence = read.envelope.revision.sequence, fileName = `${record.policyId}.organization-policy.json`, explanationFileName = `${record.policyId}.explanation.md`;
  const handoff = handoffOf({ record, sequence, fileName, explanationFileName });
  return ok({ fileName, candidateBytes: candidate.bytes, explanationFileName, explanation: explanationOf({ record, candidate, built, handoff, sequence }), handoff });
}

// ---- Entry point -----------------------------------------------------------------
export async function runOrganizationAuthor(operation, body, { inventories } = {}) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const bytes = key => input[key] === undefined ? undefined : bytesOf(input[key]) ?? null;
  const need = (key, value) => value ? undefined : refuse('INPUT_INVALID', `/${key}`, 'Supply original bytes as an array of byte values.');
  if (operation === 'organization-new') {
    const starting = await startingPolicy(inventories);
    if (starting.status === 'refused') return starting;
    const record = { id: ORGANIZATION_DRAFT_RECORD_ID, schema: ORGANIZATION_DRAFT_RECORD_SCHEMA, required: true, entries: [], targets: [] };
    const written = await write({ savedIntentBytes: starting, record });
    if (written.status !== 'ok') return written;
    const read = await readJourneyEnvelope(written.value.envelopeBytes);
    return present({ envelopeBytes: written.value.envelopeBytes, loaded: { read: read.value, record: read.value.records.find(isRecord) }, inventories });
  }
  const key = operation === 'organization-open' ? 'bytes' : 'envelopeBytes', value = bytes(key);
  if (['organization-open', 'organization-edit', 'organization-preview', 'organization-export'].includes(operation)) {
    const missing = need(key, value);
    if (missing) return missing;
  }
  if (operation === 'organization-open') {
    const loaded = await load(value);
    return loaded.status === 'ok' ? present({ envelopeBytes: value, loaded: loaded.value, inventories, diagnostics: loaded.diagnostics }) : loaded;
  }
  if (operation === 'organization-edit') return edit({ envelopeBytes: value, operation: input.operation, inventories });
  if (operation === 'organization-preview') return preview({ envelopeBytes: value, inventories });
  if (operation === 'organization-export') return exportCandidate({ envelopeBytes: value, inventories });
  return refuse('INPUT_INVALID', '/operation', 'Unsupported organization authoring operation.');
}
