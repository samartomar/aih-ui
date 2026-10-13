// Portable consumer composition. Catalog validates content/dependencies; Core validates policy.
import { configureItem, listItems, validateSelectionSet } from '@aihq/catalog/reader';
import { parsePolicy } from '@aihq/core/contracts';

export const SAVED_INTENT_SCHEMA = 'urn:aihq:workbench:saved-intent:2.0.0';
export const LIMITS = Object.freeze({ bytes: 850_000, roots: 4096, pins: 4096, origins: 256, releases: 32 });
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
const stable = value => JSON.stringify(value, (_key, member) => object(member)
  ? Object.fromEntries(Object.entries(member).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : member);
const sort = values => [...values].sort();
export const itemKey = ref => `${ref.releaseSha256}/${ref.itemId}`;
const failure = (reason, message, extra = {}) => ({ valid: false, diagnostics: [{ code: 'SAVED_INTENT_INVALID', reason, message, blocking: true, ...extra }] });
const pin = (entry, item) => ({ releaseSha256: entry.release.sha256, itemId: item.id, itemSha256: item.itemSha256,
  recipe: item.recipe, materials: item.materials });
const provenance = entry => ({ releaseSha256: entry.release.sha256, package: entry.release.package,
  sources: entry.release.sources, materialSource: entry.materialSource });
const idFor = (ref, scope) => `${scope}--${ref.releaseSha256}--${ref.itemId}`;

// Entries must contain public readRelease/readInstalledRelease results; reader calls enforce that brand.
export function indexReleases(entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > LIMITS.releases) throw new Error('Expected 1–32 checked releases.');
  const releases = Object.create(null), items = new Map();
  for (const entry of entries) {
    if (releases[entry.release.sha256]) throw new Error('Duplicate release.');
    releases[entry.release.sha256] = entry.release;
    for (const item of listItems(entry.release)) items.set(itemKey({ releaseSha256: entry.release.sha256, itemId: item.id }), { entry, item });
  }
  return { entries, releases, items };
}

function checkIntent(intent, templates) {
  if (!object(intent) || bytes(intent) > LIMITS.bytes) return failure('budget', 'Saved intent exceeds its bounded input budget.');
  if (intent.schema !== SAVED_INTENT_SCHEMA || Object.keys(intent).some(key => !['schema', 'origins', 'roots', 'exclusions', 'pins', 'provenance'].includes(key))) return failure('schema', 'Unsupported saved intent schema or fields.');
  if (!Array.isArray(intent.roots) || intent.roots.length > LIMITS.roots || !Array.isArray(intent.pins) || intent.pins.length > LIMITS.pins
    || !Array.isArray(intent.origins) || intent.origins.length > LIMITS.origins || !Array.isArray(intent.exclusions) || intent.exclusions.length > LIMITS.pins
    || !Array.isArray(intent.provenance) || intent.provenance.length > LIMITS.releases) return failure('budget', 'Saved intent arrays exceed their bounds.');
  const origins = new Set();
  for (const origin of intent.origins) {
    if (!object(origin) || typeof origin.id !== 'string' || !/^[\w.-]{1,100}$/.test(origin.id) || origins.has(origin.id)) return failure('origin', 'Origin IDs must be unique bounded identifiers.');
    origins.add(origin.id);
    if (origin.kind === 'direct') {
      if (Object.keys(origin).some(key => !['id', 'kind'].includes(key))) return failure('origin', 'Unknown direct origin fields.');
    } else if (origin.kind === 'template') {
      if (typeof origin.templateId !== 'string' || !hash(origin.templateSha256) || Object.keys(origin).some(key => !['id', 'kind', 'templateId', 'templateSha256'].includes(key))) return failure('origin', 'Template origins require exact identity.');
      if (!templates.some(template => template.id === origin.templateId && template.sha256 === origin.templateSha256)) return failure('template-unavailable', `Exact template unavailable: ${origin.templateId}`);
    } else return failure('origin', 'Unknown origin kind.');
  }
  const shape = (ref, fields) => object(ref) && hash(ref.releaseSha256) && typeof ref.itemId === 'string' && /^[\w.-]{1,180}$/.test(ref.itemId) && hash(ref.itemSha256)
    && Object.keys(ref).every(key => fields.includes(key));
  const roots = new Set(), exclusions = new Set(), pins = new Set();
  for (const [values, fields, seen, root] of [[intent.roots, ['releaseSha256', 'itemId', 'itemSha256', 'scope', 'configuration', 'originIds'], roots, true],
    [intent.exclusions, ['releaseSha256', 'itemId', 'itemSha256', 'originIds'], exclusions, false]]) {
    for (const ref of values) {
      if (!object(ref)) return failure('shape', 'Malformed choice.');
      const key = `${itemKey(ref)}${root ? `/${ref.scope}` : ''}`;
      if (!shape(ref, fields) || seen.has(key) || !Array.isArray(ref.originIds) || !ref.originIds.length || new Set(ref.originIds).size !== ref.originIds.length || ref.originIds.some(id => !origins.has(id))
        || (root && (!['project', 'user'].includes(ref.scope) || !object(ref.configuration)))) return failure('shape', 'Malformed, duplicate or unattributed choice.');
      seen.add(key);
    }
  }
  for (const ref of intent.pins) {
    if (!shape(ref, ['releaseSha256', 'itemId', 'itemSha256', 'recipe', 'materials']) || pins.has(itemKey(ref)) || !object(ref.recipe) || !Array.isArray(ref.materials)) return failure('pins', 'Malformed or duplicate content pin.');
    pins.add(itemKey(ref));
  }
  return { valid: true };
}

