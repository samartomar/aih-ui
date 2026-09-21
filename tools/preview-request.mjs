/*
 * Request-path classification for the preview's static server.
 *
 * tools/preview.mjs serves the page files and the resolved catalog index; it never executes
 * anything a request names. The classification is kept here, apart from the server, so the
 * malformed-URL behavior can be exercised without starting a preview.
 */

import { resolve, sep } from "node:path";

/**
 * @param {unknown} requestUrl raw `request.url`, before any parsing
 * @param {string} root run directory that may be served
 * @returns {{ status: 200, file: string } | { status: 400 | 403, reason: string }}
 */
export function classifyRequestPath(requestUrl, root) {
  let relative;
  try {
    const requested = new URL(typeof requestUrl === "string" ? requestUrl : "/", "http://127.0.0.1");
    // "/" is the page. The run directory mirrors src/ at its root, so every other
    // path is the module or asset the page references, at the path it references.
    relative = decodeURIComponent(requested.pathname === "/" ? "/index.html" : requested.pathname);
  } catch {
    // A malformed request URL or a bad percent escape is the client's mistake: 400, keep serving.
    return { status: 400, reason: "malformed request URL" };
  }
  // Traversal is refused on the decoded path: a NUL byte, any backslash (a separator on
  // Windows, never part of a name this server publishes), or a ".." segment.
  const segments = relative.split("/");
  if (relative.includes("\0") || relative.includes("\\") || segments.includes("..")) {
    return { status: 403, reason: "path traversal" };
  }
  const file = resolve(root, `.${segments.join(sep)}`);
  if (file !== root && !file.startsWith(`${root}${sep}`)) {
    return { status: 403, reason: "outside the served directory" };
  }
  return { status: 200, file };
}
