// Which "Reviewing as" identity applies: the setup default, until the person chooses one this page session.
export function createReviewIdentity() {
  let chosen = false, fromSetup = false;
  return {
    /** The person used "Use identity" (even to clear it): their choice now outranks setup. */
    choose() { chosen = true; fromSetup = false; },
    /** The saved setup identity (or null). Returns the change to apply, or undefined when nothing should change. */
    offer(reviewer) {
      if (chosen || (!reviewer && !fromSetup)) return undefined;
      fromSetup = Boolean(reviewer);
      return { recipient: reviewer ? { kind: reviewer.kind, id: reviewer.id } : undefined, fromSetup };
    },
  };
}
