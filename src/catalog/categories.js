/*
 * Curated categories, as Catalog's category reader states them.
 *
 * Catalog publishes one category from a small taxonomy, or an explicit null,
 * for every index entry. That is curation by the Catalog maintainers - its
 * `basis` is always `curated` - and never an upstream declaration: what an
 * upstream publisher declares stays in the presentation data. The backend reads
 * it with `readCatalogCategoriesV1`; this module rebinds each record to the
 * served index entry it names (same entry id and subject digest), and counts.
 * It assigns, infers and repairs nothing: an entry no rule curated reads
 * "Not curated", and every count is taken from the served records at run time.
 */

import { text } from "../app/dom.js";
import { NOT_CURATED, NOT_PUBLISHED } from "../app/absence.js";

/**
 * @param facts    the summary's `categories` block
 * @param data     the served catalog-categories.json, or null
 * @param entries  every entry of the served index
 * @returns { state, reason, curatedBy?, curatedAt?, taxonomy?, byEntryId: Map }
 */
export function applyCategories(facts, data, entries) {
  if (facts?.state !== "published" || data === null) {
    return {
      state: facts?.state === "unavailable" ? "unavailable" : "absent",
      reason: text(facts?.reason),
      byEntryId: new Map(),
    };
  }
  const taxonomy = new Map((Array.isArray(data.taxonomy) ? data.taxonomy : []).map((item) => [item.id, item]));
  const byId = new Map(entries.map((entry) => [text(entry?.entryId), entry]));
  const byEntryId = new Map();
  for (const record of Array.isArray(data.entries) ? data.entries : []) {
    const entry = byId.get(record?.entryId);
    // The backend's reader already checked this; a disagreement means the page
    // and the backend are reading different bytes.
    if (entry === undefined || entry.subject?.subjectDigest !== record.subjectDigest) {
      throw new Error(`curated categories name ${record?.entryId}, which the served index does not hold`);
    }
    if (record.category !== null && !taxonomy.has(record.category)) {
      throw new Error(`curated category ${record.category} of ${record.entryId} is not in the served taxonomy`);
    }
    byEntryId.set(record.entryId, record);
  }
  return {
    state: "published",
    reason: null,
    basis: text(data.basis),
    curatedBy: text(data.curatedBy),
    curatedAt: text(data.curatedAt),
    taxonomy,
    byEntryId,
  };
}

/**
 * One entry's curated category:
 *   { state: "curated", id, label, description, rationale }
 *   { state: "not-curated" }
 * or null when the view is not published or covers no such entry.
 */
export function curatedCategoryOf(view, entry) {
  if (view?.state !== "published") return null;
  const record = view.byEntryId.get(text(entry?.entryId));
  if (record === undefined) return null;
  if (record.category === null) return { state: "not-curated" };
  const item = view.taxonomy.get(record.category);
  return { state: "curated", id: item.id, label: item.label, description: item.description, rationale: record.rationale };
}

/** null means no filter; { id: null } means Catalog explicitly left it uncurated. */
export function matchesCategoryFilter(view, entry, filter) {
  if (filter == null) return true;
  const category = curatedCategoryOf(view, entry);
  if (category === null) return false;
  return filter.id === null
    ? category.state === "not-curated"
    : category.state === "curated" && category.id === filter.id;
}

/** Who curated the dataset, in the words every tooltip uses. */
export function curationNote(view) {
  return `Curated by Catalog maintainers (${view?.curatedBy ?? NOT_PUBLISHED}, ${view?.curatedAt ?? NOT_PUBLISHED}); ` +
    "basis: curated. Not an upstream declaration, and nothing about scanning, qualification or policy.";
}

/** The badge a card shows for its curated category, with its tooltip. */
export function categoryBadge(view, entry) {
  const category = curatedCategoryOf(view, entry);
  if (category === null) return null;
  if (category.state === "not-curated") {
    return {
      text: NOT_CURATED,
      curated: false,
      title: "Category: not curated (basis: curated). No rule of the Catalog maintainers' curation assigns this item a category.",
    };
  }
  return {
    text: category.label,
    curated: true,
    title: `Category: ${category.label} (basis: curated). Curated by Catalog maintainers. Rationale: ${category.rationale}`,
  };
}

/**
 * The selected scope's categories, counted here from the served records:
 * each taxonomy category that holds at least one of `entries`, largest first,
 * then how many of them no rule curated.
 */
export function categoryRows(view, entries) {
  const counts = new Map();
  let notCurated = 0;
  for (const entry of entries) {
    const category = curatedCategoryOf(view, entry);
    if (category === null) continue;
    if (category.state === "not-curated") notCurated += 1;
    else counts.set(category.id, (counts.get(category.id) ?? 0) + 1);
  }
  const rows = [...counts.entries()]
    .map(([id, count]) => ({ ...view.taxonomy.get(id), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { rows, notCurated };
}
