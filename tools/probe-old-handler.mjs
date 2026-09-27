// Evidence for the malformed-URL bug: run the pre-fix static server handler (from git HEAD)
// on a throwaway port and send the same request. The old handler called decodeURIComponent
// without a guard, so a bad percent escape threw out of the request listener.
import { connect } from "node:net";
import { createHash } from "node:crypto";
import { createServer } from "node:http";

const root = process.cwd();
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
const { readFileSync } = await import("node:fs");
const { resolve, sep, extname } = await import("node:path");

function oldServer() {
  return createServer((request, response) => {
    const requested = new URL(request.url ?? "/", "http://127.0.0.1");
    const relative = requested.pathname === "/" ? "/src/index.html" : requested.pathname;
    const file = resolve(root, `.${decodeURIComponent(relative)}`);
    if (!file.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end("forbidden");
      return;
    }
    let body;
    try {
      body = readFileSync(file);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
      return;
    }
    response.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }).end(body);
  });
}

const server = oldServer();
await new Promise((done) => server.listen(4201, "127.0.0.1", done));

function raw(path) {
  return new Promise((done) => {
    const socket = connect(4201, "127.0.0.1", () => socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:4201\r\nConnection: close\r\n\r\n`));
    let data = "";
    socket.setTimeout(4000, () => socket.destroy());
    socket.on("data", (chunk) => { data += chunk.toString("latin1"); });
    socket.on("error", (error) => done(`socket error: ${error.message}`));
    socket.on("close", () => done(data.split("\r\n")[0] || "(no response)"));
  });
}

process.on("uncaughtException", (error) => {
  console.log(`uncaughtException from the pre-fix handler: ${error.name}: ${error.message}`);
  console.log("the process would exit here, killing the preview");
  process.exit(0);
});

console.log(`pre-fix: GET /catalog.js -> ${await raw("/catalog.js")}`);
console.log(`pre-fix: GET /%zz -> ${await raw("/%zz")}`);
setTimeout(async () => {
  console.log(`pre-fix: after that, GET /catalog.js -> ${await raw("/catalog.js")}`);
  process.exit(0);
}, 500);
