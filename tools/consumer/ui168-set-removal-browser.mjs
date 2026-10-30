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
    // The page's own Catalog and latest Core inventory, for the exact expected outcome lines.
    const answers = {};
    page.on('response', async response => {
      const operation = response.url().match(/\/api\/authoring-(catalog|managed)$/)?.[1]; if (!operation) return;
      const body = await response.json().catch(() => undefined);
      if (operation === 'catalog' && body?.items) answers.catalog = body; else if (operation === 'managed' && body?.selections) answers.inventory = body;
    });
    await page.goto(origin + '/');
    await page.locator('#browse-family option[value="Extensions"]').waitFor({ state: 'attached' });
    if (await page.locator('#setup-dialog').isVisible()) {
      await page.getByRole('radio', { name: /Vibe coder/ }).check();
      for (let step = 0; step < 3; step++) await page.locator('#setup-next').click();
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
    // Engineering's members leave, then what Core records as required only by selections that leave; a member
    // with another owner would be kept, named for that owner's set.
    for (let attempt = 0; attempt < 300 && !(answers.catalog && answers.inventory?.selections?.length); attempt++) await page.waitForTimeout(100);
    const catalog = answers.catalog, before = answers.inventory.selections;
    const engineering = catalog.frameworks.flatMap(framework => framework.id === 'extensions' ? framework.sets ?? [] : []).find(candidate => candidate.id === 'engineering');
    const ids = engineering.members.filter(member => member.defaultOn).map(member => member.item.itemId);
    const inSet = selection => selection.origins.some(origin => origin.reasonIncluded === 'in-set' && origin.set?.setId === 'engineering');
    const requirer = (selection, origin) => before.find(candidate => candidate.scope === selection.scope && candidate.item.itemId === origin.requiredBy?.itemId);
    const leaving = new Set();
    for (let grew = true; grew;) {
      grew = false;
      for (const selection of before) {
        if (leaving.has(selection.managementId) || !selection.origins.length) continue;
        if (selection.origins.every(origin => (origin.reasonIncluded === 'in-set' && origin.set?.setId === 'engineering') || (origin.reasonIncluded === 'required-by' && leaving.has(requirer(selection, origin)?.managementId)))) { leaving.add(selection.managementId); grew = true; }
      }
    }
    const nameOf = selection => catalog.items.find(item => item.id === selection.item.itemId)?.name;
    const expectedRemoved = before.filter(selection => leaving.has(selection.managementId)).map(selection => `${nameOf(selection)}: removed`).sort();
    const expectedKept = before.filter(selection => inSet(selection) && !leaving.has(selection.managementId)).map(nameOf).sort();
    assert.deepEqual(before.filter(inSet).map(selection => selection.item.itemId).sort(), [...ids].sort(), 'Core lists exactly the default-on Engineering members');
    assert.ok(expectedRemoved.length >= ids.length, 'every Engineering member leaves: Engineering and Productivity share no member');
    assert.deepEqual(expectedKept, [], 'no Engineering member has another owner');
    await set.getByRole('button', { name: 'Remove this set: Engineering', exact: true }).click();
    const preview = set.locator('div').filter({ has: set.getByRole('button', { name: 'Confirm remove', exact: true }) });
    await set.getByRole('button', { name: 'Confirm remove', exact: true }).waitFor();
    const review = await set.innerText();
    const reviewLines = review.split('\n').map(line => line.trim());
    assert.equal(reviewLines.filter(line => /^[^:]+: \d+ members are reviewed for removal\.$/.test(line)).length, expectedRemoved.length, review);
    assert.deepEqual(reviewLines.filter(line => /^[^:]+: Kept; /.test(line)), [], review);
    await set.getByRole('button', { name: 'Confirm remove', exact: true }).click();
    await page.locator('#installed-message[data-outcome="removed"], #installed-message[data-outcome="nothing-removed"], #installed-message[data-outcome="failed"]').waitFor({ timeout: 120_000 });
    assert.ok(['removed', 'nothing-removed'].includes(await page.locator('#installed-message').getAttribute('data-outcome')), await page.locator('#installed-message').innerText());
    assert.deepEqual(calls, ['remove', 'apply']);
    const result = await page.locator('#installed-message').innerText();
    const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const line of expectedRemoved) assert.equal((result.match(new RegExp(escape(line), 'g')) ?? []).length, 1, `"${line}" reported once\n${result}`);
    assert.equal((result.match(/: removed/g) ?? []).length, expectedRemoved.length, result);
    assert.doesNotMatch(result, /unverified|Couldn't confirm|: absent|Kept; /i, result);
    await page.locator('#install-timings > summary').click();
    await assertLifecycleContrast(page);
    await page.screenshot({ path: join(output, `set-removal-${theme}.png`), fullPage: true });
    await writeFile(join(output, `set-removal-${theme}.json`), JSON.stringify({ status: 'passed', removed: expectedRemoved, review, message: result, calls, errors }, null, 2));
    assert.deepEqual(errors, []);
    await context.close();
    return { status: 'passed' };
  } finally { await browser.close(); }
}
