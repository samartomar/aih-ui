/*
 * Every call the Governance pane makes to the preview backend.
 *
 * The page holds an opaque session id and never a filesystem path: the backend
 * owns the session directory and the operator files inside it. Nothing here
 * derives, normalises or repairs anything - it posts what the operator supplied
 * and returns what Core answered.
 */

async function api(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  return response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
}

/** Catalog-provided identity plus the digests Core derives from it. */
export function fetchSubject(entryId) {
  return api("/api/subject", { entryId });
}

/**
 * Catalog's own integrity result for one entry. Its own call because it is its
 * own answer, from a different owner, on a different timescale: it reads and
 * hashes every declared artifact in the installed index.
 */
export function fetchCatalogIntegrity(entryId) {
  return api("/api/catalog-integrity", { entryId });
}

/** Operator-imported evidence bytes, parsed by Core's own public parser. */
export function parseEvidence(evidenceBase64) {
  return api("/api/evidence", { evidenceBase64 });
}

/** Compile and save. The bytes Core returns are written unchanged. */
export function prepare(request) {
  return api("/api/prepare", request);
}

/**
 * One operator-supplied configuration file, by kind: "authority", "trust" or
 * "material". The page sends a kind, never a path.
 */
export function storeOperatorFile({ sessionId, kind, base64 }) {
  return api("/api/operator-file", { sessionId, kind, base64 });
}

/**
 * The operator's observation inputs: their upstream artifact manifest, the
 * root-relative directory the files sit under, and the files themselves with
 * the relative paths the folder selection carried. Bytes only - the page
 * parses nothing and decides nothing; Core checks them during consumption.
 */
export function storeObservation({ sessionId, installRoot, manifestBase64, files }) {
  return api("/api/observation", { sessionId, installRoot, manifestBase64, files });
}

/** A fresh session holding exactly the bytes the operator handed back. */
export function reopenFromFiles({ inputBase64, evidenceBase64 }) {
  return api("/api/reopen", { inputBase64, evidenceBase64 });
}

/** Reopen the saved bytes and consume them independently. */
export function consume(sessionId) {
  return api("/api/consume", { sessionId });
}

/** VALIDATION MODE. Has to be asked for by name; never part of the normal flow. */
export function loadValidationFixture(request) {
  return api("/api/validation-fixture", request);
}

/** The exact saved bytes, read back off disk. */
export function fetchSaved(sessionId, file) {
  return api("/api/saved", { sessionId, file });
}
