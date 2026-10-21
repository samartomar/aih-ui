import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { installedFamilies } from './installed-families.mjs';
import { compareReleases } from '@aihq/catalog/reader';
import { acquireBaselineArtifact } from '@aihq/catalog/node';
import { readArtifact, readContentCoverage } from '@aihq/scan/read';
import { authenticateEvidence } from '@aihq/core';

export async function runSourceTransitionBrowser({ plan, output, playwrightModule, authoringModule }) {
  const began = performance.now(), hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const { freshAuthoring, composeAuthoring, reconcileAuthoring } = await import(authoringModule);
  await mkdir(output, { recursive: true });
  const previousRoot = join(plan.data, 'run/previous-catalog/package');
  const older = await installedFamilies({ root: previousRoot, sourceInput: 'previous-maintained' });
  const current = await installedFamilies(), before = older.find(value => value.family === plan.family), after = current.find(value => value.family === plan.family);
  const oldItem = before.release.items.find(value => value.id === plan.itemId), newItem = after.release.items.find(value => value.id === plan.itemId);
  const other = current.find(value => value.family === plan.unchangedFamily), otherItem = other.release.items.find(value => value.id === plan.unchangedItemId);
  assert.notEqual(oldItem.itemSha256, newItem.itemSha256);
  assert.equal(before.release.baseline, undefined, 'Historical inspection archive has no authentic baseline claim');
  assert.ok(after.release.baseline);
  const diff = compareReleases({ first: before.release, second: after.release }); assert.equal(diff.status, 'ok');
  await writeFile(join(output, 'public-release-diff.json'), JSON.stringify(diff, null, 2));
  const root = (inventory, item) => ({ releaseSha256: inventory.release.sha256, itemId: item.id, itemSha256: item.itemSha256, scope: 'project', configuration: {}, originIds: ['direct'] });
  const intent = freshAuthoring(); intent.roots = [root(before, oldItem), root(other, otherItem)];
  const saved = await composeAuthoring({ intent, inventories: [...current, ...older] }); assert.equal(saved.status, 'ok', JSON.stringify(saved.diagnostics));
  const original = join(output, 'historical-policy.json'); await writeFile(original, saved.value.policyBytes);
  const headers = { origin: plan.origin, 'content-type': 'application/json', 'x-aih-client': randomUUID() };
  const checked = await (await fetch(plan.origin + '/api/authoring-read', { method: 'POST', headers, body: JSON.stringify({ policyBytes: [...saved.value.policyBytes] }) })).json();
  await writeFile(join(output, 'historical-reopen.json'), JSON.stringify(checked, null, 2));
  assert.equal(checked.status, 'ok'); assert.equal(checked.value.editing, 'available', 'The explicitly configured historical full package must resolve exact saved family pins');
  const artifact = await acquireBaselineArtifact(after.release.baseline.artifact, { packageRoot: dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'))) });
  const read = await readArtifact(artifact), descriptors = item => [item.recipe, ...item.materials].map(({ path, sha256, byteLength }) => ({ path, sha256, byteLength }));
  const oldCoverage = await readContentCoverage({ read, descriptors: descriptors(oldItem) }), newCoverage = await readContentCoverage({ read, descriptors: descriptors(newItem) });
  assert.equal(newCoverage.status, 'matched'); assert.equal(oldCoverage.status, 'mismatched');
  const trustBytes = await readFile(plan.trust.path); assert.equal(hash(trustBytes), plan.trust.sha256);
  const authentication = await authenticateEvidence({ bytes: artifact, expectedScanId: after.release.baseline.scanId, trust: JSON.parse(trustBytes) }); assert.equal(authentication.status, 'authenticated');
  const headless = await reconcileAuthoring({ savedPolicyBytes: saved.value.policyBytes, inventories: [...current, ...older], candidateInventories: current });
  assert.equal(headless.status, 'ok'); assert.ok(headless.value.choices.some(value => value.root?.itemId === oldItem.id));
  const { chromium } = await import(playwrightModule), browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } })).newPage(); page.setDefaultTimeout(60_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const download = async name => { const event = page.waitForEvent('download'); await page.locator('#policy-save').click(); const path = join(output, name); await (await event).saveAs(path); return new Uint8Array(await readFile(path)); };
  try {
    await page.goto(plan.origin + '/'); await page.locator('#browse-family option[value="ECC"]').waitFor({ state: 'attached' });
    await page.locator('#nav-policy').click(); await page.locator('#policy-open').setInputFiles(original);
    await page.getByRole('button', { name: 'Validate and reopen', exact: true }).click();
    await page.locator('#policy-status').filter({ hasText: 'Saved choices recovered' }).waitFor();
    const beforeBytes = await download('before-refresh-policy.json');
    const checkEvent = page.waitForResponse(value => value.url().endsWith('/api/authoring-maintenance-check'));
    await page.locator('#policy-updates-check:not([disabled])').waitFor(); await page.locator('#policy-updates-check').click();
    const maintenance = await (await checkEvent).json(); assert.equal(maintenance.status, 'ok');
    assert.ok(maintenance.value.updates.some(value => value.subject.itemId === oldItem.id));
    await page.locator('#policy-updates-check:not([disabled])').waitFor();
    const unchanged = await download('after-discovery-policy.json'); assert.deepEqual(unchanged, beforeBytes);
    const event = page.waitForResponse(value => value.url().endsWith('/api/authoring-reconcile'));
    await page.getByRole('button', { name: 'Review source changes', exact: true }).click();
    const reconciliation = await (await event).json(); assert.deepEqual(reconciliation.value, headless.value);
    await page.getByRole('button', { name: `Review update ${oldItem.id}`, exact: true }).click();
    await page.locator('#policy-accept:not([disabled])').waitFor(); await page.locator('#policy-accept').click();
    const adopted = await download('explicitly-updated-policy.json'), policy = JSON.parse(new TextDecoder().decode(adopted));
    const roots = policy.metadata['aih.workbench'].roots;
    assert.equal(roots.find(value => value.itemId === oldItem.id).releaseSha256, after.release.sha256);
    assert.deepEqual(roots.find(value => value.itemId === otherItem.id), intent.roots[1]);
    await page.screenshot({ path: join(output, 'real-source-update.png'), fullPage: true });
    const refresh = await Promise.all((plan.refreshReceipts ?? []).map(async path => JSON.parse(await readFile(path, 'utf8'))));
    assert.deepEqual(errors, []);
    const receipt = { status: 'passed', elapsedMs: performance.now() - began, previousReleaseSha256: before.release.sha256, currentReleaseSha256: after.release.sha256,
      sources: { before: before.release.sources, after: after.release.sources }, itemId: oldItem.id, beforeItem: oldItem, afterItem: newItem,
      policyBeforeSha256: hash(beforeBytes), discoveryPreserved: true, policyAfterExplicitEditSha256: hash(adopted), unrelatedRootPreserved: true,
      baseline: after.release.baseline, authentication, oldCoverage, newCoverage, maintenance, reconciliation, refresh, errors,
      limits: 'Historical archive has no baseline claim; refresh receipts are staging proofs, final installed release has genuine qualified evidence. Local-Git origin verification and native execution are not claimed.' };
    await writeFile(join(output, 'source-transition.json'), JSON.stringify(receipt, null, 2)); return receipt;
  } catch (error) { await page.screenshot({ path: join(output, 'FAILURE.png'), fullPage: true }).catch(() => {}); throw error; }
  finally { await browser.close(); }
}
