/**
 * The seam between the server and the installed packages.
 *
 * The server never imports @aihq/core, @aihq/scan or @aihq/catalog. It runs the
 * worker in the throwaway consumer, where those names resolve to the installed
 * tarballs, and exchanges one JSON request for one JSON response. That is what
 * keeps the preview honest about what a package actually publishes: an API that
 * is not exported does not resolve there.
 */
import { spawn, spawnSync } from "node:child_process";

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

/** The same request without blocking the server: for the start-up contract check, which the page shows as loading meanwhile. */
// A check that never answers would leave the page loading for good; past this it is the failed state.
export const ASYNC_SERVICE_TIMEOUT_MS = 120_000;
export function callServiceAsync(consumerDir, request, { timeoutMs = ASYNC_SERVICE_TIMEOUT_MS } = {}) {
  return new Promise((resolveAnswer) => {
    const child = spawn(process.execPath, [SERVICE_ENTRY], { cwd: consumerDir, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const timer = setTimeout(() => { child.kill(); resolveAnswer({ ok: false, error: `core service did not answer within ${Math.round(timeoutMs / 1000)}s` }); }, timeoutMs);
    timer.unref?.();
    child.on("close", () => clearTimeout(timer));
    const out = [], err = [];
    child.stdout.on("data", chunk => out.push(chunk));
    child.stderr.on("data", chunk => err.push(chunk));
    child.on("error", error => resolveAnswer({ ok: false, error: `core service failed: ${error.message}` }));
    child.on("close", status => {
      const stdout = Buffer.concat(out).toString("utf8");
      if (status !== 0) return resolveAnswer({ ok: false, error: `core service exited ${status}: ${Buffer.concat(err).toString("utf8").trim().slice(0, 2000)}` });
      try { resolveAnswer(JSON.parse(stdout)); } catch { resolveAnswer({ ok: false, error: `core service returned unparseable output: ${stdout.slice(0, 500)}` }); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}
