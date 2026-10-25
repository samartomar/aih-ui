/**
 * The preview's local setup and package-provenance API: routing and request
 * handling only. Authoring, readiness and batch routes have their own adapters
 * (see workbench.mjs).
 */
import { createSettingsStore } from "./settings.mjs";

const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
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
 */
export function createApi({ summary, settingsPath }) {
  const settings = createSettingsStore({ coreTargets: summary?.coreTargets, settingsPath });

  const ROUTES = {
    "GET /api/workbench-settings": () => settings.read(),
    "POST /api/workbench-settings": (body) => settings.create(body),
    "POST /api/workbench-settings/update": (body) => settings.update(body),
    "POST /api/workbench-settings/mode": (body) => settings.switchMode(body),
    "POST /api/workbench-settings/clients": (body) => settings.updateClients(body),
    /** Provenance of what is actually installed. */
    "GET /api/packages": () => ({ ok: true, ...summary }),
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
