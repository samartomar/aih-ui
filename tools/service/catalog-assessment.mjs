/**
 * The installed @aihq/catalog's published assessment artifact, supplied to Core
 * as the optional `assessment` resolver.
 *
 * The UI only supplies the published artifact bytes for the identity Core
 * derived from the saved subject. Core hashes whatever comes back and refuses
 * on mismatch; Core alone decides the route and the binding. Nothing here
 * proves anything: no digest is computed, no declaration is parsed, and no
 * entry is invented. A lookup that does not land on exactly one `aih` entry, or
 * that entry publishes no profile, supplies nothing at all and Core names the
 * refusal.
 */
import { readFileSync } from "node:fs";

import { artifactPath, readCatalog } from "./catalog-access.mjs";

/**
 * A resolver keyed by the identity digest Core derived from the saved subject.
 *
 * `subject.source.revision` is the `sha256:<hex>` string the `aih` source type
 * publishes, so it is the only field compared. Several releases may publish the
 * same artifact under one identity; they are one match when their published
 * profile digests agree (a comparison of published strings, nothing computed
 * here). Disagreement, or no match at all, is an ambiguity this module does not
 * resolve: it supplies nothing and Core names the refusal.
 */
export function createCatalogAssessmentResolver() {
  return {
    readAssessment({ identityDigest }) {
      const { content, root } = readCatalog();
      const matches = content.entries.filter(
        (entry) =>
          entry.subject?.source?.type === "aih" && entry.subject.source.revision === identityDigest,
      );
      const digests = new Set(
        matches
          .map((entry) => entry.artifacts?.profile?.sha256)
          .filter((value) => typeof value === "string"),
      );
      if (matches.length === 0 || digests.size !== 1) return undefined;
      const entry = matches[0];
      if (entry.artifacts?.profile === undefined) return undefined;
      // A path Catalog refused to resolve is not the file anyone asked for.
      const path = artifactPath(root, entry.artifacts.profile);
      if (path === undefined) return undefined;
      return readFileSync(path);
    },
  };
}
