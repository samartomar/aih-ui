#!/usr/bin/env node
/*
 * Builds a throwaway preview of the Policy Workbench and serves it on 127.0.0.1.
 *
 * All three packages are consumed the way an outside developer consumes them: npm pack,
 * install the tarballs into a throwaway consumer with --ignore-scripts, then resolve every
 * entry point through the installed packages' export maps. No repository's source tree is
 * read, no `dist/` is deep-imported, and npm link is never used.
 *
 * Installing @aihq/core@0.6.2, @aihq/scan@0.4.0 or @aihq/catalog@0.2.0 FROM NPM does not
 * provide the APIs this preview needs: the published versions predate them. Only the local
 * tarballs carry the governance-input contract.
 *
 * Two halves:
 *   - a static page, served from the run directory;
 *   - an API (tools/preview-api.mjs) that runs tools/core-service.mjs inside the consumer.
 *     Every Node-only package API and every filesystem access lives on that side.
 *
 * The generated run directory lives outside every repository. Nothing is copied back into
 * the UI repository.
 *
 * Usage: node tools/preview.mjs [--port 4173] [--quiet]
 *
 * Environment: CORE_TGZ / SCAN_TGZ / CATALOG_TGZ use a supplied tarball instead of packing
 * a checkout; CORE_REPO / SCAN_REPO / CATALOG_REPO name the checkouts to read from.
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { EXPECTED_FORMAT, EXPECTED_VERSION, contractViolations } from "./catalog-index-contract.mjs";
import { installConsumer, resolvePackage } from "./packages.mjs";
import { createApi } from "./preview-api.mjs";
import { classifyRequestPath } from "./preview-request.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, ".."); // the aih-ui checkout this tool belongs to

const CATALOG_INDEX_EXPORT = "@aihq/catalog/catalog-index.json";
const CATALOG_PACKAGE = "@aihq/catalog";

// Page files that make up the served page. Each is copied into the run directory.
const PAGE_FILES = ["src/index.html", "src/catalog.js", "src/governance.js"];
// Backend files copied INTO the consumer, where the installed packages resolve.
const SERVICE_FILES = ["tools/core-service.mjs", "tools/fixture-candidate.mjs"];
// Presentation-only assets carried over from the design source (prototype/), unmodified.
const PRESENTATION_FILES = [
  // The design authority, served from the SAME origin so it can be compared at
  // identical viewport, fonts and zoom. Screenshots taken at different origins
  // or zoom levels are not a comparison.
  "prototype/screens/admin-sources.html",
  // The side-by-side / difference comparison page, at /compare.html.
  "tools/compare.html",
  "prototype/screens/tokens.css",
  "prototype/screens/fonts.css",
  "prototype/screens/wb.css",
  "prototype/screens/mode.js",
  "prototype/screens/tw-config.js",
];

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const args = process.argv.slice(2);
const QUIET = args.includes("--quiet");
const portArg = args.indexOf("--port");
const PORT = portArg >= 0 ? Number(args[portArg + 1]) : 4173;
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  fatal(`--port must be an integer between 1 and 65535 (received ${args[portArg + 1]})`);
}

function log(message) {
  if (!QUIET) process.stdout.write(`${message}\n`);
}

function fatal(message) {
  process.stderr.write(`preview: ${message}\n`);
  process.exit(1);
}

/* ------------------------------------------------------------------ commands */




function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fatal(`could not read JSON at ${path}: ${error.message}`);
  }
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}



/* ------------------------------------------------------------------- resolve */

async function resolveIndexThroughExportMap(consumerDir) {
  const resolver = join(consumerDir, "resolve-catalog-index.mjs");
  writeFileSync(
    resolver,
    [
      "// Resolves the public catalog index through the installed package export map.",
      `const url = import.meta.resolve(${JSON.stringify(CATALOG_INDEX_EXPORT)});`,
      "process.stdout.write(url);",
      "",
    ].join("\n"),
  );
  const resolved = spawnSync(process.execPath, [resolver], { cwd: consumerDir, encoding: "utf8" });
  if (resolved.error) fatal(`could not resolve ${CATALOG_INDEX_EXPORT}: ${resolved.error.message}`);
  if (resolved.status !== 0) {
    process.stderr.write(resolved.stderr ?? "");
    fatal(
      `${CATALOG_INDEX_EXPORT} did not resolve through the installed package (exit code ${resolved.status})`,
    );
  }
  const url = resolved.stdout.trim();
  if (!url.startsWith("file:")) fatal(`${CATALOG_INDEX_EXPORT} resolved to a non-file URL: ${url}`);
  const path = fileURLToPath(url);
  try {
    if (!statSync(path).isFile()) throw new Error("not a file");
  } catch (error) {
    fatal(`${CATALOG_INDEX_EXPORT} resolved to ${path}, which is not readable: ${error.message}`);
  }
  return path;
}

function readInstalledPackageJson(consumerDir) {
  const path = join(consumerDir, "node_modules", ...CATALOG_PACKAGE.split("/"), "package.json");
  const pkg = readJson(path);
  if (typeof pkg.version !== "string") fatal(`${path} has no version string`);
  return { path, name: pkg.name, version: pkg.version };
}

/* --------------------------------------------------------------------- server */

function createStaticServer(root, handleApi) {
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

    // request.url is attacker-controlled; preview-request.mjs classifies it, and nothing from
    // it is used before it parses. A malformed URL or bad percent escape answers 400 and the
    // server keeps serving.
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

function listen(server, port) {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, "127.0.0.1", () => resolveListen(server.address()));
  });
}

/* ----------------------------------------------------------------------- main */

