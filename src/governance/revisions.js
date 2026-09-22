/*
 * Which input an answer belongs to.
 *
 * The operator's verification inputs are files the browser reads
 * asynchronously and requests that can answer in any order: a folder chosen
 * first can be read, sent and answered after the folder chosen second. Without
 * an ordering rule the session ends up holding one operator's answer while the
 * page shows another's, and a verdict is then displayed for inputs that were
 * never the ones consumed.
 *
 * The rule is a revision per input. Changing an input moves its revision, so
 * every answer minted under the old one is superseded: it is not sent, and if
 * it is already in flight its answer is discarded. Moving to another session
 * moves every revision, so nothing captured for the previous session can
 * attach to the new one.
 *
 * This module decides nothing about policy, evidence or files. It has no DOM,
 * no network and no session of its own - it only says whether a token is still
 * the current one.
 */

/**
 * The verification inputs, each with its own revision.
 *
 * They are separate because they are separately supplied: replacing the
 * attestation material says nothing about the authority bundle, and neither
 * says anything about the folder the operator observed.
 */
export const INPUT_SLOTS = ["authority", "trust", "material", "observation", "evidence", "reopen"];

export function createRevisionTracker() {
  const revisions = new Map(INPUT_SLOTS.map((slot) => [slot, 0]));
  /** Moves on ANY input change: what a consumption was asked for. */
  let inputs = 0;
  let sessionId = null;

  return {
    /** What this input is on now. */
    revisionOf(slot) {
      return revisions.get(slot);
    },

    /** What every input taken together is on now. */
    inputsRevision() {
      return inputs;
    },

    /**
     * The operator changed this input.
     *
     * Called BEFORE a single byte is read, because what matters is which input
     * they had supplied when they supplied it, not which one they have by the
     * time the bytes are in memory.
     */
    begin(slot) {
      if (!revisions.has(slot)) throw new Error(`not a verification input: ${String(slot)}`);
      revisions.set(slot, revisions.get(slot) + 1);
      inputs += 1;
      return { sessionId, slot, revision: revisions.get(slot), inputs };
    },

    /**
     * Whether this token still describes what the operator has supplied.
     *
     * Two things have to hold: the input is still on the revision the token
     * captured, and the page is still in the session the token captured. A
     * token captured before any session existed belongs to whichever session
     * these very inputs open - and only to that one, because every other move
     * between sessions moves every revision.
     */
    isCurrent(token, currentSessionId) {
      if (token === null || token === undefined) return false;
      if (!revisions.has(token.slot)) return false;
      if (revisions.get(token.slot) !== token.revision) return false;
      return token.sessionId === null || token.sessionId === currentSessionId;
    },

    /**
     * The page moved to another session.
     *
     * Every open token is staled, so an upload captured for the session before
     * it can never attach to this one. The exception is a session that an
     * upload's own answer OPENED: the uploads already in flight were supplied
     * for exactly that session, before it had an id, so they keep their tokens.
     */
    sessionChanged(nextSessionId, { opened = false } = {}) {
      sessionId = nextSessionId ?? null;
      if (opened) return;
      for (const slot of INPUT_SLOTS) revisions.set(slot, revisions.get(slot) + 1);
      inputs += 1;
    },
  };
}
