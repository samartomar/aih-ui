// One item's fit across every chosen tool, from the host's browse answer (tools/consumer/browse-content.mjs). Each tool's
// answer is Core's: its compatibility check and whether it renders the item for that tool. The item is addable when at
// least one chosen tool takes it; nothing is claimed for a tool Core did not answer for.
export function toolFit(item, browse) {
  const entry = browse?.fit?.find(value => value.itemId === item.id);
  if (!entry) return { judged: false, addable: undefined, fits: [], misses: [] };
  const fits = entry.tools.filter(tool => tool.fits), misses = entry.tools.filter(tool => !tool.fits);
  return { judged: true, addable: fits.length > 0, fits, misses };
}

export const toolNames = tools => tools.map(tool => tool.label ?? tool.id ?? tool.tool).join(', ');
