// Report demonstration in installed Chromium against the real Workbench preview. By default,
// Core runs in the preview's host process with a disposable fixture home and PATH
// (createReadinessFixture), keeping repair reads and writes out of the developer's real home.
// Default port 4196 (AIH_REPORT_PORT may override it; 4173 is refused).
// AIH_REPORT_ORIGIN uses an already-running localhost or 127.0.0.1 Workbench (never 4173),
// with AIH_REPORT_READINESS_HOME required for its host-configured repair assertion. This mode
// creates no fixture or repairs file and never stops the existing Workbench.
// AIH_REPORT_EXPECT_STAGED=1 requires staging notices on both pages.
// AIH_REPORT_REQUIRE_VERIFIED=1 demands exactly one verified repair; in default mode run behind
// an intercepting proxy whose CA file is given in AIH_REPORT_CA_FILE.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, stat, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createReadinessFixture } from './readiness-fixture.mjs';

const PORT = Number(process.env.AIH_REPORT_PORT ?? 4196);
const external = process.env.AIH_REPORT_ORIGIN !== undefined;
let origin = `http://127.0.0.1:${PORT}`;
if (external) {
  const url = new URL(process.env.AIH_REPORT_ORIGIN);
  assert.ok(['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost'].includes(url.hostname)
    && url.port !== '4173' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash,
  'AIH_REPORT_ORIGIN must be a localhost or 127.0.0.1 HTTP origin other than port 4173');
  assert.ok(process.env.AIH_REPORT_READINESS_HOME?.trim(), 'AIH_REPORT_READINESS_HOME is required with AIH_REPORT_ORIGIN');
  origin = url.origin;
} else assert.ok(Number.isInteger(PORT) && PORT > 1023 && PORT !== 4173, 'AIH_REPORT_PORT must be an unprivileged port other than 4173');
const repo = resolve(process.env.AIH_REPO ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const playwright = process.env.PLAYWRIGHT_MODULE ?? pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href;
const { chromium } = await import(playwright);
const { reportPanels, reportText } = await import(pathToFileURL(join(repo, 'src/app/claims-view.js')).href);
const work = await mkdtemp(join(tmpdir(), 'aih-report-browser-'));
const evidence = process.env.AIH_REPORT_EVIDENCE ?? join(work, 'evidence');
await mkdir(evidence, { recursive: true });
const inside = (root, path) => { const rel = relative(root, path); return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel); };
let fixture, repairsFile;
if (!external) {
  fixture = createReadinessFixture(join(work, 'fixture'));
  // The repair Core reviews and applies must live in the disposable fixture, never in the real home.
  assert.ok(inside(work, fixture.home) && resolve(fixture.home) !== resolve(homedir()), 'the fixture home must be disposable and not the real home');
  repairsFile = join(work, 'repairs.json');
  // The CA of an intercepting proxy lets Core verify the repair against the real connection.
  const caFile = resolve(process.env.AIH_REPORT_CA_FILE ?? fixture.caFile);
  assert.ok(existsSync(caFile), 'AIH_REPORT_CA_FILE must name an existing CA certificate file');
  await writeFile(repairsFile, JSON.stringify({ repairs: [{ key: 'npm-ca', id: 'node-npm-ca', targets: ['npm'], inputs: { caFile }, network: 'declared' }] }));
}
const readinessHome = external ? resolve(process.env.AIH_REPORT_READINESS_HOME) : fixture.home;

// The real home's .npmrc is compared by metadata only; its content is never read.
const realNpmrc = join(homedir(), '.npmrc');
const npmrcState = async () => { const info = await stat(realNpmrc).catch(() => null); return info ? `${info.size}:${info.mtimeMs}` : 'absent'; };
const realNpmrcBefore = await npmrcState();
const requireVerified = process.env.AIH_REPORT_REQUIRE_VERIFIED === '1';
const expectStaged = process.env.AIH_REPORT_EXPECT_STAGED === '1';

