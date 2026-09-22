/*
 * The Governance pane's revision tracker, on its own.
 *
 * It is the whole of the page's answer to "does this answer still belong to
 * what the operator is looking at?", so it is checked here rather than only
 * through a browser: no DOM, no network, no session, just the ordering rules.
 *
 *   node --test tools/tests
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { INPUT_SLOTS, createRevisionTracker } from "../../src/governance/revisions.js";

test("a token stays current until its own slot changes", () => {
  const revisions = createRevisionTracker();
  const first = revisions.begin("material");
  assert.equal(revisions.isCurrent(first, null), true);

  // Another input changing is not this input changing.
  revisions.begin("trust");
  assert.equal(revisions.isCurrent(first, null), true);

  const second = revisions.begin("material");
  assert.equal(revisions.isCurrent(first, null), false);
  assert.equal(revisions.isCurrent(second, null), true);
  assert.equal(second.revision > first.revision, true);
});

test("every verification input has its own revision", () => {
  const revisions = createRevisionTracker();
  assert.deepEqual(INPUT_SLOTS, ["authority", "trust", "material", "observation", "evidence", "reopen"]);
  const tokens = INPUT_SLOTS.map((slot) => revisions.begin(slot));
  for (const token of tokens) assert.equal(revisions.isCurrent(token, null), true);
  for (const token of tokens) assert.equal(token.revision, 1);
});

test("the inputs revision moves on any slot, and the token carries it", () => {
  const revisions = createRevisionTracker();
  assert.equal(revisions.inputsRevision(), 0);
  const authority = revisions.begin("authority");
  assert.equal(revisions.inputsRevision(), 1);
  assert.equal(authority.inputs, 1);
  const observation = revisions.begin("observation");
  assert.equal(revisions.inputsRevision(), 2);
  assert.equal(observation.inputs, 2);
});

test("a token captures the session it was supplied under", () => {
  const revisions = createRevisionTracker();
  revisions.sessionChanged("session-a");
  const token = revisions.begin("authority");
  assert.equal(token.sessionId, "session-a");
  assert.equal(revisions.isCurrent(token, "session-a"), true);
  // The same input, in a session this page is no longer in.
  assert.equal(revisions.isCurrent(token, "session-b"), false);
});

test("a session change stales every open token", () => {
  const revisions = createRevisionTracker();
  revisions.sessionChanged("session-a");
  const open = INPUT_SLOTS.map((slot) => revisions.begin(slot));
  for (const token of open) assert.equal(revisions.isCurrent(token, "session-a"), true);

  revisions.sessionChanged("session-b");
  for (const token of open) assert.equal(revisions.isCurrent(token, "session-b"), false);
  // And in the session they were captured in, which is not this page's any more.
  for (const token of open) assert.equal(revisions.isCurrent(token, "session-a"), false);
});

test("a selection change stales open tokens even when no session was ever opened", () => {
  const revisions = createRevisionTracker();
  const token = revisions.begin("authority");
  assert.equal(token.sessionId, null);
  revisions.sessionChanged(null);
  assert.equal(revisions.isCurrent(token, null), false);
});

test("the session an upload opens keeps the uploads already in flight", () => {
  const revisions = createRevisionTracker();
  const authority = revisions.begin("authority");
  const trust = revisions.begin("trust");
  const material = revisions.begin("material");

  // The first answer back opens the session all three were supplied for.
  revisions.sessionChanged("session-a", { opened: true });
  for (const token of [authority, trust, material]) {
    assert.equal(revisions.isCurrent(token, "session-a"), true);
  }
  // A token begun afterwards carries the session it was begun in.
  assert.equal(revisions.begin("observation").sessionId, "session-a");
});

test("an opened session does not excuse a later, different session", () => {
  const revisions = createRevisionTracker();
  const authority = revisions.begin("authority");
  revisions.sessionChanged("session-a", { opened: true });
  revisions.sessionChanged("session-b");
  assert.equal(revisions.isCurrent(authority, "session-b"), false);
});

test("revisionOf reports what a slot is on now", () => {
  const revisions = createRevisionTracker();
  assert.equal(revisions.revisionOf("observation"), 0);
  const token = revisions.begin("observation");
  assert.equal(revisions.revisionOf("observation"), token.revision);
  revisions.sessionChanged("session-a");
  assert.equal(revisions.revisionOf("observation") > token.revision, true);
});

test("an input nobody defined is a programming error, not a silent pass", () => {
  const revisions = createRevisionTracker();
  assert.throws(() => revisions.begin("whatever"), /whatever/);
  assert.equal(revisions.isCurrent(null, null), false);
  assert.equal(revisions.isCurrent({ slot: "whatever", revision: 1, sessionId: null }, null), false);
});
