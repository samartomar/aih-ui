// The owner-testing page check: the served packages match the candidate's manifest, and the Workbench's pages open and show them.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, win32 } from 'node:path';

const refusal = (code, message) => Object.assign(new Error(message), { code });
// The manifest and the server may name a tarball with either separator; win32.basename accepts both on every platform.
const nameOf = path => (typeof path === 'string' ? win32.basename(path) : null);

export function compareIdentity(identity, packagesSummary) {
  const mismatches = [];
  if (packagesSummary?.ok !== true) mismatches.push('/api/packages did not report ok');
  for (const expected of identity.packages) {
    const actual = packagesSummary?.packages?.find(pkg => pkg.packageName === expected.name);
    if (!actual) { mismatches.push(`Missing package ${expected.name}`); continue; }
    for (const field of ['sha256', 'commit', 'tarball']) {
      const left = field === 'tarball' ? nameOf(expected[field]) : expected[field];
      const right = field === 'tarball' ? nameOf(actual[field]) : actual[field];
      if (!left || left !== right) mismatches.push(`${expected.name}: ${field} differs`);
    }
  }
  return mismatches;
}

export function compareRenderedIdentity(identity, { stripText = '', provenanceText = '' }) {
  const mismatches = [];
  for (const pkg of identity.packages) {
    if (!stripText.includes(pkg.name)) mismatches.push(`${pkg.name}: package name missing from strip`);
    if (!pkg.commit || !stripText.includes(pkg.commit.slice(0, 7))) mismatches.push(`${pkg.name}: short commit missing from strip`);
    for (const field of ['sha256', 'commit']) if (!pkg[field] || !provenanceText.includes(pkg[field])) mismatches.push(`${pkg.name}: full ${field} missing from provenance`);
  }
  return mismatches;
}

