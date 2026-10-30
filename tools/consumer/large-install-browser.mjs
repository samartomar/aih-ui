// A large install through the running page: ECC's pre-ticked sets with its TypeScript rules and Superpowers' set, then
// Review and Install, against a host whose Apply takes longer than one request may wait for its answer. Expectations are
// Core's own: the review the page was shown (prepared work) and what Core records afterwards (the managed inventory).
// Every count is exact and an empty expectation fails.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chooseCatalogFamily, openPolicyDrawer } from './policy-drawer.mjs';

async function openPage(browser, origin, errors) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude'));
  const page = await context.newPage(); page.setDefaultTimeout(120_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/');
  await page.locator('#browse-family option[value="ECC"]').waitFor({ state: 'attached' });
  if (await page.locator('#setup-dialog').isVisible()) {
    await page.getByRole('radio', { name: /Vibe coder/ }).check();
    for (let step = 0; step < 4; step++) await page.locator('#setup-next').click();
    await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
  }
  return { context, page };
}

// Adds a framework's pre-ticked sets, and any further sets named, through the set picker.
async function addSets(page, family, extra = []) {
  await chooseCatalogFamily(page, family);
  await page.locator('#starting-sets [data-set-id]').first().waitFor({ state: 'attached' });
  for (const id of extra) {
    const choice = page.locator(`#starting-sets [data-set-id="${id}"]`);
    await choice.evaluate(node => { const details = node.closest('details'); if (details) details.open = true; });
    if (await choice.getAttribute('aria-pressed') !== 'true') await choice.click();
    await page.waitForFunction(id => document.querySelector(`[data-set-id="${id}"]`)?.getAttribute('aria-pressed') === 'true', id);
  }
  await page.locator('[data-add-sets]').click();
  await page.waitForFunction(() => document.getElementById('framework-guidance').textContent.includes('Chosen sets added'), undefined, { timeout: 600_000 });
}

// The last ready preparation the page received: the review Install applies. Read on the way through, since a
// response event does not keep a body this large; a preparation takes Core tens of seconds, so no time limit.
async function recordPreparations(page) {
  const held = { review: undefined };
  await page.route(/\/api\/authoring-prepare$/, async route => {
    const response = await route.fetch({ timeout: 0 });
    const body = await response.json().catch(() => undefined);
    const preparation = body?.preparation ?? body;
    if (preparation?.status === 'ready' && preparation.sessionId && preparation.review) held.review = preparation.review;
    await route.fulfill({ response });
  });
  return held;
}

