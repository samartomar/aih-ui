import { chooseCatalogFamily } from './policy-drawer.mjs';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The simple default path, on the running page: Add works in one click with the items it needs and no separate
// Accept step; one Advanced section on the catalog and one in Your setup; one Settings menu holding the workspace
// menu, the mode, Check this machine and Get started; Check Policy under Your setup's Advanced; "Approval" in place of
// "Policy Determination"; and Review Changes merged into Your setup, the header's one entry to the drawer.
export async function runSimplePathBrowser({ origin, output, playwrightModule, theme = 'dark', item = 'extensions.matt.grill-me' }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude'));
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/');
    await page.locator('#browse-family option[value="Extensions"]').waitFor({ state: 'attached' });
    if (await page.locator('#setup-dialog').isVisible()) {
      await page.getByRole('radio', { name: /Vibe coder/ }).check();
      for (let step = 0; step < 3; step++) await page.locator('#setup-next').click();
      await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
    }
    const destination = `Switch to ${theme} mode`;
    if (await page.getByRole('button', { name: destination, exact: true }).count()) await page.getByRole('button', { name: destination, exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.mode), theme, `The page shows the ${theme} theme.`);

    // The header: Your setup is the one entry to the drawer, and Settings is one menu.
    const header = page.locator('body > header');
    assert.equal(await header.getByRole('button', { name: /^Review Changes$/ }).count(), 0, 'Review Changes is not a header button.');
    assert.equal(await header.getByRole('button', { name: /^Check Policy$/ }).count(), 0, 'Check Policy is not a header button.');
    assert.ok(await page.locator('#your-setup').isVisible(), 'Your setup is in the header.');
    const settings = page.locator('#org-modal-trigger');
    assert.match(await settings.innerText(), /Settings/);
    await settings.click();
    const menu = page.locator('#workspace-actions');
    await menu.waitFor();
    for (const label of ['Change mode…', 'Check this machine', 'Get started']) assert.ok(await menu.getByText(label, { exact: true }).isVisible(), `Settings holds ${label}.`);
    await page.keyboard.press('Escape');
    if (await menu.isVisible()) await settings.click();

    // One Advanced section on the catalog, closed for a new viewer, holding the engine surfaces.
    const catalogAdvanced = page.locator('#catalog-workspace details > summary').filter({ hasText: /^Advanced$/ });
    assert.equal(await catalogAdvanced.count(), 1, 'The catalog has one Advanced section.');
    assert.equal(await page.locator('#catalog-advanced').evaluate(node => node.open), false, 'Advanced starts closed.');
    assert.equal(await page.locator('#nav-policy').isVisible(), false, 'Policy workspace waits behind Advanced.');

    // Add in one click: the item and the items it needs are in the setup, with no Accept step and the drawer closed.
    await chooseCatalogFamily(page, 'Extensions');
    await page.locator('#catalog-search').fill(item.split('.').at(-1));
    await page.getByRole('button', { name: `Add ${item}`, exact: true }).click();
    const added = page.locator('#added-notice-message').filter({ hasText: /^Added / });
    await added.waitFor();
    const addedText = await added.innerText();
    const addedNeeds = addedText.match(/\+ (\d+) it needs \((.+)\)/);
    assert.ok(addedNeeds, `The confirmation names the items it needs: ${addedText}`);
    assert.equal(await page.locator('#policy-review-panel').isVisible(), false, 'No review opens for a clean Add.');
    assert.equal(await page.locator('#policy-accept').isVisible(), false, 'There is no separate Accept step.');
    const saved = JSON.parse(await page.locator('#policy-bytes').textContent());
    assert.deepEqual(saved.metadata['aih.workbench'].roots.map(root => root.itemId), [item]);
    assert.ok(saved.metadata['aih.workbench'].pins.length > 1, 'The items it needs came with it.');
    await page.locator('#added-notice-dismiss').click();
    assert.ok(await page.getByRole('button', { name: `Remove ${item}`, exact: true }).isVisible(), 'The card now offers Remove.');

    // Your setup: its choices with the needed items folded, and one Advanced section holding Check Policy.
    await page.locator('#your-setup').click();
    const drawer = page.locator('#policy-review-panel');
    await drawer.waitFor();
    assert.equal(await drawer.locator('#policy-review-panel-title').innerText(), 'Your setup');
    assert.equal(await drawer.locator('#policy-proposal-actions').isVisible(), false, 'Nothing is left waiting to be accepted.');
    const choice = drawer.locator(`#setup-choices-list [data-choice-item="${item}"]`);
    await choice.waitFor();
    // The same items the Add named, folded under the chosen item.
    assert.equal(await choice.locator('summary').innerText(), `+ ${addedNeeds[1]} it needs`);
    assert.deepEqual((await choice.locator('details li').allTextContents()).sort(), addedNeeds[2].split(', ').sort());
    const setupAdvanced = drawer.locator('#setup-advanced');
    assert.equal(await drawer.locator('details > summary').filter({ hasText: /^Advanced$/ }).count(), 1, 'Your setup has one Advanced section.');
    assert.equal(await setupAdvanced.evaluate(node => node.open), false);
    await setupAdvanced.locator(':scope > summary').click();
    assert.ok(await setupAdvanced.locator('#check-project-policy').isVisible(), 'Check Policy is under Advanced.');
    await setupAdvanced.locator(':scope > summary').click();
    await page.screenshot({ path: join(output, 'simple-path-setup.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'hidden' });

    // The inspector's Security tab reads Approval, not Policy Determination.
    await page.locator(`#cards-grid [data-card-id$="/${item}"]`).click();
    await page.locator('#tab-security').click();
    const security = page.locator('#pane-security');
    assert.ok(await security.getByText('Approval', { exact: true }).isVisible(), 'The Security tab says Approval.');
    assert.equal(await security.getByText('Policy Determination', { exact: true }).count(), 0);

    // Remove on the card takes it back out.
    await page.getByRole('button', { name: `Remove ${item}`, exact: true }).click();
    await page.locator('#added-notice-message').filter({ hasText: /^Removed / }).waitFor();
    await page.getByRole('button', { name: `Add ${item}`, exact: true }).waitFor();
    assert.deepEqual(JSON.parse(await page.locator('#policy-bytes').textContent()).metadata['aih.workbench'].roots, []);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

// Run against an already running Workbench:
//   node tools/consumer/simple-path-browser.mjs <origin> [output dir] [dark|light]
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [origin, output = 'simple-path-evidence', theme = 'dark'] = process.argv.slice(2);
  await runSimplePathBrowser({ origin, output, playwrightModule: process.env.PLAYWRIGHT_MODULE ?? 'playwright', theme });
  console.log(`The simple default path holds on the running page (${theme}).`);
}
