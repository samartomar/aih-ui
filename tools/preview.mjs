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
 *   - a static page (src/), copied into the run directory with its module tree intact,
 *     beside the catalog document it reads - the OUTPUT of Catalog's public reader,
 *     never the raw index bytes;
 *   - an API (tools/server/) that runs tools/service/ inside the consumer. Every Node-only
 *     package API and every filesystem access lives on that side.
 *
 * The generated run directory lives outside every repository. Nothing is copied back into
 * the UI repository.
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
import { EXPECTED_FORMAT, EXPECTED_VERSION, contractViolations } from "./catalog-index-contract.mjs";
import { installConsumer, resolvePackage } from "./packages.mjs";
import { createApi } from "./server/api.mjs";
import { callService } from "./server/service-client.mjs";
import { assertReadable, pageAssets, presentationAssets, serviceAssets } from "./server/assets.mjs";
import { createStaticServer, listen } from "./server/static.mjs";

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

/** One service operation at startup; a failure is returned, never replaced. */
function startupFact(consumerDir, op) {
  const answer = callService(consumerDir, { op });
  if (answer.ok) {
    const { ok, ...value } = answer;
    return { state: "published", ...value };
  }
  return { state: "unavailable", reason: answer.error };
}

/**
 * A Catalog sidecar the page can do without. `absent` means the installed
 * Catalog does not export it; `unavailable` means its own reader refused it or
 * the service failed. Neither is ever turned into a value.
 */
function sidecarFact(consumerDir, op) {
  const fact = startupFact(consumerDir, op);
  if (fact.state === "published" && fact[op] === null) return { state: "absent", reason: fact.absent };
  return fact;
}

/** The summary block for a sidecar: where the page fetches it, or why it cannot. */
function sidecarSummary(fact, key, url) {
  if (fact.state !== "published") return { state: fact.state, reason: fact.reason };
  const { entries, ...facts } = fact[key];
  return { state: "published", url, ...facts };
}

/* ----------------------------------------------------------------------- main */

