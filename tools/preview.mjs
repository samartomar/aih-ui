#!/usr/bin/env node
/*
 * Builds a throwaway preview of the Policy Workbench Sources & Catalogs page from the
 * published @aihq/catalog package and serves it on loopback.
 *
 * The catalog is consumed the way an outside developer consumes it: npm pack, install the
 * tarball into a throwaway consumer with --ignore-scripts, then resolve
 * @aihq/catalog/catalog-index.json through the installed package's export map. The catalog
 * repository's own source tree and defaults/ directory are never read directly and npm link
 * is never used.
 *
 * The generated run directory lives outside every repository. It receives the page files
 * plus the resolved index JSON; nothing is copied back into the UI repository.
 *
 * Usage: node tools/preview.mjs [--port 4173] [--quiet]
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { EXPECTED_FORMAT, EXPECTED_VERSION, contractViolations } from "./catalog-index-contract.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, ".."); // the aih-ui checkout this tool belongs to

const CATALOG_INDEX_EXPORT = "@aihq/catalog/catalog-index.json";
const CATALOG_PACKAGE = "@aihq/catalog";

// Page files that make up the served page. Each is copied into the run directory.
const PAGE_FILES = ["src/index.html", "src/catalog.js"];
// Presentation-only assets carried over from the design source (prototype/), unmodified.
const PRESENTATION_FILES = [
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

function npmArgs(rest) {
  // On Windows npm is a .cmd shim; spawnSync cannot execute it without a shell. Invoke the npm
  // CLI entry point through this same Node executable instead of building a shell string. The
  // npm CLI always exports npm_execpath to the scripts it runs, but fall back to the shim.
  const cli = process.env.npm_execpath;
  if (cli && /\.[cm]?js$/.test(cli)) return [cli, ...rest];
  return null;
}

function runNpm(rest, cwd) {
  const viaNode = npmArgs(rest);
  const command = viaNode ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const commandArgs = viaNode ?? rest;
  const useShell = !viaNode && process.platform === "win32";
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    ...(useShell ? { shell: true } : {}),
    windowsHide: true,
    // npm pack --json lists every packaged file, which is well past spawnSync's 1 MB default.
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) fatal(`could not run npm (${rest.join(" ")}): ${result.error.message}`);
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    fatal(`npm ${rest.join(" ")} failed in ${cwd} with exit code ${result.status}`);
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function ensureCatalogBuild(catalogRoot) {
  const distEntry = join(catalogRoot, "dist", "index.js");
  let present = false;
  try {
    present = statSync(distEntry).isFile();
  } catch {
    present = false;
  }
  if (present) {
    log(`catalog: dist present at ${distEntry}`);
    return;
  }
  log(`catalog: dist missing, running npm ci and npm run build in ${catalogRoot}`);
  runNpm(["ci"], catalogRoot);
  runNpm(["run", "build"], catalogRoot);
  try {
    if (!statSync(distEntry).isFile()) throw new Error("missing dist/index.js");
  } catch (error) {
    fatal(`catalog build finished without a usable dist/index.js: ${error.message}`);
  }
}

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

function packCatalog(catalogRoot, packDestination) {
  const packed = runNpm(["pack", "--json", "--pack-destination", packDestination], catalogRoot);
  const stdout = packed.stdout.trim();
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    fatal(`npm pack --json did not return JSON:\n${stdout}`);
  }
  const record = Array.isArray(report) ? report[0] : report;
  if (!record || typeof record.filename !== "string") {
    fatal(`npm pack --json did not report a filename:\n${stdout}`);
  }
  const tarball = resolve(packDestination, record.filename);
  try {
    if (!statSync(tarball).isFile()) throw new Error("not a file");
  } catch (error) {
    fatal(`npm pack reported ${tarball} but it is not readable: ${error.message}`);
  }
  return {
    tarball,
    filename: record.filename,
    sha256: sha256File(tarball),
    integrity: typeof record.integrity === "string" ? record.integrity : null,
  };
}

function installIntoConsumer(consumerDir, tarball) {
  writeFileSync(
    join(consumerDir, "package.json"),
    `${JSON.stringify(
      {
        name: "aih-ui-preview-consumer",
        version: "0.0.0",
        private: true,
        type: "module",
        description: "Throwaway consumer. Generated by aih-ui tools/preview.mjs.",
      },
      null,
      2,
    )}\n`,
  );
  runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], consumerDir);
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

function createStaticServer(root) {
  return createServer((request, response) => {
    const requested = new URL(request.url ?? "/", "http://127.0.0.1");
    // "/" is the page. Everything else is a file the page files reference by name.
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
  const catalogRoot = resolve(REPO_ROOT, "..", "aih-catalog");
  try {
    if (!statSync(catalogRoot).isDirectory()) throw new Error("not a directory");
  } catch (error) {
    fatal(`catalog checkout not found at ${catalogRoot}: ${error.message}`);
  }
  for (const relative of [...PAGE_FILES, ...PRESENTATION_FILES]) {
    try {
      if (!statSync(join(REPO_ROOT, relative)).isFile()) throw new Error("not a file");
    } catch (error) {
      fatal(`page asset ${relative} is missing from ${REPO_ROOT}: ${error.message}`);
    }
  }

  ensureCatalogBuild(catalogRoot);

  const runDir = mkdtempSync(join(tmpdir(), "aih-ui-preview-"));
  const consumerDir = join(runDir, "consumer");
  mkdirSync(consumerDir, { recursive: true });
  log(`run: new temp folder outside every repo -> ${runDir}`);

  const archive = packCatalog(catalogRoot, runDir);
  log(`catalog: packed ${archive.filename} (sha256 ${archive.sha256})`);

  installIntoConsumer(consumerDir, archive.tarball);
  const installed = readInstalledPackageJson(consumerDir);
  log(`catalog: installed ${installed.name}@${installed.version} into ${consumerDir}`);

  const indexPath = await resolveIndexThroughExportMap(consumerDir);
  const index = readJson(indexPath);
  const violations = contractViolations(index);
  if (violations.length) fatal(violations.join("; "));
  log(
    `index: ${CATALOG_INDEX_EXPORT} -> ${indexPath} (format ${index.format}, version ${index.version}, ${index.entries.length} entries)`,
  );

  // Copy the page files and the resolved index JSON into the run directory. The index is
  // served verbatim; the page fetches it as a static asset. src/catalog.js is additionally
  // placed at the run root so the served page can load it as a plain module by name.
  for (const relative of PAGE_FILES) {
    const target = join(runDir, relative);
    mkdirSync(dirname(target), { recursive: true });
    await copyFile(join(REPO_ROOT, relative), target);
  }
  await copyFile(join(REPO_ROOT, "src", "catalog.js"), join(runDir, "catalog.js"));
  for (const relative of PRESENTATION_FILES) {
    const name = relative.split("/").pop();
    await copyFile(join(REPO_ROOT, relative), join(runDir, name));
  }
  const indexTarget = join(runDir, "catalog-index.json");
  await copyFile(indexPath, indexTarget);
  log(`page: copied ${[...PAGE_FILES, ...PRESENTATION_FILES].length} files and catalog-index.json`);

  // Summary shown in the provenance strip: the installed package's own version plus the
  // tarball identity actually installed, never the index's own package block alone.
  writeFileSync(
    join(runDir, "summary.json"),
    `${JSON.stringify(
      {
        format: index.format,
        version: index.version,
        entryCount: index.entries.length,
        organizationAdmission:
          typeof index.organizationAdmission === "string" ? index.organizationAdmission : null,
        indexSha256: sha256File(indexTarget),
        package: {
          name: installed.name,
          version: installed.version,
          tarball: archive.filename,
          tarballSha256: archive.sha256,
          integrity: archive.integrity,
        },
        indexPackage: index.package ?? null,
      },
      null,
      2,
    )}\n`,
  );

  const server = createStaticServer(runDir);
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

  log(`run directory: ${runDir}`);
  log(`consumer: ${consumerDir}`);
  log(`index contract: ${served.format} version ${served.version} (${served.entries.length} entries)`);
  process.stdout.write(`${url}\n`);
  log("press Ctrl+C to stop serving; delete the run directory when finished");

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
