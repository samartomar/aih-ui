// The owner's Gate A setup in a real browser: Enterprise, role admin, a remote policy repository the host does not read,
// all eleven AI clients chosen in setup, and an older single "Codex" choice in this browser. The page must list every
// chosen tool, judge content across all of them, show addable items, add one to each tool Core renders it for, install
// it through Core, and say clearly that the organization policy was not read and what to do. Expectations come from the
// page's own answers (Core's tool registry and Core's inventory), never from a list kept here.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chooseCatalogFamily, openPolicyDrawer } from './policy-drawer.mjs';

// The owner's settings file as the Workbench stores it (emails redacted).
export const OWNER_SETTINGS = {
  format: 'aih-ui-settings', version: 1, experience: 'enterprise', role: 'admin',
  organization: { name: 'Gosam', shortId: 'gosam', policyRepo: 'https://github.com/samartomar/test', emails: ['owner@example.invalid'] },
  capabilities: ['workspace-help', 'context-optimization', 'headroom', 'codebase-memory', 'code-review', 'serena'],
  clients: ['claude', 'codex', 'cursor', 'gemini', 'copilot', 'windsurf', 'kiro', 'kimi', 'opencode', 'antigravity', 'zed'],
  reviewer: { kind: 'individual', id: 'Owner' },
};

