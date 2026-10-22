/*
 * Which AI tool a Catalog item is for, and how that relates to the tools chosen in the header.
 *
 * The item's tool comes only from the Catalog's own declaration (metadata.discovery.clientCapabilities
 * `client` and `surface`). The header's tools are Core's nativeClientIds. The two are compared by exact
 * name only: Catalog writes `claude-code` where Core writes `claude`, and no published contract links
 * them, so this file does not translate. An item whose tool name Core does not list is "unmatched": it
 * stays visible and says which tool it is for, rather than being hidden or guessed.
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

/** What the filter bar says, so nothing it cannot decide looks decided. */
export function toolsNotice(entries, { mode, coreIds, selected, labels = {} }) {
  const names = (selected ?? []).map(id => labels[id] ? `${labels[id]} (${id})` : id).join(', ');
  if (!coreIds?.length) return { showing: 'Showing all tools: the installed Core does not list its supported tools, so content cannot be matched to them.', unmatched: '' };
  if (!selected?.length) return { showing: 'Showing all tools. Choose your tools in the header to see only content for them.', unmatched: '' };
  if (mode !== 'mine') return { showing: `Showing content for all tools. Your tools: ${names}.`, unmatched: '' };
  const unmatched = entries.filter(entry => toolRelation(entry.authoringItem, { coreIds, selected }) === 'unmatched');
  const names2 = [...new Set(unmatched.flatMap(entry => declaredTools(entry.authoringItem).map(tool => tool.client)).filter(client => !coreIds.includes(client) && client !== ANY_TOOL))].sort();
  return {
    showing: `Showing content for your tools: ${names}. Content for your other supported tools is hidden.`,
    unmatched: unmatched.length ? `${unmatched.length} items name a tool the Catalog calls ${names2.join(', ')}, which does not match Core's tool names, so they stay visible. Each card says which tool it is for.` : '',
  };
}
