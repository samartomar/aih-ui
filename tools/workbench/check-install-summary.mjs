import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createPrototypeServer } from './local-server.mjs';

const [consumer, output, sourceCache, recipeCommit] = process.argv.slice(2);
if (!recipeCommit) throw Error('Usage: node check-install-summary.mjs <consumer> <output-parent> <source-cache> <recipe-commit>');
const workspace = await mkdtemp(join(resolve(output), 'install-summary-'));
const host = await createPrototypeServer({ consumer, workspace, sourceCache, recipeCommit });
let browser;
try {
  const session = async () => (await fetch(host.origin + '/api/session')).json();
  const { token } = await session();
  async function savePolicy(obligation) {
    const response = await fetch(host.origin + '/api/policy', {
      method: 'POST',
      headers: { Origin: host.origin, 'Content-Type': 'application/json', 'X-Workbench-Token': token },
      body: JSON.stringify({ mode: 'enterprise', id: 'install-summary-example', obligation, allowCustom: true }),
    });
    assert.equal(response.status, 200);
  }
  await savePolicy('permitted');
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(host.origin + '/?view=installed&mode=enterprise&role=developer');
  const panel = page.locator('.review-panel');
  const summary = panel.locator('.install-summary');
  const approve = panel.getByRole('button', { name: 'Approve installation' });
  const click = action => page.locator('[data-action="' + action + '"]:visible').first().click();
  async function prepare(unit) {
    const response = page.waitForResponse(r => r.url() === host.origin + '/api/prepare');
    await click('prepare-' + unit);
    const { prepared } = await (await response).json();
    await panel.waitFor();
    return prepared;
  }
  await click('toggle-superpowers');
  const plugin = await prepare('superpowers');
  assert.ok(plugin.applyAllowed);
  await summary.waitFor();
  const steps = plugin.result.review.steps;
  const text = await summary.innerText();
  for (const expected of [/Superpowers/i, /\.claude\/settings\.json/, /register/i, /enabl/i, /session.start/i]) assert.match(text, expected);
  const unchanged = steps.filter(s => s.effect === 'already-satisfied').length;
  assert.ok(unchanged > 0 && text.includes(String(unchanged)));
  const all = panel.locator('details').filter({ has: page.locator('summary', { hasText: 'View all ' + steps.length + ' operations' }) });
  await all.locator('summary').click();
  assert.equal(await all.locator('ol.review-operations > li').count(), steps.length);
  await all.locator('summary').click();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await approve.scrollIntoViewIfNeeded();
    assert.ok((await summary.boundingBox()).y < (await approve.boundingBox()).y);
    await page.screenshot({ path: join(workspace, 'summary-' + width + '.png') });
  }
  await click('toggle-instructions');
  await prepare('instructions');
  await summary.getByText(/CLAUDE\.md/).first().waitFor();
  assert.doesNotMatch(await summary.innerText(), /Superpowers|session.start/i);
  await savePolicy('prohibited');
  await page.reload();
  const blocked = await prepare('superpowers');
  assert.equal(blocked.applyAllowed, false);
  await summary.getByText(/unavailable|cannot|blocked|denied|no changes|not available|not allowed/i).first().waitFor();
  assert.ok(await approve.isDisabled());
  assert.equal((await session()).enterprise.inventory.entries.length, 0);
  console.log(JSON.stringify({ workspace, reviewedOperations: steps.length, alreadySatisfied: unchanged, summary: text }));
} finally {
  try { await browser?.close(); } finally { await host.close(); }
}
