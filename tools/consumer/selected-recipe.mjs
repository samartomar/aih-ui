// Catalog selects recipes. Harness's declared registry aliases bridge only exact
// public client names; there is no Workbench tool-name table or fuzzy matching.
import * as harness from '@aihq/core/harness';
import { configureItem, resolveSelections } from '@aihq/catalog/reader';
import { stable } from './primitives.mjs';
import { pinKey } from './intent-shape.mjs';
export const recipeDescriptor = ({ id, path, sha256, byteLength, schema }) => ({ id, path, sha256, byteLength, schema });
export function recipeClient(item, tool) {
  if (!item.recipes) return { available: true };
  if (typeof harness.selectTool !== 'function') return { available: false, reason: 'This Core does not publish selected-tool identity.' };
  const selected = harness.selectTool(tool);
  if (selected.status !== 'selected') return { available: false, reason: 'Choose an observed tool before adding this item.' };
  const names = new Set([selected.tool.id, ...selected.tool.aliases]);
  const matches = Object.keys(item.recipes).filter(name => names.has(name));
  return matches.length === 1 ? { available: true, clientId: matches[0] }
    : { available: false, reason: `No unambiguous Catalog recipe matches the public identity of ${selected.tool.label}.` };
}
export function configurePinned(entry, item, configuration, pins) {
  const descriptor = pins?.find(pin => pin.releaseSha256 === entry.release.sha256 && pin.itemId === item.id)?.recipe;
  const clients = Object.entries(item.recipes ?? {}).filter(([, recipe]) => recipe.sha256 === descriptor?.sha256 && recipe.path === descriptor?.path);
  const configure = clientId => configureItem({ release: entry.release, itemId: item.id, configuration, materialSource: entry.materialSource, ...(clientId ? { clientId } : {}) });
  if (clients.length === 1) return configure(clients[0][0]);
  if (clients.length > 1) {
    // Some supporting items publish the exact same recipe for several clients.
    // Catalog must confirm identical selections before a descriptor can stand
    // for those aliases; order must never choose between different semantics.
    const checked = clients.map(([clientId]) => configure(clientId));
    if (checked.every(value => value.valid && stable(value.selection) === stable(checked[0].selection))) return checked[0];
  }
  return configure();
}
export function pinSelectedRecipes(intent, inventories, root, tool) {
  const releases = Object.fromEntries(inventories.map(entry => [entry.release.sha256, entry.release]));
  const resolved = resolveSelections({ releases, roots: [{ releaseSha256: root.releaseSha256, itemId: root.itemId, scope: root.scope, configuration: root.configuration }], skips: [] });
  if (resolved.status !== 'ok') throw new Error(resolved.diagnostics.map(value => value.message).join(' '));
  for (const selection of resolved.value.selections) {
    const entry = inventories.find(entry => entry.release.sha256 === selection.item.releaseSha256);
    const item = entry.release.items.find(item => item.id === selection.item.itemId);
    if (entry.release.framework?.id && item.contentSha256 && item.behaviourSha256 && typeof harness.renderDelivery === 'function') continue;
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
