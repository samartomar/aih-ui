/*
 * A publisher-metadata refusal is stated as a refusal, never as "Catalog
 * publishes nothing for this item".
 *
 * The preview reads Catalog's presentation sidecar with
 * readCatalogPresentationV1. When that reader refuses the installed sidecar, or
 * the installed Catalog does not export it, the summary carries
 * `publisher: { state: "unavailable", reason }`. The card description, the card
 * category badge and the inspector's Publisher Overview used to say only that
 * "Catalog publishes no publisher metadata for this item" - the sentence for
 * an entry a readable sidecar does not cover - so a reader refusal read as
 * Catalog having nothing to say, and its reason was never shown anywhere.
 *
 *   node --test "tools/tests/*.test.mjs"
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { applyPublisher, provenanceNote, publisherOf } from "../../src/catalog/publisher.js";

const DIGEST = `sha256:${"a".repeat(64)}`;
const entry = { entryId: "skill.test.one", subject: { subjectDigest: DIGEST } };
const REFUSED =
  "the installed @aihq/catalog/catalog-presentation.json was refused by readCatalogPresentationV1: unknown format or version";
const NO_RECORD = "Catalog publishes no publisher metadata for this item.";

test("a refused sidecar keeps the reader's reason on the view", () => {
  const view = applyPublisher({ state: "unavailable", reason: REFUSED }, null, [entry]);
  assert.equal(view.state, "unavailable");
  assert.equal(view.reason, REFUSED);
  assert.equal(publisherOf(view, entry), null);
});

test("with the sidecar refused, every slot says the reader refused and why", () => {
  const view = applyPublisher({ state: "unavailable", reason: REFUSED }, null, [entry]);
  for (const [field, label] of [["description", "Description"], ["category", "Category"], ["title", "Publisher text"]]) {
    const note = provenanceNote(publisherOf(view, entry), field, label, view);
    assert.ok(note.startsWith(`${label}: not published.`), note);
    assert.ok(note.includes(REFUSED), note);
    assert.ok(!note.includes(NO_RECORD), note);
  }
});

test("a readable sidecar that covers no record for an entry keeps its own sentence", () => {
  const view = applyPublisher(
    { state: "published", url: "./publisher-metadata.json" },
    { digest: DIGEST, sources: [], coverage: null, entries: [] },
    [entry],
  );
  assert.equal(provenanceNote(publisherOf(view, entry), "description", "Description", view),
    `Description: not published. ${NO_RECORD}`);
});

test("published and unavailable values read exactly as before", () => {
  const record = {
    entryId: entry.entryId,
    subjectDigest: DIGEST,
    source: { path: "skills/one/SKILL.md", sha256: "b".repeat(64) },
    title: { state: "published", value: "One", field: "frontmatter.name" },
    description: { state: "unavailable", reason: "not-declared" },
    category: { state: "unavailable", reason: "no-such-code" },
  };
  const view = applyPublisher(
    { state: "published", url: "./publisher-metadata.json" },
    { digest: DIGEST, sources: [], coverage: null, entries: [record] },
    [entry],
  );
  const found = publisherOf(view, entry);
  assert.equal(provenanceNote(found, "title", "Title", view),
    "Title as published upstream (frontmatter.name in skills/one/SKILL.md), carried by @aihq/catalog. " +
      "Publisher text, not a scan result or a policy decision.");
  assert.equal(provenanceNote(found, "description", "Description", view),
    "Description: not published - the upstream source does not declare it.");
  assert.equal(provenanceNote(found, "category", "Category", view), "Category: not published - no-such-code.");
});

test("a caller that passes no view keeps the no-record sentence", () => {
  assert.equal(provenanceNote(null, "description", "Description"), `Description: not published. ${NO_RECORD}`);
});
