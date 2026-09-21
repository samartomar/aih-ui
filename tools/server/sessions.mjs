/**
 * Server-owned session directories.
 *
 * The page holds an opaque id and can never name a path: every filesystem
 * location is derived from that id inside the run directory, and an id that is
 * not a uuid this server issued resolves to nothing.
 *
 * The operator-side inputs a session gathered (authority bundle, attestation
 * material, trust configuration) are held here, beside the session and never
 * inside the material - material that carries its own trust is refused by the
 * service.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function createSessions(runDir) {
  const sessionsRoot = join(runDir, "sessions");
  mkdirSync(sessionsRoot, { recursive: true });
  const known = new Map();

  return {
    /** Opens a directory for `id`, or for a fresh id when that one is unknown. */
    open(id) {
      const sessionId = known.has(id) ? id : randomUUID();
      const dir = join(sessionsRoot, sessionId);
      mkdirSync(dir, { recursive: true });
      return { sessionId, dir };
    },

    /** A brand new session, for the validation fixture. */
    create() {
      const sessionId = randomUUID();
      const dir = join(sessionsRoot, sessionId);
      mkdirSync(dir, { recursive: true });
      return { sessionId, dir };
    },

    record(id, value) {
      known.set(id, { ...(known.get(id) ?? {}), ...value });
    },

    get(id) {
      return known.get(id);
    },

    /** The directory for an id this server issued, or undefined. */
    dirOf(id) {
      if (typeof id !== "string" || !SESSION_ID.test(id) || !known.has(id)) return undefined;
      return join(sessionsRoot, id);
    },
  };
}
