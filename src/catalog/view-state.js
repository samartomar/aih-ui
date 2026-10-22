/*
 * The view (query, filters, sort) kept for the length of a browser session.
 *
 * A view saved by an earlier build can name a sort key, framework or source
 * this build does not publish. Those are dropped against the counts taken from
 * the installed index, so a control and the grid can never disagree.
 */

import { SORT_KEYS, sourceScopes } from "./selectors.js";

const SAVED_KEY = "aih-ui-sources-view";

export function emptyView() {
  return { query: "", kind: null, sourceType: null, sort: "name", source: null, family: "", target: "", support: "all" };
}

export function saveView(view) {
  try {
    sessionStorage.setItem(SAVED_KEY, JSON.stringify(view));
  } catch {
    /* a blocked storage must never break the page */
  }
}

/**
 * Applies a saved view onto `view`, validating each filter against `counts`.
 *
 * The counts must already be computed: validating against empty maps silently
 * discards every saved filter.
 */
export function restoreView(view, counts) {
  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(SAVED_KEY) ?? "null");
  } catch {
    saved = null;
  }
  if (!saved || typeof saved !== "object") return view;
  if (typeof saved.query === "string") view.query = saved.query;
  if (typeof saved.kind === "string" && counts.kindCounts.has(saved.kind)) view.kind = saved.kind;
  if (typeof saved.sourceType === "string" && counts.sourceTypeCounts.has(saved.sourceType)) {
    view.sourceType = saved.sourceType;
  }
  if (typeof saved.source === "string") {
    if (sourceScopes(counts).some((scope) => scope.filterValue === saved.source)) view.source = saved.source;
  }
  if (typeof saved.family === 'string') view.family = saved.family;
  // The Catalog tool is the person's own saved choice (catalog-tool.js), not part of the session view.
  if (['all', 'supported', 'unsupported', 'unknown', 'not-declared'].includes(saved.support)) view.support = saved.support;
  if (SORT_KEYS.includes(saved.sort)) view.sort = saved.sort;
  return view;
}
