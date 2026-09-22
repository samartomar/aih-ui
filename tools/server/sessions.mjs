/**
 * Server-owned session directories.
 *
 * The page holds an opaque id and can never name a path: every filesystem
 * location is derived from that id inside the run directory, and an id that is
 * not a uuid this server issued resolves to nothing.
 *
 * The operator-side inputs a session gathered (authority bundle, attestation
 * material, trust configuration, and the observation inputs: a manifest, an
 * install root and the files under it) are held here, beside the session and
 * never inside the material - material that carries its own trust is refused by
 * the service.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";

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

/**
 * Where the operator's observation inputs are kept inside a session.
 *
 * They are held here, beside the session, and copied into the consumption root
 * only when a consume actually runs. Nothing is installed, applied or executed:
 * the copy exists so Core has bytes to read at the paths the manifest names.
 */
const OBSERVATION = {
  dir: "observation",
  manifest: "observation/manifest.json",
  files: "observation/files",
};

/** What the server is willing to accept in one observation. */
const OBSERVATION_LIMITS = {
  files: 256,
  totalBytes: 16 * 1024 * 1024,
  pathLength: 512,
};

/** No control character belongs in a path a browser selection produced. */
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

/**
 * A bounded root-relative POSIX path: non-empty, no leading separator, no
 * backslash, no control character, no `.` or `..` segment, and short enough to
 * write.
 *
 * This is the server refusing to write outside the session it owns. It is not a
 * verification of anything: Core applies its own path grammar to the same
 * values during consumption, and that is what decides the observation.
 */
function isBoundedRelativePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= OBSERVATION_LIMITS.pathLength &&
    value === value.trim() &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !CONTROL_CHARACTER.test(value) &&
    value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  );
}

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
     * Stores the operator's observation inputs in a session: the upstream
     * artifact manifest, the root-relative directory their files sit under, and
     * the files themselves at the relative paths the folder selection carried.
     *
     * Every path is checked before a single byte is written, and the previous
     * observation is removed first, so what the session holds afterwards is
     * exactly what this request supplied - never a leftover from an earlier one.
     * What comes back describes the stored bytes, never their contents.
     */
    storeObservation(id, { installRoot, manifestBase64, files }) {
      const dir = this.dirOf(id);
      if (dir === undefined) return { ok: false, error: "unknown session" };
      if (!isBoundedRelativePath(installRoot)) {
        return {
          ok: false,
          error: `the install root is not a bounded root-relative path: ${JSON.stringify(installRoot)}`,
        };
      }
      if (typeof manifestBase64 !== "string" || manifestBase64.length === 0) {
        return { ok: false, error: "no manifest bytes were supplied" };
      }
      if (!Array.isArray(files) || files.length === 0) {
        return { ok: false, error: "no files were supplied for the install root" };
      }
      if (files.length > OBSERVATION_LIMITS.files) {
        return {
          ok: false,
          error: `${files.length} files were supplied; this session accepts at most ${OBSERVATION_LIMITS.files}`,
        };
      }

      const manifestBytes = Buffer.from(manifestBase64, "base64");
      const decoded = [];
      const seen = new Set();
      let total = manifestBytes.byteLength;
      for (const file of files) {
        const relativePath = file?.relativePath;
        if (!isBoundedRelativePath(relativePath)) {
          return {
            ok: false,
            error: `a supplied file has no bounded root-relative path: ${JSON.stringify(relativePath)}`,
          };
        }
        // One path, one file. Two entries differing only in case would collide
        // on a case-insensitive filesystem and one would silently win.
        const key = relativePath.toLowerCase();
        if (seen.has(key)) {
          return { ok: false, error: `two supplied files share one path: ${relativePath}` };
        }
        seen.add(key);
        if (typeof file.base64 !== "string") {
          return { ok: false, error: `no contents were supplied for ${relativePath}` };
        }
        const bytes = Buffer.from(file.base64, "base64");
        total += bytes.byteLength;
        if (total > OBSERVATION_LIMITS.totalBytes) {
          return {
            ok: false,
            error: `the supplied files exceed the ${OBSERVATION_LIMITS.totalBytes} byte ceiling for one observation`,
          };
        }
        decoded.push({ relativePath, bytes });
      }

      // This observation replaces whatever the session held, so the session
      // stops having one the moment the old files go. A failure below then
      // leaves no observation at all, never a record naming files that are gone.
      known.set(id, { ...known.get(id), observation: undefined });
      rmSync(join(dir, OBSERVATION.dir), { recursive: true, force: true });

      const stored = [
        { storedAs: OBSERVATION.manifest, relativePath: null, bytes: manifestBytes },
        ...decoded.map((file) => ({
          storedAs: posix.join(OBSERVATION.files, file.relativePath),
          relativePath: file.relativePath,
          bytes: file.bytes,
        })),
      ];
      for (const item of stored) {
        try {
          writeBytes(join(dir, ...item.storedAs.split("/")), item.bytes);
        } catch (error) {
          // A path this server accepted that the filesystem will not take is
          // still a refusal with a reason, never a half-written observation.
          rmSync(join(dir, OBSERVATION.dir), { recursive: true, force: true });
          return {
            ok: false,
            error: `${item.storedAs} could not be stored as supplied: ${error.code ?? error.message}`,
          };
        }
      }
      known.set(id, { ...known.get(id), observation: { installRoot } });

      const describe = (item) => ({
        storedAs: item.storedAs,
        byteLength: item.bytes.byteLength,
        sha256: sha256(item.bytes),
      });
      return {
        ok: true,
        installRoot,
        manifest: describe(stored[0]),
        files: stored
          .slice(1)
          .map((item) => ({ relativePath: item.relativePath, ...describe(item) })),
      };
    },

    /**
     * The observation a session holds, as the install root the operator named
     * and the directory their files were stored in - or undefined when they
     * supplied none. The page never sees either value.
     */
    observationOf(id) {
      const dir = this.dirOf(id);
      const recorded = known.get(id)?.observation;
      if (dir === undefined || recorded === undefined) return undefined;
      return { installRoot: recorded.installRoot, dir: join(dir, OBSERVATION.dir) };
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
