// Catalog selects recipes. Harness's declared registry aliases bridge only exact
// public client names; there is no Workbench tool-name table or fuzzy matching.
import { selectTool } from '@aihq/core/harness';
import { configureItem, resolveSelections } from '@aihq/catalog/reader';
import { pinKey } from './intent-shape.mjs';
export const recipeDescriptor = ({ id, path, sha256, byteLength, schema }) => ({ id, path, sha256, byteLength, schema });
export function recipeClient(item, tool) {
  if (!item.recipes) return { available: true };
  const selected = selectTool(tool);
  if (selected.status !== 'selected') return { available: false, reason: 'Choose an observed tool before adding this item.' };
  const names = new Set([selected.tool.id, ...selected.tool.aliases]);
  const matches = Object.keys(item.recipes).filter(name => names.has(name));
  return matches.length === 1 ? { available: true, clientId: matches[0] }
    : { available: false, reason: `No unambiguous Catalog recipe matches the public identity of ${selected.tool.label}.` };
}
export function configurePinned(entry, item, configuration, pins) {
  const descriptor = pins?.find(pin => pin.releaseSha256 === entry.release.sha256 && pin.itemId === item.id)?.recipe;
  const clients = Object.entries(item.recipes ?? {}).filter(([, recipe]) => recipe.sha256 === descriptor?.sha256 && recipe.path === descriptor?.path);
  return configureItem({ release: entry.release, itemId: item.id, configuration, materialSource: entry.materialSource,
    ...(clients.length === 1 ? { clientId: clients[0][0] } : {}) });
}
export function pinSelectedRecipes(intent, inventories, root, tool) {
  const releases = Object.fromEntries(inventories.map(entry => [entry.release.sha256, entry.release]));
  const resolved = resolveSelections({ releases, roots: [{ releaseSha256: root.releaseSha256, itemId: root.itemId, scope: root.scope, configuration: root.configuration }], skips: [] });
  if (resolved.status !== 'ok') throw new Error(resolved.diagnostics.map(value => value.message).join(' '));
  for (const selection of resolved.value.selections) {
    const entry = inventories.find(entry => entry.release.sha256 === selection.item.releaseSha256);
    const item = entry.release.items.find(item => item.id === selection.item.itemId);
    if (!item.recipes) continue;
    const client = recipeClient(item, tool);
    if (!client.available) throw new Error(client.reason);
    const checked = configureItem({ release: entry.release, itemId: item.id, configuration: selection.configuration, materialSource: entry.materialSource, clientId: client.clientId });
    if (!checked.valid) throw new Error(checked.diagnostics.map(value => value.message).join(' '));
    const previous = intent.pins.find(pin => pinKey(pin) === pinKey(selection.item));
    const recipe = item.recipes[client.clientId];
    if (previous && previous.recipe.sha256 !== recipe.sha256) throw new Error('This item already has another exact tool recipe. Keep its existing choice or remove it before changing tools.');
    if (!previous) intent.pins.push({ ...selection.item, itemSha256: item.itemSha256, recipe: recipeDescriptor(recipe), materials: [] });
  }
}
