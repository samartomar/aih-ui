import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openPolicyAdvanced, openPolicyFileActions, closePolicyDrawer } from './policy-drawer.mjs';

const intentOf = value => value.records?.find(record => record.intent)?.intent ?? value.metadata?.['aih.workbench'];
const choicesOf = value => intentOf(value).provenance.flatMap(source => source.materialSource.workbenchSetChoices?.choices ?? []);
async function enter(page, origin, theme) {
  await page.goto(origin + '/');
  await page.locator('#framework-navigation [data-framework]').first().waitFor();
  if (await page.locator('#setup-dialog').isVisible()) {
    await page.getByRole('radio', { name: /Vibe coder/ }).check();
    for (let i = 0; i < 4; i++) await page.locator('#setup-next').click();
    await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
  }
  const toggle = page.getByRole('button', { name: `Switch to ${theme} mode`, exact: true });
  if (await toggle.count()) await toggle.click();
}
async function download(page, path, draft = false) {
  if (await page.locator('#added-notice-dismiss').isVisible()) await page.locator('#added-notice-dismiss').click();
  await page.locator('#your-setup').click();
  if (!draft) await openPolicyAdvanced(page);
  const event = page.waitForEvent('download'); await page.locator(draft ? '#policy-draft-save' : '#policy-save').click();
  await (await event).saveAs(path); await closePolicyDrawer(page);
  return JSON.parse(await readFile(path, 'utf8'));
}
export async function runSetInputsBrowser({ origin, output, playwrightModule, expected, inputs, savedDirectory }) {
  await mkdir(output, { recursive: true });
  const { chromium } = await import(playwrightModule), browser = await chromium.launch({ headless: true });
  const outcomes = [], errors = [];
  try { for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude'));
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
    await enter(page, origin, theme);
    const chooseFramework = value => page.locator(`[data-framework="internal:${value.framework.id}:${value.sha256}"]`).click();
    if (savedDirectory) {
      await openPolicyFileActions(page); await page.locator('#policy-open').setInputFiles(join(savedDirectory, `${theme}-configured.json`));
      await page.locator('#policy-draft-status').filter({ hasText: /Saved draft reopened/i }).waitFor(); await closePolicyDrawer(page);
      const actual = await download(page, join(output, `${theme}-reopened.json`), true);
      const original = JSON.parse(await readFile(join(savedDirectory, `${theme}-configured.json`), 'utf8'));
      assert.deepEqual(intentOf(actual), intentOf(original), 'Fresh host/browser preserves configuration, options, exclusions, exact sources and unrelated choices');
      await chooseFramework(expected.ecc); await page.locator('#starting-sets .set-inputs > summary').click();
      for (const root of intentOf(original).roots.filter(root => Object.keys(root.configuration).length)) {
        const editor = page.locator(`[data-configuration-item="${root.itemId}"]`);
        for (const [name, value] of Object.entries(root.configuration)) assert.equal(await editor.getByLabel(`${name} for ${root.itemId}`, { exact: true }).inputValue(), value);
      }
      outcomes.push({ theme, freshReopen: 'exact', execution: false }); await context.close(); continue;
    }
    await chooseFramework(expected.prepared);
    const unrelated = expected.prepared.items[0].id;
    await page.getByRole('button', { name: `Add ${unrelated}`, exact: true }).click();
    await page.getByRole('button', { name: `Remove ${unrelated}`, exact: true }).waitFor();
    const before = await download(page, join(output, `${theme}-before.json`));
    await chooseFramework(expected.ecc);
    // Pick the actual declared option set, without changing producer choices.
    await page.locator('#starting-sets .set-refusal').waitFor();
    const initialIds = await page.locator('#starting-sets [data-set-id][aria-pressed="true"]').evaluateAll(nodes => nodes.map(node => node.dataset.setId));
    for (const id of initialIds) await page.locator(`[data-set-id="${id}"]`).click();
    const more = page.locator('#starting-sets .more-sets'); if (!await more.evaluate(node => node.open)) await more.locator('> summary').click();
    await page.locator(`[data-set-id="${expected.ecc.optionSet.id}"]`).click();
    await page.locator(`[data-option="${expected.ecc.language.id}"]`).check();
    await page.locator('#starting-sets .set-refusal').waitFor();
    const panel = page.locator('#starting-sets .set-inputs'); await panel.locator('> summary').click();
    const editors = await panel.locator('[data-configuration-item]').all(); assert.ok(editors.length > 0);
    const firstId = await editors[0].getAttribute('data-configuration-item');
    const missingReply = page.waitForResponse(response => response.url().endsWith('/api/authoring-browse-content') && response.request().postDataJSON().configurations?.length);
    await editors[0].getByRole('button', { name: 'Review configuration', exact: true }).click();
    assert.equal((await (await missingReply).json()).status, 'refused', 'Empty required values never become a successful set');
    const unchanged = await download(page, join(output, `${theme}-missing-preserved.json`)); assert.deepEqual(unchanged, before);
    await page.screenshot({ path: join(output, `${theme}-required-inputs.png`), animations: 'disabled' });
    if (!inputs) {
      outcomes.push({ theme, collection: 'available', missingInputs: 'refused; original choices preserved', incomplete: 'Positive current ECC proof needs caller-owned inputs matching its published descriptions; none fabricated.' });
      await context.close(); continue;
    }
    const ids = await panel.locator('[data-configuration-item]').evaluateAll(nodes => nodes.map(node => node.dataset.configurationItem));
    for (const itemId of ids) {
      const editor = panel.locator(`[data-configuration-item="${itemId}"]`);
      for (const [name, value] of Object.entries(inputs)) await editor.getByLabel(`${name} for ${itemId}`, { exact: true }).fill(value);
      const reply = page.waitForResponse(response => response.url().endsWith('/api/authoring-browse-content') && response.request().postDataJSON().configurations?.some(root => root.itemId === itemId && root.configuration.npmCli === inputs.npmCli));
      await editor.getByRole('button', { name: 'Review configuration', exact: true }).click(); await reply;
    }
    await page.locator('#starting-sets .set-refusal').waitFor({ state: 'detached' });
    // This actual ECC content publishes no hook items. Hook/exclusion behavior is
    // exercised separately by the existing labelled public cross-hook fixture.
    const resolvedReply = page.waitForResponse(response => /authoring-(?:draft-edit|edit)$/.test(response.url()));
    await page.locator('[data-add-sets]').click(); const result = await (await resolvedReply).json();
    assert.ok(result.diagnostics?.some(value => value.code === 'POLICY_BOUND_EXCEEDED'), 'The existing executable policy bound is retained');
    const draftReply = page.waitForResponse(response => response.url().endsWith('/api/authoring-draft-edit'));
    await page.locator('#browse-keep-draft').click(); assert.equal((await (await draftReply).json()).status, 'ok');
    await page.locator('#framework-guidance').filter({ hasText: 'Chosen sets added' }).waitFor();
    const saved = await download(page, join(output, `${theme}-configured.json`), true);
    assert.equal(saved.executable, false); const intent = intentOf(saved);
    assert.ok(intent.roots.some(root => root.itemId === unrelated));
    assert.deepEqual(choicesOf(saved).find(choice => choice.request.setId === expected.ecc.optionSet.id).request.options, expected.ecc.requests[0].options);
    assert.deepEqual(choicesOf(saved).find(choice => choice.request.setId === expected.ecc.optionSet.id).request.members, expected.ecc.requests[0].members);
    for (const itemId of ids) assert.deepEqual(intent.roots.find(root => root.itemId === itemId).configuration, inputs);
    // Refresh does not use browsing-cache inputs: the accepted draft is their authority.
    assert.ok(!(await page.evaluate(() => sessionStorage.getItem('aih-ui-set-browsing'))).includes(inputs.npmCli));
    await page.reload(); await page.locator('#starting-sets [data-option]').first().waitFor();
    assert.equal(await page.locator(`[data-option="${expected.ecc.language.id}"]`).isChecked(), true);
    await page.screenshot({ path: join(output, `${theme}-configured.png`), animations: 'disabled' });
    outcomes.push({ theme, collection: 'configured', language: expected.ecc.language.id, saved: 'exact', sourceRefresh: 'retained', execution: false, firstId }); await context.close();
  }
  assert.deepEqual(errors, []);
  const result = { status: outcomes.some(value => value.incomplete) ? 'incomplete' : 'passed', outcomes, errors, humanAcceptance: 'pending', scope: 'Public packed packages and ordinary running page; no tool/service/native execution' };
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2)); return result;
  } finally { await browser.close(); }
}
