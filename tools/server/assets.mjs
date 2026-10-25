/**
 * Which files the preview copies where.
 *
 * The page is a tree of modules now, not two flat files, so nothing here
 * flattens a name: `src/catalog/cards.js` is served at `/catalog/cards.js`,
 * and `tools/service/*` lands at `service/*` inside the consumer. A flattened
 * copy would break every relative import and would silently drop one of two
 * files that happen to share a basename.
 *
 * The page assets are DISCOVERED by walking src/ rather than listed, so a new
 * module cannot be left out of the run directory. Missing runtime assets are a
 * blank page, so the entry points are asserted explicitly as well.
 */
import { readdirSync, statSync } from "node:fs";
import { join, posix } from "node:path";

/** Extensions the run directory serves. Anything else in src/ is not an asset. */
const SERVED = new Set([".html", ".js", ".css", ".json", ".svg"]);
/** The backend worker is ESM modules only. */
const SERVICE = new Set([".mjs"]);

/**
 * Authored sources under src/ that are inputs to generated modules, not pages. The V9 report shell
 * is embedded in src/report/template.js; served on its own it would show the design sample unlabelled.
 */
const NOT_SERVED = ["report/templates/"];

/** Entry points the page cannot start without. */
const REQUIRED_PAGE_ASSETS = ["index.html", "main.js"];

function walk(root, extensions, prefix = "", found = []) {
  for (const item of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const next = prefix ? posix.join(prefix, item.name) : item.name;
    if (item.isDirectory()) {
      walk(root, extensions, next, found);
      continue;
    }
    const dot = item.name.lastIndexOf(".");
    if (extensions === null || (dot > 0 && extensions.has(item.name.slice(dot)))) found.push(next);
  }
  return found;
}

/**
 * Every page asset, as { from (repo-relative), to (run-directory-relative) }.
 * The run-directory path is the source path with its `src/` prefix removed, so
 * the module tree the page imports is the module tree that is served.
 */
export function pageAssets(repoRoot) {
  const served = walk(join(repoRoot, "src"), SERVED).filter((relative) => !NOT_SERVED.some((prefix) => relative.startsWith(prefix)));
  for (const required of REQUIRED_PAGE_ASSETS) {
    if (!served.includes(required)) throw new Error(`src/${required} is missing from ${repoRoot}`);
  }
  return served.map((relative) => ({ from: posix.join("src", relative), to: relative }));
}

/**
 * The Workbench's own package-support declaration, its manifest (for its export map) and the fixtures it
 * exports, as the start-up contract check reads them inside the consumer (tools/service/contract-check.mjs).
 */
function workbenchSupport(repoRoot) {
  return [
    { from: "package.json", to: "workbench/package.json" },
    { from: "package-support-1.1.json", to: "workbench/package-support-1.1.json" },
    ...walk(join(repoRoot, "fixtures", "contracts"), new Set([".json"])).map(relative => ({
      from: posix.join("fixtures/contracts", relative), to: posix.join("workbench/fixtures/contracts", relative),
    })),
  ];
}

/** Every backend module, as { from, to } inside the consumer. */
export function serviceAssets(repoRoot) {
  const served = walk(join(repoRoot, "tools", "service"), SERVICE);
  if (!served.includes("core-service.mjs")) {
    throw new Error(`tools/service/core-service.mjs is missing from ${repoRoot}`);
  }
  return [...served.map((relative) => ({
    from: posix.join("tools/service", relative),
    to: posix.join("service", relative),
  })), ...walk(join(repoRoot, "tools", "consumer"), null).map(relative => ({
    from: posix.join("tools/consumer", relative), to: posix.join("consumer", relative),
  })), ...workbenchSupport(repoRoot)];
}

/** Fails before anything is built if a listed asset is not a readable file. */
export function assertReadable(repoRoot, assets) {
  for (const asset of assets) {
    try {
      if (!statSync(join(repoRoot, asset.from)).isFile()) throw new Error("not a file");
    } catch (error) {
      throw new Error(`asset ${asset.from} is missing from ${repoRoot}: ${error.message}`);
    }
  }
}
