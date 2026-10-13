// Presentation over public Core identity/admission. No authority acquisition here.
import { deriveRecipeIdentity, previewOrganizationAdmission } from '@aihq/core/contracts';

export async function previewPolicyAuthority({ policy, organization, recipeMaterials = [], privateInputs = {}, lifecycle = [] }) {
  const selections = [];
  for (const selection of policy.selections) {
    const reference = selection.recipe.reference;
    const bytes = reference && recipeMaterials.find(m => m.sha256 === reference.sha256 && m.byteLength === reference.byteLength)?.bytes;
    const identity = await deriveRecipeIdentity(reference ? { recipeBytes: bytes, reference } : { recipe: selection.recipe.inline });
    if (identity.status !== 'ok') return identity;
    // Identity derivation already validated these exact bytes as a recipe.
    const recipe = reference ? JSON.parse(new TextDecoder().decode(bytes)) : selection.recipe.inline;
    selections.push({ id: selection.id, organizationSelectionId: selection.organizationSelectionId, scope: selection.scope,
      recipeIdentity: identity.value.recipeIdentity, inputs: recipe.inputs,
      configuration: selection.configuration, privateInputs: Object.keys(privateInputs[selection.id] ?? {}) });
  }
  const comparison = previewOrganizationAdmission({ organization, selections, lifecycle });
  if (comparison.status !== 'ok') return comparison;
  const affectedChoices = [], stillValidChoices = [];
  for (const selection of selections) {
    const result = previewOrganizationAdmission({ organization, selections: [selection], lifecycle: [] });
    if (result.status !== 'ok') return result;
    (result.value.admitted ? stillValidChoices : affectedChoices).push({ id: selection.id, organizationSelectionId: selection.organizationSelectionId, diagnostics: result.value.diagnostics });
  }
  return { status: 'ok', value: { ...comparison.value, advisory: true, affectedChoices, stillValidChoices,
    recovery: 'Installed state is unchanged. Review an explicit replacement or managed removal through Core; missing lifecycle permission requires organization action.' }, diagnostics: [] };
}
