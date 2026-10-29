// Q2: whether a recorded inline approval recipe still stands. Pure and dependency-free: the caller injects
// the public Harness renderer and bindings, so executable operations are compared against what the public
// renderer produces for THIS checked item/tool/scope now — never trusted by recipe id alone.
import { stable } from './primitives.mjs';

export function approvalRecipeStands({ prior, item, scope, renderDelivery, toolBindings }) {
  if (!prior?.recipe?.inline || !prior.tool) return false;
  if (item.kind !== 'mcp-server' && item.kind !== 'mcp') return false;
  const binding = toolBindings.find(candidate => candidate.tool === prior.tool);
  if (!binding) return false;
  const framework = prior.item?.framework;
  if (!framework) return false;
  const rendered = renderDelivery({ tool: prior.tool, item, binding, scope, grantApproval: { framework, itemId: item.id } });
  return rendered?.status === 'rendered' && stable(rendered.recipe) === stable(prior.recipe.inline);
}
