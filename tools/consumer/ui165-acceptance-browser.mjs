import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { addFromCatalog, chooseCatalogFamily, closePolicyDrawer, openPolicyDrawer, openPolicyFileActions } from './policy-drawer.mjs';
import { openPolicyWorkspace, openSetupAdvanced } from './advanced-browser.mjs';

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
export async function runFirstRunBrowser({ origin, output, playwrightModule, theme = 'dark' }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const { context, page } = await openPage(browser, origin, { theme, tool: true });
    page.on('pageerror', error => errors.push(error.message));
    await chooseCatalogFamily(page, 'Extensions');
    await page.locator('#starting-sets .more-sets > summary').click();
    const toggle = page.locator('#starting-sets [data-set-id="engineering"]');
    if (!await toggle.count()) {
      await writeFile(join(output, 'incomplete.json'), JSON.stringify({ status: 'incomplete', reason: 'The checked Extensions release in this consumer does not offer the engineering set; the positive firstRun case needs that public set.' }, null, 2));
      return { status: 'incomplete', reason: 'engineering set not offered' };
    }
    // The checked release pre-ticks engineering by default; clicking would toggle it OFF. Press it only when
    // it is not already pressed, so the draft records the set whatever the published default is.
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
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
export async function runRestartInstallBrowser({ origin, output, playwrightModule, theme = 'dark', extraItem = undefined, extraName = undefined }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    // The Extensions grill-me add is per-client content and always needs the canonical tool; the optional
    // plain ECC item was chosen from positive public fit + resolution facts by the fixture.
    const { context, page } = await openPage(browser, origin, { theme, tool: true });
    await chooseCatalogFamily(page, 'Extensions');
    await addFromCatalog(page, 'extensions.matt.grill-me');
    if (extraItem) { await chooseCatalogFamily(page, 'ECC'); await addFromCatalog(page, extraItem); }
    // Save the real artifact through the ordinary drawer download.
    await page.locator('#your-setup').click();
    await openSetupAdvanced(page);
    const download = page.waitForEvent('download');
    await page.locator('#policy-save').click();
    const savedPath = join(output, `mixed-${theme}-saved.json`);
    await (await download).saveAs(savedPath);
    await closePolicyDrawer(page);
    // A FRESH browser context reopens and validates the exact saved choices - the mixed saved/reopen half of
    // the accepted criterion, independent of the later fresh-PROCESS inventory proof.
    const { context: context2, page: reopened } = await openPage(browser, origin, { theme, tool: true });
    assert.equal(await reopened.evaluate(() => document.documentElement.dataset.mode), theme, 'The reopened mixed review uses the requested theme.');
    await openPolicyWorkspace(reopened); await openPolicyFileActions(reopened);
    await reopened.locator('#policy-open').setInputFiles(savedPath);
    await reopened.getByRole('button', { name: 'Validate and reopen', exact: true }).click();
    await reopened.locator('#policy-status').filter({ hasText: 'Saved choices recovered' }).waitFor();
    const choices = await reopened.locator('#setup-choices').innerText();
    assert.match(choices, /grill-me/, 'Extensions is still chosen after the exact reopen');
    if (extraItem) assert.ok(choices.includes(extraName ?? extraItem), 'the ECC item is still chosen after the exact reopen');
    // Named prepared-1.6 rows for both families, before any Apply.
    await openPolicyDrawer(reopened);
    await reopened.locator('#install-button:not([disabled])').waitFor({ timeout: 120_000 });
    await reopened.locator('#install-details > summary').click();
    const rows = await reopened.locator('#install-review-rows').innerText();
    assert.match(rows, /grill-me/, 'named Extensions review row');
    assert.match(rows, /Chosen by you/, 'recorded origins shown');
    if (extraItem) assert.ok(rows.includes(extraName ?? extraItem), 'named ECC review row');
    // Apply: the strict checked result.
    await reopened.locator('#install-button').click();
    await reopened.locator('#install-message[data-outcome="installed"]').waitFor({ timeout: 120_000 });
    assert.match(await reopened.locator('#install-message').innerText(), /Confirmed on disk/);
    await context2.close(); await context.close();
    return { status: 'passed' };
  } finally { await browser.close(); }
}

