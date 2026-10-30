import { appendFile, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pageAssets } from './server/assets.mjs';
import { buildCss } from './build-css.mjs';
import { createWorkbench } from './server/workbench.mjs';
import { listen } from './server/static.mjs';
import { runInstalledPanelBrowser } from './consumer/installed-panel-browser.mjs';
import { runFirstRunBrowser, runRestartInstallBrowser, runRestartVerifyBrowser, runMcpFailedApplyBrowser, runMcpApplyBrowser, runStaleReviewBrowser } from './consumer/ui165-acceptance-browser.mjs';
import { runProjectFolderBrowser } from './consumer/project-folder-browser.mjs';
import { runMcpFailedRunBrowser } from './consumer/ui165-failed-run-browser.mjs';
import { runUi168UpdateVerifyBrowser } from './consumer/ui168-update-browser.mjs';
import { runUpdateOneInstallBrowser } from './consumer/installed-truth-browser.mjs';
import { stageNewerCatalog } from './newer-catalog.mjs';
import { runUi168ProjectBasicsBrowser, runUi168BlockDriftBrowser } from './consumer/ui168-project-basics-browser.mjs';
import { runUi168SetRemovalBrowser } from './consumer/ui168-set-removal-browser.mjs';
import { runUi168InterruptStartBrowser, runUi168InterruptedVerifyBrowser } from './consumer/ui168-interrupted-browser.mjs';
import { runInstalledListTruthBrowser, runNamespacedRuleTruthBrowser, runNeededRemovalTruthBrowser, runSetRemovalTruthBrowser, runSharedBlockTruthBrowser } from './consumer/installed-truth-browser.mjs';

// Runs after the ordinary integrated check has assembled the packed consumer and page. Only this
// server gets a disposable execution target; the existing unconfigured-host journeys stay as they are.
const consumerDir = resolve(process.argv[2]);
const summary = JSON.parse(await readFile(join(consumerDir, 'prototype/summary.json'), 'utf8'));
const project = join(consumerDir, `installed-project-${randomUUID().slice(0, 8)}`);
const cancelAfterFirst = process.argv.includes('--cancel');
await mkdir(project, { recursive: true });
const runDir = join(project, 'page'), repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// A fresh checkout has no built Tailwind (see check-installed-truth.mjs).
await buildCss(repo);
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
  if (!cancelAfterFirst) for (const timingState of ['loading', 'unavailable', 'failed']) {
    await runInstalledPanelBrowser({ origin: `http://127.0.0.1:${address.port}`, output: join(consumerDir, `installed-timing-state-${timingState}`),
      playwrightModule: import.meta.resolve('playwright'), timingState });
  }
} finally { await new Promise(resolve => workbench.server.close(resolve)); }

