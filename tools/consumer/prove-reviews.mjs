// Installed public consumer + actual browser download/fresh-import proof.
// The built-in scan is an explicit proof setup step, never an inspection action.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { runScan, prepareArtifact } from '@aihq/scan/host';
import { readInstalledRelease } from '@aihq/catalog/node';
import { readAuthoring } from 'aih-ui/authoring';
import { createMixedService } from './mixed-service.mjs';
import { startConsumer } from './server.mjs';
const output = process.argv[2]; await mkdir(output, { recursive: true });
const installed = await readInstalledRelease({ root: dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'))), sourceInput: 'maintained' });
assert.equal(installed.valid, true);
const mixed = await createMixedService({ release: installed.release, materialSource: installed.source });
const inventory = mixed.inventories.find(entry => entry.input?.id === 'notes');
const source = await mkdtemp(join(tmpdir(), 'ui5-browser-source-'));
let browser, started;
const errors = [];
try {
  for (const material of inventory.materials) { const path = join(source, material.path); await mkdir(dirname(path), { recursive: true }); await writeFile(path, material.bytes); }
  const result = await runScan({ schema: 'urn:aihq:scan:request:1.0.0', source: { kind: 'local', path: source }, selection: { paths: 'all', excludedPaths: [] }, detectors: [{ detectorId: 'detector.aih-binding-gate', configuration: {} }] });
  assert.equal(result.status, 'assessment');
  const artifact = await prepareArtifact({ report: result.report, annexes: result.annexes.map(a => ({ id: a.id, bytes: Buffer.from(a.bytesBase64, 'base64') })) });
  const artifactPath = join(output, 'review-evidence.unsigned.json'); await writeFile(artifactPath, artifact.bytes);
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  started = await startConsumer(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ acceptDownloads: true }); page.setDefaultTimeout(15_000); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${started.origin}/authoring`);
  await page.locator('#summary').filter({ hasText: '"roots"' }).waitFor();
  await page.locator('#search').fill('consumer-proof.review-note');
  await page.getByRole('button', { name: 'Choose consumer-proof.review-note', exact: true }).click();
  await page.locator('#accept:not([disabled])').waitFor(); await page.locator('#accept').click();
  const note = inventory.release.items[0], target = `${inventory.release.sha256}/${note.id}`;
  await page.locator('#review-target').selectOption(target);
  await page.locator('#review-file').setInputFiles(artifactPath); await page.locator('#review-facts').filter({ hasText: 'Original evidence bytes loaded' }).waitFor();
  await page.locator('#inspect-review').click(); await page.locator('#record-review:not([disabled])').waitFor();
  assert((await page.locator('#review-facts').textContent()).includes('"sourceAssociation": "matched"'));
  assert((await page.locator('#review-facts').textContent()).includes('"producerAuthentication": "unchecked"'));
  await page.locator('#review-id').fill('browser-decision'); await page.locator('#review-owner-kind').selectOption('organization');
  await page.locator('#review-owner').fill('fixture-team'); await page.locator('#review-actor').fill('fixture-reviewer');
  await page.locator('#review-disposition').selectOption('accepted-risk'); await page.locator('#review-reason').fill('Fixture: no license declaration intentionally accepted for this local test.');
  await page.locator('#record-review').click(); await page.locator('#accept:not([disabled])').waitFor(); await page.locator('#accept').click();
  await page.locator('#review-history').filter({ hasText: 'browser-decision' }).waitFor();
  const waitDownload = page.waitForEvent('download'); await page.locator('#save').click(); const download = await waitDownload;
  const downloadedPath = join(output, 'review-policy.downloaded.json'); await download.saveAs(downloadedPath);
  const bytes = new Uint8Array(await readFile(downloadedPath));
  const fresh = await browser.newPage({ acceptDownloads: true }); fresh.setDefaultTimeout(15_000); fresh.on('pageerror', e => errors.push(e.message));
  await fresh.goto(`${started.origin}/authoring`); await fresh.locator('#summary').filter({ hasText: '"roots"' }).waitFor();
  await fresh.locator('#open').setInputFiles(downloadedPath); await fresh.locator('#proposal').filter({ hasText: 'Original bytes retained' }).waitFor();
  await fresh.locator('#reopen').click(); await fresh.locator('#proposal').filter({ hasText: 'REVIEW_BINDING_UNAVAILABLE' }).waitFor();
  // Fresh import independently reads the actual original evidence bytes.
  await fresh.locator('#review-file').setInputFiles(artifactPath); await fresh.locator('#review-facts').filter({ hasText: 'Original evidence bytes loaded' }).waitFor();
  await fresh.locator('#reopen').click(); await fresh.locator('#proposal').filter({ hasText: '"editing": "available"' }).waitFor();
  const headless = await readAuthoring({ policyBytes: bytes, inventories: mixed.inventories, reviewEvidence: [artifact.bytes] });
  assert.equal(headless.value.editing, 'available');
  assert.deepEqual(JSON.parse(await fresh.locator('#policy').inputValue()).metadata['aih.workbench'], headless.value.intent);
  assert.equal(headless.value.intent.reviews.records[0].disposition, 'accepted-risk');
  await fresh.locator('#inspect-review').click(); await fresh.locator('#review-facts').filter({ hasText: '"sourceAssociation": "matched"' }).waitFor();
  await fresh.screenshot({ path: join(output, 'review-browser.png'), fullPage: true });
  await fresh.getByRole('button', { name: 'Trim consumer-proof.review-note', exact: true }).click();
  await fresh.locator('#accept:not([disabled])').waitFor(); await fresh.locator('#accept').click();
  const trimmed = JSON.parse(await fresh.locator('#policy').inputValue()).metadata['aih.workbench'].reviews;
  assert.equal(trimmed.records[0].state, 'reconsider'); assert.equal(trimmed.history[0].id, 'browser-decision');
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'review-browser-headless.json'), JSON.stringify({ status: 'passed', node: process.version, scanId: artifact.scanId, artifactSha256: createHash('sha256').update(artifact.bytes).digest('hex'), downloadSha256: createHash('sha256').update(bytes).digest('hex'), records: headless.value.intent.reviews, trimmed,
    cases: ['explicit real built-in fixture assessment', 'source/support/authentication/coverage/findings separate', 'accepted-risk with organization owner', 'actual downloaded file and fresh browser import', 'missing optional evidence preserves policy and refuses reusable decision', 'fresh evidence byte read restores checked binding', 'installed public headless record/file agreement', 'authoring trim retains history and requests reconsideration'], errors,
    limits: ['Fixture source and local built-in analyzer only; no native/external runtime acceptance.', 'Unsigned artifact is checked, not authenticated; retained and ephemeral signed artifact trust is tested separately.', 'Portable JSON does not authenticate the human or authorize execution.'] }, null, 2) + '\n');
} finally { await browser?.close(); if (started) await new Promise(resolve => started.server.close(resolve)); await rm(source, { recursive: true, force: true }); }
