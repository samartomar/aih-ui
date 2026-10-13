// Explicit acceptance fixture. No network, signing or policy publication.
import { readInstalledRelease } from '@aihq/catalog/node';
import { deriveRecipeIdentity, validateOrganizationPolicy } from '@aihq/core/contracts';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { intakeDeclaration, digestBytes } from './intake.mjs';
import { freshAuthoring, composeAuthoring } from './headless.mjs';
import { noteFixture } from './note-fixture.mjs';
const encode = value => new TextEncoder().encode(JSON.stringify(value) + '\n');
export async function organizationFixture(root) {
  const catalogRoot = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
  const maintained = await readInstalledRelease({ root: catalogRoot, sourceInput: 'maintained' });
  if (!maintained.valid) throw Error(JSON.stringify(maintained.diagnostics));
  const materialRoots = { ...maintained.materialRoots };
  const materials = await Promise.all(maintained.release.items.map(async item => ({ ...item.recipe, bytes: new Uint8Array(await readFile(join(catalogRoot, item.recipe.path))) })));
  const inventories = [{ release: maintained.release, materialSource: maintained.source, materials }];
  for (const [id, variant] of [['notes', 'current'], ['notes-next', 'updated']]) {
    const snapshot = await noteFixture(variant);
    const result = await intakeDeclaration({ ...snapshot, input: { id, kind: 'local', locator: { input: id }, resolvedIdentity: { sha256: await digestBytes(snapshot.declarationBytes) } }, materialSource: { kind: 'local', input: id } });
    if (result.status !== 'ok') throw Error(JSON.stringify(result));
    const inventory = result.value;
    materialRoots[id] = join(root, id); await mkdir(materialRoots[id], { recursive: true });
    for (const material of inventory.materials) { const path = join(materialRoots[id], material.path); await mkdir(dirname(path), { recursive: true }); await writeFile(path, material.bytes); }
    inventories.push(inventory);
  }
  const intent = freshAuthoring();
  const add = (entry, id) => { const item = entry.release.items.find(i => i.id === id); intent.roots.push({ releaseSha256: entry.release.sha256, itemId: id, itemSha256: item.itemSha256, scope: 'project', configuration: id.startsWith('mattpocock.') ? { agentDirectory: '.claude' } : {}, originIds: ['direct'] }); };
  add(inventories[1], 'consumer-proof.review-note');
  add(inventories[0], 'mattpocock.code-review');
  const emptyEnterprise = encode({ schema: 'urn:aihq:core:execution-policy:1.3.0', mode: 'enterprise', selections: [], metadata: { 'aih.workbench': freshAuthoring() } });
  const composed = await composeAuthoring({ basePolicyBytes: emptyEnterprise, intent, inventories });
  if (composed.status !== 'ok') throw Error(JSON.stringify(composed));
  const policy = composed.value.policy;
  const recipeMaterials = inventories.flatMap(i => i.materials ?? []);
  async function allowance(selection, selectionId = selection.organizationSelectionId) {
    const reference = selection.recipe.reference, bytes = recipeMaterials.find(m => m.sha256 === reference.sha256)?.bytes;
    const identity = await deriveRecipeIdentity({ recipeBytes: bytes, reference });
    if (identity.status !== 'ok') throw Error(JSON.stringify(identity));
    return { selectionId, recipeIdentity: identity.value.recipeIdentity, scopes: ['project'], inputs: Object.fromEntries(Object.entries(selection.configuration).map(([name, value]) => [name, { fixed: value }])), lifecycle: { replace: true, remove: true } };
  }
  const admitted = { schema: 'urn:aihq:core:organization-policy:1.0.0', id: 'ui6-test-organization', selections: await Promise.all(policy.selections.map(s => allowance(s))) };
  const withdrawn = structuredClone(admitted);
  const withdrawnSelection = policy.selections.find(s => s.recipe.reference.path.includes('mattpocock.code-review'));
  withdrawn.selections = withdrawn.selections.filter(s => s.selectionId !== withdrawnSelection.organizationSelectionId);
  const blocked = structuredClone(withdrawn);
  // Same missing selection also lacks remove permission: organization action needed.
  blocked.metadata = { fixture: 'blocked recovery for withdrawn code-review; other choices retained' };
  const nextIntent = structuredClone(composed.value.intent);
  const next = inventories[2], nextItem = next.release.items[0];
  nextIntent.roots = nextIntent.roots.map(r => r.itemId === nextItem.id ? { ...r, releaseSha256: next.release.sha256, itemSha256: nextItem.itemSha256, originIds: ['next-note'] } : r);
  nextIntent.origins.push({ id: 'next-note', kind: 'organization', organizationPolicySha256: await digestBytes(encode(admitted)), organizationSelectionId: 'ui6-next-note' });
  nextIntent.inputs = nextIntent.inputs.filter(i => i.id !== 'notes');
  const updated = await composeAuthoring({ basePolicyBytes: composed.value.policyBytes, intent: nextIntent, inventories });
  if (updated.status !== 'ok') throw Error(JSON.stringify(updated));
  const recovery = structuredClone(admitted);
  recovery.selections.push(await allowance(updated.value.policy.selections.find(s => s.organizationSelectionId === 'ui6-next-note')));
  for (const document of [admitted, withdrawn, blocked, recovery]) { const check = validateOrganizationPolicy(document); if (!check.valid) throw Error(JSON.stringify(check)); }
  return { inventories, materialRoots, recipeMaterials, policy, policyBytes: composed.value.policyBytes, updated: updated.value, documents: { admitted, withdrawn, blocked, recovery }, withdrawnSelection };
}
