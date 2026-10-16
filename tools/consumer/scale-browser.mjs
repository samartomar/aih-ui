import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startConsumer } from './server.mjs';
import { readAuthoring } from 'aih-ui/authoring';
import { digest } from './scale-fixture.mjs';

export async function proveScaleBrowser({ output, policyPath, frameworks, evidencePath, expected, inventories, evidenceBytes }) {
  if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE to an installed Playwright module URL.');
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  // No projectRoot: execution remains unavailable, including for uploaded data.
  const started = await startConsumer();
  let browser, page;
  const errors = [], requests = []; let client;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
    const context = await browser.newContext({ acceptDownloads: true });
    page = await context.newPage(); page.setDefaultTimeout(30_000);
    const observe = p => {
      p.on('pageerror', error => errors.push(error.message));
      p.on('request', request => { if (request.url().includes('/api/')) requests.push(new URL(request.url()).pathname); client = request.headers()['x-aih-client'] ?? client; });
    };
    observe(page);
    await page.goto(`${started.origin}/authoring`);
    await page.locator('#summary').filter({ hasText: '"roots"' }).waitFor();
    for (const [index, framework] of frameworks.entries()) {
      await page.locator('#intake').setInputFiles(join(output, `framework-${index + 1}.snapshot.json`));
      await page.locator('#intake-result').filter({ hasText: framework.inventory.release.sha256 }).waitFor();
    }
    const catalog = await (await context.request.get(`${started.origin}/api/authoring-catalog`, { headers: { 'x-aih-client': client } })).json();
    const scenarioReleases = new Set(inventories.map(inventory => inventory.release.sha256));
    const scenarioItems = catalog.items.filter(item => scenarioReleases.has(item.root.releaseSha256));
    assert.equal(scenarioItems.length, 1800);
    const itemKey = (releaseSha256, itemId) => `${releaseSha256}/${itemId}`;
    assert.deepEqual(scenarioItems.map(item => itemKey(item.root.releaseSha256, item.id)).sort(),
      inventories.flatMap(inventory => inventory.release.items.map(item => itemKey(inventory.release.sha256, item.id))).sort());
    const ordinaryFamilies = ['Extensions', 'ECC', 'Superpowers', 'Anthropic'];
    const ordinaryFamilyCounts = Object.fromEntries(ordinaryFamilies.map(family => [family, catalog.items.filter(item => item.family === family).length]));
    for (const family of ordinaryFamilies) assert.ok(ordinaryFamilyCounts[family] > 0, `Missing ordinary family: ${family}`);
    assert.equal(catalog.executionAvailable, false);
    assert.equal(await page.locator('#prepare').isDisabled(), true);
    await page.locator('#open').setInputFiles(policyPath);
    await page.locator('#proposal').filter({ hasText: 'Original bytes retained' }).waitFor();
    await page.locator('#review-file').setInputFiles(evidencePath);
    await page.locator('#review-facts').filter({ hasText: 'Original evidence bytes loaded' }).waitFor();
    await page.locator('#reopen').click();
    await page.locator('#proposal').filter({ hasText: '"editing": "available"' }).waitFor();
    // Ordinary UI selection action composes the same 300-item draft through the
    // installed public validators. No mocked validity or special scale route.
    await page.locator('#search').fill('scale1.item002');
    await page.locator('#support-filter').selectOption('all');
    await page.locator('#target').selectOption('generic');
    assert.match(await page.locator('#items').textContent(), /unknown · native-loading/);
    await page.getByRole('button', { name: 'Choose scale1.item002', exact: true }).click();
    await page.locator('#accept:not([disabled])').waitFor(); await page.locator('#accept').click();
    assert.deepEqual(JSON.parse(await page.locator('#policy').inputValue()), expected.policy);
    const downloadPromise = page.waitForEvent('download'); await page.locator('#save').click();
    const downloadedPath = join(output, 'policy.downloaded.json'); await (await downloadPromise).saveAs(downloadedPath);
    const downloadedBytes = new Uint8Array(await readFile(downloadedPath));
    assert.deepEqual(downloadedBytes, expected.policyBytes);
    // A fresh browser context has no page state, loaded reports or policy cache.
    const freshContext = await browser.newContext({ acceptDownloads: true });
    page = await freshContext.newPage(); observe(page); page.setDefaultTimeout(30_000);
    await page.goto(`${started.origin}/authoring`);
    await page.locator('#summary').filter({ hasText: '"roots"' }).waitFor();
    await page.locator('#open').setInputFiles(downloadedPath);
    await page.locator('#proposal').filter({ hasText: 'Original bytes retained' }).waitFor();
    // Fresh pages must explicitly reacquire their portable snapshots, too.
    for (const [index, framework] of frameworks.entries()) {
      await page.locator('#intake').setInputFiles(join(output, `framework-${index + 1}.snapshot.json`));
      await page.locator('#intake-result').filter({ hasText: framework.inventory.release.sha256 }).waitFor();
    }
    await page.locator('#reopen').click();
    // #24: missing evidence is reported as unverified applicability and does not block editing.
    await page.locator('#proposal').filter({ hasText: '"applicability": "unverified"' }).waitFor();
    await page.locator('#review-file').setInputFiles(evidencePath);
    await page.locator('#review-facts').filter({ hasText: 'Original evidence bytes loaded' }).waitFor();
    await page.locator('#reopen').click();
    await page.locator('#proposal').filter({ hasText: '"applicability": "applies"' }).waitFor();
    const reopened = await readAuthoring({ policyBytes: downloadedBytes, inventories, reviewEvidence: [evidenceBytes] });
    assert.equal(reopened.value.editing, 'available'); assert.equal(reopened.value.policy.selections.length, 300);
    assert.deepEqual(JSON.parse(await page.locator('#policy').inputValue()), reopened.value.policy);
    assert.deepEqual(JSON.parse(await page.locator('#summary').innerText()).reviews, expected.intent.reviews);
    const repeatPromise = page.waitForEvent('download'); await page.locator('#save').click();
    const repeatPath = join(output, 'policy.fresh-download.json'); await (await repeatPromise).saveAs(repeatPath);
    assert.deepEqual(new Uint8Array(await readFile(repeatPath)), downloadedBytes);
    await page.locator('main > section').first().screenshot({ path: join(output, 'functional-scale-browser.png') });
    assert.deepEqual(errors, []);
    assert.ok(requests.every(path => !/authoring-(prepare|apply|remove|managed|authority)$/.test(path)));
    return { browser: browser.version(), inventoryItems: scenarioItems.length, totalInventoryItems: catalog.items.length,
      additionalInventoryItems: catalog.items.length - scenarioItems.length, ordinaryFamilyCounts,
      syntheticBrowseTarget: 'generic', syntheticSupportFilter: 'all', selectedItemsIncludingClosure: 300,
      downloadedSha256: digest(downloadedBytes), downloadedBytes: downloadedBytes.length, freshContext: true, missingEvidenceRefused: true, pageErrors: errors, apiRequests: requests, executionAvailable: false };
  } catch (error) {
    await writeFile(join(output, 'browser-failure.json'), JSON.stringify({ message: error.message, pageErrors: errors, apiRequests: requests, proposal: await page?.locator('#proposal').innerText().catch(() => '') }, null, 2));
    throw error;
  } finally {
    await browser?.close();
    started.server.closeAllConnections();
    await new Promise(resolve => started.server.close(resolve));
  }
}
