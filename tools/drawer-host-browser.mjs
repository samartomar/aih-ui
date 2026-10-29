import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createWorkbench } from './server/workbench.mjs';
import { listen } from './server/static.mjs';
import { coreTargetsSummary } from './server/core-targets-summary.mjs';
import { callService } from './server/service-client.mjs';
import { addFromCatalog, closePolicyDrawer, openPolicyDrawer } from './consumer/policy-drawer.mjs';

const consumerDir = resolve(process.env.AIH_CONSUMER_DIR);
const runDir = join(consumerDir, 'page');
const summary = { packages: [], coreTargets: coreTargetsSummary(callService(consumerDir, { op: 'coreTargets' })) };
await writeFile(join(runDir, 'summary.json'), JSON.stringify(summary));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const browser = await chromium.launch({ headless: true });
const only = process.env.DRAWER_CASE;
const errors = [];
let passed = 0;
const warning = {
  status: 'complete',
  items: [{ itemId: 'ecc.skill.accessibility', copies: { user: { state: 'none' }, parentFolders: { state: 'none' }, plugins: { state: 'none' } } }],
  warnings: [{ code: 'same-key-elsewhere', item: { framework: 'ecc', itemId: 'ecc.skill.accessibility' }, key: 'accessibility', where: 'parent-folder', path: '/old-folder/.claude/skills/accessibility/SKILL.md' }],
};

async function scenario(toolHost) {
  const output = await mkdtemp(join(tmpdir(), 'aih-drawer-host-'));
  const folderA = join(output, 'a'), folderB = join(output, 'b');
  await mkdir(folderA, { recursive: true }); await mkdir(folderB, { recursive: true });
  process.env.AIH_CONSUMER_PROJECT = folderA;
  const started = await createWorkbench({ consumerDir, runDir, summary, settingsPath: join(output, 'settings.json') });
  const address = await listen(started.server, 0);
  started.origin = `http://127.0.0.1:${address.port}`;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude'));
  const page = await context.newPage(); page.setDefaultTimeout(7_000);
  page.on('pageerror', error => errors.push(error.message));
  if (toolHost) await page.route('**/api/authoring-tool-host', toolHost(page));
  await page.goto(started.origin + '/');
  await page.locator('#browse-family option[value="ECC"]').waitFor({ state: 'attached' });
  if (await page.locator('#setup-dialog').isVisible()) {
    await page.getByRole('radio', { name: /Vibe coder/ }).check();
    for (let index = 0; index < 4; index++) await page.locator('#setup-next').click();
    await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
  }
  await addFromCatalog(page, 'ecc.skill.accessibility');
  await openPolicyDrawer(page);
  return { page, context, started, folderB };
}

async function done({ context, started }) {
  await context.close(); await new Promise(resolve => started.server.close(resolve));
}

async function liveTool() {
  const bodies = [];
  const value = await scenario(() => async route => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ json: { status: 'unavailable', reason: 'Fixture inspected only the requested tool.' } });
  });
  const { page } = value;
  await page.evaluate(() => localStorage.setItem('wb-your-tool', 'codex'));
  const before = bodies.length;
  await closePolicyDrawer(page); await openPolicyDrawer(page);
  await page.waitForFunction(() => document.getElementById('setup-choices-host-copies').textContent.includes('Fixture inspected'));
  assert.ok(bodies.length > before, 'reopening reads host facts');
  assert.equal(bodies.at(-1).tool, 'claude', 'the live header tool wins over stale persisted storage');
  await done(value);
}

