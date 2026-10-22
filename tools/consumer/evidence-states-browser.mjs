// Ordinary Workbench journey: catalog metrics count the listed inventory, Scan Review opens the supplied-evidence review,
// and each item's evidence state follows the supplied Scan documents (not supplied, valid and matched, mismatched,
// invalid) through the host's public Scan read and coverage. Nothing here scans from the page or records a judgment.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { runScan, prepareArtifact } from '@aihq/scan/host';
import { digestBytes } from './primitives.mjs';
import { intakeDeclaration } from './intake.mjs';
import { noteFixture } from './note-fixture.mjs';
import { addFromCatalog, closePolicyDrawer, drawer } from './policy-drawer.mjs';
import { openCatalogAdvanced, openScanReview, chooseFamily, chooseSupport } from './advanced-browser.mjs';

const NOTE = 'consumer-proof.review-note';

async function noteMaterials() {
  const snapshot = await noteFixture('current');
  const input = { id: 'notes', kind: 'local', locator: { input: 'notes' }, resolvedIdentity: { sha256: await digestBytes(snapshot.declarationBytes) } };
  const result = await intakeDeclaration({ input, ...snapshot, materialSource: { kind: 'local', input: 'notes' } });
  assert.equal(result.status, 'ok', JSON.stringify(result.diagnostics));
  return result.value.materials;
}

// Explicit setup steps, never Workbench actions: scan a folder holding the note's materials, optionally with one file changed.
async function scanEvidence(folder, materials, change) {
  for (const material of materials) {
    const path = join(folder, material.path); await mkdir(dirname(path), { recursive: true });
    await writeFile(path, change && material === materials.at(-1) ? Buffer.concat([Buffer.from(material.bytes), Buffer.from('\nchanged after review\n')]) : material.bytes);
  }
  const scan = await runScan({ schema: 'urn:aihq:scan:request:1.0.0', source: { kind: 'local', path: folder },
    selection: { paths: materials.map(material => material.path).sort(), excludedPaths: [] }, detectors: [{ detectorId: 'detector.aih-binding-gate', configuration: {} }] });
  assert.equal(scan.status, 'assessment', JSON.stringify(scan));
  const artifact = await prepareArtifact({ report: scan.report, annexes: scan.annexes.map(annex => ({ id: annex.id, bytes: Buffer.from(annex.bytesBase64, 'base64') })) });
  return artifact.bytes;
}

