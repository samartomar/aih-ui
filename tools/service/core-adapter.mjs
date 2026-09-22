/**
 * The Core operations, called through @aihq/core's public exports.
 *
 * This module CALLS Core. It never reproduces it: no digest is computed here,
 * no document is compiled here, no verdict is decided here. Every value it
 * returns came out of a published Core function, and a refusal is passed
 * through as Core stated it.
 */
import { join } from "node:path";

import {
  consumeGovernanceInputV1,
  governanceDecisionSourceDigestV2,
  governanceDecisionSubjectDigestV2,
  organizationEvidenceEnvelopeDigestV1,
  parseGovernanceInputV1Bytes,
  parseOrganizationEvidenceEnvelopeV1Bytes,
  prepareGovernanceInputV1,
} from "@aihq/core";

import {
  b64,
  copyExactTree,
  fromB64,
  readExactBytes,
  recreateDirectory,
  writeExactBytes,
} from "./artifacts.mjs";
import { catalogEntry } from "./catalog-access.mjs";
import { createCatalogAssessmentResolver } from "./catalog-assessment.mjs";
import { buildScanVerification } from "./scan-verifier.mjs";

/**
 * Core derives both digests from the source the catalog published. The index's
 * own digest copies are cross-checked and any disagreement is REPORTED, never
 * silently resolved in favour of one side - the index carries no signature, so
 * its copies authenticate nothing.
 */
export function deriveSubject(entry) {
  const sourceDigest = governanceDecisionSourceDigestV2(entry.subject.source);
  const subjectDigest = governanceDecisionSubjectDigestV2({
    kind: entry.subject.kind,
    id: entry.subject.id,
    sourceDigest,
  });
  return {
    sourceDigest,
    subjectDigest,
    indexAgrees:
      entry.subject.sourceDigest === sourceDigest && entry.subject.subjectDigest === subjectDigest,
    indexSourceDigest: entry.subject.sourceDigest ?? null,
    indexSubjectDigest: entry.subject.subjectDigest ?? null,
  };
}

/**
 * Catalog-provided identity plus the digests Core derives from it.
 *
 * Catalog's integrity result is a DIFFERENT answer from a different owner and
 * is not folded in here: it has its own operation, so nothing can read one as
 * though it covered the other.
 */
export function subject({ entryId, contentDir, entry }) {
  const derived = deriveSubject(entry);
  return {
    entryId,
    kind: entry.subject.kind,
    id: entry.subject.id,
    source: entry.subject.source,
    ...derived,
    // Whether real content ships for this entry decides whether a scan route
    // can be exercised at all. Say so rather than failing later.
    contentAvailable: contentDir !== undefined,
    artifacts: entry.artifacts ?? null,
  };
}

/**
 * Parse operator-imported evidence bytes through Core's public parser. The
 * bytes are accepted or refused exactly as saved; nothing is normalised.
 */
export function parseEvidence({ evidenceBase64 }) {
  const bytes = fromB64(evidenceBase64);
  const envelope = parseOrganizationEvidenceEnvelopeV1Bytes(bytes);
  if (envelope === undefined) {
    return {
      parsed: false,
      reason:
        "Not canonical aih-organization-evidence v1 bytes. The file must be exactly the " +
        "canonical envelope as produced - a re-serialized or pretty-printed copy is refused.",
      byteLength: bytes.byteLength,
    };
  }
  return {
    parsed: true,
    byteLength: bytes.byteLength,
    digest: organizationEvidenceEnvelopeDigestV1(envelope),
    subjectDigest: envelope.subjectDigest,
    evidenceKind: envelope.evidence.kind,
    evidenceId: envelope.evidence.id,
    summary: envelope.evidence.summary,
    attestor: envelope.attestor,
    issuedAt: envelope.issuedAt,
    notBefore: envelope.notBefore,
    expiresAt: envelope.expiresAt,
    // What the envelope CLAIMS to be. A claim is not a verification: only
    // consumption, with configured trust, can verify a scan attestation.
    claimsScanEvidence: envelope.evidence.kind === "scan-attestation-v2",
  };
}

