/**
 * The preview's local setup and package-provenance API: routing and request
 * handling only. Authoring, readiness and batch routes have their own adapters
 * (see workbench.mjs).
 */
import { createSettingsStore } from "./settings.mjs";

// Matches the consumer host: policy and envelope bytes travel as JSON number arrays.
const MAX_REQUEST_BYTES = 48 * 1024 * 1024;
/** Local setup bodies are small; every other route keeps the general bound. */
const MAX_BODY_BYTES = { "/api/workbench-settings": 16384, "/api/workbench-settings/update": 16384, "/api/workbench-settings/clients": 16384, "/api/workbench-settings/mode": 16384 };

function readBody(request, limit) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > limit) {
        rejectBody(new Error("request body is too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolveBody(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        rejectBody(new Error(`malformed JSON body: ${error.message}`));
      }
    });
    request.on("error", rejectBody);
  });
}

/**
 * @param summary     provenance shown in the page's strip
 * @param settingsPath optional isolated test-store path; never an HTTP input
 * @param contractCheck the promise of the start-up contract check (tools/server/contract-check-summary.mjs)
 * @param tools, toolInspection the header's Your tool answers, each started on first request (tools/server/tools-summary.mjs)
 */
export function createApi({ summary, settingsPath, contractCheck, tools, toolInspection }) {
  // Setup's tools are checked against Core's tool list, the one GET /api/tools gives the page.
  const store = async () => createSettingsStore({ tools: tools ? await tools() : undefined, settingsPath });
  const settings = createSettingsStore({ settingsPath });

  const ROUTES = {
    "GET /api/workbench-settings": () => settings.read(),
    "POST /api/workbench-settings": async (body) => (await store()).create(body),
    "POST /api/workbench-settings/update": async (body) => (await store()).update(body),
    "POST /api/workbench-settings/mode": (body) => settings.switchMode(body),
    "POST /api/workbench-settings/clients": async (body) => (await store()).updateClients(body),
    /** Provenance of what is actually installed. */
    "GET /api/packages": () => ({ ok: true, ...summary }),
    /** The start-up contract check; it answers once the check the host started has finished. */
    "GET /api/contract-check": async () => ({ ok: true, ...(await contractCheck) }),
    /** Your tool: Harness listTools, and each tool's state from Core's offline inspection. */
    "GET /api/tools": async () => ({ ok: true, ...(await tools()) }),
    "GET /api/tool-inspection": async () => ({ ok: true, ...(await toolInspection()) }),
  };

  return async function handleApi(request, response, pathname) {
    const route = ROUTES[`${request.method} ${pathname}`];
    if (route === undefined) return false;

    const send = (status, value) => {
      response
        .writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
        .end(JSON.stringify(value));
    };

    try {
      if (pathname.startsWith("/api/workbench-settings")) {
        const host = request.headers.host;
        const allowedHosts = [`127.0.0.1:${request.socket.localPort}`, `localhost:${request.socket.localPort}`];
        if (!allowedHosts.includes(host) || (request.headers.origin && request.headers.origin !== `http://${host}`) || request.headers["sec-fetch-site"] === "cross-site") {
          send(403, { ok: false, error: "Local setup requires a same-origin request." });
          return true;
        }
        if (request.method === "POST" && request.headers["content-type"]?.split(";")[0].trim() !== "application/json") {
          send(415, { ok: false, error: "Local setup requires application/json." });
          return true;
        }
      }
      const body =
        request.method === "POST"
          ? await readBody(request, MAX_BODY_BYTES[pathname] ?? MAX_REQUEST_BYTES)
          : {};
      const value = await route(body);
      send(value?.ok === false ? (value.status ?? 422) : 200, value);
    } catch (error) {
      // Surface the failure; never substitute a success.
      send(400, { ok: false, error: error?.message ?? String(error) });
    }
    return true;
  };
}
