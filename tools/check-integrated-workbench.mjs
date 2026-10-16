import { copyFile, mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
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
// Retained operations must enter their lazy package boundary. Current archives
// may refuse a retired contract, but must not misreport it as an unknown route.
for (const op of ['parseEvidence', 'prepare', 'consume', 'fixture']) {
  const result = callService(consumerDir, { op });
  assert.doesNotMatch(result.error ?? '', /unknown op:/, `${op} must dispatch to its supported-contract check`);
}
const summary = { packages: await Promise.all(packages.map(async item => ({ ...item, packageName: `@aihq/${item.name}`, version: JSON.parse(await readFile(join(consumerDir, `node_modules/@aihq/${item.name}/package.json`), 'utf8')).version }))),
  coreTargets: coreTargetsSummary(callService(consumerDir, { op: 'coreTargets' })) };
// Host-configured maintenance source for the demonstration journey; it publishes no newer revision until that journey says so.
const maintenanceSource = join(consumerDir, 'maintenance-source.json');
await writeFile(maintenanceSource, JSON.stringify({ revisions: ['current'] }));
process.env.AIH_MAINTENANCE_SOURCE = maintenanceSource;
// Disposable reviewed-batch host input. batchFixture owns policy/record construction;
// this adapter receives only the resulting envelope and fixture directories.
const { batchFixture } = await import(pathToFileURL(join(consumerDir, 'consumer/batch-fixture.mjs')));
const batch = await batchFixture({ root: join(consumerDir, 'batch-fixture') });
const batchEnvelopePath = join(consumerDir, 'batch-envelope.json');
await writeFile(batchEnvelopePath, batch.envelopeBytes);
const batchFixturePath = join(consumerDir, 'batch-host.json');
await writeFile(batchFixturePath, JSON.stringify({ envelopePath: batchEnvelopePath, homes: batch.homes, materialRoot: batch.materialRoot, faults: batch.faults }));
process.env.AIH_BATCH_FIXTURE = batchFixturePath;
const started = await createWorkbench({ consumerDir, runDir, summary, settingsPath: join(consumerDir, 'prototype-settings.json') });
summary.entryCount = started.catalog.items.length; await writeFile(join(runDir, 'summary.json'), JSON.stringify(summary));
const address = await listen(started.server, 0), origin = `http://127.0.0.1:${address.port}`;
try {
  const foreign = await fetch(origin + '/api/authoring-new', { method: 'POST', headers: { origin: 'https://untrusted.example', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(foreign.status, 403, 'The ordinary authoring adapter refuses a foreign origin.');
  const { runIntegratedBrowser } = await import(pathToFileURL(join(consumerDir, 'consumer/integrated-browser.mjs')));
  await runIntegratedBrowser({ origin, output: join(consumerDir, 'prototype-evidence'), playwrightModule: pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href });
  const { runUnresolvedDraftBrowser } = await import(pathToFileURL(join(consumerDir, 'consumer/unresolved-draft-browser.mjs')));
  await runUnresolvedDraftBrowser({ origin, output: join(consumerDir, 'unresolved-draft-evidence'), playwrightModule: pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href });
  const { runMaintenanceBrowser } = await import(pathToFileURL(join(consumerDir, 'consumer/maintenance-browser.mjs')));
  await runMaintenanceBrowser({ origin, output: join(consumerDir, 'maintenance-evidence'), playwrightModule: pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href, sourcePath: maintenanceSource });
  const { runReviewIdentityBrowser } = await import(pathToFileURL(join(consumerDir, 'consumer/review-identity-browser.mjs')));
  await runReviewIdentityBrowser({ origin, output: join(consumerDir, 'review-identity-evidence'), playwrightModule: pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href });
  const { runImprovementsBrowser } = await import(pathToFileURL(join(consumerDir, 'consumer/improvements-browser.mjs')));
  await runImprovementsBrowser({ origin, output: join(consumerDir, 'improvements-evidence'), playwrightModule: pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href, settingsPath: join(consumerDir, 'prototype-settings.json') });
  const { runWorkspaceBrowser } = await import(pathToFileURL(join(consumerDir, 'consumer/workspace-browser.mjs')));
  await runWorkspaceBrowser({ origin, output: join(consumerDir, 'workspace-evidence'), playwrightModule: pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href });
  const { runBatchBrowser } = await import(pathToFileURL(join(consumerDir, 'consumer/batch-browser.mjs')));
  await runBatchBrowser({ origin, output: join(consumerDir, 'batch-evidence'), playwrightModule: pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href, fixturePath: batchFixturePath });
} finally { delete process.env.AIH_BATCH_FIXTURE; delete process.env.AIH_MAINTENANCE_SOURCE; await new Promise(resolve => started.server.close(resolve)); }

// The normal application's startup must refuse an absent required family,
// before it can serve a deceptively incomplete inventory. Only this isolated
// installation is changed, and the original installed bytes are restored.
const release = createRequire(join(consumerDir, 'package.json')).resolve('@aihq/catalog/release-anthropic.json');
await rename(release, release + '.missing');
try {
  await assert.rejects(createWorkbench({ consumerDir, runDir, summary, settingsPath: join(consumerDir, 'negative-settings.json') }), /Anthropic|release-anthropic/);
  console.log('Normal Workbench startup refuses a missing required Anthropic family.');
} finally { await rename(release + '.missing', release); }
