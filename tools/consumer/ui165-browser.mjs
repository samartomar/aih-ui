import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openPolicyAdvanced, closePolicyDrawer } from './policy-drawer.mjs';

// UI165 ordinary page cases on the real browse fixture (project-basics + extensions + the actual checked ECC
// release). The MCP server is the real ecc.mcp.cloudflare-docs item; the tool is the header's canonical
// claude choice. No project folder is chosen in this seam, so the duplicate check truthfully says it could
// not check — that unavailable wording is the assertion, never a clean state.

async function enter(page, origin, theme) {
  await page.goto(origin + '/');
  await page.locator('#framework-navigation [data-framework]').first().waitFor();
  if (await page.locator('#setup-dialog').isVisible()) {
    await page.getByRole('radio', { name: /Vibe coder/ }).check();
    for (let index = 0; index < 4; index++) await page.locator('#setup-next').click();
    await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
  }
  const toggle = page.getByRole('button', { name: `Switch to ${theme} mode`, exact: true });
  if (await toggle.count()) await toggle.click();
  await page.waitForFunction(() => document.getElementById('framework-guidance').textContent.includes('Choose content'));
}
async function framework(page, value) {
  await page.locator(`[data-framework="internal:${value.framework.id}:${value.sha256}"]`).click();
  await page.waitForFunction(name => document.querySelector('.wb-source-heading').textContent === name, value.framework.name);
}
async function save(page, path) {
  if (await page.locator('#added-notice-dismiss').isVisible()) await page.locator('#added-notice-dismiss').click();
  await page.locator('#your-setup').click(); await openPolicyAdvanced(page);
  const pending = page.waitForEvent('download'); await page.locator('#policy-save').click();
  await (await pending).saveAs(path); await closePolicyDrawer(page);
  return JSON.parse(await readFile(path, 'utf8'));
}

const selectionOf = (policy, itemId) => (policy.selections ?? []).find(selection => selection.item?.itemId === itemId ?? selection.id);

export async function runUi165Browser({ origin, output, expected, playwrightModule }) {
  await mkdir(output, { recursive: true });
  const { chromium } = await import(playwrightModule);
  const browser = await chromium.launch({ headless: true });
  const errors = [], outcomes = [];
  try {
    for (const theme of ['dark', 'light']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
      await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude'));
      const page = await context.newPage(); page.setDefaultTimeout(30_000);
      page.on('pageerror', error => errors.push(error.message));
      await enter(page, origin, theme);
      await framework(page, expected.ecc);

      // --- The one-server MCP approval on the real checked server -------------------------------
      const card = page.locator(`[data-card-id="${expected.ecc.sha256}/${expected.ecc.mcp.id}"]`);
      if (!await card.count()) { await page.locator('#browse-all-items').check(); await card.waitFor(); }
      const approval = card.locator('.browse-mcp-approval');
      await approval.waitFor();
      assert.equal(await approval.getAttribute('data-mcp-approval'), 'offered', 'claude’s approval shape is writable');
      assert.match(await approval.innerText(), /Still needs your OK in Claude Code/, 'needs-OK wording from Harness compatibility');
      const box = approval.locator('input[type=checkbox]');
      assert.equal(await box.isChecked(), false, 'the one-server tick is off by default');
      await card.getByRole('button', { name: `Add ${expected.ecc.mcp.id}`, exact: true }).click();
      await card.getByRole('button', { name: `Remove ${expected.ecc.mcp.id}`, exact: true }).waitFor();
      await box.check();
      await page.waitForFunction(() => { const input = document.querySelector('.browse-mcp-approval input'); return Boolean(input) && !input.disabled; });
      const ticked = await save(page, join(output, `${theme}-mcp-ticked.json`));
      const tickedSelection = (ticked.selections ?? []).find(selection => selection.item?.itemId === expected.ecc.mcp.id);
      assert.ok(tickedSelection, 'the server is a named selection in the saved policy');
      assert.equal(tickedSelection.recipe?.inline?.schema, 'urn:aihq:core:recipe:1.4.0', 'the ticked recipe is the renderer-produced 1.4 recipe');
      assert.ok(tickedSelection.recipe.inline.operations.some(operation => operation.id === 'approve-server'), 'exactly Core’s one approval operation is proposed');
      assert.ok(tickedSelection.recipe.inline.operations.some(operation => operation.id === 'register-server' || operation.kind === 'config.entries'), 'registration is retained alongside');
      await box.uncheck();
      await page.waitForFunction(() => { const input = document.querySelector('.browse-mcp-approval input'); return Boolean(input) && !input.disabled; });
      const unticked = await save(page, join(output, `${theme}-mcp-unticked.json`));
      const untickedSelection = (unticked.selections ?? []).find(selection => selection.item?.itemId === expected.ecc.mcp.id);
      assert.ok(!JSON.stringify(untickedSelection?.recipe ?? {}).includes('approve-server'), 'untick removes only the proposed approval');
      // The opt-in never becomes browser state: the only stored key is the header’s own tool choice.
      const stored = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
      assert.deepEqual(stored.session, [], 'nothing is written to session storage');
      assert.ok(stored.local.every(key => /^wb-/.test(key)), 'only ordinary Workbench UI keys exist in local storage');

      // --- Duplicate facts: unavailable is said, never a clean state ----------------------------
      // No project folder is chosen in this seam, so Core’s host inspection cannot run.
      const copiesLine = await page.locator('#setup-choices-host-copies').textContent();
      assert.match(copiesLine, /Couldn't check whether your tool already has your chosen content/, 'the drawer says the duplicate check could not run');
      await card.click();
      await page.locator('#inspector-browse-facts').waitFor();
      assert.match(await page.locator('#inspector-browse-facts').innerText(), /Also seen by your tool/);
      assert.match(await page.locator('#inspector-browse-facts').innerText(), /Couldn't check/, 'the inspector says the same, never implying no second copy');
      await page.screenshot({ path: join(output, `${theme}-mcp-inspector.png`), animations: 'disabled' });
      await page.locator('#close-inspector-btn').click();
      outcomes.push({ theme, mcp: tickedSelection.recipe.inline.schema, storedKeys: stored.local.length });
      await context.close();
    }
    assert.deepEqual(errors, []);
    await writeFile(join(output, 'ui165-evidence.json'), JSON.stringify({ status: 'passed', outcomes, errors }, null, 2));
    console.log(`UI165 ordinary page cases passed: ${output}`);
    return { status: 'passed' };
  } catch (error) {
    await writeFile(join(output, 'failure.json'), JSON.stringify({ error: error.message, errors }, null, 2)).catch(() => {});
    throw error;
  } finally { await browser.close(); }
}