/**
 * Compile and save. Pure in Core: no filesystem, no network, no authority.
 * The bytes Core returns are written unchanged into the session directory.
 */
export function prepare({ entryId, route, target, effect, decisionId, decisionDigest, evidenceBase64, sessionDir, bindingClaim }) {
  const { entry } = catalogEntry(entryId);
  const derived = deriveSubject(entry);
  const request = () => ({
    route,
    subject: { kind: entry.subject.kind, id: entry.subject.id, source: entry.subject.source },
    request: { target, effect },
    decisionReference: { id: decisionId, digest: decisionDigest },
    evidenceBytes: fromB64(evidenceBase64),
    ...(bindingClaim === undefined || bindingClaim === null ? {} : { bindingClaim }),
    provenance: { catalogEntryId: entryId },
  });

  const prepared = prepareGovernanceInputV1(request());
  if (prepared.artifacts === undefined) {
    return { prepared: false, status: prepared.status, diagnostics: prepared.diagnostics };
  }

  // Determinism is part of the contract: the same selections must produce
  // byte-identical artifacts. Prove it here rather than asserting it.
  const again = prepareGovernanceInputV1(request());
  const deterministic =
    again.artifacts !== undefined &&
    Buffer.from(prepared.artifacts.input.bytes).equals(Buffer.from(again.artifacts.input.bytes));

  writeExactBytes(join(sessionDir, "governance-input.json"), prepared.artifacts.input.bytes);
  writeExactBytes(join(sessionDir, "organization-evidence.json"), prepared.artifacts.evidence.bytes);

  return {
    prepared: true,
    status: prepared.status,
    diagnostics: prepared.diagnostics,
    deterministic,
    derivedSubjectDigest: derived.subjectDigest,
    indexAgrees: derived.indexAgrees,
    input: {
      savedAs: "governance-input.json",
      rootRelativePath: prepared.artifacts.input.path,
      digest: prepared.artifacts.input.digest,
      byteLength: prepared.artifacts.input.bytes.byteLength,
      base64: b64(prepared.artifacts.input.bytes),
    },
    evidence: {
      savedAs: "organization-evidence.json",
      rootRelativePath: prepared.artifacts.evidence.path,
      digest: prepared.artifacts.evidence.digest,
      byteLength: prepared.artifacts.evidence.bytes.byteLength,
      base64: b64(prepared.artifacts.evidence.bytes),
    },
  };
}

/**
 * The name the observation manifest is placed under inside the consumption
 * root. It sits at the root, beside the evidence path the document names and
 * outside the install root, because Core refuses an install root that overlaps
 * either of them.
 */
const OBSERVATION_MANIFEST_PATH = "manifest.json";

/**
 * Places the operator's observation inputs in the consumption root so Core can
 * read them, and returns the request Core is given.
 *
 * Copying is all that happens: the manifest and each file go in byte for byte,
 * at the exact paths the operator's own selection named. Nothing is installed,
 * applied or executed, nothing is written outside this session's root, and no
 * path, digest or decision is derived here - Core checks the files one to one
 * against the verified scan and answers.
 */
function placeObservation(root, observation) {
  if (observation === undefined || observation === null) return undefined;
  writeExactBytes(
    join(root, OBSERVATION_MANIFEST_PATH),
    readExactBytes(join(observation.dir, "manifest.json")),
  );
  copyExactTree(join(observation.dir, "files"), join(root, ...observation.installRoot.split("/")));
  return { manifestPath: OBSERVATION_MANIFEST_PATH, installRoot: observation.installRoot };
}

/**
 * Reopen the saved bytes from disk and consume them independently: parse, then
 * re-derive the whole verdict. Nothing from the preparation step is carried
 * over - that is what makes this independent.
 */
