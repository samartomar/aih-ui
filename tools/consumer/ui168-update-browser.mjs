// UI168 update on the running page, against a real newer Catalog: the case installs ECC's TypeScript rules on the
// installed Catalog, then restarts the host on a Catalog pack (built with Catalog's own generator) in which exactly one
// of those rules changed (tools/newer-catalog.mjs). The page offers that one item an update; Core decides what it
// writes and where, and the check reads the files at the paths Core's inventory reports for the item.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { freshInstalledList } from './installed-truth-browser.mjs';

/**
 * Updates `itemId` through its installed row. `edited` names the file (at the path Core's inventory reports) the case
 * changed first: Core's preview must name that conflict at that path and refuse, so Confirm is never offered and
 * nothing is updated. `operationState` replaces the host's answer to the update request (loading, unavailable or
 * failed) to check what the page says; nothing is updated then. Returns Core's inventory before and after.
 */
export async function runUi168UpdateVerifyBrowser({ origin, output, playwrightModule, theme = 'dark', itemId, edited = undefined, operationState = undefined }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const { context, page, answers } = await freshInstalledList(browser, origin, theme, errors, { catalog: false });
    const before = answers.inventory;
    const selection = before.selections.find(entry => entry.item?.itemId === itemId && entry.scope === 'project');
    assert.ok(selection, `Core lists ${itemId} installed`);
    const row = page.locator(`[data-installed-row="${selection.managementId}"]`);
    await row.locator('[data-installed-state="update-available"]').waitFor();
    // Only the changed item offers an update.
    const offered = await page.locator('[data-installed-row]').filter({ has: page.locator('[data-installed-state="update-available"]') })
      .evaluateAll(rows => rows.map(entry => entry.dataset.installedRow));
    assert.deepEqual(offered, [selection.managementId], 'only the changed item shows "Update available"');
    const applies = [];
    page.on('response', response => { if (/\/api\/authoring-apply(-status)?$/.test(response.url())) void response.json().then(value => { if (value.status !== 'running') applies.push(value); }).catch(() => {}); });
    if (operationState === 'loading') await page.route('**/api/authoring-update', async route => { await new Promise(done => setTimeout(done, 500)); await route.continue(); });
    if (operationState === 'unavailable') await page.route('**/api/authoring-update', route => route.fulfill({ json: { disposition: 'unavailable', diagnostics: [{ message: 'Update unavailable fixture' }] } }));
    if (operationState === 'failed') await page.route('**/api/authoring-update', route => route.abort());
    await row.getByRole('button', { name: 'Update', exact: true }).click();
    const message = page.locator('#installed-message');
    if (operationState === 'loading') await message.filter({ hasText: 'Checking the replacement…' }).waitFor();
    if (operationState === 'unavailable') {
      await message.filter({ hasText: 'Update cannot go ahead: Update unavailable fixture. Nothing was updated.' }).waitFor();
      await writeFile(join(output, `update-unavailable-${theme}.json`), JSON.stringify({ status: 'passed', state: operationState }, null, 2));
      return { status: 'passed', before };
    }
    if (operationState === 'failed') {
      await message.filter({ hasText: 'Update did not start:' }).waitFor();
      await writeFile(join(output, `update-failed-${theme}.json`), JSON.stringify({ status: 'passed', state: operationState }, null, 2));
      return { status: 'passed', before };
    }
    const preview = row.locator('[data-update-preview]');
    await preview.waitFor({ timeout: 240_000 });
    const confirm = row.getByRole('button', { name: 'Confirm update', exact: true });
    if (edited) {
      await page.waitForFunction(() => document.getElementById('installed-message')?.dataset.outcome === 'not-prepared', undefined, { timeout: 240_000 });
      const review = await preview.innerText();
      assert.ok(review.split('\n').includes(`conflict ${edited} — managed-content-changed`), `Core names the edited file where it installed it: ${review}`);
      assert.equal(await confirm.isDisabled(), true, 'a refused update offers no Confirm');
      assert.match(await message.innerText(), /^Update cannot go ahead: .*Nothing was updated\.$/s);
      await page.screenshot({ path: join(output, `update-${theme}-edited.png`), fullPage: true });
      await context.close();
      assert.deepEqual(errors, []);
      return { status: 'passed', before, message: await message.innerText().catch(() => '') };
    }
    assert.match(await message.innerText(), /^Nothing has been updated yet\. Check the replacement, then confirm\.$/);
    await confirm.click();
    await page.waitForFunction(() => ['updated', 'failed', 'unknown', 'kept'].includes(document.getElementById('installed-message')?.dataset.outcome), undefined, { timeout: 240_000 });
    const result = await message.innerText();
    assert.equal(await message.getAttribute('data-outcome'), 'updated', `${result} ${JSON.stringify(applies).slice(0, 2000)}`);
    await page.screenshot({ path: join(output, `update-${theme}-clean.png`), fullPage: true });
    await context.close();
    const after = (await freshInstalledList(browser, origin, theme, errors, { catalog: false })).answers.inventory;
    assert.deepEqual(errors, []);
    await writeFile(join(output, `update-${theme}-clean.json`), JSON.stringify({ status: 'passed', itemId, message: result }, null, 2));
    return { status: 'passed', before, after, message: result };
  } finally { await browser.close(); }
}
