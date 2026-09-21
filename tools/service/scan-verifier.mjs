/**
 * Wiring Scan's verifier into a Core consumption.
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
 * ---------------------------------------------------------------------------
 */
import { createPublicKey } from "node:crypto";

import {
  canonicalCoreOrganizationEvidenceEnvelopeV1Bytes,
  parseScanAttestationEnvelopeV2Json,
  parseScanCandidateV2Json,
  projectVerifiedScanAttestationToCoreEvidenceEnvelopeV1,
  verifyScanAttestationV2,
} from "@aihq/scan";

import { fromB64, readJsonFile } from "./artifacts.mjs";

const FORBIDDEN_IN_MATERIAL = ["roots", "expected", "trust", "publicKey", "publicKeyPem"];

/**
 * @returns one of
 *   { refusal }                            - refuse before verifying
 *   { scan, trustSource, signerKeyId }     - the adapter and request for Core
 *   { scan: undefined, trustSource }       - no scan material was supplied
 */
export function buildScanVerification({ scanMaterialPath, operatorTrustPath, now }) {
  if (scanMaterialPath === undefined || scanMaterialPath === null) {
    return { scan: undefined, trustSource: "Not supplied" };
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

  return {
    trustSource: operatorTrustPath,
    signerKeyId: operatorTrust.roots[0].keyId,
    scan: {
      adapter: {
        verifyScanAttestationV2,
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
        annexArtifacts: material.annexArtifacts.map((annex) => ({
          descriptorId: annex.descriptorId,
          bytes: fromB64(annex.base64),
        })),
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
