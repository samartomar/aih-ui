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
 *   declaration can speak to a real detector run, and only the declaration
 *   belonging to the signer that actually signed.
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
 * Finds the configured trust entry belonging to the signer that actually
 * signed, and attributes only that entry's declaration.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT `roots[0]`
 *
 * A trust file may configure several roots with different provenance: one an
 * organisation's real detector signing key, another a test fixture key. Reading
 * the declaration off the first root attributes whichever entry happens to be
 * listed first, so reordering the file silently changes what the page claims
 * about evidence that did not change. That is a false statement about
 * provenance, which is the one thing this pane exists to get right.
 *
 * The signer comes from Scan's verified result - `readScanResultRecordV1` only
 * accepts a value `verifyScanAttestationV2` produced - and is matched to a
 * configured root on keyId, then checked on identity and class. Anything that
 * is not exactly one match is reported as unattributed with the reason:
 *
 * - no verified signer      verification did not complete, so nothing signed;
 * - no matching root        the signer is not one the operator configured;
 * - several matching roots  the file is ambiguous about this key;
 * - mismatched identity     the configured entry describes a different signer.
 *
 * In none of those cases is a configured root presented as a verified signer.
 * ---------------------------------------------------------------------------
 */
function attributeSigner(signer, roots) {
  if (signer === null || signer === undefined || typeof signer.keyId !== "string") {
    return {
      attributed: false,
      reason:
        "No verified signer: the attestation was not verified, so nothing here is attributed " +
        "to any configured trust entry.",
    };
  }
  const matches = roots.filter((root) => root.keyId === signer.keyId);
  if (matches.length === 0) {
    return {
      attributed: false,
      signer,
      reason:
        `The verified signer ${signer.keyId} is not one of the configured roots, so no ` +
        "operator declaration applies to it.",
    };
  }
  if (matches.length > 1) {
    return {
      attributed: false,
      signer,
      reason:
        `The trust configuration lists ${matches.length} roots for ${signer.keyId}. An ` +
        "ambiguous configuration is not resolved by picking one of them.",
    };
  }
  const root = matches[0];
  if (
    (root.identity !== undefined && root.identity !== signer.identity) ||
    (root.class !== undefined && root.class !== signer.class)
  ) {
    return {
      attributed: false,
      signer,
      reason:
        `The configured root for ${signer.keyId} describes ${root.identity ?? "no identity"} / ` +
        `${root.class ?? "no class"}, but the verified signer is ${signer.identity} / ` +
        `${signer.class}. A configured entry that disagrees with what was verified is not used.`,
    };
  }
  return { attributed: true, signer, root };
}

/**
 * Normalizes one verified attestation into the facts the page may show.
 *
 * Every field is labelled by what states it: `declared` for what the
 * attestation asserts, `gaps` for what it does not.
 */
function presentationFacts(verified, annexArtifacts, envelopeBytes, roots) {
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
      // Nothing was read, so nothing is attributed to any configured root.
      attribution: attributeSigner(null, roots),
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
    // Which configured trust entry this signer is, if exactly one of them is.
    attribution: attributeSigner(result.signer, roots),
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
    return {
      scan: undefined,
      trustSource: "Not supplied",
      facts: () => null,
      signerKeyId: () => null,
      operatorProvenance: () => null,
    };
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

  /**
   * The operator's own declaration about what their signer represents.
   *
   * This is the ONLY thing that can say whether a detector ran: neither Core
   * nor Scan can, because a signature proves who signed, never that anything
   * was measured. It is read from the trust entry belonging to the signer that
   * actually signed - never from whichever root is listed first - and when that
   * entry cannot be identified, the answer is the reason why, not a guess.
   */
  const operatorProvenance = () => {
    const attribution = verified === null
      ? attributeSigner(null, operatorTrust.roots)
      : presentationFacts(verified, annexArtifacts, envelopeBytes, operatorTrust.roots).attribution;
    if (attribution.attributed !== true) {
      return {
        attributed: false,
        evidenceProvenance: null,
        provenanceLabel: null,
        signerIdentity: attribution.signer?.identity ?? null,
        signerClass: attribution.signer?.class ?? null,
        signerKeyId: attribution.signer?.keyId ?? null,
        reason: attribution.reason,
        declaredBy: operatorTrustPath,
      };
    }
    const { root, signer } = attribution;
    return {
      attributed: true,
      evidenceProvenance: root.evidenceProvenance ?? null,
      provenanceLabel: root.provenanceLabel ?? null,
      // The VERIFIED signer, not the configured description of one.
      signerIdentity: signer.identity,
      signerClass: signer.class,
      signerKeyId: signer.keyId,
      declaredBy: operatorTrustPath,
    };
  };

  return {
    trustSource: operatorTrustPath,
    // Only ever the key that verification actually used.
    signerKeyId: () => {
      if (verified === null) return null;
      const facts = presentationFacts(verified, annexArtifacts, envelopeBytes, operatorTrust.roots);
      return facts.signer?.keyId ?? null;
    },
    operatorProvenance,
    facts: () =>
      verified === null
        ? null
        : presentationFacts(verified, annexArtifacts, envelopeBytes, operatorTrust.roots),
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
