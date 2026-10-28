import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pageAssets } from './server/assets.mjs';
import { createWorkbench } from './server/workbench.mjs';
import { listen } from './server/static.mjs';
import { runInstalledPanelBrowser } from './consumer/installed-panel-browser.mjs';
import { runFirstRunBrowser, runRestartInstallBrowser, runRestartVerifyBrowser, runMcpFailedApplyBrowser, runMcpApplyBrowser } from './consumer/ui165-acceptance-browser.mjs';
import { runProjectFolderBrowser } from './consumer/project-folder-browser.mjs';

// Runs after the ordinary integrated check has assembled the packed consumer and page. Only this
// server gets a disposable execution target; the existing unconfigured-host journeys stay as they are.
const consumerDir = resolve(process.argv[2]);
const summary = JSON.parse(await readFile(join(consumerDir, 'prototype/summary.json'), 'utf8'));
const project = join(consumerDir, `installed-project-${randomUUID().slice(0, 8)}`);
const cancelAfterFirst = process.argv.includes('--cancel');
await mkdir(project, { recursive: true });
const runDir = join(project, 'page'), repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const asset of pageAssets(repo)) {
  const target = join(runDir, asset.to); await mkdir(dirname(target), { recursive: true });
  await copyFile(join(repo, asset.from), target);
}
await writeFile(join(runDir, 'summary.json'), JSON.stringify(summary));
process.env.AIH_CONSUMER_PROJECT = project;
const workbench = await createWorkbench({ consumerDir, runDir, summary, settingsPath: join(project, 'settings.json') });
try {
  const address = await listen(workbench.server, 0);
  await runInstalledPanelBrowser({ origin: `http://127.0.0.1:${address.port}`, output: join(consumerDir, cancelAfterFirst ? 'removal-cancel-evidence' : 'installed-panel-evidence'),
    // One complete removal and one partial cancellation in CI; --cancel repeats the regression in both themes.
    playwrightModule: import.meta.resolve('playwright'), cancellationThemes: cancelAfterFirst ? ['dark', 'light'] : ['light'] });
  // The project folder and Your setup entry: typed, refused and recent folders, against the same disposable default.
  if (!cancelAfterFirst) await runProjectFolderBrowser({ origin: `http://127.0.0.1:${address.port}`, output: join(consumerDir, 'project-folder-evidence'),
    playwrightModule: import.meta.resolve('playwright'), project, other: `${project}-other` });
} finally { await new Promise(resolve => workbench.server.close(resolve)); }

// UI165 acceptance cases. Each case owns a fresh disposable target hosted by a REAL child Node process
// (tools/installed-host.mjs): the parent kills and reaps the child between phases and starts a fresh process
// on the same target, account home and settings. An in-process server recreation is not a process restart and
// is never described as one. A case the public fixtures cannot truthfully produce reports 'incomplete' and
// exits 2, never a silent pass.
async function withHost(project, { sources = undefined } = {}, run) {
  await mkdir(project, { recursive: true });
  const caseRunDir = join(project, 'page');
  for (const asset of pageAssets(repo)) {
    const target = join(caseRunDir, asset.to); await mkdir(dirname(target), { recursive: true });
    await copyFile(join(repo, asset.from), target);
  }
  const summaryPath = join(caseRunDir, 'summary.json');
  await writeFile(summaryPath, JSON.stringify(summary));
  const portPath = join(project, 'host.port'), configPath = join(project, 'host-config.json');
  await writeFile(configPath, JSON.stringify({
    consumerDir, runDir: caseRunDir, summaryPath, settingsPath: join(project, 'settings.json'), portPath,
    env: { AIH_CONSUMER_PROJECT: project, ...(sources ? { AIH_FRAMEWORK_SOURCES: sources } : {}) },
  }));
  await rm(portPath, { force: true });
  const child = spawn(process.execPath, [join(repo, 'tools/installed-host.mjs'), configPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  const log = [];
  child.stdout.on('data', chunk => log.push(String(chunk)));
  child.stderr.on('data', chunk => log.push(String(chunk)));
  const host = { pid: child.pid, project };
  let spawnError;
  child.once('error', error => { spawnError = error; });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const waitExit = async milliseconds => {
    let timer;
    try {
      return await Promise.race([exited, new Promise(resolve => { timer = setTimeout(() => resolve(null), milliseconds); })]);
    } finally { clearTimeout(timer); }
  };
  try {
    let port;
    for (let attempt = 0; attempt < 300; attempt++) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`host exited before ready: ${log.join('').slice(-2000)}`);
      if (existsSync(portPath)) { port = Number(readFileSync(portPath, 'utf8').trim()); break; }
      await new Promise(done => setTimeout(done, 100));
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`host did not write a valid port within 30s: ${log.join('').slice(-2000)}`);
    await run(`http://127.0.0.1:${port}`);
  } finally {
    if (child.pid && !spawnError) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      host.exit = await waitExit(5000);
      if (!host.exit) {
        child.kill('SIGKILL');
        host.exit = await waitExit(5000);
        throw new Error(`host required forced shutdown: ${JSON.stringify(host.exit)}`);
      }
      if (host.exit.code !== 0) throw new Error(`host did not exit cleanly: ${JSON.stringify(host.exit)}`);
    }
  }
  host.log = log.join('').slice(-2000);
  return host;
}
const caseOutcome = async (name, outcome) => {
  if (outcome.status === 'incomplete') { console.log(`${name} incomplete: ${outcome.reason}`); process.exitCode = 2; return; }
  if (outcome.status !== 'passed') throw new Error(`${name} failed: ${JSON.stringify(outcome)}`);
};
const playwrightPath = import.meta.resolve('playwright');

