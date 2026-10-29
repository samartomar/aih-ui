// Read-only presentation over checked public Catalog and Harness values.
import * as harness from '@aihq/core/harness';
import * as runtime from '@aihq/core/harness/runtime';
import { resolveSelections } from '@aihq/catalog/reader';
import { recipeClient } from './selected-recipe.mjs';
import { resolveConfiguredSets } from './set-choices.mjs';
const platform = () => ({ os: ({ win32: 'windows', darwin: 'macos' })[process.platform] ?? process.platform, arch: process.arch });
export async function browseContent(inventories, { tool, releaseSha256, sets = [], configurations = [], inspect = false, itemId, chosen }, project, summarize) {
  const inventory = inventories.find(entry => entry.release.sha256 === releaseSha256);
  if (!inventory) return { status: 'unavailable', reason: 'This exact source is unavailable. Your saved choices are unchanged.' };
  const release = inventory.release;
  const releases = Object.fromEntries(inventories.map(entry => [entry.release.sha256, entry.release]));
  const resolution = resolveConfiguredSets({ releases, configurations, sets });
  const selections = resolution.value?.selections ?? []; // A refused set does not invalidate its source's item facts.
  if (typeof harness.selectTool !== 'function' || typeof harness.checkCompatibility !== 'function') return { status: 'unavailable', reason: 'This Core does not publish selected-tool compatibility.', resolution };
  const selected = harness.selectTool(tool);
  if (selected.status !== 'selected') return { status: 'unavailable', reason: 'Choose your tool to check its fit.', resolution };
  const setOrigins = item => selections.find(selection => selection.item.releaseSha256 === release.sha256 && selection.item.itemId === item.id)?.origins?.filter(origin => origin.set).map(origin => origin.set) ?? [];
  const binding = harness.toolBindings.find(binding => binding.tool === selected.tool.id);
  const fallbackOf = item => release.items.find(candidate => candidate.id === item.fallback?.itemId);
  const members = release.items.map(item => ({ item, sets: setOrigins(item), ...(item.fallback ? { fallback: fallbackOf(item) } : {}) }));
  let compatibility;
  try {
    // A browsed card is not an instruction to install every item in the grid.
    // Ask Core about each candidate separately; set fit uses the resolved group.
    const common = { tool: selected.tool.id, platform: platform(), binding,
      nativeRoutes: release.nativeRoutes === undefined ? [] : [{ framework: release.framework.id, lines: release.nativeRoutes }] };
    const checks = members.map(({ item, fallback }) => harness.checkCompatibility({ ...common, items: [{ item, ...(fallback ? { fallback } : {}) }] }));
    const chosen = members.filter(member => selections.some(selection => selection.item.releaseSha256 === release.sha256 && selection.item.itemId === member.item.id));
    const setCheck = harness.checkCompatibility({ ...common, items: chosen });
    compatibility = { items: checks.flatMap(result => result.items ?? []), sets: setCheck.sets ?? [], pluginRoutes: checks[0]?.pluginRoutes ?? setCheck.pluginRoutes, checks: checks.filter(result => result.status !== 'checked'), setCheck };
  } catch { return { status: 'failed', reason: 'Compatibility could not be checked.', resolution, platform: platform() }; }
  const dependencies = typeof itemId === 'string' && release.items.some(item => item.id === itemId) ? { itemId, resolution: resolveSelections({ releases, roots: [{ releaseSha256, itemId, scope: 'project', configuration: {} }], skips: [] }) } : undefined;
  // Host facts come from one bounded read-only inspection of everything chosen, whenever the project
  // folder is known; the inspector no longer triggers a separate inspection (#163).
  const hostItem = item => ({ framework: release.framework.id, itemId: item.id, kind: item.kind,
    ...(item.payload?.dirName || item.payload?.key ? { key: item.payload.dirName ?? item.payload.key } : {}),
    inputs: Object.keys(item.requirements?.inputs ?? {}) });
  // What counts as chosen for the host read is the ARTIFACT's roots (Q6), not the current set-request
  // resolution: a directly added item after clearing set choices must be checked, and an unadded
  // starting-set member must not be. The caller supplies the artifact root ids for this release.
  const chosenItems = Array.isArray(chosen) && chosen.length
    ? members.filter(({ item }) => chosen.includes(item.id)).map(({ item }) => item)
    : members.filter(({ item }) => selections.some(selection => selection.item.releaseSha256 === release.sha256 && selection.item.itemId === item.id)).map(({ item }) => item);
  let host;
  if (!project) host = { status: 'unavailable', reason: 'Choose a project folder to check whether your tool already has your chosen content; no tool is launched.' };
  else if (typeof runtime.inspectToolHost !== 'function') host = { status: 'unavailable', reason: 'This Core does not publish host inspection.' };
  else if (!chosenItems.length) host = { status: 'unavailable', reason: 'Nothing is chosen from this source, so there is nothing to check for a second copy.' };
  else {
    try {
      host = await runtime.inspectToolHost({ tool: selected.tool.id, project, items: chosenItems.map(hostItem) }, { budgetMs: 5000 });
    } catch { host = { status: 'failed', reason: 'Host facts could not be inspected; compatibility remains static.' }; }
  }
  const scans = [];
  if (summarize) for (const item of release.items.filter(item => item.role !== 'supporting')) {
    const result = await summarize(inventory, item.id);
    scans.push({ itemId: item.id, ...result.itemSummary });
  }
  return { status: resolution.status === 'ok' ? 'read' : 'refused', ...(resolution.status === 'ok' ? {} : { diagnostics: resolution.diagnostics }), observations: release.items.map(item => ({ itemId: item.id, observations: binding?.layouts[item.kind]?.observations ?? [] })), scans, dependencies, tool: selected.tool, platform: platform(), compatibility, host, resolution,
    // Whether Core's one-server approval write exists for this tool's MCP registration ('object-keyed' or
    // 'array'), or null/'other' when the shape cannot be written and the person approves in the tool (#162).
    chosenItemIds: chosenItems.map(item => item.id),
    approvalShape: binding?.layouts?.['mcp-server']?.register?.approvalLocation?.shape ?? null,
    recipes: release.items.map(item => ({ itemId: item.id, ...recipeClient(item, tool) })) };
}

