import { chooseCatalogFamily } from './policy-drawer.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { addFromCatalog, closePolicyDrawer, openPolicyDrawer, openPolicyFileActions } from './policy-drawer.mjs';
import { openPolicyWorkspace, openSetupAdvanced } from './advanced-browser.mjs';

// Real packed packages and a disposable host project. Every mutation goes through the running page's
// ordinary reviewed Core path; no mocked inventory, preparation, Apply or browser client state.
export async function runInstalledPanelBrowser({ origin, output, playwrightModule, cancellationThemes = [], timingState = undefined }) {
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
      // The header's canonical tool: extensions skills carry per-client recipes, and Catalog refuses to compose
      // them without a named client, so this journey — like every other UI165 journey — chooses claude up front.
      // With the tool, the composed policy carries the execution-policy 1.4 metadata bundle and Core's prepare
      // echoes named prepared-1.6 rows with origins; the assertions below require exactly that.
      await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude'));
      page = await open(context, theme);
      await chooseCatalogFamily(page, 'Extensions');
      await page.locator('#catalog-search').fill('grill-me');
      // One-click Add puts it in the setup with the items it needs; Install and the installed list are in Your setup.
      await addFromCatalog(page, 'extensions.matt.grill-me'); await openPolicyDrawer(page);
      if (!['unavailable', 'failed'].includes(timingState)) await page.locator('#installed-note').filter({ hasText: 'Nothing from Workbench is installed' }).waitFor();
      assert.equal(await page.locator('#install-timings').isHidden(), true, 'timings are empty before the first install');
      await page.locator('#install-button:not([disabled])').waitFor();
      assert.ok(await page.locator('#install-files').getByText(/SKILL.md/).count());
      // Review the named items through the same expandable section a person opens before Install.
      await page.locator('#install-details > summary').click();
      await page.locator('#install-review-rows [data-review-selection]').first().waitFor();
      const folders = await page.locator('#install-folders').innerText();
      assert.match(folders, /Project folder: .+\./, 'the actual project folder is stated');
      assert.match(folders, /Guidance folder: (this setup writes no user-folder content\..+|.+\.)/, 'the guidance folder is stated, including the explicit none case');
      const rowsText = await page.locator('#install-review-rows').innerText();
      assert.match(rowsText, /(When used: \d+ bytes · \d+ chars|Size unknown: Core reported no delivered size for this item\.)/, 'the size line is Core\'s exact wording, never a vague allowance');
      assert.match(rowsText, /Chosen by you/, 'a directly chosen item says its recorded origin');
      if (timingState === 'loading') await page.route('**/api/authoring-timings', async route => { await new Promise(done => setTimeout(done, 500)); await route.continue(); });
      if (timingState === 'unavailable') await page.route('**/api/authoring-timings', route => route.fulfill({ json: { status: 'unavailable', reason: 'Timings unavailable fixture' } }));
      if (timingState === 'failed') await page.route('**/api/authoring-timings', route => route.abort());
      await page.locator('#install-button').click();
      await page.locator('#install-message[data-outcome="installed"]').waitFor({ timeout: 120_000 });
      if (timingState === 'loading') await page.locator('#install-timing-rows').filter({ hasText: 'Loading timings for run' }).waitFor({ state: 'attached' });
      if (['unavailable', 'failed'].includes(timingState)) {
        await page.locator('#install-timing-rows').filter({ hasText: timingState === 'unavailable' ? 'Timings unavailable for run' : 'Timings failed for run' }).waitFor({ state: 'attached' });
        await writeFile(join(output, `timings-${timingState}-${theme}.json`), JSON.stringify({ status: 'passed', state: timingState }, null, 2));
        await context.close();
        continue;
      }
      const group = page.locator('[data-installed-item="extensions.matt.grill-me"]');
      await group.waitFor();
      if (!await group.locator('details').evaluate(details => details.open)) await group.locator('details > summary').click();
      assert.match(await group.innerText(), /it needs[\s\S]*grilling/);
      assert.equal(await group.getByRole('button', { name: 'Update', exact: true }).count(), 0, 'no update action in the empty update state');
      assert.equal(await page.locator('#install-project-facts').textContent(), '', 'no Project basics facts in the empty facts state');
      // UI166: only the strict complete run claims confirmed on disk.
      assert.match(await page.locator('#install-message').innerText(), /Confirmed on disk/);
      await page.locator('#install-timing-rows').getByText(/inventory:/).waitFor({ state: 'attached' });
      await page.locator('#install-timings > summary').click();
      const timingText = await page.locator('#install-timing-rows').innerText();
      const runId = /run ([0-9a-f-]{36})/.exec(timingText)?.[1];
      assert.ok(runId, timingText);
      for (const phase of ['resolve', 'compatibility', 'render', 'prepare', 'apply', 'inventory'])
        assert.match(timingText, new RegExp(`${phase}: \\d+\\.\\d{3} ms · run ${runId}`), `${phase} timing missing for ${runId}`);
      // UI166-AC04: a directly added item has no set-owned first step, so the guidance line stays empty.
      assert.equal(await page.locator('#install-first-run').textContent(), '');
      await page.screenshot({ path: join(output, `${theme}-installed.png`), fullPage: true });
      const download = page.waitForEvent('download'); await openSetupAdvanced(page); await page.locator('#policy-save').click();
      const saved = join(output, `${theme}-policy.json`); await (await download).saveAs(saved);
      // The normal journey proves a fresh reopen. Cancellation keeps the original Install outcome,
      // so it also catches an old data-outcome=installed surviving a partially applied Remove.
      const reopened = cancelAfterFirst ? context : await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      if (!cancelAfterFirst) await reopened.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude'));
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
      if (!await installed.locator('details').evaluate(details => details.open)) await installed.locator('details > summary').click();
      assert.match(await installed.innerText(), /it needs[\s\S]*grilling/, 'recorded names and the needed-by grouping survive a fresh page reopen against the on-disk receipts');
      if (cancelAfterFirst) assert.equal(await page.locator('#install-message').getAttribute('data-outcome'), 'installed');
      else await page.locator('#install-message').filter({ hasText: 'Already installed:' }).waitFor();
      await installed.getByRole('button', { name: 'Remove', exact: true }).click();
      await installed.getByText(/members are reviewed for removal/).first().waitFor();
      assert.match(await page.locator('#installed-message').innerText(), /Nothing has been removed yet/);
      const beforeCancel = await page.locator('#install-message').innerText();
      await installed.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.ok(await installed.isVisible(), 'Cancel before confirmation keeps the installed item.');
      assert.equal(await page.locator('#install-message').innerText(), beforeCancel, 'Cancel before confirmation leaves Install unchanged.');
      const lifecycleCalls = [];
      page.on('request', request => { if (/\/api\/authoring-(remove|apply)$/.test(request.url())) lifecycleCalls.push(request.url().split('authoring-')[1]); });
      await installed.getByRole('button', { name: 'Remove', exact: true }).click();
      await installed.getByRole('button', { name: 'Confirm remove', exact: true }).waitFor();
      await page.screenshot({ path: join(output, `${theme}-remove-preview.png`), fullPage: true });
      await installed.getByRole('button', { name: 'Confirm remove', exact: true }).click();
      await page.locator('#installed-note').filter({ hasText: 'Nothing from Workbench is installed' }).waitFor({ timeout: 120_000 });
      assert.deepEqual(lifecycleCalls, ['remove', 'apply'], 'set/member/needed removal is one reviewed removal 1.2 step and one Apply');
      const outcome = await page.locator('#installed-message').getAttribute('data-outcome');
      assert.equal(outcome, 'removed', await page.locator('#installed-message').innerText());
      const removalMessage = await page.locator('#installed-message').innerText();
      assert.match(removalMessage, /grill-me: removed/);
      assert.match(removalMessage, /grilling: removed/);
      assert.doesNotMatch(removalMessage, /unverified/i, 'Core run result 1.4 confirms each item absent');
      assert.equal(await page.locator('#installed-list [data-installed-item]').count(), 0);
      await page.locator('#install-message').filter({ hasText: 'Nothing has been installed yet' }).waitFor();
      assert.equal(await page.locator('#install-message').getAttribute('data-outcome'), null, 'Removal clears the old install outcome.');
      await page.screenshot({ path: join(output, `${theme}-removed.png`), fullPage: true });
      outcomes.push({ theme, rounds: 1, cancelAfterFirst, outcome, message: removalMessage, lifecycleCalls });
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
