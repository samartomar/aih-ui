import { test } from "node:test";
import assert from "node:assert/strict";
import { clientLabel, clientText, publishedClients } from "../../src/app/core-targets.js";

const published = { state: "published", source: "@aihq/core/harness nativeClientIds", targets: ["claude", "codex", "zed"], labels: { claude: "Claude Code", zed: "Zed" } };

test("the offered clients are exactly the published ids, in Core's order", () => {
  assert.deepEqual(publishedClients(published).ids, ["claude", "codex", "zed"]);
  assert.equal(publishedClients(published).ids.includes("not-a-client"), false);
});

test("a label is used only where one is published; an id without one displays as itself", () => {
  const { labels } = publishedClients(published);
  assert.equal(clientLabel(labels, "claude"), "Claude Code");
  assert.equal(clientLabel(labels, "codex"), null);
  assert.equal(clientText(labels, "claude"), "Claude Code (claude)");
  assert.equal(clientText(labels, "codex"), "codex");
});

test("labels for ids Core does not list, and non-string labels, are never carried", () => {
  const { labels } = publishedClients({ ...published, labels: { claude: "", codex: 7, other: "Other", constructor: "x" } });
  assert.deepEqual(labels, {});
  assert.equal(clientLabel({}, "constructor"), null);
});

test("a Core that publishes no list, or no labels, offers nothing it was not given", () => {
  assert.equal(publishedClients({ state: "unavailable", reason: "no" }), null);
  assert.equal(publishedClients(null), null);
  assert.equal(publishedClients({ state: "published", targets: "claude" }), null);
  assert.deepEqual(publishedClients({ state: "published", targets: ["claude", 3, ""] }), { ids: ["claude"], labels: {} });
});
