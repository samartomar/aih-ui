/*
 * The Governance pane: one vertical slice through the Core contract.
 *
 *   catalog selection -> inspect published information -> import evidence ->
 *   operator decision/target/effect -> prepare through Core -> save exact bytes
 *   -> reopen -> consume independently -> display six separate statuses.
 *
 * ---------------------------------------------------------------------------
 * RULES THIS FILE ENFORCES, not style preferences
 *
 * 1. SIX STATUSES, SIX FIELDS. structure, evidence, binding, authority, plan
 *    and execution are rendered separately. Never one badge, and never one
 *    implying another.
 *
 * 2. execution is always "not-attempted". No screen may ever say Applied,
 *    Executed or Published - nothing has run.
 *
 * 3. "Verified" is about a SIGNATURE, never about a measurement. Attestation
 *    verification and detector execution are two different rows and are always
 *    shown together. Only the operator's own evidenceProvenance declaration can
 *    say whether a detector ran, and it is never inferred from the evidence.
 *
 * 4. Absence is worded by what is absent: "Not published" for package data the
 *    index does not carry, "Not supplied" for operator input nobody has given.
 *
 * 5. No policy, digest or compile logic lives here. Every derivation happens in
 *    @aihq/core behind /api/*; this file collects input and renders answers.
 * ---------------------------------------------------------------------------
 */

const NOT_SUPPLIED = "Not supplied";
const NOT_PUBLISHED = "Not published";

/** The six axes, in the order the contract names them. */
const AXES = ["structure", "evidence", "binding", "authority", "plan", "execution"];

/**
 * Tone per axis value. Deliberately NOT a pass/fail split: "not-evaluated" is
 * its own thing, and "claimed" is never coloured like "bound".
 */