// UI165 acceptance cases. Each case owns a fresh disposable target hosted by a REAL child Node process
// (tools/installed-host.mjs): the parent kills and reaps the child between phases and starts a fresh process
// on the same target, account home and settings. An in-process server recreation is not a process restart and
// is never described as one. A case the public fixtures cannot truthfully produce reports 'incomplete' and
// exits 2, never a silent pass.
async function withHost(project, { sources = undefined, consumer = consumerDir, interrupt = false, kill = false } = {}, run) {
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
    consumerDir: consumer, runDir: caseRunDir, summaryPath, settingsPath: join(project, 'settings.json'), portPath, interrupt,
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
    host.result = await run(`http://127.0.0.1:${port}`);
  } finally {
    if (child.pid && !spawnError) {
      if (child.exitCode === null && child.signalCode === null) child.kill(kill ? 'SIGKILL' : 'SIGTERM');
      host.exit = await waitExit(5000);
      if (!host.exit) {
        child.kill('SIGKILL');
        host.exit = await waitExit(5000);
        throw new Error(`host required forced shutdown: ${JSON.stringify(host.exit)}`);
      }
      if (!kill && host.exit.code !== 0) throw new Error(`host did not exit cleanly: ${JSON.stringify(host.exit)}`);
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

// The MCP cases (and the mixed-source restart path) need the checked ECC release in the catalog. It loads
// through the same configured fixture route check-frameworks uses (frameworkFixtures + AIH_FRAMEWORK_SOURCES),
// scoped to those cases' child processes; no Catalog source or archive change, no fabricated checked handle.
const { frameworkFixtures } = await import(pathToFileURL(join(consumerDir, 'consumer/framework-fixtures.mjs')).href);
const reviewed = JSON.parse(await readFile(join(consumerDir, 'reviewed-packages.json'), 'utf8'));
const catalogArtifact = reviewed.find(entry => entry.name === 'catalog');
if (!catalogArtifact?.tarball || !catalogArtifact?.sha256) throw new Error('reviewed-packages.json lacks the catalog archive identity for the ECC fixture route.');
const mcpFixtureDir = join(consumerDir, 'mcp-framework-fixtures');
const mcpFixture = await frameworkFixtures(mcpFixtureDir, catalogArtifact);
const mcpSources = join(mcpFixtureDir, 'sources.json');
await writeFile(mcpSources, JSON.stringify(mcpFixture.scenarios.browse));
const factsSources = join(mcpFixtureDir, 'facts-sources.json');
await writeFile(factsSources, JSON.stringify(mcpFixture.scenarios.facts));
// UI168 update: a Catalog pack built with Catalog's own generator from the installed Catalog, in which exactly one installed
// ECC TypeScript rule changed. Without one the update cases are incomplete (exit 2), never passed.
const uiUpdate = process.env.CATALOG_UPDATE_TGZ ? await stageNewerCatalog({ consumerDir, fixtureDir: mcpFixtureDir, sources: factsSources, name: 'ui168-update',
  pack: resolve(process.env.CATALOG_UPDATE_TGZ), changes: /^ecc:ecc\.rule\.typescript\./ }) : undefined;
if (!uiUpdate) process.exitCode = 2;
// The mixed restart path adds one plain ECC item alongside grill-me, chosen by the fixture from positive
// public fit + resolution facts. When no candidate passes those facts, the mixed criterion is explicitly
// incomplete (exit 2) - Extensions-only is never reported as the mixed acceptance.
const mixedEcc = mcpFixture.expected?.ecc?.mixed ?? null;
if (!mixedEcc) {
  console.log('mixed ECC+Extensions restart incomplete: no plain ECC item passed the public fit + resolution facts (options-set refusal does not imply all of ECC is unavailable).');
  process.exitCode = 2;
}

// Every case runs in BOTH themes, each with its own disposable target, host processes and output; a theme
// never reuses another theme's project or process evidence.
const THEMES = ['dark', 'light'];
for (const theme of THEMES) {
  const restartProject = join(consumerDir, `restart-project-${theme}-${randomUUID().slice(0, 8)}`);
  const restartHosts = [];
  restartHosts.push(await withHost(restartProject, { sources: mcpSources }, async origin =>
    await caseOutcome(`restart install phase (${theme})`, await runRestartInstallBrowser({ origin, output: join(consumerDir, `restart-install-evidence-${theme}`), playwrightModule: playwrightPath, theme, extraItem: mixedEcc?.id ?? null, extraName: mixedEcc?.name ?? null }))));
  // The first host process was killed and reaped above; this is a fresh process on the same target and account.
  restartHosts.push(await withHost(restartProject, { sources: mcpSources }, async origin =>
    await caseOutcome(`restart verify phase (${theme})`, await runRestartVerifyBrowser({ origin, output: join(consumerDir, `restart-verify-evidence-${theme}`), playwrightModule: playwrightPath, theme, project: restartProject, extraItem: mixedEcc?.id ?? null, extraName: mixedEcc?.name ?? null }))));
  assert.notEqual(restartHosts[0].pid, restartHosts[1].pid, `the ${theme} restart evidence names two distinct host processes`);
  await writeFile(join(consumerDir, `restart-verify-evidence-${theme}`, 'host-processes.json'), JSON.stringify({ status: 'passed', theme, hosts: restartHosts }, null, 2));

  // The positive firstRun case needs the Extensions FRAMEWORK open (starting sets render only in a framework
  // context); the checked release's published sets arrive through the same public sources route the mixed
  // cases use - the sets themselves are the release's own, never manufactured.
  const firstRunProject = join(consumerDir, `first-run-project-${theme}-${randomUUID().slice(0, 8)}`);
  await withHost(firstRunProject, { sources: mcpSources }, async origin =>
    await caseOutcome(`firstRun positive case (${theme})`, await runFirstRunBrowser({ origin, output: join(consumerDir, `first-run-evidence-${theme}`), playwrightModule: playwrightPath, theme })));

  const staleProject = join(consumerDir, `stale-review-project-${theme}-${randomUUID().slice(0, 8)}`);
  await withHost(staleProject, {}, async origin =>
    await caseOutcome(`REVIEW_STALE install-preview case (${theme})`, await runStaleReviewBrowser({ origin, output: join(consumerDir, `stale-review-evidence-${theme}`), project: staleProject, playwrightModule: playwrightPath, theme })));

  const mcpProject = join(consumerDir, `mcp-apply-project-${theme}-${randomUUID().slice(0, 8)}`);
  await withHost(mcpProject, { sources: mcpSources }, async origin =>
    await caseOutcome(`MCP preparation refusal case (${theme})`, await runMcpFailedApplyBrowser({ origin, output: join(consumerDir, `mcp-failed-apply-evidence-${theme}`), project: mcpProject, playwrightModule: playwrightPath, theme })));
  const failedRunProject = join(consumerDir, `mcp-failed-run-project-${theme}-${randomUUID().slice(0, 8)}`);
  await withHost(failedRunProject, { sources: mcpSources }, async origin =>
    await caseOutcome(`MCP failed run case (${theme})`, await runMcpFailedRunBrowser({ origin, output: join(consumerDir, `mcp-failed-run-evidence-${theme}`), project: failedRunProject, playwrightModule: playwrightPath, theme })));
  await withHost(mcpProject, { sources: mcpSources }, async origin =>
    await caseOutcome(`MCP ticked Apply case (${theme})`, await runMcpApplyBrowser({ origin, output: join(consumerDir, `mcp-apply-evidence-${theme}`), project: mcpProject, playwrightModule: playwrightPath, theme })));

  // UI168 update against a real newer Catalog (see the staging above). The clean project also shows the page's loading,
  // unavailable and failed update states first: they replace only the host's answer and change nothing.
  if (!uiUpdate) console.log(`UI168 update cases incomplete (${theme}): set CATALOG_UPDATE_TGZ to a Catalog pack in which exactly one installed ECC TypeScript rule changed.`);
  else for (const edited of [false, true]) {
    const updateProject = join(consumerDir, `ui168-update-${theme}-${edited}-${randomUUID().slice(0, 8)}`);
    const installed = await withHost(updateProject, { sources: uiUpdate.installSources }, async origin =>
      await runUpdateOneInstallBrowser({ origin, output: join(consumerDir, `ui168-update-install-${theme}-${edited}`), playwrightModule: playwrightPath, theme }));
    if (installed.result?.status !== 'passed') throw new Error(`UI168 update install (${theme}, edited=${edited}) failed: ${JSON.stringify(installed.result)}`);
    // The item's files where Core says it wrote them.
    const target = installed.result.inventory.selections.find(selection => selection.item?.itemId === uiUpdate.itemId && selection.scope === 'project');
    if (!target) throw new Error(`Core lists no installed ${uiUpdate.itemId}`);
    const files = target.members.filter(member => member.kind === 'file').map(member => member.path);
    if (!files.length) throw new Error(`Core lists no files for ${uiUpdate.itemId}`);
    const read = async () => Object.fromEntries(await Promise.all(files.map(async path => [path, (await readFile(path)).toString('base64')])));
    if (edited) await appendFile(files[0], '\nLocal edit must survive.\n');
    const before = await read();
    const output = join(consumerDir, `ui168-update-verify-${theme}-${edited}`);
    await withHost(updateProject, { sources: uiUpdate.updateSources, consumer: uiUpdate.updatedConsumer }, async origin => {
      // Unavailable and failed replace only the host's answer: nothing may change. Loading delays the real answer, so on
      // the clean project it is the reviewed update itself.
      if (!edited) for (const operationState of ['unavailable', 'failed']) {
        await caseOutcome(`UI168 update ${operationState} state (${theme})`, await runUi168UpdateVerifyBrowser({ origin, output: join(consumerDir, `ui168-update-state-${theme}-${operationState}`),
          playwrightModule: playwrightPath, theme, itemId: uiUpdate.itemId, operationState }));
        if (JSON.stringify(await read()) !== JSON.stringify(before)) throw new Error(`the ${operationState} update state changed ${uiUpdate.itemId}'s files`);
      }
      const updated = await runUi168UpdateVerifyBrowser({ origin, output, playwrightModule: playwrightPath, theme,
        itemId: uiUpdate.itemId, ...(edited ? { edited: files[0] } : { operationState: 'loading' }) });
      await caseOutcome(`UI168 reviewed update (${theme}, edited=${edited})`, updated);
      if (!edited) {
        // Core now records the newer item and offers it no update.
        const now = updated.after.selections.find(selection => selection.managementId === target.managementId);
        if (!now || now.updateState === 'update-available' || now.item?.contentSha256 !== uiUpdate.newer.contentSha256 || now.item?.behaviourSha256 !== uiUpdate.newer.behaviourSha256)
          throw new Error(`after the update Core records ${JSON.stringify({ updateState: now?.updateState, item: now?.item })}, not ${JSON.stringify(uiUpdate.newer)}`);
      }
    });
    // At the paths Core reported: a refused update leaves every file as it was, the person's edit included; a reviewed
    // update writes the newer content there.
    const after = await read();
    if (edited) {
      if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error(`a refused update changed ${uiUpdate.itemId}'s files`);
    } else {
      // Each file Core reports is the newer Catalog's content material at that item-relative path, byte for byte. (Core
      // decides which materials it delivers as the item's files: this rule's LICENSE is not one of them.)
      for (const [path, bytes] of Object.entries(after)) {
        const material = uiUpdate.newer.materials.filter(entry => path.replace(/\\/g, '/').endsWith(`/${entry.relPath}`));
        const digest = createHash('sha256').update(Buffer.from(bytes, 'base64')).digest('hex');
        if (material.length !== 1 || material[0].sha256 !== digest)
          throw new Error(`${path} after the update (${digest}) is not the newer Catalog's material for it: ${JSON.stringify(uiUpdate.newer.materials)}`);
      }
    }
  }

  const basicsProject = join(consumerDir, `ui168-basics-${theme}-${randomUUID().slice(0, 8)}`);
  await mkdir(basicsProject, { recursive: true });
  await writeFile(join(basicsProject, 'package.json'), JSON.stringify({ name: 'ui168-facts-fixture', private: true, type: 'module', engines: { node: '>=26 <27' }, scripts: { test: 'node --test' } }, null, 2));
  await withHost(basicsProject, { sources: mcpSources }, async origin =>
    await caseOutcome(`UI168 project facts and install (${theme})`, await runUi168ProjectBasicsBrowser({ origin, output: join(consumerDir, `ui168-basics-evidence-${theme}`), playwrightModule: playwrightPath, theme })));
  // An empty project folder: Core's review carries no project facts. (Facts arrive with the review, so there is no
  // separate loading, unavailable or failed facts state to show.)
  const emptyFactsProject = join(consumerDir, `ui168-facts-state-${theme}-empty-${randomUUID().slice(0, 8)}`);
  await mkdir(emptyFactsProject, { recursive: true });
  await withHost(emptyFactsProject, { sources: mcpSources }, async origin =>
    await caseOutcome(`UI168 project facts empty state (${theme})`, await runUi168ProjectBasicsBrowser({ origin, output: join(consumerDir, `ui168-facts-state-${theme}-empty`), playwrightModule: playwrightPath, theme, factsState: 'empty' })));
  const driftProject = join(consumerDir, `ui168-drift-${theme}-${randomUUID().slice(0, 8)}`);
  await withHost(driftProject, { sources: mcpSources }, async origin =>
    await caseOutcome(`UI168 managed block drift (${theme})`, await runUi168BlockDriftBrowser({ origin, output: join(consumerDir, `ui168-drift-evidence-${theme}`), project: driftProject, playwrightModule: playwrightPath, theme })));
  const setProject = join(consumerDir, `ui168-set-${theme}-${randomUUID().slice(0, 8)}`);
  await withHost(setProject, { sources: mcpSources }, async origin =>
    await caseOutcome(`UI168 grouped set removal with kept members (${theme})`, await runUi168SetRemovalBrowser({ origin, output: join(consumerDir, `ui168-set-evidence-${theme}`), playwrightModule: playwrightPath, theme })));
  // The installed list, "Remove this set" and a namespaced rule in a fresh session, read back from Core alone (real
  // Superpowers, overlapping Extensions and ECC TypeScript rules sets through the facts sources route).
  const truthListProject = join(consumerDir, `installed-truth-list-${theme}-${randomUUID().slice(0, 8)}`);
  await withHost(truthListProject, { sources: factsSources }, async origin =>
    await caseOutcome(`installed list from Core (${theme})`, await runInstalledListTruthBrowser({ origin, output: join(consumerDir, `installed-truth-list-evidence-${theme}`), project: truthListProject, playwrightModule: playwrightPath, theme })));
  const truthSetProject = join(consumerDir, `installed-truth-set-${theme}-${randomUUID().slice(0, 8)}`);
  await withHost(truthSetProject, { sources: factsSources }, async origin =>
    await caseOutcome(`Remove this set with a shared member (${theme})`, await runSetRemovalTruthBrowser({ origin, output: join(consumerDir, `installed-truth-set-evidence-${theme}`), project: truthSetProject, playwrightModule: playwrightPath, theme })));
  // A namespaced ECC rule (real TypeScript rules set) named "{display.name} ({namespace})" in the list and its removal.
  const truthRuleProject = join(consumerDir, `installed-truth-rule-${theme}-${randomUUID().slice(0, 8)}`);
  await withHost(truthRuleProject, { sources: factsSources }, async origin =>
    await caseOutcome(`namespaced rule named with its namespace (${theme})`, await runNamespacedRuleTruthBrowser({ origin, output: join(consumerDir, `installed-truth-rule-evidence-${theme}`), project: truthRuleProject, playwrightModule: playwrightPath, theme })));
  // Project basics' shared block from its card in a project with no facts, and git-guard removed with its notices.
  const truthBlockProject = join(consumerDir, `installed-truth-shared-block-${theme}-${randomUUID().slice(0, 8)}`);
  await withHost(truthBlockProject, { sources: factsSources }, async origin =>
    await caseOutcome(`shared block added and written (${theme})`, await runSharedBlockTruthBrowser({ origin, output: join(consumerDir, `installed-truth-shared-block-evidence-${theme}`), project: truthBlockProject, playwrightModule: playwrightPath, theme })));
  const truthNeededProject = join(consumerDir, `installed-truth-needed-${theme}-${randomUUID().slice(0, 8)}`);
  await withHost(truthNeededProject, { sources: factsSources }, async origin =>
    await caseOutcome(`a chosen item removed with what it needs (${theme})`, await runNeededRemovalTruthBrowser({ origin, output: join(consumerDir, `installed-truth-needed-evidence-${theme}`), project: truthNeededProject, playwrightModule: playwrightPath, theme })));

  for (const action of ['finish', 'remove']) {
    const interruptedProject = join(consumerDir, `ui168-interrupted-${theme}-${action}-${randomUUID().slice(0, 8)}`);
    const interrupted = await withHost(interruptedProject, { interrupt: true, kill: true }, async origin =>
      await runUi168InterruptStartBrowser({ origin, output: join(consumerDir, `ui168-interrupted-evidence-${theme}-${action}`), project: interruptedProject, playwrightModule: playwrightPath, theme }));
    await withHost(interruptedProject, {}, async origin =>
      await caseOutcome(`UI168 interrupted install ${action} (${theme})`, await runUi168InterruptedVerifyBrowser({ origin, output: join(consumerDir, `ui168-interrupted-evidence-${theme}-${action}`), saved: interrupted.result.saved, action, playwrightModule: playwrightPath, theme })));
  }
}