export async function smokeCandidate({ origin, identity, output, playwrightModule }) {
  const base = new URL(origin);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw refusal('CANDIDATE_SMOKE_ORIGIN', 'Expected an HTTP origin without credentials.');
  origin = base.origin;
  await mkdir(output, { recursive: true });
  const mismatches = [], missing = [], screenshots = [], log = [];
  const controller = new AbortController(), deadline = Date.now() + 120_000;
  let browser, expired = false, timer;
  const remaining = () => {
    const ms = deadline - Date.now();
    if (expired || ms <= 0) throw refusal('CANDIDATE_SMOKE_DEADLINE', 'Smoke check exceeded 120 s deadline');
    return Math.max(1, Math.min(5_000, ms));
  };
  const noteMissing = selector => { if (!missing.includes(selector)) missing.push(selector); };
  async function run() {
    try {
      const response = await fetch(origin + '/api/packages', { redirect: 'manual', signal: controller.signal });
      if (!response.ok) throw Error(`/api/packages: HTTP ${response.status}`);
      mismatches.push(...compareIdentity(identity, await response.json()));
    } catch (error) { mismatches.push(`Package check failed: ${error.message}`); }
    remaining();
    const { chromium } = await import(playwrightModule);
    remaining();
    browser = await chromium.launch({ headless: true, timeout: Math.max(1, deadline - Date.now()) });
    if (expired) { await browser.close(); return; }
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.setDefaultTimeout(5_000);
    await page.route('**/*', route => {
      const request = route.request();
      if (request.isNavigationRequest() && new URL(request.url()).origin !== origin) return route.abort();
      return route.continue();
    });
    async function go(path) { await page.goto(origin + path, { waitUntil: 'domcontentloaded', timeout: remaining() }); }
    async function find(selector) {
      const node = page.locator(selector).first();
      try { await node.waitFor({ state: 'visible', timeout: remaining() }); return node; }
      catch (error) { remaining(); noteMissing(selector); log.push(`${selector}: ${error.message}`); return null; }
    }
    async function dismissSetup() {
      const dialog = page.locator('#setup-dialog');
      if (!await dialog.isVisible()) return;
      await page.keyboard.press('Escape');
      if (!await dialog.isVisible()) return;
      const close = dialog.locator('#setup-cancel, #setup-skip, button[aria-label="Close"]').filter({ visible: true }).first();
      if (await close.count() && await close.isEnabled()) await close.click({ timeout: remaining() });
      if (await dialog.isVisible()) {
        // First-run setup deliberately prevents Escape; dismiss only the modal, without saving setup.
        await dialog.evaluate(node => node.close());
        log.push('Closed first-run setup modal without completing setup');
      }
      if (await dialog.isVisible()) noteMissing('#setup-dialog dismissal');
    }
    async function capture(name, action) {
      try {
        remaining();
        if (action) await action();
        await page.screenshot({ path: join(output, name), fullPage: true, timeout: remaining() });
        screenshots.push(name);
      } catch (error) { remaining(); noteMissing(name); log.push(`${name}: ${error.message}`); }
    }
    await go('/');
    const strip = await find('#provenance-strip');
    if (strip) {
      try {
        await page.waitForFunction(names => names.every(name => document.querySelector('#provenance-strip')?.textContent.includes(name)), identity.packages.map(pkg => pkg.name), { timeout: remaining() });
      } catch { log.push('Strip did not show every package before timeout'); }
    }
    await capture('01-personal-setup.png');
    // Later screenshots show each journey's own start page: first-run setup is kept from reopening over them, and nothing is saved.
    await page.addInitScript(() => {
      const showModal = HTMLDialogElement.prototype.showModal;
      HTMLDialogElement.prototype.showModal = function () { if (this.id !== 'setup-dialog') return showModal.call(this); };
    });
    await dismissSetup();
    // The strip's diagnostics disclosure, labelled Packages in the Workbench shell.
    const disclosure = page.locator('#provenance-strip details').filter({ has: page.locator('summary').filter({ hasText: /^\s*packages\b/i }) }).first();
    let provenanceText = '';
    if (await disclosure.count()) {
      if (!await disclosure.evaluate(node => node.open)) await disclosure.locator('summary').first().click({ timeout: remaining() });
      provenanceText = await disclosure.textContent() ?? '';
    } else noteMissing('#provenance-strip details > summary: Packages');
    mismatches.push(...compareRenderedIdentity(identity, { stripText: strip ? await strip.textContent() ?? '' : '', provenanceText }));
    await capture('02-readiness.png', () => go('/readiness.html'));
    await capture('03-guided.png', () => go('/guided.html'));
    async function policy() {
      await go('/'); await dismissSetup();
      // Policy workspace and the authority, workspace, improvement and trial sections sit in Advanced sections (#115).
      await page.evaluate(() => { const advanced = document.getElementById('catalog-advanced'); if (advanced) advanced.open = true; });
      const nav = await find('#nav-policy');
      if (nav) await nav.click({ timeout: remaining() });
      await page.evaluate(() => {
        if (document.getElementById('policy-review-panel')?.hidden) document.getElementById('your-setup')?.click();
        for (const section of document.querySelectorAll('#setup-advanced, #setup-advanced details')) section.open = true;
      });
    }
    async function scroll(selector, open = false) {
      const node = await find(selector);
      if (!node) return;
      if (open) await node.evaluate(element => { element.open = true; });
      await node.scrollIntoViewIfNeeded({ timeout: remaining() });
    }
    await capture('04-policy-authority-source.png', async () => { await policy(); await scroll('#authority-source'); });
    await capture('05-organization-author.png', () => scroll('#organization-author', true));
    await capture('06-workspace.png', () => scroll('#policy-repositories'));
    await capture('07-batch.png', () => go('/batch.html'));
    await capture('08-improvements.png', async () => { await policy(); await scroll('#policy-improvements'); });
    await capture('09-trials.png', () => scroll('#policy-trials'));
    await capture('10-sources.png', async () => {
      await dismissSetup(); const nav = await find('#nav-sources'); if (nav) await nav.click({ timeout: remaining() });
    });
  }
  try {
    await Promise.race([run(), new Promise((_, reject) => {
      timer = setTimeout(() => { expired = true; controller.abort(); reject(refusal('CANDIDATE_SMOKE_DEADLINE', 'Smoke check exceeded 120 s deadline')); }, Math.max(1, deadline - Date.now()));
    })]);
  } catch (error) { mismatches.push(`Smoke check failed: ${error.message}`); }
  finally {
    expired = true; clearTimeout(timer); controller.abort();
    if (browser) await browser.close().catch(error => log.push(`Browser close: ${error.message}`));
  }
  const result = { ok: mismatches.length === 0, mismatches, missing, screenshots };
  await writeFile(join(output, 'smoke.json'), JSON.stringify({ ...result, origin, checkedAt: new Date().toISOString() }, null, 2) + '\n');
  await writeFile(join(output, 'smoke.log'), [...log, ...mismatches, ...missing.map(item => `Missing: ${item}`), ...screenshots.map(item => `Screenshot: ${item}`), `ok: ${result.ok}`].join('\n') + '\n');
  return result;
}