async function main() {
  const repos = {
    core: process.env.CORE_REPO ?? resolve(REPO_ROOT, "..", "ai-harness"),
    scan: process.env.SCAN_REPO ?? resolve(REPO_ROOT, "..", "aih-scan"),
    catalog: process.env.CATALOG_REPO ?? resolve(REPO_ROOT, "..", "aih-catalog"),
  };
  for (const relative of [...PAGE_FILES, ...SERVICE_FILES, ...PRESENTATION_FILES]) {
    try {
      if (!statSync(join(REPO_ROOT, relative)).isFile()) throw new Error("not a file");
    } catch (error) {
      fatal(`asset ${relative} is missing from ${REPO_ROOT}: ${error.message}`);
    }
  }

  const runDir = mkdtempSync(join(tmpdir(), "aih-ui-preview-"));
  const consumerDir = join(runDir, "consumer");
  mkdirSync(consumerDir, { recursive: true });
  log(`run: new temp folder outside every repo -> ${runDir}`);

  // --- 1. the three packages, as tarballs -----------------------------------
  //
  // A checkout another worker is mid-change is read only through git: its
  // committed checkpoint is snapshotted and built elsewhere, never in place.
  let packages;
  try {
    packages = ["core", "scan", "catalog"].map((name) =>
      resolvePackage({
        name,
        repo: repos[name],
        supplied: process.env[`${name.toUpperCase()}_TGZ`],
        workspace: runDir,
        log,
      }),
    );
  } catch (error) {
    fatal(error.message);
  }
  for (const pkg of packages) {
    log(`${pkg.name}: ${pkg.sha256}  (${pkg.commit.slice(0, 12)}, ${pkg.source})`);
  }

  // --- 2. one throwaway consumer with all three installed -------------------
  try {
    installConsumer({
      consumerDir,
      packages,
      extraFiles: Object.fromEntries(
        SERVICE_FILES.map((relative) => [relative.split("/").pop(), join(REPO_ROOT, relative)]),
      ),
      log,
    });
  } catch (error) {
    fatal(error.message);
  }

  // --- 3. the index, through the installed export map -----------------------
  const indexPath = await resolveIndexThroughExportMap(consumerDir);
  const index = readJson(indexPath);
  const violations = contractViolations(index);
  if (violations.length) fatal(violations.join("; "));
  log(
    `index: ${CATALOG_INDEX_EXPORT} -> ${indexPath} (format ${index.format}, version ${index.version}, ${index.entries.length} entries)`,
  );
  const installed = readInstalledPackageJson(consumerDir);
  const catalogPkg = packages.find((pkg) => pkg.name === "catalog");

  // --- 4. page files into the run directory ---------------------------------
  for (const relative of PAGE_FILES) {
    const target = join(runDir, relative);
    mkdirSync(dirname(target), { recursive: true });
    await copyFile(join(REPO_ROOT, relative), target);
    // Also at the run root, so the page loads each module by plain name.
    await copyFile(join(REPO_ROOT, relative), join(runDir, relative.split("/").pop()));
  }
  for (const relative of PRESENTATION_FILES) {
    await copyFile(join(REPO_ROOT, relative), join(runDir, relative.split("/").pop()));
  }
  const indexTarget = join(runDir, "catalog-index.json");
  await copyFile(indexPath, indexTarget);
  log(`page: copied ${PAGE_FILES.length + PRESENTATION_FILES.length} files and catalog-index.json`);

  // Provenance shown in the page's strip: what was ACTUALLY installed, by
  // tarball hash and commit, never the index's own package block alone.
  const summary = {
    format: index.format,
    version: index.version,
    entryCount: index.entries.length,
    organizationAdmission:
      typeof index.organizationAdmission === "string" ? index.organizationAdmission : null,
    indexSha256: sha256File(indexTarget),
    package: {
      name: installed.name,
      version: installed.version,
      tarball: basename(catalogPkg.tarball),
      tarballSha256: catalogPkg.sha256,
      commit: catalogPkg.commit,
    },
    packages: packages.map((pkg) => ({
      name: pkg.name,
      tarball: basename(pkg.tarball),
      sha256: pkg.sha256,
      commit: pkg.commit,
      source: pkg.source,
    })),
    indexPackage: index.package ?? null,
  };
  writeFileSync(join(runDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

  // --- 5. serve ------------------------------------------------------------
  const handleApi = createApi({ consumerDir, runDir, summary });
  const server = createStaticServer(runDir, handleApi);
  const address = await listen(server, PORT);
  const url = `http://127.0.0.1:${address.port}/`;

  const health = await fetch(`${url}catalog-index.json`);
  if (!health.ok) fatal(`served index is not reachable at ${url}catalog-index.json (${health.status})`);
  const served = await health.json();
  if (served.format !== EXPECTED_FORMAT || served.version !== EXPECTED_VERSION) {
    fatal(`served index lost its contract: ${JSON.stringify(served.format)} / ${JSON.stringify(served.version)}`);
  }
  const page = await fetch(url);
  if (!page.ok) fatal(`served page is not reachable at ${url} (${page.status})`);
  // Prove the backend answers before announcing the URL: a page that loads but
  // cannot reach Core would look fine and do nothing.
  const api = await fetch(`${url}api/packages`);
  if (!api.ok) fatal(`the backend API is not reachable at ${url}api/packages (${api.status})`);

  log(`run directory: ${runDir}`);
  log(`consumer: ${consumerDir}`);
  log(`index contract: ${served.format} version ${served.version} (${served.entries.length} entries)`);
  process.stdout.write(`${url}\n`);
  log("press Ctrl+C to stop serving; the run directory is removed on exit");

  const shutdown = () => {
    server.close(() => {
      try {
        rmSync(runDir, { recursive: true, force: true });
      } catch {
        /* the run directory is disposable */
      }
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

await main().catch((error) => {
  fatal(error?.stack ?? String(error));
});
