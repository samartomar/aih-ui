/**
 * The installed @aihq/catalog's current collection view, read through
 * Catalog's own published reader.
 *
 * The content index says what each entry's source is; it does not say which
 * package owns a group of entries or which release of that group is current.
 * Catalog publishes that separately, bound to the exact index bytes, and
 * `readCatalogCollectionsV1` checks every member against the index. Nothing
 * here decides membership, picks a release or compares versions: a refusal is
 * reported, never repaired, and the preview does not start without the view.
 *
 * Loaded on demand by core-service.mjs, so an installed Catalog that predates
 * the contract fails this one operation with a clear message instead of
 * stopping every other operation from loading.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { CATALOG_COLLECTIONS_SUBPATH_V1, readCatalogCollectionsV1 } from "@aihq/catalog";

import { readCatalog } from "./catalog-access.mjs";

/** `@aihq/catalog/catalog-collections.json`, built from the subpath Catalog publishes. */
const COLLECTIONS_SPECIFIER = `@aihq/catalog${CATALOG_COLLECTIONS_SUBPATH_V1.slice(1)}`;

export function catalogCollections() {
  const { content } = readCatalog();
  const path = fileURLToPath(import.meta.resolve(COLLECTIONS_SPECIFIER));
  const view = readCatalogCollectionsV1({ bytes: readFileSync(path), index: content });
  if (view === undefined) {
    throw new Error(
      `the installed ${COLLECTIONS_SPECIFIER} was refused by readCatalogCollectionsV1: unknown ` +
        "format or version, non-canonical bytes, a different index, or a member that is not " +
        "that exact index entry of its collection's source type and current release.",
    );
  }
  // Plain data, exactly as Catalog stated it.
  return {
    collections: {
      digest: view.digest,
      index: { ...view.index },
      collectedSourceTypes: [...view.collectedSourceTypes],
      collections: view.collections.map((collection) => ({
        id: collection.id,
        owner: { package: collection.owner.package },
        sourceType: collection.sourceType,
        current: { release: collection.current.release, origin: { ...collection.current.origin } },
        members: collection.members.map((member) => ({ ...member })),
      })),
    },
  };
}
