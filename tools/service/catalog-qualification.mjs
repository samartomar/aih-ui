/**
 * The installed @aihq/catalog's publisher qualification, read through Catalog's
 * own qualification reader.
 *
 * Catalog ships the signed Catalog V2 head it was cut from, its public signer
 * root and one Qualification Receipt per member, located by a sidecar
 * (`@aihq/catalog/catalog-qualification.json`). `readCatalogQualificationV1`
 * re-verifies the shipped head against the shipped root, hashes and parses
 * every receipt, and states each entry's qualification at the instant it is
 * given. Nothing here decides a state, repairs a refusal or fills a gap: the
 * reader's words are served as it returned them, with the instant they hold at.
 *
 * Publisher qualification is not organizational authorization. A `qualified`
 * entry is one this publisher's signed catalog carries with this identity
 * inside this window; it admits nothing, installs nothing and confers no
 * effect authority.
 *
 * A Catalog that predates the export is not an error: it is reported as
 * absent, and the page says the installed Catalog publishes no sidecar.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as catalog from "@aihq/catalog";

import { catalogRoot, readCatalog } from "./catalog-access.mjs";

/** The reader's canonical instant: whole seconds, UTC. */
function instant(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function catalogQualification({ now = new Date() } = {}) {
  const {
    readCatalogQualificationV1,
    resolveCatalogQualificationPathV1,
    CATALOG_QUALIFICATION_SUBPATH_V1,
  } = catalog;
  if (
    typeof readCatalogQualificationV1 !== "function" ||
    typeof resolveCatalogQualificationPathV1 !== "function" ||
    typeof CATALOG_QUALIFICATION_SUBPATH_V1 !== "string"
  ) {
    return { qualification: null, absent: "the installed @aihq/catalog does not export readCatalogQualificationV1" };
  }
  const specifier = `@aihq/catalog${CATALOG_QUALIFICATION_SUBPATH_V1.slice(1)}`;
  const { content } = readCatalog();
  const { root } = catalogRoot();
  const evaluatedAt = instant(now);
  const view = readCatalogQualificationV1({
    bytes: readFileSync(fileURLToPath(import.meta.resolve(specifier))),
    index: content,
    now: evaluatedAt,
    input: {
      root,
      verifyReceipts: true,
      verifySignature: true,
      readFile: ({ path }) => {
        const resolved = resolveCatalogQualificationPathV1(root, path);
        if (resolved === undefined) return undefined;
        try {
          return readFileSync(resolved);
        } catch {
          // Genuinely absent. The reader reports it; nothing is substituted.
          return undefined;
        }
      },
    },
  });
  if (view === undefined) {
    throw new Error(
      `the installed ${specifier} was refused by readCatalogQualificationV1: unknown format or ` +
        "version, non-canonical bytes, a malformed head identity, signer root, publisher or " +
        "entry, claims that do not name the publisher, or an entry that is not that exact index entry.",
    );
  }
  // Plain data, exactly as the reader returned it, plus the instant it holds at.
  return {
    qualification: {
      specifier,
      digest: view.digest,
      evaluatedAt,
      organizationAdmission: view.organizationAdmission,
      issuedAt: view.issuedAt,
      signature: view.signature,
      attestation: view.attestation,
      catalog: {
        catalogHeadDigest: view.catalog.catalogHeadDigest,
        sequence: view.catalog.sequence,
        signerIdentity: view.catalog.signerIdentity,
        validFrom: view.catalog.validFrom,
        validUntil: view.catalog.validUntil,
      },
      publisher: {
        repository: view.publisher.repository,
        workflow: view.publisher.workflow,
        ref: view.publisher.ref,
        requiredOperation: view.publisher.requiredOperation,
        locator: view.publisher.locator === null ? null : { ...view.publisher.locator },
      },
      coverage: { ...view.coverage },
      entries: view.entries.map((entry) => ({
        entryId: entry.entryId,
        subjectDigest: entry.subjectDigest,
        state: entry.state,
        notBefore: entry.notBefore,
        expiresAt: entry.expiresAt,
      })),
    },
  };
}
