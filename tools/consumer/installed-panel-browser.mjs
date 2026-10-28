import { chooseCatalogFamily } from './policy-drawer.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { addFromCatalog, closePolicyDrawer, openPolicyDrawer, openPolicyFileActions } from './policy-drawer.mjs';
import { openPolicyWorkspace, openSetupAdvanced } from './advanced-browser.mjs';

// Real packed packages and a disposable host project. Every mutation goes through the running page's
// ordinary reviewed Core path; no mocked inventory, preparation, Apply or browser client state.
export async function runInstalledPanelBrowser({ origin, output, playwrightModule, cancellationThemes = [] }) {
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
      const cancelAfterFirst = cancellationThemes.includes(theme);
      const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
      page = await open(context, theme);
      await chooseCatalogFamily(page, 'Extensions');
      await page.locator('#catalog-search').fill('grill-me');
      // One-click Add puts it in the setup with the items it needs; Install and the installed list are in Your setup.
      await addFromCatalog(page, 'extensions.matt.grill-me'); await openPolicyDrawer(page);
      await page.locator('#installed-note').filter({ hasText: 'Nothing from Workbench is installed' }).waitFor();
      await page.locator('#install-button:not([disabled])').waitFor();
      assert.ok(await page.locator('#install-files').getByText(/SKILL.md/).count());
      await page.locator('#install-button').click();
      await page.locator('#install-message[data-outcome="installed"]').waitFor({ timeout: 120_000 });
      const group = page.locator('[data-installed-item="extensions.matt.grill-me"]');
      await group.waitFor(); assert.match(await group.innerText(), /it needs:.*grilling/);
      // UI166: only the strict complete run claims confirmed on disk, and the review is named rows with folders.
      assert.match(await page.locator('#install-message').innerText(), /Confirmed on disk/);
      await page.locator('#install-review-rows [data-review-selection]').first().waitFor();
      const folders = await page.locator('#install-folders').innerText();
      assert.match(folders, /Project folder: .+\./, 'the actual project folder is stated');
      assert.match(folders, /Guidance folder: (this setup writes no user-folder content\..+|.+\.)/, 'the guidance folder is stated, including the explicit none case');
      const rowsText = await page.locator('#install-review-rows').innerText();
      assert.match(rowsText, /(When used: \d+ bytes · \d+ chars|Size unknown: Core reported no delivered size for this item\.)/, 'the size line is Core\'s exact wording, never a vague allowance');
      assert.match(rowsText, /Chosen by you/, 'a directly chosen item says its recorded origin');
      // UI166-AC04: a directly added item has no set-owned first step, so the guidance line stays empty.
      assert.equal(await page.locator('#install-first-run').textContent(), '');
      await page.screenshot({ path: join(output, `${theme}-installed.png`), fullPage: true });
      const download = page.waitForEvent('download'); await openSetupAdvanced(page); await page.locator('#policy-save').click();
      const saved = join(output, `${theme}-policy.json`); await (await download).saveAs(saved);
      // The normal journey proves a fresh reopen. Cancellation keeps the original Install outcome,
      // so it also catches an old data-outcome=installed surviving a partially applied Remove.
      const reopened = cancelAfterFirst ? context : await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      if (!cancelAfterFirst) {
        await context.close();
        page = await open(reopened, theme); await openPolicyWorkspace(page);
        await openPolicyFileActions(page); await page.locator('#policy-open').setInputFiles(saved);
        await page.locator('#policy-review-panel').getByRole('button', { name: 'Validate and reopen', exact: true }).click();
        await page.locator('#policy-status').filter({ hasText: 'Saved choices recovered from exact source snapshots' }).waitFor();
        await closePolicyDrawer(page); await openPolicyDrawer(page);
      }
      const installed = page.locator('[data-installed-item="extensions.matt.grill-me"]');
      await installed.waitFor();
      assert.match(await installed.innerText(), /it needs:.*grilling/, 'recorded names and the needed-by grouping survive a fresh page reopen against the on-disk receipts');
      if (cancelAfterFirst) assert.equal(await page.locator('#install-message').getAttribute('data-outcome'), 'installed');
      else await page.locator('#install-message').filter({ hasText: 'Already installed:' }).waitFor();
      await installed.getByRole('button', { name: 'Remove', exact: true }).click();
      await installed.getByText(/grill-me:.*files/).waitFor();
      assert.match(await page.locator('#installed-message').innerText(), /Nothing has been removed yet/);
      const beforeCancel = await page.locator('#install-message').innerText();
      await installed.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.ok(await installed.isVisible(), 'Cancel before confirmation keeps the installed item.');
      assert.equal(await page.locator('#install-message').innerText(), beforeCancel, 'Cancel before confirmation leaves Install unchanged.');
      await installed.getByRole('button', { name: 'Remove', exact: true }).click();
      await installed.getByRole('button', { name: 'Confirm remove', exact: true }).waitFor();
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
        if (cancelAfterFirst) {
          await installed.getByRole('button', { name: 'Cancel', exact: true }).click();
          await installed.waitFor({ state: 'hidden' });
          const stopped = await page.locator('#installed-message').innerText();
          assert.match(stopped, /Removal stopped.*did not verify.*Not removed:.*grilling/s);
          assert.doesNotMatch(stopped, /confirm again/i);
          assert.equal(await page.locator('#installed-message').getAttribute('data-outcome'), 'unverified');
          await page.locator('#install-message').filter({ hasText: 'Not fully installed:' }).waitFor();
          assert.equal(await page.locator('#install-message').getAttribute('data-outcome'), null);
          assert.equal(await page.locator('[data-installed-other]').count(), 2, 'Only the two dependencies remain in inventory.');
          await page.screenshot({ path: join(output, `${theme}-cancelled-after-progress.png`), fullPage: true });
          // Clean up the remaining dependencies through their own real reviewed controls.
          for (let remaining = 2; remaining > 0; remaining--) {
            const other = page.locator('[data-installed-other]').first();
            await other.getByRole('button', { name: 'Remove', exact: true }).click();
            await other.getByRole('button', { name: 'Confirm remove', exact: true }).click();
            await page.locator('#installed-message').filter({ hasNotText: /^Removing…$/ }).waitFor({ timeout: 120_000 });
            await page.waitForFunction(count => document.querySelectorAll('[data-installed-other]').length === count, remaining - 1);
          }
          break;
        }
      }
      assert.ok(cancelAfterFirst ? rounds === 1 : rounds > 1 && rounds < 5, 'The requested confirmation rounds completed.');
      const outcome = await page.locator('#installed-message').getAttribute('data-outcome');
      assert.ok(['removed', 'unverified'].includes(outcome), await page.locator('#installed-message').innerText());
      if (outcome === 'unverified') assert.match(await page.locator('#installed-message').innerText(), /did not verify/);
      await page.locator('#installed-note').filter({ hasText: 'Nothing from Workbench is installed' }).waitFor();
      assert.equal(await page.locator('#installed-list [data-installed-item]').count(), 0);
      await page.locator('#install-message').filter({ hasText: 'Nothing has been installed yet' }).waitFor();
      assert.equal(await page.locator('#install-message').getAttribute('data-outcome'), null, 'Removal clears the old install outcome.');
      await page.screenshot({ path: join(output, `${theme}-removed.png`), fullPage: true });
      outcomes.push({ theme, rounds, cancelAfterFirst, outcome, message: await page.locator('#installed-message').innerText() });
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