export function freshIntent() {
  return { schema: SAVED_INTENT_SCHEMA, origins: [{ id: 'direct', kind: 'direct' }], roots: [], exclusions: [], pins: [], provenance: [] };
}

// Every operation is a proposal: callers replace their document only after valid:true.
export function composeIntent({ index, intent, mode = 'vibe', templates = [], capture = false }) {
  const checked = checkIntent(intent, templates);
  if (!checked.valid) return checked;
  const reconciliation = [];
  for (const ref of [...intent.roots, ...intent.exclusions, ...intent.pins]) {
    const found = index.items.get(itemKey(ref));
    if (!found || found.item.itemSha256 !== ref.itemSha256 || ('recipe' in ref && stable(pin(found.entry, found.item)) !== stable(ref))) {
      reconciliation.push({ key: itemKey(ref), state: !found ? 'missing' : 'changed', saved: ref, current: found ? pin(found.entry, found.item) : null });
    }
  }
  if (reconciliation.length) return { ...failure('reconciliation', 'Exact saved content is unavailable or changed; retain the original and resolve explicitly.'), reconciliation };
  const selections = new Map(), reasons = Object.create(null), optional = new Map();
  const excluded = new Set(intent.exclusions.map(itemKey));
  const rootsById = new Map(intent.roots.map(root => [idFor(root, root.scope), root]));
  const visiting = new Set();
  let expanded = new Set();
  function resolve(ref, entry) {
    const key = itemKey({ releaseSha256: ref.release?.manifest.sha256 ?? entry.release.sha256, itemId: ref.itemId });
    const found = index.items.get(key);
    if (!found || ('release' in ref && (ref.itemSha256 !== found.item.itemSha256 || ref.release.manifest.byteLength !== found.entry.release.byteLength || stable(ref.release.source) !== stable(found.entry.materialSource)))) throw new Error(`Missing or stale dependency: ${key}`);
    return found;
  }
  function visit(found, requestedScope, root, path) {
    const { entry, item } = found;
    const ref = { releaseSha256: entry.release.sha256, itemId: item.id };
    const key = itemKey(ref);
    if (excluded.has(key)) throw new Error(`Still required by ${root.itemId}: ${key}`);
    const scope = item.scopes.includes(requestedScope) ? requestedScope : item.scopes[0];
    const id = idFor(ref, scope);
    if (visiting.has(id)) throw new Error(`Required cycle: ${[...path, key].join(' -> ')}`);
    const why = { root: itemKey(root), originIds: sort(root.originIds), path: [...path, key] };
    (reasons[id] ??= []).push(why);
    if (expanded.has(id)) return;
    const explicit = rootsById.get(id);
    const configuration = explicit?.configuration ?? {};
    visiting.add(id);
    selections.set(id, { id, scope, ref, configuration, found });
    for (const dependency of item.dependencies.requires) visit(resolve(dependency, entry), scope, root, [...path, key]);
    for (const suggestion of item.dependencies.optional) {
      const target = resolve(suggestion, entry);
      const targetKey = itemKey({ releaseSha256: target.entry.release.sha256, itemId: target.item.id });
      optional.set(`${key}/${targetKey}`, { from: key, item: targetKey, skipped: excluded.has(targetKey) });
    }
    visiting.delete(id);
    expanded.add(id);
  }
  try {
    for (const root of [...intent.roots].sort((a, b) => idFor(a, a.scope).localeCompare(idFor(b, b.scope)))) {
      expanded = new Set();
      const found = index.items.get(itemKey(root));
      if (!found.item.scopes.includes(root.scope)) return failure('scope', `Unsupported scope for ${root.itemId}`);
      visit(found, root.scope, root, []);
    }
  } catch (error) { return failure('dependency', error.message); }
  const values = [...selections.values()].sort((a, b) => a.id.localeCompare(b.id));
  const actualPins = [...new Map(values.map(value => [itemKey(value.ref), pin(value.found.entry, value.found.item)])).values()].sort((a, b) => itemKey(a).localeCompare(itemKey(b)));
  if (!capture && stable(actualPins) !== stable(intent.pins)) return failure('pins', 'Saved closure pins contradict the chosen roots.');
  const validation = validateSelectionSet({ releases: index.releases, selections: values.map(value => ({ id: value.id,
    item: { ...value.ref, itemSha256: value.found.item.itemSha256 }, configuration: value.configuration })) });
  if (!validation.valid) return validation;
  const configured = values.map(value => configureItem({ release: value.found.entry.release, itemId: value.ref.itemId,
    configuration: value.configuration, materialSource: value.found.entry.materialSource }));
  if (configured.some(result => !result.valid)) return { valid: false, diagnostics: configured.flatMap(result => result.diagnostics) };
  const releaseIds = new Set([...actualPins, ...intent.exclusions].map(ref => ref.releaseSha256));
  const actualProvenance = index.entries.filter(entry => releaseIds.has(entry.release.sha256)).map(provenance).sort((a, b) => a.releaseSha256.localeCompare(b.releaseSha256));
  if (!capture && stable(actualProvenance) !== stable(intent.provenance)) return failure('provenance', 'Saved source provenance contradicts checked releases.');
  const saved = { ...structuredClone(intent), pins: actualPins, provenance: actualProvenance };
  const policy = { schema: 'urn:aihq:core:execution-policy:1.3.0', mode,
    selections: values.map((value, i) => ({ id: value.id, managementId: `${value.scope}--${value.found.entry.release.package.name.replace(/^@/, '').replaceAll('/', '.')}--${value.ref.itemId}`, scope: value.scope,
      ...(mode === 'enterprise' ? { organizationSelectionId: `${value.scope}--${value.found.entry.release.package.name.replace(/^@/, '').replaceAll('/', '.')}--${value.ref.itemId}` } : {}),
      configuration: configured[i].selection.configuration, requires: validation.requiresBySelectionId[value.id], recipe: configured[i].selection.recipe })),
    metadata: { 'aih.workbench': saved } };
  // Compact JSON keeps 1,800 exact selections below Core's byte bound where possible.
  const policyText = JSON.stringify(policy) + '\n';
  const measurement = { policyBytes: new TextEncoder().encode(policyText).length, savedIntentBytes: bytes(saved), selectedItemCount: values.length };
  if (bytes(saved) > LIMITS.bytes) return { ...failure('budget', 'Captured closure exceeds the saved-intent byte budget.'), measurement };
  const parsed = parsePolicy(policyText);
  if (!parsed.valid) return { ...parsed, measurement };
  return { valid: true, policy, policyText, intent: saved, reasons, optional: [...optional.values()], diagnostics: validation.diagnostics, measurement };
}

