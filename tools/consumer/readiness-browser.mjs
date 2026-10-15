// Machine-readiness demonstration in installed Chromium against the real Workbench
// preview. Core runs in the preview's host process with a disposable fixture home
// and PATH (createReadinessFixture), so the developer's real clients, .npmrc and
// environment are never read for repair or changed. Port 4182 only.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, stat, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createReadinessFixture } from './readiness-fixture.mjs';

const PORT = 4182;
const repo = resolve(process.env.AIH_REPO ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const playwright = process.env.PLAYWRIGHT_MODULE ?? pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href;
const { chromium } = await import(playwright);
const work = await mkdtemp(join(tmpdir(), 'aih-readiness-browser-'));
const evidence = process.env.AIH_READINESS_EVIDENCE ?? join(work, 'evidence');
await mkdir(evidence, { recursive: true });
const fixture = createReadinessFixture(join(work, 'fixture'));
const repairsFile = join(work, 'repairs.json');
await writeFile(repairsFile, JSON.stringify({ repairs: [{ key: 'npm-ca', id: 'node-npm-ca', targets: ['npm'], inputs: { caFile: fixture.caFile }, network: 'declared' }] }));

// A cheap fingerprint of every file under a directory: path, size and mtime.
async function fingerprint(root, found = new Map()) {
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await fingerprint(path, found);
    else { const info = await stat(path); found.set(path, `${info.size}:${info.mtimeMs}`); }
  }
  return found;
}
const changed = (before, after) => [...new Set([...before.keys(), ...after.keys()])].filter(path => before.get(path) !== after.get(path));
// The real home's .npmrc is compared by metadata only; its content is never read.
const realNpmrc = join(homedir(), '.npmrc');
const npmrcState = async () => { const info = await stat(realNpmrc).catch(() => null); return info ? `${info.size}:${info.mtimeMs}` : 'absent'; };
const realNpmrcBefore = await npmrcState();

const preview = spawn(process.execPath, [join(repo, 'tools/preview.mjs'), '--port', String(PORT), '--quiet'], {
  cwd: repo, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, AIH_READINESS_HOME: fixture.home, AIH_READINESS_PATH: fixture.path, AIH_READINESS_REPAIRS: repairsFile },
});
let previewLog = '';
preview.stdout.on('data', chunk => { previewLog += chunk; });
preview.stderr.on('data', chunk => { previewLog += chunk; });
// A child tree on Windows outlives its parent unless taken down by PID.
function stopPreview() {
  if (preview.exitCode !== null || preview.pid === undefined) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(preview.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 30_000 });
  else preview.kill('SIGKILL');
}
const deadline = setTimeout(() => { console.error('Readiness demonstration exceeded its deadline.'); stopPreview(); process.exit(1); }, 900_000);

