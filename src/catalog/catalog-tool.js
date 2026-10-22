/*
 * The Catalog tool name the person chose as Your tool in the header (claude-code, kiro-ide, ...), in the Catalog's own names.
 *
 * It is the person's own choice, kept in this browser so the catalog, the Install panel, Get started and the
 * improvement check use the same name. It is never derived from the Core ids chosen in Settings: no published contract
 * relates the two vocabularies (samartomar/aih-ui#95). Storage can be blocked; then nothing is remembered.
 */

const KEY = 'aih-ui-catalog-tool';
export const CATALOG_TOOL_EVENT = 'aih:catalog-tool';

/** The saved choice, or '' when there is none or storage cannot be read. */
export function savedCatalogTool() {
  try {
    const value = localStorage.getItem(KEY);
    return typeof value === 'string' ? value : '';
  } catch { return ''; }
}

/** Remembers the choice ('' forgets it) and tells the rest of the page. */
export function saveCatalogTool(tool) {
  try {
    if (tool) localStorage.setItem(KEY, tool); else localStorage.removeItem(KEY);
  } catch { /* a blocked storage must never break the page */ }
  document.dispatchEvent(new CustomEvent(CATALOG_TOOL_EVENT, { detail: { tool: tool || '' } }));
}

/** The tool to show on load: the saved choice when the Catalog still declares it, otherwise none. */
export function defaultCatalogTool(declared, saved) {
  return typeof saved === 'string' && saved && declared.includes(saved) ? saved : '';
}

/**
 * The tool for one catalog refresh, and the saved tool to forget, or ''.
 *
 * The catalog refreshes more than once while the page opens, and an early refresh can come before the framework
 * releases have loaded: the Catalog's default release alone declares no tool names. So the saved choice (the latest
 * one: every choice on the page is saved at once) is tried on every refresh, not only the first, and it is forgotten
 * only once frameworks have loaded and the Catalog still does not declare it (samartomar/aih-ui#136). With storage
 * refused nothing is saved, and the page keeps the tool chosen on it (`current`).
 */
export function catalogToolOnRefresh({ declared = [], frameworksLoaded = false, saved = '', current = '' }) {
  const wanted = saved || current;
  if (wanted && declared.includes(wanted)) return { tool: wanted, forget: '' };
  return { tool: '', forget: saved && frameworksLoaded ? saved : '' };
}
