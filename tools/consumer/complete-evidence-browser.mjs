// Complete-candidate acceptance, through the ordinary page and public installed contracts.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { installedFamilies } from './installed-families.mjs';
import { createScanEvidenceHost } from './scan-evidence-host.mjs';
import { authenticateEvidence } from '@aihq/core';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function runCompleteEvidenceBrowser({ plan, output, playwrightModule, authoringModule }) {
  const began = performance.now();
  const { readAuthoring } = await import(authoringModule);
  await mkdir(output, { recursive: true });
  const original = {};
  for (const name of ['baseline', 'later', 'trust']) {
    original[name] = new Uint8Array(await readFile(plan[name].path));
    assert.equal(hash(original[name]), plan[name].sha256, `${name} original identity`);
    assert.notEqual(resolve(plan.discoveryPath), resolve(plan[name].path), 'Discovery scratch must never overwrite an original');
  }
  const trust = JSON.parse(new TextDecoder().decode(original.trust));
  const families = await installedFamilies(), inventory = families.find(value => value.family === plan.family);
  assert.ok(inventory);
  const item = inventory.release.items.find(value => value.id === plan.itemId);
  assert.ok(item);
  assert.equal(inventory.release.baseline.scanId, plan.baseline.scanId);
  // The configurable source starts unreadable; Catalog's genuine pinned baseline is still independently available.
  await mkdir(dirname(plan.discoveryPath), { recursive: true });
  await writeFile(plan.discoveryPath, 'No later assessment adopted yet.');
  const packageRoot = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
  const headless = createScanEvidenceHost({ sources: [{ id: plan.sourceId, path: plan.discoveryPath, format: 'artifact' }], packageRoot, trust });
  const { chromium } = await import(playwrightModule), browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); page.setDefaultTimeout(60_000);
  const errors = [], checks = [], facts = [];
  page.on('pageerror', error => errors.push(error.message));
  const panel = page.getByRole('region', { name: 'Latest Scan evidence' });
  const download = async (name, action) => {
    const event = page.waitForEvent('download'); await action();
    const file = join(output, name); await (await event).saveAs(file); return new Uint8Array(await readFile(file));
  };
  const check = async expected => {
    const event = page.waitForResponse(value => value.url().endsWith('/api/authoring-scan-evidence'));
    await panel.getByRole('button', { name: 'Check Scan evidence', exact: true }).click();
    const result = await (await event).json();
    assert.equal(result.status, 'selected', JSON.stringify(result.diagnostics));
    assert.equal(result.selectedScanId, expected);
    assert.equal(result.baseline.scanId, plan.baseline.scanId);
    const same = await headless.check({ inventory, itemId: item.id, evaluationTime: result.evaluationTime });
    assert.equal(same.selectedScanId, result.selectedScanId);
    const project = value => value.assessments.map(entry => ({ summary: entry.summary, coverage: entry.coverage, comparisonCoverage: entry.comparisonCoverage,
      authentication: entry.acquisitions.map(value => value.authentication) }));
    assert.deepEqual(project(same), project(result), 'Browser and public headless facts, findings, gaps and authentication agree');
    checks.push({ expected, result, headless: same });
    await writeFile(join(output, `check-${checks.length}.json`), JSON.stringify(checks.at(-1), null, 2));
    return result;
  };
  try {
    await page.goto(plan.origin + '/');
    await page.locator('#browse-family option[value="ECC"]').waitFor({ state: 'attached' });
    assert.equal(await page.locator('#setup-dialog').isVisible(), false, 'Existing actual local setup must survive upgrade');
    await page.locator('#browse-support').selectOption('all');
    for (const family of families) {
      await page.locator('#browse-family').selectOption(family.family);
      const card = page.locator('#cards-grid [data-card-id]').first(); await card.click();
      const key = await card.getAttribute('data-card-id'), selected = family.release.items.find(value => `${family.release.sha256}/${value.id}` === key);
      assert.ok(selected);
      assert.ok((await page.locator('#details-source').textContent()).includes(selected.metadata.sourceFacts.provenance.sha256));
      if (selected.metadata.sourceFacts.description.state === 'present') assert.equal(await page.locator('#details-desc').textContent(), selected.metadata.sourceFacts.description.value);
      facts.push({ family: family.family, key, sourceFacts: selected.metadata.sourceFacts, releaseSha256: family.release.sha256 });
    }
    await page.locator('#browse-family').selectOption(plan.family);
    await page.locator(`[data-card-id="${inventory.release.sha256}/${item.id}"]`).click();
    await page.getByRole('button', { name: `Choose ${item.id}`, exact: true }).click();
    await page.locator('#policy-accept:not([disabled])').waitFor(); await page.locator('#policy-accept').click();
    await page.locator('#nav-sources').click();
    await page.locator(`[data-card-id="${inventory.release.sha256}/${item.id}"]`).click();
    await page.locator('#tab-security').click();
    await page.getByRole('button', { name: 'Review baseline, latest and history', exact: true }).click();
    assert.equal(await panel.getByLabel('Scan content', { exact: true }).inputValue(), `${inventory.release.sha256}/${item.id}`);
    const first = await check(plan.baseline.scanId);
    assert.ok(first.baseline.evidence.acquisitions.some(value => value.authentication.status === 'authenticated'));
    assert.equal(first.baseline.evidence.coverage.status, 'matched');
    await panel.getByRole('button', { name: 'Use this exact assessment for a human review', exact: true }).click();
    await page.getByLabel('Evidence review subject', { exact: true }).selectOption(`${inventory.release.sha256}/${item.id}`);
    await page.getByRole('button', { name: 'Inspect evidence', exact: true }).click();
    await page.getByRole('button', { name: 'Propose human review', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Propose human review', exact: true }).isEnabled(), true);
    await page.getByLabel('Review decision ID', { exact: true }).fill('local-delivery-demonstration');
    await page.getByLabel('Review owner kind', { exact: true }).selectOption('individual');
    await page.getByLabel('Review owner', { exact: true }).fill('delivery-demonstration');
    await page.getByLabel('Reviewer', { exact: true }).fill('delivery-demonstration');
    await page.getByLabel('Review disposition', { exact: true }).selectOption('accepted-risk');
    await page.getByLabel('Review reason', { exact: true }).fill('Demonstration record against original genuine evidence; this is not a safety approval or an owner judgment.');
    await page.getByRole('button', { name: 'Propose human review', exact: true }).click();
    await page.locator('#policy-accept:not([disabled])').waitFor(); await page.locator('#policy-accept').click();
    const reviewed = await download('reviewed-policy.json', () => page.locator('#policy-save').click());
    const document = JSON.parse(new TextDecoder().decode(reviewed));
    assert.equal(document.metadata['aih.workbench'].reviews.records.length, 1);
    // An explicit policy edit, before preparation/discovery, associates exact optional S1 evidence.
    document.evidence = [{ schema: 'urn:aihq:scan:evidence-association:1.0.0', scanId: plan.baseline.scanId, location: { kind: 'file', path: plan.baseline.path } }];
    const pinned = join(output, 'explicit-optional-evidence-policy.json'); await writeFile(pinned, JSON.stringify(document, null, 2) + '\n');
    await page.locator('#policy-open').setInputFiles(pinned);
    await page.getByRole('button', { name: 'Validate and reopen', exact: true }).click();
    await page.locator('#policy-status').filter({ hasText: 'Saved choices recovered' }).waitFor();
    const before = await download('before-policy.json', () => page.locator('#policy-save').click());
    const preparationEvent = page.waitForResponse(value => value.url().endsWith('/api/authoring-prepare'));
    await page.getByRole('button', { name: 'Prepare exact effects', exact: true }).click();
    const preparation = await (await preparationEvent).json();
    assert.equal(preparation.status, 'ready', JSON.stringify(preparation));
    assert.ok(preparation.sessionId); assert.ok(preparation.review.reviewDigest);
    const held = page.locator('details').filter({ has: page.getByText('Exact host review and effects', { exact: true }) }).locator('pre');
    const beforeHeld = await held.textContent();
    await writeFile(join(output, 'held-preparation.json'), JSON.stringify(preparation, null, 2));
    await page.screenshot({ path: join(output, '01-genuine-baseline.png'), fullPage: true });
    await copyFile(plan.later.path, plan.discoveryPath);
    const later = await check(plan.later.scanId);
    assert.ok(later.assessments.find(entry => entry.summary.scanId === plan.later.scanId).acquisitions.some(value => value.authentication.status === 'authenticated'));
    await panel.getByLabel('Scan history', { exact: true }).selectOption(plan.baseline.scanId);
    await check(plan.later.scanId);
    assert.equal(await panel.getByLabel('Scan history', { exact: true }).inputValue(), plan.baseline.scanId);
    await page.screenshot({ path: join(output, '02-genuine-pinned-history.png'), fullPage: true });
    await writeFile(plan.discoveryPath, 'Unreadable source in an explicitly owned discovery copy.');
    const offline = await check(plan.later.scanId); assert.equal(offline.freshness, 'last-known');
    assert.equal(await panel.getByLabel('Scan history', { exact: true }).inputValue(), plan.baseline.scanId);
    await panel.getByRole('button', { name: 'Latest', exact: true }).click();
    await panel.getByRole('status').filter({ hasText: plan.later.scanId }).waitFor();
    await page.screenshot({ path: join(output, '03-last-known.png'), fullPage: true });
    await copyFile(plan.later.path, plan.discoveryPath); await check(plan.later.scanId);
    const after = await download('after-policy.json', () => page.locator('#policy-save').click());
    assert.deepEqual(after, before);
    assert.equal(await held.textContent(), beforeHeld);
    assert.equal(await page.getByRole('button', { name: 'Approve and Apply reviewed effects', exact: true }).isEnabled(), true);
    const reopened = await readAuthoring({ policyBytes: after, inventories: families, reviewEvidence: [original.baseline, original.later] });
    assert.equal(reopened.status, 'ok');
    assert.equal(reopened.value.reviewJudgments[0].applicability, 'applies');
    const authentication = await authenticateEvidence({ bytes: original.baseline, expectedScanId: plan.baseline.scanId, trust });
    assert.equal(authentication.status, 'authenticated');
    const downloaded = await download('original-latest.json', () => panel.getByRole('button', { name: 'Download original Scan evidence', exact: true }).click());
    assert.equal(hash(downloaded), plan.later.sha256);
    assert.deepEqual(errors, []);
    const receipt = { status: 'passed', elapsedMs: performance.now() - began, facts, checks: checks.map(({ expected, result }) => ({ expected, selectedScanId: result.selectedScanId, freshness: result.freshness, acquisitionCost: result.acquisitionCost })),
      baselineScanId: plan.baseline.scanId, laterScanId: plan.later.scanId, releaseSha256: inventory.release.sha256,
      policySha256: hash(before), reviewSha256: hash(Buffer.from(JSON.stringify(document.metadata['aih.workbench'].reviews))),
      preparation: { sessionId: preparation.sessionId, reviewDigest: preparation.review.reviewDigest, displaySha256: hash(Buffer.from(beforeHeld)), preserved: true },
      authentication, originalDownloadSha256: hash(downloaded), errors, limits: 'Demonstration review, held preparation only; no Apply/native-client use, new scan, signing or publication.' };
    await writeFile(join(output, 'complete-evidence.json'), JSON.stringify(receipt, null, 2));
    return receipt;
  } catch (error) {
    await page.screenshot({ path: join(output, 'FAILURE.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally { await copyFile(plan.later.path, plan.discoveryPath); await browser.close(); }
}
