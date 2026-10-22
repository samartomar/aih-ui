import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInstalledRelease } from '@aihq/catalog/node';
import { intakePersonalFolder } from './personal-folder.mjs';
import { readAuthoring } from './headless.mjs';
import { installedFamilies } from './installed-families.mjs';

export async function runIntegratedBrowser({ origin, output, playwrightModule }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const folder = join(output, 'personal'), invalid = join(output, 'invalid'), marker = join(output, 'intake-executed');
  const sources = {
    LICENSE: 'MIT License\nCopyright 2026 Example\nPermission is hereby granted, free of charge.\n',
    'skills/example/SKILL.md': '---\nname: example\ndescription: Keep personal choices understandable.\nlicense: MIT\n---\n\nUse support/checklist.txt.\n',
    'skills/example/support/checklist.txt': 'Preserve exact choices and truthful origins.\n',
    'skills/example/intake-marker.mjs': `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed');\n`,
  };
  for (const [path, text] of Object.entries(sources)) { await mkdir(dirname(join(folder, path)), { recursive: true }); await writeFile(join(folder, path), text); }
  await mkdir(invalid, { recursive: true }); await writeFile(join(invalid, 'README.md'), 'Unrecognized format.');
  const browser = await chromium.launch({ headless: true });
  const errors = [], failedResponses = []; let observed;
  const pageSetup = async context => {
    const page = await context.newPage(); observed = page; page.setDefaultTimeout(30_000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 500) failedResponses.push(`${response.status()} ${response.url()}`); });
    await page.goto(origin + '/');
    await page.locator('#browse-family option[value="Extensions"]').waitFor({ state: 'attached' });
    if (await page.locator('#setup-dialog').isVisible()) {
      await page.getByRole('radio', { name: /Vibe coder/ }).check();
      // First-run Vibe setup: experience, AI clients, review.
      for (let step = 0; step < 3; step++) await page.locator('#setup-next').click();
      await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
    }
    return page;
  };
  try {
    const page = await pageSetup(await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } }));
    const policy = async p => JSON.parse(await p.locator('#policy-bytes').textContent());
    assert.deepEqual((await policy(page)).metadata['aih.workbench'].roots, []);
    for (const family of ['Extensions', 'ECC', 'Superpowers', 'Anthropic']) assert.equal(await page.locator(`#browse-family option[value="${family}"]`).count(), 1);
    assert.equal(await page.locator('iframe').count(), 0); assert.equal(new URL(page.url()).pathname, '/');
    await page.locator('#browse-family').selectOption('Extensions'); await page.locator('#catalog-search').fill('matt');
    assert.ok(await page.getByRole('button', { name: 'Choose extensions.matt.ask-matt', exact: true }).isVisible());
    await page.locator('#catalog-search').fill('');
    await page.locator('#rail-scope-list button').filter({ hasText: 'Extensions' }).first().click();
    await page.locator('#browse-family').selectOption('ECC');
    assert.ok(await page.getByRole('button', { name: 'Choose ecc.skill.accessibility', exact: true }).isVisible(), 'Changing families clears the alternate rail filter.');
    await page.locator('#browse-family').selectOption('Extensions');
    const before = await page.locator('#policy-bytes').textContent();
    await page.locator('#browse-support').selectOption('unknown'); assert.match(await page.locator('#support-counts').textContent(), /with unknown facts/);
    await page.locator('#browse-support').selectOption('all'); assert.equal(await page.locator('#policy-bytes').textContent(), before);
    await page.locator('#personal-folder').setInputFiles(invalid);
    await page.locator('#personal-result').filter({ hasText: 'LOCAL_FOLDER_INVALID' }).waitFor();
    await page.locator('#personal-folder').setInputFiles(folder);
    await page.locator('#personal-result').filter({ hasText: 'Folder validated' }).waitFor();
    await page.locator('#browse-family').selectOption('Personal');
    assert.equal(await page.locator('#cards-grid [data-card-id]').count(), 1);
    await page.locator('#cards-grid [data-card-id]').click();
    assert.match(await page.locator('#details-source').textContent(), /Local folder explicitly selected/);
    assert.match(await page.locator('#details-capabilities').textContent(), /native-execution/);
    assert.match(await page.locator('#details-capabilities').textContent(), /automatic-guardrails/);
    await page.screenshot({ path: join(output, 'personal-inspector.png'), fullPage: true });
    const selections = [['Personal', 'personal.skill.example'], ['Extensions', 'extensions.matt.ask-matt'], ['ECC', 'ecc.skill.accessibility'], ['Superpowers', 'superpowers.skill.brainstorming'], ['Anthropic', 'anthropic.skill.academy-guide']];
    for (const [family, id] of selections) {
      await page.locator('#nav-sources').click(); await page.locator('#browse-family').selectOption(family);
      await page.getByRole('button', { name: `Choose ${id}`, exact: true }).click();
      await page.locator('#policy-accept:not([disabled])').waitFor(); await page.locator('#policy-accept').click();
    }
    const saved = await policy(page); assert.equal(saved.metadata['aih.workbench'].roots.length, 5);
    assert.doesNotMatch(JSON.stringify(saved), /grantId|x-aih-client|hostPath/);
    await page.locator('#check-project-policy').click(); await page.locator('#policy-status').filter({ hasText: 'Policy and exact sources validated' }).waitFor();
    const download = page.waitForEvent('download'); await page.locator('#policy-save').click();
    const savedPath = join(output, 'policy.downloaded.json'); await (await download).saveAs(savedPath);
    const policyBytes = new Uint8Array(await readFile(savedPath));
    await page.screenshot({ path: join(output, 'policy-saved.png'), fullPage: true });
    const fresh = await pageSetup(await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } }));
    assert.equal(await fresh.locator('#browse-family option[value="Personal"]').count(), 0);
    await fresh.locator('#nav-policy').click(); await fresh.locator('#policy-open').setInputFiles(savedPath);
    await fresh.getByRole('button', { name: 'Validate and reopen', exact: true }).click();
    await fresh.locator('#policy-status').filter({ hasText: 'SOURCE_REVISION_UNAVAILABLE' }).waitFor();
    assert.equal(await fresh.locator('#policy-save').isDisabled(), true);
    await fresh.locator('#nav-sources').click(); assert.equal(await fresh.locator('#personal-binding option').count(), 2);
    await writeFile(join(folder, 'skills/example/support/checklist.txt'), 'Changed content.\n');
    await fresh.locator('#personal-folder').setInputFiles(folder);
    await fresh.locator('#personal-result').filter({ hasText: 'LOCAL_ROOT_CHANGED' }).waitFor();
    assert.deepEqual(await policy(fresh), saved);
    await writeFile(join(folder, 'skills/example/support/checklist.txt'), sources['skills/example/support/checklist.txt']);
    let releaseCatalog, observedCatalog; const gate = new Promise(resolve => { releaseCatalog = resolve; }); const observedGate = new Promise(resolve => { observedCatalog = resolve; });
    await fresh.route('**/api/authoring-catalog', async route => { const response = await route.fetch(); observedCatalog(); await gate; await route.fulfill({ response }); });
    await fresh.locator('#personal-folder').setInputFiles(folder); await observedGate;
    assert.doesNotMatch(await fresh.locator('#personal-result').textContent(), /Exact folder rebound/);
    releaseCatalog(); await fresh.locator('#personal-result').filter({ hasText: 'Exact folder rebound' }).waitFor(); await fresh.unroute('**/api/authoring-catalog');
    await fresh.locator('#nav-policy').click(); await fresh.getByRole('button', { name: 'Validate and reopen', exact: true }).click();
    await fresh.locator('#policy-status').filter({ hasText: 'Saved choices recovered' }).waitFor();
    assert.deepEqual((await policy(fresh)).metadata['aih.workbench'].roots, saved.metadata['aih.workbench'].roots);
    assert.deepEqual((await policy(fresh)).selections, saved.selections);
    const personal = await intakePersonalFolder({ files: Object.entries(sources).map(([path, text]) => ({ path, bytes: [...new TextEncoder().encode(text)] })) }); assert.equal(personal.status, 'ok');
    const maintained = await readInstalledRelease({ root: dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'))), sourceInput: 'maintained' });
    const headless = await readAuthoring({ policyBytes, inventories: [{ release: maintained.release, materialSource: { kind: 'local', input: 'maintained' } }, ...await installedFamilies(), personal.value] });
    assert.equal(headless.value.editing, 'available', JSON.stringify(headless));
    assert.deepEqual(headless.value.intent.roots, saved.metadata['aih.workbench'].roots); assert.deepEqual(headless.value.policy.selections, saved.selections);
    await assert.rejects(access(marker)); assert.deepEqual(errors, []); assert.deepEqual(failedResponses, []);
    await fresh.screenshot({ path: join(output, 'fresh-rebound.png'), fullPage: true });
    await writeFile(join(output, 'browser-evidence.json'), JSON.stringify({ status: 'passed', entry: '/', chromium: browser.version(), roots: saved.metadata['aih.workbench'].roots,
      scenarios: ['existing-shell', 'four-installed-families', 'matt-extensions', 'target-support-facts', 'filters-preserve-artifact', 'invalid-folder', 'local-provenance', 'five-root-proposals', 'actual-policy-download', 'fresh-reopen-refused', 'changed-root-refused', 'explicit-exact-rebind', 'catalog-ready-before-success', 'headless-agreement', 'no-code-executed'], errors }, null, 2));
    console.log(`Integrated ordinary Workbench journey passed: ${output}`);
  } catch (error) {
    await observed?.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {});
    await writeFile(join(output, 'failure.json'), JSON.stringify({ error: error.message, errors, text: await observed?.locator('body').innerText().catch(() => '') }, null, 2)); throw error;
  } finally { await browser.close(); }
}
