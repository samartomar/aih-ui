/**
 * The preview's HTTP API: routing and request handling only.
 *
 * The browser never touches a package, a filesystem path or a key. It posts a
 * small JSON request here; this module decides which operation that is, asks
 * the service for it (service-client.mjs) and hands back what came out.
 *
 * Session directories and operator-side paths belong to sessions.mjs.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { callService } from "./service-client.mjs";
import { createSessions } from "./sessions.mjs";

const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
/**
 * The observation carries a folder, not one document: its ceiling is the 16 MiB
 * of file bytes sessions.mjs accepts, plus the growth base64 costs and the paths
 * around it. Every other route keeps the smaller bound.
 */
const MAX_BODY_BYTES = { "/api/observation": 24 * 1024 * 1024 };

function readBody(request, limit) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > limit) {
        rejectBody(new Error("request body is too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolveBody(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        rejectBody(new Error(`malformed JSON body: ${error.message}`));
      }
    });
    request.on("error", rejectBody);
  });
}

/**
 * @param consumerDir the throwaway consumer holding the installed packages
 * @param runDir      the run directory that owns every session
 * @param summary     provenance shown in the page's strip
 */
export function createApi({ consumerDir, runDir, summary }) {
  const sessions = createSessions(runDir);

  const ROUTES = {
    /** Provenance of what is actually installed. */
    "GET /api/packages": () => ({ ok: true, ...summary }),

    /** Catalog-provided identity plus the digests Core derives from it. */
    "POST /api/subject": (body) => callService(consumerDir, { op: "subject", entryId: body.entryId }),

    /**
     * Catalog's own integrity result for one entry: the index digest, its
     * structure, whether the declared artifacts hash to their published sha256,
     * and which qualification evidence files are declared but NOT byte-checked
     * by that reader. A separate call because it is a separate answer.
     */
    "POST /api/catalog-integrity": (body) =>
      callService(consumerDir, { op: "catalogIntegrity", entryId: body.entryId }),

    /** Operator-imported evidence, parsed by Core's public parser. */
    "POST /api/evidence": (body) =>
      callService(consumerDir, { op: "parseEvidence", evidenceBase64: body.evidenceBase64 }),

    /**
     * VALIDATION MODE. Generates a labelled fixture and its matching operator
     * trust, so the plumbing can be exercised without a detector run. Never
     * reachable from the normal flow: the page has to ask for it by name.
     */
    "POST /api/validation-fixture": (body) => {
      const { sessionId, dir } = sessions.create();
      const built = callService(consumerDir, {
        op: "fixture",
        entryId: body.entryId,
        sessionDir: dir,
        target: body.target,
        effect: body.effect,
      });
      if (built.ok !== true) return built;
      sessions.record(sessionId, {
        entryId: body.entryId,
        // Operator-side inputs, kept server-side and keyed by session.
        authorityBundlePath: built.authorityBundlePath,
        scanMaterialPath: built.scanMaterialPath,
        operatorTrustPath: built.operatorTrustPath,
        mode: "validation-fixture",
      });
      return { ...built, sessionId };
    },

    /**
     * Operator-supplied configuration: the authority bundle, the verifier trust
     * and the scan attestation material, each as its own kind.
     *
     * They are stored separately from the imported evidence and from each
     * other. The page sends a kind and bytes; the server decides where they go
     * and answers with a description of the bytes, never their contents.
     */
    "POST /api/operator-file": (body) => {
      const { sessionId } = sessions.open(body.sessionId);
      if (typeof body.base64 !== "string" || body.base64.length === 0) {
        return { ok: false, error: "no file contents were supplied" };
      }
      const stored = sessions.storeOperatorFile(sessionId, body.kind, Buffer.from(body.base64, "base64"));
      return stored.ok === false ? stored : { ...stored, sessionId };
    },

    /**
     * The operator's observation inputs: their upstream artifact manifest, the
     * root-relative directory the files sit under, and the files themselves.
     *
     * The page sends bytes and relative paths; the server decides where they go
     * and refuses, with a reason, anything it is not willing to write. Nothing
     * is checked against the evidence here - Core does that during consumption,
     * and nothing is installed, applied or executed anywhere.
     */
    "POST /api/observation": (body) => {
      const { sessionId } = sessions.open(body.sessionId);
      const stored = sessions.storeObservation(sessionId, body);
      return stored.ok === false ? stored : { ...stored, sessionId };
    },

    /**
     * A fresh session holding exactly the bytes an operator downloaded earlier.
     *
     * It carries nothing from the session that produced them. Consumption then
     * re-derives the whole verdict from these bytes - and refuses them if they
     * were altered, re-serialized or truncated in between.
     */
    "POST /api/reopen": (body) => {
      if (typeof body.inputBase64 !== "string" || typeof body.evidenceBase64 !== "string") {
        return { ok: false, error: "both governance-input.json and the evidence envelope are needed" };
      }
      const opened = sessions.openFromBytes({
        inputBytes: Buffer.from(body.inputBase64, "base64"),
        evidenceBytes: Buffer.from(body.evidenceBase64, "base64"),
      });
      return { ok: true, ...opened };
    },

    /** Compile and save. Core's bytes are written unchanged. */
    "POST /api/prepare": (body) => {
      // A fixture session already exists; a normal preparation opens a new one.
      const { sessionId, dir } = sessions.open(body.sessionId);
      const existing = sessions.get(sessionId) ?? { mode: "operator-supplied" };
      const prepared = callService(consumerDir, {
        op: "prepare",
        entryId: body.entryId,
        route: body.route,
        target: body.target,
        effect: body.effect,
        decisionId: body.decisionId,
        decisionDigest: body.decisionDigest,
        evidenceBase64: body.evidenceBase64,
        bindingClaim: body.bindingClaim ?? null,
        sessionDir: dir,
      });
      if (prepared.ok !== true) return prepared;
      sessions.record(sessionId, { ...existing, entryId: body.entryId, preparedAt: new Date().toISOString() });
      return { ...prepared, sessionId };
    },

    /**
     * Reopen the saved bytes and consume them independently. Nothing from the
     * preparation step is carried across: the verdict is re-derived from the
     * files on disk.
     */
    "POST /api/consume": (body) => {
      const dir = sessions.dirOf(body.sessionId);
      if (dir === undefined) return { ok: false, error: "unknown session" };
      const session = sessions.get(body.sessionId);
      return callService(consumerDir, {
        op: "consume",
        sessionDir: dir,
        authorityBundlePath: session.authorityBundlePath ?? null,
        scanMaterialPath: session.scanMaterialPath ?? null,
        operatorTrustPath: session.operatorTrustPath ?? null,
        // The observation this session gathered, if any: the install root the
        // operator named and the directory holding what they supplied.
        observation: sessions.observationOf(body.sessionId) ?? null,
      });
    },

    /**
     * The exact saved bytes, for download. Read back off disk rather than
     * remembered, so what the operator downloads is what was written.
     */
    "POST /api/saved": (body) => {
      const dir = sessions.dirOf(body.sessionId);
      if (dir === undefined) return { ok: false, error: "unknown session" };
      const name = body.file === "evidence" ? "organization-evidence.json" : "governance-input.json";
      const path = join(dir, name);
      try {
        statSync(path);
      } catch {
        return { ok: false, error: `${name} has not been saved in this session` };
      }
      const bytes = readFileSync(path);
      return { ok: true, name, byteLength: bytes.byteLength, base64: bytes.toString("base64") };
    },
  };

  return async function handleApi(request, response, pathname) {
    const route = ROUTES[`${request.method} ${pathname}`];
    if (route === undefined) return false;

    const send = (status, value) => {
      response
        .writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
        .end(JSON.stringify(value));
    };

    try {
      const body =
        request.method === "POST"
          ? await readBody(request, MAX_BODY_BYTES[pathname] ?? MAX_REQUEST_BYTES)
          : {};
      const value = await route(body);
      send(value?.ok === false ? 422 : 200, value);
    } catch (error) {
      // Surface the failure; never substitute a success.
      send(400, { ok: false, error: error?.message ?? String(error) });
    }
    return true;
  };
}
