#!/usr/bin/env node
/*
 * The candidate's server process. `node tools/candidate.mjs start` runs it detached and hidden:
 *
 *   node tools/candidate/serve.mjs --data <directory> --port <n>
 *   node tools/candidate/serve.mjs --data <directory> --seed-only
 *
 * It installs the manifest's three tarballs (and the optional previous Catalog) into a fresh run directory, unpacks the optional
 * update-source Catalogs there as the Workbench's AIH_UPDATE_SOURCE_CATALOG_ROOTS (never together with the maintenance fixture), seeds the sample
 * data, points the Workbench's existing host configuration at it, serves the Workbench, and records itself in state/server.json
 * (the launcher wrote the record as "starting"; this rewrites it as "ready"). It ends when state/stop-request appears or on
 * SIGINT/SIGTERM (neither can be handled while npm blocks it during installation, so stop then ends its process tree after
 * checking its command line). The launcher gave it exactly the environment it runs with: the candidate's
 * disposable account home (HOME, USERPROFILE, APPDATA, XDG_*) so Core's records land there and never in the real account's, its
 * own temporary directory, and no AIH_* host setting but the ones this process sets from the samples it made and the manifest
 * (AIH_FRAMEWORK_SOURCES from preparedFrameworks, written into the run directory). A sample that
 * could not be made leaves its host input unset, so the product shows its own "not configured" state.
 * While the TLS-interception condition is staged (tls-interception.mjs) and the readiness sample exists, it also starts the interceptor
 * after the installation and gives only the processes it starts afterwards the environment that reaches it.
 * With --seed-only it installs the consumer and makes the samples, then exits without listening (exit 2 if one could not be made).
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homeEnvironment } from '../consumer/home-environment.mjs';
import { startPreview } from '../preview.mjs';
import { recordRealHome } from './guard.mjs';
import { candidateLayout } from './layout.mjs';
import { candidateIdentity, readManifest, verifyManifest } from './manifest.mjs';
import { readServerRecord } from './process.mjs';
import { installLocalAuthority } from './local-authority.mjs';
import { seedSamples } from './samples.mjs';
import { activateStagedCondition } from './tls-interception.mjs';
import { writePreparedFrameworkSources } from './framework-sources.mjs';
import { verifyInstalledArchive } from './upgrade.mjs';

const say = message => process.stdout.write(`${new Date().toISOString()} ${message}\n`);
const option = name => { const at = process.argv.indexOf(name); return at >= 0 ? process.argv[at + 1] : undefined; };
const sameHome = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
class SeedOnlyDone extends Error {}

// A tarball from npm unpacks under `package/`; it is read from standard input because a Windows path reaches tar as a host name.
function extractPackage(tarball, destination) {
  mkdirSync(destination, { recursive: true });
  const result = spawnSync('tar', ['-xz'], { cwd: destination, input: readFileSync(tarball), encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`could not extract ${tarball}: ${result.error?.message ?? result.stderr}`);
  return join(destination, 'package');
}

async function main() {
  const seedOnly = process.argv.includes('--seed-only'), port = Number(option('--port'));
  if (!option('--data')) throw new Error('--data <directory> is required');
  const layout = candidateLayout(option('--data'));
  // Nothing inherited names a host input: only the manifest, and what the samples set below.
  for (const name of Object.keys(process.env)) if (name.toUpperCase().startsWith('AIH_') && name.toUpperCase() !== 'AIH_CANDIDATE_MANIFEST') delete process.env[name];
  // The launcher sets the home and the temporary directory; this makes a direct run safe too.
  if (!sameHome(homedir(), layout.home)) Object.assign(process.env, homeEnvironment(layout.home), { TEMP: layout.tmp, TMP: layout.tmp, TMPDIR: layout.tmp });
  mkdirSync(layout.tmp, { recursive: true });
  const read = readManifest(process.env.AIH_CANDIDATE_MANIFEST ?? layout.manifest);
  await verifyManifest(read);
  const identity = candidateIdentity(read), { packages } = read;
  const uiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const installedConsumerDir = packages.ui ? resolve(uiRoot, '../..') : undefined;
  const installed = installedConsumerDir ? Object.fromEntries(['ui', 'core', 'catalog', 'scan'].map(name => [name,
    verifyInstalledArchive(packages[name], join(installedConsumerDir, 'node_modules', name === 'ui' ? 'aih-ui' : `@aihq/${name}`))])) : undefined;
  say(`candidate: ${identity.candidate ?? '(unnamed)'}`);
  rmSync(layout.run, { recursive: true, force: true });
  mkdirSync(layout.run, { recursive: true });

  let authority, interceptor, preview, closing = false, problems = [];
  const shutdown = async reason => {
    if (closing) return;
    closing = true;
    say(`stopping (${reason})`);
    // Last resort if a connection holds the server open.
    setTimeout(() => process.exit(0), 15_000).unref();
    preview?.server.closeAllConnections?.();
    await preview?.close().catch(() => {});
    authority?.restore();
    await interceptor?.close().catch(() => {});
    rmSync(layout.server, { force: true });
    say('stopped');
    process.exit(0);
  };
  // The stop request is read once the event loop is free; while npm installs, stop ends the tree after its identity check instead.
  if (!seedOnly) {
    rmSync(layout.stopRequest, { force: true });
    setInterval(() => { if (existsSync(layout.stopRequest)) shutdown('stop requested'); }, 500);
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  const pick = key => ({ supplied: packages[key].tarball, expected: { sha256: packages[key].sha256, commit: packages[key].commit } });
  try {
    preview = await startPreview({
      supplied: Object.fromEntries(['core', 'scan', 'catalog'].map(key => [key, pick(key).supplied])),
      expected: Object.fromEntries(['core', 'scan', 'catalog'].map(key => [key, pick(key).expected])),
      port: seedOnly ? 1 : port, runDir: layout.run, installedConsumerDir, settingsPath: layout.settings, log: say,
      // Host configuration is read when the Workbench is created, so the samples and the environment exist before that.
      async beforeServe({ consumerDir }) {
        // Installation runs no lifecycle scripts. Record the published location before the first Core operation.
        const { loadCoreState } = await import(pathToFileURL(join(consumerDir, 'consumer/core-state-loader.mjs')).href);
        const { stateLocation } = await loadCoreState();
        recordRealHome(layout, userInfo().homedir, stateLocation?.root);
        if (packages.previousCatalog) process.env.AIH_CONSUMER_PREVIOUS_CATALOG = extractPackage(packages.previousCatalog.tarball, join(layout.run, 'previous-catalog'));
        // The update source: each tarball unpacked in the manifest's order (oldest first), listed to the Workbench as its Catalog roots.
        // The maintenance fixture is a test source and is never combined with it.
        const updateSourceRoots = (packages.updateSourceCatalogs ?? []).map((entry, index) => extractPackage(entry.tarball, join(layout.run, 'update-source', String(index + 1))));
        if (updateSourceRoots.length) {
          process.env.AIH_UPDATE_SOURCE_CATALOG_ROOTS = updateSourceRoots.join(delimiter);
          delete process.env.AIH_MAINTENANCE_SOURCE;
          say(`update source: ${updateSourceRoots.length} Catalog ${updateSourceRoots.length === 1 ? 'root' : 'roots'} configured`);
        }
        const seeded = await seedSamples({ layout, consumerDir, updateSourceRoots });
        say(`samples: ${seeded.seeded.length ? `seeded ${seeded.seeded.join(', ')}` : 'already present'}`);
        for (const problem of seeded.problems) say(`sample ${problem.sample} was not seeded: ${problem.message}`);
        problems = seeded.problems;
        if (seedOnly) throw new SeedOnlyDone();
        authority = installLocalAuthority({ repository: layout.authority, log: layout.authorityLog });
        Object.assign(process.env, seeded.env);
        // Operator configuration, verified independently of report bytes; never infer trust from an artifact.
        if (read.hostInputs.evidenceSources) process.env.AIH_SCAN_EVIDENCE_SOURCES = read.hostInputs.evidenceSources.path;
        if (read.hostInputs.reviewTrust) process.env.AIH_REVIEW_TRUST = read.hostInputs.reviewTrust.path;
        // The manifest's one framework-source input: the pinned Catalog's prepared content, never a setting from the launching shell.
        const frameworkSources = writePreparedFrameworkSources({ frameworks: read.preparedFrameworks, consumerDir, runDir: layout.run, catalog: packages.catalog });
        if (frameworkSources) {
          process.env.AIH_FRAMEWORK_SOURCES = frameworkSources;
          say(`framework sources: ${read.preparedFrameworks.join(', ')} from the pinned Catalog's prepared content`);
        }
        if (updateSourceRoots.length) delete process.env.AIH_MAINTENANCE_SOURCE;
        // A staged condition (tls-interception.mjs) starts only now, after every install: npm's own installs and this process never see it,
        // and only the processes started from here on (the readiness check and what Core runs from it) inherit its environment.
        interceptor = await activateStagedCondition({ layout, seededEnv: seeded.env, say });
      },
    });
  } catch (error) {
    if (!(error instanceof SeedOnlyDone)) throw error;
    rmSync(layout.run, { recursive: true, force: true });
    say(problems.length ? 'samples incomplete' : 'samples ready');
    process.exit(problems.length ? 2 : 0);
  }
  if (closing) return;

  const starting = readServerRecord(layout);
  writeFileSync(layout.server, `${JSON.stringify({ pid: process.pid, state: 'ready', port, url: preview.url,
    startedAt: starting?.pid === process.pid ? starting.startedAt : new Date().toISOString(), instance: randomUUID(),
    identity, installed, consumerDir: preview.consumerDir, packages: preview.summary.packages, dataDir: layout.root }, null, 2)}\n`);
  say(`serving ${preview.url}`);
}

main().catch(error => {
  say(`failed: ${error?.stack ?? error}`);
  process.exit(1);
});
