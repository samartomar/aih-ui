import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { addFromCatalog, chooseCatalogFamily, closePolicyDrawer, openPolicyDrawer } from './policy-drawer.mjs';

async function openPage(browser, origin, theme, family) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude'));
  const page = await context.newPage(); page.setDefaultTimeout(30_000);
  await page.goto(origin + '/');
  await page.locator(`#browse-family option[value="${family}"]`).first().waitFor({ state: 'attached' });
  if (await page.locator('#setup-dialog').isVisible()) {
    await page.getByRole('radio', { name: /Vibe coder/ }).check();
    for (let step = 0; step < 4; step++) await page.locator('#setup-next').click();
  }
  const destination = theme === 'light' ? 'Switch to light mode' : 'Switch to dark mode';
  if (await page.getByRole('button', { name: destination, exact: true }).count()) await page.getByRole('button', { name: destination, exact: true }).first().click();
  return { context, page };
}

export async function runUi168ProjectBasicsBrowser({ origin, output, playwrightModule, theme = 'dark', factsState = undefined }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const { context, page } = await openPage(browser, origin, theme, 'Project basics');
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('#framework-navigation button[data-framework^="internal:project-basics"]').click();
    if (!await page.locator('#browse-all-items').isChecked()) await page.locator('#browse-all-items').check();
    await page.locator('#cards-grid [data-card-id]').first().waitFor();
    if (factsState === 'loading') await page.route('**/api/authoring-project-facts', async route => { await new Promise(done => setTimeout(done, 500)); await route.continue(); });
    if (factsState === 'unavailable') await page.route('**/api/authoring-project-facts', route => route.fulfill({ json: { status: 'invalid', facts: null, diagnostics: [{ message: 'Facts unavailable fixture' }] } }));
    if (factsState === 'failed') await page.route('**/api/authoring-project-facts', route => route.abort());
    if (factsState === 'empty') await page.route('**/api/authoring-project-facts', route => route.fulfill({ json: { status: 'complete', facts: [], diagnostics: [] } }));
    await addFromCatalog(page, 'project-basics.working-rules');
    await openPolicyDrawer(page);
    await page.locator('#install-details > summary').click();
    if (factsState === 'loading') {
      await page.locator('#install-project-facts').filter({ hasText: 'Loading project facts…' }).waitFor();
      await page.locator('#install-project-facts').filter({ hasText: 'Detected: ' }).waitFor();
    }
    const facts = await page.locator('#install-project-facts').innerText();
    if (factsState === 'unavailable') assert.match(facts, /Project facts unavailable: Facts unavailable fixture/);
    else if (factsState === 'failed') assert.match(facts, /Project facts failed:/);
    else if (factsState === 'empty') assert.match(facts, /No project facts detected or inferred/);
    else {
      assert.match(facts, /Detected: /, facts);
      assert.match(facts, /Inferred: /, facts);
    }
    if (['unavailable', 'failed', 'empty'].includes(factsState)) {
      await writeFile(join(output, `project-facts-${factsState}-${theme}.json`), JSON.stringify({ status: 'passed', state: factsState, facts }, null, 2));
      return { status: 'passed' };
    }
    await page.locator('#install-button').waitFor();
    assert.equal(await page.locator('#install-button').isEnabled(), true, await page.locator('#install-message').innerText());
    await page.locator('#install-button').click();
    await page.locator('#install-message[data-outcome="installed"]').waitFor({ timeout: 120_000 });
    await writeFile(join(output, `project-basics-${theme}.json`), JSON.stringify({ status: 'passed', facts, errors }, null, 2));
    assert.deepEqual(errors, []);
    await context.close();
    return { status: 'passed' };
  } finally { await browser.close(); }
}

export async function runUi168BlockDriftBrowser({ origin, output, project, playwrightModule, theme = 'dark' }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const { context, page } = await openPage(browser, origin, theme, 'Catalog');
    page.on('pageerror', error => errors.push(error.message));
    await chooseCatalogFamily(page, 'Catalog');
    await addFromCatalog(page, 'aihq.project-context-pointer.agents-md');
    await openPolicyDrawer(page);
    await page.locator('#install-button:not([disabled])').waitFor();
    await page.locator('#install-button').click();
    await page.locator('#install-message[data-outcome="installed"]').waitFor({ timeout: 120_000 });
    const agentsPath = join(project, 'AGENTS.md');
    const agents = await readFile(agentsPath, 'utf8');
    assert.match(agents, /BEGIN aihq:context:shared/);
    await writeFile(agentsPath, agents.replace('## Start here', '## Start here\n\nLocal block edit.'));
    await closePolicyDrawer(page); await openPolicyDrawer(page);
    const drift = page.locator('[data-installed-state="block-changed"]');
    await drift.waitFor();
    assert.match(await drift.innerText(), /AIH block edited/);
    assert.ok(await drift.getAttribute('title') ?? await drift.locator('[title]').first().getAttribute('title'));
    await page.screenshot({ path: join(output, `project-basics-drift-${theme}.png`), fullPage: true });
    await writeFile(join(output, `project-basics-drift-${theme}.json`), JSON.stringify({ status: 'passed', drift: await drift.innerText(), errors }, null, 2));
    assert.deepEqual(errors, []);
    await context.close();
    return { status: 'passed' };
  } finally { await browser.close(); }
}
