/*
 * Four different absences, kept apart on purpose. Collapsing them into one
 * word is how a page starts implying that an organization failed to supply
 * something the catalog was never going to carry.
 *
 * - NOT_PUBLISHED: a package field the installed index genuinely does not carry.
 * - NOT_DECLARED:  a field the index DOES carry, as an empty list. An empty
 *                  declaration is not a measurement, so it never reads "none".
 * - NOT_SUPPLIED:  operator input. Organizations supply it; no package will.
 * - NOT_CONNECTED: an action or telemetry feed with no Core contract wired yet.
 *
 * Below the four words: reasons that more than one component states, kept here
 * so two panes can never word the same absence differently.
 */

export const NOT_PUBLISHED = "Not published";
export const NOT_DECLARED = "Not declared";
export const NOT_SUPPLIED = "Not supplied";
export const NOT_CONNECTED = "Not connected";

/** Why the Catalog inspector cannot show a per-entry finding. */
export const FINDING_DETAIL_ABSENT =
  "Catalog does not supply a verified per-entry Scan result and annex bytes.";

/**
 * The evidence summary slot when the installed Catalog's public reader does
 * not return a `summary` for an evidence record. The page is served that
 * reader's output only, so this is the one thing it can say about an older
 * Catalog: the summary exists in no field it was given.
 */
export const EVIDENCE_SUMMARY_ABSENT =
  `${NOT_PUBLISHED}: Catalog's public reader does not surface the evidence summary.`;

