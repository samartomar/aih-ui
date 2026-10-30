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

const HELD_NOTE = 'Install is still running in this project folder. What is installed shows here once it has finished.';
const RUNNING_MESSAGE = 'Install is still running in this project folder.';
const applyRunning = page => page.evaluate(async () => (await (await fetch('/api/authoring-apply-state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()).running);
// The list is Core's record, read once nothing is applying: rows appear, and every row is a selection Core records.
async function listFromCore(page, inventory, log) {
  await page.waitForFunction(() => document.querySelectorAll('[data-installed-row]').length > 0, undefined, { timeout: 120_000 });
  const rows = await page.locator('[data-installed-row]').evaluateAll(nodes => nodes.map(node => node.dataset.installedRow));
  const recorded = new Set(inventory.selections.map(selection => selection.managementId));
  log(`list: ${rows.length} rows for Core's ${inventory.selections.length} selections`);
  assert.deepEqual(rows.filter(id => !recorded.has(id)), [], 'every row is a selection Core records');
}
const text = async locator => (await locator.innerText()).replace(/\s+/g, ' ').trim();

// Every answer to an Install is lost while the host's Apply is still going (it starts Core only after applyDelayMs).
// The page must say the outcome is unknown, hold the installed list and Install while anything is applying in the
// folder, read Core's record only afterwards, and show Core's own outcome once the answer can be reached again.
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
    const lostAnswers = /\/api\/authoring-apply-status$/;
    await page.route(lostAnswers, route => route.abort('connectionreset'));
    const reads = [];
    page.on('request', request => { if (/\/api\/authoring-managed$/.test(request.url())) reads.push(Date.now()); });
    const clicked = Date.now();
    await page.locator('#install-button').click();
    await page.locator('#install-message[data-outcome]').waitFor({ timeout: 600_000 });
    const outcome = await page.locator('#install-message').getAttribute('data-outcome');
    const message = await text(page.locator('#install-message'));
    log(`lost contact: page outcome ${outcome}: ${message}`);
    assert.equal(outcome, 'unknown', 'a lost answer is neither installed nor failed');
    // The host is still applying (Core starts only after applyDelayMs): for the next seconds nothing may be read or offered.
    await page.waitForTimeout(5000);
    log(`lost contact: from Install to 5 s after giving up: ${reads.filter(time => time >= clicked).length} reads of Core's record, Install ${await page.locator('#install-button').isDisabled() ? 'held' : 'offered'}, ${await page.locator('[data-installed-row]').count()} rows, note "${await text(page.locator('#installed-note'))}"`);
    assert.equal(reads.filter(time => time >= clicked).length, 0, "Core's record is not read while Core may be writing");
    assert.equal(await page.locator('#install-button').isDisabled(), true, 'Install stays held');
    assert.equal(await text(page.locator('#installed-note')), HELD_NOTE, 'the list says it is waiting, nothing about what is installed');
    assert.equal(message, 'Install outcome unknown: This page lost contact with the Workbench while it was running.');
    assert.equal(await applyRunning(page), true, 'the host is still applying when the page gives up asking (applyDelayMs too short otherwise)');
    // While anything is applying in the folder: no list, no Core read, no Install.
    await page.locator('#installed-note').filter({ hasText: HELD_NOTE }).waitFor({ timeout: 15_000 });
    let checks = 0;
    while (await applyRunning(page)) {
      assert.equal(await page.locator('[data-installed-row]').count(), 0, 'no installed row while Core may be writing');
      assert.equal(await text(page.locator('#installed-note')), HELD_NOTE);
      assert.equal(await page.locator('#install-button').isDisabled(), true, 'Install stays held');
      assert.equal(reads.filter(time => time >= clicked).length, 0, "Core's record is not read while Core may be writing");
      checks++; await page.waitForTimeout(1000);
    }
    log(`lost contact: held for ${checks} checks while the host applied`);
    assert.ok(checks >= 3, `the hold was observed (${checks} checks)`);
    // Contact is back: the page reads Core's run and Core's record.
    await page.unroute(lostAnswers);
    await page.locator('#install-message[data-outcome="installed"]').waitFor({ timeout: 120_000 })
      .catch(async error => { log(`lost contact: after contact came back the page says "${await text(page.locator('#install-message'))}" (${await page.locator('#install-message').getAttribute('data-outcome')})`); throw error; });
    const inventory = await coreInventory(page);
    await listFromCore(page, inventory, log);
    assert.ok(inventory.selections.length > 0, 'Core recorded the Install');
    log(`lost contact: then ${await text(page.locator('#install-message'))} · ${inventory.selections.length} rows`);
    await page.screenshot({ path: join(output, 'lost-contact.png'), fullPage: true });
    assert.deepEqual(errors, []);
    return { status: 'passed', selections: inventory.selections.length, heldChecks: checks };
  } finally { await browser.close(); }
}

// The page is reloaded while a (held-back) Install is running: the reloaded page says Install is still running, holds
// the list and Install, then shows Core's outcome and Core's record.
export async function runReloadBrowser({ origin, output, playwrightModule, log = console.log }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const { page } = await openPage(browser, origin, errors);
    await addSets(page, 'Superpowers');
    await openPolicyDrawer(page);
    await page.locator('#install-button:not([disabled])').waitFor({ timeout: 300_000 });
    const started = page.waitForResponse(response => /\/api\/authoring-apply$/.test(response.url()));
    if (process.env.AIH_DEBUG_APPLY) page.on('response', async response => { if (/apply-(state|status)$/.test(response.url())) log(`debug ${response.url().split('/').at(-1)} ${response.status()} ${await response.text().catch(() => '?')}`.slice(0, 200)); });
    await page.locator('#install-button').click();
    await started;
    await page.reload();
    await page.locator('#browse-family option[value="ECC"]').waitFor({ state: 'attached' });
    await openPolicyDrawer(page);
    await page.locator('#install-message').filter({ hasText: RUNNING_MESSAGE }).waitFor({ timeout: 30_000 })
      .catch(async error => { log(`reload: the reloaded page says "${await text(page.locator('#install-message'))}", Install ${await page.locator('#install-button').isDisabled() ? 'held' : 'offered'}`); throw error; });
    assert.equal(await applyRunning(page), true, 'the host is still applying after the reload');
    await page.locator('#installed-note').filter({ hasText: HELD_NOTE }).waitFor({ timeout: 30_000 });
    assert.equal(await page.locator('#install-button').isDisabled(), true, 'Install stays held after the reload');
    assert.equal(await page.locator('[data-installed-row]').count(), 0, 'no installed row while Core may be writing');
    log(`reload: ${await text(page.locator('#install-message'))}`);
    if (process.env.AIH_DEBUG_APPLY) {
      page.on('console', entry => log(`console ${entry.type()} ${entry.text().slice(0, 200)}`));
      page.on('pageerror', error => log(`pageerror ${error.message}`));
      log(`stored job ${await page.evaluate(() => sessionStorage.getItem('aih-apply-job'))}`);
      await page.evaluate(() => { const node = document.getElementById('install-message'); new MutationObserver(() => console.log(`install-message [${node.dataset.outcome ?? ''}] ${node.textContent}`)).observe(node, { childList: true, characterData: true, subtree: true, attributes: true }); });
    }
    await page.locator('#install-message[data-outcome]').waitFor({ timeout: 600_000 });
    const outcome = await page.locator('#install-message').getAttribute('data-outcome'), message = await text(page.locator('#install-message'));
    log(`reload: then ${outcome}: ${message.slice(0, 200)}`);
    assert.equal(outcome, 'installed', message);
    assert.match(message, /^Confirmed on disk: all \d+ files written/);
    const inventory = await coreInventory(page);
    await listFromCore(page, inventory, log);
    await page.screenshot({ path: join(output, 'reload.png'), fullPage: true });
    assert.deepEqual(errors, []);
    return { status: 'passed', selections: inventory.selections.length };
  } finally { await browser.close(); }
}
