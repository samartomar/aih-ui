/**
 * Resolves the three packages the preview consumes into tarballs.
 *
 * Rules this module exists to enforce:
 *
 * 1. A checkout another worker is mid-change is NEVER built and NEVER packed.
 *    Its committed checkpoint is extracted with `git archive` into a workspace
 *    outside every repository, and that snapshot is built and packed instead.
 *    The checkout itself is only ever read through git.
 * 2. A supplied tarball (CORE_TGZ / SCAN_TGZ / CATALOG_TGZ) is used as
 *    delivered. No checkout is read, built or packed for it at all.
 * 3. Every step reports its own failure. A snapshot that does not install,
 *    build or pack is a hard error - quietly packing an unbuilt tree would
 *    produce a package whose dist/ is missing or stale, and the preview would
 *    then "work" against something nobody built.
 * 4. Tarballs are cached by commit outside every repository, so a second run
 *    does not rebuild an unchanged checkpoint.
 *
 * Installing the same version numbers from npm does NOT provide these changes:
 * the published 0.6.2 / 0.4.0 / 0.2.0 predate them. Only these tarballs carry
 * the new APIs.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const CACHE_ROOT = join(tmpdir(), "aih-ui-package-cache");

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function exists(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.error) throw new Error(`git ${args.join(" ")} failed: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${result.stderr?.trim()}`);
  }
  return result.stdout;
}

/**
 * npm through this same Node executable. On Windows `npm` is a .cmd shim that
 * spawnSync cannot execute without a shell, and building a shell string out of
 * paths is how quoting bugs get in.
 */
function npm(args, cwd, label) {
  const cli = process.env.npm_execpath;
  const viaNode = cli && /\.[cm]?js$/.test(cli);
  const result = spawnSync(
    viaNode ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm",
    viaNode ? [cli, ...args] : args,
    {
      cwd,
      encoding: "utf8",
      ...(viaNode || process.platform !== "win32" ? {} : { shell: true }),
      windowsHide: true,
      maxBuffer: 256 * 1024 * 1024,
    },
  );
  if (result.error) throw new Error(`${label}: could not run npm: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n").slice(-20).join("\n");
    throw new Error(`${label}: npm ${args.join(" ")} failed (exit ${result.status})\n${detail}`);
  }
  return result.stdout ?? "";
}

function packedFilename(dir, name) {
  const found = readdirSync(dir).filter(
    (file) => file.startsWith(`aihq-${name}-`) && file.endsWith(".tgz"),
  );
  if (found.length !== 1) {
    throw new Error(`expected exactly one aihq-${name}-*.tgz in ${dir}, found ${found.length}`);
  }
  return join(dir, found[0]);
}

/**
 * @param name      "core" | "scan" | "catalog"
 * @param repo      the checkout to read a checkpoint from
 * @param supplied  a tarball path that bypasses the checkout entirely
 * @param workspace a directory outside every repository for snapshots
 */
export function resolvePackage({ name, repo, supplied, workspace, log }) {
  if (supplied) {
    if (!exists(supplied)) throw new Error(`supplied ${name} tarball not found at ${supplied}`);
    log(`${name}: using the supplied tarball; no checkout is read or built`);
    return {
      name,
      tarball: resolve(supplied),
      sha256: sha256File(supplied),
      commit: "supplied-tarball",
      source: "supplied tarball",
      midChange: false,
    };
  }

  if (!exists(repo)) throw new Error(`${name} checkout not found at ${repo}`);
  const commit = git(["rev-parse", "HEAD"], repo).trim();
  const midChange = git(["status", "--porcelain"], repo).trim().length > 0;

  const cacheDir = join(CACHE_ROOT, `${name}-${commit}`);
  if (exists(cacheDir)) {
    try {
      const cached = packedFilename(cacheDir, name);
      log(`${name}: cached tarball for ${commit.slice(0, 8)}`);
      return {
        name,
        tarball: cached,
        sha256: sha256File(cached),
        commit,
        source: midChange ? "committed checkpoint (checkout is mid-change)" : "clean checkout",
        midChange,
      };
    } catch {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }
  mkdirSync(cacheDir, { recursive: true });

  if (!midChange) {
    log(`${name}: clean checkout at ${commit.slice(0, 8)}; building and packing it`);
    npm(["run", "build"], repo, `${name} build`);
    npm(["pack", "--pack-destination", cacheDir], repo, `${name} pack`);
  } else {
    // Another worker is editing this tree. Read only the committed checkpoint,
    // and do the install/build/pack in our own workspace so their checkout is
    // never written to.
    log(`${name}: checkout is mid-change; packing its committed checkpoint ${commit.slice(0, 8)}`);
    const snapshot = join(workspace, `snapshot-${name}`);
    mkdirSync(snapshot, { recursive: true });
    const archive = spawnSync("git", ["-C", repo, "archive", commit], {
      encoding: "buffer",
      maxBuffer: 512 * 1024 * 1024,
      windowsHide: true,
    });
    if (archive.status !== 0) throw new Error(`${name}: git archive failed`);
    // Extract with the snapshot as the working directory rather than passing
    // it as -C: on Windows a native path reaches tar with its backslashes
    // escaped and it cannot open the directory.
    const extract = spawnSync("tar", ["-x"], {
      cwd: snapshot,
      input: archive.stdout,
      encoding: "utf8",
      windowsHide: true,
    });
    if (extract.status !== 0) {
      throw new Error(`${name}: extracting the checkpoint failed: ${extract.stderr}`);
    }
    npm(["install", "--ignore-scripts", "--no-audit", "--no-fund"], snapshot, `${name} snapshot install`);
    npm(["run", "build"], snapshot, `${name} snapshot build`);
    npm(["pack", "--pack-destination", cacheDir], snapshot, `${name} snapshot pack`);
  }

  const tarball = packedFilename(cacheDir, name);
  return {
    name,
    tarball,
    sha256: sha256File(tarball),
    commit,
    source: midChange ? "committed checkpoint (checkout is mid-change)" : "clean checkout",
    midChange,
  };
}

/** Installs all three tarballs into one throwaway consumer with no scripts run. */
export function installConsumer({ consumerDir, packages, extraFiles, log }) {
  mkdirSync(consumerDir, { recursive: true });
  const manifest = {
    name: "aih-ui-preview-consumer",
    version: "0.0.0",
    private: true,
    type: "module",
    description: "Throwaway consumer. Generated by aih-ui tools/preview.mjs.",
  };
  writeFileSync(join(consumerDir, "package.json"), `${JSON.stringify(manifest, null, 2)}
`);
  npm(
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...packages.map((p) => p.tarball)],
    consumerDir,
    "consumer install",
  );
  // A target may name a subdirectory - the service is a directory of modules,
  // not one file - so the directory is created before the copy. Flattening it
  // would break every relative import the worker makes.
  for (const [target, source] of Object.entries(extraFiles)) {
    const destination = join(consumerDir, target);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
  log(`consumer: installed ${packages.map((p) => p.name).join(", ")} into ${consumerDir}`);
}
