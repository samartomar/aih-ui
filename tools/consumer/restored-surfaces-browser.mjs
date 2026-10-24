import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Asserts, on the running page: the provenance strip's package and version labels, commit chips and read-only mirror
// badge; the masthead connection chip; the "Catalog index" and "Organization source policy" labels; the inspector's
// "Upstream provenance" heading, its three disabled policy-choice radios and "Staged policy delta"; the "Telemetry"
// heading; and the review "Signals" disclosure. None of these may be removed without the maintainer's approval.
// requireCommitChips: the served packages must record Git commits (a manifest candidate), so the chips are checked.
export async function runRestoredSurfacesBrowser({ origin, output, playwrightModule, requireCommitChips = false, theme = 'dark' }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  // The page renders commit chips only for packages whose recorded commit is a Git object name.
  const summary = await (await fetch(origin + '/summary.json')).json();
  const commits = summary.packages.map(pkg => pkg.commit).filter(commit => /^[0-9a-f]{7,40}$/.test(commit ?? ''));
  if (requireCommitChips) assert.equal(commits.length, summary.packages.length, 'Every served package records the commit it was packed from.');
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
    page.setDefaultTimeout(30_000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/');
    await page.locator('#browse-family option[value="Extensions"]').waitFor({ state: 'attached' });
    if (await page.locator('#setup-dialog').isVisible()) {
      await page.getByRole('radio', { name: /Vibe coder/ }).check();
      for (let step = 0; step < 4; step++) await page.locator('#setup-next').click();
      await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
    }
    const destination = `Switch to ${theme} mode`;
    if (await page.getByRole('button', { name: destination, exact: true }).count()) await page.getByRole('button', { name: destination, exact: true }).click();

    const strip = page.locator('#provenance-strip');
    await strip.getByText('read-only-mirror', { exact: true }).waitFor();
    for (const pkg of summary.packages) {
      const name = `@aihq/${pkg.name}`;
      assert.ok(await strip.getByText(`${name} ${pkg.version}`, { exact: true }).isVisible(), `The provenance strip names ${name} ${pkg.version}.`);
    }
    for (const commit of commits) assert.ok(await strip.getByText(commit.slice(0, 7), { exact: true }).isVisible(), `The provenance strip shows commit ${commit.slice(0, 7)}.`);

    assert.match(await page.locator('#masthead-status').textContent(), /ENABLED · Not connected/, 'The masthead keeps its connection chip.');
    assert.ok(await page.getByText('CATALOG INDEX · READ-ONLY MIRROR', { exact: true }).isVisible(), 'The Catalog index label is shown.');
    await page.locator('.source-policy-details > summary').click();
    assert.ok(await page.getByText('Organization Source Policy:', { exact: true }).isVisible(), 'The Organization source policy label is shown.');
    assert.ok(await page.getByText('TELEMETRY', { exact: true }).isVisible(), 'The Telemetry heading is shown.');

    const signals = page.locator('#review-signals');
    assert.ok(await signals.locator('> summary').filter({ hasText: 'Signals' }).isVisible(), 'The review Signals disclosure is shown.');
    await signals.locator('> summary').click();
    assert.ok(await signals.locator('#review-summary').isVisible(), 'Opening Signals shows the review summary.');
    await signals.locator('> summary').click();

    await page.locator('#cards-grid [data-card-id]').first().click();
    const details = page.locator('#pane-details');
    await details.locator('summary').filter({ hasText: 'Source and provenance' }).click();
    assert.ok(await details.getByText('Upstream Provenance', { exact: true }).isVisible(), 'The inspector keeps its Upstream provenance heading.');
    await page.locator('#tab-security').click();
    const security = page.locator('#pane-security');
    const choices = security.locator('input[name="policy-choice"]');
    assert.equal(await choices.count(), 3, 'The inspector keeps its three policy-choice radios.');
    for (let index = 0; index < 3; index++) assert.ok(await choices.nth(index).isDisabled(), 'Each policy choice stays disabled: nothing records a determination.');
    for (const label of ['Keep held back (Recommended)', 'Not a real problem (False alarm)', 'Accept the risk and allow']) {
      await security.getByText(label, { exact: true }).scrollIntoViewIfNeeded();
      assert.ok(await security.getByText(label, { exact: true }).isVisible(), `The policy choice "${label}" is shown.`);
    }
    await page.locator('#tab-json').click();
    const delta = page.getByText('Staged Policy Delta', { exact: true });
    await delta.scrollIntoViewIfNeeded();
    assert.ok(await delta.isVisible(), 'The inspector keeps its Staged policy delta heading.');
    await page.screenshot({ path: join(output, 'restored-surfaces.png'), fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

// Run against an already running Workbench:
//   node tools/consumer/restored-surfaces-browser.mjs <origin> [output dir] [--require-commit-chips]
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2), requireCommitChips = args.includes('--require-commit-chips');
  const [origin, output = 'restored-surfaces-evidence'] = args.filter(arg => arg !== '--require-commit-chips');
  await runRestoredSurfacesBrowser({ origin, output, playwrightModule: process.env.PLAYWRIGHT_MODULE ?? 'playwright', requireCommitChips });
  console.log('Restored surfaces are present on the running page.');
}