// (2b) Verify phase after the OWNED SERVER PROCESS was stopped and started again on the same target: no policy
// opened, no draft — the inventory must come from Core's on-disk receipts alone.
export async function runRestartVerifyBrowser({ origin, output, playwrightModule, theme = 'dark', project = undefined, extraItem = undefined, extraName = undefined }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const { context, page } = await openPage(browser, origin, { theme });
    page.on('pageerror', error => errors.push(error.message));
    await openPolicyDrawer(page);
    // Without a draft, recorded selections use the ungrouped inventory rows. The section heading is
    // shown only when chosen groups precede those rows; require the actual names and recorded ids instead.
    const list = page.locator('#installed-list');
    await list.waitFor();
    const recorded = name => list.locator('[data-installed-other]').filter({ has: page.getByText(name, { exact: true }) });
    const installed = recorded('grill-me');
    await installed.waitFor();
    assert.equal(await installed.count(), 1, 'one recorded Extensions row survives the fresh host');
    assert.ok(await installed.getAttribute('data-installed-other'), 'the Extensions row retains its recorded management id');
    assert.match(await installed.innerText(), /Not in your setup/, 'recorded inventory is independent of an open draft');
    assert.equal(await list.locator('[data-installed-item]').count(), 0, 'no draft-derived chosen groups are invented');
    if (extraItem) {
      const mixed = recorded(extraName ?? extraItem);
      await mixed.waitFor();
      assert.equal(await mixed.count(), 1, 'one recorded ECC row survives the fresh host');
      assert.ok(await mixed.getAttribute('data-installed-other'), 'the ECC row retains its recorded management id');
      assert.match(await mixed.innerText(), /Not in your setup/);
    }
    assert.equal(await page.locator('[data-installed-state]').count(), 0, 'a fresh complete install carries no adverse state chips');
    if (project) {
      // Adverse state, truthfully produced: edit an installed file on disk; Core's redacted projection must
      // report it and the page renders its changed-since-install state with icon, tooltip and wording.
      const { appendFile } = await import('node:fs/promises');
      await appendFile(join(project, '.claude', 'skills', 'grill-me', 'SKILL.md'), '\n# edited outside the Workbench\n');
      await closePolicyDrawer(page); await openPolicyDrawer(page);
      const changed = page.locator('[data-installed-state="changed"]');
      await changed.waitFor();
      assert.match(await changed.innerText(), /Changed since install/);
      assert.ok(await changed.getAttribute('title') ?? await changed.locator('[title]').first().getAttribute('title'), 'the state chip carries its explanation');
      await page.screenshot({ path: join(output, `adverse-changed-${theme}.png`), fullPage: true });
    }
    await page.screenshot({ path: join(output, 'restart-inventory.png'), fullPage: true });
    await writeFile(join(output, 'restart-evidence.json'), JSON.stringify({ status: 'passed', errors }, null, 2));
    await context.close();
    return { status: 'passed' };
  } finally { assert.deepEqual(errors, []); await browser.close(); }
}

// (3a) Strict failed Apply: a real filesystem obstacle at the registration target makes Core fail honestly; the
// page must not look installed and must name the failed members.
export async function runMcpFailedApplyBrowser({ origin, output, project, playwrightModule, theme = 'dark' }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const { context, page } = await openPage(browser, origin, { theme, tool: true });
    await chooseCatalogFamily(page, 'ECC');
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
    // Core refuses at PREPARE time - the directory obstacle makes the fresh preparation invalid
    // (INPUT_INVALID: the requested work cannot be admitted), so Apply never runs and no run outcome
    // exists. The truthful assertions are the refusal wording, no green, and no outcome dataset.
    await page.waitForFunction(() => /Install did not start/.test(document.getElementById('install-message').textContent), null, { timeout: 60_000 });
    const message = await page.locator('#install-message').innerText();
    assert.match(message, /Install did not start: .*admit the requested work/i, 'Core names the prepare-time refusal');
    assert.doesNotMatch(message, /Confirmed on disk/, 'the strict success claim never appears on a refusal');
    assert.equal(await page.locator('#install-message').getAttribute('data-outcome'), null, 'a refused preparation sets no run outcome');
    await page.screenshot({ path: join(output, 'mcp-failed-apply.png'), fullPage: true });
    await rm(join(project, '.mcp.json'), { recursive: true, force: true });
    await context.close();
    return { status: 'passed' };
  } finally { await rm(join(project, '.mcp.json'), { recursive: true, force: true }); await browser.close(); }
}

