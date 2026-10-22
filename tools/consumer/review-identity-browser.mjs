// Ordinary Workbench journey: the optional reviewing identity saved in setup becomes the default for "Reviewing as",
// a session choice still wins, it is never written into a policy or draft, and clearing it returns every judgment to imported.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { readInstalledRelease } from '@aihq/catalog/node';
import { runScan, prepareArtifact } from '@aihq/scan/host';
import { fileURLToPath } from 'node:url';
import { digestBytes } from './primitives.mjs';
import { readAuthoring } from './headless.mjs';
import { intakeDeclaration } from './intake.mjs';
import { noteFixture } from './note-fixture.mjs';
import { installedFamilies } from './installed-families.mjs';
import { closePolicyDrawer, drawer, openPolicyDrawer, openPolicyFileActions } from './policy-drawer.mjs';

const NOTE = 'consumer-proof.review-note', ME = 'fixture-me', TEAM = 'fixture-team', SENTINEL = 'settings-only-sentinel';
const encode = value => new TextEncoder().encode(value), decode = bytes => new TextDecoder().decode(bytes);

async function noteInventory() {
  const snapshot = await noteFixture('current');
  const input = { id: 'notes', kind: 'local', locator: { input: 'notes' }, resolvedIdentity: { sha256: await digestBytes(snapshot.declarationBytes) } };
  const result = await intakeDeclaration({ input, ...snapshot, materialSource: { kind: 'local', input: 'notes' } });
  assert.equal(result.status, 'ok', JSON.stringify(result.diagnostics));
  return result.value;
}

