/**
 * The installed @aihq/catalog's curated categories, read through Catalog's own
 * category reader.
 *
 * Catalog publishes one category from a small taxonomy, or an explicit `null`,
 * for every index entry (`@aihq/catalog/catalog-categories.json`). This is
 * curation by the Catalog maintainers - `basis` is always `curated` - never an
 * upstream declaration (those stay in the presentation sidecar) and never a
 * classification made here. `readCatalogCategoriesV1` checks every record
 * against the exact index entry and that every entry is covered; nothing here
 * assigns, repairs or infers a category.
 *
 * A Catalog that predates the export is not an error: it is reported as
 * absent, and the rail keeps its Not published wording.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as catalog from "@aihq/catalog";

import { readCatalog } from "./catalog-access.mjs";

export function catalogCategories() {
  const { readCatalogCategoriesV1, CATALOG_CATEGORIES_SUBPATH_V1 } = catalog;
  if (typeof readCatalogCategoriesV1 !== "function" || typeof CATALOG_CATEGORIES_SUBPATH_V1 !== "string") {
    return { categories: null, absent: "the installed @aihq/catalog does not export readCatalogCategoriesV1" };
  }
  const specifier = `@aihq/catalog${CATALOG_CATEGORIES_SUBPATH_V1.slice(1)}`;
  const { content } = readCatalog();
  const view = readCatalogCategoriesV1({
    bytes: readFileSync(fileURLToPath(import.meta.resolve(specifier))),
    index: content,
  });
  if (view === undefined) {
    throw new Error(
      `the installed ${specifier} was refused by readCatalogCategoriesV1: unknown format, version ` +
        "or basis, non-canonical bytes, a malformed or unsorted taxonomy, a category outside it, an " +
        "entry that is not that exact index entry, or an indexed entry left out.",
    );
  }
  // Plain data, exactly as the reader returned it.
  return {
    categories: {
      specifier,
      digest: view.digest,
      basis: view.basis,
      curatedBy: view.curatedBy,
      curatedAt: view.curatedAt,
      taxonomy: view.taxonomy.map((item) => ({ id: item.id, label: item.label, description: item.description })),
      coverage: {
        entries: view.coverage.entries,
        curated: view.coverage.curated,
        notCurated: view.coverage.notCurated,
        byCategory: { ...view.coverage.byCategory },
      },
      entries: view.entries.map((entry) => ({
        entryId: entry.entryId,
        subjectDigest: entry.subjectDigest,
        reason: entry.reason,
        category: entry.category,
        rationale: entry.rationale,
      })),
    },
  };
}
