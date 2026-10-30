import { chooseCatalogFamily } from './policy-drawer.mjs';
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInstalledRelease } from '@aihq/catalog/node';
import { installedFamilies } from './installed-families.mjs';
import { openPolicySection } from './policy-drawer.mjs';
import { UPDATE_SOURCE_DEFAULT_RELEASE as DEFAULT_RELEASE } from './update-source.mjs';

// V0b missing default release, on the running page. The host's update source lists the installed Catalog package root and
// a copy of it whose package no longer exports the frozen default ./release.json. Both roots read online, and the page
// shows the same frameworks and the same installed content as a host with no update source configured.

const escaped = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const installedRoot = () => dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));

// Test setup, never a Workbench action: copies the installed packed Catalog to `directory` and removes the default release
// from its export map and its file, the way a Catalog that stops shipping it would be packed. Returns the copy's root.
export async function missingDefaultReleaseRoot(directory) {
  const root = resolve(directory, 'package');
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await cp(installedRoot(), root, { recursive: true });
  const manifestPath = join(root, 'package.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const file = resolve(root, manifest.exports[DEFAULT_RELEASE]);
  if (!file.startsWith(root + sep)) throw new Error('The default release export escapes the package copy.');
  delete manifest.exports[DEFAULT_RELEASE];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  await rm(file);
  return root;
}

// `baselineOrigin` serves the same packages with the maintenance test fixture as its source; `origin` is the host whose update source lists
// [installed root, fixtureRoot], oldest first.
export async function runMissingDefaultReleaseBrowser({ origin, baselineOrigin, output, playwrightModule, fixtureRoot, theme = 'dark', item = 'extensions.matt.grill-me' }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  // The fixture really has no default release, and its families read with the installed families' exact releases.
  const missing = await readInstalledRelease({ root: fixtureRoot, release: DEFAULT_RELEASE, sourceInput: 'maintained' });
  assert.equal(missing.valid, false, 'The fixture root does not offer a default release.');
  const [installedDefault, installed, fixture] = [await readInstalledRelease({ root: installedRoot(), sourceInput: 'maintained' }), await installedFamilies(), await installedFamilies({ root: fixtureRoot })];
  assert.deepEqual(fixture.map(entry => [entry.family, entry.release.sha256]), installed.map(entry => [entry.family, entry.release.sha256]), 'The installed families read from the root without a default release.');
  // Without a default release, a root's first release read is its first family release.
  const firstFamily = (await readInstalledRelease({ root: installedRoot(), release: './release-extensions.json', sourceInput: 'maintained' })).release.sha256;

  const browser = await chromium.launch({ headless: true });
  const errors = [], consoleErrors = [];
  const open = async at => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude'));
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.goto(at + '/');
    await page.locator('#browse-family option[value="Extensions"]').waitFor({ state: 'attached' });
    if (await page.locator('#setup-dialog').isVisible()) {
      await page.getByRole('radio', { name: /Vibe coder/ }).check();
      for (let step = 0; step < 3; step++) await page.locator('#setup-next').click();
      await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
    }
    const destination = `Switch to ${theme} mode`;
    if (await page.getByRole('button', { name: destination, exact: true }).count()) await page.getByRole('button', { name: destination, exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.mode), theme, `The page shows the ${theme} theme.`);
    return page;
  };
  // What the person browses: the framework choices and the exact catalog content the page was served.
  const shown = async page => ({
    frameworks: await page.locator('#browse-family option').evaluateAll(options => options.map(option => [option.value, option.textContent.trim()])),
    content: (await page.evaluate(async () => (await (await fetch('/api/authoring-catalog')).json()).items.map(entry => `${entry.root?.releaseSha256}/${entry.id}`))).sort()
  });
  try {
    const baseline = await shown(await open(baselineOrigin));
    const page = await open(origin), current = await shown(page);
    assert.deepEqual(current.frameworks, baseline.frameworks, 'The same frameworks are listed.');
    assert.deepEqual(current.content, baseline.content, 'The same installed content is served.');
    assert.ok(current.content.length > 0, 'The page was served installed content.');
    await page.screenshot({ path: join(output, `missing-default-release-catalog-${theme}.png`) });

    // A setup to check, then Available updates, which checks the host's update source when it opens.
    await chooseCatalogFamily(page, 'Extensions');
    await page.locator('#catalog-search').fill(item.split('.').at(-1));
    await page.getByRole('button', { name: `Add ${item}`, exact: true }).click();
    await page.locator('#added-notice-message').filter({ hasText: /^Added / }).waitFor();
    await page.locator('#added-notice-dismiss').click();
    await openPolicySection(page, 'Available updates');
    await page.waitForFunction(() => {
      const text = document.getElementById('policy-updates-checked')?.textContent ?? '';
      return text !== '' && !text.startsWith('Checking') && !/unknown until checked/.test(text);
    });
    const lines = await page.locator('#policy-updates-source p').allInnerTexts();
    assert.equal(lines.length, 3, JSON.stringify(lines));
    assert.match(lines[0], /^Update source: 2 Catalog package roots configured by this host\./);
    // The root with a default release behaves as before: it is read, and it names that release.
    assert.match(lines[1], new RegExp(`^${escaped(`Source 1: ${installedDefault.release.package.name} ${installedDefault.release.package.version} · release ${installedDefault.release.sha256} — read `)}`));
    // The root without one is online too, read from its family releases.
    assert.match(lines[2], new RegExp(`^${escaped(`Source 2: ${installedDefault.release.package.name} ${installedDefault.release.package.version} · release ${firstFamily} — read `)}`));
    assert.equal(lines.some(line => /offline/.test(line)), false, 'No configured root is offline.');
    assert.deepEqual(await page.locator('#policy-updates-categories p').allInnerTexts(), ['Content: checked', 'Software: not selected', 'Client: not selected', 'Environment: not selected']);
    await page.locator('#policy-updates').screenshot({ path: join(output, `missing-default-release-updates-${theme}.png`) });
    assert.deepEqual(errors, [], 'The page raised no errors.');
    assert.deepEqual(consoleErrors, [], 'The page logged no console errors.');
    await writeFile(join(output, `missing-default-release-${theme}.json`), JSON.stringify({ theme, frameworks: current.frameworks, contentCount: current.content.length, sourceLines: lines }, null, 2) + '\n');
    console.log(`V0b missing default release passed on the running page (${theme}).`);
  } finally { await browser.close(); }
}
