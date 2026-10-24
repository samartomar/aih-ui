import { mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { createWorkbench } from './server/workbench.mjs';
import { listen } from './server/static.mjs';
import { runInstalledPanelBrowser } from './consumer/installed-panel-browser.mjs';

// Runs after the ordinary integrated check has assembled the packed consumer and page. Only this
// server gets a disposable execution target; the existing unconfigured-host journeys stay as they are.
const consumerDir = resolve(process.argv[2]), runDir = join(consumerDir, 'prototype');
const summary = JSON.parse(await readFile(join(runDir, 'summary.json'), 'utf8'));
const project = join(consumerDir, `installed-project-${randomUUID().slice(0, 8)}`);
await mkdir(project, { recursive: true });
process.env.AIH_CONSUMER_PROJECT = project;
const workbench = await createWorkbench({ consumerDir, runDir, summary, settingsPath: join(project, 'settings.json') });
try {
  const address = await listen(workbench.server, 0);
  await runInstalledPanelBrowser({ origin: `http://127.0.0.1:${address.port}`, output: join(consumerDir, 'installed-panel-evidence'),
    playwrightModule: import.meta.resolve('playwright') });
} finally { await new Promise(resolve => workbench.server.close(resolve)); }
