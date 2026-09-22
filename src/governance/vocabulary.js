/*
 * The words the Governance pane is allowed to use.
 *
 * 1. SIX STATUSES, SIX FIELDS. structure, evidence, binding, authority, plan
 *    and execution are rendered separately. Never one badge, and never one
 *    implying another.
 * 2. execution is always "not-attempted". No screen may ever say Applied,
 *    Executed or Published - nothing has run.
 * 3. Tone is NOT a pass/fail split: "not-evaluated" is its own thing, and
 *    "claimed" is never coloured like "bound".
 * 4. Every typed refusal Core can return has plain-language, actionable
 *    wording. The code is always shown next to it: the operator needs the exact
 *    term to search for, and the sentence tells them what to do about it.
 */

/** The six axes, in the order the contract names them. */
export const AXES = ["structure", "evidence", "binding", "authority", "plan", "execution"];

export const TONE = {
  valid: "text-primary",
  invalid: "text-error",
  verified: "text-primary",
  unverified: "text-error",
  "not-evaluated": "text-outline",
  bound: "text-primary",
  claimed: "text-tertiary",
  mismatched: "text-error",
  unbound: "text-error",
  prepared: "text-primary",
  refused: "text-error",
  "not-attempted": "text-outline",
};

export const REFUSAL = {
  "unknown-contract-version": "The saved document declares a contract version this Core does not implement. Re-prepare it with a matching version.",
  "malformed-bytes": "The bytes are not a parseable document. The file was truncated or is not the artifact it claims to be.",
  "oversize-bytes": "The document exceeds the size ceiling the contract allows.",
  "non-canonical-bytes": "The bytes parse but are not canonical. Something re-serialized or pretty-printed the file after Core wrote it; save the exact bytes instead.",
  "invalid-input": "One of the supplied values did not satisfy the contract. The field is named in the diagnostics below.",
  "derived-digest-mismatch": "A digest in the document does not match what Core re-derives from the same values. The document was edited after it was written.",
  "unsupported-target": "That target is not one this contract accepts.",
  "unsupported-effect": "That effect is not one this contract accepts.",
  "invalid-evidence-path": "The evidence path in the document is not a safe root-relative path.",
  "unsafe-evidence-custody": "The evidence file failed its custody check: it is a symlink, a hard link, or it changed while being read.",
  "evidence-unavailable": "No evidence file was found at the path the document names.",
  "evidence-changed": "The evidence file changed between the two reads. Consumption will not accept a moving target.",
  "evidence-digest-mismatch": "The evidence file does not hash to the digest the saved document records.",
  "evidence-subject-mismatch": "The evidence envelope is about a different subject than the one selected.",
  "evidence-reprojection-mismatch": "Reprojecting the verified attestation does not reproduce the saved evidence byte for byte. The saved evidence is not what this attestation says.",
  "scan-verification-unavailable": "The evidence claims to be a scan attestation, but no Scan verifier and trust were supplied. Import the attestation material and configure operator trust.",
  "scan-attestation-unverified": "Scan refused the attestation under the configured trust. Either the signature is not authentic, or the signer is not one of your roots.",
  "seal-digest-recomputation-mismatch": "Core recomputed the source-seal digests and got different values than the verified facts carry.",
  "seal-toctou-mismatch": "The seal changed between reads.",
  "subject-digest-absent-from-sealed-closure": "The subject's content digest does not appear anywhere in the sealed source closure.",
  "subject-digest-covered-but-not-selected": "The subject's file is inside the scanned tree but was not part of the selected closure, so the scan says nothing about it.",
  "assessment-unavailable": "The subject is identified by an assessment artifact, but the application could not supply its bytes: the installed Catalog has no unique entry for that identity, or the resolver failed.",
  "assessment-bytes-do-not-match-identity": "The assessment bytes supplied do not hash to the identity the saved subject names. The wrong artifact was supplied, or it changed.",
  "assessment-declaration-unreadable": "The assessment bytes are not a readable first-party qualification profile (v1) declaring source files and component roots.",
  "declared-material-root-not-unique": "More than one declared component root contains every scanned path, so the binding is ambiguous and is refused.",
  "sealed-path-not-declared": "A scanned file is not declared under any component root of the assessment. Paths are matched exactly, never by file name.",
  "declared-digest-mismatch": "A scanned file's digest differs from the digest the assessment declares at that exact path.",
  "seal-selection-inconsistent": "The seal's selected paths do not agree with its own file records.",
  "missing-repository-commit-provenance-record": "This entry is sourced from a repository commit, and no provenance record maps that commit to file digests. Binding needs that record; the seal keeps path, sha256 and byteLength only.",
  "missing-tarball-sha512-record": "This entry is an npm tarball identified by sha512 integrity, and no record maps it to the sha256 digests the seal keeps.",
  "missing-distribution-file-record": "No record maps this distribution file to a sealed digest.",
  "missing-manifest-document-record": "No record maps this manifest document to a sealed digest.",
  "binding-claim-contradicted": "The saved binding claim contradicts what independent verification found. A saved claim is never accepted on its own.",
  "authority-unverified": "No current, verified organization authority was found. Supply a policy bundle the operator controls, outside the consumption root.",
  "authority-version": "The authority receipt declares a version this Core does not implement.",
  "authority-not-current": "The authority receipt is outside its validity window - most often expired.",
  "decision-missing-or-mismatch": "The authority carries no decision matching the id and digest referenced, or it carries a different one.",
  "decision-rejected": "The referenced decision is a rejection.",
  "decision-revoked": "The referenced decision has been revoked.",
  "decision-not-current": "The referenced decision is outside its validity window.",
  "decision-scope-mismatch": "The decision does not cover this subject, target or effect.",
  "qualification-unverified": "The qualification basis did not verify against the evidence supplied.",
  "observation-missing": "Qualification resolved, but there is no observation source for the effect, so nothing was executed. This is the furthest any route reaches today.",
};
