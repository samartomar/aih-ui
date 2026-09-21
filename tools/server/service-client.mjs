/**
 * The seam between the server and the installed packages.
 *
 * The server never imports @aihq/core, @aihq/scan or @aihq/catalog. It runs the
 * worker in the throwaway consumer, where those names resolve to the installed
 * tarballs, and exchanges one JSON request for one JSON response. That is what
 * keeps the preview honest about what a package actually publishes: an API that
 * is not exported does not resolve there.
 */
import { spawnSync } from "node:child_process";

/** Where the service entry point sits inside the consumer. */
export const SERVICE_ENTRY = "service/core-service.mjs";

/** One request, one child process, in the consumer's own resolution context. */
export function callService(consumerDir, request) {
  const result = spawnSync(process.execPath, [SERVICE_ENTRY], {
    cwd: consumerDir,
    input: JSON.stringify(request),
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error) return { ok: false, error: `core service failed: ${result.error.message}` };
  if (result.status !== 0) {
    return {
      ok: false,
      error: `core service exited ${result.status}: ${(result.stderr ?? "").trim().slice(0, 2000)}`,
    };
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    return { ok: false, error: `core service returned unparseable output: ${result.stdout.slice(0, 500)}` };
  }
}
