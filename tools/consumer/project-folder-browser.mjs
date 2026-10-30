import { chooseCatalogFamily } from './policy-drawer.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { addFromCatalog, closePolicyDrawer } from './policy-drawer.mjs';
import { openSetupAdvanced } from './advanced-browser.mjs';

// The project folder and the "Your setup" entry, on the running page with real packed packages. `project` is the
// host's configured default; `other` is a second disposable folder the journey types in. Both themes are walked; each
// ends back on the default folder, chosen from the recent list, so the next journey starts where this one did.
export async function runProjectFolderBrowser({ origin, output, playwrightModule, project, other }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true }); await mkdir(other, { recursive: true });
  const browser = await chromium.launch({ headless: true }), errors = [], outcomes = [];
  let page;
  // Install's preview is ready for `folder`: the panel names it as its target and offers Install. A folder change
  // re-checks after its message shows, so the old preview's target is not taken for the new one.
  async function previewsInto(folder) {
    await page.waitForFunction(folder => document.getElementById('install-where')?.textContent === folder
      && !document.getElementById('install-button').disabled, folder, { timeout: 120_000 });
  }
  const focused = () => page.evaluate(() => ({ id: document.activeElement?.id ?? '', text: document.activeElement?.textContent ?? '' }));
  async function use(path) {
    const form = page.locator('#project-folder-input');
    if (!await form.isVisible()) await page.locator('#project-folder-change').click();
    await form.fill(path); await page.locator('#project-folder-use').click();
    await page.locator('#project-folder-message').filter({ hasNotText: /^Checking the folder…$/ }).waitFor();
    return page.locator('#project-folder-message').innerText();
  }
  try {
    for (const theme of ['dark', 'light']) {
      const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
      // Extensions skills carry per-client recipes; the page truthfully refuses to add them without the header
      // tool, so this journey chooses claude up front, as the installed journey does.
      await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude'));
      page = await context.newPage(); page.setDefaultTimeout(30_000);
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

      // Your setup is reachable from the shell, and Back to catalog returns to it.
      const entry = page.locator('#your-setup');
      assert.equal((await entry.innerText()).trim(), 'Your setup');
      assert.match(await entry.getAttribute('aria-label'), /nothing chosen yet/);
      await entry.click();
      await page.locator('#policy-review-panel').waitFor();
      assert.equal(await entry.getAttribute('aria-expanded'), 'true');
      await page.locator('#project-folder').waitFor();
      assert.equal(await page.locator('#project-folder-name').innerText(), basename(project), 'The host default folder is used.');
      assert.equal(await page.locator('#project-folder-path').innerText(), project);
      // Before anything is chosen the folder is the host's default; once the earlier pass picks it again it is a chosen one.
      if (!outcomes.length) assert.match(await page.locator('#project-folder-note').innerText(), /default for this Workbench/);
      else assert.equal(await page.locator('#project-folder-note').innerText(), '');
      await page.locator('#policy-back-to-catalog').click();
      await page.locator('#policy-review-panel').waitFor({ state: 'hidden' });
      assert.equal((await focused()).id, 'catalog-search', 'Back to catalog focuses the search box when nothing was chosen.');

      await chooseCatalogFamily(page, 'Extensions');
      await page.locator('#catalog-search').fill('grill-me');
      // One-click Add puts it in the setup; Your setup then prepares Install into the folder.
      await addFromCatalog(page, 'extensions.matt.grill-me');
      await entry.click(); await page.locator('#policy-review-panel').waitFor();
      await previewsInto(project);
      await closePolicyDrawer(page);
      await page.locator('#your-setup').filter({ hasText: 'Your setup (1)' }).waitFor();
      await entry.click();
      await page.locator('#policy-review-panel').waitFor();
      assert.match((await focused()).text, /^Install your setup into /, 'Your setup lands on Install.');
      await page.keyboard.press('Escape');
      await page.locator('#policy-review-panel').waitFor({ state: 'hidden' });
      assert.equal((await focused()).id, 'your-setup', 'Escape returns focus to the entry that opened the panel.');
      await entry.click(); await page.locator('#policy-review-panel').waitFor();

      // Refused folders change nothing.
      const account = userInfo().homedir;
      for (const [path, words] of [['/', /A whole drive/], [account, /home folder/], ['relative/folder', /full path/], [join(other, 'missing'), /does not exist/]]) {
        assert.match(await use(path), words, `${path} is refused.`);
        assert.equal(await page.locator('#project-folder-path').innerText(), project, `${path} leaves the folder unchanged.`);
      }
      await page.screenshot({ path: join(output, `${theme}-refused.png`), fullPage: true });

      // A typed folder replaces the default; what was prepared for the old folder is discarded and checked again.
      assert.match(await use(other), new RegExp(`Now using ${basename(other)}.*discarded`));
      assert.equal(await page.locator('#project-folder-path').innerText(), other);
      await previewsInto(other);
      await page.locator('#installed-note').filter({ hasText: 'Nothing from Workbench is installed' }).waitFor();
      await page.screenshot({ path: join(output, `${theme}-switched.png`), fullPage: true });

      // Recent folders stay in this browser: the saved policy does not carry them.
      const download = page.waitForEvent('download'); await openSetupAdvanced(page); await page.locator('#policy-save').click();
      const saved = join(output, `${theme}-policy.json`); await (await download).saveAs(saved);
      const bytes = await readFile(saved, 'utf8');
      for (const path of [project, other]) assert.ok(!bytes.includes(path), 'The saved policy never contains a project folder.');
      assert.ok(!bytes.includes('wb-recent-project-folders'));
      const recent = await page.evaluate(() => JSON.parse(localStorage.getItem('wb-recent-project-folders') ?? '[]'));
      assert.deepEqual(recent.slice(0, 2), [other, project]);

      // Back to the default through the recent list.
      await page.locator('#project-folder-change').click();
      await page.locator('#project-folder-recent').getByRole('button', { name: basename(project), exact: true }).click();
      await page.locator('#project-folder-message').filter({ hasText: `Now using ${basename(project)}` }).waitFor();
      await previewsInto(project);
      outcomes.push({ theme, recent });
      await context.close();
    }
    assert.deepEqual(errors, []);
    await writeFile(join(output, 'project-folder-evidence.json'), JSON.stringify({ status: 'passed', outcomes, errors }, null, 2));
    console.log(`Project folder running-page journey passed: ${output}`);
  } catch (error) {
    await page?.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {});
    await writeFile(join(output, 'failure.json'), JSON.stringify({ error: error.message, errors, text: await page?.locator('body').innerText().catch(() => '') }, null, 2));
    throw error;
  } finally { await browser.close(); }
}

// Run against an already running Workbench whose configured project folder is <project>:
//   node tools/consumer/project-folder-browser.mjs <origin> <project> <other folder> [output dir]
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [origin, project, other, output = 'project-folder-evidence'] = process.argv.slice(2);
  await runProjectFolderBrowser({ origin, output, project, other, playwrightModule: process.env.PLAYWRIGHT_MODULE ?? 'playwright' });
}