const TONE = {
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

/**
 * Plain-language, actionable wording for each typed refusal Core can return.
 * The code is always shown next to it: the operator needs the exact term to
 * search for, and the sentence tells them what to do about it.
 */
const REFUSAL = {
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

const state = {
  entry: null,
  subject: null,
  evidenceBase64: null,
  evidenceFacts: null,
  sessionId: null,
  prepared: null,
  fixture: null,
  bindingClaim: null,
};

let dom = {};

/* ------------------------------------------------------------------ helpers */

function el(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined && value !== null) node.textContent = String(value);
  return node;
}

/** A label/value row. A null value is rendered as the supplied absence word. */
function row(parent, label, value, absent = NOT_SUPPLIED, tone) {
  const node = el("div", "flex items-start justify-between gap-2");
  node.appendChild(el("span", "text-outline shrink-0", label));
  const shown = value === null || value === undefined || value === "" ? absent : String(value);
  const valueNode = el(
    "span",
    `text-right break-all ${tone ?? (value ? "text-on-surface" : "text-outline")}`,
    shown,
  );
  node.appendChild(valueNode);
  parent.appendChild(node);
  return node;
}

async function api(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const value = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
  return value;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function downloadBase64(name, base64) {
  // The exact bytes the server read back off disk. Decoded here and handed to
  // the browser unchanged - never re-serialized through JSON.
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ renders */

function renderSubject() {
  const box = dom.govSubject;
  box.replaceChildren();
  if (state.subject === null) {
    row(box, "Subject", null, "Select a catalog entry");
    return;
  }
  const subject = state.subject;
  row(box, "Kind", subject.kind);
  row(box, "Subject id", subject.id);
  row(box, "Source type", subject.source?.type);
  row(box, "Source digest", subject.sourceDigest);
  row(box, "Subject digest", subject.subjectDigest);
  // The index carries digest copies but no signature, so they authenticate
  // nothing. Cross-check them and show disagreement rather than choosing.
  row(
    box,
    "Index copies",
    subject.indexAgrees ? "agree with Core" : "DISAGREE with Core",
    NOT_PUBLISHED,
    subject.indexAgrees ? "text-primary" : "text-error",
  );
  row(
    box,
    "Package content",
    subject.contentAvailable ? "ships in the installed package" : null,
    NOT_PUBLISHED,
    subject.contentAvailable ? "text-on-surface" : "text-outline",
  );
}

function renderEvidence() {
  const box = dom.govEvidence;
  box.replaceChildren();
  const facts = state.evidenceFacts;
  if (facts === null) {
    row(box, "Evidence", null, NOT_SUPPLIED);
    return;
  }
  if (facts.parsed !== true) {
    box.appendChild(el("div", "text-error leading-snug", facts.reason));
    row(box, "Bytes read", `${facts.byteLength}`);
    return;
  }
  row(box, "Envelope digest", facts.digest);
  row(box, "Subject digest", facts.subjectDigest);
  row(box, "Evidence kind", facts.evidenceKind);
  row(box, "Attestor", facts.attestor);
  row(box, "Not before", facts.notBefore);
  row(box, "Expires", facts.expiresAt);
  // A claim is not a verification. Say which it is.
  const claim = facts.claimsScanEvidence
    ? "claims scan-attestation-v2 — unverified until consumption"
    : "organization assertion — not a scan, not a measurement";
  box.appendChild(
    el("div", `leading-snug ${facts.claimsScanEvidence ? "text-tertiary" : "text-on-surface-variant"}`, claim),
  );
}

function renderPrepared() {
  const box = dom.govPrepared;
  box.replaceChildren();
  const prepared = state.prepared;
  if (prepared === null) {
    row(box, "Artifacts", null, NOT_SUPPLIED);
    return;
  }
  if (prepared.prepared !== true) {
    box.appendChild(el("div", "text-error font-semibold", `Refused: ${prepared.status.reason}`));
    box.appendChild(el("div", "text-on-surface-variant leading-snug", REFUSAL[prepared.status.reason] ?? ""));
    for (const diagnostic of prepared.diagnostics ?? []) {
      box.appendChild(
        el("div", "text-outline leading-snug", `${diagnostic.field}: ${diagnostic.detail}`),
      );
    }
    return;
  }
  row(box, "governance-input.json", `${prepared.input.byteLength} bytes`);
  // A domain-separated digest OVER the document, not a hash of the file. The
  // label says so: an operator who hashes the download will get a different
  // value and should not be left wondering which one is wrong.
  row(box, "input document digest", prepared.input.digest);
  row(box, "evidence path", prepared.evidence.rootRelativePath);
  row(box, "evidence envelope digest", prepared.evidence.digest);
  row(
    box,
    "Byte-identical on repeat",
    prepared.deterministic ? "yes" : "NO",
    NOT_SUPPLIED,
    prepared.deterministic ? "text-primary" : "text-error",
  );
  // A saved document may only ever CLAIM a binding. Say so where it is saved.
  row(box, "Saved binding status", prepared.status.binding, NOT_SUPPLIED, TONE[prepared.status.binding]);
}

/** The six axes, each its own field, always all six, always in order. */
function renderStatuses(view) {
  const grid = dom.govStatuses;
  grid.replaceChildren();
  if (view === null) return;
  for (const axis of AXES) {
    const value = view[axis];
    const cell = el(
      "div",
      "p-1.5 rounded bg-surface-container-low border border-surface-container-high/30 space-y-0.5",
    );
    cell.appendChild(el("div", "text-[9px] font-mono uppercase tracking-wider text-outline", axis));
    cell.appendChild(
      el("div", `text-[11px] font-mono font-semibold ${TONE[value] ?? "text-on-surface"}`, value),
    );
    grid.appendChild(cell);
  }
}

function renderVerdict(view) {
  const box = dom.govVerdict;
  box.replaceChildren();
  if (view === null) {
    box.appendChild(el("div", "text-outline", "Not consumed yet."));
    return;
  }
  if (view.reopened === false) {
    box.appendChild(el("div", "text-error font-semibold", "Reopen failed"));
    box.appendChild(el("div", "text-on-surface-variant leading-snug", view.reason));
    return;
  }
  if (view.materialCarriesTrust !== undefined || view.scanTrustMissing === true) {
    box.appendChild(el("div", "text-error font-semibold", "Refused before verification"));
    box.appendChild(el("div", "text-on-surface-variant leading-snug", view.reason));
    return;
  }

  // Outcome, then the reason in the operator's language. Never "Applied".
  const outcomeTone =
    view.outcome === "refused" ? "text-error" : view.outcome === "partial" ? "text-tertiary" : "text-primary";
  box.appendChild(el("div", `font-semibold ${outcomeTone}`, `Outcome: ${view.outcome}`));
  if (view.reason) {
    box.appendChild(el("div", "font-mono text-[10px] text-outline", view.reason));
    box.appendChild(el("div", "text-on-surface-variant leading-snug", REFUSAL[view.reason] ?? ""));
  }

  const detail = el("div", "pt-1 space-y-0.5 font-mono text-[10px]");
  // What the evidence actually was. "Verified scanner evidence" is only ever
  // said when the claim is scan-attestation-v2 AND evidence verified.
  row(detail, "Evidence claim", view.evidenceClaim, NOT_SUPPLIED);
  row(detail, "Matched path", view.matchedPath, NOT_SUPPLIED);
  row(detail, "Authority transport", view.authorityTransport, NOT_SUPPLIED);
  row(detail, "Authority source", view.authoritySource, NOT_SUPPLIED);
  row(detail, "Verifier trust from", view.trustSource, NOT_SUPPLIED);
  row(detail, "Subject digest", view.subjectDigest, NOT_SUPPLIED);
  row(detail, "Decision digest", view.decisionDigest, NOT_SUPPLIED);
  box.appendChild(detail);

  for (const diagnostic of view.diagnostics ?? []) {
    box.appendChild(
      el("div", "text-outline leading-snug text-[10px]", `${diagnostic.field}: ${diagnostic.detail}`),
    );
  }

  // execution is always "not-attempted". State it in words so no one reads the
  // outcome above as something having run.
  box.appendChild(
    el(
      "div",
      "pt-1 mt-1 border-t border-surface-container-high/40 text-[10.5px] text-outline leading-snug",
      `Execution: ${view.execution}. No effect was applied, executed or published — this contract never executes.`,
    ),
  );
}

/**
 * Attestation verification and detector execution: two rows, always together.
 *
 * `attestationVerified` is a statement about the signature and its binding. It
 * is NOT a statement that any measurement occurred. Only the operator's own
 * trust configuration carries `evidenceProvenance`, and that is the only thing
 * that can say whether a detector ran.
 */
function renderDetector(view) {
  const box = dom.govDetector;
  box.replaceChildren();
  const fixture = state.fixture;

  const attestationVerified =
    view !== null && view.evidenceClaim === "scan-attestation-v2" && view.evidence === "verified";
  row(
    box,
    "Attestation",
    view === null ? null : attestationVerified ? "Attestation verified" : "Attestation not verified",
    NOT_SUPPLIED,
    view === null ? undefined : attestationVerified ? "text-primary" : "text-error",
  );

  if (fixture === null) {
    row(box, "Detector execution", null, NOT_SUPPLIED);
    box.appendChild(
      el(
        "div",
        "text-outline leading-snug",
        "No operator provenance declaration has been supplied, so nothing can be said about whether a detector ran.",
      ),
    );
    return;
  }
  row(box, "Detector execution", fixture.label, NOT_SUPPLIED, "text-tertiary");
  row(box, "Detector executed", String(fixture.detectorExecuted), NOT_SUPPLIED, "text-tertiary");
  row(box, "Signer keyId", fixture.keyId);
  row(box, "Sealed files", `${fixture.sealedFileCount} from the installed package`);
  box.appendChild(el("div", "text-outline leading-snug", fixture.note));
}

/* ------------------------------------------------------------------ actions */

function canPrepare() {
  return (
    state.subject !== null &&
    state.evidenceFacts?.parsed === true &&
    dom.govDecisionId.value.trim().length > 0 &&
    dom.govDecisionDigest.value.trim().length > 0 &&
    dom.govTarget.value.trim().length > 0
  );
}

function refreshEnabled() {
  dom.govPrepareBtn.disabled = !canPrepare();
  dom.govFixtureBtn.disabled = state.subject === null || state.subject.contentAvailable !== true;
  const saved = state.prepared?.prepared === true;
  dom.govDownloadInput.disabled = !saved;
  dom.govDownloadEvidence.disabled = !saved;
  dom.govConsumeBtn.disabled = !saved;
}

async function onEvidenceFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  state.evidenceBase64 = bytesToBase64(bytes);
  // Core's own parser decides whether these bytes are acceptable. The page
  // never normalises, reformats or repairs them.
  state.evidenceFacts = await api("/api/evidence", { evidenceBase64: state.evidenceBase64 });
  renderEvidence();
  refreshEnabled();
}

async function onPrepare() {
  const prepared = await api("/api/prepare", {
    sessionId: state.sessionId,
    entryId: state.entry.entryId,
    route: dom.govRoute.value,
    target: dom.govTarget.value.trim(),
    effect: dom.govEffect.value,
    decisionId: dom.govDecisionId.value.trim(),
    decisionDigest: dom.govDecisionDigest.value.trim(),
    evidenceBase64: state.evidenceBase64,
    bindingClaim: state.bindingClaim,
  });
  if (prepared.ok === false) {
    dom.govPrepared.replaceChildren(el("div", "text-error leading-snug", prepared.error));
    return;
  }
  state.prepared = prepared;
  state.sessionId = prepared.sessionId ?? state.sessionId;
  renderPrepared();
  renderStatuses(null);
  renderVerdict(null);
  renderDetector(null);
  refreshEnabled();
}

async function onConsume() {
  const view = await api("/api/consume", { sessionId: state.sessionId });
  if (view.ok === false) {
    dom.govVerdict.replaceChildren(el("div", "text-error leading-snug", view.error));
    return;
  }
  renderStatuses(view.reopened === false ? null : view);
  renderVerdict(view);
  renderDetector(view);
}

async function onFixture() {
  const built = await api("/api/validation-fixture", {
    entryId: state.entry.entryId,
    target: dom.govTarget.value.trim() || "claude",
    effect: dom.govEffect.value,
  });
  if (built.ok === false) {
    dom.govDetector.replaceChildren(el("div", "text-error leading-snug", built.error));
    return;
  }
  state.fixture = built;
  state.sessionId = built.sessionId;
  state.evidenceBase64 = built.evidenceBase64;
  state.bindingClaim = built.bindingClaim;
  // The fixture also supplies the operator inputs it generated, so the normal
  // fields show exactly what will be prepared. They stay editable.
  dom.govDecisionId.value = built.decisionId;
  dom.govDecisionDigest.value = built.decisionDigest;
  state.evidenceFacts = await api("/api/evidence", { evidenceBase64: built.evidenceBase64 });
  renderEvidence();
  renderDetector(null);
  refreshEnabled();
}

async function onDownload(which) {
  const saved = await api("/api/saved", { sessionId: state.sessionId, file: which });
  if (saved.ok === false) return;
  downloadBase64(saved.name, saved.base64);
}

/* -------------------------------------------------------------------- mount */

export function collectGovernanceDom() {
  const ids = [
    "pane-governance", "gov-subject", "gov-evidence-file", "gov-evidence",
    "gov-decision-id", "gov-decision-digest", "gov-target", "gov-effect", "gov-route",
    "gov-prepare-btn", "gov-prepared", "gov-download-input", "gov-download-evidence",
    "gov-consume-btn", "gov-statuses", "gov-verdict", "gov-fixture-btn", "gov-detector",
  ];
  dom = {};
  for (const id of ids) {
    const node = document.getElementById(id);
    if (!node) throw new Error(`page is missing #${id}`);
    dom[id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = node;
  }

  dom.govEvidenceFile.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) void onEvidenceFile(file);
  });
  for (const input of [dom.govDecisionId, dom.govDecisionDigest, dom.govTarget]) {
    input.addEventListener("input", refreshEnabled);
  }
  dom.govPrepareBtn.addEventListener("click", () => void onPrepare());
  dom.govConsumeBtn.addEventListener("click", () => void onConsume());
  dom.govFixtureBtn.addEventListener("click", () => void onFixture());
  dom.govDownloadInput.addEventListener("click", () => void onDownload("input"));
  dom.govDownloadEvidence.addEventListener("click", () => void onDownload("evidence"));

  renderSubject();
  renderEvidence();
  renderPrepared();
  renderStatuses(null);
  renderVerdict(null);
  renderDetector(null);
  refreshEnabled();
  return dom.paneGovernance;
}

/** Called whenever the catalog selection changes. Every step resets with it. */
export async function governanceSelect(entry) {
  state.entry = entry;
  state.subject = null;
  state.evidenceBase64 = null;
  state.evidenceFacts = null;
  state.sessionId = null;
  state.prepared = null;
  state.fixture = null;
  state.bindingClaim = null;
  if (dom.govDecisionId !== undefined) {
    dom.govDecisionId.value = "";
    dom.govDecisionDigest.value = "";
  }
  renderEvidence();
  renderPrepared();
  renderStatuses(null);
  renderVerdict(null);
  renderDetector(null);

  if (entry !== null && entry !== undefined) {
    const subject = await api("/api/subject", { entryId: entry.entryId });
    state.subject = subject.ok === false ? null : subject;
    if (subject.ok === false) {
      dom.govSubject.replaceChildren(el("div", "text-error leading-snug", subject.error));
      refreshEnabled();
      return;
    }
  }
  renderSubject();
  refreshEnabled();
}
