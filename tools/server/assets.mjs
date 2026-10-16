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

/** Entry points the page cannot start without. */
const REQUIRED_PAGE_ASSETS = ["index.html", "main.js", "batch.html", "batch.js", "app/batch-view.js"];

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
  const served = walk(join(repoRoot, "src"), SERVED);
  for (const required of REQUIRED_PAGE_ASSETS) {
    if (!served.includes(required)) throw new Error(`src/${required} is missing from ${repoRoot}`);
  }
  return served.map((relative) => ({ from: posix.join("src", relative), to: relative }));
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
  }))];
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
