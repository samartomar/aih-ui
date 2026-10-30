// A large install through the running page, alone, after the packed consumer has been assembled
// (tools/check-workbench.mjs): ECC's pre-ticked sets with TypeScript rules and Superpowers' set, Reviewed and
// Installed, with exact counts against Core's review. The host's Apply is held back by --apply-delay-ms (default 120 s)
// so the whole Apply outlasts the 300 s one request may wait for its answer, as it does on a slow disk.
//
// Usage: node tools/check-large-install.mjs <consumerDir> [default-pick|lost-contact|reload ...] [--apply-delay-ms N]
// Each case gets a fresh disposable project and a real child host process (tools/installed-host.mjs).
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pageAssets } from './server/assets.mjs';
import { runLargeInstallBrowser, runLostContactBrowser, runReloadBrowser } from './consumer/large-install-browser.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const consumerDir = resolve(args[0]);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const applyDelayMs = Number(option('--apply-delay-ms') ?? 120_000);
const named = args.slice(1).filter((value, index, all) => !value.startsWith('--') && !all[index - 1]?.startsWith('--'));
// lost-contact: the page gives up asking after about 60 s, so the host's Apply is held back 90 s and is still going then.
// reload: the page is reloaded a moment after Install starts, while the host's Apply is held back 30 s.
const cases = { 'default-pick': { run: runLargeInstallBrowser, applyDelayMs }, 'lost-contact': { run: runLostContactBrowser, applyDelayMs: 90_000 },
  reload: { run: runReloadBrowser, applyDelayMs: 30_000 } };
const selected = named.length ? named : Object.keys(cases);
for (const name of selected) if (!cases[name]) throw new Error(`Unknown case ${name}; choose from ${Object.keys(cases).join(', ')}.`);

const summary = JSON.parse(await readFile(join(consumerDir, 'prototype/summary.json'), 'utf8'));
const { frameworkFixtures } = await import(pathToFileURL(join(consumerDir, 'consumer/framework-fixtures.mjs')).href);
const reviewed = JSON.parse(await readFile(join(consumerDir, 'reviewed-packages.json'), 'utf8'));
const fixtureDir = join(consumerDir, 'large-install-fixtures');
const sources = join(fixtureDir, 'sources.json');
await writeFile(sources, JSON.stringify((await frameworkFixtures(fixtureDir, reviewed.find(entry => entry.name === 'catalog'))).scenarios.facts));

async function withHost(project, hostConfig, run) {
  await mkdir(project, { recursive: true });
  const runDir = join(project, 'page');
  for (const asset of pageAssets(repo)) { const target = join(runDir, asset.to); await mkdir(dirname(target), { recursive: true }); await copyFile(join(repo, asset.from), target); }
  const summaryPath = join(runDir, 'summary.json'); await writeFile(summaryPath, JSON.stringify(summary));
  const portPath = join(project, 'host.port'), configPath = join(project, 'host-config.json');
  await writeFile(configPath, JSON.stringify({ consumerDir, runDir, summaryPath, settingsPath: join(project, 'settings.json'), portPath, ...hostConfig,
    env: { AIH_CONSUMER_PROJECT: project, AIH_FRAMEWORK_SOURCES: sources } }));
  await rm(portPath, { force: true });
  const child = spawn(process.execPath, [join(repo, 'tools/installed-host.mjs'), configPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  const log = []; child.stdout.on('data', chunk => log.push(String(chunk))); child.stderr.on('data', chunk => log.push(String(chunk)));
  const exited = new Promise(done => child.once('exit', (code, signal) => done({ code, signal })));
  try {
    let port;
    for (let attempt = 0; attempt < 600 && !port; attempt++) {
      if (child.exitCode !== null) throw new Error(`host exited before ready: ${log.join('').slice(-2000)}`);
      if (existsSync(portPath)) port = Number(readFileSync(portPath, 'utf8').trim()); else await new Promise(done => setTimeout(done, 100));
    }
    if (!port) throw new Error(`host did not start within 60s: ${log.join('').slice(-2000)}`);
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    await exited;
    if (log.length) console.log(`host log (${project}):\n${log.join('').slice(-4000)}`);
  }
}

const playwrightModule = import.meta.resolve('playwright');
for (const name of selected) {
  const project = join(consumerDir, `large-install-${name}-${randomUUID().slice(0, 8)}`);
  const { run, applyDelayMs: delay } = cases[name];
  console.log(`large install ${name}: host Apply delay ${delay} ms`);
  const outcome = await withHost(project, delay ? { applyDelayMs: delay } : {}, origin => run({ origin, output: join(consumerDir, `large-install-evidence-${name}`), playwrightModule }));
  if (outcome.status !== 'passed') throw new Error(`${name} failed: ${JSON.stringify(outcome)}`);
  console.log(`large install ${name} passed: ${JSON.stringify(outcome)}`);
}
