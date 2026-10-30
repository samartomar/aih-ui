import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { addFromCatalog, chooseCatalogFamily, closePolicyDrawer, drawer, openPolicyDrawer, openPolicyFileActions } from './policy-drawer.mjs';
import { openPolicyWorkspace, openSetupAdvanced } from './advanced-browser.mjs';

async function openPage(browser, origin, theme) {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude'));
  const page = await context.newPage(); page.setDefaultTimeout(30_000);
  await page.goto(origin + '/');
  await page.locator('#browse-family option[value="Extensions"]').waitFor({ state: 'attached' });
  if (await page.locator('#setup-dialog').isVisible()) {
    await page.getByRole('radio', { name: /Vibe coder/ }).check();
    for (let step = 0; step < 3; step++) await page.locator('#setup-next').click();
    await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
  }
  const destination = theme === 'light' ? 'Switch to light mode' : 'Switch to dark mode';
  if (await page.getByRole('button', { name: destination, exact: true }).count()) await page.getByRole('button', { name: destination, exact: true }).first().click();
  return { context, page };
}

export async function runUi168InterruptStartBrowser({ origin, output, project, playwrightModule, theme = 'dark' }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const { context, page } = await openPage(browser, origin, theme);
    await chooseCatalogFamily(page, 'Extensions');
    await addFromCatalog(page, 'extensions.matt.grill-me');
    await openPolicyDrawer(page);
    await openSetupAdvanced(page);
    const download = page.waitForEvent('download');
    await page.locator('#policy-save').click();
    const saved = join(output, 'interrupted-policy.json');
    await (await download).saveAs(saved);
    await page.locator('#install-button:not([disabled])').waitFor();
    const applying = page.waitForRequest(request => request.url().endsWith('/api/authoring-apply'));
    await page.locator('#install-button').click();
    await applying;
    // The host is killed as soon as this returns: only once Core's Apply has begun (the interrupting host's marker) is
    // there an interrupted run for Core to report; a request still in flight would leave nothing behind.
    const started = join(project, 'apply-started');
    for (let waited = 0; !existsSync(started); waited += 50) {
      if (waited > 60_000) throw new Error('Core never began the Apply the page requested');
      await new Promise(done => setTimeout(done, 50));
    }
    await context.close();
    return { status: 'passed', saved };
  } finally { await browser.close(); }
}

export async function runUi168InterruptedVerifyBrowser({ origin, output, saved, action, playwrightModule, theme = 'dark' }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const { context, page } = await openPage(browser, origin, theme);
    const applies = [];
    page.on('response', response => { if (/\/api\/authoring-apply(-status)?$/.test(response.url())) void response.json().then(value => { if (value.status !== 'running') applies.push(value); }).catch(() => {}); });
    page.on('pageerror', error => errors.push(error.message));
    await openPolicyWorkspace(page); await openPolicyFileActions(page);
    await page.locator('#policy-open').setInputFiles(saved);
    // Scoped to the drawer, as elsewhere: naming every button of the full catalog page can outlast the click's timeout.
    await drawer(page).getByRole('button', { name: 'Validate and reopen', exact: true }).click();
    await page.locator('#policy-status').filter({ hasText: 'Saved choices recovered' }).waitFor();
    await closePolicyDrawer(page); await openPolicyDrawer(page);
    const interrupted = page.locator('[data-installed-state="interrupted"]').first();
    await interrupted.waitFor();
    assert.match(await interrupted.innerText(), /Install didn't finish; \d+ files written$/);
    // Amendment 3.2.3 drops the chip tooltips: the chip's words are all it says.
    assert.equal(await interrupted.evaluate(chip => chip.hasAttribute('title') || chip.querySelector('[title]') !== null), false, 'the state chip carries no tooltip');
    const group = page.locator('[data-installed-item="extensions.matt.grill-me"]');
    await group.waitFor();
    if (action === 'finish') {
      await group.getByRole('button', { name: 'Finish', exact: true }).click();
      await page.locator('#install-button').filter({ hasText: 'Finish' }).waitFor();
      await page.locator('#install-button:not([disabled])').waitFor();
      await page.locator('#install-button').click();
      await page.locator('#install-message[data-outcome="installed"]').waitFor({ timeout: 120_000 });
      assert.match(await page.locator('#install-message').innerText(), /Confirmed on disk/);
    } else {
      await group.getByRole('button', { name: 'Remove', exact: true }).click();
      // A removal Core cannot confirm offers no Confirm; say what the page showed instead of only timing out.
      await group.getByRole('button', { name: 'Confirm remove', exact: true }).click().catch(async error => {
        throw new Error(`${error.message}\nThe page said: ${await page.locator('#installed-message').innerText().catch(() => '')}\n${await group.innerText().catch(() => '')}`); });
      await page.locator('#installed-message[data-outcome="removed"], #installed-message[data-outcome="failed"]').waitFor({ timeout: 120_000 });
      assert.equal(await page.locator('#installed-message').getAttribute('data-outcome'), 'removed', `${await page.locator('#installed-message').innerText()} ${JSON.stringify(applies)}`);
      assert.match(await page.locator('#installed-message').innerText(), /grill-me: removed/);
    }
    await page.screenshot({ path: join(output, `interrupted-${action}-${theme}.png`), fullPage: true });
    await writeFile(join(output, `interrupted-${action}-${theme}.json`), JSON.stringify({ status: 'passed', action, errors }, null, 2));
    assert.deepEqual(errors, []);
    await context.close();
    return { status: 'passed' };
  } finally { await browser.close(); }
}
