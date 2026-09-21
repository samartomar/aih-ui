/**
 * Publisher titles, descriptions and categories, read through the installed
 * @aihq/catalog's own presentation reader.
 *
 * Catalog publishes them as a display-only sidecar bound to its index:
 * `readCatalogPresentationV1` checks each record against the exact index entry
 * and subject digest, that every indexed entry of a listed source is covered,
 * and each value's shape. Nothing here extracts, repairs or fills in a value.
 * An unavailable value stays unavailable with Catalog's reason.
 *
 * A Catalog that predates the contract makes this one operation report
 * `unavailable`; the rest of the page does not depend on it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as catalog from "@aihq/catalog";

import { readCatalog } from "./catalog-access.mjs";

export function catalogPublisher() {
  const { readCatalogPresentationV1, CATALOG_PRESENTATION_SUBPATH_V1 } = catalog;
  if (typeof readCatalogPresentationV1 !== "function" || typeof CATALOG_PRESENTATION_SUBPATH_V1 !== "string") {
    throw new Error("the installed @aihq/catalog does not export readCatalogPresentationV1");
  }
  const specifier = `@aihq/catalog${CATALOG_PRESENTATION_SUBPATH_V1.slice(1)}`;
  const { content } = readCatalog();
  const path = fileURLToPath(import.meta.resolve(specifier));
  const view = readCatalogPresentationV1({ bytes: readFileSync(path), index: content });
  if (view === undefined) {
    throw new Error(
      `the installed ${specifier} was refused by readCatalogPresentationV1: unknown format or ` +
        "version, non-canonical bytes, a record that is not that exact index entry, an indexed " +
        "entry left out, or a malformed value.",
    );
  }
  // Plain data, exactly as Catalog's reader returned it.
  const value = (item) => (item.state === "published"
    ? { state: "published", value: item.value, field: item.field }
    : { state: "unavailable", reason: item.reason });
  return {
    publisher: {
      specifier,
      digest: view.digest,
      sources: view.sources.map((source) => ({ ...source })),
      coverage: JSON.parse(JSON.stringify(view.coverage)),
      entries: view.entries.map((entry) => ({
        entryId: entry.entryId,
        subjectDigest: entry.subjectDigest,
        source: entry.source === null ? null : { ...entry.source },
        title: value(entry.title),
        description: value(entry.description),
        category: value(entry.category),
      })),
    },
  };
}