export function reopenIntent({ index, policyText, templates = [] }) {
  const parsed = parsePolicy(policyText);
  if (!parsed.valid) return parsed;
  const intent = parsed.document.metadata?.['aih.workbench'];
  if (!intent || intent.schema !== SAVED_INTENT_SCHEMA) return { valid: true, editable: false, policy: parsed.document, policyText, reason: 'Supported saved intent unavailable.' };
  const composed = composeIntent({ index, intent, mode: parsed.document.mode, templates });
  if (!composed.valid) return { ...composed, editable: false, policy: parsed.document, policyText, intent };
  const fields = selections => selections.map(({ id, managementId, organizationSelectionId, scope, configuration, requires, recipe }) => ({ id, managementId, ...(organizationSelectionId ? { organizationSelectionId } : {}), scope, configuration, requires, recipe }));
  if (stable(fields(composed.policy.selections)) !== stable(fields(parsed.document.selections))) return { ...failure('contradiction', 'Saved intent contradicts execution selections.'), policyText };
  return { ...composed, editable: true, policy: parsed.document, policyText };
}

export function transactIntent({ index, policyText, intent, mode = 'vibe', templates = [], operation }) {
  const original = policyText ? reopenIntent({ index, policyText, templates }) : composeIntent({ index, intent: intent ?? freshIntent(), mode, templates, capture: true });
  if (!original.valid || original.editable === false) return original;
  if (hasAnnotations(original.policy)) return { ...failure('annotations', 'Preserve evidence/authority/lifecycle annotations and resolve them separately before editing.'), originalPolicyText: original.policyText };
  const next = structuredClone(original.intent);
  if (['select', 'skip'].includes(operation.type) && (operation.root ?? operation.ref)?.originIds?.includes('direct') && !next.origins.some(origin => origin.id === 'direct')) next.origins.push({ id: 'direct', kind: 'direct' });
  if (operation.type === 'select') {
    const root = operation.root;
    const existing = next.roots.find(value => itemKey(value) === itemKey(root) && value.scope === root.scope);
    if (existing && stable(existing.configuration) !== stable(root.configuration)) return failure('configuration-collision', 'Two origins request different configuration for the same item and scope.');
    if (existing) existing.originIds = sort(new Set([...existing.originIds, ...root.originIds]));
    else next.roots.push(structuredClone(root));
  } else if (operation.type === 'skip') {
    const existing = next.exclusions.find(value => itemKey(value) === itemKey(operation.ref));
    if (existing) existing.originIds = sort(new Set([...existing.originIds, ...operation.ref.originIds]));
    else next.exclusions.push(structuredClone(operation.ref));
  } else if (operation.type === 'unskip') next.exclusions = next.exclusions.filter(value => itemKey(value) !== operation.key);
  else if (operation.type === 'remove-origin') {
    next.roots = next.roots.map(root => ({ ...root, originIds: root.originIds.filter(id => id !== operation.originId) })).filter(root => root.originIds.length);
    next.exclusions = next.exclusions.map(ref => ({ ...ref, originIds: ref.originIds.filter(id => id !== operation.originId) })).filter(ref => ref.originIds.length);
    next.origins = next.origins.filter(origin => origin.id !== operation.originId);
  } else if (operation.type === 'remove-root' || operation.type === 'remove-item') {
    const affected = new Set(Object.values(original.reasons).flat().filter(reason => reason.path.includes(operation.key)).map(reason => reason.root));
    if (operation.type === 'remove-item' && !operation.removeDependents && [...affected].some(key => key !== operation.key)) return {
      ...failure('removal-impact', 'This item is still required. Cancel, or explicitly remove its dependent roots together.'),
      affectedRoots: sort(affected), originalPolicyText: original.policyText
    };
    next.roots = next.roots.filter(root => operation.type === 'remove-item' ? !affected.has(itemKey(root))
      : !(itemKey(root) === operation.key && root.scope === operation.scope));
    for (const keepKey of operation.keepKeys ?? []) {
      const found = index.items.get(keepKey);
      const savedPin = original.intent.pins.find(ref => itemKey(ref) === keepKey);
      if (!found || !savedPin) return failure('keep', 'Only previously selected exact content can be kept.');
      const selected = original.policy.selections.find(selection => selection.id === idFor(savedPin, selection.scope));
      if (!next.origins.some(origin => origin.id === 'direct')) next.origins.push({ id: 'direct', kind: 'direct' });
      if (!next.roots.some(root => itemKey(root) === keepKey && root.scope === selected.scope)) next.roots.push({
        releaseSha256: savedPin.releaseSha256, itemId: savedPin.itemId, itemSha256: savedPin.itemSha256,
        scope: selected.scope, configuration: selected.configuration, originIds: ['direct']
      });
    }
  }
  else if (operation.type === 'template') {
    const template = templates.find(value => value.id === operation.templateId && value.sha256 === operation.templateSha256);
    if (!template) return failure('template-unavailable', 'Exact template unavailable.');
    const origin = { id: operation.originId, kind: 'template', templateId: template.id, templateSha256: template.sha256 };
    if (next.origins.some(value => value.id === origin.id)) return failure('origin', 'Origin ID already exists.');
    next.origins.push(origin);
    for (const root of template.roots) {
      const existing = next.roots.find(value => itemKey(value) === itemKey(root) && value.scope === root.scope);
      if (existing && stable(existing.configuration) !== stable(root.configuration)) return failure('configuration-collision', 'Template configuration collides with an existing root.');
      if (existing) existing.originIds = sort([...existing.originIds, origin.id]);
      else next.roots.push({ ...structuredClone(root), originIds: [origin.id] });
    }
  } else return failure('operation', 'Unsupported edit.');
  const result = composeIntent({ index, intent: next, mode: original.policy.mode, templates, capture: true });
  if (!result.valid) return { ...result, originalPolicyText: original.policyText };
  result.policy.metadata = { ...original.policy.metadata, 'aih.workbench': result.intent };
  result.policyText = JSON.stringify(result.policy) + '\n';
  const parsed = parsePolicy(result.policyText);
  if (!parsed.valid) return { ...parsed, originalPolicyText: original.policyText };
  const before = new Set(original.policy.selections.map(value => value.id)), after = new Set(result.policy.selections.map(value => value.id));
  return { ...result, originalPolicyText: original.policyText, impact: { added: sort([...after].filter(id => !before.has(id))), removed: sort([...before].filter(id => !after.has(id))), retained: sort([...before].filter(id => after.has(id))) } };
}

