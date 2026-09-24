import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyCategories, categoryRows, matchesCategoryFilter } from "../../src/catalog/categories.js";
import { FILTER_SEPARATOR, inventoryCounts, scopeEntries, sourceFilterValue, sourceScopes, visibleEntries } from "../../src/catalog/selectors.js";
import { emptyView, restoreView, saveView } from "../../src/catalog/view-state.js";

// Test-only taxonomy and entries; production uses the served Catalog records.
const github = (repository) => ({ type: "github", repository, commit: "abcdef1" });
const entry = (id, kind, source = github("fixture/one")) => ({
  entryId: id, subject: { id, kind, source, subjectDigest: `sha256:${id}` },
});
const entries = [
  entry("alpha", "skill"), entry("beta", "agent"), entry("gamma", "skill"),
  entry("uncurated", "skill"), entry("missing-record", "skill"),
  entry("other-source", "skill", github("fixture/two")),
  entry("npm-item", "skill", { type: "npm", package: "fixture-package", version: "1.0.0", integrity: "sha512:fixture" }),
];
const categories = applyCategories({ state: "published" }, {
  taxonomy: [
    { id: "build", label: "Build tools", description: "Fixture build category" },
    { id: "test", label: "Testing", description: "Fixture test category" },
    { id: "other-only", label: "Other source", description: "Fixture other source category" },
  ],
  entries: entries.filter((item) => item.entryId !== "missing-record").map((item) => ({
    entryId: item.entryId, subjectDigest: item.subject.subjectDigest,
    category: item.entryId === "uncurated" ? null : item.entryId === "gamma" ? "test" : item.entryId === "npm-item" ? "other-only" : "build",
  })),
}, entries);
const counts = inventoryCounts(entries);
const source = sourceFilterValue("github", "fixture/one", "abcdef1");
const view = (patch = {}) => ({ ...emptyView(), source, ...patch });
const visibleIds = (patch = {}) => visibleEntries(entries, view(patch), counts.membership, null, categories).map((item) => item.entryId);

test("source separator stays a runtime NUL without literal NUL bytes in JavaScript", () => {
  assert.equal(FILTER_SEPARATOR, String.fromCharCode(0));
  assert.equal(readFileSync(new URL("../../src/catalog/selectors.js", import.meta.url)).includes(0), false);
  assert.equal(source.split(FILTER_SEPARATOR).length, 3);
});

test("category selection intersects the selected source, and clearing restores its cards", () => {
  assert.deepEqual(visibleIds({ category: { id: "build" } }), ["alpha", "beta"]);
  assert.deepEqual(visibleIds({ category: null }), ["alpha", "beta", "gamma", "missing-record", "uncurated"]);
});

test("Not curated uses only explicit null records, excluding missing and unavailable data", () => {
  assert.deepEqual(visibleIds({ category: { id: null } }), ["uncurated"]);
  const unavailable = applyCategories({ state: "unavailable", reason: "fixture" }, null, entries);
  assert.equal(matchesCategoryFilter(unavailable, entries[3], { id: null }), false);
  assert.equal(matchesCategoryFilter(unavailable, entries[3], null), true);
  assert.equal(matchesCategoryFilter(categories, entries[4], { id: null }), false);
});

test("category combines with kind, search, source type and sort", () => {
  assert.deepEqual(visibleIds({ category: { id: "build" }, kind: "agent", query: "BETA", sourceType: "github", sort: "name-desc" }), ["beta"]);
  assert.deepEqual(visibleIds({ category: { id: "build" }, query: "build tools", sort: "name-desc" }), ["beta", "alpha"]);
  assert.deepEqual(visibleIds({ category: { id: "build" }, sourceType: "npm" }), []);
  assert.deepEqual(visibleIds({ category: { id: "test" }, kind: "agent" }), []);
  assert.deepEqual(visibleIds({ category: { id: "unknown" } }), []);
});

test("rail category counts describe source inventory before other filters", () => {
  const rows = categoryRows(categories, scopeEntries(entries, view({ category: { id: "build" }, kind: "agent", query: "beta" }), counts.membership));
  assert.deepEqual(rows.rows.map(({ id, count }) => [id, count]), [["build", 2], ["test", 1]]);
  assert.equal(rows.notCurated, 1);
});

test("saved category restores only when the current source offers it", (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const store = new Map();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value),
  } });
  t.after(() => previous ? Object.defineProperty(globalThis, "sessionStorage", previous) : delete globalThis.sessionStorage);
  for (const category of [{ id: "build" }, { id: null }]) {
    const saved = view({ category, query: "beta", kind: "agent", sort: "name-desc" });
    saveView(saved);
    assert.deepEqual(restoreView(emptyView(), counts, categories, entries), saved);
  }
  for (const category of [{ id: "unknown" }, { id: "other-only" }, { id: "build", extra: true }, "build", {}]) {
    saveView(view({ category }));
    assert.equal(restoreView(emptyView(), counts, categories, entries).category, null);
  }
  saveView(view({ category: { id: "build" } }));
  assert.equal(restoreView(emptyView(), counts, { state: "unavailable" }, entries).category, null);
  saveView(view({ source: sourceFilterValue("github", "removed/source", "abcdef1"), category: { id: "build" } }));
  assert.equal(restoreView(emptyView(), counts, categories, entries).source, null);
  assert.equal(restoreView(emptyView(), counts, categories, entries).category, null);
  saveView(view({ source: null, category: { id: "build" } }));
  assert.equal(restoreView(emptyView(), counts, categories, entries).category, null);
  const oldView = view();
  delete oldView.category;
  saveView(oldView);
  assert.equal(restoreView(emptyView(), counts, categories, entries).category, null);
});

test("collection scopes filter only Catalog's named members", () => {
  const collection = { id: "fixture-collection", owner: { package: "fixture-owner" }, current: { release: "1.0.0" } };
  const membership = new Map([[entries[0].entryId, collection], [entries[1].entryId, collection]]);
  const collectionCounts = inventoryCounts(entries, { membership });
  const scope = sourceScopes(collectionCounts).find((row) => row.collection === collection);
  assert.deepEqual(visibleEntries(entries, view({ source: scope.filterValue, category: { id: "build" } }), membership, null, categories).map((item) => item.entryId), ["alpha", "beta"]);
});
