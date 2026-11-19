import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createPrototypeServer } from './local-server.mjs';

const [consumer, fixture, expected] = process.argv.slice(2);
if (!fixture || !['loaded', 'not-loaded', 'unconfirmed'].includes(expected)) {
  throw Error('Usage: node check-claude-load.mjs <consumer> <disposable-installed-workspace> <loaded|not-loaded|unconfirmed>');
}
const workspace = resolve(fixture);
const host = await createPrototypeServer({ consumer, workspace });
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(host.origin + '/?view=installed&mode=enterprise&role=developer');
  const panel = page.getByRole('region', { name: 'Claude Code load check' });
  const button = panel.getByRole('button', { name: 'Check in Claude Code', exact: true });
  await button.waitFor();
  const before = await (await fetch(host.origin + '/api/session')).json();
  assert.ok(before.enterprise.inventory.entries.some(entry => entry.framework === 'superpowers' && entry.localPlugin));
  const response = page.waitForResponse(r => r.url() === host.origin + '/api/check-claude' && r.request().method() === 'POST');
  await button.click();
  const result = await (await response).json();
  assert.equal(result.clientCheck?.status, expected, JSON.stringify(result.clientCheck));
  assert.equal(result.clientCheck.pluginId, 'superpowers@superpowers');
  assert.deepEqual(result.inventory, before.enterprise.inventory);
  await panel.getByText(result.clientCheck.message, { exact: true }).waitFor();
  const heading = { loaded: 'Loaded in Claude Code', 'not-loaded': 'Not loaded in Claude Code', unconfirmed: 'Load not confirmed' };
  await panel.getByRole('heading', { name: heading[expected], exact: true }).waitFor();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await panel.screenshot({ path: join(workspace, 'claude-load-' + expected + '-' + width + '.png') });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(result.clientCheck));
} finally {
  try { await browser?.close(); } finally { await host.close(); }
}