const preview = external ? null : spawn(process.execPath, [join(repo, 'tools/preview.mjs'), '--port', String(PORT), '--quiet'], {
  cwd: repo, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, AIH_READINESS_HOME: fixture.home, AIH_READINESS_PATH: fixture.path, AIH_READINESS_REPAIRS: repairsFile },
});
let previewLog = '';
preview?.stdout.on('data', chunk => { previewLog += chunk; });
preview?.stderr.on('data', chunk => { previewLog += chunk; });
// A child tree on Windows outlives its parent unless taken down by PID.
function stopPreview() {
  if (!preview || preview.exitCode !== null || preview.pid === undefined) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(preview.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 30_000 });
  else preview.kill('SIGKILL');
}
const deadline = setTimeout(() => { console.error('Report demonstration exceeded its deadline.'); stopPreview(); process.exit(1); }, 900_000);

const errors = [], screenshots = [];
let browser;
try {
  const started = Date.now();
  while (preview && !previewLog.includes(`${origin}/`)) {
    if (preview.exitCode !== null) throw new Error(`The preview exited early (${preview.exitCode}):\n${previewLog}`);
    if (Date.now() - started > 300_000) throw new Error(`The preview did not start within 300 seconds:\n${previewLog}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 500));
  }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(240_000);
  page.on('pageerror', error => errors.push(error.message));
  const shot = async name => { const path = join(evidence, name); await page.screenshot({ path, fullPage: true }); screenshots.push(path); };
  const assertStaged = async selector => {
    if (!expectStaged) return;
    await page.locator(selector).waitFor({ state: 'visible' });
    assert.match((await page.locator(selector).innerText()).trim(), /^Staged condition/);
  };
  // Every report fetch is stamped by the host clock; retain the response the page actually rendered.
  let received = null;
  const openReport = async () => {
    const response = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/readiness-report');
    await page.goto(`${origin}/report.html`, { waitUntil: 'domcontentloaded' });
    received = await (await response).json();
    await page.locator('#report-status', { hasText: /^Report loaded|could not/ }).waitFor();
    assert.match(await page.textContent('#report-status'), /^Report loaded/, await page.textContent('#report-status'));
    await assertStaged('#report-staged');
  };
  const panelText = async name => page.locator(`#report-${name}`).innerText();
  const attemptsShown = async () => (await page.locator('#report-repairs li').allInnerTexts()).map(text => text.split('\n')[0]);
  // The check response the page received: it also carries the same targets inspected with the persisted configuration.
  let checkBody = null;
  const check = async () => {
    await page.locator('#check-status').evaluate(node => { node.textContent = ''; });
    const response = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/readiness-check');
    await page.click('#check');
    checkBody = await (await response).json();
    await page.locator('#check-status', { hasText: /Check finished|did not run/ }).waitFor();
    assert.doesNotMatch(await page.textContent('#check-status'), /did not run/, await page.textContent('#check-status'));
  };
  // [{ state, id }] for each row the readiness page lists: its state label and its check id.
  const rowsOf = selector => page.$$eval(`${selector} > li`, items => items.map(item => {
    const spans = item.querySelectorAll('div > span');
    return { state: spans[0]?.textContent ?? '', id: spans[2]?.textContent ?? '' };
  }));

  // 1. Before any check: no score, zero verified repairs, usage unknown.
  await openReport();
  assert.match(await page.textContent('#report-score'), /Unavailable/);
  assert.match(await panelText('score'), /No machine check has been run, so there is no score\./);
  assert.match(await panelText('repairs'), /^Verified repairs\s+0\s+0 verified repairs\./);
  const usage = await panelText('context');
  assert.match(usage, /Observed usage\s+Unavailable — /);
  assert.doesNotMatch(usage, /Observed usage[\s\S]*Value: 0\b/);
  assert.match(await panelText('actions'), /No client usage was observed, so usage is unknown rather than zero\./);
  await shot('01-report-before-any-check.png');
  const empty = { score: (await page.textContent('#report-score')).slice(0, 200), repairs: (await panelText('repairs')).slice(0, 200) };

  // 2. Machine check on the readiness page, then the configured npm repair with explicit approval.
  await page.goto(`${origin}/readiness.html`, { waitUntil: 'domcontentloaded' });
  assert.equal(await page.locator('#nav-report').getAttribute('href'), 'report.html');
  await page.locator('#repairs li button').waitFor();
  await assertStaged('#staged-condition');
  await page.fill('#targets', 'jq, npm');
  await check();
  const checked = await rowsOf('#rows');
  assert.ok(checked.some(row => /^Failed/.test(row.state) && row.id === 'jq/version'), `the broken jq must fail: ${JSON.stringify(checked)}`);
  await shot('readiness-01-failing-precheck.png');
  await page.locator('#repairs').scrollIntoViewIfNeeded();
  await shot('readiness-02-offered-repair.png');
  await page.click('#repairs li button');
  await page.locator('#review').waitFor({ state: 'visible' });
  await page.locator('#review-rows > li').first().waitFor();
  await page.locator('#review').scrollIntoViewIfNeeded();
  await shot('readiness-03-repair-review.png');
  await page.check('#approve');
  await page.click('#apply');
  await page.locator('#outcome').waitFor({ state: 'visible' });
  await page.locator('#outcome').scrollIntoViewIfNeeded();
  await shot('readiness-04-applied-repair.png');
  await page.locator('#recheck-rows').scrollIntoViewIfNeeded();
  await shot('readiness-05-verified-recheck.png');
  const rechecked = await rowsOf('#recheck-rows');
  assert.ok(existsSync(join(readinessHome, '.npmrc')), 'the host readiness npm configuration was written');
  // What Core itself said about each npm condition before and after the applied repair.
  const stateBefore = new Map(checked.filter(row => row.id.startsWith('npm/')).map(row => [row.id, row.state]));
  const stateAfter = new Map(rechecked.filter(row => row.id.startsWith('npm/')).map(row => [row.id, row.state]));
  // Broken before only if it failed for this host (the page) and with the persisted configuration.
  const persistedBefore = new Map((checkBody?.value?.persistedCheck?.items ?? []).map(item => [item.id, item.state]));
  const npmRows = {
    before: [...stateBefore].map(([id, state]) => ({ id, state, persistedBefore: persistedBefore.get(id) ?? null })),
    after: [...stateAfter].map(([id, state]) => ({ id, state, persistedBefore: persistedBefore.get(id) ?? null })),
  };
  const verifiedIds = [...stateBefore].filter(([id, state]) => /^Failed/.test(state) && persistedBefore.get(id) === 'failed'
    && /^Verified/.test(stateAfter.get(id) ?? '')).map(([id]) => id);

  // 3. The report counts exactly the conditions Core saw fail, repaired and pass again.
  await openReport();
  const repairsText = await panelText('repairs');
  assert.match(repairsText, new RegExp(`^Verified repairs\\s+${verifiedIds.length}\\s+${verifiedIds.length} verified repair`));
  const shown = await attemptsShown();
  assert.equal(shown.filter(text => /^Counted — /.test(text)).length, verifiedIds.length);
  for (const id of verifiedIds) assert.ok(shown.some(text => text.startsWith(`Counted — npm ${id}`)), `${id} is counted`);
  for (const [id, state] of stateBefore) if (!verifiedIds.includes(id)) {
    const row = shown.find(text => text.includes(` ${id}:`));
    assert.ok(row && /^Not counted — /.test(row), `${id} (${state} before) is not counted: ${row}`);
  }
  const scoreText = await panelText('score');
  assert.match(scoreText, /Configuration-check score\s+\d+(\.\d)?%/);
  assert.match(scoreText, /Failed: jq\/version on jq/, 'the failed jq check stays listed');
  assert.match(await panelText('actions'), /Blocker — The check jq\/version failed on jq/);
  // The claims behind the count: the failed precheck, the applied repair and the recheck stay visible.
  const claimItems = await page.locator('#report-claims li').allInnerTexts();
  for (const id of verifiedIds) {
    const own = claimItems.filter(text => text.startsWith(`${id} on npm`));
    assert.ok(own.some(text => /Value: failed/.test(text)), `${id}: the failed precheck claim is listed`);
    assert.ok(own.some(text => /Value: passed/.test(text)), `${id}: the passing recheck claim is listed`);
  }
  assert.match(claimItems.join('\n'), /Kind: Measured/);
  // The recheck ran with the configuration the repair persisted; a verified repair shows the values Core applied for it.
  const persistedApplied = claimItems.filter(text => /^persisted configuration \S+ found by the re-check of npm/.test(text) && /Value: applied/.test(text)).map(text => text.split('\n')[0]);
  if (verifiedIds.length) assert.ok(persistedApplied.length > 0, `a verified repair shows the persisted values its recheck applied: ${JSON.stringify(claimItems)}`);
  assert.match(await panelText('repairs'), /Operation: node-npm-ca/);
  await shot('02-report-after-repair.png');
  const afterRepair = { verified: verifiedIds, attempts: shown, persistedApplied, score: scoreText.slice(0, 200) };

  // 4. A second machine check is a new observation, not another win.
  await page.goto(`${origin}/readiness.html`, { waitUntil: 'domcontentloaded' });
  await page.fill('#targets', 'jq, npm');
  await check();
  await openReport();
  assert.match(await panelText('repairs'), new RegExp(`^Verified repairs\\s+${verifiedIds.length}\\s+${verifiedIds.length} verified repair`));
  assert.equal((await attemptsShown()).filter(text => /^Counted — /.test(text)).length, verifiedIds.length);
  assert.match(await page.textContent('#report-status'), /3 readiness records/);
  await shot('03-report-after-recheck.png');

  // 5. UI and headless rendering are the same words for the same records.
  const payload = received;
  assert.equal(payload.status, 'ok');
  const { projection } = payload.value;
  assert.equal(await page.inputValue('#report-text'), reportText(projection), '#report-text is reportText(projection)');
  const strings = value => [value.title, value.summary, value.value, ...value.items.flatMap(entry => [entry.text, ...entry.details]), ...(value.sections ?? []).flatMap(strings)].filter(text => typeof text === 'string' && text);
  const meanings = [...new Set(Object.values(reportPanels(projection)).flatMap(strings))];
  assert.ok(meanings.length > 20, `expected a full report, got ${meanings.length} meanings`);
  const visible = (await Promise.all(['score', 'repairs', 'actions', 'claims', 'context', 'observations'].map(async name => {
    assert.equal(await page.locator(`#report-${name}`).isVisible(), true, `#report-${name} is visible`);
    return panelText(name);
  }))).join('\n');
  const missing = meanings.filter(meaning => !visible.includes(meaning));
  assert.deepEqual(missing, [], 'every meaning string of reportPanels is in the visible panels');
  assert.match(await page.textContent('label[for="report-text"]'), /same records and the same words/);

  assert.deepEqual(errors, [], 'no uncaught page errors');
  assert.equal(await npmrcState(), realNpmrcBefore, "the real home's .npmrc is untouched");
  if (requireVerified) assert.equal(verifiedIds.length, 1, 'AIH_REPORT_REQUIRE_VERIFIED=1 needs exactly one verified repair');
  const summary = { status: 'passed', chromium: browser.version(), origin, port: Number(new URL(origin).port || (new URL(origin).protocol === 'https:' ? 443 : 80)), verifiedRepairDemonstrated: verifiedIds.length === 1,
    verifiedRepairs: verifiedIds.length, note: verifiedIds.length ? undefined : 'No npm condition failed in both configurations before the repair in this environment, so the report counted none; nothing was invented.',
    beforeAnyCheck: empty, afterRepair, npmRows, equivalence: { meanings: meanings.length, textEqual: true, missing: missing.length },
    recordsInReport: payload.value.records, screenshots };
  const summaryPath = join(evidence, 'report-evidence.json');
  await writeFile(summaryPath, JSON.stringify(summary, null, 2));
  console.log('Report Chromium demonstration passed.');
  console.log(`verified repairs: ${verifiedIds.length} (${verifiedIds.join(', ') || 'none: no npm condition failed in both configurations before the repair'})`);
  for (const path of screenshots) console.log(`screenshot: ${path}`);
  console.log(`evidence: ${summaryPath}`);
} finally {
  clearTimeout(deadline);
  await browser?.close().catch(() => {});
  stopPreview();
  await rm(inside(work, evidence) ? join(work, 'fixture') : work, { recursive: true, force: true }).catch(() => {});
}
