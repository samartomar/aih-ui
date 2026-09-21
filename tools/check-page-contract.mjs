#!/usr/bin/env node
/*
 * Two offline regressions for the Sources & Catalogs preview, runnable without a package
 * install or a running server:
 *
 *   node tools/check-page-contract.mjs
 *
 * 1. Every element id the page modules collect exists in src/index.html, exactly once. A
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

// The required set is DERIVED from the modules rather than restated here. A
// hardcoded copy drifts: the page grows an element, the list does not, and the
// check keeps passing while the page is broken.
const MODULES = ["catalog.js", "governance.js"];
const required = new Set();
for (const module of MODULES) {
  const source = readFileSync(join(REPO_ROOT, "src", module), "utf8");
  // ids collected in bulk: `const ids = [ "a", "b", ... ];`
  for (const block of source.matchAll(/const ids = \[([\s\S]*?)\];/g)) {
    for (const literal of block[1].matchAll(/"([a-z0-9-]+)"/g)) required.add(literal[1]);
  }
  // and ids looked up one at a time
  for (const lookup of source.matchAll(/getElementById\("([^"]+)"\)/g)) required.add(lookup[1]);
}
check("the page modules collect at least one id", required.size > 0, "found none");

const missing = [...required].filter((id) => !ids.includes(id));
check(
  `index.html carries every id the page collects (${required.size} checked)`,
  missing.length === 0,
  missing.join(", "),
);
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
