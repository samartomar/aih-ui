import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FILTER_SEPARATOR, inventoryCounts, sourceFilterValue, visibleEntries } from "../../src/catalog/selectors.js";
import { emptyView, restoreView, saveView } from "../../src/catalog/view-state.js";

// Test-only entries; production uses the installed Catalog releases.
const github = (repository) => ({ type: "github", repository, commit: "abcdef1" });
const entry = (id, kind, source = github("fixture/one")) => ({
  entryId: id, subject: { id, kind, source, subjectDigest: `sha256:${id}` },
});
const entries = [
  entry("alpha", "skill"), entry("beta", "agent"), entry("gamma", "skill"),
  entry("other-source", "skill", github("fixture/two")),
  entry("npm-item", "skill", { type: "npm", package: "fixture-package", version: "1.0.0", integrity: "sha512:fixture" }),
];
const counts = inventoryCounts(entries);
const source = sourceFilterValue("github", "fixture/one", "abcdef1");
const view = (patch = {}) => ({ ...emptyView(), source, ...patch });
const visibleIds = (patch = {}) => visibleEntries(entries, view(patch)).map((item) => item.entryId);

test("source separator stays a runtime NUL without literal NUL bytes in JavaScript", () => {
  assert.equal(FILTER_SEPARATOR, String.fromCharCode(0));
  assert.equal(readFileSync(new URL("../../src/catalog/selectors.js", import.meta.url)).includes(0), false);
  assert.equal(source.split(FILTER_SEPARATOR).length, 3);
});

test("a source selection combines with kind, search, source type and sort", () => {
  assert.deepEqual(visibleIds(), ["alpha", "beta", "gamma"]);
  assert.deepEqual(visibleIds({ kind: "agent", query: "BETA", sourceType: "github", sort: "name-desc" }), ["beta"]);
  assert.deepEqual(visibleIds({ sort: "name-desc" }), ["gamma", "beta", "alpha"]);
  assert.deepEqual(visibleIds({ sourceType: "npm" }), []);
  assert.deepEqual(visibleIds({ source: null, query: "fixture-package" }), ["npm-item"]);
});

test("a saved view restores only the filters the installed inventory still offers", (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const store = new Map();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value),
  } });
  t.after(() => previous ? Object.defineProperty(globalThis, "sessionStorage", previous) : delete globalThis.sessionStorage);
  const saved = view({ query: "beta", kind: "agent", sort: "name-desc", family: "Fixture family", target: "fixture-client", support: "unknown" });
  saveView(saved);
  assert.deepEqual(restoreView(emptyView(), counts), saved);
  saveView(view({ source: sourceFilterValue("github", "removed/source", "abcdef1"), kind: "unknown-kind", sort: "unknown" }));
  assert.deepEqual(restoreView(emptyView(), counts), emptyView());
  saveView(view({ support: 'invalid' }));
  assert.equal(restoreView(emptyView(), counts).support, 'all');
  // A view saved by an earlier build may carry a retired category filter; it is not restored.
  saveView({ ...view(), category: { id: "build" } });
  assert.equal("category" in restoreView(emptyView(), counts), false);
});
