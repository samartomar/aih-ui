/**
 * The installed @aihq/catalog, reached only through its published export map.
 *
 * @aihq/catalog exports `./catalog-index.json` and nothing for entry content.
 * The index itself publishes every artifact's package-root-relative path, so
 * the root is derived from where the export map placed the index and the
 * relationship is CHECKED. A failure here is reported, never worked around by
 * guessing an internal directory.
 *
 * GAP FOR @aihq/catalog: no export covers entry content.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const INDEX_AT = "defaults/catalog-index-v1.json";

export function catalogRoot() {
  const indexPath = fileURLToPath(import.meta.resolve("@aihq/catalog/catalog-index.json"));
  const posix = indexPath.replaceAll("\\", "/");
  if (!posix.endsWith(`/${INDEX_AT}`)) {
    throw new Error(
      `@aihq/catalog/catalog-index.json resolved to ${indexPath}, which is not at ${INDEX_AT} ` +
        "inside the package. The package root cannot be derived; @aihq/catalog must export a " +
        "content subpath.",
    );
  }
  return { indexPath, root: posix.slice(0, posix.length - INDEX_AT.length - 1) };
}

export function catalogEntry(entryId) {
  const { indexPath, root } = catalogRoot();
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  const entry = index.entries.find((candidate) => candidate.entryId === entryId);
  if (entry === undefined) throw new Error(`catalog entry ${entryId} is not in the published index`);
  return { entry, index, root };
}

/** The entry's content directory, derived from a path the INDEX publishes. */
export function entryContentDir(entry, root) {
  const profilePath = entry.artifacts?.profile?.path;
  if (typeof profilePath !== "string") return undefined;
  const dir = join(root, profilePath, "..", "..");
  try {
    return statSync(dir).isDirectory() ? dir : undefined;
  } catch {
    return undefined;
  }
}
