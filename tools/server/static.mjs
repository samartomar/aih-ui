/**
 * The static half of the preview server.
 *
 * `request.url` is attacker-controlled, so nothing from it is used before it
 * parses: preview-request.mjs classifies the path, a malformed URL or percent
 * escape is answered 400 and the server keeps serving, and whatever is served
 * is inside the run directory.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

import { classifyRequestPath } from "../preview-request.mjs";

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

export function createStaticServer(root, handleApi) {
  return createServer(async (request, response) => {
    // The API is checked first and owns its own paths. Its handler returns false
    // for anything it does not claim, and the static path takes over from there.
    let pathname;
    try {
      pathname = new URL(request.url, "http://127.0.0.1").pathname;
    } catch {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("bad request");
      return;
    }
    if (pathname.startsWith("/api/")) {
      if (await handleApi(request, response, pathname)) return;
      response
        .writeHead(404, { "content-type": "application/json; charset=utf-8" })
        .end(JSON.stringify({ ok: false, error: `no such endpoint: ${pathname}` }));
      return;
    }

    const classified = classifyRequestPath(request.url, root);
    if (classified.status !== 200) {
      response
        .writeHead(classified.status, { "content-type": "text/plain; charset=utf-8" })
        .end(classified.status === 400 ? "bad request" : "forbidden");
      return;
    }
    const { file } = classified;
    let body;
    try {
      body = readFileSync(file);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
      return;
    }
    response.writeHead(200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(body);
  });
}

export function listen(server, port) {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, "127.0.0.1", () => resolveListen(server.address()));
  });
}
