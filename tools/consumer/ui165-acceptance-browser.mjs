import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { addFromCatalog, chooseCatalogFamily, openPolicyDrawer } from './policy-drawer.mjs';
import { openSetupAdvanced } from './advanced-browser.mjs';

// UI165 acceptance cases on the disposable-target seams. Everything mutates through the running page's ordinary
// reviewed Core path against real packed packages; outcomes a public fixture cannot truthfully produce are
// reported 'incomplete' with the concrete reason, never silently skipped.

async function openPage(browser, origin, { theme = 'dark', tool = false } = {}) {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  if (tool) await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude'));
  const page = await context.newPage(); page.setDefaultTimeout(30_000);
  await page.goto(origin + '/');
  await page.locator('#browse-family option[value="Extensions"]').waitFor({ state: 'attached' });
  if (await page.locator('#setup-dialog').isVisible()) {
    await page.getByRole('radio', { name: /Vibe coder/ }).check();
    for (let step = 0; step < 4; step++) await page.locator('#setup-next').click();
    await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
  }
  const destination = theme === 'light' ? 'Switch to light mode' : 'Switch to dark mode';
  if (await page.getByRole('button', { name: destination, exact: true }).count()) await page.getByRole('button', { name: destination, exact: true }).click();
  return { context, page };
}

// (1) Positive set-owned firstRun: the real checked Extensions 'engineering' set declares
// extensions.matt.setup-matt-pocock-skills as its first step. Choosing the set (not the item directly) is what
// records the in-set origin the guidance resolves from.
export async function runFirstRunBrowser({ origin, output, playwrightModule }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const { context, page } = await openPage(browser, origin, { tool: true });
    page.on('pageerror', error => errors.push(error.message));
    await chooseCatalogFamily(page, 'Extensions');
    await page.locator('#starting-sets .more-sets > summary').click();
    const toggle = page.locator('#starting-sets [data-set-id="engineering"]');
    if (!await toggle.count()) {
      await writeFile(join(output, 'incomplete.json'), JSON.stringify({ status: 'incomplete', reason: 'The checked Extensions release in this consumer does not offer the engineering set; the positive firstRun case needs that public set.' }, null, 2));
      return { status: 'incomplete', reason: 'engineering set not offered' };
    }
    await toggle.click();
    const added = page.waitForResponse(response => /authoring-(?:draft-edit|edit)$/.test(response.url()));
    await page.locator('[data-add-sets]').click();
    const result = await (await added).json();
    if (result.status !== 'ok') {
      await writeFile(join(output, 'refusal.json'), JSON.stringify(result, null, 2));
      return { status: 'incomplete', reason: `engineering set resolution refused: ${(result.diagnostics ?? []).map(value => value.message ?? value.code).join(' ')}` };
    }
    await page.waitForFunction(() => document.getElementById('framework-guidance').textContent.includes('Chosen sets added'));
    await openPolicyDrawer(page);
    await page.locator('#install-button:not([disabled])').waitFor();
    await page.locator('#install-button').click();
    await page.locator('#install-message[data-outcome="installed"]').waitFor({ timeout: 120_000 });
    const line = await page.locator('#install-first-run').textContent();
    assert.match(line, /First step: setup-matt-pocock-skills \(skill\)/, 'the set’s declared first step is shown after the install');
    assert.match(line, /It does not run by itself/, 'guidance only, never an execution');
    await page.screenshot({ path: join(output, 'first-run.png'), fullPage: true });
    const evidence = { status: 'passed', line, errors };
    await writeFile(join(output, 'first-run-evidence.json'), JSON.stringify(evidence, null, 2));
    await context.close();
    return { status: 'passed' };
  } finally { assert.deepEqual(errors, []); await browser.close(); }
}

// (2a) Install phase for the server-restart inventory case: a real Apply into a fresh disposable target.
export async function runRestartInstallBrowser({ origin, output, playwrightModule }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const { context, page } = await openPage(browser, origin, {});
    await addFromCatalog(page, 'extensions.matt.grill-me'); await openPolicyDrawer(page);
    await page.locator('#install-button:not([disabled])').waitFor();
    await page.locator('#install-button').click();
    await page.locator('#install-message[data-outcome="installed"]').waitFor({ timeout: 120_000 });
    await page.locator('[data-installed-item="extensions.matt.grill-me"]').waitFor();
    await context.close();
    return { status: 'passed' };
  } finally { await browser.close(); }
}

// (2b) Verify phase after the OWNED SERVER PROCESS was stopped and started again on the same target: no policy
// opened, no draft — the inventory must come from Core's on-disk receipts alone.
export async function runRestartVerifyBrowser({ origin, output, playwrightModule }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const { context, page } = await openPage(browser, origin, {});
    page.on('pageerror', error => errors.push(error.message));
    await openPolicyDrawer(page);
    const installed = page.locator('[data-installed-item="extensions.matt.grill-me"]');
    await installed.waitFor();
    assert.match(await installed.innerText(), /it needs:.*grilling/, 'recorded names and the needed-by grouping survive a full server restart with no draft');
    assert.equal(await page.locator('[data-installed-state]').count(), 0, 'a fresh complete install carries no adverse state chips');
    await page.screenshot({ path: join(output, 'restart-inventory.png'), fullPage: true });
    await writeFile(join(output, 'restart-evidence.json'), JSON.stringify({ status: 'passed', errors }, null, 2));
    await context.close();
    return { status: 'passed' };
  } finally { assert.deepEqual(errors, []); await browser.close(); }
}

