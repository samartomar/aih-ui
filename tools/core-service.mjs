/**
 * Backend worker for the Policy Workbench preview.
 *
 * This file is COPIED INTO the throwaway consumer that `tools/preview.mjs`
 * creates, and is run from there. Every import below is a bare specifier
 * resolved through that consumer's installed packages: no `npm link`, no
 * sibling checkout, no `dist/` deep import, no source fallback. If a name is
 * not a public export of the installed tarball, this file fails to load - which
 * is the point.
 *
 * Protocol: one JSON request on stdin, one JSON response on stdout.
 *   { "op": "...", ... }  ->  { "ok": true, ... } | { "ok": false, "error": "..." }
 *
 * Node-only APIs (filesystem, crypto, package resolution) live here and nowhere
 * near the browser. The page never sees a filesystem path it did not supply.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SERVICE WILL NOT DO
 *
 * It does not manufacture decisions, approvals, verifier trust or signing keys
 * for the normal flow. Those are operator inputs. When one is absent the answer
 * is "Not supplied" and a refusal, never a generated stand-in.
 *
 * The single exception is `op: "fixture"`, the explicitly labelled validation
 * mode. It generates an ephemeral key and signs a candidate it assembled
 * itself. That exercises the plumbing and is NOT evidence that any detector
 * ran. Its output is labelled at every surface it touches.
 * ---------------------------------------------------------------------------
 */
import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalOrganizationEvidenceEnvelopeV1,
  consumeGovernanceInputV1,
  governanceDecisionDigestV2,
  governanceDecisionSourceDigestV2,
  governanceDecisionSubjectDigestV2,
  organizationEvidenceEnvelopeDigestV1,
  parseGovernanceInputV1Bytes,
  parseOrganizationEvidenceEnvelopeV1Bytes,
  prepareGovernanceInputV1,
} from "@aihq/core";
import {
  canonicalCoreOrganizationEvidenceEnvelopeV1Bytes,
  canonicalScanAttestationEnvelopeBytesV2,
  canonicalScanCandidateBytesV2,
  ed25519KeyIdV2,
  parseScanAttestationEnvelopeV2Json,
  parseScanCandidateV2Json,
  projectVerifiedScanAttestationToCoreEvidenceEnvelopeV1,
  sealSourceV2,
  verifyScanAttestationV2,
} from "@aihq/scan";
// Copied into the consumer alongside this file. Validation fixture only.
import { buildSignedFixture } from "./fixture-candidate.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const fromB64 = (text) => Buffer.from(text, "base64");

function write(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  // Buffer.from over the bytes Core returned. Never JSON.stringify: the parser
  // requires the exact canonical bytes and refuses a re-serialization.
  writeFileSync(path, Buffer.from(bytes));
}

/* ------------------------------------------------------------- catalog access */

/**
 * The installed catalog, reached only through its published export map.
 *
 * @aihq/catalog exports `./catalog-index.json` and nothing for entry content.
 * The index itself publishes every artifact's package-root-relative path, so
 * the root is derived from where the export map placed the index and the
 * relationship is CHECKED. A failure here is reported, never worked around by
 * guessing an internal directory.
 */
const INDEX_AT = "defaults/catalog-index-v1.json";

function catalogRoot() {
  const indexPath = fileURLToPath(import.meta.resolve("@aihq/catalog/catalog-index.json"));
  const posix = indexPath.replaceAll("\\", "/");
  if (!posix.endsWith(`/${INDEX_AT}`)) {
    throw new Error(
      `@aihq/catalog/catalog-index.json resolved to ${indexPath}, which is not at ${INDEX_AT} ` +
        "inside the package. The package root cannot be derived; @aihq/catalog must export a " +
        "content subpath.",
    );
  }
  return { indexPath, root: posix.slice(0, posix.length - INDEX_AT.length - 1) };
}

function catalogEntry(entryId) {
  const { indexPath, root } = catalogRoot();
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  const entry = index.entries.find((candidate) => candidate.entryId === entryId);
  if (entry === undefined) throw new Error(`catalog entry ${entryId} is not in the published index`);
  return { entry, index, root };
}