// The Your setup drawer's one bounded host read across every chosen item, from the same public inspection
// the cards use. Items are named by the page from its own chosen list and validated against the checked
// inventories; nothing is run and nothing is written (#163).
export async function inspectChosenHost(inventories, { tool, items = [] }, project) {
  if (!Array.isArray(items) || items.length > 128) return { status: 'unavailable', reason: 'Supply at most 128 chosen items to check.' };
  if (typeof harness.selectTool !== 'function') return { status: 'unavailable', reason: 'This Core does not publish selected-tool identity.' };
  const selected = harness.selectTool(tool);
  if (selected.status !== 'selected') return { status: 'unavailable', reason: 'Choose your tool to check its host.' };
  if (typeof runtime.inspectToolHost !== 'function') return { status: 'unavailable', reason: 'This Core does not publish host inspection.' };
  if (!project) return { status: 'unavailable', reason: 'Choose a project folder to check whether your tool already has your chosen content; no tool is launched.' };
  const facts = [];
  for (const ref of items) {
    if (!ref || typeof ref.itemId !== 'string' || typeof ref.releaseSha256 !== 'string') return { status: 'unavailable', reason: 'Chosen items must name their exact source and item.' };
    const inventory = inventories.find(entry => entry.release.sha256 === ref.releaseSha256);
    const item = inventory?.release.items.find(candidate => candidate.id === ref.itemId);
    if (!inventory || !item) return { status: 'unavailable', reason: `Exact source/item unavailable: ${ref.releaseSha256}/${ref.itemId}. Your saved choices are unchanged.` };
    facts.push({ framework: inventory.release.framework.id, itemId: item.id, kind: item.kind,
      ...(item.payload?.dirName || item.payload?.key ? { key: item.payload.dirName ?? item.payload.key } : {}),
      inputs: Object.keys(item.requirements?.inputs ?? {}) });
  }
  if (!facts.length) return { status: 'unavailable', reason: 'Nothing is chosen yet, so there is nothing to check for a second copy.' };
  try {
    return await runtime.inspectToolHost({ tool: selected.tool.id, project, items: facts }, { budgetMs: 5000 });
  } catch {
    return { status: 'failed', reason: 'Host facts could not be inspected.' };
  }
}
