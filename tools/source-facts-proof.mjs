// Run from an installed UI package with exact Core/Catalog/Scan software archives.
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pageAssets, serviceAssets } from './server/assets.mjs';
import { buildCss } from './build-css.mjs';
import { createWorkbench } from './server/workbench.mjs';
import { listen } from './server/static.mjs';
import { homeEnvironment } from './consumer/home-environment.mjs';
import { callService } from './server/service-client.mjs';
import { coreTargetsSummary } from './server/core-targets-summary.mjs';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const consumerDir = resolve(process.argv[2]), runDir = join(consumerDir, 'page');
// Preserve the browser binary location before moving the application's account home.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= process.platform === 'win32'
  ? join(process.env.LOCALAPPDATA, 'ms-playwright') : join(process.env.XDG_CACHE_HOME ?? join(process.env.HOME, '.cache'), 'ms-playwright');
Object.assign(process.env, homeEnvironment(join(consumerDir, 'home')));
await buildCss(repo);
for (const [assets, destination] of [[pageAssets(repo), runDir], [serviceAssets(repo), consumerDir]]) {
  for (const asset of assets) { const path = join(destination, asset.to); await mkdir(dirname(path), { recursive: true }); await copyFile(join(repo, asset.from), path); }
}
const packages = JSON.parse(await readFile(join(consumerDir, '..', 'reviewed-packages.json'), 'utf8'));
const summary = { packages, coreTargets: coreTargetsSummary(callService(consumerDir, { op: 'coreTargets' })) };
const started = await createWorkbench({ consumerDir, runDir, summary, settingsPath: join(consumerDir, 'settings.json') });
summary.entryCount = started.catalog.items.length; await writeFile(join(runDir, 'summary.json'), JSON.stringify(summary));
const address = await listen(started.server, Number(process.env.AIH_SOURCE_PROOF_PORT ?? 0));
const origin = `http://127.0.0.1:${address.port}`;
console.log(`Ordinary source-facts Workbench: ${origin}`);
await writeFile(join(consumerDir, 'running.json'), JSON.stringify({ pid: process.pid, origin, consumerDir, repo, packages }, null, 2));
try {
  const { runSourceFactsBrowser } = await import(pathToFileURL(join(consumerDir, 'consumer/source-facts-browser.mjs')));
  await runSourceFactsBrowser({ origin, output: join(consumerDir, 'evidence'), playwrightModule: import.meta.resolve('playwright') });
  console.log('Ordinary source-facts browser/headless proof passed.');
} catch (error) { await writeFile(join(consumerDir, 'failure.txt'), error.stack); console.error(error); process.exitCode = 1; }
if (process.env.AIH_SOURCE_PROOF_KEEP !== '1') await new Promise(resolve => started.server.close(resolve));
