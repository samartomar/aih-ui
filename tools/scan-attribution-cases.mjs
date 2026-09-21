/*
 * The attribution cases themselves. Copied into the throwaway consumer by
 * tools/check-scan-attribution.mjs and run from there, so `@aihq/scan` and the
 * service under test both resolve through installed packages.
 *
 * The scenario is the one that makes the bug visible: TWO trusted keys with
 * DIFFERENT operator declarations. Reading the declaration off `roots[0]` gives
 * the right answer by luck when the signing key happens to be listed first, so
 * every case here signs with the SECOND key and then reorders the roots.
 *
 * Operator declarations stay distinct from measured execution throughout: what
 * is asserted below is which declaration applies to the verified signer, never
 * that a detector ran.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  canonicalScanAttestationEnvelopeBytesV2,
  canonicalScanCandidateBytesV2,
  ed25519KeyIdV2,
  sealSourceV2,
} from "@aihq/scan";

import { buildSignedFixture } from "./service/fixture-candidate.mjs";
import { buildScanVerification } from "./service/scan-verifier.mjs";

let failures = 0;
function check(description, condition, detail = "") {
  if (condition) {
    process.stdout.write(`ok   ${description}\n`);
  } else {
    failures += 1;
    process.stdout.write(`FAIL ${description}${detail ? `: ${detail}` : ""}\n`);
  }
}

const workspace = mkdtempSync(join(tmpdir(), "attribution-cases-"));

/* ------------------------------------------------------------- the keys --- */

/** Two trusted signers, each with its own operator declaration. */
function makeSigner(identity, signerClass, evidenceProvenance, provenanceLabel) {
  const keyPair = generateKeyPairSync("ed25519");
  const keyId = ed25519KeyIdV2(keyPair.publicKey);
  return {
    keyPair,
    keyId,
    identity,
    class: signerClass,
    root: {
      identity,
      class: signerClass,
      keyId,
      publicKeyPem: keyPair.publicKey.export({ type: "spki", format: "pem" }),
      evidenceProvenance,
      provenanceLabel,
    },
  };
}

// The first one is a real detector signer; the second is a test fixture key.
// Attributing roots[0] would claim a detector ran when the fixture key signed.
const first = makeSigner("organization.detector", "organization", "detector-executed", "Detector executed on a CI runner");
const second = makeSigner("organization.scanner", "organization", "signed-test-fixture", "Signed test fixture — no detector executed");

/* -------------------------------------------------- the signed material --- */

// A real seal over a real directory, so the candidate is well formed.
const sourceRoot = join(workspace, "source");
mkdirSync(sourceRoot, { recursive: true });
writeFileSync(join(sourceRoot, "profile.json"), '{"probe":true}\n');
const seal = sealSourceV2({ sourceRoot, selectedClosurePaths: ["profile.json"] });

const nowMs = Date.now();
const signedAt = new Date(nowMs - 60_000).toISOString();
const expiresAt = new Date(nowMs + 23 * 60 * 60 * 1000).toISOString();
const annexArtifacts = [
  { descriptorId: "annex.cisco-raw", bytes: Buffer.from("raw", "utf8") },
  { descriptorId: "annex.provenance", bytes: Buffer.from("provenance", "utf8") },
  { descriptorId: "annex.sbom", bytes: Buffer.from("sbom", "utf8") },
];

// SIGNED WITH THE SECOND KEY.
const built = buildSignedFixture({
  seal,
  annexArtifacts,
  keyPair: second.keyPair,
  keyId: second.keyId,
  signedAt,
  expiresAt,
});

const materialPath = join(workspace, "attestation-material.json");
writeFileSync(
  materialPath,
  JSON.stringify(
    {
      envelopeJson: Buffer.from(canonicalScanAttestationEnvelopeBytesV2(built.envelope)).toString("utf8"),
      candidateJson: Buffer.from(canonicalScanCandidateBytesV2(built.candidate)).toString("utf8"),
      annexArtifacts: annexArtifacts.map((annex) => ({
        descriptorId: annex.descriptorId,
        base64: Buffer.from(annex.bytes).toString("base64"),
      })),
    },
    null,
    1,
  ),
);

