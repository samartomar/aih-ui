import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, realpath } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { chromium } from 'playwright';
import { createPrototypeServer } from './local-server.mjs';

const [consumer, output, extensionsSourceCache] = process.argv.slice(2);
if (!consumer || !output) throw Error('Supply a packed consumer and a disposable output directory.');
const workspace = await mkdtemp(join(resolve(output), 'extensions-install-'));
const host = await createPrototypeServer({ consumer, workspace, extensionsSourceCache });
let browser;
try {
  const token = (await (await fetch(host.origin + '/api/session')).json()).token;
  const policy = await fetch(host.origin + '/api/policy', {
    method: 'POST',
    headers: { Origin: host.origin, 'Content-Type': 'application/json', 'X-Workbench-Token': token },
    body: JSON.stringify({ mode: 'enterprise', id: 'extensions-install-check', obligation: 'permitted',
      allowCustom: false, frameworkRules: { extensions: 'permitted' } }),
  });
  assert.equal(policy.status, 200, await policy.text());
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(host.origin + '/?view=installed&mode=enterprise&role=developer');
  const check = page.getByRole('button', { name: 'Check in Claude Code', exact: true });
  await page.locator('[data-action="toggle-extensions"]:visible').first().waitFor();
  assert.equal(await check.count(), 0);
  await page.locator('[data-action="toggle-extensions"]:visible').first().click();
  await page.locator('[data-action="prepare-extensions"]:visible').first().click();
  const approve = page.getByRole('button', { name: 'Approve installation', exact: true });
  await approve.waitFor({ timeout: 150000 });
  const run = page.waitForResponse(r => r.url() === host.origin + '/api/apply', { timeout: 150000 });
  await approve.click();
  const installation = await (await run).json();
  assert.equal(installation.outcome?.completion, 'complete', JSON.stringify(installation.outcome));
  assert.ok(installation.inventory.entries.some(entry => entry.framework === 'extensions' && entry.plugins?.length));

  async function readResult() {
    const observation = page.waitForResponse(r => r.url() === host.origin + '/api/check-claude');
    await check.click();
    return (await observation).json();
  }
  const checked = await readResult();
  assert.equal(checked.clientCheck?.pluginId, 'aih-extensions@aihq-extensions');
  assert.equal(checked.clientCheck.status, 'loaded', checked.clientCheck.message);
  assert.deepEqual(checked.inventory, installation.inventory);
  const panel = page.getByRole('region', { name: 'Claude Code load check' });
  await panel.getByRole('heading', { name: 'Loaded in Claude Code', exact: true }).waitFor();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await panel.screenshot({ path: join(workspace, 'extensions-loaded-' + width + '.png') });
  }
  await page.reload();
  await check.waitFor();
  const settingsPath = join(workspace, 'enterprise', 'project', '.claude', 'settings.json');
  const settingsBytes = await readFile(settingsPath);
  try {
    const settings = JSON.parse(settingsBytes);
    settings.enabledPlugins[checked.clientCheck.pluginId] = false;
    await writeFile(settingsPath, JSON.stringify(settings));
    assert.equal((await readResult()).clientCheck.status, 'not-loaded');
    await panel.getByRole('heading', { name: 'Not loaded in Claude Code', exact: true }).waitFor();
  } finally {
    await writeFile(settingsPath, settingsBytes);
  }
  const cache = await realpath(join(workspace, 'enterprise', 'home', '.claude', 'plugins', 'cache'));
  const manifest = await realpath(join(checked.clientCheck.evidence.path, '.claude-plugin', 'plugin.json'));
  const withinCache = relative(cache, manifest);
  assert.ok(withinCache && withinCache !== '..' && !withinCache.startsWith('..' + sep) && !isAbsolute(withinCache));
  const original = await readFile(manifest);
  try {
    await writeFile(manifest, Buffer.concat([original, Buffer.from('\n')]));
    assert.equal((await readResult()).clientCheck.status, 'unconfirmed');
    await panel.getByRole('heading', { name: 'Load not confirmed', exact: true }).waitFor();
  } finally {
    await writeFile(manifest, original);
  }
  assert.equal((await readResult()).clientCheck.status, 'loaded');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ workspace, check: checked.clientCheck }));
} finally {
  try { await browser?.close(); } finally { await host.close(); }
}