// (3a) Strict failed Apply: a real filesystem obstacle at the registration target makes Core fail honestly; the
// page must not look installed and must name the failed members.
export async function runMcpFailedApplyBrowser({ origin, output, project, playwrightModule }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const { context, page } = await openPage(browser, origin, { tool: true });
    await page.locator('#catalog-search').fill('cloudflare-docs');
    const card = page.locator('[data-card-id$="/ecc.mcp.cloudflare-docs"]');
    if (!await card.count()) {
      await writeFile(join(output, 'incomplete.json'), JSON.stringify({ status: 'incomplete', reason: 'The integrated consumer catalog carries no checked ECC MCP item, so the typed MCP Apply case cannot run in this seam.' }, null, 2));
      return { status: 'incomplete', reason: 'ECC MCP item not in integrated catalog' };
    }
    await addFromCatalog(page, 'ecc.mcp.cloudflare-docs');
    await openPolicyDrawer(page);
    await page.locator('#install-button:not([disabled])').waitFor();
    // The obstacle: the registration file's path exists as a directory, so Core's write genuinely fails.
    await mkdir(join(project, '.mcp.json'), { recursive: true });
    await page.locator('#install-button').click();
    await page.waitForFunction(() => document.getElementById('install-message').dataset.outcome && document.getElementById('install-message').dataset.outcome !== 'installed', null, { timeout: 120_000 });
    const message = await page.locator('#install-message').innerText();
    assert.match(message, /not confirmed on disk/, 'a failed run is never green');
    assert.doesNotMatch(message, /Confirmed on disk/, 'the strict success claim never appears on a failure');
    assert.ok(['failed', 'partial'].includes(await page.locator('#install-message').getAttribute('data-outcome')), 'an incomplete run is failed or partial, never installed');
    await page.screenshot({ path: join(output, 'mcp-failed-apply.png'), fullPage: true });
    await rm(join(project, '.mcp.json'), { recursive: true, force: true });
    await context.close();
    return { status: 'passed' };
  } finally { await rm(join(project, '.mcp.json'), { recursive: true, force: true }); await browser.close(); }
}

// (3b) Typed MCP-ticked real Apply: registration and the one-server approval land in the tool's own files,
// separated exactly as Core's recipe says; unticking removes only the approval.
export async function runMcpApplyBrowser({ origin, output, project, playwrightModule }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const { context, page } = await openPage(browser, origin, { tool: true });
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('#catalog-search').fill('cloudflare-docs');
    const card = page.locator('[data-card-id$="/ecc.mcp.cloudflare-docs"]');
    if (!await card.count()) {
      await writeFile(join(output, 'incomplete.json'), JSON.stringify({ status: 'incomplete', reason: 'The integrated consumer catalog carries no checked ECC MCP item, so the typed MCP Apply case cannot run in this seam.' }, null, 2));
      return { status: 'incomplete', reason: 'ECC MCP item not in integrated catalog' };
    }
    const approval = card.locator('.browse-mcp-approval');
    await addFromCatalog(page, 'ecc.mcp.cloudflare-docs');
    await approval.locator('input[type=checkbox]').check();
    await page.waitForFunction(() => { const input = document.querySelector('.browse-mcp-approval input'); return Boolean(input) && !input.disabled; });
    await openPolicyDrawer(page);
    await page.locator('#install-button:not([disabled])').waitFor();
    await page.locator('#install-button').click();
    await page.locator('#install-message[data-outcome="installed"]').waitFor({ timeout: 120_000 });
    // On-disk separation: registration in .mcp.json; the one approval in the tool's local settings, exactly one server.
    const registered = JSON.parse(await readFile(join(project, '.mcp.json'), 'utf8'));
    assert.ok(registered.mcpServers?.['cloudflare-docs'], 'the server is registered for the tool');
    const settings = JSON.parse(await readFile(join(project, '.claude', 'settings.local.json'), 'utf8'));
    assert.deepEqual(settings.enabledMcpjsonServers, ['cloudflare-docs'], 'exactly the one ticked server is approved');
    // Untick removes only the proposed approval from the review; registration stands in the saved policy view.
    await page.locator('[data-card-id$="/ecc.mcp.cloudflare-docs"] .browse-mcp-approval input[type=checkbox]').uncheck();
    await page.waitForFunction(() => { const input = document.querySelector('.browse-mcp-approval input'); return Boolean(input) && !input.disabled; });
    const download = page.waitForEvent('download'); await openSetupAdvanced(page); await page.locator('#policy-save').click();
    const saved = join(output, 'mcp-unticked-policy.json'); await (await download).saveAs(saved);
    const policy = JSON.parse(await readFile(saved, 'utf8'));
    const selection = (policy.selections ?? []).find(candidate => candidate.item?.itemId === 'ecc.mcp.cloudflare-docs');
    assert.ok(selection, 'the server remains a named selection');
    assert.ok(!JSON.stringify(selection.recipe ?? {}).includes('approve-server'), 'untick removed only the approval operation');
    await page.screenshot({ path: join(output, 'mcp-apply.png'), fullPage: true });
    await writeFile(join(output, 'mcp-apply-evidence.json'), JSON.stringify({ status: 'passed', registered: Object.keys(registered.mcpServers), approved: settings.enabledMcpjsonServers, errors }, null, 2));
    await context.close();
    return { status: 'passed' };
  } finally { assert.deepEqual(errors, []); await browser.close(); }
}
