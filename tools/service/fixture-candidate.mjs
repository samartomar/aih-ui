/**
 * VALIDATION FIXTURE ONLY.
 *
 * Assembles a ScanCandidateV2 and signs it with a key generated on the spot.
 * NO DETECTOR RUNS HERE. Nothing in the result is a measurement: the
 * observation set is empty, the detector identities are derived from constant
 * strings, and the signer is ephemeral.
 *
 * What IS real when this is used: the installed @aihq/scan package, its
 * signature verification, the source seal taken over the actual installed
 * @aihq/catalog content, the subject binding, and the evidence reprojection.
 * That is cryptographic integration - it is never evidence that a scanner ran.
 *
 * This module is copied into the throwaway consumer next to core-service.mjs
 * and imported from there, so its @aihq/scan import resolves to the installed
 * tarball like every other import in that consumer.
 */
import { createHash } from "node:crypto";
import {
  AI_HARNESS_DECISION_V2_SCHEMA_SHA256,
  AI_HARNESS_STRICT_V2_COMMIT,
  createScanCandidateV2,
  signScanCandidateV2,
} from "@aihq/scan";

const sha = (value) => createHash("sha256").update(value).digest("hex");

// Code-unit canonical JSON, byte-identical to Scan's canonicalStrictJsonBytesV1.
// Scan recomputes each identity below from these exact bytes, so they are
// derived here rather than declared - a declared digest would simply be refused.
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => cmp(a, b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * @param seal           a real SourceSealV2 over installed catalog content
 * @param annexArtifacts the three annex byte blobs, already chosen
 * @param keyPair        an ephemeral ed25519 pair; never a real signing key
 */
export function buildSignedFixture({ seal, annexArtifacts, keyPair, keyId, signedAt, expiresAt }) {
  const detector = {
    adapterCapability: "cisco-oci-v1",
    detectorId: "detector.cisco",
    analyzerIdentity: "native.0123456789ab",
    oci: {
      logicalReference: `local.invalid/scanner@sha256:${sha("manifest")}`,
      manifestDigestSha256: `sha256:${sha("manifest")}`,
      configDigestSha256: `sha256:${sha("config")}`,
    },
    adapter: { identity: "adapter.0123456789ab", sha256: sha("adapter") },
    observationConfigurationSha256: sha("configuration"),
    executionProfileSha256: sha("execution"),
    supportedPlatform: { os: "linux", architecture: "amd64" },
    sbom: {
      mediaType: "application/spdx+json",
      sha256: sha(annexArtifacts[2].bytes),
      state: "digest-bound-unverified",
    },
    provenance: {
      mediaType: "application/vnd.in-toto+json",
      sha256: sha(annexArtifacts[1].bytes),
      state: "digest-bound-unverified",
    },
    scannerManifestEntrySha256: sha("manifest-entry"),
  };

  const sourceSealV1 = {
    protocol: "SourceSealV1",
    sourceTreeSha256: sha("v1-source"),
    selectedClosureSha256: sha("v1-closure"),
    sealedSnapshotSha256: sha("v1-snapshot"),
  };
  // An empty observation set: nothing was measured, and the fixture says so
  // rather than inventing findings.
  const rawFacts = [{ rawOccurrenceFingerprint: `raw-occurrence-v1:${sha("fact")}`, multiplicity: 1 }];
  const rawCoverage = [
    { coverageKind: "selected-closure", coverageSha256: sourceSealV1.selectedClosureSha256 },
  ];
  const relevantFactsSha256 = sha(
    stableJson({ domain: "aih.cisco.oci-candidate.relevant-facts-v1", sourceSeal: sourceSealV1 }),
  );
  const detectorPlatform = { os: "linux", architecture: "amd64", relevantFactsSha256 };
  const observation = { keySha256: sha("observation-key"), setSha256: sha("observation-set") };
  detector.sourceSealV1 = sourceSealV1;
  detector.platform = detectorPlatform;
  detector.observation = { ...observation, facts: rawFacts, coverage: rawCoverage };
  detector.broker = {
    identity: "broker.0123456789ab",
    sarifSha256: sha("sarif"),
    enforcementState: "unverified",
    policyDigestSha256: sha(
      stableJson({
        domain: "aih.cisco.oci-candidate.broker-binding-v1",
        brokerIdentity: "broker.0123456789ab",
        scannerManifestEntrySha256: detector.scannerManifestEntrySha256,
        sarifSha256: sha("sarif"),
      }),
    ),
    appliedFactsSha256: sha(
      stableJson({
        domain: "aih.cisco.oci-candidate.applied-facts-v1",
        facts: rawFacts,
        coverage: rawCoverage,
      }),
    ),
  };

  // Scanner-manifest identities, derived exactly as Scan derives them.
  const manifestDetectorInput = {
    detectorId: detector.detectorId,
    analyzerIdentity: detector.analyzerIdentity,
    ociImage: {
      reference: detector.oci.logicalReference,
      sha256: detector.oci.manifestDigestSha256.slice("sha256:".length),
    },
    adapter: detector.adapter,
    observationConfigurationSha256: detector.observationConfigurationSha256,
    executionProfileSha256: detector.executionProfileSha256,
    supportedPlatforms: [detector.supportedPlatform],
    sbom: { mediaType: detector.sbom.mediaType, sha256: detector.sbom.sha256 },
    provenance: { mediaType: detector.provenance.mediaType, sha256: detector.provenance.sha256 },
  };
  const manifestEntry = {
    ...manifestDetectorInput,
    scannerManifestEntrySha256: sha(
      stableJson({ domain: "aih.scanner-manifest-v1.entry", entry: manifestDetectorInput }),
    ),
  };
  detector.scannerManifestEntrySha256 = manifestEntry.scannerManifestEntrySha256;
  detector.broker.policyDigestSha256 = sha(
    stableJson({
      domain: "aih.cisco.oci-candidate.broker-binding-v1",
      brokerIdentity: "broker.0123456789ab",
      scannerManifestEntrySha256: detector.scannerManifestEntrySha256,
      sarifSha256: sha("sarif"),
    }),
  );

  const observationKeyInput = {
    protocol: "ObservationKeyV1",
    sourceSeal: sourceSealV1,
    nativeAnalyzerIdentity: detector.analyzerIdentity,
    observationConfigurationSha256: detector.observationConfigurationSha256,
    platform: detectorPlatform,
    scannerManifestEntrySha256: detector.scannerManifestEntrySha256,
  };
  const observationKeySha256 = sha(
    stableJson({ domain: "aih.observation-key-v1", key: observationKeyInput }),
  );
  const observationSetSha256 = sha(
    stableJson({
      domain: "aih.observation-set-v1",
      observationKeySha256,
      facts: rawFacts,
      coverage: rawCoverage,
    }),
  );
  observation.keySha256 = observationKeySha256;
  observation.setSha256 = observationSetSha256;
  detector.observation.keySha256 = observationKeySha256;
  detector.observation.setSha256 = observationSetSha256;

  const scannerManifestSha256 = sha(
    stableJson({
      domain: "aih.scanner-manifest-v1.aggregate",
      protocol: "ScannerManifestV1",
      detectors: [manifestEntry],
    }),
  );
  const runtimeSha256 = sha(
    stableJson({ domain: "aih.cisco.capture-v2.runtime", detector: manifestEntry }),
  );

  const candidate = createScanCandidateV2({
    protocol: "ScanCandidateV2",
    coreContract: {
      commit: AI_HARNESS_STRICT_V2_COMMIT,
      decisionSchemaSha256: AI_HARNESS_DECISION_V2_SCHEMA_SHA256,
    },
    subject: { name: "source-tree", digest: { sha256: seal.sourceTreeSha256 } },
    sourceSeals: { before: seal, after: seal },
    observation,
    scanner: {
      manifestSha256: scannerManifestSha256,
      runtimeSha256,
      configurationSha256: detector.observationConfigurationSha256,
      detector,
    },
    platform: { os: "linux", architecture: "amd64" },
    coverage: { kind: "selected-closure", sha256: seal.selectedClosureSha256, complete: true },
    annexes: annexArtifacts.map(({ descriptorId, bytes }) => ({
      descriptorId,
      sha256: sha(bytes),
      byteLength: bytes.byteLength,
    })),
    cleanup: { outcome: "completed" },
    scan: { outcome: "succeeded" },
  });

  const claims = {
    repository: "aihq/scan",
    workflow: ".github/workflows/evidence.yml",
    issuer: "https://token.actions.githubusercontent.com",
    sourceRef: "refs/heads/main",
    commit: AI_HARNESS_STRICT_V2_COMMIT,
    environment: "production",
    runId: "123",
    runAttempt: 1,
    signedAt,
    expiresAt,
  };
  const signer = { identity: "organization.scanner", class: "organization", keyId };
  const envelope = signScanCandidateV2({
    candidate,
    signer: { ...signer, privateKey: keyPair.privateKey },
    claims,
    annexArtifacts,
  });

  return { candidate, envelope, signer, claims };
}