// `buildSignedFixture` derives the signer description from the key it signs
// with, so this is the identity Scan will report as verified.
const verifiedSigner = built.signer;

let trustCounter = 0;
function writeTrust(roots) {
  trustCounter += 1;
  const path = join(workspace, `operator-trust-${trustCounter}.json`);
  writeFileSync(
    path,
    JSON.stringify(
      { roots, expected: { ...built.claims, subjectSha256: built.candidate.subject.digest.sha256, signer: verifiedSigner } },
      null,
      1,
    ),
  );
  return path;
}

/**
 * Runs one consumption the way Core does: build the verification, call the
 * injected verifier with the request, then read what the seam attributes.
 */
function consumeWith(operatorTrustPath, { tamper = false } = {}) {
  const verification = buildScanVerification({
    scanMaterialPath: materialPath,
    operatorTrustPath,
    now: new Date().toISOString(),
  });
  if (verification.refusal !== undefined) return { refusal: verification.refusal };
  let verifyFailed = null;
  if (!tamper) {
    // This is exactly what Core does with the adapter it was handed. Scan
    // THROWS when the signer is not one of the configured roots; Core turns
    // that into a refusal, and either way nothing was verified.
    try {
      verification.scan.adapter.verifyScanAttestationV2(verification.scan.request);
    } catch (error) {
      verifyFailed = error.message;
    }
  }
  return {
    verifyFailed,
    provenance: verification.operatorProvenance(),
    signerKeyId: verification.signerKeyId(),
    facts: verification.facts(),
  };
}

/* ------------------------------------------------------------- the cases --- */

process.stdout.write("\n-- signed with the second key --\n");

// 1. roots in the order [first, second]: roots[0] is NOT the signer.
const ordered = consumeWith(writeTrust([first.root, second.root]));
check(
  "the verified signer is the key that signed, not roots[0]",
  ordered.signerKeyId === second.keyId,
  `got ${ordered.signerKeyId}, expected ${second.keyId}`,
);
check(
  "the declaration is the signing key's, not roots[0]'s",
  ordered.provenance.attributed === true && ordered.provenance.evidenceProvenance === "signed-test-fixture",
  JSON.stringify(ordered.provenance),
);
check(
  "roots[0]'s declaration is not attributed to it",
  ordered.provenance.provenanceLabel !== first.root.provenanceLabel,
  `leaked ${ordered.provenance.provenanceLabel}`,
);
check(
  "the attributed signer identity comes from the verified result",
  ordered.provenance.signerIdentity === verifiedSigner.identity,
  `${ordered.provenance.signerIdentity} vs ${verifiedSigner.identity}`,
);

// 2. the same trust file with the roots REORDERED must not change the answer.
const reordered = consumeWith(writeTrust([second.root, first.root]));
check(
  "reordering the roots does not change the attributed key",
  reordered.signerKeyId === ordered.signerKeyId,
  `${reordered.signerKeyId} vs ${ordered.signerKeyId}`,
);
check(
  "reordering the roots does not change the declaration",
  reordered.provenance.evidenceProvenance === ordered.provenance.evidenceProvenance &&
    reordered.provenance.provenanceLabel === ordered.provenance.provenanceLabel,
  `${JSON.stringify(reordered.provenance)} vs ${JSON.stringify(ordered.provenance)}`,
);

process.stdout.write("\n-- configurations that must not be resolved by guessing --\n");

// 3. the signer is not configured at all: another trusted key, but not this
//    one. Scan refuses the attestation, so nothing may be attributed.
const stranger = consumeWith(writeTrust([first.root]));
check(
  "an unconfigured signer fails verification",
  typeof stranger.verifyFailed === "string",
  `verification did not fail: ${stranger.verifyFailed}`,
);
check(
  "an unconfigured signer is not attributed",
  stranger.provenance.attributed === false,
  JSON.stringify(stranger.provenance),
);
check(
  "an unconfigured signer does not borrow a configured declaration",
  stranger.provenance.evidenceProvenance === null && stranger.provenance.provenanceLabel === null,
  JSON.stringify(stranger.provenance),
);
check(
  "the reason names why nothing was attributed",
  typeof stranger.provenance.reason === "string" && stranger.provenance.reason.length > 0,
  JSON.stringify(stranger.provenance),
);

