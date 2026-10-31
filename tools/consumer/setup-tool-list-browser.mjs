// First-run setup's Your tools step and the header's Your tools hear one shared read of Core's tool list (GET
// /api/tools), whenever it answers. Run 22 failed because the list was slow: the step showed its loading words, the
// person went on, and nothing told them the list would not come. Each scenario holds or fails the page's own requests:
//   slow         answered seconds after the step is open: the step says it is loading (and that the person may go on),
//                then offers the list, and the header lists the same tools;
//   never        never answered: after the read's timeout and its one retry the step says the tools couldn't be loaded
//                and the person can go on; the header says it couldn't load;
//   retry        the first answer fails: the shared read tries once more for everyone, so setup and the header both get
//                the list and setup never shows "couldn't be loaded" first;
//   earlier      the list arrives while the person is still on the first step: the step offers it when reached;
//   skip-back    the list arrives after "Choose tools later": Back to the step offers it;
//   reopened     every answer fails during first-run setup, which is saved with no tools; once the host answers again,
//                setup re-opened from Settings offers the list and the header lists it too.
// Nothing but the last scenario saves, so each starts from first-run setup on the same host.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { listTools } from '@aihq/core/harness';

const LOADING = 'Loading your tools… You can continue and choose them later from Settings.';
const FAILED = "Your tools couldn't be loaded. Tools you already chose stay chosen; you can continue and choose them later from Settings.";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// only: the scenario names to run (default all); SETUP_TOOL_LIST_ONLY=never,slow selects them from the command line.
export async function runSetupToolListBrowser({ origin, output, playwrightModule, theme = 'dark', only = process.env.SETUP_TOOL_LIST_ONLY?.split(',') }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const ids = listTools({ includeUnobserved: true }).map(tool => tool.id);
  const browser = await chromium.launch({ headless: true });
  const results = {};
  const step = page => page.locator('#setup-content');
  const stepText = async page => (await step(page).innerText()).trim();
  const offered = page => step(page).locator('.setup-choice').evaluateAll(rows => rows.map(row => row.dataset.tool));
  const headerState = page => page.locator('#your-tool-trigger').getAttribute('data-your-tool');
  const toTools = async page => {
    await page.getByRole('radio', { name: /Vibe coder/ }).check();
    await page.locator('#setup-next:not([disabled])').click();
    assert.equal(await page.locator('#setup-title').innerText(), 'Your tools');
  };
  const expectList = async (page, name) => {
    await step(page).locator('.setup-choice').first().waitFor();
    assert.deepEqual(await offered(page), ids, `${name}: setup offers Core's tool list`);
    await page.waitForFunction(() => document.getElementById('your-tool-trigger').dataset.yourTool === 'listed');
    assert.deepEqual(await page.locator('#your-tool-list > button').evaluateAll(rows => rows.map(row => row.dataset.tool)), ids, `${name}: the header lists the same tools`);
  };
  async function scenario(name, run) {
    if (only && !only.includes(name)) return;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: theme });
    const page = await context.newPage(); page.setDefaultTimeout(90_000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    // Every text the step shows, in order, so a brief "couldn't be loaded" before the list cannot go unseen.
    await page.addInitScript(() => {
      window.__stepTexts = [];
      new MutationObserver(() => {
        const text = document.getElementById('setup-content')?.innerText.trim();
        if (text && text !== window.__stepTexts.at(-1)) window.__stepTexts.push(text);
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });
    try {
      await run(page);
      await page.screenshot({ path: join(output, `setup-tools-${name}-${theme}.png`) });
      assert.deepEqual(errors, [], `${name}: no page errors`);
      results[name] = 'passed';
    } finally { await context.close(); }
  }
  const hold = async page => {
    let release; const held = new Promise(resolve => { release = resolve; });
    let requests = 0;
    await page.route('**/api/tools', async route => { requests++; await held; await route.continue(); });
    return { release, requests: () => requests };
  };
  try {
    await scenario('slow', async page => {
      const { release } = await hold(page);
      await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
      await toTools(page);
      assert.equal(await stepText(page), LOADING, 'while the list is on its way the step says so, and that the person may go on');
      await page.screenshot({ path: join(output, `setup-tools-slow-loading-${theme}.png`) });
      await sleep(5_000);
      assert.equal(await stepText(page), LOADING, 'still loading, not failed');
      release();
      await expectList(page, 'slow');
      assert.ok(!(await page.evaluate(() => window.__stepTexts)).some(text => text.startsWith("Your tools couldn't")), 'no failure before the list');
    });

    await scenario('never', async page => {
      let requests = 0;
      await page.route('**/api/tools', () => { requests++; /* never answered */ });
      await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
      await toTools(page);
      // Only that it is loading here (the exact words are the slow scenario's): the defect is a step that never moves on.
      assert.match(await stepText(page), /^Loading your tools…/);
      // The read's timeout, then its one retry's: the step then says plainly that the tools couldn't be loaded.
      await page.waitForFunction(text => document.getElementById('setup-content').innerText.trim() === text, FAILED, { timeout: 60_000 });
      assert.equal(await step(page).locator('input[type="checkbox"]').count(), 0);
      assert.equal(requests, 2, 'one read shared by setup and the header, and one retry');
      assert.equal(await headerState(page), 'failed', 'the header says it couldn\'t load, as setup does');
      await page.locator('#setup-next:not([disabled])').click();
      assert.equal(await page.locator('#setup-title').innerText(), 'Review your local setup', 'the person can go on');
    });

    await scenario('retry', async page => {
      let requests = 0;
      await page.route('**/api/tools', async route => {
        requests++;
        if (requests === 1) await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'fixture: busy' }) });
        else await route.continue();
      });
      await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
      await toTools(page);
      await expectList(page, 'retry');
      assert.equal(requests, 2, 'the failed read was retried once, for setup and the header together');
      assert.ok(!(await page.evaluate(() => window.__stepTexts)).some(text => text.startsWith("Your tools couldn't")), 'no "couldn\'t be loaded" flash before the list');
      assert.doesNotMatch(await page.locator('#setup-dialog').innerText(), /fixture: busy/);
    });

    await scenario('earlier', async page => {
      const { release } = await hold(page);
      await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
      await page.getByRole('radio', { name: /Vibe coder/ }).waitFor();
      release();
      await page.waitForFunction(() => document.getElementById('your-tool-trigger').dataset.yourTool === 'listed');
      assert.match(await page.locator('#setup-title').innerText(), /How will you use/, 'the list arrived on the first step');
      await toTools(page);
      await expectList(page, 'earlier');
    });

    await scenario('skip-back', async page => {
      const { release } = await hold(page);
      await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
      await toTools(page);
      await page.locator('#setup-skip').click();
      assert.equal(await page.locator('#setup-title').innerText(), 'Review your local setup');
      release();
      await page.waitForFunction(() => document.getElementById('your-tool-trigger').dataset.yourTool === 'listed');
      await page.locator('#setup-back').click();
      assert.equal(await page.locator('#setup-title').innerText(), 'Your tools');
      await expectList(page, 'skip-back');
    });

    // Last: it saves setup.
    await scenario('reopened', async page => {
      let failing = true, requests = 0;
      await page.route('**/api/tools', async route => {
        requests++;
        if (failing) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'fixture: down' }) });
        else await route.continue();
      });
      await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
      await toTools(page);
      await page.waitForFunction(text => document.getElementById('setup-content').innerText.trim() === text, FAILED);
      await page.locator('#setup-next:not([disabled])').click();
      await page.locator('#setup-next:not([disabled])').click();
      await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
      assert.equal(await headerState(page), 'failed');
      const before = requests;
      failing = false;
      await page.locator('#org-modal-trigger').click();
      await page.locator('#workspace-actions').getByRole('button', { name: 'Workspace settings', exact: true }).click();
      await page.locator('#org-modal-overlay').waitFor();
      await page.getByRole('button', { name: 'Edit your tools', exact: true }).click();
      await page.locator('#setup-dialog').waitFor({ state: 'visible' });
      await expectList(page, 'reopened');
      assert.equal(requests, before + 1, 're-opening setup read the list again, once, for setup and the header');
    });
    return { status: 'passed', results };
  } finally {
    await browser.close();
  }
}
