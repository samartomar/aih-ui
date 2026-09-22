/*
 * Publisher titles, descriptions and categories, as Catalog publishes them.
 *
 * The backend reads Catalog's presentation sidecar with Catalog's own reader
 * and serves it as plain data. This module only rebinds each record to the
 * served index entry it names (same entry id and subject digest) and reads
 * values back out. It extracts nothing, fills nothing in and never turns a
 * missing value into text: an unavailable value keeps Catalog's reason.
 *
 * These values are upstream publisher text. They are rendered with
 * textContent, never as markup, and they say nothing about scanning, policy
 * or whether an item is allowed.
 */

import { text } from "../app/dom.js";

/** Why a value is missing, in words, from Catalog's reason code. */
export const UNAVAILABLE_REASON = {
  "not-declared": "the upstream source does not declare it",
  unparsed: "Catalog could not read it from the upstream file without guessing",
  "no-source-file": "Catalog names no upstream file for this item",
  "not-in-source-file": "the upstream file does not list this item",
};

/**
 * @param facts    the summary's `publisher` block
 * @param data     the served publisher-metadata.json, or null when unavailable
 * @param entries  every entry of the served index
 * @returns { state, reason?, digest?, sources?, coverage?, byEntryId: Map }
 */
export function applyPublisher(facts, data, entries) {
  if (facts?.state !== "published" || data === null) {
    return { state: "unavailable", reason: text(facts?.reason) ?? "not supplied by the preview", byEntryId: new Map() };
  }
  const byId = new Map(entries.map((entry) => [text(entry?.entryId), entry]));
  const byEntryId = new Map();
  for (const record of Array.isArray(data.entries) ? data.entries : []) {
    const entry = byId.get(record?.entryId);
    // The backend's reader already checked this; a disagreement means the page
    // and the backend are reading different bytes.
    if (entry === undefined || entry.subject?.subjectDigest !== record.subjectDigest) {
      throw new Error(`publisher metadata names ${record?.entryId}, which the served index does not hold`);
    }
    byEntryId.set(record.entryId, record);
  }
  return {
    state: "published",
    digest: text(data.digest),
    sources: Array.isArray(data.sources) ? data.sources : [],
    coverage: data.coverage ?? null,
    byEntryId,
  };
}

/** The record for one entry, or null when Catalog publishes none for it. */
export function publisherOf(publisher, entry) {
  return publisher?.byEntryId?.get(text(entry?.entryId)) ?? null;
}

/**
 * How many entries Catalog publishes a category for, counted here from the
 * served records, and how many entries the installed index holds.
 *
 * Both numbers are read at run time so the rail can say how thin the published
 * coverage is without a figure ever being written into this page. Either one
 * being unavailable is reported as null, never as a zero.
 *
 * @param publisher   the applied publisher view
 * @param entryCount  the summary's own count of indexed entries
 */
export function categoryCoverage(publisher, entryCount) {
  if (publisher?.state !== "published") return { published: null, entries: null };
  let published = 0;
  for (const record of publisher.byEntryId.values()) {
    if (record?.category?.state === "published") published += 1;
  }
  return { published, entries: Number.isInteger(entryCount) ? entryCount : null };
}

/** A published value's text, or null. */
export function publishedText(record, field) {
  const value = record?.[field];
  return value?.state === "published" ? text(value.value) : null;
}

/** The tooltip that says where a value came from, or why it is missing. */
export function provenanceNote(record, field, label) {
  const value = record?.[field];
  if (value?.state === "published") {
    return `${label} as published upstream (${value.field} in ${record.source?.path ?? "the upstream file"}), ` +
      "carried by @aihq/catalog. Publisher text, not a scan result or a policy decision.";
  }
  if (value?.state === "unavailable") {
    return `${label}: not published - ${UNAVAILABLE_REASON[value.reason] ?? value.reason}.`;
  }
  return `${label}: not published. Catalog publishes no publisher metadata for this item.`;
}
