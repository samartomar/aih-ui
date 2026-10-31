// First-run setup against the real Catalog: no assistance step, and no dropped or renamed assistance tool on any setup
// screen, in Your setup or on the FRAMEWORKS rail. The step offered tools that Catalog publishes no installable item
// for, so a choice could never reach Your setup; the case also fails once Catalog does publish one, so the step can be
// brought back wired. The rail's compatibility note sits last, collapsed.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openPolicyDrawer } from './policy-drawer.mjs';

// The tools the step offered, under every name it used, and the old step's own words.
const ASSISTANCE_NAMES = [/Headroom/i, /token optimization/i, /Workspace help/i, /Code review\b/i, /Code Review Graph/i, /Codebase memory/i, /Serena/i, /Optional AIH (requests|assistance)/i, /Skip (all )?assistance/i];
const ASSISTANCE_ITEMS = /code-review-graph|codebase-memory|serena|headroom/i;

export async function runSetupAssistanceBrowser({ origin, output, playwrightModule, theme = 'dark' }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [], screens = {};
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude'));
    const page = await context.newPage(); page.setDefaultTimeout(60_000);
    page.on('pageerror', error => errors.push(error.message));
    let catalog;
    page.on('response', async response => {
      if (!response.url().endsWith('/api/authoring-catalog')) return;
      const body = await response.json().catch(() => undefined);
      if (body?.items) catalog = body;
    });
    await page.goto(origin + '/');
    const dialog = page.locator('#setup-dialog');
    await dialog.waitFor();
    await page.locator('#setup-next:not([disabled])').waitFor();
    const keep = async name => {
      screens[name] = { title: await page.locator('#setup-title').innerText(), text: await dialog.innerText() };
      await page.screenshot({ path: join(output, `setup-assistance-${name}-${theme}.png`) });
    };
    await page.getByRole('radio', { name: /Vibe coder/ }).check();
    await keep('mode');
    assert.doesNotMatch(await page.locator('#setup-progress').innerText(), /Assistance/, 'setup progress has no assistance step');
    await page.locator('#setup-next').click();
    await keep('after-mode');
    assert.equal(screens['after-mode'].title, 'Your tools', 'Continue from the mode goes straight to Your tools');
    assert.equal(await page.locator('#setup-content input[type="checkbox"][value]').evaluateAll(boxes => boxes.filter(box => /review|memory|serena|headroom|workspace|context/.test(box.value)).length), 0);
    await page.locator('#setup-next').click();
    await keep('review');
    assert.equal(screens.review.title, 'Review your local setup');
    await page.locator('#setup-next').click();
    await dialog.waitFor({ state: 'hidden' });
    const destination = theme === 'light' ? 'Switch to light mode' : 'Switch to dark mode';
    if (await page.getByRole('button', { name: destination, exact: true }).count()) await page.getByRole('button', { name: destination, exact: true }).first().click();

    // The page's own Catalog: no installable item for any tool the step offered.
    await page.locator('#framework-navigation [data-framework]').first().waitFor();
    for (let attempt = 0; attempt < 100 && !catalog; attempt++) await page.waitForTimeout(100);
    assert.ok(catalog?.items?.length, 'the page received its Catalog');
    const assistanceItems = catalog.items.filter(item => ASSISTANCE_ITEMS.test(item.id));
    assert.deepEqual(assistanceItems.map(item => item.id), [], 'Catalog now publishes assistance content: wire the assistance step to it');

    // FRAMEWORKS rail: the compatibility note is the rail's last entry, collapsed, and names the chosen tool.
    const rail = page.locator('#framework-navigation');
    const note = rail.locator('details[data-compatibility-note]');
    assert.equal(await note.count(), 1, 'one compatibility note');
    assert.equal(await rail.evaluate(node => node.lastElementChild?.matches('details[data-compatibility-note]')), true, 'the note is the last entry of the rail');
    assert.equal(await note.evaluate(node => node.open), false, 'the note starts collapsed');
    assert.match(await note.textContent(), /Compatibility observations for \S/);
    assert.match(await note.textContent(), /Zero observations means not yet confirmed, not unsupported\./);
    assert.ok((await rail.innerText()).indexOf(await rail.locator('[data-framework]').first().innerText()) < (await rail.innerText()).indexOf(await note.locator('summary').innerText()), 'frameworks come before the note');
    screens.rail = { text: await rail.innerText() };
    await rail.screenshot({ path: join(output, `setup-assistance-rail-${theme}.png`) });
    await note.locator('summary').click();
    assert.equal(await note.evaluate(node => node.open), true, 'the note opens');
    assert.match(await note.innerText(), /Published compatibility evidence, not installed-item counts\./);

    // Your setup and the saved setup carry no assistance either.
    await openPolicyDrawer(page);
    screens.yourSetup = { text: await page.locator('#policy-review-panel').innerText() };
    for (const [name, screen] of Object.entries(screens)) for (const words of ASSISTANCE_NAMES) assert.doesNotMatch(screen.text, words, `${name} names ${words}`);
    const saved = await (await context.request.get(origin + '/api/workbench-settings')).json();
    assert.deepEqual(saved.settings.capabilities, [], 'a new setup saves no assistance');
    await writeFile(join(output, `setup-assistance-${theme}.json`), JSON.stringify({ catalogItems: catalog.items.length, assistanceItems: assistanceItems.length, screens, errors }, null, 2));
    assert.deepEqual(errors, []);
    return { status: 'passed' };
  } finally { await browser.close(); }
}
