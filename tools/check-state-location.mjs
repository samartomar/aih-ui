// Running-page acceptance against installed packed public packages. Host-only fixture inputs replace
// the external Core location reader, never an HTTP field or a browser-selected state location.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createWorkbench } from './server/workbench.mjs';
import { listen } from './server/static.mjs';
import { pageAssets, serviceAssets } from './server/assets.mjs';
import { homeEnvironment } from './consumer/home-environment.mjs';
import { addFromCatalog, chooseCatalogFamily } from './consumer/policy-drawer.mjs';

const consumerDir = resolve(process.argv[2]);
const output = resolve(process.argv[3] ?? join(consumerDir, 'state-location-evidence'));
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(output, { recursive: true });
for (const asset of serviceAssets(repo)) {
  const target = join(consumerDir, asset.to); await mkdir(dirname(target), { recursive: true }); await copyFile(join(repo, asset.from), target);
}
const runDir = join(output, 'page');
for (const asset of pageAssets(repo)) {
  const target = join(runDir, asset.to); await mkdir(dirname(target), { recursive: true }); await copyFile(join(repo, asset.from), target);
}
const summary = JSON.parse(await readFile(join(consumerDir, 'prototype/summary.json'), 'utf8'));
await writeFile(join(runDir, 'summary.json'), JSON.stringify(summary));
Object.assign(process.env, homeEnvironment(join(output, 'home')));
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });
const errors = [], outcomes = [];
try {
  for (const mode of (process.env.AIH_STATE_LOCATION_CASE ? [process.env.AIH_STATE_LOCATION_CASE] : ['published', 'relocated', 'unavailable'])) {
    console.log(`State location: ${mode}`);
    const unavailable = mode === 'unavailable';
    const { loadCoreState } = await import(pathToFileURL(join(consumerDir, 'consumer/core-state-location.mjs')).href);
    const packedCore = await loadCoreState();
    const stateRoot = mode === 'published' ? packedCore.resolveStateLocation().root : join(process.env.HOME, 'published-core-records');
    const project = join(output, `${mode}-project`);
    for (const path of [project, stateRoot, join(stateRoot, 'nested')]) await mkdir(path, { recursive: true, mode: 0o700 });
    const coreState = mode === 'published' ? undefined : unavailable ? { resolveStateLocation() { throw new Error('fixture unavailable'); } }
      : { resolveStateLocation: () => ({ root: stateRoot, projectMarkers: [] }), stateLocation: { root: { base: 'userHome', segments: ['published-core-records'] }, projectMarkers: [] } };
    process.env.AIH_CONSUMER_PROJECT = project;
    const workbench = await createWorkbench({ consumerDir, runDir, summary, settingsPath: join(output, 'settings.json'), coreState });
    const address = await listen(workbench.server, 0), origin = `http://127.0.0.1:${address.port}`;
    try {
      for (const theme of ['dark', 'light']) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
        // grill-me carries per-client recipes; the header's canonical tool is chosen up front, as the other
        // owning journeys do, or the Add guard correctly refuses and this check never reaches its subject.
        await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude'));
        const page = await context.newPage();
        console.log(`State location: ${mode}/${theme}: opening page`);
        page.setDefaultTimeout(30_000); page.on('pageerror', e => errors.push(e.message));
        await page.goto(origin, { waitUntil: 'domcontentloaded' });
        await page.locator('#browse-family option[value="Extensions"]').waitFor({ state: 'attached' });
        if (await page.locator('#setup-dialog').isVisible()) {
          await page.getByRole('radio', { name: /Vibe coder/ }).check();
          for (let step = 0; step < 4; step++) await page.locator('#setup-next').click();
          await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
        }
        const toggle = page.getByRole('button', { name: `Switch to ${theme} mode`, exact: true });
        if (await toggle.count()) await toggle.click();
        await chooseCatalogFamily(page, 'Extensions');
        await page.locator('#catalog-search').fill('grill-me');
        await addFromCatalog(page, 'extensions.matt.grill-me');
        await page.locator('#your-setup').click();
        if (!await page.locator('#project-folder-input').isVisible()) await page.locator('#project-folder-change').click();
        const choose = async path => {
          if (!await page.locator('#project-folder-input').isVisible()) await page.locator('#project-folder-change').click();
          await page.locator('#project-folder-input').fill(path); await page.locator('#project-folder-use').click();
          await page.locator('#project-folder-message').filter({ hasNotText: /^Checking the folder…$/ }).waitFor();
          return page.locator('#project-folder-message').innerText();
        };
        if (unavailable) {
          // The row opens its explanation without requiring the person to try a path first.
          assert.match(await page.locator('#project-folder-note').innerText(), /Core's state location is unavailable/);
          assert.match(await choose(project), /Core's state location is unavailable/);
        } else {
          console.log(`State location: ${mode}/${theme}: checking published root`);
          assert.match(await choose(stateRoot), /Core keeps its own records/);
          assert.match(await choose(join(stateRoot, 'nested')), /Core keeps its own records/);
          const chosen = join(process.env.HOME, '.aih', `ordinary-project-${mode}-${theme}`);
          await mkdir(chosen, { recursive: true });
          assert.match(await choose(chosen), /Now using/);
          console.log(`State location: ${mode}/${theme}: installing into chosen folder`);
          try { await page.locator('#install-button:not([disabled])').waitFor({ timeout: 30_000 }); }
          catch (error) {
            await page.screenshot({ path: join(output, `${mode}-${theme}-failure.png`), fullPage: true });
            await writeFile(join(output, `${mode}-${theme}-failure.txt`), await page.locator('#policy-review-panel').innerText());
            throw error;
          }
          await page.locator('#install-button').click();
          await page.locator('#install-message[data-outcome="installed"]').waitFor({ timeout: 120_000 });
          await page.locator('[data-installed-item="extensions.matt.grill-me"]').waitFor();
        }
        await page.screenshot({ path: join(output, `${mode}-${theme}.png`), fullPage: true });
        outcomes.push({ mode, theme });
        await writeFile(join(output, 'progress.json'), JSON.stringify({ outcomes, errors }, null, 2));
        console.log(`State location: ${mode}/${theme}: passed`); await context.close();
      }
    } finally { workbench.server.closeAllConnections?.(); await new Promise(done => workbench.server.close(done)); }
  }
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'passed', outcomes, errors }, null, 2));
} finally { await browser.close(); }
