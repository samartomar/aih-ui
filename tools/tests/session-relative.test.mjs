/*
 * What the page is told about where an operator-side file sits.
 *
 * The page holds a session id and never a path. The consumption result names
 * the authority bundle, the verifier trust and the provenance declaration by
 * the session-relative name they were stored under - the same string
 * `/api/operator-file` answered with - and never by the run directory's
 * location on this machine. These cases pin that down for both path styles
 * and for the values that have no session-relative name at all.
 *
 *   node --test "tools/tests/*.test.mjs"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { sessionRelativePath } from "../service/artifacts.mjs";

const SESSION = join("run", "sessions", "3f2a9c1e-0000-4000-8000-000000000000");

test("an operator file is named by its session-relative POSIX path", () => {
  const stored = join(SESSION, "operator", "authority-bundle.json");
  assert.equal(sessionRelativePath(SESSION, stored), "operator/authority-bundle.json");
  assert.equal(
    sessionRelativePath(SESSION, join(SESSION, "operator", "operator-trust.json")),
    "operator/operator-trust.json",
  );
  assert.equal(
    sessionRelativePath(SESSION, join(SESSION, "attestation-material.json")),
    "attestation-material.json",
  );
});

test("the name never carries the session directory, a drive or a separator style", () => {
  const stored = join(SESSION, "operator", "authority-bundle.json");
  const named = sessionRelativePath(SESSION, stored);
  assert.equal(named.includes("sessions"), false);
  assert.equal(named.includes("\\"), false);
  assert.equal(/^[A-Za-z]:/.test(named), false);
  assert.equal(named.startsWith("/"), false);
});

test("a file nobody supplied has no name", () => {
  assert.equal(sessionRelativePath(SESSION, null), null);
  assert.equal(sessionRelativePath(SESSION, undefined), null);
  assert.equal(sessionRelativePath(SESSION, ""), null);
});

test("a path outside the session has no session-relative name", () => {
  assert.equal(sessionRelativePath(SESSION, join("run", "sessions", "other", "x.json")), null);
  assert.equal(sessionRelativePath(SESSION, join("elsewhere", "authority-bundle.json")), null);
  assert.equal(sessionRelativePath(SESSION, SESSION), null);
});
