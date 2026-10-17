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
 *   core-targets.mjs       Core's supported AI client ids and labels
 *   validation-fixture.mjs VALIDATION ONLY: the one module that manufactures
 *                          anything, and it labels everything it makes
 */
let catalogEntry, catalogIntegrity, entryContentDir;
let consume, parseEvidence, prepare, subject, buildValidationFixture;
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
  parseEvidence(request) { return parseEvidence(request); },
  prepare(request) { return prepare(request); },
  consume(request) { return consume(request); },
  fixture(request) { return buildValidationFixture(request); },

  /**
   * Core's supported target list and the policy-file reviews. Each is loaded
   * only when asked for, so a package that predates the export fails that one
   * operation and says so, instead of every operation failing to load.
   */
  async coreTargets() {
    const { coreTargets } = await import("./core-targets.mjs");
    return coreTargets();
  },
  async policyBundleStructure({ base64 }) {
    const { reviewPolicyBundle } = await import("./policy-review.mjs");
    return reviewPolicyBundle({ base64 });
  },
  async governanceDecisionStructure({ base64 }) {
    const { reviewGovernanceDecision } = await import("./policy-review.mjs");
    return reviewGovernanceDecision({ base64 });
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
    if (['subject', 'catalogIntegrity', 'parseEvidence', 'prepare', 'consume', 'fixture'].includes(request.op)) {
      ({ catalogEntry, catalogIntegrity, entryContentDir } = await import('./catalog-access.mjs'));
      ({ consume, parseEvidence, prepare, subject } = await import('./core-adapter.mjs'));
      ({ buildValidationFixture } = await import('./validation-fixture.mjs'));
    }
    const value = await operation(request);
    process.stdout.write(JSON.stringify({ ok: true, ...value }));
  } catch (error) {
    // Report the failure; never substitute a success or a generated stand-in.
    process.stdout.write(JSON.stringify({ ok: false, error: error?.message ?? String(error) }));
  }
}

await main();
