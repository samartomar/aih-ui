/*
 * Publisher qualification, as Catalog's qualification reader states it.
 *
 * The backend reads the installed Catalog's qualification sidecar with
 * `readCatalogQualificationV1` - which re-verifies the shipped signed head and
 * hashes every receipt - at one instant, and serves the reader's words. This
 * module only rebinds each record to the served index entry it names (same
 * entry id and subject digest) and hands the words back. It decides no state
 * and never turns one into another: `qualified` stays the reader's word, and
 * it is never shown as approval.
 */

import { text } from "../app/dom.js";
import { NOT_PUBLISHED, QUALIFICATION_ABSENT } from "../app/absence.js";

/** What each entry state means, for the value's tooltip. The words are Catalog's. */
export const QUALIFICATION_STATE_MEANING = {
  qualified:
    "this publisher's signed catalog carries this member with this identity inside the receipt's validity window",
  expired: "the receipt's validity window has ended",
  "not-yet-valid": "the receipt's validity window has not started",
  "receipt-absent": "the receipt the sidecar declares is not in the installed package",
  "receipt-digest-mismatch": "the receipt's bytes do not hash to the digest the sidecar declares",
  "receipt-malformed": "the receipt does not parse as this entry's qualification receipt",
  "basis-mismatch": "the receipt disagrees with the shipped signed head or the window the sidecar declares",
  "member-mismatch": "the receipt names a different catalog member",
  "subject-mismatch": "the receipt names a different subject",
  "not-evaluated": "the reader could not evaluate this receipt against an established head",
};

/** What the document-level attestation state means, beside Catalog's own words. */
export function attestationSentence(qualification) {
  const state = text(qualification?.attestation);
  if (state === "absent") {
    return "absent: receipts are not attested until the owner's signed-catalog dispatch. " +
      `Required operation: ${text(qualification?.publisher?.requiredOperation) ?? NOT_PUBLISHED}`;
  }
  if (state === "published-locator") {
    const locator = qualification?.publisher?.locator;
    return "published-locator: the sidecar names where an attestation was published" +
      `${locator?.repository ? ` (${locator.repository})` : ""}. This page does not verify it.`;
  }
  if (state === "not-evaluated") {
    return "not-evaluated: the shipped signed head could not be established, so no attestation state is stated.";
  }
  return `${NOT_PUBLISHED}: the reader stated no attestation.`;
}

/**
 * @param facts    the summary's `qualification` block
 * @param data     the served catalog-qualification.json, or null
 * @param entries  every entry of the served index
 * @returns { state, reason, document?, byEntryId: Map }
 */
export function applyQualification(facts, data, entries) {
  if (facts?.state !== "published" || data === null) {
    return {
      state: facts?.state === "unavailable" ? "unavailable" : "absent",
      reason: facts?.state === "unavailable"
        ? `${NOT_PUBLISHED}: Catalog's qualification reader refused the installed sidecar (${text(facts?.reason) ?? "no reason given"}).`
        : QUALIFICATION_ABSENT,
      byEntryId: new Map(),
    };
  }
  const byId = new Map(entries.map((entry) => [text(entry?.entryId), entry]));
  const byEntryId = new Map();
  for (const record of Array.isArray(data.entries) ? data.entries : []) {
    const entry = byId.get(record?.entryId);
    // The backend's reader already checked this; a disagreement means the page
    // and the backend are reading different bytes.
    if (entry === undefined || entry.subject?.subjectDigest !== record.subjectDigest) {
      throw new Error(`qualification names ${record?.entryId}, which the served index does not hold`);
    }
    byEntryId.set(record.entryId, record);
  }
  return { state: "published", reason: null, document: data, byEntryId };
}

/** This entry's qualification record, or null when the sidecar covers none. */
export function qualificationOf(view, entry) {
  return view?.byEntryId?.get(text(entry?.entryId)) ?? null;
}
