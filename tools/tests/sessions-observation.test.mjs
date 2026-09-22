/*
 * The session store's revision guard.
 *
 * Uploads answer in any order: a folder chosen first can reach the server after
 * the folder chosen second. The page already refuses to apply a superseded
 * answer, but the page is not what holds the bytes - the session is. So the
 * session refuses the older write itself, and refuses it without touching a
 * byte, which is what keeps what the operator sees and what a consume reads the
 * same thing.
 *
 *   node --test tools/tests
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSessions } from "../server/sessions.mjs";

const INSTALL_ROOT = "packs/governance-quality/aih-gov-doctor";
const b64 = (text) => Buffer.from(text, "utf8").toString("base64");

/** One observation as the page sends it: a manifest, a root, and the files. */
const observation = (revision, marker) => ({
  revision,
  installRoot: INSTALL_ROOT,
  manifestBase64: b64(`{"manifest":"${marker}"}`),
  files: [{ relativePath: "SKILL.md", base64: b64(`contents ${marker}`) }],
});

function withSessions(run) {
  const runDir = mkdtempSync(join(tmpdir(), "aih-ui-sessions-"));
  try {
    return run(createSessions(runDir), runDir);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
}

/** What the session actually holds for the observation's one file. */
const storedFile = (runDir, sessionId) =>
  readFileSync(join(runDir, "sessions", sessionId, "observation", "files", "SKILL.md"), "utf8");

test("an older observation arriving after a newer one is refused, and changes nothing", () => {
  withSessions((sessions, runDir) => {
    const { sessionId } = sessions.create();
    assert.equal(sessions.storeObservation(sessionId, observation(1, "old")).ok, true);
    assert.equal(sessions.storeObservation(sessionId, observation(2, "new")).ok, true);
    assert.equal(storedFile(runDir, sessionId), "contents new");

    // The first operator's folder, answered late.
    const late = sessions.storeObservation(sessionId, observation(1, "old"));
    assert.equal(late.ok, false);
    assert.equal(late.superseded, true);
    assert.match(late.error, /newer/);
    // Not a byte of it reached the session.
    assert.equal(storedFile(runDir, sessionId), "contents new");
    assert.equal(sessions.observationOf(sessionId).installRoot, INSTALL_ROOT);
  });
});

test("the same revision twice is superseded too: only newer replaces", () => {
  withSessions((sessions, runDir) => {
    const { sessionId } = sessions.create();
    assert.equal(sessions.storeObservation(sessionId, observation(4, "first")).ok, true);
    const again = sessions.storeObservation(sessionId, observation(4, "second"));
    assert.equal(again.ok, false);
    assert.equal(again.superseded, true);
    assert.equal(storedFile(runDir, sessionId), "contents first");
  });
});

test("a store without a usable revision is refused rather than let through", () => {
  withSessions((sessions, runDir) => {
    const { sessionId } = sessions.create();
    for (const revision of [undefined, null, 0, -1, 1.5, "2", Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      const refused = sessions.storeObservation(sessionId, { ...observation(1, "x"), revision });
      assert.equal(refused.ok, false, `revision ${String(revision)} was accepted`);
      assert.equal(refused.superseded, undefined);
      assert.match(refused.error, /revision/);
    }
    assert.equal(existsSync(join(runDir, "sessions", sessionId, "observation")), false);
    assert.equal(sessions.observationOf(sessionId), undefined);

    const file = sessions.storeOperatorFile(sessionId, "trust", Buffer.from("{}"), undefined);
    assert.equal(file.ok, false);
    assert.match(file.error, /revision/);
    assert.equal(existsSync(join(runDir, "sessions", sessionId, "operator", "operator-trust.json")), false);
  });
});

test("each input counts on its own, in each session on its own", () => {
  withSessions((sessions, runDir) => {
    const a = sessions.create().sessionId;
    const b = sessions.create().sessionId;

    // One session's high revision does not silence another session's first.
    assert.equal(sessions.storeObservation(a, observation(9, "a")).ok, true);
    assert.equal(sessions.storeObservation(b, observation(1, "b")).ok, true);
    assert.equal(storedFile(runDir, a), "contents a");
    assert.equal(storedFile(runDir, b), "contents b");

    // One input's high revision does not silence another input's first.
    assert.equal(sessions.storeOperatorFile(a, "authority", Buffer.from("A"), 12).ok, true);
    const trust = sessions.storeOperatorFile(a, "trust", Buffer.from("T"), 1);
    assert.equal(trust.ok, true);
    assert.equal(trust.revision, 1);
    // But the same input's older revision is refused, with its own bytes intact.
    const older = sessions.storeOperatorFile(a, "authority", Buffer.from("OLD"), 11);
    assert.equal(older.ok, false);
    assert.equal(older.superseded, true);
    assert.equal(readFileSync(join(runDir, "sessions", a, "operator", "authority-bundle.json"), "utf8"), "A");
  });
});

test("what was stored says which revision it was stored at", () => {
  withSessions((sessions) => {
    const { sessionId } = sessions.create();
    const stored = sessions.storeObservation(sessionId, observation(3, "only"));
    assert.equal(stored.revision, 3);
    assert.equal(stored.installRoot, INSTALL_ROOT);
    assert.equal(stored.files.length, 1);
    assert.equal(sessions.storeOperatorFile(sessionId, "material", Buffer.from("M"), 3).revision, 3);
  });
});

test("an unknown session is refused before any revision is considered", () => {
  withSessions((sessions) => {
    const refused = sessions.storeObservation("00000000-0000-0000-0000-000000000000", observation(1, "x"));
    assert.equal(refused.ok, false);
    assert.equal(refused.error, "unknown session");
  });
});
