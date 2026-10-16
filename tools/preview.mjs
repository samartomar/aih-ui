#!/usr/bin/env node
/*
 * Builds a throwaway preview of the Policy Workbench and serves it on 127.0.0.1.
 *
 * All three packages are consumed the way an outside developer consumes them: npm pack,
 * install the tarballs into a throwaway consumer with --ignore-scripts, then resolve every
 * entry point through the installed packages' export maps. No repository's source tree is
 * read, no `dist/` is deep-imported, and npm link is never used.
 *
 * Two halves:
 *   - a static page (src/), copied into the run directory with its module tree intact,
 *     beside the catalog document it reads - the OUTPUT of Catalog's public reader,
 *     never the raw index bytes;
 *   - an API (tools/server/) that runs tools/service/ inside the consumer. Every Node-only
 *     package API and every filesystem access lives on that side.
 *
 * The generated run directory lives under the configured temp directory.
 *
 * Usage: node tools/preview.mjs [--port 4173] [--quiet]
 *
 * Environment: CORE_TGZ / SCAN_TGZ / CATALOG_TGZ use a supplied tarball instead of packing
 * a checkout; CORE_REPO / SCAN_REPO / CATALOG_REPO name the checkouts to read from.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCss } from "./build-css.mjs";
import { installConsumer, resolvePackage } from "./packages.mjs";
import { createWorkbench } from "./server/workbench.mjs";
import { callService } from "./server/service-client.mjs";
import { coreTargetsSummary } from "./server/core-targets-summary.mjs";
import { assertReadable, pageAssets, serviceAssets } from "./server/assets.mjs";
import { listen } from "./server/static.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, ".."); // the aih-ui checkout this tool belongs to

const CATALOG_PACKAGE = "@aihq/catalog";

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

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fatal(`could not read JSON at ${path}: ${error.message}`);
  }
}

const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/;

/**
 * The name and version of each package actually installed in the consumer.
 *
 * Read from npm's own installation record (node_modules/.package-lock.json),
 * which ties each installed name to the version and the exact tarball npm
 * installed it from, and cross-checked against that installed package's
 * manifest. Never parsed out of a tarball filename, and never taken from the
 * index's own package block.
 */
function readInstalledPackages(consumerDir, packages) {
  const lockPath = join(consumerDir, "node_modules", ".package-lock.json");
  const lock = readJson(lockPath);
  return packages.map((pkg) => {
    const name = `@aihq/${pkg.name}`;
    const record = lock?.packages?.[`node_modules/${name}`];
    if (record === undefined) fatal(`${lockPath} records no installation of ${name}`);
    if (typeof record.version !== "string" || !VERSION.test(record.version)) {
      fatal(`${lockPath} records ${name} with no valid version (${JSON.stringify(record.version)})`);
    }
    const resolved = typeof record.resolved === "string" && record.resolved.startsWith("file:")
      ? resolve(consumerDir, record.resolved.slice("file:".length))
      : null;
    if (resolved === null || resolved.toLowerCase() !== resolve(pkg.tarball).toLowerCase()) {
      fatal(`${name} was installed from ${JSON.stringify(record.resolved)}, not from ${pkg.tarball}`);
    }
    const manifestPath = join(consumerDir, "node_modules", ...name.split("/"), "package.json");
    const manifest = readJson(manifestPath);
    if (manifest.name !== name || manifest.version !== record.version) {
      fatal(`${manifestPath} says ${manifest.name}@${manifest.version}; npm recorded ${name}@${record.version}`);
    }
    return { name, version: record.version };
  });
}

/* ----------------------------------------------------------------------- main */

async function main() {
  // Generate only the utilities used by the checked-in page and components.
  // This keeps Tailwind out of the browser and rebuilds CSS for each preview.
  try {
    await buildCss(REPO_ROOT);
  } catch (error) {
    fatal(error.message);
  }
  const repos = {
    core: process.env.CORE_REPO ?? resolve(REPO_ROOT, "..", "ai-harness"),
    scan: process.env.SCAN_REPO ?? resolve(REPO_ROOT, "..", "aih-scan"),
    catalog: process.env.CATALOG_REPO ?? resolve(REPO_ROOT, "..", "aih-catalog"),
  };

  // Discovered, not listed: a module added to src/ or tools/service/ is copied
  // because it is there, and a missing entry point fails here rather than in a
  // browser. Each file keeps its path - nothing is flattened.
  let page;
  let service;
  try {
    page = pageAssets(REPO_ROOT);
    service = serviceAssets(REPO_ROOT);
    assertReadable(REPO_ROOT, [...page, ...service]);
  } catch (error) {
    fatal(error.message);
  }

  const runDir = mkdtempSync(join(tmpdir(), "aih-ui-preview-"));
  const consumerDir = join(runDir, "consumer");
  mkdirSync(consumerDir, { recursive: true });
  log(`run: new temp folder -> ${runDir}`);

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
      extraFiles: Object.fromEntries(service.map((asset) => [asset.to, join(REPO_ROOT, asset.from)])),
      log,
    });
  } catch (error) {
    fatal(error.message);
  }
  log(`service: ${service.length} backend modules copied into the consumer, directories intact`);

  // --- 3. the catalog, through Catalog's public reader ----------------------
  //
  // The authoring host reads the installed default and required family releases
  // through public Catalog APIs. No retired index-root export is required.
  const installedPackages = readInstalledPackages(consumerDir, packages);
  // --- 4. page files into the run directory ---------------------------------
  for (const asset of page) {
    const target = join(runDir, asset.to);
    mkdirSync(dirname(target), { recursive: true });
    await copyFile(join(REPO_ROOT, asset.from), target);
  }
  const summary = {
    packages: packages.map(pkg => ({
      name: pkg.name, packageName: `@aihq/${pkg.name}`,
      version: installedPackages.find(item => item.name === `@aihq/${pkg.name}`).version,
      tarball: basename(pkg.tarball), sha256: pkg.sha256, commit: pkg.commit, source: pkg.source,
    })),
    coreTargets: coreTargetsSummary(callService(consumerDir, { op: 'coreTargets' })),
  };
  const { server, catalog: currentCatalog } = await createWorkbench({ consumerDir, runDir, summary, settingsPath: process.env.AIH_UI_SETTINGS_PATH });
  summary.entryCount = currentCatalog.items.length;
  writeFileSync(join(runDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

  // --- 5. serve ------------------------------------------------------------
  const address = await listen(server, PORT);
  const url = `http://127.0.0.1:${address.port}/`;

  const pageResponse = await fetch(url);
  if (!pageResponse.ok) fatal(`served page is not reachable at ${url} (${pageResponse.status})`);
  // Every module the page imports must be reachable too: a page that loads and
  // then 404s on one module is a blank screen with a clean HTTP log.
  for (const asset of page) {
    const moduleResponse = await fetch(`${url}${asset.to}`);
    if (!moduleResponse.ok) {
      fatal(`page asset ${asset.to} is not reachable at ${url}${asset.to} (${moduleResponse.status})`);
    }
  }
  // Prove the backend answers before announcing the URL: a page that loads but
  // cannot reach Core would look fine and do nothing.
  const api = await fetch(`${url}api/packages`);
  if (!api.ok) fatal(`the backend API is not reachable at ${url}api/packages (${api.status})`);

  log(`run directory: ${runDir}`);
  log(`consumer: ${consumerDir}`);
  log(`installed authoring inventory: ${currentCatalog.items.length} items`);
  log(`page assets: ${page.length} served, every one reachable`);
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