const restartProject = join(consumerDir, `restart-project-${randomUUID().slice(0, 8)}`);
const restartHosts = [];
restartHosts.push(await withHost(restartProject, {}, async origin =>
  await caseOutcome('restart install phase', await runRestartInstallBrowser({ origin, output: join(consumerDir, 'restart-install-evidence'), playwrightModule: playwrightPath }))));
// The first host process was killed and reaped above; this is a fresh process on the same target and account.
restartHosts.push(await withHost(restartProject, {}, async origin =>
  await caseOutcome('restart verify phase', await runRestartVerifyBrowser({ origin, output: join(consumerDir, 'restart-verify-evidence'), playwrightModule: playwrightPath }))));
assert.notEqual(restartHosts[0].pid, restartHosts[1].pid, 'the restart evidence names two distinct host processes');
await writeFile(join(consumerDir, 'restart-verify-evidence', 'host-processes.json'), JSON.stringify({ status: 'passed', hosts: restartHosts }, null, 2));

const firstRunProject = join(consumerDir, `first-run-project-${randomUUID().slice(0, 8)}`);
await withHost(firstRunProject, {}, async origin =>
  await caseOutcome('firstRun positive case', await runFirstRunBrowser({ origin, output: join(consumerDir, 'first-run-evidence'), playwrightModule: playwrightPath })));

// The MCP cases need the checked ECC release in the catalog. It loads through the same configured fixture
// route check-frameworks uses (frameworkFixtures + AIH_FRAMEWORK_SOURCES), scoped to these cases only; no
// Catalog source or archive change, no fabricated checked handle. The intentional unconfigured refusal
// coverage elsewhere stays on the default sources.
const { frameworkFixtures } = await import(pathToFileURL(join(consumerDir, 'consumer/framework-fixtures.mjs')).href);
const reviewed = JSON.parse(await readFile(join(consumerDir, 'reviewed-packages.json'), 'utf8'));
const catalogArtifact = reviewed.find(entry => entry.name === 'catalog');
if (!catalogArtifact?.tarball || !catalogArtifact?.sha256) throw new Error('reviewed-packages.json lacks the catalog archive identity for the ECC fixture route.');
const mcpFixtureDir = join(consumerDir, 'mcp-framework-fixtures');
const mcpFixture = await frameworkFixtures(mcpFixtureDir, catalogArtifact);
const mcpSources = join(mcpFixtureDir, 'sources.json');
await writeFile(mcpSources, JSON.stringify(mcpFixture.scenarios.browse));

const mcpProject = join(consumerDir, `mcp-apply-project-${randomUUID().slice(0, 8)}`);
await withHost(mcpProject, { sources: mcpSources }, async origin =>
  await caseOutcome('MCP failed Apply case', await runMcpFailedApplyBrowser({ origin, output: join(consumerDir, 'mcp-failed-apply-evidence'), project: mcpProject, playwrightModule: playwrightPath })));
await withHost(mcpProject, { sources: mcpSources }, async origin =>
  await caseOutcome('MCP ticked Apply case', await runMcpApplyBrowser({ origin, output: join(consumerDir, 'mcp-apply-evidence'), project: mcpProject, playwrightModule: playwrightPath })));
