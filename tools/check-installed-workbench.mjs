import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageAssets } from './server/assets.mjs';
import { createWorkbench } from './server/workbench.mjs';
import { listen } from './server/static.mjs';
import { runInstalledPanelBrowser } from './consumer/installed-panel-browser.mjs';
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
