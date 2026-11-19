import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createPrototypeServer } from './local-server.mjs';

const [consumer, output] = process.argv.slice(2);
if (!consumer || !output) throw Error('Usage: node tools/workbench/check-item-review.mjs <consumer> <existing-output-parent>');
const workspace = await mkdtemp(join(resolve(output), 'item-review-'));
const host = await createPrototypeServer({ consumer, workspace });
let browser;
try {
  const session = await (await fetch(host.origin + '/api/session')).json();
  const savePolicy = async id => {
    const response = await fetch(host.origin + '/api/policy', {
      method: 'POST', headers: { Origin: host.origin, 'Content-Type': 'application/json', 'X-Workbench-Token': session.token },
      body: JSON.stringify({ mode: 'enterprise', id, obligation: 'permitted', allowCustom: false }),
    });
    assert.equal(response.status, 200);
  };
  await savePolicy('review-example');
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  const page = await browser.newPage();
  const item = 'egm.skill.egm-draft';
  const reviewer = 'Example admin';
  const note = 'Check the cited instruction with the team before using this skill.';
  const open = (view, role = 'developer', id = item, mode = 'enterprise') =>
    page.goto(host.origin + '/?view=' + view + '&mode=' + mode + '&role=' + role + '&framework=egm&item=' + id);
  const click = action => page.locator('[data-action="' + action + '"]:visible').first().click();
  await open('scan', 'admin');
  await click('review-attach');
  await page.locator('#review-company').fill('Example company');
  await page.locator('#review-reviewer').fill(reviewer);
  await page.locator('#review-decision').selectOption('Follow-up needed');
  await page.locator('#review-note').fill(note);
  await click('review-save');
  await page.getByText('1 review(s) for this policy revision.', {exact:true}).waitFor();

  const verify = async panel => {
    const review = panel.getByRole('region', { name: 'Organization review', exact: true });
    await review.getByText(note).waitFor();
    await review.getByText('Follow-up needed', { exact: true }).waitFor();
    await review.getByText(reviewer, { exact: true }).waitFor();
  };
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await open('catalog');
    const panel = page.locator(width === 390 ? '#inline-inspector-content' : '#inspector-content');
    await verify(panel);
    for (const tab of ['security', 'policy']) {
      await page.locator('[data-inspect="' + tab + '"]:visible').first().click();
      await verify(panel);
    }
    await open('scan');
    await verify(page.locator('#main-content'));
    await page.screenshot({ path: join(workspace, 'developer-scan-' + width + '.png') });
  }
  for (const [id, mode] of [['egm.skill.egm-review', 'enterprise'], [item, 'vibe']]) {
    await open('scan', 'developer', id, mode);
    await page.locator('.evidence-subject').getByText(id, {exact:true}).waitFor();
    assert.ok(!(await page.locator('#main-content').innerText()).includes(note));
  }
  await savePolicy('different-policy');
  await open('scan');
  await page.locator('.evidence-subject').getByText(item, {exact:true}).waitFor();
  assert.ok(!(await page.locator('#main-content').innerText()).includes(note));
  console.log(JSON.stringify({status:'passed', workspace, item, reviewer, note, decision:'Follow-up needed'}));
} finally {
  try { await browser?.close(); } finally { await host.close(); }
}
