import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { addFromCatalog, chooseCatalogFamily, openPolicyDrawer } from './policy-drawer.mjs';

export async function runMcpFailedRunBrowser({ origin, output, project, playwrightModule, theme = 'dark' }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude'));
    const page = await context.newPage(); page.setDefaultTimeout(30_000);
    await page.goto(origin + '/');
    await page.locator('#browse-family option[value="ECC"]').waitFor({ state: 'attached' });
    if (await page.locator('#setup-dialog').isVisible()) {
      await page.getByRole('radio', { name: /Vibe coder/ }).check();
      for (let step = 0; step < 4; step++) await page.locator('#setup-next').click();
      await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
    }
    const destination = theme === 'light' ? 'Switch to light mode' : 'Switch to dark mode';
    if (await page.getByRole('button', { name: destination, exact: true }).count()) await page.getByRole('button', { name: destination, exact: true }).first().click();
    await chooseCatalogFamily(page, 'ECC');
    await page.locator('#catalog-search').fill('cloudflare-docs');
    await addFromCatalog(page, 'ecc.mcp.cloudflare-docs');
    await openPolicyDrawer(page);
    await page.locator('#install-button:not([disabled])').waitFor();
    await mkdir(join(project, '.mcp.json'), { recursive: true });
    const applied = page.waitForResponse(response => response.url().endsWith('/api/authoring-apply'), { timeout: 120_000 });
    await page.locator('#install-button').click();
    const run = await (await applied).json();
    assert.ok(['incomplete', 'cancelled', 'rejected'].includes(run.completion), JSON.stringify(run));
    assert.ok((run.operations ?? []).some(operation => operation.application === 'failed' || operation.application === 'not-attempted'), JSON.stringify(run));
    assert.doesNotMatch(await page.locator('#install-message').innerText(), /Confirmed on disk/);
    assert.notEqual(await page.locator('#install-message').getAttribute('data-outcome'), 'installed');
    await writeFile(join(output, `mcp-failed-run-${theme}.json`), JSON.stringify({ status: 'passed', completion: run.completion, operations: run.operations, message: await page.locator('#install-message').innerText() }, null, 2));
    await context.close();
    return { status: 'passed' };
  } finally { await rm(join(project, '.mcp.json'), { recursive: true, force: true }); await browser.close(); }
}
