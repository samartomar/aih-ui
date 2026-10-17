// Raw HTTP probes: PowerShell's HTTP client normalizes the request URI, so the malformed-URL
// case has to be sent byte-for-byte over a socket.
import { connect } from "node:net";

const port = Number(process.argv[2] ?? 4199);
const targets = ["/%", "/%zz", "/%e0%a4%a", "/..%5csecrets", "/%00", "/catalog.js", "/"];

function request(path) {
  return new Promise((resolvePromise) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
    });
    let data = "";
    socket.setTimeout(5000, () => socket.destroy());
    socket.on("data", (chunk) => { data += chunk.toString("latin1"); });
    socket.on("error", (error) => resolvePromise({ path, status: `socket error ${error.message}` }));
    socket.on("close", () => {
      const statusLine = data.split("\r\n")[0] ?? "";
      const match = statusLine.match(/^HTTP\/1\.1 (\d+)/);
      resolvePromise({ path, status: match ? Number(match[1]) : `no status (${JSON.stringify(statusLine)})`, bytes: data.length });
    });
  });
}

for (const target of targets) {
  const result = await request(target);
  console.log(`GET ${target.padEnd(16)} -> ${result.status}${result.bytes ? ` (${result.bytes} bytes)` : ""}`);
}
const after = await request("/summary.json");
console.log(`after the malformed requests, GET /summary.json -> ${after.status} (${after.bytes} bytes)`);