// (3b) Typed MCP-ticked real Apply: registration and the one-server approval land in the tool's own files,
// separated exactly as Core's recipe says; unticking removes only the approval.
export async function runMcpApplyBrowser({ origin, output, project, playwrightModule, theme = 'dark' }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const { context, page } = await openPage(browser, origin, { theme, tool: true });
    page.on('pageerror', error => errors.push(error.message));
    await chooseCatalogFamily(page, 'ECC');
    await page.locator('#catalog-search').fill('cloudflare-docs');
    const card = page.locator('[data-card-id$="/ecc.mcp.cloudflare-docs"]');
    if (!await card.count()) {
      await writeFile(join(output, 'incomplete.json'), JSON.stringify({ status: 'incomplete', reason: 'The integrated consumer catalog carries no checked ECC MCP item, so the typed MCP Apply case cannot run in this seam.' }, null, 2));
      return { status: 'incomplete', reason: 'ECC MCP item not in integrated catalog' };
    }
    const approval = card.locator('.browse-mcp-approval');
    // The one-server approval edit requires the server to be part of the setup: Add first, then tick.
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
    await closePolicyDrawer(page);
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

// UI165-AC06 at the owning execution seam: the advanced flow holds a prepared session; changing a reviewed
// file on disk makes Core itself refuse the held Apply with REVIEW_STALE; the page shows Core's reason and
// requires fresh preparation (Prepare again, then Apply succeeds). No Workbench stale rule is involved, and
// the Install panel's own fresh-prepare flow is unaffected.
export async function runStaleReviewBrowser({ origin, output, project, playwrightModule, theme = 'dark' }) {
  const { chromium } = await import(playwrightModule);
  const { readFile, writeFile } = await import('node:fs/promises');
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const { context, page } = await openPage(browser, origin, { theme, tool: true });
    page.on('pageerror', error => errors.push(error.message));
    await chooseCatalogFamily(page, 'Extensions');
    await addFromCatalog(page, 'extensions.matt.grill-me');
    // The execution controls live in the inner 'Sources and execution' disclosure; open that section or the
    // closed details renders nothing and the Prepare control is absent.
    await openSetupAdvanced(page, 'Sources and execution');
    const advanced = page.locator('details.policy-advanced').filter({ hasText: 'Prepare exact effects' });
    const advancedText = () => { const panel = [...document.querySelectorAll('details.policy-advanced')].find(node => node.textContent.includes('Prepare exact effects')); return panel ? panel.textContent : ''; };
    await advanced.getByRole('button', { name: 'Prepare exact effects', exact: true }).click();
    await page.waitForFunction(() => { const t = document.querySelectorAll('details.policy-advanced'); const panel = [...t].find(node => node.textContent.includes('Prepare exact effects')); return panel && panel.textContent.includes('Prepared effects are ready for review'); }, null, { timeout: 120_000 });
    // The reviewed material changes while the preparation is held (fresh target: create the parent first).
    const target = join(project, '.claude', 'skills', 'grill-me', 'SKILL.md');
    await mkdir(join(project, '.claude', 'skills', 'grill-me'), { recursive: true });
    await writeFile(target, '# Tampered after prepare\n', { encoding: 'utf8' });
    await advanced.getByRole('button', { name: 'Approve and Apply reviewed effects', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('details.policy-advanced')].some(node => node.textContent.includes('Prepare exact effects') && node.textContent.includes('REVIEW_STALE')), null, { timeout: 120_000 });
    const shown = await advanced.innerText();
    assert.match(shown, /REVIEW_STALE/, 'Core\'s own stale diagnostic is shown, not a UI rule');
    assert.match(await readFile(target, 'utf8'), /Tampered after prepare/, 'the refused Apply changed nothing on disk');
    // Fresh preparation is required. Core detects the tampered on-disk file at PREPARE time - the honest
    // answer is partial with STATE_CONFLICT and Apply stays disabled - so the person first resolves the
    // conflict (removes the unreviewed file), then prepares again: ready, Apply completes, bytes replaced.
    await advanced.getByRole('button', { name: 'Prepare exact effects', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('details.policy-advanced')].some(node => node.textContent.includes('Prepare exact effects') && /STATE_CONFLICT/.test(node.textContent)), null, { timeout: 60_000 });
    const conflict = await advanced.innerText();
    assert.match(conflict, /STATE_CONFLICT/, 'Core names the on-disk conflict at prepare time');
    assert.equal(await advanced.getByRole('button', { name: 'Approve and Apply reviewed effects', exact: true }).isDisabled(), true, 'Apply stays disabled while the conflict is unresolved');
    const { rm } = await import('node:fs/promises');
    await rm(join(project, '.claude', 'skills', 'grill-me', 'SKILL.md'), { force: true });
    await advanced.getByRole('button', { name: 'Prepare exact effects', exact: true }).click();
    await page.waitForFunction(() => { const t = document.querySelectorAll('details.policy-advanced'); const panel = [...t].find(node => node.textContent.includes('Prepare exact effects')); return panel && panel.textContent.includes('Prepared effects are ready for review'); }, null, { timeout: 120_000 });
    await advanced.getByRole('button', { name: 'Approve and Apply reviewed effects', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('details.policy-advanced')].some(node => node.textContent.includes('Prepare exact effects') && node.textContent.includes('"completion": "complete"')), null, { timeout: 120_000 });
    assert.doesNotMatch(await readFile(target, 'utf8'), /Tampered after prepare/, 'the fresh, current-disk preparation replaced the tampered file');
    await page.screenshot({ path: join(output, `stale-${theme}.png`), fullPage: true });
    await writeFile(join(output, `stale-evidence-${theme}.json`), JSON.stringify({ status: 'passed', reason: shown.slice(0, 400), errors }, null, 2));
    await context.close();
    return { status: 'passed' };
  } finally { assert.deepEqual(errors, []); await browser.close(); }
}
