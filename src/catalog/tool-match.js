/*
 * Which AI tool a Catalog item is for, and how that relates to the tools chosen in the header and to the
 * Catalog tool name chosen above the cards.
 *
 * The item's tool comes only from the Catalog's own declaration (metadata.discovery.clientCapabilities
 * `client` and `surface`). The header's tools are Core's nativeClientIds. The two are compared by exact
 * name only: Catalog writes `claude-code` where Core writes `claude`, and no published contract links
 * them, so this file does not translate. An item whose tool name Core does not list is "unmatched": it
 * stays visible and says which tool it is for, rather than being hidden or guessed. The catalog's real tool
 * filter is the Catalog tool name the person chooses (catalogToolView), compared with Catalog names only.
 */

const ANY_TOOL = 'generic';
const usable = value => typeof value === 'string' && value.trim().length > 0;

/** Every tool the item declares, once, with the folder it writes to. */
export function declaredTools(item) {
  const facts = item?.metadata?.discovery?.clientCapabilities;
  if (!Array.isArray(facts)) return [];
  const seen = new Map();
  for (const fact of facts) {
    if (!fact || !usable(fact.client) || seen.has(fact.client)) continue;
    seen.set(fact.client, { client: fact.client, surface: usable(fact.surface) ? fact.surface : null });
  }
  return [...seen.values()];
}

/**
 * 'any'       declares no specific tool (none, or only `generic`)
 * 'selected'  declares a tool that is one of the selected tools, by exact name
 * 'other'     every declared tool is a Core tool that is not selected
 * 'unmatched' declares a tool name Core does not list, so it cannot be compared
 */
export function toolRelation(item, { coreIds = [], selected = [] } = {}) {
  const tools = declaredTools(item).map(tool => tool.client).filter(client => client !== ANY_TOOL);
  if (!tools.length) return 'any';
  if (tools.some(client => selected.includes(client))) return 'selected';
  if (tools.every(client => coreIds.includes(client))) return 'other';
  return 'unmatched';
}

/** The line a card shows under its description. */
export function toolLine(item) {
  const tools = declaredTools(item).filter(tool => tool.client !== ANY_TOOL);
  if (!tools.length) return declaredTools(item).length ? 'For any AI tool' : 'Tool not declared';
  return `For ${tools.map(tool => tool.surface ? `${tool.client} · ${tool.surface}` : tool.client).join(', ')}`;
}

/** With "your tools" on, hides only items that are clearly for a tool you did not select. */
export function filterByTools(entries, { mode, coreIds, selected }) {
  if (mode !== 'mine' || !selected?.length || !coreIds?.length) return entries;
  return entries.filter(entry => toolRelation(entry.authoringItem, { coreIds, selected }) !== 'other');
}

/** What the header tools hid, in words, or '' when they hid nothing (so nothing reads as hidden that is not). */
export function toolsNotice(entries, { mode, coreIds, selected }) {
  const hidden = entries.length - filterByTools(entries, { mode, coreIds, selected }).length;
  if (!hidden) return '';
  const names = [...new Set(entries.filter(entry => toolRelation(entry.authoringItem, { coreIds, selected }) === 'other')
    .flatMap(entry => declaredTools(entry.authoringItem).map(tool => tool.client)))].sort().join(', ');
  return `${hidden} ${hidden === 1 ? 'item' : 'items'} the Catalog lists only for Core tools you did not choose in the header (${names}) ${hidden === 1 ? 'is' : 'are'} also hidden.`;
}

const declaresSpecificTool = item => declaredTools(item).some(tool => tool.client !== ANY_TOOL);

/**
 * The grid filtered by the Catalog tool name the person chose (`tool`, in the Catalog's own names): items that declare
 * it, with any support value. Items that declare no specific tool (none, or only `generic`) are shown only with
 * `showUndeclared`, and `undeclared` counts them either way. With no tool, or `mode` 'all', nothing is hidden.
 */
export function catalogToolView(entries, { tool, mode = 'mine', showUndeclared = false } = {}) {
  const undeclared = entries.filter(entry => !declaresSpecificTool(entry.authoringItem)).length;
  if (!tool || mode !== 'mine') return { entries, undeclared, filtered: false };
  return { undeclared, filtered: true, entries: entries.filter(entry => declaredTools(entry.authoringItem).some(declared => declared.client === tool)
    || (showUndeclared && !declaresSpecificTool(entry.authoringItem))) };
}
