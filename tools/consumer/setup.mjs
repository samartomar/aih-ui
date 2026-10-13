// Consumer-owned authoring intent; Catalog and Core retain validity authority.
import { authorPolicy, exportPolicy, requiredItems, reopenPolicy } from './authoring.mjs';
import { listItems } from '@aihq/catalog/reader';
export const INTENT_SCHEMA = 'urn:aihq:workbench:setup-intent:1.0.0';
const fail = message => ({ valid: false, diagnostics: [{ code: 'INTENT_CONFLICT', message, blocking: true }] });
// Core selection identifiers allow letters, digits, dots, underscores and hyphens.
const selectionId = (scope, itemId) => `${scope}--${itemId}`;

export function composeSetup({ release, materialSource, roots, excludedItemIds = [], mode = 'vibe' }) {
  if (!Array.isArray(roots) || !Array.isArray(excludedItemIds)) return fail('Roots and exclusions must be arrays.');
  if (excludedItemIds.some(id => typeof id !== 'string') || new Set(excludedItemIds).size !== excludedItemIds.length) return fail('Exclusions must be unique item IDs.');
  for (const root of roots) {
    if (!root || typeof root !== 'object' || Array.isArray(root) || typeof root.itemId !== 'string' || typeof root.scope !== 'string'
      || !root.configuration || typeof root.configuration !== 'object' || Array.isArray(root.configuration)
      || Object.keys(root).some(key => !['itemId', 'scope', 'configuration'].includes(key))) return fail('Each root must contain only itemId, scope and configuration.');
  }
  const items = new Map(listItems(release).map(item => [item.id, item]));
  const selections = new Map();
  const reasons = {};
  for (const excluded of excludedItemIds) if (!items.has(excluded)) return fail(`Excluded item is absent: ${excluded}`);
  const add = (itemId, root, reason) => {
    const item = items.get(itemId);
    if (!item) throw new Error(`Item is absent: ${itemId}`);
    if (itemId === root.itemId && !item.scopes.includes(root.scope)) throw new Error(`Scope ${root.scope} is not declared for ${itemId}`);
    if (excludedItemIds.includes(itemId)) throw new Error(`Excluded item is required by ${root.itemId}: ${itemId}`);
    const scope = itemId === root.itemId ? root.scope : item.scopes.includes(root.scope) ? root.scope : item.scopes[0];
    const id = selectionId(scope, itemId);
    if (!selections.has(id) || reason === 'explicit') selections.set(id, { id, managementId: id, scope, itemId,
      configuration: itemId === root.itemId ? root.configuration : {} });
    (reasons[id] ??= []).push(reason);
  };
  const rootKeys = new Set();
  try {
    for (const root of roots) {
      const key = selectionId(root.scope, root.itemId);
      if (rootKeys.has(key)) return fail(`Duplicate root: ${key}`);
      rootKeys.add(key);
      const closure = requiredItems(release, root.itemId);
      if (!closure.valid) return closure;
      for (const itemId of closure.itemIds) add(itemId, root, itemId === root.itemId ? 'explicit' : `required by ${root.itemId}`);
    }
  } catch (error) { return fail(error.message); }
  const result = authorPolicy({ release, materialSource, mode, selections: [...selections.values()] });
  if (!result.valid) return result;
  result.policy.schema = 'urn:aihq:core:execution-policy:1.3.0';
  result.policy.metadata = { 'aih.workbench': { schema: INTENT_SCHEMA,
    source: { releaseSha256: release.sha256 }, roots, excludedItemIds } };
  const parsed = reopenPolicy(exportPolicy(result.policy));
  if (!parsed.valid) return parsed;
  return { ...result, reasons, policyText: exportPolicy(result.policy) };
}

const normalized = value => JSON.stringify(value, (_key, member) => member && !Array.isArray(member) && typeof member === 'object'
  ? Object.fromEntries(Object.entries(member).sort(([a], [b]) => a.localeCompare(b))) : member);
const hasAdditionalExecutionAnnotations = policy => Object.keys(policy).some(key => !['schema', 'mode', 'selections', 'metadata'].includes(key))
  || policy.selections.some(selection => Object.keys(selection).some(key => !['id', 'managementId', 'scope', 'configuration', 'requires', 'recipe'].includes(key)));

export function editSetup({ basePolicyText, ...choices }) {
  const original = basePolicyText ? reopenPolicy(basePolicyText) : null;
  if (original && !original.valid) return original;
  if (original && hasAdditionalExecutionAnnotations(original.document)) return fail('Preserve the original policy: evidence, organization or lifecycle annotations require explicit resolution before reauthoring.');
  const candidate = composeSetup(choices);
  if (candidate.valid && original?.document.metadata) {
    candidate.policy.metadata = { ...original.document.metadata, 'aih.workbench': candidate.policy.metadata['aih.workbench'] };
    candidate.policyText = exportPolicy(candidate.policy);
  }
  return candidate;
}

export function reopenSetup({ release, materialSource, policyText }) {
  const parsed = reopenPolicy(policyText);
  if (!parsed.valid) return parsed;
  const intent = parsed.document.metadata?.['aih.workbench'];
  if (!intent) return { ...parsed, editable: false, reason: 'Authoring intent unavailable; execution policy remains consumable.' };
  if (intent.schema !== INTENT_SCHEMA || intent.source?.releaseSha256 !== release.sha256) {
    return { ...parsed, editable: false, reason: 'Authoring schema or exact source release unavailable.' };
  }
  if (!intent.source || Object.keys(intent.source).some(key => key !== 'releaseSha256')
    || Object.keys(intent).some(key => !['schema', 'source', 'roots', 'excludedItemIds'].includes(key))) return fail('Authoring intent contains unsupported fields.');
  const recomposed = composeSetup({ release, materialSource, ...intent, mode: parsed.document.mode });
  if (!recomposed.valid) return recomposed;
  const authoringFields = selections => selections.map(({ id, managementId, scope, configuration, requires, recipe }) => ({ id, managementId, scope, configuration, requires, recipe }));
  if (normalized(authoringFields(recomposed.policy.selections)) !== normalized(authoringFields(parsed.document.selections))) return fail('Saved authoring intent contradicts execution selections.');
  return { ...recomposed, policy: parsed.document, policyText, editable: true, intent };
}

export function reviewSetupUpdate({ previousRelease, release, materialSource, policyText }) {
  const original = reopenSetup({ release: previousRelease, materialSource, policyText });
  if (!original.valid || !original.editable) return { ...original, valid: false };
  if (hasAdditionalExecutionAnnotations(original.policy)) {
    return fail('This policy has evidence, organization or lifecycle annotations. Preserve it and resolve those explicitly before a source update.');
  }
  const candidate = composeSetup({ release, materialSource, ...original.intent, mode: original.policy.mode });
  if (!candidate.valid) return candidate;
  candidate.policy.metadata = { ...original.policy.metadata, 'aih.workbench': candidate.policy.metadata['aih.workbench'] };
  candidate.policyText = exportPolicy(candidate.policy);
  const before = new Map(original.policy.selections.map(selection => [selection.id, selection]));
  const after = new Map(candidate.policy.selections.map(selection => [selection.id, selection]));
  const changes = [...new Set([...before.keys(), ...after.keys()])].map(id => ({ id,
    state: !before.has(id) ? 'added' : !after.has(id) ? 'removed' : normalized(before.get(id)) === normalized(after.get(id)) ? 'unchanged' : 'changed'
  }));
  return { ...candidate, originalPolicyText: policyText, changes,
    previousReleaseSha256: previousRelease.sha256, nextReleaseSha256: release.sha256 };
}