// 4. the same keyId listed twice, with different declarations. Scan refuses a
//    trust list that repeats a root, so verification never yields a signer;
//    the seam's own ambiguity check below is a second line of defence.
const ambiguousRoot = { ...second.root, evidenceProvenance: "detector-executed", provenanceLabel: "A second claim about the same key" };
const ambiguous = consumeWith(writeTrust([second.root, ambiguousRoot]));
check(
  "a duplicated root is not resolved by picking one of them",
  ambiguous.provenance.attributed === false,
  JSON.stringify(ambiguous.provenance),
);
check(
  "an ambiguous configuration yields no declaration",
  ambiguous.provenance.evidenceProvenance === null && ambiguous.provenance.provenanceLabel === null,
  JSON.stringify(ambiguous.provenance),
);

// 4b. the same keyId under two different identities. Whether Scan accepts the
//     list or refuses it, one key described two ways is never attributed to
//     either description.
const twoIdentities = consumeWith(
  writeTrust([{ ...second.root, identity: "organization.other", evidenceProvenance: "detector-executed", provenanceLabel: "A different claim" }, second.root]),
);
check(
  "one keyId described two ways is not attributed",
  twoIdentities.provenance.attributed === false,
  JSON.stringify(twoIdentities.provenance),
);
check(
  "when that list verifies, the reason names the ambiguity",
  twoIdentities.verifyFailed !== null || /roots for/i.test(twoIdentities.provenance.reason ?? ""),
  `verifyFailed=${twoIdentities.verifyFailed} reason=${twoIdentities.provenance.reason}`,
);

// 5. a configured entry that describes a different identity for the same key.
const mislabelled = { ...second.root, identity: "organization.someone-else" };
const disagreeing = consumeWith(writeTrust([first.root, mislabelled]));
check(
  "a configured entry that disagrees with the verified signer is not used",
  disagreeing.provenance.attributed === false,
  JSON.stringify(disagreeing.provenance),
);
check(
  "a disagreeing entry yields no declaration either",
  disagreeing.provenance.evidenceProvenance === null && disagreeing.provenance.provenanceLabel === null,
  JSON.stringify(disagreeing.provenance),
);

process.stdout.write("\n-- verification that never happened --\n");

// 6. Core never called the verifier: nothing signed, so nothing is attributed
//    and no configured root may be presented as a verified signer.
const unverified = consumeWith(writeTrust([second.root, first.root]), { tamper: true });
check(
  "without verification there is no verified signer",
  unverified.signerKeyId === null,
  `got ${unverified.signerKeyId}`,
);
check(
  "without verification nothing is attributed",
  unverified.provenance.attributed === false && unverified.provenance.evidenceProvenance === null,
  JSON.stringify(unverified.provenance),
);
check(
  "without verification no scan facts are presented",
  unverified.facts === null,
  JSON.stringify(unverified.facts),
);

process.stdout.write("\n-- declarations stay distinct from measured execution --\n");

// The attributed declaration is an operator statement. It never becomes a
// statement that a detector ran: the facts carry the attestation's own claims,
// and they are labelled as declared.
check(
  "the attributed declaration is separate from the attestation's run state",
  ordered.facts.declaredRunState !== undefined &&
    ordered.facts.declaredRunState !== ordered.provenance.evidenceProvenance,
  `${ordered.facts.declaredRunState} / ${ordered.provenance.evidenceProvenance}`,
);
check(
  "the scan facts report the same verified signer that was attributed",
  ordered.facts.signer.keyId === ordered.provenance.signerKeyId,
  `${ordered.facts.signer.keyId} vs ${ordered.provenance.signerKeyId}`,
);
check(
  "the scan result still names what it does not state",
  Array.isArray(ordered.facts.gaps) && ordered.facts.gaps.length > 0,
  JSON.stringify(ordered.facts.gaps),
);

if (failures) {
  process.stdout.write(`\n${failures} check(s) failed\n`);
  process.exit(1);
}
process.stdout.write("\nall attribution checks passed\n");
