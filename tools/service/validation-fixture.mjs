/**
 * VALIDATION MODE. Explicitly labelled, never the normal path.
 *
 * ---------------------------------------------------------------------------
 * Everything that manufactures something lives in this one file: the ephemeral
 * signing key, the assembled candidate, and the example authority bundle with
 * its example decision. No other module in this service generates a decision,
 * an approval, verifier trust or a key - when one of those is absent there, the
 * answer is "Not supplied" and a refusal.
 *
 * Real here: the installed @aihq/scan package, its signature verification, the
 * source seal over the actual installed @aihq/catalog content, the subject
 * binding and the exact evidence reprojection.
 *
 * Not real here: the scan itself. This assembles a candidate and signs it with
 * a key generated right here. NO DETECTOR RUNS. There are no measured findings
 * and no detector provenance, and the operator trust it writes declares exactly
 * that through `evidenceProvenance: "signed-test-fixture"`.
 * ---------------------------------------------------------------------------
 */
import { generateKeyPairSync } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { organizationEvidenceEnvelopeDigestV1, governanceDecisionDigestV2 } from "@aihq/core";
import {
  canonicalCoreOrganizationEvidenceEnvelopeV1Bytes,
  canonicalScanAttestationEnvelopeBytesV2,
  canonicalScanCandidateBytesV2,
  ed25519KeyIdV2,
  projectVerifiedScanAttestationToCoreEvidenceEnvelopeV1,
  sealSourceV2,
  verifyScanAttestationV2,
} from "@aihq/scan";

import { b64, writeJsonFile } from "./artifacts.mjs";
import { artifactPath, catalogEntry, entryContentDir } from "./catalog-access.mjs";
import { deriveSubject } from "./core-adapter.mjs";
import { buildSignedFixture } from "./fixture-candidate.mjs";

const LABEL = "Signed test fixture — no detector executed";

/** Every file under the entry's installed content directory, in sorted order. */
function closurePaths(contentDir) {
  const relative = [];
  (function walk(dir, prefix) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const next = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) walk(join(dir, item.name), next);
      else relative.push(next);
    }
  })(contentDir, "");
  relative.sort();
  return relative;
}

/**
 * The selected artifact, relative to the directory the seal was taken over.
 *
 * Derived from the absolute path Catalog validated, so the UI never re-splits a
 * published path string on its own assumptions about the layout.
 */
function matchedPathOf(root, entry, contentDir) {
  const resolved = artifactPath(root, entry.artifacts?.profile);
  if (resolved === undefined) {
    throw new Error(`@aihq/catalog publishes no profile artifact path for ${entry.entryId}`);
  }
  const posix = resolved.replaceAll("\\", "/");
  const prefix = `${contentDir.replaceAll("\\", "/")}/`;
  if (!posix.startsWith(prefix)) {
    throw new Error(`the profile artifact ${posix} is not inside the sealed directory ${prefix}`);
  }
  return posix.slice(prefix.length);
}

/** The example authority an operator would otherwise supply themselves. */
function exampleAuthority({ decision, target, issuedAt, expiresAt }) {
  return {
    schemaVersion: 2,
    bundleVersion: "1.0.0",
    issuer: "validation-example-issuer",
    issuedAt,
    policy: {
      schemaVersion: 2,
      minimumPosture: "enterprise",
      references: { repoContract: "validation-example" },
      governance: { supportedClis: [target] },
    },
    authorityReceipt: {
      format: "aih-policy-authority-receipt",
      version: 3,
      issuerRepository: "example-org/policy-authority",
      issuedAt,
      expiresAt,
      trustedIssuers: [
        { id: "validation-example-issuer", githubRepository: "example-org/policy-authority" },
      ],
      targets: [target],
      decisions: [decision],
      decisionRevocations: [],
    },
  };
}

