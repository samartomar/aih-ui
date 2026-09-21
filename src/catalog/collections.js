/*
 * Current inventory, as Catalog's collection view states it.
 *
 * The index holds every entry Catalog ships, including older content kept for
 * evidence and reference: Core-derived entries for several Core releases, for
 * example. Which of them is CURRENT is not something this page works out. It
 * does not read releases out of entry ids, take the highest version, or keep a
 * list of Core releases. Catalog publishes a collection view - validated by
 * its own reader in the backend - naming the source types it governs and each
 * collection's owner, current release and exact members, and the page applies
 * it as given:
 *
 *   - an entry of a collected source type is current only if a collection
 *     names it, with the same subject digest;
 *   - every other source type is unaffected.
 *
 * Older entries stay addressable in the index; they are counted here only as
 * a diagnostic, never as inventory or as a source row.
 */

import { text } from "../app/dom.js";

/**
 * @param view     the `collections` block of the preview summary
 * @param entries  every entry of the installed index
 * @returns { current, membership, collections, collectedSourceTypes, notCurrent }
 */
export function applyCollections(view, entries) {
  if (view === null || typeof view !== "object" || !Array.isArray(view.collections)) {
    throw new Error("the preview summary carries no Catalog collection view");
  }
  const collected = new Set(view.collectedSourceTypes ?? []);
  const byId = new Map(entries.map((entry) => [text(entry?.entryId), entry]));
  const membership = new Map();
  for (const collection of view.collections) {
    for (const member of collection.members ?? []) {
      const entry = byId.get(member.entryId);
      // The backend's reader already checked this; a disagreement here means
      // the page and the backend are reading different bytes.
      if (entry === undefined || entry.subject?.subjectDigest !== member.subjectDigest) {
        throw new Error(`collection ${collection.id} names ${member.entryId}, which the served index does not hold`);
      }
      membership.set(member.entryId, collection);
    }
  }
  const current = entries.filter(
    (entry) => !collected.has(text(entry?.subject?.source?.type)) || membership.has(text(entry?.entryId)),
  );
  return {
    current,
    membership,
    collections: view.collections,
    collectedSourceTypes: [...collected],
    notCurrent: entries.length - current.length,
  };
}