export async function runYourToolsBrowser({ origin, output, project, playwrightModule, theme = 'dark' }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    // The owner's browser still held the old single choice.
    await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'codex'));
    const page = await context.newPage(); page.setDefaultTimeout(60_000);
    page.on('pageerror', error => errors.push(error.message));
    const answers = { tools: undefined, browse: [], edits: [], inventory: undefined };
    page.on('response', async response => {
      const path = new URL(response.url()).pathname;
      const body = await response.json().catch(() => undefined);
      if (!body) return;
      if (path === '/api/tools') answers.tools = body;
      else if (path === '/api/authoring-browse-content') answers.browse.push(body);
      else if (path === '/api/authoring-edit' || path === '/api/authoring-draft-edit') answers.edits.push(body);
      else if (path === '/api/authoring-managed' && body.selections) answers.inventory = body;
    });
    await page.goto(origin + '/');
    await page.locator('#browse-family option[value="Extensions"]').waitFor({ state: 'attached' });
    assert.equal(await page.locator('#setup-dialog').isVisible(), false, 'the saved setup opens the Workbench directly');
    const destination = theme === 'light' ? 'Switch to light mode' : 'Switch to dark mode';
    if (await page.getByRole('button', { name: destination, exact: true }).count()) await page.getByRole('button', { name: destination, exact: true }).first().click();

    // Your tools: every client chosen in setup, by Core's labels, in the header; a multi-select list.
    await page.waitForFunction(() => document.getElementById('your-tool-trigger').dataset.yourTool === 'listed');
    const registry = answers.tools.tools, chosen = registry.filter(tool => OWNER_SETTINGS.clients.includes(tool.id));
    assert.equal(chosen.length, OWNER_SETTINGS.clients.length, 'Core lists every client the setup chose');
    const header = await page.locator('#your-tool-name').innerText();
    for (const tool of chosen) assert.ok(header.includes(tool.label), `the header names ${tool.label}: ${header}`);
    await page.locator('#your-tool-trigger').click();
    assert.equal(await page.locator('#your-tool-list').getAttribute('role'), 'group');
    assert.equal(await page.locator('#your-tool-list [role="radio"]').count(), 0, 'never a single choice');
    assert.equal(await page.locator('#your-tool-list [role="checkbox"][aria-checked="true"]').count(), chosen.length);
    await page.keyboard.press('Escape');

    // Superpowers: with the old single Codex choice, every one of its Adds was disabled.
    await chooseCatalogFamily(page, 'Superpowers');
    await page.waitForFunction(() => document.querySelectorAll('[data-card-id] .card-action button').length > 0
      && !/loading/i.test(document.querySelector('[data-card-id] .browse-facts')?.textContent ?? 'loading'));
    const browse = answers.browse.at(-1);
    const observed = chosen.filter(tool => tool.observed);
    assert.deepEqual(browse.tools.map(tool => tool.id).sort(), observed.map(tool => tool.id).sort(), 'fit is judged in every chosen tool Core has observed');
    assert.deepEqual(browse.refusedTools.map(tool => tool.id).sort(), chosen.filter(tool => !tool.observed).map(tool => tool.id).sort());
    const rail = await page.locator('#framework-navigation [data-tools]').innerText();
    for (const tool of chosen) assert.ok(rail.includes(tool.label), `the rail names ${tool.label}: ${rail}`);
    const adds = page.locator('[data-card-id] .card-action button:not([disabled])').filter({ hasText: /^Add$/ });
    const addable = await adds.count(), disabled = await page.locator('[data-card-id] .card-action button[disabled]').count();
    assert.ok(addable > 0, 'items are addable');
    assert.equal(disabled, 0, 'no card is left with a disabled Add');

    // Enterprise: the organization policy's state, once, in the contract's words, with what to do.
    const note = page.locator('#organization-policy-note');
    await note.waitFor();
    assert.equal(await note.getAttribute('data-policy-state'), 'not-configured');
    const noteText = await note.innerText();
    assert.match(noteText, /No organization authority source is configured by the host\./);
    assert.ok(noteText.includes(OWNER_SETTINGS.organization.policyRepo), noteText);
    assert.match(noteText, /AIH_ORGANIZATION_SOURCE/);
    assert.match(noteText, /As an admin you can still add and install content/);

    // Add the first card: Core composes it for each observed tool that takes it.
    const first = adds.first(), itemId = (await first.getAttribute('aria-label')).replace(/^Add /, '');
    const fits = browse.fit.find(entry => entry.itemId === itemId).tools.filter(tool => tool.fits).map(tool => tool.tool);
    assert.ok(fits.length > 1, `${itemId} fits several of the chosen tools: ${fits.join(', ')}`);
    const card = page.locator(`[data-card-id] .card-action button[aria-label$=" ${itemId}"]`);
    await first.click();
    await page.waitForFunction(id => [...document.querySelectorAll('[data-card-id] .card-action button')].some(button => button.getAttribute('aria-label') === `Remove ${id}`), itemId)
      .catch(async error => { await page.screenshot({ path: join(output, `your-tools-add-failed-${theme}.png`) }); throw new Error(`${error.message}\n${JSON.stringify(answers.edits.at(-1)?.diagnostics ?? answers.edits.at(-1)?.status ?? 'no edit answer')}`); });
    const added = answers.edits.at(-1);
    assert.equal(added.status, 'ok', JSON.stringify(added.diagnostics ?? []));
    const tools = added.value.policy.selections.filter(selection => selection.item?.itemId === itemId).map(selection => selection.tool).sort();
    // Tools that share a project location (Codex CLI and Antigravity CLI both read .agents) get the one installation.
    assert.ok(tools.length > 1 && tools.every(value => fits.includes(value)), `one Add goes to the chosen tools Core renders it for: ${tools.join(', ')} of ${fits.join(', ')}`);
    assert.equal(await card.innerText(), 'Remove');
    await page.screenshot({ path: join(output, `your-tools-added-${theme}.png`) });

    // Install through Core; Core's inventory lists the item for each of those tools.
    await openPolicyDrawer(page);
    await page.locator('#install-button:not([disabled])').waitFor({ timeout: 180_000 })
      .catch(async error => { await page.screenshot({ path: join(output, `your-tools-install-failed-${theme}.png`) }); throw new Error(`${error.message}\n${await page.locator('#policy-review-panel').innerText()}`); });
    await page.locator('#install-button').click();
    await page.locator('#install-message[data-outcome]').waitFor({ timeout: 240_000 });
    assert.equal(await page.locator('#install-message').getAttribute('data-outcome'), 'installed', await page.locator('#install-message').innerText());
    await page.waitForFunction(() => document.querySelectorAll('#installed-list li').length > 0, undefined, { timeout: 120_000 });
    for (let attempt = 0; attempt < 100 && !answers.inventory?.selections?.some(selection => selection.item?.itemId === itemId); attempt++) await page.waitForTimeout(100);
    const installed = answers.inventory.selections.filter(selection => selection.item?.itemId === itemId).map(selection => selection.tool).sort();
    assert.deepEqual(installed, tools, 'Core installed it for each of those tools');
    const files = answers.inventory.selections.filter(selection => selection.item?.itemId === itemId).flatMap(selection => selection.members.map(member => member.path));
    assert.ok(files.length && files.every(path => existsSync(path) && path.startsWith(project)), 'every installed file is in the project');
    await page.screenshot({ path: join(output, `your-tools-installed-${theme}.png`) });
    assert.deepEqual(errors, []);
    await writeFile(join(output, `your-tools-${theme}.json`), JSON.stringify({ chosen: chosen.map(tool => tool.id), judged: browse.tools.map(tool => tool.id),
      refused: browse.refusedTools, addable, itemId, addedFor: tools, installedFor: installed, files: files.length, policyNote: noteText }, null, 2));
    return { status: 'passed' };
  } finally { await browser.close(); }
}
