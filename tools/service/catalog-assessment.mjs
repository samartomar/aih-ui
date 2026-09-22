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
 * publishes, so it is the only field compared. Exactly one match is required:
 * two entries claiming one identity is an ambiguity, not a choice for this
 * module to make.
 */
export function createCatalogAssessmentResolver() {
  return {
    readAssessment({ identityDigest }) {
      const { content, root } = readCatalog();
      const matches = content.entries.filter(
        (entry) =>
          entry.subject?.source?.type === "aih" && entry.subject.source.revision === identityDigest,
      );
      if (matches.length !== 1) return undefined;
      const entry = matches[0];
      if (entry.artifacts?.profile === undefined) return undefined;
      // A path Catalog refused to resolve is not the file anyone asked for.
      const path = artifactPath(root, entry.artifacts.profile);
      if (path === undefined) return undefined;
      return readFileSync(path);
    },
  };
}
