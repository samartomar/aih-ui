/**
 * Wiring Scan's verifier into a Core consumption, and reading what it verified.
 *
 * Core never imports Scan: it accepts an injected adapter plus an operator's
 * own request. This module builds that adapter out of the installed @aihq/scan
 * package's public exports and the operator's own trust file.
 *
 * ---------------------------------------------------------------------------
 * THE TRUST BOUNDARY
 *
 * `roots` and `expected` come from the operator's own configuration file and
 * are NEVER read from the imported material. If the party supplying the
 * evidence also supplies the key that validates it, nothing has been verified -
 * so material carrying any of roots, expected, trust, publicKey or publicKeyPem
 * is refused outright, before any verification is attempted.
 *
 * WHAT THE RESULT RECORD IS AND IS NOT
 *
 * `readScanResultRecordV1` accepts only a value `verifyScanAttestationV2`
 * produced - a structurally identical literal is refused - so the facts below
 * are the ones Scan verified. They are PRESENTATION FACTS:
 *
 * - they never establish that a detector actually ran. `signer.class` says
 *   "organization" for an ephemeral test key too, and `run.state` is a claim
 *   the attestation carries. Only the operator's own `evidenceProvenance`
 *   declaration can speak to a real detector run.
 * - `readScanResultSubjectBindingV1` returns the digest of the SOURCE TREE that
 *   was scanned. It does not establish that the selected Catalog item was in
 *   that scan. Core's own source-seal and selected-file binding remain the only
 *   thing that establishes that, and they are reported separately.
 * - the record's own `gaps` name what the attestation does not state. They are
 *   passed through verbatim rather than summarised away.
 * ---------------------------------------------------------------------------
 */
import { createPublicKey } from "node:crypto";

import {
  canonicalCoreOrganizationEvidenceEnvelopeV1Bytes,
  SCAN_RESULT_RECORD_FORMAT_V1,
  SCAN_RESULT_RECORD_VERSION_V1,
  parseScanAttestationEnvelopeV2Json,
  parseScanCandidateV2Json,
  projectVerifiedScanAttestationToCoreEvidenceEnvelopeV1,
  readScanResultRecordV1,
  readScanResultSubjectBindingV1,
  verifyScanAttestationV2,
} from "@aihq/scan";

import { fromB64, readJsonFile } from "./artifacts.mjs";

const FORBIDDEN_IN_MATERIAL = ["roots", "expected", "trust", "publicKey", "publicKeyPem"];

/**
 * Normalizes one verified attestation into the facts the page may show.
 *
 * Every field is labelled by what states it: `declared` for what the
 * attestation asserts, `gaps` for what it does not.
 */
function presentationFacts(verified, annexArtifacts, envelopeBytes) {
  const binding = readScanResultSubjectBindingV1({ verified });
  const read = readScanResultRecordV1({ verified, annexArtifacts, envelopeBytes });
  const scannedTree =
    binding.status === "bound"
      ? {
          status: binding.status,
          subjectName: binding.subjectName,
          subjectSha256: binding.subjectSha256,
          // Said at the seam, so no caller has to remember it.
          covers:
            "the digest of the source tree that was scanned. It does not establish that the " +
            "selected catalog item was part of that scan - only Core's source-seal and " +
            "selected-file binding do.",
        }
      : { status: binding.status };

  if (read.status !== "available") {
    return {
      recordStatus: read.status,
      reason: read.reason ?? null,
      scannedTree,
    };
  }

  const result = read.result;
  return {
    recordStatus: "available",
    format: result.format,
    version: result.version,
    formatExpected: `${SCAN_RESULT_RECORD_FORMAT_V1} v${SCAN_RESULT_RECORD_VERSION_V1}`,
    scannedTree,
    signer: result.signer,
    claims: result.claims,
    coreContract: result.coreContract,
    // Declared by the attestation, not observed by anyone here.
    declaredRunState: result.run.state,
    declaredProvenance: result.run.provenance,
    platform: result.platform,
    coverage: result.coverage,
    detector: {
      id: result.detector.id,
      analyzerIdentity: result.detector.analyzerIdentity,
      adapterCapability: result.detector.adapterCapability,
      sourceSealV1: result.detector.sourceSealV1,
      observationCoverage: result.detector.observationCoverage,
    },
    observationCount: result.observations.length,
    findingCount: result.findings.length,
    // Occurrence fingerprint and multiplicity are ALL a finding record carries.
    // Message, location and severity are not in the attestation; the gaps below
    // say so, and nothing here invents them.
    findings: result.findings.map((finding) => ({
      rawOccurrenceFingerprint: finding.rawOccurrenceFingerprint,
      multiplicity: finding.multiplicity,
    })),
    sarifState: result.evidenceBindings.sarifState,
    annexes: result.annexes.map((annex) => ({
      descriptorId: annex.descriptorId,
      sha256: annex.sha256,
      byteLength: annex.byteLength,
      state: annex.state,
    })),
    gaps: result.gaps.map((gap) => ({ kind: gap.kind, detail: gap.detail })),
  };
}

