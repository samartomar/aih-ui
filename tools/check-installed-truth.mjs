// The installed list, "Remove this set" and a namespaced rule's name against real Catalog sets, alone, after the packed
// consumer has been assembled (tools/check-workbench.mjs). check-installed-workbench.mjs runs the same three cases in
// both themes.
//
// Usage: node tools/check-installed-truth.mjs <consumerDir> [list|set-removal|namespaced-rule ...] [--theme dark|light]
// Each case gets a fresh disposable project and a real child host process (tools/installed-host.mjs).
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pageAssets } from './server/assets.mjs';
import { runInstalledListTruthBrowser, runNamespacedRuleTruthBrowser, runSetRemovalTruthBrowser } from './consumer/installed-truth-browser.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const consumerDir = resolve(args[0]);
const theme = args.includes('--theme') ? args[args.indexOf('--theme') + 1] : 'dark';
const named = args.slice(1).filter((value, index, all) => value !== '--theme' && all[index - 1] !== '--theme');
const cases = { list: runInstalledListTruthBrowser, 'set-removal': runSetRemovalTruthBrowser, 'namespaced-rule': runNamespacedRuleTruthBrowser };
const selected = named.length ? named : Object.keys(cases);
for (const name of selected) if (!cases[name]) throw new Error(`Unknown case ${name}; choose from ${Object.keys(cases).join(', ')}.`);

const summary = JSON.parse(await readFile(join(consumerDir, 'prototype/summary.json'), 'utf8'));
const { frameworkFixtures } = await import(pathToFileURL(join(consumerDir, 'consumer/framework-fixtures.mjs')).href);
const reviewed = JSON.parse(await readFile(join(consumerDir, 'reviewed-packages.json'), 'utf8'));
const catalogArtifact = reviewed.find(entry => entry.name === 'catalog');
const fixtureDir = join(consumerDir, 'installed-truth-fixtures');
// The checked Extensions, ECC and Superpowers releases, through the same public sources route the other cases use.
const sources = join(fixtureDir, 'sources.json');
await writeFile(sources, JSON.stringify((await frameworkFixtures(fixtureDir, catalogArtifact)).scenarios.facts));

async function withHost(project, run) {
  await mkdir(project, { recursive: true });
  const runDir = join(project, 'page');
  for (const asset of pageAssets(repo)) { const target = join(runDir, asset.to); await mkdir(dirname(target), { recursive: true }); await copyFile(join(repo, asset.from), target); }
  const summaryPath = join(runDir, 'summary.json'); await writeFile(summaryPath, JSON.stringify(summary));
  const portPath = join(project, 'host.port'), configPath = join(project, 'host-config.json');
  await writeFile(configPath, JSON.stringify({ consumerDir, runDir, summaryPath, settingsPath: join(project, 'settings.json'), portPath,
    env: { AIH_CONSUMER_PROJECT: project, AIH_FRAMEWORK_SOURCES: sources } }));
  await rm(portPath, { force: true });
  const child = spawn(process.execPath, [join(repo, 'tools/installed-host.mjs'), configPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  const log = []; child.stdout.on('data', chunk => log.push(String(chunk))); child.stderr.on('data', chunk => log.push(String(chunk)));
  const exited = new Promise(done => child.once('exit', (code, signal) => done({ code, signal })));
  try {
    let port;
    for (let attempt = 0; attempt < 300 && !port; attempt++) {
      if (child.exitCode !== null) throw new Error(`host exited before ready: ${log.join('').slice(-2000)}`);
      if (existsSync(portPath)) port = Number(readFileSync(portPath, 'utf8').trim()); else await new Promise(done => setTimeout(done, 100));
    }
    if (!port) throw new Error(`host did not start within 30s: ${log.join('').slice(-2000)}`);
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    await exited;
  }
}

const playwrightModule = import.meta.resolve('playwright');
for (const name of selected) {
  const project = join(consumerDir, `installed-truth-${name}-${theme}-${randomUUID().slice(0, 8)}`);
  const outcome = await withHost(project, origin => cases[name]({ origin, output: join(consumerDir, `installed-truth-evidence-${name}-${theme}`), project, playwrightModule, theme }));
  if (outcome.status !== 'passed') throw new Error(`${name} (${theme}) failed: ${JSON.stringify(outcome)}`);
  console.log(`installed truth ${name} (${theme}) passed`);
}
