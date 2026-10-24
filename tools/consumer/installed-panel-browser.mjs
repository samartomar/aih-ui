import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { closePolicyDrawer, openPolicyDrawer, openPolicyFileActions } from './policy-drawer.mjs';

// Real packed packages and a disposable host project. Every mutation goes through the running page's
// ordinary reviewed Core path; no mocked inventory, preparation, Apply or browser client state.
export async function runInstalledPanelBrowser({ origin, output, playwrightModule }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true }), errors = [], outcomes = [];
  let page;
  async function open(context, theme) {
    const next = await context.newPage(); page = next; next.setDefaultTimeout(30_000);
    next.on('pageerror', error => errors.push(error.message));
    await next.goto(origin + '/');
    await next.locator('#browse-family option[value="Extensions"]').waitFor({ state: 'attached' });
    if (await next.locator('#setup-dialog').isVisible()) {
      await next.getByRole('radio', { name: /Vibe coder/ }).check();
      for (let step = 0; step < 4; step++) await next.locator('#setup-next').click();
      await next.locator('#setup-dialog').waitFor({ state: 'hidden' });
    }
    const destination = theme === 'light' ? 'Switch to light mode' : 'Switch to dark mode';
    if (await next.getByRole('button', { name: destination, exact: true }).count()) await next.getByRole('button', { name: destination, exact: true }).click();
    return next;
  }
  try {
    for (const theme of ['dark', 'light']) {
      const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
      page = await open(context, theme);
      await page.locator('#browse-family').selectOption('Extensions');
      await page.locator('#catalog-search').fill('grill-me');
      await page.getByRole('button', { name: 'Choose extensions.matt.grill-me', exact: true }).click();
      await page.locator('#policy-accept:not([disabled])').waitFor(); await page.locator('#policy-accept').click();
      await page.locator('#installed-note').filter({ hasText: 'Nothing from Workbench is installed' }).waitFor();
      await page.locator('#install-button:not([disabled])').waitFor();
      assert.ok(await page.locator('#install-files').getByText(/SKILL.md/).count());
      await page.locator('#install-button').click();
      await page.locator('#install-message[data-outcome="installed"]').waitFor({ timeout: 120_000 });
      const group = page.locator('[data-installed-item="extensions.matt.grill-me"]');
      await group.waitFor(); assert.match(await group.innerText(), /it needs:.*grilling/);
      await page.screenshot({ path: join(output, `${theme}-installed.png`), fullPage: true });
      const download = page.waitForEvent('download'); await page.locator('#policy-save').click();
      const saved = join(output, `${theme}-policy.json`); await (await download).saveAs(saved);
      await context.close();

      // A fresh browser has no recovered draft; reopen the downloaded policy and read Core's disk inventory.
      const reopened = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      page = await open(reopened, theme); await page.locator('#nav-policy').click();
      await openPolicyFileActions(page); await page.locator('#policy-open').setInputFiles(saved);
      await page.locator('#policy-review-panel').getByRole('button', { name: 'Validate and reopen', exact: true }).click();
      await page.locator('#policy-status').filter({ hasText: 'Saved choices recovered from exact source snapshots' }).waitFor();
      await closePolicyDrawer(page); await openPolicyDrawer(page);
      const installed = page.locator('[data-installed-item="extensions.matt.grill-me"]');
      await installed.waitFor();
      await page.locator('#install-message').filter({ hasText: 'Already installed:' }).waitFor();
      await installed.getByRole('button', { name: 'Remove', exact: true }).click();
      await installed.getByText(/grill-me:.*files/).waitFor();
      assert.match(await page.locator('#installed-message').innerText(), /Nothing has been removed yet/);
      await page.screenshot({ path: join(output, `${theme}-remove-preview.png`), fullPage: true });
      let rounds = 0;
      while (rounds < 5) {
        await installed.getByRole('button', { name: 'Confirm remove', exact: true }).click(); rounds++;
        await page.locator('#installed-message').filter({ hasNotText: /^Removing…$/ }).waitFor({ timeout: 120_000 });
        await page.waitForFunction(() => ['needs-confirm', 'removed', 'unverified', 'nothing-removed', 'failed'].includes(document.getElementById('installed-message').dataset.outcome));
        const outcome = await page.locator('#installed-message').getAttribute('data-outcome');
        if (outcome !== 'needs-confirm') break;
        assert.match(await installed.innerText(), /files? will be removed/);
        assert.ok(await installed.locator('ul li').count(), 'The next confirmation shows actual file rows.');
        await page.screenshot({ path: join(output, `${theme}-needed-files-${rounds}.png`), fullPage: true });
      }
      assert.ok(rounds > 1 && rounds < 5, 'Needed files receive their own confirmation.');
      const outcome = await page.locator('#installed-message').getAttribute('data-outcome');
      assert.ok(['removed', 'unverified'].includes(outcome), await page.locator('#installed-message').innerText());
      if (outcome === 'unverified') assert.match(await page.locator('#installed-message').innerText(), /did not verify/);
      await page.locator('#installed-note').filter({ hasText: 'Nothing from Workbench is installed' }).waitFor();
      assert.equal(await page.locator('#installed-list [data-installed-item]').count(), 0);
      await page.locator('#install-message').filter({ hasText: 'Nothing has been installed yet' }).waitFor();
      assert.equal(await page.locator('#install-message').getAttribute('data-outcome'), null, 'Removal clears the old install outcome.');
      await page.screenshot({ path: join(output, `${theme}-removed.png`), fullPage: true });
      outcomes.push({ theme, rounds, outcome, message: await page.locator('#installed-message').innerText() });
      await reopened.close();
    }
    assert.deepEqual(errors, []);
    await writeFile(join(output, 'installed-panel-evidence.json'), JSON.stringify({ status: 'passed', outcomes, errors }, null, 2));
    console.log(`Installed panel running-page journey passed: ${output}`);
  } catch (error) {
    await page?.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {});
    await writeFile(join(output, 'failure.json'), JSON.stringify({ error: error.message, errors, text: await page?.locator('body').innerText().catch(() => '') }, null, 2));
    throw error;
  } finally { await browser.close(); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await runInstalledPanelBrowser({ origin: process.argv[2], output: process.argv[3], playwrightModule: process.env.PLAYWRIGHT_MODULE ?? 'playwright' });
}