async function failedInspection() {
  const value = await scenario(() => async route => {
    await route.fulfill({ status: 500, json: { error: 'inspection rejected' } });
  });
  const { page } = value;
  const line = page.locator('#setup-choices-host-copies');
  await line.filter({ hasText: /Couldn't check[\s\S]*inspection rejected/ }).waitFor();
  assert.doesNotMatch(await line.textContent(), /^Checking/);
  await done(value);
}

async function unavailableCopies() {
  const value = await scenario(() => async route => {
    const body = route.request().postDataJSON();
    await route.fulfill({ json: {
      status: 'incomplete',
      items: body.items.map(item => ({ itemId: item.itemId, copies: {
        user: { state: 'unavailable', reason: 'Permission denied.' },
        parentFolders: { state: 'none' }, plugins: { state: 'none' },
      } })),
      warnings: [],
    } });
  });
  const { page } = value;
  const line = page.locator('#setup-choices-host-copies');
  await line.filter({ hasText: /Couldn't check[\s\S]*Permission denied/ }).waitFor();
  assert.doesNotMatch(await line.textContent(), /reported no second copies/);
  await done(value);
}

async function folderInvalidation() {
  let armed = false, held = false, releaseOld, catalogObserved, releaseCatalog;
  const oldGate = new Promise(resolve => { releaseOld = resolve; });
  const catalogGate = new Promise(resolve => { releaseCatalog = resolve; });
  const catalogSeen = new Promise(resolve => { catalogObserved = resolve; });
  const value = await scenario(page => async route => {
    const body = route.request().postDataJSON();
    if (!body.items.length) return route.fulfill({ json: { status: 'complete', items: [], warnings: [] } });
    if (armed && !held) {
      held = true; await oldGate;
      return route.fulfill({ json: warning });
    }
    if (held) return route.fulfill({ json: { status: 'unavailable', reason: 'NEW_FOLDER_REPLY' } });
    return route.fulfill({ json: warning });
  });
  const { page, folderB } = value;
  const line = page.locator('#setup-choices-host-copies');
  await line.filter({ hasText: /Second copy/ }).waitFor();
  await closePolicyDrawer(page);
  armed = true;
  const oldRequest = page.waitForRequest(request => request.url().includes('/api/authoring-tool-host') && request.postDataJSON()?.items?.length > 0);
  await openPolicyDrawer(page); await oldRequest;
  const input = page.locator('#project-folder-input');
  if (await input.isHidden()) await page.locator('#project-folder-change').click();
  await page.route('**/api/authoring-catalog', async route => {
    catalogObserved(); await catalogGate; await route.continue();
  });
  const catalogRequest = page.waitForRequest(request => request.url().includes('/api/authoring-catalog'));
  await input.fill(folderB);
  await page.locator('#project-folder-use').click();
  await catalogRequest; await catalogSeen;
  assert.match(await line.textContent(), /^Checking/, 'folder invalidation synchronously clears old duplicate facts');
  await line.filter({ hasText: /NEW_FOLDER_REPLY/ }).waitFor();
  releaseOld(); await page.waitForTimeout(75);
  assert.match(await line.textContent(), /NEW_FOLDER_REPLY/);
  assert.doesNotMatch(await line.textContent(), /Second copy/);
  const catalogResponse = page.waitForResponse(response => response.url().includes('/api/authoring-catalog'));
  releaseCatalog(); await catalogResponse;
  await page.locator('#project-folder-message').filter({ hasNotText: /^Checking the folder…$/ }).waitFor();
  await done(value);
}

try {
  if (!only || only === 'tool') { await liveTool(); passed++; console.log('✔ drawer inspection uses the live tool'); }
  if (!only || only === 'failed') { await failedInspection(); passed++; console.log('✔ failed drawer inspection reaches a terminal failed state'); }
  if (!only || only === 'unavailable') { await unavailableCopies(); passed++; console.log('✔ unavailable per-item copy facts never look clean'); }
  if (!only || only === 'folder') { await folderInvalidation(); passed++; console.log('✔ folder invalidation rejects the old drawer reply synchronously'); }
  assert.deepEqual(errors, []);
  console.log(`drawer-host browser: pass ${passed} fail 0`);
} finally {
  await browser.close();
}