// Core's inventory of the project, read by the same host the page uses.
const coreInventory = page => page.evaluate(async () => (await fetch('/api/authoring-managed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json());
const plannedFiles = review => new Set(review.operations.filter(operation => operation.kind === 'file.write').map(operation => operation.details.target));
const recordedFiles = inventory => inventory.selections.flatMap(selection => selection.members.filter(member => member.kind === 'file').map(member => member.path));

export async function runLargeInstallBrowser({ origin, output, playwrightModule, log = console.log }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [], began = Date.now(), at = () => `${((Date.now() - began) / 1000).toFixed(1)}s`;
  try {
    const { page } = await openPage(browser, origin, errors);
    const held = await recordPreparations(page);
    await addSets(page, 'ECC', ['ecc.rules.typescript']); log(`[${at()}] ECC sets added`);
    await addSets(page, 'Superpowers'); log(`[${at()}] Superpowers set added`);
    await openPolicyDrawer(page);
    await page.locator('#install-button:not([disabled])').waitFor({ timeout: 900_000 });
    const review = held.review;
    assert.ok(review?.selections?.length > 200, `Core's review holds the large pick (${review?.selections?.length} selections)`);
    const planned = plannedFiles(review);
    log(`[${at()}] review: ${review.selections.length} selections, ${review.operations.length} operations, ${planned.size} distinct planned files`);
    await page.screenshot({ path: join(output, 'review.png') });
    await page.locator('#install-button').click();
    const clicked = Date.now();
    await page.locator('#install-message[data-outcome]').waitFor({ timeout: 1_800_000 });
    const outcome = await page.locator('#install-message').getAttribute('data-outcome');
    const message = (await page.locator('#install-message').innerText()).replace(/\s+/g, ' ');
    log(`[${at()}] page outcome after ${((Date.now() - clicked) / 1000).toFixed(1)}s: ${outcome}: ${message.slice(0, 300)}`);
    const inventory = await coreInventory(page);
    const recorded = new Set(inventory.selections.map(selection => selection.managementId)), files = recordedFiles(inventory);
    log(`[${at()}] Core inventory now: ${inventory.status}, ${inventory.selections.length} selections, ${files.length} file rows`);
    await page.screenshot({ path: join(output, 'outcome.png'), fullPage: true });
    await writeFile(join(output, 'large-install.json'), JSON.stringify({ outcome, message, review: { selections: review.selections.length, operations: review.operations.length, plannedFiles: planned.size }, inventory: { status: inventory.status, selections: inventory.selections.length, fileRows: files.length }, errors }, null, 2));

    assert.equal(outcome, 'installed', `the page reports Core's verified outcome: ${message}`);
    const missing = review.selections.filter(selection => !recorded.has(selection.managementId));
    assert.deepEqual(missing.map(selection => selection.managementId), [], `every one of the ${review.selections.length} reviewed selections has a Core record`);
    assert.equal(inventory.selections.length, review.selections.length, 'Core records exactly the reviewed selections');
    assert.equal(files.length, new Set(files).size, 'each recorded file row is one path');
    assert.deepEqual([...files].sort(), [...planned].sort(), `Core's file rows equal the ${planned.size} planned writes`);
    assert.deepEqual(errors, []);
    return { status: 'passed', selections: review.selections.length, files: planned.size };
  } finally { await browser.close(); }
}

// The connection to the Workbench is lost for the whole of a (small) Install: the page must not call it installed or
// failed, and the installed list it shows afterwards is Core's record.
export async function runLostContactBrowser({ origin, output, playwrightModule, log = console.log }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const { page } = await openPage(browser, origin, errors);
    await addSets(page, 'Superpowers');
    await openPolicyDrawer(page);
    await page.locator('#install-button:not([disabled])').waitFor({ timeout: 300_000 });
    // Every request that would carry Core's answer back fails, as a dropped connection does.
    await page.route(/\/api\/authoring-apply(-status)?$/, route => /-status$/.test(route.request().url()) ? route.abort('connectionreset') : route.continue());
    await page.locator('#install-button').click();
    await page.locator('#install-message[data-outcome]').waitFor({ timeout: 600_000 });
    const outcome = await page.locator('#install-message').getAttribute('data-outcome');
    const message = (await page.locator('#install-message').innerText()).replace(/\s+/g, ' ');
    log(`lost contact: page outcome ${outcome}: ${message}`);
    await page.unroute(/\/api\/authoring-apply(-status)?$/);
    assert.equal(outcome, 'unknown', 'a lost answer is neither installed nor failed');
    assert.match(message, /Install outcome unknown/);
    assert.match(message, /installed list shows what Core recorded/);
    // What the list shows comes from Core: once Core has finished, the list has a row for each selection it records.
    let inventory;
    for (let attempt = 0; attempt < 120; attempt++) {
      inventory = await coreInventory(page);
      if (inventory.selections?.length && await page.locator('[data-installed-row]').count() === inventory.selections.length) break;
      await page.waitForTimeout(1000);
      if (attempt % 10 === 9) { await page.reload(); await openPolicyDrawer(page); }
    }
    assert.ok(inventory.selections.length > 0, 'Core recorded the Install the page lost contact with');
    assert.equal(await page.locator('[data-installed-row]').count(), inventory.selections.length, `the installed list shows Core's ${inventory.selections.length} records`);
    await page.screenshot({ path: join(output, 'lost-contact.png'), fullPage: true });
    assert.deepEqual(errors, []);
    return { status: 'passed', selections: inventory.selections.length };
  } finally { await browser.close(); }
}