const hasAnnotations = policy => Object.keys(policy).some(key => !['schema', 'mode', 'selections', 'metadata'].includes(key))
  || policy.selections.some(selection => Object.keys(selection).some(key => !['id', 'managementId', 'organizationSelectionId', 'scope', 'configuration', 'requires', 'recipe'].includes(key)));

// Changed/missing pins need named decisions; reviewing alone never overwrites the input.
export function reviewIntentUpdate({ previousIndex, index, policyText, replacements, resolutions = {}, templates = [] }) {
  const original = reopenIntent({ index: previousIndex, policyText, templates });
  if (!original.valid || !original.editable) return original;
  if (hasAnnotations(original.policy)) return failure('annotations', 'Preserve evidence/authority annotations and resolve them separately before updating.');
  const changes = [...new Map([...original.intent.pins, ...original.intent.exclusions].map(ref => [itemKey(ref), ref])).values()].map(saved => {
    const target = { releaseSha256: replacements[saved.releaseSha256] ?? saved.releaseSha256, itemId: saved.itemId };
    const found = index.items.get(itemKey(target));
    return { key: itemKey(saved), saved, current: found ? pin(found.entry, found.item) : null,
      state: !found ? 'missing' : saved.itemSha256 === found.item.itemSha256 ? 'unchanged' : 'changed' };
  });
  const unresolved = changes.filter(change => change.state !== 'unchanged' && !['accept', 'remove', 'keep'].includes(resolutions[change.key]));
  if (unresolved.length) return { ...failure('reconciliation', 'Resolve changed/missing pins explicitly before producing an update candidate.'), changes, unresolved, originalPolicyText: policyText };
  const next = structuredClone(original.intent);
  const remap = ref => {
    const change = changes.find(value => value.key === itemKey(ref));
    const decision = resolutions[itemKey(ref)];
    if (decision === 'keep') return ref;
    if (decision === 'remove') return null;
    const found = index.items.get(itemKey({ releaseSha256: replacements[ref.releaseSha256] ?? ref.releaseSha256, itemId: ref.itemId }));
    if (!found) throw new Error(`Cannot accept missing item: ${itemKey(ref)}`);
    if (change?.state === 'missing') throw new Error(`Cannot accept missing item: ${itemKey(ref)}`);
    return { ...ref, releaseSha256: found.entry.release.sha256, itemSha256: found.item.itemSha256 };
  };
  try { next.roots = next.roots.map(remap).filter(Boolean); next.exclusions = next.exclusions.map(remap).filter(Boolean); }
  catch (error) { return { ...failure('reconciliation', error.message), changes, originalPolicyText: policyText }; }
  // Pins are recaptured only in this explicit review operation.
  next.pins = [];
  const keptPins = original.intent.pins.filter(ref => resolutions[itemKey(ref)] === 'keep');
  for (const saved of keptPins) {
    const found = index.items.get(itemKey(saved));
    if (!found || stable(pin(found.entry, found.item)) !== stable(saved)) return {
      ...failure('keep-unavailable', `Cannot keep unavailable exact content: ${itemKey(saved)}`), changes, originalPolicyText: policyText
    };
  }
  let candidate = composeIntent({ index, intent: next, mode: original.policy.mode, templates, capture: true });
  if (!candidate.valid) return { ...candidate, changes, originalPolicyText: policyText };
  const orphans = keptPins.filter(saved => !candidate.intent.pins.some(ref => itemKey(ref) === itemKey(saved)));
  if (orphans.length) {
    if (!next.origins.some(origin => origin.id === 'direct')) next.origins.push({ id: 'direct', kind: 'direct' });
    for (const saved of orphans) {
      // A Keep decision owns the old selection after its parent stops requiring it.
      for (const selection of original.policy.selections.filter(value => value.id === idFor(saved, value.scope))) {
        next.roots.push({ releaseSha256: saved.releaseSha256, itemId: saved.itemId, itemSha256: saved.itemSha256,
          scope: selection.scope, configuration: structuredClone(selection.configuration), originIds: ['direct'] });
      }
    }
    candidate = composeIntent({ index, intent: next, mode: original.policy.mode, templates, capture: true });
    if (!candidate.valid) return { ...candidate, changes, originalPolicyText: policyText };
  }
  for (const change of changes) {
    const decision = resolutions[change.key];
    const targetKey = itemKey({ releaseSha256: replacements[change.saved.releaseSha256] ?? change.saved.releaseSha256, itemId: change.saved.itemId });
    if (decision === 'remove' && candidate.intent.pins.some(ref => itemKey(ref) === targetKey)) return { ...failure('required-removal', `Removed pin remains required: ${change.saved.itemId}`), changes, originalPolicyText: policyText };
    if (decision === 'keep' && targetKey !== change.key && candidate.intent.pins.some(ref => itemKey(ref) === targetKey)) return { ...failure('keep-conflict', `Keeping the old pin conflicts with updated requirements: ${change.saved.itemId}`), changes, originalPolicyText: policyText };
  }
  // New required pins have not previously been reviewed; expose them in the candidate diff.
  const oldTargets = new Set(changes.filter(change => change.current).map(change => itemKey(change.current)));
  for (const current of candidate.intent.pins) if (!oldTargets.has(itemKey(current))) changes.push({ key: itemKey(current), state: 'added', current });
  candidate.policy.metadata = { ...original.policy.metadata, 'aih.workbench': candidate.intent };
  candidate.policyText = JSON.stringify(candidate.policy) + '\n';
  const parsed = parsePolicy(candidate.policyText);
  if (!parsed.valid) return { ...parsed, originalPolicyText: policyText };
  return { ...candidate, changes, originalPolicyText: policyText, requiresAcceptance: true };
}