export function buildValidationFixture({ entryId, sessionDir, target, effect }) {
  // The entry comes from Catalog's own reader, so its identity, artifact paths
  // and evidence records are the ones Catalog published and validated.
  const { entry, root } = catalogEntry(entryId);
  const contentDir = entryContentDir(entry, root);
  if (contentDir === undefined) {
    throw new Error(
      `the installed @aihq/catalog ships no content directory for ${entryId}, so no source ` +
        "seal can be taken over real content",
    );
  }
  const derived = deriveSubject(entry);

  // Scan caps attestation claims at 24 hours, so anchor to the real clock.
  const nowMs = Date.now();
  const signedAt = new Date(nowMs - 60_000).toISOString();
  const expiresAt = new Date(nowMs + 23 * 60 * 60 * 1000).toISOString();

  // --- seal the REAL installed catalog content -----------------------------
  const relative = closurePaths(contentDir);
  const seal = sealSourceV2({ sourceRoot: contentDir, selectedClosurePaths: relative });

  // --- assemble and sign a candidate (THIS is the synthetic part) ----------
  const keyPair = generateKeyPairSync("ed25519");
  const keyId = ed25519KeyIdV2(keyPair.publicKey);
  const annexArtifacts = [
    { descriptorId: "annex.cisco-raw", bytes: Buffer.from("raw", "utf8") },
    { descriptorId: "annex.provenance", bytes: Buffer.from("provenance", "utf8") },
    { descriptorId: "annex.sbom", bytes: Buffer.from("sbom", "utf8") },
  ];
  const { candidate, envelope, signer, claims } = buildSignedFixture({
    seal,
    annexArtifacts,
    keyPair,
    keyId,
    signedAt,
    expiresAt,
  });

  const operatorTrust = {
    // Written next to the session, NOT inside the material. The material
    // never carries roots, expected, trust, publicKey or publicKeyPem.
    roots: [
      {
        ...signer,
        publicKeyPem: keyPair.publicKey.export({ type: "spki", format: "pem" }),
        // The ONLY place that can say what this signer represents. Core and
        // Scan cannot: a signature proves who signed, never that a detector ran.
        evidenceProvenance: "signed-test-fixture",
        provenanceLabel: LABEL,
      },
    ],
    expected: { ...claims, subjectSha256: candidate.subject.digest.sha256, signer },
  };

  const verified = verifyScanAttestationV2({
    envelope,
    candidate,
    annexArtifacts,
    roots: [{ ...signer, publicKey: keyPair.publicKey }],
    expected: { ...operatorTrust.expected, now: new Date().toISOString() },
  });
  const projected = projectVerifiedScanAttestationToCoreEvidenceEnvelopeV1({
    verified,
    subjectDigest: derived.subjectDigest,
  });
  const evidenceBytes = canonicalCoreOrganizationEvidenceEnvelopeV1Bytes(projected);
  const evidenceDigest = organizationEvidenceEnvelopeDigestV1(projected);

  // --- operator-provided decision + authority (a VALIDATION EXAMPLE) -------
  const subject = {
    kind: entry.subject.kind,
    id: entry.subject.id,
    source: entry.subject.source,
    sourceDigest: derived.sourceDigest,
    subjectDigest: derived.subjectDigest,
  };
  const decision = {
    format: "aih-governance-decision",
    version: 2,
    id: `decision-${effect}-${entry.subject.id}`,
    disposition: "approved",
    qualificationBasis: {
      kind: "organization-qualified",
      evidenceDigest,
      attestor: projected.attestor,
    },
    subject,
    targets: [target],
    allowedEffects: [effect],
    policy: { id: "validation-example-policy", version: "1", digest: `sha256:${"e".repeat(64)}` },
    control: { id: "validation-example-control", digest: `sha256:${"f".repeat(64)}` },
    evidence: { id: projected.evidence.id, digest: evidenceDigest, attestor: projected.attestor },
    issuer: "validation-example-issuer",
    actor: "validation-example-operator",
    reason: "Validation example only. Operator-provided authority, not production approval.",
    issuedAt: signedAt,
    notBefore: signedAt,
    expiresAt,
    acceptedFindings: [],
    acceptedGaps: [],
    conditions: [],
  };
  const decisionDigest = governanceDecisionDigestV2(decision);

  const authorityBundlePath = join(sessionDir, "operator", "authority-bundle.json");
  writeJsonFile(authorityBundlePath, exampleAuthority({ decision, target, issuedAt: signedAt, expiresAt }));

  // Material carries canonical TEXT only - re-parsed on the consuming side.
  // It deliberately carries no roots/expected: trust travels separately.
  const materialPath = join(sessionDir, "attestation-material.json");
  writeJsonFile(materialPath, {
    envelopeJson: Buffer.from(canonicalScanAttestationEnvelopeBytesV2(envelope)).toString("utf8"),
    candidateJson: Buffer.from(canonicalScanCandidateBytesV2(candidate)).toString("utf8"),
    annexArtifacts: annexArtifacts.map((annex) => ({
      descriptorId: annex.descriptorId,
      base64: b64(annex.bytes),
    })),
  });

  const operatorTrustPath = join(sessionDir, "operator", "operator-trust.json");
  writeJsonFile(operatorTrustPath, operatorTrust);

  return {
    fixture: true,
    label: LABEL,
    detectorExecuted: false,
    note:
      "A verified signature authenticates the statement. It does not establish that the " +
      "claimed measurements occurred.",
    evidenceBase64: b64(evidenceBytes),
    evidenceDigest,
    decisionId: decision.id,
    decisionDigest,
    keyId,
    sealedFileCount: relative.length,
    sealedFrom: contentDir,
    bindingClaim: {
      // The seal was taken over the entry's content directory, so the matched
      // path is this artifact relative to that directory. Both come from the
      // path Catalog published and resolveCatalogContentPathV1 validated.
      matchedPath: matchedPathOf(root, entry, contentDir),
      selectedClosureSha256: seal.selectedClosureSha256,
      sourceTreeSha256: seal.sourceTreeSha256,
    },
    authorityBundlePath,
    scanMaterialPath: materialPath,
    operatorTrustPath,
  };
}