/**
 * @returns one of
 *   { refusal }                            - refuse before verifying
 *   { scan, trustSource, signerKeyId, facts } - the adapter and request for Core
 *   { scan: undefined, trustSource }       - no scan material was supplied
 *
 * `facts()` returns the presentation facts for whatever Core verified, or null
 * when Core never called the verifier.
 */
export function buildScanVerification({ scanMaterialPath, operatorTrustPath, now }) {
  if (scanMaterialPath === undefined || scanMaterialPath === null) {
    return { scan: undefined, trustSource: "Not supplied", facts: () => null };
  }
  if (operatorTrustPath === undefined || operatorTrustPath === null) {
    return {
      refusal: {
        reopened: true,
        scanTrustMissing: true,
        reason:
          "Scan material was imported but no operator trust configuration was supplied. " +
          "Verification needs roots you configure yourself; the material may not supply them.",
      },
    };
  }

  const material = readJsonFile(scanMaterialPath);
  for (const forbidden of FORBIDDEN_IN_MATERIAL) {
    if (Object.hasOwn(material, forbidden)) {
      return {
        refusal: {
          reopened: true,
          materialCarriesTrust: forbidden,
          reason:
            `The imported material carries "${forbidden}". Material that supplies its own ` +
            "verifier configuration is refused: it would be validating itself.",
        },
      };
    }
  }

  const operatorTrust = readJsonFile(operatorTrustPath);
  if (!Array.isArray(operatorTrust.roots) || operatorTrust.roots.length === 0) {
    return {
      refusal: {
        reopened: true,
        scanTrustMissing: true,
        reason: "The operator trust configuration declares no roots.",
      },
    };
  }

  const annexArtifacts = material.annexArtifacts.map((annex) => ({
    descriptorId: annex.descriptorId,
    bytes: fromB64(annex.base64),
  }));
  // The canonical envelope TEXT that was transported. Passing it back makes the
  // reader check the bytes against the attestation it verified.
  const envelopeBytes = Buffer.from(material.envelopeJson, "utf8");

  // Core calls this; we hand back exactly what Scan returned, keeping the value
  // Scan branded, and keep a reference so the verified facts can be read after.
  let verified = null;
  const captureVerified = (request) => {
    const value = verifyScanAttestationV2(request);
    verified = value;
    return value;
  };

  // The operator's own declaration about what their signer represents. This is
  // the ONLY thing that can say whether a detector ran: neither Core nor Scan
  // can, because a signature proves who signed, never that anything was
  // measured. Absent means absent - nothing is inferred in its place.
  const root = operatorTrust.roots[0];
  const operatorProvenance = {
    evidenceProvenance: root.evidenceProvenance ?? null,
    provenanceLabel: root.provenanceLabel ?? null,
    signerIdentity: root.identity ?? null,
    signerClass: root.class ?? null,
    declaredBy: operatorTrustPath,
  };

  return {
    trustSource: operatorTrustPath,
    signerKeyId: operatorTrust.roots[0].keyId,
    operatorProvenance,
    facts: () => (verified === null ? null : presentationFacts(verified, annexArtifacts, envelopeBytes)),
    scan: {
      adapter: {
        verifyScanAttestationV2: captureVerified,
        projectVerifiedScanAttestationToCoreEvidenceEnvelopeV1,
        // Core states only that it passes `unknown`; narrow at our own seam.
        canonicalCoreOrganizationEvidenceEnvelopeV1Bytes: (value) =>
          canonicalCoreOrganizationEvidenceEnvelopeV1Bytes(value),
      },
      request: {
        // Re-parsed from canonical TEXT. A JSON clone destroys the custody
        // Scan requires and verification would fail for the wrong reason.
        envelope: parseScanAttestationEnvelopeV2Json(material.envelopeJson),
        candidate: parseScanCandidateV2Json(material.candidateJson),
        annexArtifacts,
        roots: operatorTrust.roots.map((rootEntry) => ({
          identity: rootEntry.identity,
          class: rootEntry.class,
          keyId: rootEntry.keyId,
          publicKey: createPublicKey(rootEntry.publicKeyPem),
        })),
        expected: { ...operatorTrust.expected, now },
      },
    },
  };
}
