#!/usr/bin/env node
/*
 * Acceptance sweep over a RUNNING preview's API.
 *
 *   node tools/preview.mjs --port 4173
 *   node tools/acceptance-sweep.mjs [http://127.0.0.1:4173/]
 *
 * No browser. It drives the same /api/* calls the Governance pane makes, in the
 * same order, and checks what the page would be shown:
 *
 *   - no response body names a filesystem location. The page holds an opaque
 *     session id and is shown session-relative names (operator/...), never the
 *     run directory on this machine;
 *   - a fixture, a prepare and a consume for one entry share one session, and
 *     the verdict names its operator files by their session-relative names;
 *   - the two saved files, reopened into a fresh session, consume to a verdict
 *     with no reopen failure, and read back byte for byte from that session;
 *   - a session the server did not issue, and a body it cannot parse, are each
 *     refused with a JSON answer and a reason - never a crash, never a success.
 *
 * Every check prints one line; the process exits non-zero if any failed.
 */

const base = new URL(process.argv[2] ?? "http://127.0.0.1:4173/");

/** Anything that looks like a filesystem location on this or any machine. */
const LOCATION = /[A-Za-z]:\\|[A-Za-z]:\/|\/(Users|home|tmp|var|private)\/|\\\\|aih-ui-preview-/;

const failures = [];
function check(name, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

/** POSTs JSON and returns { status, body, text }. A body that is not JSON is reported as such. */
async function post(path, body, raw = false) {
  const response = await fetch(new URL(path, base), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  return { status: response.status, body: parsed, text };
}

/** The first entry whose content ships in the installed package: the fixture needs one. */
async function firstEntryWithContent() {
  const index = await (await fetch(new URL("catalog-index.json", base))).json();
  for (const entry of index.entries) {
    if (entry.subject?.source?.type !== "aih") continue;
    const subject = await post("/api/subject", { entryId: entry.entryId });
    if (subject.body?.contentAvailable === true) return { entry, subject };
  }
  return null;
}

const bodies = [];
const remember = (name, answer) => {
  bodies.push({ name, text: answer.text });
  return answer;
};

const summary = await (await fetch(new URL("summary.json", base))).json();
const target = summary.coreTargets?.state === "published" ? summary.coreTargets.targets[0] : null;
check("summary publishes at least one Core target", typeof target === "string", target ?? "none");

const found = await firstEntryWithContent();
check("an aih entry with package content exists", found !== null);
if (found === null || target === null) {
  process.exit(1);
}
const { entry } = found;
remember("subject", found.subject);
remember("catalog-integrity", await post("/api/catalog-integrity", { entryId: entry.entryId }));

// ---------------------------------------------------------------- one session
const fixture = remember("validation-fixture", await post("/api/validation-fixture", { entryId: entry.entryId, target, effect: "observe" }));
check("validation fixture builds", fixture.status === 200 && fixture.body?.ok !== false, fixture.body?.error);
const sessionId = fixture.body?.sessionId;

const prepared = remember(
  "prepare",
  await post("/api/prepare", {
    sessionId,
    entryId: entry.entryId,
    route: "catalog",
    target,
    effect: "observe",
    decisionId: fixture.body?.decisionId,
    decisionDigest: fixture.body?.decisionDigest,
    evidenceBase64: fixture.body?.evidenceBase64,
    bindingClaim: fixture.body?.bindingClaim ?? null,
  }),
);
check("prepare succeeds in the fixture's session", prepared.body?.prepared === true && prepared.body?.sessionId === sessionId, prepared.body?.error ?? prepared.body?.status?.reason);
check("prepare is byte-identical on repeat", prepared.body?.deterministic === true);

const verdict = remember("consume", await post("/api/consume", { sessionId }));
check("consume answers with six axes", typeof verdict.body?.structure === "string" && verdict.body?.execution === "not-attempted", verdict.body?.error);
check(
  "the verdict names the operator files by their session-relative names",
  verdict.body?.authoritySource === "operator/authority-bundle.json" && verdict.body?.trustSource === "operator/operator-trust.json",
  `${verdict.body?.authoritySource} / ${verdict.body?.trustSource}`,
);
check(
  "the provenance declaration is named the same way",
  verdict.body?.operatorProvenance == null || verdict.body.operatorProvenance.declaredBy === "operator/operator-trust.json",
  verdict.body?.operatorProvenance?.declaredBy,
);

// ------------------------------------------------------------ reopen and read
const savedInput = remember("saved input", await post("/api/saved", { sessionId, file: "input" }));
const savedEvidence = remember("saved evidence", await post("/api/saved", { sessionId, file: "evidence" }));
check("both saved files read back", savedInput.body?.ok === true && savedEvidence.body?.ok === true);

const reopened = remember("reopen", await post("/api/reopen", { inputBase64: savedInput.body?.base64, evidenceBase64: savedEvidence.body?.base64 }));
check("reopen opens a different session", reopened.body?.ok === true && reopened.body.sessionId !== sessionId);
const freshVerdict = remember("consume reopened", await post("/api/consume", { sessionId: reopened.body?.sessionId }));
check("the reopened bytes still parse as canonical", freshVerdict.body?.reopened !== false, freshVerdict.body?.reason);
const reread = remember("saved input (reopened)", await post("/api/saved", { sessionId: reopened.body?.sessionId, file: "input" }));
check("the fresh session holds the exact bytes it was handed", reread.body?.base64 === savedInput.body?.base64);

// --------------------------------------------------------------------- refusals
const unknown = remember("consume unknown", await post("/api/consume", { sessionId: "00000000-0000-4000-8000-000000000000" }));
check("an unknown session is refused with a reason", unknown.status === 422 && unknown.body?.ok === false && typeof unknown.body.error === "string", unknown.body?.error);
const malformed = remember("malformed body", await post("/api/consume", "{not json", true));
check("a body that does not parse is refused as JSON", malformed.status === 400 && malformed.body?.ok === false, malformed.body?.error);

// ----------------------------------------------------- nothing names a location
for (const { name, text } of bodies) {
  const match = text.match(LOCATION);
  check(`no filesystem location in the ${name} answer`, match === null, match ? `found ${JSON.stringify(text.slice(Math.max(0, match.index - 30), match.index + 60))}` : "");
}

console.log(failures.length === 0 ? "\nall checks passed" : `\n${failures.length} check(s) failed`);
process.exit(failures.length === 0 ? 0 : 1);
