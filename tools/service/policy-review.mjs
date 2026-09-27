/** Decode a chosen local file, then use Core's public structural parsers. */
import { parseGovernanceDecisionV2, parsePolicyBundle } from "@aihq/core";

const MAX_FILE_BYTES = 1024 * 1024;

function localJson(base64) {
  if (typeof base64 !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new Error("Supply base64 bytes for one local JSON file.");
  }
  const bytes = Buffer.from(base64, "base64");
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error("File is over the 1 MiB review limit.");
  try {
    return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch (error) {
    return { reason: `The file is not UTF-8 JSON: ${error.message}` };
  }
}

export function reviewPolicyBundle({ base64 }) {
  const { value, reason } = localJson(base64);
  if (reason) return { parsed: false, reason };
  const parsed = parsePolicyBundle(value);
  if (!parsed.ok) return { parsed: false, reason: parsed.error };
  const bundle = parsed.bundle;
  return {
    parsed: true,
    schemaVersion: bundle.schemaVersion,
    bundleVersion: bundle.bundleVersion,
    issuer: bundle.issuer,
    issuedAt: bundle.issuedAt,
    policySchemaVersion: bundle.policy.schemaVersion,
    minimumPosture: bundle.policy.minimumPosture,
  };
}

/** Structure only. Parsing does not verify the issuer, signature or authority. */
export function reviewGovernanceDecision({ base64 }) {
  const { value, reason } = localJson(base64);
  if (reason) return { parsed: false, reason };
  let decision;
  try {
    decision = parseGovernanceDecisionV2(value);
  } catch (error) {
    return { parsed: false, reason: error?.message ?? String(error) };
  }
  return {
    parsed: true,
    format: decision.format,
    version: decision.version,
    id: decision.id,
    disposition: decision.disposition,
    qualificationBasis: decision.qualificationBasis.kind,
    subjectKind: decision.subject.kind,
    subjectId: decision.subject.id,
    sourceType: decision.subject.source.type,
    targets: decision.targets,
    allowedEffects: decision.allowedEffects,
    issuer: decision.issuer,
    actor: decision.actor,
    issuedAt: decision.issuedAt,
    expiresAt: decision.expiresAt,
  };
}
