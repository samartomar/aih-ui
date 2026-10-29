// How long the page's own work takes once the host has answered, on real Catalog prepared content (ECC, Superpowers,
// AIH Extensions and Project basics). Each step is timed from the moment its last host API response arrived to the
// moment a person can use the result, and the page's own main-thread work in the step (its long tasks) is summed; both
// must stay within the budget. The second catches work that delays a request the page only sends once it is free.
//   1. first load: the frameworks list has loaded and first-run setup is closed;
//   2. choosing a framework in the list shows that framework's starting sets;
//   3. adding those sets confirms them in the guidance;
//   4. Your setup opens and shows the chosen content.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chooseCatalogFamily, openPolicyDrawer } from './policy-drawer.mjs';

export const BUDGET_MS = 5000;

export async function runRenderSpeedBrowser({ origin, output, playwrightModule, budgetMs = BUDGET_MS }) {
  const { chromium } = await import(playwrightModule);
  const browser = await chromium.launch({ headless: true }); await mkdir(output, { recursive: true });
  const errors = [], steps = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => {
      localStorage.setItem('wb-your-tool', 'claude');
      window.__longTasks = [];
      new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__longTasks.push({ at: performance.timeOrigin + entry.startTime, ms: entry.duration }); }).observe({ type: 'longtask', buffered: true });
    });
    const page = await context.newPage(); page.setDefaultTimeout(180000); page.on('pageerror', error => errors.push(error.message));
    // Every host API response, by the time it arrived.
    const responses = [];
    page.on('response', response => { if (new URL(response.url()).pathname.startsWith('/api/')) responses.push({ op: new URL(response.url()).pathname.slice(5), at: Date.now() }); });
    // One step: run the action, wait until its result is usable, and time it from the last API response in between.
    const step = async (name, act, ready) => {
      const started = Date.now(); await act(); await ready(); const done = Date.now();
      const answered = responses.filter(response => response.at >= started && response.at <= done);
      const apiDone = Math.max(started, ...answered.map(response => response.at));
      const tasks = await page.evaluate(() => window.__longTasks);
      const mainThreadMs = Math.round(tasks.filter(task => task.at >= started && task.at <= done).reduce((sum, task) => sum + task.ms, 0));
      steps.push({ name, totalMs: done - started, afterApiMs: done - apiDone, mainThreadMs, apiCalls: answered.length,
        api: answered.map(response => ({ op: response.op, atMs: response.at - started })) });
    };
    await step('first load', () => page.goto(origin + '/'), async () => {
      await page.locator('#framework-navigation').filter({ hasNotText: 'Loading frameworks' }).waitFor();
      if (await page.locator('#setup-dialog').isVisible()) {
        await page.getByRole('radio', { name: /Vibe coder/ }).check();
        for (let i = 0; i < 4; i++) await page.locator('#setup-next').click();
        await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
      }
    });
    await step('choose a framework', () => chooseCatalogFamily(page, 'Extensions'), () => page.locator('[data-add-sets]').waitFor());
    await step('add its starting sets', () => page.locator('[data-add-sets]').click(),
      () => page.waitForFunction(() => document.getElementById('framework-guidance').textContent.includes('Chosen sets added'), null, { polling: 50 }));
    await step('open Your setup', () => openPolicyDrawer(page), () => page.locator('#policy-internal-content').waitFor());
    await page.screenshot({ animations: 'disabled', path: join(output, 'your-setup.png') });
    await context.close();
  } finally { await browser.close(); }
  const result = { status: 'passed', budgetMs, steps, errors };
  try {
    assert.deepEqual(errors, [], 'The page raises no errors');
    for (const { name, afterApiMs, mainThreadMs } of steps) {
      assert.ok(afterApiMs <= budgetMs, `${name} is usable ${afterApiMs} ms after its API calls complete; the budget is ${budgetMs} ms`);
      assert.ok(mainThreadMs <= budgetMs, `${name} spends ${mainThreadMs} ms of page work on the main thread; the budget is ${budgetMs} ms`);
    }
  } catch (error) { Object.assign(result, { status: 'failed', error: error.message }); }
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2));
  return result;
}
