import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { addFromCatalog, chooseCatalogFamily, openPolicyDrawer } from './policy-drawer.mjs';

export async function runUi168SetRemovalBrowser({ origin, output, playwrightModule, theme = 'dark' }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude'));
    const page = await context.newPage(); page.setDefaultTimeout(30_000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/');
    await page.locator('#browse-family option[value="Extensions"]').waitFor({ state: 'attached' });
    if (await page.locator('#setup-dialog').isVisible()) {
      await page.getByRole('radio', { name: /Vibe coder/ }).check();
      for (let step = 0; step < 4; step++) await page.locator('#setup-next').click();
    }
    const destination = theme === 'light' ? 'Switch to light mode' : 'Switch to dark mode';
    if (await page.getByRole('button', { name: destination, exact: true }).count()) await page.getByRole('button', { name: destination, exact: true }).click();
    await chooseCatalogFamily(page, 'Extensions');
    await page.locator('#starting-sets .more-sets > summary').click();
    const engineering = page.locator('#starting-sets [data-set-id="engineering"]');
    if ((await engineering.getAttribute('aria-pressed')) === 'true') await engineering.click();
    const toggle = page.locator('#starting-sets [data-set-id="productivity"]');
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
    await page.locator('[data-add-sets]').click();
    await page.waitForFunction(() => document.getElementById('framework-guidance').textContent.includes('Chosen sets added'));
    await page.locator('#browse-all-items').uncheck();
    await page.locator('#browse-all-items').check();
    await page.locator('#catalog-search').fill('');
    await page.locator('#cards-grid [data-card-id$="/extensions.matt.code-review"]').waitFor();
    assert.ok(await page.locator('#cards-grid').getByRole('button', { name: 'Add extensions.matt.code-review', exact: true }).count(), await page.locator('#cards-grid [data-card-id$="/extensions.matt.code-review"]').innerText());
    await addFromCatalog(page, 'extensions.matt.code-review');
    await openPolicyDrawer(page);
    await page.locator('#install-button:not([disabled])').waitFor({ timeout: 120_000 });
    await page.locator('#install-button').click();
    await page.locator('#install-message[data-outcome="installed"]').waitFor({ timeout: 120_000 });
    const set = page.locator('[data-installed-set^="productivity/"]');
    await set.waitFor();
    const calls = [];
    page.on('request', request => { if (/\/api\/authoring-(remove|apply)$/.test(request.url())) calls.push(request.url().split('authoring-')[1]); });
    await set.getByRole('button', { name: 'Remove set productivity', exact: true }).click();
    const preview = set.locator('div').filter({ has: set.getByRole('button', { name: 'Confirm remove', exact: true }) });
    await set.getByRole('button', { name: 'Confirm remove', exact: true }).waitFor();
    const review = await set.innerText();
    assert.match(review, /Kept:/i, review);
    assert.match(review, /keep-(shared|required)|still needed|another installed/i, review);
    await set.getByRole('button', { name: 'Confirm remove', exact: true }).click();
    await page.locator('#installed-message[data-outcome="removed"], #installed-message[data-outcome="nothing-removed"], #installed-message[data-outcome="failed"]').waitFor({ timeout: 120_000 });
    assert.ok(['removed', 'nothing-removed'].includes(await page.locator('#installed-message').getAttribute('data-outcome')), await page.locator('#installed-message').innerText());
    assert.deepEqual(calls, ['remove', 'apply']);
    assert.match(await page.locator('#installed-message').innerText(), /kept/i);
    await page.screenshot({ path: join(output, `set-removal-${theme}.png`), fullPage: true });
    await writeFile(join(output, `set-removal-${theme}.json`), JSON.stringify({ status: 'passed', review, message: await page.locator('#installed-message').innerText(), calls, errors }, null, 2));
    assert.deepEqual(errors, []);
    await context.close();
    return { status: 'passed' };
  } finally { await browser.close(); }
}
