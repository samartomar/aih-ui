/**
 * Backend worker for the Policy Workbench preview: the operation dispatcher.
 *
 * This directory is COPIED INTO the throwaway consumer that tools/preview.mjs
 * creates, and is run from there. Every package import in these modules is a
 * bare specifier resolved through that consumer's installed packages: no
 * `npm link`, no sibling checkout, no `dist/` deep import, no source fallback.
 * If a name is not a public export of the installed tarball, the worker fails
 * to load - which is the point.
 *
 * Protocol: one JSON request on stdin, one JSON response on stdout.
 *   { "op": "...", ... }  ->  { "ok": true, ... } | { "ok": false, "error": "..." }
 *
 * Node-only APIs (filesystem, crypto, package resolution) live here and nowhere
 * near the browser. The page never sees a filesystem path it did not supply.
 *
 * Where the work actually happens:
 *   catalog-access.mjs     the installed @aihq/catalog, through its export map
 *   core-adapter.mjs       calls to @aihq/core's public API
 *   scan-verifier.mjs      the Scan verifier wiring and its trust boundary
 *   artifacts.mjs          exact-byte artifact I/O
 *   catalog-collections.mjs Catalog's current collection view
 *   core-targets.mjs       Core's supported AI CLI targets
 *   validation-fixture.mjs VALIDATION ONLY: the one module that manufactures
 *                          anything, and it labels everything it makes
 */
import { catalogEntry, catalogIntegrity, entryContentDir } from "./catalog-access.mjs";
import { consume, parseEvidence, prepare, subject } from "./core-adapter.mjs";
import { buildValidationFixture } from "./validation-fixture.mjs";

const OPS = {
  /** Identity only. Structure is validated; artifact bytes are not read. */
  subject({ entryId }) {
    const { entry, root } = catalogEntry(entryId);
    return subject({ entryId, entry, contentDir: entryContentDir(entry, root) });
  },

  /**
   * Catalog's own integrity result, as its own operation.
   *
   * verifyArtifacts makes Catalog read and hash every declared artifact in the
   * index against its published sha256 - about 1800 files, so this is a second
   * or so and deliberately not on the selection path. It is Catalog's answer
   * about Catalog's bytes and is reported separately from everything else.
   */
  catalogIntegrity({ entryId }) {
    const { entry, content } = catalogEntry(entryId, { verifyArtifacts: true });
    return catalogIntegrity(content, entry);
  },
  parseEvidence,
  prepare,
  consume,
  fixture: buildValidationFixture,

  /**
   * Catalog's current collection view and Core's supported target list. Each
   * is loaded only when asked for, so a package that predates the export fails
   * that one operation and says so, instead of every operation failing to load.
   */
  async collections() {
    const { catalogCollections } = await import("./catalog-collections.mjs");
    return catalogCollections();
  },
  async coreTargets() {
    const { coreTargets } = await import("./core-targets.mjs");
    return coreTargets();
  },
};

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  let request;
  try {
    request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: `malformed request: ${error.message}` }));
    return;
  }
  const operation = OPS[request.op];
  if (operation === undefined) {
    process.stdout.write(JSON.stringify({ ok: false, error: `unknown op: ${String(request.op)}` }));
    return;
  }
  try {
    const value = await operation(request);
    process.stdout.write(JSON.stringify({ ok: true, ...value }));
  } catch (error) {
    // Report the failure; never substitute a success or a generated stand-in.
    process.stdout.write(JSON.stringify({ ok: false, error: error?.message ?? String(error) }));
  }
}

await main();
