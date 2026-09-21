#!/usr/bin/env node
/*
 * Focused integration check for signer attribution.
 *
 *   node tools/check-scan-attribution.mjs
 *
 * It installs the three local tarballs into a throwaway consumer, copies the
 * backend service in, and runs the assertions THERE - so every package name
 * resolves through an installed export map, exactly as the preview does.
 *
 * What it proves, using two trusted keys with different operator declarations:
 *
 * 1. the declaration follows the key that actually SIGNED, not the first root;
 * 2. reordering the roots does not change the answer;
 * 3. a signer that is not configured is reported unattributed, with a reason;
 * 4. a trust file listing the same key twice is ambiguous, not resolved by
 *    picking one;
 * 5. a configured entry describing a different identity is not used;
 * 6. failed verification presents no configured root as a verified signer.
 *
 * Environment: CORE_TGZ / SCAN_TGZ / CATALOG_TGZ, CORE_REPO / SCAN_REPO /
 * CATALOG_REPO, as for tools/preview.mjs.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { installConsumer, resolvePackage } from "./packages.mjs";
import { serviceAssets } from "./server/assets.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const QUIET = process.argv.includes("--quiet");
const log = (message) => {
  if (!QUIET) process.stdout.write(`${message}\n`);
};

const repos = {
  core: process.env.CORE_REPO ?? resolve(REPO_ROOT, "..", "ai-harness"),
  scan: process.env.SCAN_REPO ?? resolve(REPO_ROOT, "..", "aih-scan"),
  catalog: process.env.CATALOG_REPO ?? resolve(REPO_ROOT, "..", "aih-catalog"),
};

const workspace = mkdtempSync(join(tmpdir(), "aih-ui-attribution-"));
const consumerDir = join(workspace, "consumer");
mkdirSync(consumerDir, { recursive: true });

try {
  const packages = ["core", "scan", "catalog"].map((name) =>
    resolvePackage({
      name,
      repo: repos[name],
      supplied: process.env[`${name.toUpperCase()}_TGZ`],
      workspace,
      log,
    }),
  );
  const service = serviceAssets(REPO_ROOT);
  installConsumer({
    consumerDir,
    packages,
    extraFiles: Object.fromEntries(service.map((asset) => [asset.to, join(REPO_ROOT, asset.from)])),
    log,
  });
  await copyFile(join(HERE, "scan-attribution-cases.mjs"), join(consumerDir, "scan-attribution-cases.mjs"));

  const run = spawnSync(process.execPath, ["scan-attribution-cases.mjs"], {
    cwd: consumerDir,
    encoding: "utf8",
    stdio: "inherit",
    windowsHide: true,
  });
  if (run.error) throw new Error(`could not run the cases: ${run.error.message}`);
  process.exitCode = run.status ?? 1;
} finally {
  try {
    rmSync(workspace, { recursive: true, force: true });
  } catch {
    /* the workspace is disposable */
  }
}
