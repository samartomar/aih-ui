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
 * Where the work actually happens:
 *   core-targets.mjs       Core's supported AI client ids and labels
 *   tools.mjs              the header's tool list (Harness listTools) and its inspection
 *   contract-check.mjs     the start-up contract check
 */
const OPS = {
  /** Loaded only when asked for, so a Core that predates the export fails this one operation and says so. */
  async coreTargets() {
    const { coreTargets } = await import("./core-targets.mjs");
    return coreTargets();
  },
  /** The header's tool list: Harness listTools with each unobserved tool's refusal, or why Core does not publish it. */
  async tools() {
    const { tools } = await import("./tools.mjs");
    return tools();
  },
  /** Each tool's existence/run state from Core's offline inspection. */
  async toolInspection() {
    const { toolInspection } = await import("./tools.mjs");
    return toolInspection();
  },
  /** The start-up contract check: Core's checkContracts over the installed declarations, or why it cannot run. */
  async contractCheck() {
    const { contractCheck } = await import("./contract-check.mjs");
    return contractCheck();
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
  const operation = Object.hasOwn(OPS, request.op) ? OPS[request.op] : undefined;
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
