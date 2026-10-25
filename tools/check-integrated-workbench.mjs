import { copyFile, mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pageAssets, serviceAssets } from './server/assets.mjs';
import { buildCss } from './build-css.mjs';
import { createWorkbench } from './server/workbench.mjs';
import { listen } from './server/static.mjs';
import { callService } from './server/service-client.mjs';
import { coreTargetsSummary } from './server/core-targets-summary.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const consumerDir = resolve(process.argv[2]), runDir = join(consumerDir, 'prototype');
const packages = JSON.parse(await readFile(join(consumerDir, 'reviewed-packages.json'), 'utf8'));
await buildCss(repo);
for (const [assets, destination] of [[pageAssets(repo), runDir], [serviceAssets(repo), consumerDir]]) {
  for (const asset of assets) { const path = join(destination, asset.to); await mkdir(dirname(path), { recursive: true }); await copyFile(join(repo, asset.from), path); }
}
const summary = { packages: await Promise.all(packages.map(async item => ({ ...item, packageName: `@aihq/${item.name}`, version: JSON.parse(await readFile(join(consumerDir, `node_modules/@aihq/${item.name}/package.json`), 'utf8')).version }))),
  coreTargets: coreTargetsSummary(callService(consumerDir, { op: 'coreTargets' })) };