export async function runReviewIdentityBrowser({ origin, output, playwrightModule }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const maintained = await readInstalledRelease({ root: dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'))), sourceInput: 'maintained' });
  const note = await noteInventory();
  const inventories = [{ release: maintained.release, materialSource: { kind: 'local', input: 'maintained' } }, ...await installedFamilies(), note];
  // Explicit setup step, never a Workbench action: checked scan evidence for the review note, supplied to the page like any evidence file.
  const sourceRoot = join(output, 'review-source');
  for (const material of note.materials) { const path = join(sourceRoot, material.path); await mkdir(dirname(path), { recursive: true }); await writeFile(path, material.bytes); }
  const scan = await runScan({ schema: 'urn:aihq:scan:request:1.0.0', source: { kind: 'local', path: sourceRoot },
    selection: { paths: note.materials.map(material => material.path).sort(), excludedPaths: [] }, detectors: [{ detectorId: 'detector.aih-binding-gate', configuration: {} }] });
  assert.equal(scan.status, 'assessment', JSON.stringify(scan));
  const evidence = await prepareArtifact({ report: scan.report, annexes: scan.annexes.map(annex => ({ id: annex.id, bytes: Buffer.from(annex.bytesBase64, 'base64') })) });
  const evidencePath = join(output, 'review-evidence.unsigned.json'); await writeFile(evidencePath, evidence.bytes);
  const browser = await chromium.launch({ headless: true });
  const errors = [], failedResponses = [], sent = []; let observed;
  const openPage = async () => {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1100 } });
    const page = await context.newPage(); observed = page; page.setDefaultTimeout(30_000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 500) failedResponses.push(`${response.status()} ${response.url()}`); });
    page.on('request', request => { if (request.method() === 'POST') sent.push({ path: new URL(request.url()).pathname, body: request.postData() ?? '' }); });
    await page.goto(origin + '/');
    await page.locator('#browse-family option[value="Catalog"]').waitFor({ state: 'attached' });
    if (await page.locator('#setup-dialog').isVisible()) {
      await page.getByRole('radio', { name: /Vibe coder/ }).check();
      for (let step = 0; step < 4; step++) await page.locator('#setup-next').click();
      await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
    }
    return page;
  };
  const download = async (page, trigger, path) => { const event = page.waitForEvent('download'); await trigger(); await (await event).saveAs(path); return new Uint8Array(await readFile(path)); };
  const choose = async (page, family, id) => {
    await page.locator('#nav-sources').click(); await page.locator('#browse-support').selectOption('all'); await page.locator('#browse-family').selectOption(family);
    await closePolicyDrawer(page); await page.getByRole('button', { name: `Choose ${id}`, exact: true }).click();
    await page.locator('#policy-accept:not([disabled])').waitFor(); await page.locator('#policy-accept').click();
  };
  const openPanel = async page => {
    await page.locator('#nav-policy').click(); await openPolicyDrawer(page);
    const summary = page.locator('summary').filter({ hasText: 'Evidence review and reconsideration' });
    if (!await summary.evaluate(node => node.parentElement.open)) await summary.click();
  };
  const supplyEvidence = async page => {
    await openPanel(page);
    await drawer(page).getByLabel('Review evidence files', { exact: true }).setInputFiles(evidencePath);
    await drawer(page).getByText('Original evidence bytes loaded').waitFor();
  };
  const record = async (page, { id, kind, owner, actor }) => {
    await drawer(page).getByLabel('Evidence review subject', { exact: true }).selectOption({ label: NOTE });
    await drawer(page).getByRole('button', { name: 'Inspect evidence', exact: true }).click();
    await page.getByText(/findings bound to the checked subject/).waitFor();
    await drawer(page).getByLabel('Review decision ID', { exact: true }).fill(id);
    await drawer(page).getByLabel('Review owner kind', { exact: true }).selectOption(kind);
    await drawer(page).getByLabel('Review owner', { exact: true }).fill(owner);
    await drawer(page).getByLabel('Reviewer', { exact: true }).fill(actor);
    await drawer(page).getByLabel('Review disposition', { exact: true }).selectOption('false-alarm');
    await drawer(page).getByLabel('Review reason', { exact: true }).fill('Fixture note intentionally has no license declaration.');
    // A person chooses the checked finding they are reviewing; the first is the one bound to the fixture note.
    await drawer(page).getByLabel('Checked finding', { exact: true }).selectOption('0');
    await drawer(page).getByRole('button', { name: 'Propose human review', exact: true }).click();
    await page.locator('#policy-accept:not([disabled])').waitFor(); await page.locator('#policy-accept').click();
  };
  const reopen = async (page, path) => {
    await supplyEvidence(page);
    await openPolicyFileActions(page); await page.locator('#policy-open').setInputFiles(path);
    await drawer(page).getByRole('button', { name: 'Validate and reopen', exact: true }).click();
    await page.locator('#policy-status').filter({ hasText: 'Saved choices recovered' }).waitFor();
    await page.locator('#review-judgments li[data-record-id]').first().waitFor();
  };
  // The judgments sit at the end of the scrolled workspace; bring them into view before capturing.
  const shot = async (page, name) => {
    await page.locator('#review-judgments').evaluate(node => node.scrollIntoView({ block: 'end' }));
    await page.screenshot({ path: join(output, name), fullPage: true });
  };
  const origins = async page => Object.fromEntries(await page.locator('#review-judgments li[data-record-id]').evaluateAll(rows => rows.map(row => [row.dataset.recordId, row.dataset.origin])));
  const summaryOf = page => page.locator('#review-judgments-summary').textContent();
  // The header's workspace trigger opens its actions menu; Workspace settings opens the saved setup.
  const openWorkspaceSettings = async page => {
    await page.locator('#org-modal-trigger').click();
    await page.locator('#workspace-actions').getByRole('button', { name: 'Workspace settings', exact: true }).click();
    await page.locator('#org-modal-overlay').waitFor();
  };
  // Edit setup from the header, move to the review step and set the optional identity (empty clears it).
  const editSetup = async (page, reviewer, shot) => {
    await openWorkspaceSettings(page); await page.locator('#update-org-setup-btn').click();
    await page.locator('#setup-dialog').waitFor({ state: 'visible' });
    const id = page.locator('#setup-field-reviewer-id');
    await page.locator('#setup-next:not([disabled])').waitFor();
    for (let step = 0; step < 6 && !await id.isVisible(); step++) await page.locator('#setup-next').click();
    await id.waitFor();
    if (shot) await page.screenshot({ path: join(output, shot.before), fullPage: true });
    if (reviewer) await page.getByLabel('Reviewer kind', { exact: true }).selectOption(reviewer.kind);
    await id.fill(reviewer?.id ?? '');
    assert.match(await page.locator("#setup-content [data-setup-reviewer]").textContent(), reviewer ? new RegExp(`${reviewer.kind} ${reviewer.id}`) : /Not set/);
    await page.locator('#setup-next').click();
    await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
    if (await page.locator('#org-modal-overlay').evaluate(node => node.open)) await page.locator('#close-org-modal-btn').click();
  };
  const setupReviewer = async page => (await (await page.request.get(origin + '/api/workbench-settings')).json()).settings?.reviewer;
  // Best effort, also on failure: leave the setup as found, with no saved reviewing identity.
  const clearReviewer = async () => {
    const current = await (await fetch(origin + '/api/workbench-settings')).json();
    if (current.state !== 'saved' || !Object.hasOwn(current.settings, 'reviewer')) return;
    const { reviewer, ...rest } = current.settings;
    const response = await fetch(origin + '/api/workbench-settings/update', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(rest) });
    assert.equal(response.status, 200, 'Setup restored.');
  };
  const scenarios = [];
  try {
    assert.equal(await (await fetch(origin + '/api/workbench-settings')).json().then(value => value.state), 'saved', 'This journey runs against a Workbench whose setup already exists.');
    assert.equal(Object.hasOwn((await (await fetch(origin + '/api/workbench-settings')).json()).settings, 'reviewer'), false);

    // a. No saved identity: two judgments by different owners are both imported.
    const author = await openPage();
    assert.equal(await author.locator('#review-judgments-summary').textContent(), '');
    await choose(author, 'Independent', NOTE);
    await supplyEvidence(author);
    await record(author, { id: 'review-me', kind: 'individual', owner: ME, actor: 'fixture-reviewer' });
    await record(author, { id: 'review-team', kind: 'organization', owner: TEAM, actor: 'fixture-reviewer' });
    await author.locator('#review-judgments li[data-record-id="review-team"]').waitFor();
    const policyPath = join(output, 'policy.reviewed.downloaded.json');
    const policyBytes = await download(author, () => author.locator('#policy-save').click(), policyPath);
    assert.deepEqual(await origins(author), { 'review-me': 'imported', 'review-team': 'imported' });
    assert.match(await summaryOf(author), /^0 of your decisions; 2 imported/);
    assert.equal(await drawer(author).getByLabel('Your reviewer identity', { exact: true }).inputValue(), '');
    await shot(author, '01-no-identity-imported.png');
    scenarios.push('no-saved-identity-all-imported');

    // b. Save the identity in setup, on the existing review step.
    await editSetup(author, { kind: 'individual', id: ME }, { before: '02-setup-review-step.png' });
    assert.deepEqual(await setupReviewer(author), { kind: 'individual', id: ME });
    assert.equal(await drawer(author).getByLabel('Your reviewer identity', { exact: true }).inputValue(), ME);
    assert.match(await author.getByRole('status').filter({ hasText: 'setup preferences' }).first().textContent(), /individual fixture-me \(from your setup preferences\)/);
    await openWorkspaceSettings(author);
    assert.match(await author.locator('#org-setup-summary').textContent(), /Reviewing as\s*individual fixture-me/);
    await author.screenshot({ path: join(output, '03-setup-saved.png'), fullPage: true });
    await author.locator('#close-org-modal-btn').click();
    scenarios.push('setup-saves-identity', 'setup-summary-shows-identity');

    // c. A fresh page defaults to it: only the matching judgment is yours.
    const defaulted = await openPage();
    await reopen(defaulted, policyPath);
    assert.deepEqual(await origins(defaulted), { 'review-me': 'recipient', 'review-team': 'imported' });
    assert.match(await summaryOf(defaulted), /^1 of your decisions; 1 imported/);
    assert.equal(await drawer(defaulted).getByLabel('Your reviewer kind', { exact: true }).inputValue(), 'individual');
    assert.equal(await drawer(defaulted).getByLabel('Your reviewer identity', { exact: true }).inputValue(), ME);
    await shot(defaulted, '04-default-from-setup.png');
    const headless = await readAuthoring({ policyBytes, inventories, reviewEvidence: [evidence.bytes], recipient: { kind: 'individual', id: ME } });
    assert.equal(headless.status, 'ok', JSON.stringify(headless));
    assert.deepEqual(Object.fromEntries(headless.value.reviewJudgments.map(judgment => [judgment.recordId, judgment.origin])), { 'review-me': 'recipient', 'review-team': 'imported' });
    scenarios.push('setup-identity-is-default', 'headless-agreement');

    // d. The person can still change it for the session; editing setup afterwards does not undo that choice.
    await drawer(defaulted).getByLabel('Your reviewer kind', { exact: true }).selectOption('organization');
    await drawer(defaulted).getByLabel('Your reviewer identity', { exact: true }).fill(TEAM);
    await drawer(defaulted).getByRole('button', { name: 'Use identity', exact: true }).click();
    await defaulted.getByText(`Saved judgments are labelled for organization ${TEAM}.`).waitFor();
    assert.deepEqual(await origins(defaulted), { 'review-me': 'imported', 'review-team': 'recipient' });
    assert.match(await summaryOf(defaulted), /^1 of your decisions; 1 imported/);
    await shot(defaulted, '05-session-choice.png');
    // e. A saved identity that owns no judgment, set while the session choice stands.
    await editSetup(defaulted, { kind: 'individual', id: SENTINEL });
    assert.deepEqual(await setupReviewer(defaulted), { kind: 'individual', id: SENTINEL });
    assert.equal(await drawer(defaulted).getByLabel('Your reviewer identity', { exact: true }).inputValue(), TEAM, 'The session choice outranks a later setup change.');
    assert.deepEqual(await origins(defaulted), { 'review-me': 'imported', 'review-team': 'recipient' });
    scenarios.push('session-choice-wins', 'session-choice-survives-setup-edit');

    // f. Never exported: a fresh page defaults to the sentinel; ordinary edits and saves must not carry it anywhere.
    const settingsPosts = sent.filter(post => post.path.startsWith('/api/workbench-settings'));
    assert.ok(settingsPosts.some(post => post.body.includes(SENTINEL)), 'The setup save is the one place the identity is sent.');
    const exporting = await openPage();
    sent.length = 0;
    await reopen(exporting, policyPath);
    assert.deepEqual(await origins(exporting), { 'review-me': 'imported', 'review-team': 'imported' });
    assert.match(await summaryOf(exporting), /^0 of your decisions; 2 imported/);
    assert.equal(await drawer(exporting).getByLabel('Your reviewer identity', { exact: true }).inputValue(), SENTINEL);
    await choose(exporting, 'Catalog', 'mattpocock.grilling');
    await exporting.locator('#review-judgments li[data-record-id]').first().waitFor();
    const editedPath = join(output, 'policy.edited.downloaded.json');
    const editedBytes = await download(exporting, () => exporting.locator('#policy-save').click(), editedPath);
    assert.notEqual(decode(editedBytes), decode(policyBytes), 'An ordinary edit changed the saved policy.');
    for (const [name, bytes] of [['reopened policy', policyBytes], ['edited policy', editedBytes]]) assert.equal(decode(bytes).includes(SENTINEL), false, `${name} must not contain the setup identity.`);
    assert.equal((await exporting.locator('#policy-bytes').textContent()).includes(SENTINEL), false);
    // The page hands the identity to the same-origin authoring service only as `recipient`, to label judgments; nothing else carries it.
    const carrying = sent.filter(post => post.body.includes(SENTINEL));
    assert.ok(carrying.length > 0 && carrying.every(post => /^\/api\/authoring-/.test(post.path)), 'Only authoring reads on this origin carry the identity.');
    for (const post of carrying) { const { recipient, ...rest } = JSON.parse(post.body); assert.deepEqual(recipient, { kind: 'individual', id: SENTINEL }); assert.equal(JSON.stringify(rest).includes(SENTINEL), false, post.path); }
    assert.equal(sent.filter(post => post.path.startsWith('/api/workbench-settings')).length, 0);
    await shot(exporting, '06-never-exported.png');
    scenarios.push('identity-not-in-downloaded-policy', 'identity-only-as-recipient-label');

    // g. Clearing returns every judgment to imported, and the setup is left as found.
    await editSetup(exporting, undefined);
    assert.equal(await setupReviewer(exporting), undefined);
    const cleared = await openPage();
    await reopen(cleared, policyPath);
    assert.deepEqual(await origins(cleared), { 'review-me': 'imported', 'review-team': 'imported' });
    assert.match(await summaryOf(cleared), /^0 of your decisions; 2 imported/);
    assert.equal(await drawer(cleared).getByLabel('Your reviewer identity', { exact: true }).inputValue(), '');
    assert.equal(Object.hasOwn((await (await fetch(origin + '/api/workbench-settings')).json()).settings, 'reviewer'), false);
    await shot(cleared, '07-cleared-imported.png');
    scenarios.push('cleared-identity-all-imported', 'setup-left-as-found');

    assert.deepEqual(errors, []); assert.deepEqual(failedResponses, []);
    await writeFile(join(output, 'review-identity-evidence.json'), JSON.stringify({ status: 'passed', entry: '/', chromium: browser.version(), scenarios, errors, failedResponses }, null, 2));
    console.log(`Review identity journey passed: ${output}`);
  } catch (error) {
    await observed?.screenshot({ path: join(output, 'review-identity-failure.png'), fullPage: true }).catch(() => {});
    await writeFile(join(output, 'review-identity-failure.json'), JSON.stringify({ error: error.message, errors, failedResponses, scenarios,
      text: await observed?.locator('body').innerText().catch(() => '') }, null, 2));
    throw error;
  } finally { await clearReviewer().catch(() => {}); await browser.close(); }
}
