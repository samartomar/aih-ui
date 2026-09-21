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
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Where each operator-supplied file is kept inside a session.
 *
 * `operator/` sits beside the artifacts and OUTSIDE `consume-root/`, so the
 * authority bundle an operator controls is never inside the root that
 * consumption reads evidence from.
 */
const OPERATOR_FILES = {
  authority: { path: "operator/authority-bundle.json", records: "authorityBundlePath" },
  trust: { path: "operator/operator-trust.json", records: "operatorTrustPath" },
  material: { path: "attestation-material.json", records: "scanMaterialPath" },
};

/** The two artifacts a fresh session is reopened from, at the names consume reads. */
const REOPEN_FILES = {
  input: "governance-input.json",
  evidence: "organization-evidence.json",
};

function writeBytes(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  // Exactly the bytes that arrived. An operator's file is never reformatted:
  // Core's parsers check canonical bytes, and a re-serialized copy is refused.
  writeFileSync(path, bytes);
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function createSessions(runDir) {
  const sessionsRoot = join(runDir, "sessions");
  mkdirSync(sessionsRoot, { recursive: true });
  const known = new Map();

  return {
    /** Opens a directory for `id`, or for a fresh id when that one is unknown. */
    open(id) {
      return known.has(id) ? { sessionId: id, dir: join(sessionsRoot, id) } : this.create();
    },

    /**
     * A brand new session.
     *
     * It is registered as it is created: a session this server issued is one it
     * knows, so an operator file can be stored in it before anything else has
     * happened in it.
     */
    create() {
      const sessionId = randomUUID();
      const dir = join(sessionsRoot, sessionId);
      mkdirSync(dir, { recursive: true });
      known.set(sessionId, { mode: "operator-supplied" });
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

    /**
     * Stores one operator-supplied file in a session and records where it went.
     *
     * The page never names a path: it names a KIND, and the server decides the
     * location. What comes back describes the bytes - name, length, digest -
     * and never their contents.
     */
    storeOperatorFile(id, kind, bytes) {
      const spec = OPERATOR_FILES[kind];
      if (spec === undefined) return { ok: false, error: `unknown operator file kind: ${String(kind)}` };
      const dir = this.dirOf(id);
      if (dir === undefined) return { ok: false, error: "unknown session" };
      const path = join(dir, spec.path);
      writeBytes(path, bytes);
      known.set(id, { ...known.get(id), [spec.records]: path });
      return { ok: true, kind, storedAs: spec.path, byteLength: bytes.byteLength, sha256: sha256(bytes) };
    },

    /**
     * Opens a session holding exactly the bytes the operator handed back.
     *
     * Nothing is carried over from whatever session produced them: this one
     * knows only these two files, which is what makes the consumption that
     * follows independent.
     */
    openFromBytes({ inputBytes, evidenceBytes }) {
      const { sessionId, dir } = this.create();
      writeBytes(join(dir, REOPEN_FILES.input), inputBytes);
      writeBytes(join(dir, REOPEN_FILES.evidence), evidenceBytes);
      known.set(sessionId, { mode: "reopened-from-files" });
      return {
        sessionId,
        files: [
          { name: REOPEN_FILES.input, byteLength: inputBytes.byteLength, sha256: sha256(inputBytes) },
          { name: REOPEN_FILES.evidence, byteLength: evidenceBytes.byteLength, sha256: sha256(evidenceBytes) },
        ],
      };
    },
  };
}
