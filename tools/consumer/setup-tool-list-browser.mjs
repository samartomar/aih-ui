// First-run setup's Your tools step offers Core's tool list whenever GET /api/tools answers: after the setup dialog has
// reached the step (the answer held back until then) and before the dialog opens (setup's own load held back until the
// tools have answered). While the list is on its way the step says only that it is loading; the plain-words notice that
// the tools couldn't be loaded appears only when the host's answer is a failure. Nothing is saved, so every scenario
// starts from first-run setup on the same host.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { listTools } from '@aihq/core/harness';

const LOADING = 'Loading your tools…';
const FAILED = "Your tools couldn't be loaded. Tools you already chose stay chosen; you can continue and choose them later from Settings.";

export async function runSetupToolListBrowser({ origin, output, playwrightModule, theme = 'dark' }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const ids = listTools({ includeUnobserved: true }).map(tool => tool.id);
  const browser = await chromium.launch({ headless: true });
  const results = {};
  try {
    for (const order of ['after-dialog', 'before-dialog', 'failed']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: theme });
      const page = await context.newPage(); page.setDefaultTimeout(60_000);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      let release; const held = new Promise(resolve => { release = resolve; });
      if (order === 'after-dialog') await page.route('**/api/tools', async route => { await held; await route.continue(); });
      if (order === 'failed') await page.route('**/api/tools', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'fixture: the host failed' }) }));
      if (order === 'before-dialog') {
        // Setup's own load waits until the page has its tool list, so the list is there before the dialog's steps open.
        const tools = page.waitForResponse(response => new URL(response.url()).pathname === '/api/tools');
        await page.route('**/api/workbench-settings', async route => { if (route.request().method() === 'GET') await tools; await route.continue(); });
      }
      await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
      await page.locator('#setup-dialog').waitFor();
      await page.getByRole('radio', { name: /Vibe coder/ }).check();
      await page.locator('#setup-next').click();
      assert.equal(await page.locator('#setup-title').innerText(), 'Your tools');
      const step = page.locator('#setup-content');
      if (order === 'after-dialog') {
        // Still waiting: it says so, and only so; no failure and no invitation to go on without the list.
        assert.equal((await step.innerText()).trim(), LOADING, `${theme}: while the list is on its way the step says it is loading`);
        await page.screenshot({ path: join(output, `setup-tools-loading-${theme}.png`) });
        release();
      }
      if (order === 'failed') {
        await page.waitForFunction(text => document.getElementById('setup-content').innerText.trim() === text, FAILED);
        assert.equal(await step.locator('input[type="checkbox"]').count(), 0);
        assert.doesNotMatch(await page.locator('#setup-dialog').innerText(), /fixture: the host failed/, 'no raw error text');
      } else {
        await step.locator('.setup-choice').first().waitFor();
        assert.deepEqual(await step.locator('.setup-choice').evaluateAll(rows => rows.map(row => row.dataset.tool)), ids, `${order}: setup offers Core's tool list`);
        assert.doesNotMatch(await step.innerText(), /couldn't be loaded|Loading your tools/);
      }
      await page.screenshot({ path: join(output, `setup-tools-${order}-${theme}.png`) });
      assert.deepEqual(errors, []);
      results[order] = 'passed';
      await context.close();
    }
    return { status: 'passed', results };
  } finally {
    await browser.close();
  }
}