export async function consume({
  sessionDir,
  authorityBundlePath,
  scanMaterialPath,
  operatorTrustPath,
  observation,
}) {
  const savedBytes = readExactBytes(join(sessionDir, "governance-input.json"));

  // Reopen: the saved document must still be canonical, or it was altered.
  const reopened = parseGovernanceInputV1Bytes(savedBytes);
  if (reopened === undefined) {
    return {
      reopened: false,
      reason:
        "The saved document no longer parses as canonical aih-governance-input v1 bytes. " +
        "It was altered, re-serialized, or truncated after it was written.",
    };
  }

  // The evidence file must sit under the consumption root at the path the
  // saved document names. Consumption re-reads it from there.
  //
  // The root is rebuilt from nothing on every consume, so it holds exactly the
  // inputs this session has now: an observation the operator replaced leaves no
  // file behind from the one before it.
  const root = join(sessionDir, "consume-root");
  recreateDirectory(root);
  writeExactBytes(
    join(root, reopened.evidence.path),
    readExactBytes(join(sessionDir, "organization-evidence.json")),
  );
  const observationRequest = placeObservation(root, observation);

  const now = new Date().toISOString();
  const verification = buildScanVerification({ scanMaterialPath, operatorTrustPath, now });
  if (verification.refusal !== undefined) return verification.refusal;

  // Authority is an operator-controlled file OUTSIDE the consumption root.
  // Absent means absent: Core refuses, and the page says "Not supplied".
  const env = {};
  if (authorityBundlePath !== undefined && authorityBundlePath !== null) {
    env.AIH_ORG_POLICY = authorityBundlePath;
  }

  const result = await consumeGovernanceInputV1({
    bytes: savedBytes,
    root,
    env,
    now,
    ...(verification.scan === undefined ? {} : { scan: verification.scan }),
    // The resolver is supplied only when the saved document carries no
    // selected-file binding claim. A saved claim means the authoring
    // application bound through a scanned file (the validation fixture seals
    // the Catalog artifact directory) and Core recomputes that on its
    // subject-content route. A document without a claim asks Core to prove the
    // published assessment declares the scanned material. Core verifies
    // everything on either route.
    ...(reopened.bindingClaim === undefined ? { assessment: createCatalogAssessmentResolver() } : {}),
    // Supplied only when the operator supplied one. Without it Core reports
    // that there was no observation source for the effect; with it, Core reads
    // the manifest and the named files and decides. Either way nothing runs.
    ...(observationRequest === undefined ? {} : { observation: observationRequest }),
  });

  return {
    reopened: true,
    // Six axes, reported separately. Never collapsed, never one implying another.
    structure: result.status.structure,
    evidence: result.status.evidence,
    binding: result.status.binding,
    authority: result.status.authority,
    plan: result.status.plan,
    execution: result.status.execution,
    outcome: result.status.outcome,
    reason: result.status.reason ?? null,
    evidenceClaim: result.evidenceClaim ?? null,
    matchedPath: result.matchedPath ?? null,
    bindingRoute: result.bindingRoute ?? null,
    assessmentBinding: result.assessmentBinding ?? null,
    assessmentSource:
      reopened.bindingClaim === undefined
        ? "installed @aihq/catalog, looked up by the saved subject's identity digest"
        : null,
    observation: result.observation ?? null,
    authorityTransport: result.authorityTransport ?? null,
    subjectDigest: result.subjectDigest ?? null,
    decisionDigest: result.decisionDigest ?? null,
    evidenceDigest: result.evidenceDigest ?? null,
    diagnostics: result.diagnostics,
    // Provenance of the inputs, so the page can label honestly.
    authoritySource: authorityBundlePath ?? "Not supplied",
    trustSource: verification.trustSource,
    // Read after the verification Core performed, so it names the key that
    // actually signed rather than a configured root.
    signerKeyId: verification.signerKeyId(),
    scanMaterialSupplied: scanMaterialPath !== undefined && scanMaterialPath !== null,
    // Scan's own reading of what Scan verified, available only once Core has
    // actually called the verifier. It is presentation detail beside the six
    // axes above, never a substitute for any of them.
    scanResult: verification.facts(),
    // The operator's declaration about their own signer: the only statement
    // that can speak to a real detector run, attributed to the trust entry
    // belonging to the signer that actually signed.
    operatorProvenance: verification.operatorProvenance(),
  };
}