/** The entry's content directory, derived from a path the INDEX publishes. */
function entryContentDir(entry, root) {
  const profilePath = entry.artifacts?.profile?.path;
  if (typeof profilePath !== "string") return undefined;
  const dir = join(root, profilePath, "..", "..");
  try {
    return statSync(dir).isDirectory() ? dir : undefined;
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------ operations */

/**
 * Core derives both digests from the source the catalog published. The index's
 * own digest copies are cross-checked and any disagreement is REPORTED, never
 * silently resolved in favour of one side - the index carries no signature, so
 * its copies authenticate nothing.
 */
function deriveSubject(entry) {
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

const OPS = {
  /** Catalog-provided identity plus the digests Core derives from it. */
  subject({ entryId }) {
    const { entry, root } = catalogEntry(entryId);
    const derived = deriveSubject(entry);
    const contentDir = entryContentDir(entry, root);
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
  },

  /**
   * Parse operator-imported evidence bytes through Core's public parser. The
   * bytes are accepted or refused exactly as saved; nothing is normalised.
   */
  parseEvidence({ evidenceBase64 }) {
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
  },

  /**
   * Compile and save. Pure in Core: no filesystem, no network, no authority.
   * The bytes Core returns are written unchanged into the session directory.
   */
  prepare({ entryId, route, target, effect, decisionId, decisionDigest, evidenceBase64, sessionDir, bindingClaim }) {
    const { entry } = catalogEntry(entryId);
    const derived = deriveSubject(entry);
    const prepared = prepareGovernanceInputV1({
      route,
      subject: { kind: entry.subject.kind, id: entry.subject.id, source: entry.subject.source },
      request: { target, effect },
      decisionReference: { id: decisionId, digest: decisionDigest },
      evidenceBytes: fromB64(evidenceBase64),
      ...(bindingClaim === undefined || bindingClaim === null ? {} : { bindingClaim }),
      provenance: { catalogEntryId: entryId },
    });
    if (prepared.artifacts === undefined) {
      return { prepared: false, status: prepared.status, diagnostics: prepared.diagnostics };
    }

    // Determinism is part of the contract: the same selections must produce
    // byte-identical artifacts. Prove it here rather than asserting it.
    const again = prepareGovernanceInputV1({
      route,
      subject: { kind: entry.subject.kind, id: entry.subject.id, source: entry.subject.source },
      request: { target, effect },
      decisionReference: { id: decisionId, digest: decisionDigest },
      evidenceBytes: fromB64(evidenceBase64),
      ...(bindingClaim === undefined || bindingClaim === null ? {} : { bindingClaim }),
      provenance: { catalogEntryId: entryId },
    });
    const deterministic =
      again.artifacts !== undefined &&
      Buffer.from(prepared.artifacts.input.bytes).equals(Buffer.from(again.artifacts.input.bytes));

    const inputPath = join(sessionDir, "governance-input.json");
    const evidencePath = join(sessionDir, "organization-evidence.json");
    write(inputPath, prepared.artifacts.input.bytes);
    write(evidencePath, prepared.artifacts.evidence.bytes);

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
  },

  /**
   * Reopen the saved bytes from disk and consume them independently: parse,
   * then re-derive the whole verdict. Nothing from the preparation step is
   * carried over - that is what makes this independent.
   */
  async consume({ sessionDir, authorityBundlePath, scanMaterialPath, operatorTrustPath }) {
    const savedBytes = readFileSync(join(sessionDir, "governance-input.json"));

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
    const root = join(sessionDir, "consume-root");
    const evidenceTarget = join(root, reopened.evidence.path);
    write(evidenceTarget, readFileSync(join(sessionDir, "organization-evidence.json")));

    const now = new Date().toISOString();

    // --- Scan adapter wiring, only when material AND trust are both present.
    //
    // `roots` and `expected` are the security boundary. They come from the
    // operator's own configuration file and are NEVER read from the imported
    // material: if the party supplying the evidence also supplies the key that
    // validates it, nothing has been verified.
    let scan;
    let signerKeyId;
    let trustSource = "Not supplied";
    if (scanMaterialPath !== undefined && scanMaterialPath !== null) {
      if (operatorTrustPath === undefined || operatorTrustPath === null) {
        return {
          reopened: true,
          scanTrustMissing: true,
          reason:
            "Scan material was imported but no operator trust configuration was supplied. " +
            "Verification needs roots you configure yourself; the material may not supply them.",
        };
      }
      const material = JSON.parse(readFileSync(scanMaterialPath, "utf8"));
      for (const forbidden of ["roots", "expected", "trust", "publicKey", "publicKeyPem"]) {
        if (Object.hasOwn(material, forbidden)) {
          return {
            reopened: true,
            materialCarriesTrust: forbidden,
            reason:
              `The imported material carries "${forbidden}". Material that supplies its own ` +
              "verifier configuration is refused: it would be validating itself.",
          };
        }
      }
      const operatorTrust = JSON.parse(readFileSync(operatorTrustPath, "utf8"));
      if (!Array.isArray(operatorTrust.roots) || operatorTrust.roots.length === 0) {
        return {
          reopened: true,
          scanTrustMissing: true,
          reason: "The operator trust configuration declares no roots.",
        };
      }
      trustSource = operatorTrustPath;
      signerKeyId = operatorTrust.roots[0].keyId;
      scan = {
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
      };
    }

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
      ...(scan === undefined ? {} : { scan }),
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
      authorityTransport: result.authorityTransport ?? null,
      subjectDigest: result.subjectDigest ?? null,
      decisionDigest: result.decisionDigest ?? null,
      evidenceDigest: result.evidenceDigest ?? null,
      diagnostics: result.diagnostics,
      // Provenance of the inputs, so the page can label honestly.
      authoritySource: authorityBundlePath ?? "Not supplied",
      trustSource,
      signerKeyId: signerKeyId ?? null,
      scanMaterialSupplied: scanMaterialPath !== undefined && scanMaterialPath !== null,
    };
  },

  /**
   * VALIDATION FIXTURE. Explicitly labelled, never the normal path.
   *
   * Real: the installed @aihq/scan package, its signature verification, the
   * source seal over the actual installed @aihq/catalog content, the subject
   * binding and the exact evidence reprojection.
   *
   * Not real: the scan itself. This assembles a candidate and signs it with an
   * ephemeral key generated right here. NO DETECTOR RUNS. There are no measured
   * findings and no detector provenance, and the operator trust it writes
   * declares exactly that via `evidenceProvenance: "signed-test-fixture"`.
   */
  fixture({ entryId, sessionDir, target, effect }) {
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

    // --- seal the REAL installed catalog content ---------------------------
    const relative = [];
    (function walk(dir, prefix) {
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        const next = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.isDirectory()) walk(join(dir, item.name), next);
        else relative.push(next);
      }
    })(contentDir, "");
    relative.sort();
    const seal = sealSourceV2({ sourceRoot: contentDir, selectedClosurePaths: relative });

    // --- assemble and sign a candidate (THIS is the synthetic part) --------
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
          provenanceLabel: "Signed test fixture — no detector executed",
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

    // --- operator-provided decision + authority (a VALIDATION EXAMPLE) -----
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
    write(
      authorityBundlePath,
      Buffer.from(
        JSON.stringify(
          {
            schemaVersion: 2,
            bundleVersion: "1.0.0",
            issuer: "validation-example-issuer",
            issuedAt: signedAt,
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
              issuedAt: signedAt,
              expiresAt,
              trustedIssuers: [
                { id: "validation-example-issuer", githubRepository: "example-org/policy-authority" },
              ],
              targets: [target],
              decisions: [decision],
              decisionRevocations: [],
            },
          },
          null,
          1,
        ),
        "utf8",
      ),
    );

    // Material carries canonical TEXT only - re-parsed on the consuming side.
    // It deliberately carries no roots/expected: trust travels separately.
    const materialPath = join(sessionDir, "attestation-material.json");
    write(
      materialPath,
      Buffer.from(
        JSON.stringify(
          {
            envelopeJson: Buffer.from(canonicalScanAttestationEnvelopeBytesV2(envelope)).toString(
              "utf8",
            ),
            candidateJson: Buffer.from(canonicalScanCandidateBytesV2(candidate)).toString("utf8"),
            annexArtifacts: annexArtifacts.map((annex) => ({
              descriptorId: annex.descriptorId,
              base64: b64(annex.bytes),
            })),
          },
          null,
          1,
        ),
        "utf8",
      ),
    );

    const operatorTrustPath = join(sessionDir, "operator", "operator-trust.json");
    write(operatorTrustPath, Buffer.from(JSON.stringify(operatorTrust, null, 1), "utf8"));

    return {
      fixture: true,
      label: "Signed test fixture — no detector executed",
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
        matchedPath: entry.artifacts.profile.path.split("/").slice(-2).join("/"),
        selectedClosureSha256: seal.selectedClosureSha256,
        sourceTreeSha256: seal.sourceTreeSha256,
      },
      authorityBundlePath,
      scanMaterialPath: materialPath,
      operatorTrustPath,
    };
  },
};

/* ------------------------------------------------------------------------ main */

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  let request;
  try {
    request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: `malformed request: ${error.message}` }));
    return;
  }
  const operation = OPS[request.op];
  if (operation === undefined) {
    process.stdout.write(JSON.stringify({ ok: false, error: `unknown op: ${String(request.op)}` }));
    return;
  }
  try {
    const value = await operation(request);
    process.stdout.write(JSON.stringify({ ok: true, ...value }));
  } catch (error) {
    // Report the failure; never substitute a success or a generated stand-in.
    process.stdout.write(JSON.stringify({ ok: false, error: error?.message ?? String(error) }));
  }
}

await main();
