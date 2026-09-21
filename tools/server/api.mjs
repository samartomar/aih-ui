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

function readBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_REQUEST_BYTES) {
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
      const body = request.method === "POST" ? await readBody(request) : {};
      const value = await route(body);
      send(value?.ok === false ? 422 : 200, value);
    } catch (error) {
      // Surface the failure; never substitute a success.
      send(400, { ok: false, error: error?.message ?? String(error) });
    }
    return true;
  };
}