async function main() {
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
  let presentation;
  try {
    page = pageAssets(REPO_ROOT);
    service = serviceAssets(REPO_ROOT);
    presentation = presentationAssets();
    assertReadable(REPO_ROOT, [...page, ...service, ...presentation]);
  } catch (error) {
    fatal(error.message);
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
      extraFiles: Object.fromEntries(service.map((asset) => [asset.to, join(REPO_ROOT, asset.from)])),
      log,
    });
  } catch (error) {
    fatal(error.message);
  }
  log(`service: ${service.length} backend modules copied into the consumer, directories intact`);

  // --- 3. the catalog, through Catalog's public reader ----------------------
  //
  // The page is served what readCatalogContentV1 returned, projected member by
  // member - never the raw index bytes - so every field it can render is a
  // field of the reader's result type.
  const servedFact = startupFact(consumerDir, "servedCatalog");
  if (servedFact.state !== "published") {
    fatal(`the installed ${CATALOG_PACKAGE} index could not be read through its public reader: ${servedFact.reason}`);
  }
  const index = servedFact.catalog;
  const violations = contractViolations(index);
  if (violations.length) fatal(violations.join("; "));
  log(
    `index: read with readCatalogContentV1 (format ${index.format}, version ${index.version}, ${index.entries.length} entries, ${index.digest})`,
  );
  const installedPackages = readInstalledPackages(consumerDir, packages);
  const installed = installedPackages.find((pkg) => pkg.name === CATALOG_PACKAGE);
  const catalogPkg = packages.find((pkg) => pkg.name === "catalog");
  for (const pkg of installedPackages) log(`installed: ${pkg.name} ${pkg.version}`);

  // Catalog's current collection view decides which entries of a collected
  // source type are current inventory. Without it the page cannot tell a
  // current Core entry from an older one, so the preview does not start.
  const collections = startupFact(consumerDir, "collections");
  if (collections.state !== "published") {
    fatal(
      `the installed ${CATALOG_PACKAGE} publishes no readable collection view: ${collections.reason}
` +
        "This UI needs a Catalog with the collection contract (readCatalogCollectionsV1). " +
        "Point CATALOG_REPO at a checkout that has it, or CATALOG_TGZ at such a package.",
    );
  }
  for (const collection of collections.collections.collections) {
    log(`collection: ${collection.id} (${collection.owner.package}) release ${collection.current.release}, ${collection.members.length} current members`);
  }
  // Core's supported AI CLI targets. A Core that does not export them leaves
  // the AI tools control saying so; the rest of the page does not depend on it.
  const coreTargets = startupFact(consumerDir, "coreTargets");
  log(
    coreTargets.state === "published"
      ? `core targets: ${coreTargets.targets.length} supported AI CLIs from @aihq/core SUPPORTED_CLIS`
      : `core targets: unavailable (${coreTargets.reason})`,
  );

  // Catalog's publisher titles and descriptions. Display-only: a Catalog
  // without them leaves those slots reading Not published.
  const publisher = startupFact(consumerDir, "publisher");
  log(
    publisher.state === "published"
      ? `publisher: ${publisher.publisher.coverage.entries} entries; description ${publisher.publisher.coverage.description.published} published, title ${publisher.publisher.coverage.title.published}, category ${publisher.publisher.coverage.category.published}`
      : `publisher: unavailable (${publisher.reason})`,
  );

  // Catalog's publisher qualification and curated categories. Display-only:
  // a Catalog that predates either export leaves its block reading Not
  // published, and one whose sidecar its own reader refuses says so.
  const qualification = sidecarFact(consumerDir, "qualification");
  log(
    qualification.state === "published"
      ? `qualification: ${qualification.qualification.coverage.qualified} of ${qualification.qualification.coverage.entries} entries qualified at ${qualification.qualification.evaluatedAt}; signature ${qualification.qualification.signature}, attestation ${qualification.qualification.attestation}`
      : `qualification: ${qualification.state} (${qualification.reason})`,
  );
  const categories = sidecarFact(consumerDir, "categories");
  log(
    categories.state === "published"
      ? `categories: ${categories.categories.taxonomy.length} curated categories; ${categories.categories.coverage.curated} of ${categories.categories.coverage.entries} entries curated`
      : `categories: ${categories.state} (${categories.reason})`,
  );

  // --- 4. page files into the run directory ---------------------------------
  for (const asset of [...page, ...presentation]) {
    const target = join(runDir, asset.to);
    mkdirSync(dirname(target), { recursive: true });
    await copyFile(join(REPO_ROOT, asset.from), target);
  }
  if (publisher.state === "published") {
    writeFileSync(join(runDir, "publisher-metadata.json"), `${JSON.stringify(publisher.publisher)}
`);
  }
  if (qualification.state === "published") {
    writeFileSync(join(runDir, "catalog-qualification.json"), `${JSON.stringify(qualification.qualification)}
`);
  }
  if (categories.state === "published") {
    writeFileSync(join(runDir, "catalog-categories.json"), `${JSON.stringify(categories.categories)}
`);
  }
  // The URL is unchanged; the bytes are the reader's projection.
  writeFileSync(join(runDir, "catalog-index.json"), `${JSON.stringify(index)}
`);
  log(`page: ${page.length} page files, ${presentation.length} presentation files and the served catalog document`);

  // Provenance shown in the page's strip: what was ACTUALLY installed, by
  // tarball hash and commit, never the index's own package block alone.
  const summary = {
    format: index.format,
    version: index.version,
    entryCount: index.entries.length,
    organizationAdmission: index.organizationAdmission,
    // The reader's digest over the exact published index bytes, not over the
    // served projection.
    indexSha256: index.digest.replace(/^sha256:/, ""),
    package: {
      name: installed.name,
      version: installed.version,
      tarball: basename(catalogPkg.tarball),
      tarballSha256: catalogPkg.sha256,
      commit: catalogPkg.commit,
    },
    packages: packages.map((pkg) => ({
      name: pkg.name,
      packageName: `@aihq/${pkg.name}`,
      // From npm's installation record, cross-checked with the installed manifest.
      version: installedPackages.find((item) => item.name === `@aihq/${pkg.name}`).version,
      tarball: basename(pkg.tarball),
      sha256: pkg.sha256,
      commit: pkg.commit,
      source: pkg.source,
    })),
    indexPackage: index.package ?? null,
    // Catalog's collection view, exactly as its reader returned it.
    collections: collections.collections,
    // Catalog's publisher metadata: where it is served and what it covers, or why it is unavailable.
    publisher:
      publisher.state === "published"
        ? {
            state: "published",
            url: "./publisher-metadata.json",
            specifier: publisher.publisher.specifier,
            digest: publisher.publisher.digest,
            sources: publisher.publisher.sources,
            coverage: publisher.publisher.coverage,
          }
        : { state: "unavailable", reason: publisher.reason },
    // Catalog's qualification and curated categories: where each is served, or
    // why it is not.
    qualification: sidecarSummary(qualification, "qualification", "./catalog-qualification.json"),
    categories: sidecarSummary(categories, "categories", "./catalog-categories.json"),
    // Core's supported targets, or why they are unavailable.
    coreTargets:
      coreTargets.state === "published"
        ? { state: "published", source: "@aihq/core SUPPORTED_CLIS", targets: coreTargets.targets }
        : { state: "unavailable", reason: coreTargets.reason },
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
  log(`index contract: ${served.format} version ${served.version} (${served.entries.length} entries)`);
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