const origin = `http://127.0.0.1:${PORT}`;
const errors = [], screenshots = [];
let browser;
try {
  const started = Date.now();
  while (!previewLog.includes(`${origin}/`)) {
    if (preview.exitCode !== null) throw new Error(`The preview exited early (${preview.exitCode}):\n${previewLog}`);
    if (Date.now() - started > 300_000) throw new Error(`The preview did not start within 300 seconds:\n${previewLog}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 500));
  }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const page = await context.newPage();
  page.setDefaultTimeout(240_000);
  page.on('pageerror', error => errors.push(error.message));
  const shot = async name => { const path = join(evidence, name); await page.screenshot({ path, fullPage: true }); screenshots.push(path); };
  const check = async () => {
    await page.locator('#check-status').evaluate(node => { node.textContent = ''; });
    await page.click('#check');
    await page.locator('#check-status', { hasText: /Check finished|did not run/ }).waitFor();
    assert.doesNotMatch(await page.textContent('#check-status'), /did not run/, await page.textContent('#check-status'));
  };

  // The Workbench itself offers the entry.
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
  assert.equal(await page.locator('#nav-readiness').getAttribute('href'), 'readiness.html');
  await page.goto(`${origin}/readiness.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('#repairs li button').waitFor();
  assert.match(await page.textContent('#repairs'), /node-npm-ca for npm/);

  // 1. Online check: the deliberately broken jq is listed first and as failed.
  await page.fill('#targets', 'jq, npm, node');
  await check();
  const rows = await page.locator('#rows > li').allTextContents();
  assert.match(rows[0], /^Failed.*jq/, `expected jq failure first, got: ${rows[0]}`);
  assert.match(await page.textContent('#overall'), /^Not ready/);
  assert.equal(await page.locator('#rows > li').filter({ hasText: /^Verified/ }).count() > 0, true, 'a healthy tool should be verified');
  await shot('01-check-failures-first.png');
  const online = { overall: await page.textContent('#overall'), rows: rows.map(row => row.slice(0, 160)) };

  // 2. Copy: the clipboard carries the shown guidance and copying changes nothing.
  const beforeCopy = await fingerprint(fixture.root);
  await page.click('#copy-guidance');
  await page.locator('#copy-status', { hasText: 'Copied' }).waitFor();
  const shown = await page.inputValue('#guidance');
  // The Windows clipboard converts line endings; the text is otherwise identical.
  assert.equal((await page.evaluate(() => navigator.clipboard.readText())).split('\r\n').join('\n'), shown);
  assert.match(shown, /nothing has been changed/i);
  assert.match(shown, /\[failed\] jq\/version/);
  assert.deepEqual(changed(beforeCopy, await fingerprint(fixture.root)), [], 'copying must not change any fixture file');

  // 3. Prepare: effects are reviewed, nothing is applied, Apply needs the approval control.
  const npmrc = join(fixture.home, '.npmrc');
  assert.equal(existsSync(npmrc), false);
  const beforePrepare = await fingerprint(fixture.root);
  await page.click('#repairs li button');
  await page.locator('#review').waitFor({ state: 'visible' });
  await page.locator('#review-rows > li').first().waitFor();
  assert.equal(await page.locator('#apply').isDisabled(), true, 'Apply is disabled until the review is approved');
  assert.equal(existsSync(npmrc), false, 'preparing must not create the npm configuration');
  const prepareChanges = changed(beforePrepare, await fingerprint(fixture.root));
  const reviewText = await page.textContent('#review');
  assert.match(reviewText, /Failed/);
  assert.match(reviewText, /Effect: create-file/);
  assert.ok(reviewText.includes(fixture.home) || reviewText.includes('.npmrc'), 'the review names what would change');
  await shot('02-repair-review.png');
  await page.check('#approve');
  assert.equal(await page.locator('#apply').isDisabled(), false);

  // 4. Apply: the outcome separates applied from verified.
  await page.click('#apply');
  await page.locator('#outcome').waitFor({ state: 'visible' });
  const outcomeOverall = await page.textContent('#outcome-overall');
  const outcomeRows = await page.locator('#outcome-rows > li').allTextContents();
  assert.ok(outcomeRows.length > 0, 'the outcome lists the operations');
  const verified = /^Ready/.test(outcomeOverall);
  if (verified) for (const row of outcomeRows) assert.match(row, /^Verified/, row);
  else for (const row of outcomeRows) assert.doesNotMatch(row, /^Verified.*Verification: (?!passed)/, row);
  assert.ok(existsSync(npmrc), 'the fixture npm configuration was written');
  assert.equal(await page.locator('#apply').isDisabled(), true, 'a session is one-shot');
  await shot('03-repair-outcome.png');
  console.log(verified ? 'Repair outcome: Verified (fresh check agrees).' : `Repair outcome: honestly not verified: ${outcomeOverall}`);

  // 5. A second review now finds the repair in place, which is configured, not verified-by-files.
  await page.click('#repairs li button');
  await page.locator('#review').waitFor({ state: 'visible' });
  await page.locator('#review-overall', { hasText: /^Not ready/ }).waitFor();
  assert.match(await page.textContent('#review-rows'), /Configured/);
  await shot('04-already-configured.png');

  // 6. Offline: network-dependent conditions are unknown and never ready.
  await page.check('#offline');
  await page.fill('#targets', 'npm');
  await check();
  const offlineRows = await page.locator('#rows > li').allTextContents();
  assert.ok(offlineRows.some(row => /^Unknown/.test(row)), 'offline checks leave unknown conditions');
  assert.match(await page.textContent('#overall'), /^Not ready/);
  assert.match(await page.textContent('#overall'), /unknown/);
  await shot('05-offline-unknown.png');

  assert.deepEqual(errors, [], 'no uncaught page errors');
  assert.equal(await npmrcState(), realNpmrcBefore, "the real home's .npmrc is untouched");
  await writeFile(join(evidence, 'readiness-evidence.json'), JSON.stringify({ status: 'passed', chromium: browser.version(), port: PORT,
    onlineCheck: online, offlineOverall: await page.textContent('#overall'), repairOutcome: { overall: outcomeOverall, verified, rows: outcomeRows.map(row => row.slice(0, 200)) },
    filesChangedByPrepare: prepareChanges.map(path => path.slice(fixture.root.length)), screenshots }, null, 2));
  console.log('Machine-readiness Chromium demonstration passed.');
  for (const path of screenshots) console.log(`screenshot: ${path}`);
} finally {
  clearTimeout(deadline);
  await browser?.close().catch(() => {});
  stopPreview();
  await rm(join(work, 'fixture'), { recursive: true, force: true }).catch(() => {});
}
