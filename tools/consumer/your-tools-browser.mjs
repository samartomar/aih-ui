// The owner's Gate A setup in a real browser: Enterprise, role admin, a remote policy repository the host does not read,
// all eleven AI clients chosen in setup, and an older single "Codex" choice in this browser. The page must list every
// chosen tool, judge content across all of them, show addable items, add one to each tool Core renders it for into an
// Enterprise policy, and say clearly that the organization policy was not read, what to do, and why Install waits. Expectations come from the
// page's own answers (Core's tool registry and Core's inventory), never from a list kept here.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
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
    // The setup names a GitHub policy repository, so the page asks once for its policy file and branch (nothing is read
    // here: this check makes no network request).
    assert.match(noteText, /Organization policy not read yet\. Name the policy file in samartomar\/test and its branch/);
    assert.equal(await page.locator('#organization-source-path').inputValue(), 'gosam.organization-policy.json');
    assert.equal(await page.locator('#organization-source-branch').inputValue(), 'main');

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
    // Every chosen tool it fits gets its own copy, also tools that share a project location (Codex CLI and Antigravity CLI
    // both read .agents): none is left out.
    assert.deepEqual(tools, [...fits].sort(), `one Add goes to each chosen tool Core renders it for: ${tools.join(', ')} of ${fits.join(', ')}`);
    assert.equal(await card.innerText(), 'Remove');
    await page.screenshot({ path: join(output, `your-tools-added-${theme}.png`) });

    // Install: an Enterprise policy with no readable organisation policy is not installed, and the drawer says why.
    await openPolicyDrawer(page);
    await page.waitForFunction(() => /Can.t install yet|organi[sz]ation/i.test(document.getElementById('install-message')?.textContent ?? '')
      || document.getElementById('install-button')?.disabled === false, undefined, { timeout: 180_000 });
    const installText = (await page.locator('#install-message').innerText().catch(() => '')).trim();
    const panel = (await page.locator('#policy-review-panel').innerText()).trim();
    assert.equal(added.value.policy.mode, 'enterprise', 'an Enterprise Admin\'s setup is an Enterprise policy');
    assert.equal(await page.locator('#install-button').isDisabled(), true, 'nothing installs without the organisation policy');
    assert.match(installText, /organization source/, `Install says why: ${installText}`);
    assert.ok(panel.length);
    await page.screenshot({ path: join(output, `your-tools-install-${theme}.png`) });
    assert.deepEqual(errors, []);
    await writeFile(join(output, `your-tools-${theme}.json`), JSON.stringify({ chosen: chosen.map(tool => tool.id), judged: browse.tools.map(tool => tool.id),
      refused: browse.refusedTools, addable, itemId, addedFor: tools, policyMode: added.value.policy.mode, policyNote: noteText, install: installText }, null, 2));
    return { status: 'passed' };
  } finally { await browser.close(); }
}

// E2: the owner's Enterprise Admin setup with a readable local organisation policy. Adding the Superpowers set must
// compose an Enterprise policy, the one the organisation governs (as an Enterprise Developer's does, N1), and every
// item it holds must install. Returns the composed policy, so a scouting run can learn what the organisation permits.
export async function runEnterpriseAdminBrowser({ origin, output, project, playwrightModule, theme = 'dark', install = true, organizationFile }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(); page.setDefaultTimeout(60_000);
    page.on('pageerror', error => errors.push(error.message));
    const held = { policy: undefined, inventory: undefined };
    page.on('response', async response => {
      const path = new URL(response.url()).pathname;
      const body = await response.json().catch(() => undefined);
      if (/\/api\/authoring-(new|edit)$/.test(path) && body?.status === 'ok' && Array.isArray(body.value?.policyBytes))
        held.policy = JSON.parse(new TextDecoder().decode(Uint8Array.from(body.value.policyBytes)));
      if (path === '/api/authoring-managed' && body?.selections) held.inventory = body;
    });
    await page.goto(origin + '/');
    await page.locator('#browse-family option[value="Superpowers"]').waitFor({ state: 'attached' });
    assert.equal(await page.locator('#setup-dialog').isVisible(), false, 'the saved setup opens the Workbench directly');
    const destination = theme === 'light' ? 'Switch to light mode' : 'Switch to dark mode';
    if (await page.getByRole('button', { name: destination, exact: true }).count()) await page.getByRole('button', { name: destination, exact: true }).first().click();
    await page.waitForFunction(() => document.getElementById('your-tool-trigger').dataset.yourTool === 'listed');
    await chooseCatalogFamily(page, 'Superpowers');
    // The organisation policy's state, in words, before anything is added.
    const note = page.locator('#organization-policy-note');
    await note.waitFor();
    assert.equal(await note.getAttribute('data-policy-state'), 'ok', await note.innerText());
    assert.ok((await note.innerText()).includes(organizationFile), await note.innerText());
    await page.locator('#starting-sets [data-add-sets]').click();
    await page.waitForFunction(() => document.getElementById('framework-guidance').textContent.includes('Chosen sets added'));
    for (let attempt = 0; attempt < 100 && !held.policy?.selections?.length; attempt++) await page.waitForTimeout(100);
    const policy = held.policy;
    assert.equal(policy?.mode, 'enterprise', 'an Enterprise Admin\'s setup is an Enterprise policy');
    if (!install) return { status: 'passed', policy };
    // Every selection carries the identity the organisation governs it by.
    assert.ok(policy.selections.every(selection => typeof selection.organizationSelectionId === 'string'), 'every selection is governed by the organisation');
    assert.equal(new Set(policy.selections.map(selection => selection.organizationSelectionId)).size, policy.selections.length);
    await openPolicyDrawer(page);
    await page.locator('#install-button:not([disabled])').waitFor({ timeout: 240_000 })
      .catch(async error => { await page.screenshot({ path: join(output, `enterprise-admin-install-failed-${theme}.png`) }); throw new Error(`${error.message}\n${await page.locator('#policy-review-panel').innerText()}`); });
    const authority = (await page.locator('#authority-source').textContent()).trim();
    assert.ok(authority.includes(`Policy from ${organizationFile}`), authority);
    await page.locator('#install-button').click();
    await page.locator('#install-message[data-outcome]').waitFor({ timeout: 300_000 });
    assert.equal(await page.locator('#install-message').getAttribute('data-outcome'), 'installed', await page.locator('#install-message').innerText());
    await page.waitForFunction(() => document.querySelectorAll('#installed-list li').length > 0, undefined, { timeout: 120_000 });
    for (let attempt = 0; attempt < 200 && (held.inventory?.selections?.length ?? 0) < policy.selections.length; attempt++) await page.waitForTimeout(100);
    const installed = held.inventory.selections.map(selection => selection.managementId).sort();
    assert.deepEqual(installed, policy.selections.map(selection => selection.managementId).sort(), 'every item of the Enterprise policy installed');
    await page.screenshot({ path: join(output, `enterprise-admin-installed-${theme}.png`) });
    assert.deepEqual(errors, []);
    assert.ok(new Set(policy.selections.map(selection => selection.tool)).size > 1, 'installed for several tools under the organisation');
    const facts = { policyMode: policy.mode, organizationGoverned: true, itemCount: installed.length, authority: authority.slice(0, 300),
      tools: [...new Set(policy.selections.map(selection => selection.tool))] };
    await writeFile(join(output, `enterprise-admin-${theme}.json`), JSON.stringify(facts, null, 2));
    return { status: 'passed', policy, facts };
  } finally { await browser.close(); }
}
