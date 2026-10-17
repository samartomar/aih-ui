/**
 * The installed @aihq/catalog, read through Catalog's own published reader.
 *
 * Catalog owns its layout, its format and its parsing. Nothing here restates
 * any of it: the index location comes from `CATALOG_CONTENT_INDEX_ROOT_URL` and
 * `CATALOG_CONTENT_INDEX_SUBPATH_V1`, the bytes are validated by
 * `readCatalogContentV1`, and every descriptor path is joined by
 * `resolveCatalogContentPathV1`, which refuses a path that escapes the package
 * root. A refusal from that reader is reported, never repaired.
 *
 * WHAT "artifacts: verified" DOES AND DOES NOT COVER
 *
 * The reader verifies the four declared artifacts of each entry - closure,
 * profile, prose and recipe - against their declared sha256. It does NOT read
 * the qualification evidence files (report, findings, gaps, rights), which are
 * separate paths in the same index. Those are reported here as declared and
 * not byte-checked, so "artifacts: verified" is never shown as if it covered
 * all of an entry's qualification evidence.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  CATALOG_CONTENT_INDEX_ROOT_URL,
  CATALOG_CONTENT_INDEX_SUBPATH_V1,
  readCatalogContentV1,
  resolveCatalogContentPathV1,
} from "@aihq/catalog";

/** `@aihq/catalog/catalog-index.json`, built from the subpath Catalog publishes. */
const INDEX_SPECIFIER = `@aihq/catalog${CATALOG_CONTENT_INDEX_SUBPATH_V1.slice(1)}`;

/**
 * The package root, derived from where the export map placed the index.
 *
 * The relationship between the subpath export and the root-relative location is
 * published by Catalog, so this is a CHECK, not a guess: if the two stop
 * agreeing, that is reported rather than worked around.
 */
function catalogRoot() {
  const indexPath = fileURLToPath(import.meta.resolve(INDEX_SPECIFIER));
  const posix = indexPath.replaceAll("\\", "/");
  if (!posix.endsWith(`/${CATALOG_CONTENT_INDEX_ROOT_URL}`)) {
    throw new Error(
      `${INDEX_SPECIFIER} resolved to ${indexPath}, which is not at ` +
        `${CATALOG_CONTENT_INDEX_ROOT_URL} inside the package. The package root cannot be ` +
        "derived from what @aihq/catalog publishes.",
    );
  }
  return { indexPath, root: posix.slice(0, posix.length - CATALOG_CONTENT_INDEX_ROOT_URL.length - 1) };
}

/**
 * The published content index.
 *
 * @param verifyArtifacts when true, every declared artifact is read and checked
 *        against its sha256 by Catalog. Absent bytes are reported by the reader
 *        as `unverified`; this module never substitutes anything for them.
 */
export function readCatalog({ verifyArtifacts = false } = {}) {
  const { indexPath, root } = catalogRoot();
  const bytes = readFileSync(indexPath);
  const content = readCatalogContentV1({
    bytes,
    input: {
      root,
      verifyArtifacts,
      readArtifact: ({ path }) => {
        const resolved = resolveCatalogContentPathV1(root, path);
        if (resolved === undefined) return undefined;
        try {
          return readFileSync(resolved);
        } catch {
          // Genuinely absent. The reader reports it; we do not guess bytes.
          return undefined;
        }
      },
    },
  });
  if (content === undefined) {
    throw new Error(
      `the installed @aihq/catalog index at ${indexPath} was refused by readCatalogContentV1: ` +
        "unknown format or version, malformed, non-canonical or oversize bytes, a duplicate " +
        "entry identity, an unsafe declared path, or evidence not bound to its subject.",
    );
  }
  return { content, root, indexPath };
}

export function catalogEntry(entryId, options) {
  const { content, root, indexPath } = readCatalog(options);
  const entry = content.entries.find((candidate) => candidate.entryId === entryId);
  if (entry === undefined) throw new Error(`catalog entry ${entryId} is not in the published index`);
  return { entry, content, root, indexPath };
}

/** An entry's artifact, at an absolute path Catalog validated. */
export function artifactPath(root, artifact) {
  if (artifact === undefined) return undefined;
  return resolveCatalogContentPathV1(root, artifact.path);
}

/**
 * The directory holding one entry's artifacts.
 *
 * GAP: Catalog publishes artifact paths, not the directory that contains them,
 * so this last step is still read off a path rather than asked for. It is
 * derived from a path `resolveCatalogContentPathV1` has already validated, and
 * it is confined to this one function so there is a single place to change when
 * Catalog publishes an accessor for it.
 */
export function entryContentDir(entry, root) {
  const resolved = artifactPath(root, entry.artifacts?.profile);
  if (resolved === undefined) return undefined;
  const posix = resolved.replaceAll("\\", "/");
  const artifactsDir = posix.slice(0, posix.lastIndexOf("/"));
  const contentDir = artifactsDir.slice(0, artifactsDir.lastIndexOf("/"));
  return contentDir.length > 0 ? contentDir : undefined;
}

/**
 * Catalog's own integrity result for one entry, kept apart from every other
 * result the page shows.
 */
export function catalogIntegrity(content, entry) {
  const artifacts = Object.entries(entry.artifacts ?? {}).map(([name, artifact]) => ({
    name,
    state: artifact === undefined ? "absent" : artifact.state,
    path: artifact?.path ?? null,
  }));
  const qualification = entry.qualification ?? {};
  const evidenceFiles = [
    ...(qualification.report === undefined ? [] : [qualification.report]),
    ...(qualification.findings ?? []),
    ...(qualification.gaps ?? []),
    ...(qualification.rights ?? []),
  ];
  return {
    // Index-wide, exactly as Catalog states it.
    indexDigest: content.digest,
    indexStructure: content.status.structure,
    indexArtifacts: content.status.artifacts,
    package: content.package,
    organizationAdmission: content.organizationAdmission,
    // This entry's own artifacts.
    artifacts,
    artifactsVerified: artifacts.filter((item) => item.state === "verified").length,
    // Published evidence: declared in the index, NOT covered by the artifact
    // check above. Said plainly rather than folded into "verified".
    publishedEvidence: {
      declared: evidenceFiles.length,
      byteChecked: 0,
      note:
        "Declared in the index and bound to this subject. readCatalogContentV1 verifies the " +
        "four declared artifacts, not these qualification evidence files, so their bytes are " +
        "not checked here.",
      records: evidenceFiles.map((record) => ({
        kind: record.kind,
        id: record.id,
        format: record.format,
        attestor: record.attestor,
        path: record.path,
        sha256: record.sha256,
      })),
    },
  };
}
