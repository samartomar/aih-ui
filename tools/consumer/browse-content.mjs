// Read-only presentation over checked public Catalog and Harness values.
import * as harness from '@aihq/core/harness';
import * as runtime from '@aihq/core/harness/runtime';
import { resolveSelections } from '@aihq/catalog/reader';
import { recipeClient } from './selected-recipe.mjs';
const platform = () => ({ os: ({ win32: 'windows', darwin: 'macos' })[process.platform] ?? process.platform, arch: process.arch });
export async function browseContent(inventories, { tool, releaseSha256, sets = [], inspect = false }, project, summarize) {
  const inventory = inventories.find(entry => entry.release.sha256 === releaseSha256);
  if (!inventory) return { status: 'unavailable', reason: 'This exact source is unavailable. Your saved choices are unchanged.' };
  const release = inventory.release;
  const releases = Object.fromEntries(inventories.map(entry => [entry.release.sha256, entry.release]));
  const resolution = resolveSelections({ releases, roots: [], skips: [], sets });
  if (resolution.status !== 'ok') return resolution;
  if (typeof harness.selectTool !== 'function' || typeof harness.checkCompatibility !== 'function') return { status: 'unavailable', reason: 'This Core does not publish selected-tool compatibility.', resolution };
  const selected = harness.selectTool(tool);
  if (selected.status !== 'selected') return { status: 'unavailable', reason: 'Choose your tool to check its fit.', resolution };
  const setOrigins = item => resolution.value.selections.find(selection => selection.item.releaseSha256 === release.sha256 && selection.item.itemId === item.id)?.origins?.filter(origin => origin.set).map(origin => origin.set) ?? [];
  const binding = harness.toolBindings.find(binding => binding.tool === selected.tool.id);
  const fallbackOf = item => {
    if (!item.fallback) return undefined;
    const reference = item.fallback;
    if (!reference.framework || reference.framework === release.framework.id) return release.items.find(candidate => candidate.id === reference.itemId);
    const sources = inventories.filter(entry => entry.release.framework?.id === reference.framework && (!reference.releaseVersion || entry.release.framework.version === reference.releaseVersion));
    return sources.length === 1 ? sources[0].release.items.find(candidate => candidate.id === reference.itemId) : undefined;
  };
  const members = release.items.map(item => ({ item, sets: setOrigins(item), ...(item.fallback ? { fallback: fallbackOf(item) } : {}) }));
  let compatibility;
  try {
    // A browsed card is not an instruction to install every item in the grid.
    // Ask Core about each candidate separately; set fit uses the resolved group.
    const common = { tool: selected.tool.id, platform: platform(), binding };
    const checks = members.map(({ item, fallback }) => harness.checkCompatibility({ ...common, items: [{ item, ...(fallback ? { fallback } : {}) }] }));
    const chosen = members.filter(member => resolution.value.selections.some(selection => selection.item.releaseSha256 === release.sha256 && selection.item.itemId === member.item.id));
    const setCheck = harness.checkCompatibility({ ...common, items: chosen });
    compatibility = { items: checks.flatMap(result => result.items ?? []), sets: setCheck.sets ?? [], checks: checks.filter(result => result.status !== 'checked'), setCheck };
  } catch { return { status: 'failed', reason: 'Compatibility could not be checked.', resolution, platform: platform() }; }
  let host = { status: 'unavailable', reason: 'Host facts unchecked. Open an item to inspect this host; no tool is launched.' };
  if (inspect && project && typeof runtime.inspectToolHost === 'function') {
    try {
      host = await runtime.inspectToolHost({ tool: selected.tool.id, project, items: release.items.map(item => ({ framework: release.framework.id, itemId: item.id, kind: item.kind,
        ...(item.payload?.dirName || item.payload?.key ? { key: item.payload.dirName ?? item.payload.key } : {}),
        inputs: Object.keys(item.requirements?.inputs ?? {}) })) }, { budgetMs: 5000 });
    } catch { host = { status: 'failed', reason: 'Host facts could not be inspected; compatibility remains static.' }; }
  }
  const scans = [];
  if (summarize) for (const item of release.items.filter(item => item.role !== 'supporting')) {
    const result = await summarize(inventory, item.id);
    scans.push({ itemId: item.id, ...result.itemSummary });
  }
  return { status: 'read', observations: release.items.map(item => ({ itemId: item.id, observations: binding?.layouts[item.kind]?.observations ?? [] })), scans, tool: selected.tool, platform: platform(), compatibility, host, resolution,
    recipes: release.items.map(item => ({ itemId: item.id, ...recipeClient(item, tool) })) };
}