export async function runEvidenceStatesBrowser({ origin, output, playwrightModule }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const materials = await noteMaterials();
  const files = { valid: join(output, 'evidence-valid.json'), mismatched: join(output, 'evidence-mismatched.json'), invalid: join(output, 'evidence-invalid.json') };
  await writeFile(files.valid, await scanEvidence(join(output, 'valid-source'), materials, false));
  await writeFile(files.mismatched, await scanEvidence(join(output, 'changed-source'), materials, true));
  await writeFile(files.invalid, '{}');
  const browser = await chromium.launch({ headless: true });
  const errors = [], failedResponses = [], inspected = [], scenarios = [];
  let page;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    page = await context.newPage(); page.setDefaultTimeout(30_000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.status() >= 500) failedResponses.push(`${response.status()} ${response.url()}`);
      if (new URL(response.url()).pathname === '/api/authoring-inspect-review') inspected.push(response.status());
    });
    await page.goto(origin + '/');
    await page.locator('#browse-family option[value="Catalog"]').waitFor({ state: 'attached' });
    assert.equal(await page.locator('#setup-dialog').isVisible(), false, 'This journey runs against a Workbench whose setup already exists.');
    await chooseSupport(page, 'all');
    await chooseFamily(page, '');

    // a. Kind tiles count what the list shows in the same scope; tokens stay unknown.
    // The tiles sit in the catalog's Advanced section; the kind pills are the default kind control.
    await openCatalogAdvanced(page);
    const tile = kind => page.locator(`[data-metric="${kind}"]`);
    for (const kind of ['command', 'hook']) {
      const count = Number(await tile(kind).locator('.wb-metric-count').textContent());
      assert.ok(count > 0, `${kind} tile shows the published count`);
      await tile(kind).click();
      await page.waitForFunction(([expected]) => document.getElementById('visible-count')?.textContent === expected, [String(count)]);
      assert.equal(await page.locator('#cards-grid [data-card-id]').count(), count);
      await tile(kind).click();
    }
    assert.match(await tile('hook').innerText(), /HOOK ITEMS[\s\S]*items, not events/i);
    assert.equal(await tile('tokens').isDisabled(), true);
    assert.match(await tile('tokens').innerText(), /Unknown/);
    assert.equal(/Not published/.test(await page.locator('#framework-matrix-tabs').innerText()), false, 'No tile claims a kind is unpublished.');
    scenarios.push('metrics-match-list', 'hook-items-not-events', 'tokens-unknown');

    // b. With nothing supplied, every card says not supplied.
    const noteCard = page.locator(`[data-card-id$="/${NOTE}"] [data-evidence-state]`);
    const otherCard = page.locator(`[data-card-id]:not([data-card-id$="/${NOTE}"]) [data-evidence-state]`).first();
    await noteCard.waitFor();
    assert.equal(await page.locator('#cards-grid [data-evidence-state]:not([data-evidence-state="not-supplied"])').count(), 0);
    // Missing evidence is a compact gap indicator whose accessible name is the state.
    assert.equal(await noteCard.getByRole('button', { name: 'Not supplied', exact: true }).count(), 1);
    assert.equal(await page.locator('#cards-grid').getByText('Not published', { exact: true }).count(), 0, 'No card slot claims evidence or tokens are unpublished.');
    await page.screenshot({ path: join(output, '01-not-supplied.png'), fullPage: true });
    scenarios.push('not-supplied');

    // c. Choose the note so the review panel can inspect it, then open Scan Review from the navigation.
    await addFromCatalog(page, NOTE);
    await openScanReview(page);
    await page.locator('#policy-workspace').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#evidence-review').evaluate(node => node.open), true, 'Scan Review opens the supplied-evidence review.');
    assert.equal(await drawer(page).getByLabel('Review evidence files', { exact: true }).evaluate(node => node === document.activeElement), true);
    scenarios.push('scan-review-opens-evidence-review');

    const supply = async (path, state) => {
      await openScanReview(page);
      await drawer(page).getByLabel('Review evidence files', { exact: true }).setInputFiles(path);
      await drawer(page).getByText('Original evidence bytes loaded').waitFor();
      await drawer(page).getByLabel('Evidence review subject', { exact: true }).selectOption({ label: NOTE });
      await drawer(page).getByRole('button', { name: 'Inspect evidence', exact: true }).click();
      const status = page.locator(`#evidence-review [role="status"][data-evidence-state="${state}"]`);
      await status.waitFor();
      const text = await status.innerText();
      // The review sits in the drawer, which can be shorter than the review. An element capture beyond the viewport lets
      // Chromium resize the page to the element's own narrow width, which folds the navigation as on a phone; the
      // evidence is a viewport capture with the review's status in view instead.
      await status.scrollIntoViewIfNeeded(); await page.screenshot({ path: join(output, `review-${state}.png`) });
      await page.locator('#nav-sources').click();
      await page.waitForFunction(([expected, note]) => document.querySelector(`[data-card-id$="/${note}"] [data-evidence-state]`)?.dataset.evidenceState === expected, [state, NOTE]);
      await page.screenshot({ path: join(output, `catalog-${state}.png`), fullPage: true });
      return text;
    };
    // d. A valid report of the note's exact files: the note matches, an unrelated item does not, and nothing is authenticated.
    assert.match(await supply(files.valid, 'matched'), /Evidence matched[\s\S]*[1-9]\d* findings bound[\s\S]*Producer authentication is separate/);
    assert.equal(await noteCard.innerText(), 'Matched');
    assert.match(await noteCard.getAttribute('title'), /unchecked; this is not an approval or execution authority/);
    const otherState = await otherCard.getAttribute('data-evidence-state');
    assert.ok(['mismatched', 'unavailable'].includes(otherState), 'A note-only report cannot qualify unrelated content or its release baseline');
    scenarios.push('valid-matched', `unrelated-item-${otherState}`);
    // e. A report of changed files: mismatched, and nothing can be reviewed from it.
    assert.match(await supply(files.mismatched, 'mismatched'), /Evidence mismatched[\s\S]*0 findings bound/);
    assert.equal(await noteCard.innerText(), 'Mismatched');
    scenarios.push('mismatched');
    // f. Bytes that are not a Scan document: invalid for every item.
    assert.match(await supply(files.invalid, 'invalid'), /Evidence invalid[\s\S]*0 findings bound/);
    assert.equal(await noteCard.innerText(), 'Invalid evidence');
    assert.equal(await page.locator('#cards-grid [data-evidence-state]:not([data-evidence-state="invalid"])').count(), 0);
    scenarios.push('invalid');
    // g. Forgetting the evidence returns every card to not supplied.
    await openScanReview(page);
    await drawer(page).getByRole('button', { name: 'Forget supplied evidence', exact: true }).click();
    await drawer(page).getByText('Supplied evidence forgotten').waitFor();
    await page.locator('#nav-sources').click();
    await page.waitForFunction(note => document.querySelector(`[data-card-id$="/${note}"] [data-evidence-state]`)?.dataset.evidenceState === 'not-supplied', NOTE);
    scenarios.push('forgotten-not-supplied');

    assert.deepEqual(inspected, [200, 200, 200], 'Each inspection went through the preview authoring route.');
    assert.deepEqual(errors, []); assert.deepEqual(failedResponses, []);
    await writeFile(join(output, 'evidence-states-evidence.json'), JSON.stringify({ status: 'passed', entry: '/', chromium: browser.version(), scenarios, errors, failedResponses }, null, 2));
    console.log(`Evidence states journey passed: ${output}`);
  } catch (error) {
    await page?.screenshot({ path: join(output, 'evidence-states-failure.png'), fullPage: true }).catch(() => {});
    await writeFile(join(output, 'evidence-states-failure.json'), JSON.stringify({ error: error.message, errors, failedResponses, scenarios,
      text: await page?.locator('body').innerText().catch(() => '') }, null, 2));
    throw error;
  } finally { await browser.close(); }
}
