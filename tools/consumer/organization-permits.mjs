// An organisation policy entry permitting each selection of a composed setup exactly, by Core's recipe identity of the
// recipe Core renders for it. Used by checks that need an organisation which allows what the page composed (N1, E2).
import { deriveRecipeIdentity } from '@aihq/core/contracts';
import { inlineRecipelessSelections } from './headless.mjs';

export async function permitComposed({ policy, inventories }) {
  const permits = [];
  for (const selection of inlineRecipelessSelections({ policy, inventories }).selections) {
    if (!selection.recipe?.inline) throw new Error(`no rendered recipe for ${selection.managementId}`);
    const identity = await deriveRecipeIdentity({ recipe: selection.recipe.inline });
    if (identity.status !== 'ok') throw new Error(JSON.stringify(identity));
    permits.push({ selectionId: selection.organizationSelectionId ?? selection.id, recipeIdentity: identity.value.recipeIdentity, scopes: ['project'],
      obligation: 'permitted', inputs: {}, lifecycle: { replace: true, remove: true } });
  }
  return permits;
}
