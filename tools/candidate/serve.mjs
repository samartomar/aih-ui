#!/usr/bin/env node
/*
 * The candidate's server process. `node tools/candidate.mjs start` runs it detached and hidden:
 *
 *   node tools/candidate/serve.mjs --data <directory> --port <n>
 *
 * It installs the manifest's three tarballs (and the optional previous Catalog) into a fresh run directory, seeds the sample
 * data, points the Workbench's existing host configuration at it, serves the Workbench, and records itself in state/server.json.
 * It ends when state/stop-request appears or on SIGINT/SIGTERM. The launcher gave it the candidate's disposable account home
 * (HOME, USERPROFILE, APPDATA, XDG_*) so Core's records land there and never in the real account's.
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { homeEnvironment } from '../consumer/home-environment.mjs';
import { startPreview } from '../preview.mjs';
import { candidateLayout } from './layout.mjs';
import { candidateIdentity, readManifest, verifyManifest } from './manifest.mjs';
import { installLocalAuthority } from './local-authority.mjs';
import { seedSamples } from './samples.mjs';

const say = message => process.stdout.write(`${new Date().toISOString()} ${message}\n`);
const option = name => { const at = process.argv.indexOf(name); return at >= 0 ? process.argv[at + 1] : undefined; };

// A tarball from npm unpacks under `package/`; it is read from standard input because a Windows path reaches tar as a host name.
function extractPackage(tarball, destination) {
  mkdirSync(destination, { recursive: true });
  const result = spawnSync('tar', ['-xz'], { cwd: destination, input: readFileSync(tarball), encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`could not extract ${tarball}: ${result.error?.message ?? result.stderr}`);
  return join(destination, 'package');
}

async function main() {
  const port = Number(option('--port'));
  if (!option('--data')) throw new Error('--data <directory> is required');
  const layout = candidateLayout(option('--data'));
  // The launcher sets the home; this makes a direct run safe too.
  if (homedir().toLowerCase() !== layout.home.toLowerCase()) Object.assign(process.env, homeEnvironment(layout.home));
  const read = readManifest(process.env.AIH_CANDIDATE_MANIFEST ?? layout.manifest);
  await verifyManifest(read);
  const identity = candidateIdentity(read), { packages } = read;
  say(`candidate: ${identity.candidate ?? '(unnamed)'}`);
  rmSync(layout.stopRequest, { force: true });
  rmSync(layout.run, { recursive: true, force: true });
  mkdirSync(layout.run, { recursive: true });

  let authority;
  const pick = key => ({ supplied: packages[key].tarball, expected: { sha256: packages[key].sha256, commit: packages[key].commit } });
  const preview = await startPreview({
    supplied: Object.fromEntries(['core', 'scan', 'catalog'].map(key => [key, pick(key).supplied])),
    expected: Object.fromEntries(['core', 'scan', 'catalog'].map(key => [key, pick(key).expected])),
    port, runDir: layout.run, settingsPath: layout.settings, log: say,
    // Host configuration is read when the Workbench is created, so the samples and the environment exist before that.
    async beforeServe({ consumerDir }) {
      if (packages.previousCatalog) process.env.AIH_CONSUMER_PREVIOUS_CATALOG = extractPackage(packages.previousCatalog.tarball, join(layout.run, 'previous-catalog'));
      const seeded = await seedSamples({ layout, consumerDir });
      say(`samples: ${seeded.seeded.length ? `seeded ${seeded.seeded.join(', ')}` : 'already present'}`);
      for (const problem of seeded.problems) say(`sample ${problem.sample} was not seeded: ${problem.message}`);
      authority = installLocalAuthority({ repository: layout.authority, log: layout.authorityLog });
      Object.assign(process.env, seeded.env);
    },
  });

  writeFileSync(layout.server, `${JSON.stringify({ pid: process.pid, port, url: preview.url, startedAt: new Date().toISOString(), instance: randomUUID(),
    identity, packages: preview.summary.packages, dataDir: layout.root }, null, 2)}\n`);
  say(`serving ${preview.url}`);

  let closing = false;
  const shutdown = async reason => {
    if (closing) return;
    closing = true;
    say(`stopping (${reason})`);
    // Last resort if a connection holds the server open.
    setTimeout(() => process.exit(0), 15_000).unref();
    preview.server.closeAllConnections?.();
    await preview.close().catch(() => {});
    authority?.restore();
    rmSync(layout.server, { force: true });
    say('stopped');
    process.exit(0);
  };
  setInterval(() => { if (existsSync(layout.stopRequest)) shutdown('stop requested'); }, 500);
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(error => {
  say(`failed: ${error?.stack ?? error}`);
  process.exit(1);
});
