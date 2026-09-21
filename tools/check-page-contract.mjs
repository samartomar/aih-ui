#!/usr/bin/env node
/*
 * Two offline regressions for the Sources & Catalogs preview, runnable without a package
 * install or a running server:
 *
 *   node tools/check-page-contract.mjs
 *
 * 1. Every element id src/catalog.js collects exists in src/index.html, exactly once. A
 *    mismatch is a blank page, so it is checked here rather than discovered in a browser.
 * 2. Request paths classify the way the preview server must answer them: a normal request is
 *    served, a malformed URL or percent escape is a 400 (the bug this protects), and
 *    traversal is refused.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyRequestPath } from "./preview-request.mjs";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
let failures = 0;

function check(description, condition, detail = "") {
  if (condition) {
    process.stdout.write(`ok   ${description}\n`);
  } else {
    failures += 1;
    process.stdout.write(`FAIL ${description}${detail ? `: ${detail}` : ""}\n`);
  }
}

/* ---------------------------------------------------- 1. the page's element ids */

const html = readFileSync(join(REPO_ROOT, "src", "index.html"), "utf8");
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const required = [
  "provenance-strip", "toggle-nav-btn", "toggle-inspector-btn", "nav-rail", "nav-sources-count",
  "rail-package-version", "rail-package-count", "rail-kind-list", "rail-source-list",
  "framework-matrix-tabs", "masthead-version", "masthead-facts", "kind-filters",
  "visible-count", "visible-caption", "cards-grid", "inspector-rail",
  "inspector-name", "inspector-kind", "inspector-version", "inspector-subtitle", "inspector-flags",
  "inspector-icon", "close-inspector-btn", "pane-details", "pane-security", "pane-json",
  "details-identity", "details-source", "details-desc", "details-capabilities", "details-artifacts",
  "scanner-report-statement", "statement-count", "security-statements", "catalog-error",
  "catalog-search", "source-filter", "sort-select",
];
const missing = required.filter((id) => !ids.includes(id));
check("index.html carries every id the page collects", missing.length === 0, missing.join(", "));
const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
check("index.html has no duplicate id", duplicates.length === 0, duplicates.join(", "));

/* ------------------------------------------- 2. request-path classification */

const runDir = resolve(REPO_ROOT, "src");
const cases = [
  ["/", 200, "the page"],
  ["/catalog-index.json", 200, "the served index"],
  ["/catalog.js", 200, "the page module"],
  ["/wb.css", 200, "a presentation file"],
  ["/%", 400, "a truncated percent escape"],
  ["/%zz", 400, "a non-hex percent escape"],
  ["/%e0%a4%a", 400, "a truncated multi-byte escape"],
  ["/..%5csecrets", 403, "an encoded backslash separator"],
  ["/%00", 403, "a NUL byte"],
  // The WHATWG URL parser folds dot segments away before the path is decoded, so these
  // requests are answered from inside the run directory. What must hold is the containment
  // assertion below, not a particular status code.
  ["/..", 200, "a parent segment folds back to the root"],
  ["/../secrets", 200, "traversal folds back to the run directory"],
];
for (const [requestUrl, expected, description] of cases) {
  let classified;
  try {
    classified = classifyRequestPath(requestUrl, runDir);
  } catch (error) {
    classified = { status: `threw ${error.message}` };
  }
  check(`${JSON.stringify(requestUrl)} -> ${expected} (${description})`, classified.status === expected, `got ${classified.status}`);
}

/* Whatever is served must sit inside the run directory. This is the rule that has to hold for
   every request, including the ones the URL parser normalizes. */
const probes = ["/", "/..", "/../secrets", "/%2e%2e/secrets", "/../../etc/passwd", "/%2e%2e%5csecrets", "/catalog.js", "/a/b/../../../c"];
for (const requestUrl of probes) {
  const classified = classifyRequestPath(requestUrl, runDir);
  const contained = classified.status !== 200 || classified.file === runDir || classified.file.startsWith(`${runDir}\\`) || classified.file.startsWith(`${runDir}/`);
  check(`containment holds for ${JSON.stringify(requestUrl)}`, contained, classified.status === 200 ? classified.file : `status ${classified.status}`);
}

if (failures) {
  process.stdout.write(`\n${failures} check(s) failed\n`);
  process.exit(1);
}
process.stdout.write("\nall checks passed\n");
