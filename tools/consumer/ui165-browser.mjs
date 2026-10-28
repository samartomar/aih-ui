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
      // #162-AC05 under the declared input path: the approval tick records only the renderer-produced
      // recipe; the selection stores no configuration and declared inputs stay value-less declarations,
      // so the sensitive server value has nothing to persist.
      assert.deepEqual(tickedSelection.configuration ?? {}, {}, 'the approval tick stores no input value on the selection');
      for (const [name, spec] of Object.entries(tickedSelection.recipe.inline.inputs ?? {}))
        assert.ok(!('value' in spec), `declared input ${name} stays a value-less declaration`);
      // The opt-in never becomes browser state beyond the owning bounded values, and every stored
      // value is inspected and decoded — never just its key name (#162-AC05: no input value in the
      // session, browser storage, saved intent or exports; #165-AC07: no secret anywhere).
      const stored = await page.evaluate(() => ({
        local: Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])),
        session: Object.fromEntries(Object.keys(sessionStorage).map(key => [key, sessionStorage.getItem(key)])),
      }));
      assert.deepEqual(Object.keys(stored.session).sort(), ['aih-ui-framework-context', 'aih-ui-sources-view', 'aih.workbench.accepted.v1'],
        'session storage holds exactly the owning bounded values: catalog view state, the recovery artifact and framework context');
      const savedView = JSON.parse(stored.session['aih-ui-sources-view']);
      assert.ok(Object.values(savedView).every(value => typeof value === 'string' || value === null), 'the catalog view state is bounded UI filters, never an input value');
      const savedContext = JSON.parse(stored.session['aih-ui-framework-context']);
      assert.deepEqual(Object.keys(savedContext).sort(), ['name', 'source'], 'the framework context is only the chosen source identity');
      const recovery = JSON.parse(stored.session['aih.workbench.accepted.v1']);
      assert.match(recovery.base64, /^[A-Za-z0-9+/]*={0,2}$/, 'the recovery artifact is bounded base64 bytes');
      const recoveredBytes = Buffer.from(recovery.base64, 'base64');
      assert.ok(recoveredBytes.length > 0 && recoveredBytes.length <= 2_000_000, 'the recovery artifact stays inside the public 2 MB bound');
      assert.deepEqual(JSON.parse(recoveredBytes.toString('utf8')), unticked,
        'the session recovery artifact is exactly the saved unticked policy and nothing else');
      assert.ok(Object.keys(stored.local).every(key => /^wb-/.test(key)), 'only ordinary Workbench UI keys exist in local storage');
      // No live host handle enters the saved intent or its export: no host origin and no
      // machine-local absolute path, only release-relative recipe custody.
      const exported = JSON.stringify(unticked);
      assert.ok(!exported.includes('127.0.0.1'), 'no live host origin enters the saved intent');
      const custodyPaths = [untickedSelection.recipe?.reference, ...(untickedSelection.recipe?.reference?.materials ?? [])]
        .filter(Boolean).map(entry => entry.path ?? '');
      assert.ok(custodyPaths.every(path => typeof path === 'string' && !path.startsWith('/')), 'recipe custody stays release-relative, never a machine-local handle');

      // --- Unsupported approval shape: the public codex binding declares approvalLocation 'other';
      // Core cannot write it, so the card says to approve in the tool and offers no tick (#162-AC03).
      await page.locator('#your-tool-trigger').click();
      await page.locator('[data-tool="codex"]').click();
      const codexCard = page.locator(`[data-card-id="${expected.ecc.sha256}/${expected.ecc.mcp.id}"]`);
      const inTool = codexCard.locator('.browse-mcp-approval[data-mcp-approval="in-tool"]');
      await inTool.waitFor({ timeout: 30_000 });
      assert.match(await inTool.innerText(), /Approve in .* instead/, 'the person is sent to the tool');
      assert.match(await inTool.innerText(), /Approve the project MCP server/, 'its permission step is still shown as the requirements');
      assert.equal(await inTool.locator('input[type=checkbox]').isDisabled(), true, 'no tick exists for a shape Core cannot write');

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

      // --- Positive duplicate warning: a real second copy one folder above the granted project, observed
      // through public inspectToolHost (#163-AC01). Only the copilot binding declares ancestor-folder reads,
      // so the header switches to it; saved selections keep their recorded tool identity (no rebind).
      await page.locator('#your-tool-trigger').click();
      await page.locator('[data-tool="claude"]').click();
      await framework(page, expected.additional);
      const grill = expected.additional.grill;
      const grillCard = page.locator(`[data-card-id="${expected.additional.sha256}/${grill.id}"]`);
      if (!(await grillCard.count())) { await page.locator('#browse-all-items').check(); await grillCard.waitFor(); }
      await grillCard.getByRole('button', { name: `Add ${grill.id}`, exact: true }).click();
      await grillCard.getByRole('button', { name: `Remove ${grill.id}`, exact: true }).waitFor();
      // A nested disposable target: the granted project is inner/; the second copy sits one level up where
      // copilot's public binding (.github/skills, ancestor reads) observes it. No real home is touched.
      const nested = join(output, `${theme}-duplicate-target`);
      const inner = join(nested, 'outer', 'inner');
      await mkdir(join(nested, 'outer', '.github', 'skills', expected.additional.grillDirName), { recursive: true });
      await writeFile(join(nested, 'outer', '.github', 'skills', expected.additional.grillDirName, 'SKILL.md'), '# A second copy outside the project\n');
      await mkdir(inner, { recursive: true });
      await page.locator('#your-setup').click();
      await page.locator('#project-folder-change').click();
      await page.locator('#project-folder-input').fill(inner);
      await page.locator('#project-folder-use').click();
      await page.locator('#project-folder-message').filter({ hasNotText: /^Checking the folder…$/ }).waitFor();
      await closePolicyDrawer(page);
      // The tool switch re-browses with the folder set, so the real inspection runs for the chosen items.
      await page.locator('#your-tool-trigger').click();
      await page.locator('[data-tool="copilot"]').click();
      await framework(page, expected.additional);
      await page.locator('#your-setup').click();
      await page.waitForFunction(() => /Second copy|Couldn't check/.test(document.getElementById('setup-choices-host-copies').textContent));
      const drawerLine = await page.locator('#setup-choices-host-copies').textContent();
      assert.ok(drawerLine.includes(`Second copy: ${expected.additional.grillDirName} is also in a parent folder (`), 'the drawer names the real second copy exactly as Core reported it');
      assert.doesNotMatch(drawerLine, /No second copy reported|Couldn't check/, 'a reported copy never shows a clean or unavailable line');
      await closePolicyDrawer(page);
      const warnedCard = page.locator(`[data-card-id="${expected.additional.sha256}/${grill.id}"]`);
      if (await warnedCard.count()) {
        const badge = warnedCard.locator('[data-state="two-copies"]');
        await badge.waitFor();
        const badgeText = await badge.innerText();
        assert.ok(badgeText.includes(`Second copy: ${expected.additional.grillDirName} is also in a parent folder (`), 'the card shows the same Core warning');
        assert.ok(badgeText.includes('.github/skills'), 'the card names where the copy was seen');
        await warnedCard.click();
        await page.locator('#inspector-browse-facts').waitFor();
        const inspectorText = await page.locator('#inspector-browse-facts').innerText();
        assert.match(inspectorText, /Also seen by your tool[\s\S]*Second copy: .*parent folder/, 'the inspector shows the same warning');
        await page.screenshot({ path: join(output, `${theme}-duplicate-warning.png`), animations: 'disabled' });
        await page.locator('#close-inspector-btn').click();
        outcomes.push({ theme, duplicate: 'passed' });
      } else {
        await writeFile(join(output, `${theme}-duplicate-incomplete.json`), JSON.stringify({ status: 'incomplete', reason: 'The copilot fit filter hides the grill-me card from the framework grid; the drawer warning above is still asserted. A copilot-observed skill card needs a binding-supported skill fixture.' }, null, 2));
        outcomes.push({ theme, duplicate: 'incomplete', reason: 'card filtered under copilot' });
      }
      outcomes.push({ theme, mcp: tickedSelection.recipe.inline.schema, storedKeys: Object.keys(stored.local).length });
      await context.close();
    }
    assert.deepEqual(errors, []);
    // #162-AC05 secret-canary coverage is unavailable in this seam: the checked MCP catalog item declares
    // no inputs of its own ({}), its card offers the approval checkbox only, and no other supported UI input
    // path feeds this selection — so no real path can carry a synthetic secret canary here. That gap is
    // marked incomplete rather than laundered into green; value privacy is proven structurally above
    // (recovery artifact ≡ saved intent, empty selection configuration, value-less input declarations,
    // no live host handle in the saved intent or its export).
    const canaryGap = { reason: 'secret-canary injection needs a supported input path carrying the MCP item’s declared inputs; the checked item declares none and the approval card offers a checkbox only, so canary coverage is unproved in this seam' };
    const incompleteDuplicate = outcomes.find(value => value?.duplicate === 'incomplete');
    const status = incompleteDuplicate || canaryGap ? 'incomplete' : 'passed';
    await writeFile(join(output, 'ui165-evidence.json'), JSON.stringify({ status, outcomes, errors, canaryGap }, null, 2));
    console.log(`UI165 ordinary page cases ${status}: ${output}`);
    return incompleteDuplicate
      ? { status: 'incomplete', reason: `positive duplicate card/inspector surface: ${incompleteDuplicate.reason}` }
      : { status: 'incomplete', reason: `AC05 secret-canary coverage: ${canaryGap.reason}` };
  } catch (error) {
    await writeFile(join(output, 'failure.json'), JSON.stringify({ error: error.message, errors }, null, 2)).catch(() => {});
    throw error;
  } finally { await browser.close(); }
}
