/*
 * The Catalog tool name the person chose above the cards (claude-code, kiro-ide, ...), in the Catalog's own names.
 *
 * It is the person's own choice, kept in this browser so the catalog, the Install panel, Get started and the
 * improvement check use the same name. It is never derived from the header's Core ids: no published contract
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