// Host-configured maintenance source for the demonstration journey; it publishes no newer revision until that journey says so.
const maintenanceSource = join(consumerDir, 'maintenance-source.json');
await writeFile(maintenanceSource, JSON.stringify({ revisions: ['current'] }));
process.env.AIH_MAINTENANCE_SOURCE = maintenanceSource;
const frictionPath = join(consumerDir, 'friction-evidence.json');
await writeFile(frictionPath, JSON.stringify({ entries: null }));
process.env.AIH_FRICTION_EVIDENCE = frictionPath;
// Disposable reviewed-batch host input. batchFixture owns policy and record construction (conflict variant first: B's first
// target already holds unowned content); the journey removes that file as test setup. The stale-target fault is host
// configuration for B's first action, never an HTTP input. Each run uses a new fixture folder: Core keeps custody of what it
// applied per folder, so a reused path would no longer be a first setup.
const { batchFixture } = await import(pathToFileURL(join(consumerDir, 'consumer/batch-fixture.mjs')));
const batch = await batchFixture(join(consumerDir, `batch-fixture-${randomUUID().slice(0, 8)}`), { conflict: true });
const batchEnvelopePath = join(consumerDir, 'batch-envelope.json');
await writeFile(batchEnvelopePath, batch.envelopeBytes);
const batchFixturePath = join(consumerDir, 'batch-host.json');
await writeFile(batchFixturePath, JSON.stringify({ envelopePath: batchEnvelopePath, homes: batch.homes, coreHome: batch.coreHome, materialRoot: batch.materialRoot, faults: { 'b-core': 'stale-target' } }));
process.env.AIH_BATCH_FIXTURE = batchFixturePath;
const started = await createWorkbench({ consumerDir, runDir, summary, settingsPath: join(consumerDir, 'prototype-settings.json') });
summary.entryCount = started.catalog.items.length; await writeFile(join(runDir, 'summary.json'), JSON.stringify(summary));
const address = await listen(started.server, 0), origin = `http://127.0.0.1:${address.port}`;
// Each journey's start time is logged, so a stage cut off by its time budget shows which journey was running.
const began = Date.now(), starting = name => console.log(`[${((Date.now() - began) / 1000).toFixed(1)}s] Starting ${name}`);
try {
  const foreign = await fetch(origin + '/api/authoring-new', { method: 'POST', headers: { origin: 'https://untrusted.example', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(foreign.status, 403, 'The ordinary authoring adapter refuses a foreign origin.');
  const { runIntegratedBrowser } = await import(pathToFileURL(join(consumerDir, 'consumer/integrated-browser.mjs')));
  starting('runIntegratedBrowser'); await runIntegratedBrowser({ origin, output: join(consumerDir, 'prototype-evidence'), playwrightModule: pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href });
  const { runRestoredSurfacesBrowser } = await import(pathToFileURL(join(consumerDir, 'consumer/restored-surfaces-browser.mjs')));
  for (const theme of ['dark', 'light']) {
    starting(`runRestoredSurfacesBrowser ${theme}`); await runRestoredSurfacesBrowser({ origin, output: join(consumerDir, `restored-surfaces-evidence-${theme}`), playwrightModule: pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href, theme });
  }
  const { runSimplePathBrowser } = await import(pathToFileURL(join(consumerDir, 'consumer/simple-path-browser.mjs')));
  for (const theme of ['dark', 'light']) {
    starting(`runSimplePathBrowser ${theme}`); await runSimplePathBrowser({ origin, output: join(consumerDir, `simple-path-evidence-${theme}`), playwrightModule: pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href, theme });
  }
  // The visual groundwork and the start-up contract-check message, in both themes, against this host's own answer.
  const { runVisualGroundworkBrowser } = await import(pathToFileURL(join(consumerDir, 'consumer/visual-groundwork-browser.mjs')));
  // The Workbench's readers the installed Core lets it run (aih-ui/stored-results): those checks must pass on the page.
  const { fileStateReaderAvailable } = await import(pathToFileURL(join(consumerDir, 'consumer/stored-results.mjs')));
  const readers = ['urn:aihq:core:native-verification-result:1.0.0', ...(fileStateReaderAvailable ? ['urn:aihq:core:file-state-result:1.1.0'] : [])];
  for (const theme of ['dark', 'light']) {
    starting(`runVisualGroundworkBrowser ${theme}`); await runVisualGroundworkBrowser({ origin, output: join(consumerDir, `visual-groundwork-evidence-${theme}`), playwrightModule: pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href, theme, readers });
  }
  // With a Core that publishes checkContracts, a second host is given a newer writer's declaration that Core refuses, so
  // "can't read" is shown through Core's real engine. A Core without it has no engine to refuse anything.
  const engine = callService(consumerDir, { op: 'contractCheck' });
  if (engine.ok && engine.state !== 'absent') {
    process.env.AIH_CONTRACT_CHECK_EXTRA = join(consumerDir, 'consumer/fixtures/contract-check/refused.json');
    const refused = await createWorkbench({ consumerDir, runDir, summary, settingsPath: join(consumerDir, 'refused-settings.json') });
    try {
      const refusedOrigin = `http://127.0.0.1:${(await listen(refused.server, 0)).port}`;
      for (const theme of ['dark', 'light']) {
        starting(`runVisualGroundworkBrowser refused ${theme}`); await runVisualGroundworkBrowser({ origin: refusedOrigin, output: join(consumerDir, `visual-groundwork-refused-evidence-${theme}`), playwrightModule: pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href, theme, actual: 'refused', readers });
      }
    } finally { delete process.env.AIH_CONTRACT_CHECK_EXTRA; await new Promise(resolve => refused.server.close(resolve)); }
  } else console.log(`The installed Core publishes no checkContracts (${engine.state ?? engine.error}); the real-engine "can't read" journey needs one.`);
  const { runSourceFactsBrowser } = await import(pathToFileURL(join(consumerDir, 'consumer/source-facts-browser.mjs')));
  starting('runSourceFactsBrowser'); await runSourceFactsBrowser({ origin, output: join(consumerDir, 'source-facts-evidence'), playwrightModule: pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href });
  const { runUnresolvedDraftBrowser } = await import(pathToFileURL(join(consumerDir, 'consumer/unresolved-draft-browser.mjs')));
  starting('runUnresolvedDraftBrowser'); await runUnresolvedDraftBrowser({ origin, output: join(consumerDir, 'unresolved-draft-evidence'), playwrightModule: pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href });
  const { runMaintenanceBrowser } = await import(pathToFileURL(join(consumerDir, 'consumer/maintenance-browser.mjs')));
  starting('runMaintenanceBrowser'); await runMaintenanceBrowser({ origin, output: join(consumerDir, 'maintenance-evidence'), playwrightModule: pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href, sourcePath: maintenanceSource });
  const { runReviewIdentityBrowser } = await import(pathToFileURL(join(consumerDir, 'consumer/review-identity-browser.mjs')));
  starting('runReviewIdentityBrowser'); await runReviewIdentityBrowser({ origin, output: join(consumerDir, 'review-identity-evidence'), playwrightModule: pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href });
  const { runEvidenceStatesBrowser } = await import(pathToFileURL(join(consumerDir, 'consumer/evidence-states-browser.mjs')));
  starting('runEvidenceStatesBrowser'); await runEvidenceStatesBrowser({ origin, output: join(consumerDir, 'evidence-states-evidence'), playwrightModule: pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href });
  const { runImprovementsBrowser } = await import(pathToFileURL(join(consumerDir, 'consumer/improvements-browser.mjs')));
  starting('runImprovementsBrowser'); await runImprovementsBrowser({ origin, output: join(consumerDir, 'improvements-evidence'), playwrightModule: pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href, settingsPath: join(consumerDir, 'prototype-settings.json'), sourcePath: maintenanceSource, frictionPath });
  const { runTrialsBrowser } = await import(pathToFileURL(join(consumerDir, 'consumer/trials-browser.mjs')));
  starting('runTrialsBrowser'); await runTrialsBrowser({ origin, output: join(consumerDir, 'trials-evidence'), playwrightModule: pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href, settingsPath: join(consumerDir, 'prototype-settings.json'), sourcePath: maintenanceSource });
  const { runWorkspaceBrowser } = await import(pathToFileURL(join(consumerDir, 'consumer/workspace-browser.mjs')));
  starting('runWorkspaceBrowser'); await runWorkspaceBrowser({ origin, output: join(consumerDir, 'workspace-evidence'), playwrightModule: pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href });
  const { runBatchBrowser } = await import(pathToFileURL(join(consumerDir, 'consumer/batch-browser.mjs')));
  starting('runBatchBrowser'); await runBatchBrowser({ origin, output: join(consumerDir, 'batch-evidence'), playwrightModule: pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href, fixturePath: batchFixturePath,
    conflictFile: batch.conflictFile, procMarker: batch.procMarker, procCount: batch.procCount, userFiles: batch.userFiles });
  const { runReportPageBrowser } = await import(pathToFileURL(join(repo, 'tools/report/page-browser.mjs')));
  starting('runReportPageBrowser'); await runReportPageBrowser({ origin, consumerDir, output: join(consumerDir, 'report-page-evidence'), playwrightModule: pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href });
} finally { delete process.env.AIH_FRICTION_EVIDENCE; delete process.env.AIH_BATCH_FIXTURE; delete process.env.AIH_MAINTENANCE_SOURCE; await new Promise(resolve => started.server.close(resolve)); }

// The normal application's startup must refuse an absent required family,
// before it can serve a deceptively incomplete inventory. Only this isolated
// installation is changed, and the original installed bytes are restored.
const release = createRequire(join(consumerDir, 'package.json')).resolve('@aihq/catalog/release-anthropic.json');
await rename(release, release + '.missing');
try {
  await assert.rejects(createWorkbench({ consumerDir, runDir, summary, settingsPath: join(consumerDir, 'negative-settings.json') }), /Anthropic|release-anthropic/);
  console.log('Normal Workbench startup refuses a missing required Anthropic family.');
} finally { await rename(release + '.missing', release); }
