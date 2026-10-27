// Advisory badge data only; current authority is acquired by the existing host.
import { previewOrganizationObligations, deriveRecipeIdentity } from '@aihq/core/contracts';
import { configureItem } from '@aihq/catalog/reader';
import { recipeClient } from './selected-recipe.mjs';
import { managementIdOf } from './intent-shape.mjs';
export async function browsePolicy(inventory, tool, organization) {
  const result = [];
  for (const item of inventory.release.items.filter(item => item.role !== 'supporting')) {
    const client = recipeClient(item, tool);
    const configured = client.available && configureItem({ release: inventory.release, itemId: item.id, configuration: {}, materialSource: inventory.materialSource, ...(client.clientId ? { clientId: client.clientId } : {}) });
    const reference = configured?.selection?.recipe.reference;
    const bytes = reference && inventory.materials.find(material => material.sha256 === reference.sha256)?.bytes;
    const identity = bytes && await deriveRecipeIdentity({ recipeBytes: bytes, reference });
    const selections = identity?.status === 'ok' ? [{ id: item.id, organizationSelectionId: managementIdOf({ scope: 'project', packageName: inventory.release.package.name, itemId: item.id }), scope: 'project', recipeIdentity: identity.value.recipeIdentity,
      inputs: item.inputs, configuration: {}, privateInputs: [], kind: item.kind, item: { framework: inventory.release.framework.id, itemId: item.id } }] : [];
    const preview = previewOrganizationObligations({ organization, selections, lifecycle: [], target: { scope: 'project', client: tool } });
    result.push({ itemId: item.id, preview });
  }
  return result;
}
