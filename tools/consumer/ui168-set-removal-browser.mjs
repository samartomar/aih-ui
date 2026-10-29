import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { addFromCatalog, chooseCatalogFamily, openPolicyDrawer } from './policy-drawer.mjs';

async function assertLifecycleContrast(page) {
  const ratios = await page.evaluate(() => {
    const channels = value => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = rgb => rgb.map(value => value / 255).map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const background = node => {
      for (let current = node; current; current = current.parentElement) {
        const value = getComputedStyle(current).backgroundColor;
        if (value !== 'transparent' && value !== 'rgba(0, 0, 0, 0)') return value;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    return [...document.querySelectorAll('[data-installed-set], #install-project-facts li, #install-timing-rows li, [data-update-preview]')]
      .filter(node => node.checkVisibility()).map(node => {
        const [high, low] = [luminance(channels(getComputedStyle(node).color)), luminance(channels(background(node)))].sort((a, b) => b - a);
        return (high + 0.05) / (low + 0.05);
      });
  });
  assert.ok(ratios.length > 0, 'lifecycle text is present for contrast checks');
  assert.ok(ratios.every(ratio => ratio >= 4.5), `lifecycle contrast below 4.5: ${Math.min(...ratios)}`);
}

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
      await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
    }
    const destination = theme === 'light' ? 'Switch to light mode' : 'Switch to dark mode';
    if (await page.getByRole('button', { name: destination, exact: true }).count()) await page.getByRole('button', { name: destination, exact: true }).first().click();
    await chooseCatalogFamily(page, 'Extensions');
    await page.locator('[data-add-sets]').click();
    await page.waitForFunction(() => document.getElementById('framework-guidance').textContent.includes('Chosen sets added'));
    await openPolicyDrawer(page);
    await page.locator('#install-button:not([disabled])').waitFor({ timeout: 120_000 });
    await page.locator('#install-button').click();
    await page.locator('#install-message[data-outcome="installed"]').waitFor({ timeout: 120_000 });
    const set = page.locator('[data-installed-set^="engineering/"]');
    await set.waitFor();
    const calls = [];
    page.on('request', request => { if (/\/api\/authoring-(remove|apply)$/.test(request.url())) calls.push(request.url().split('authoring-')[1]); });
    await set.getByRole('button', { name: 'Remove set engineering', exact: true }).click();
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
    await page.locator('#install-timings > summary').click();
    await assertLifecycleContrast(page);
    await page.screenshot({ path: join(output, `set-removal-${theme}.png`), fullPage: true });
    await writeFile(join(output, `set-removal-${theme}.json`), JSON.stringify({ status: 'passed', review, message: await page.locator('#installed-message').innerText(), calls, errors }, null, 2));
    assert.deepEqual(errors, []);
    await context.close();
    return { status: 'passed' };
  } finally { await browser.close(); }
}
