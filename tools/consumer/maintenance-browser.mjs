import { chooseCatalogFamily, chooseCatalogSupport, setPersonalFolder } from './policy-drawer.mjs';
// Ordinary Workbench journey: available updates for a saved choice are checked on open and on Check now,
// each exact revision keeps its own keep/skip/defer choice inside the saved envelope, and the check only reads.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { readInstalledRelease } from '@aihq/catalog/node';
import { runScan, prepareArtifact } from '@aihq/scan/host';
import { fileURLToPath } from 'node:url';
import { checkMaintenance, MAINTENANCE_DISPOSITION_SCHEMA, MAINTENANCE_CHECK_SCHEMA, UPDATE_CATEGORIES } from './maintenance.mjs';
import { digestBytes } from './primitives.mjs';
import { openDraft } from './headless.mjs';
import { intakeDeclaration } from './intake.mjs';
import { noteFixture } from './note-fixture.mjs';
import { inspectReviewEvidence } from './review-bindings.mjs';
import { installedFamilies } from './installed-families.mjs';
import { addFromCatalog, closePolicyDrawer, drawer, openPolicyDrawer, openPolicyFileActions, openPolicySection } from './policy-drawer.mjs';
import { openPolicyWorkspace, openSetupAdvanced } from './advanced-browser.mjs';

const NOTE = 'consumer-proof.review-note', PERSONAL = 'personal.skill.example', OPENED = 'Unresolved draft opened', REVIEW = 'maintenance-review';
const encode = value => new TextEncoder().encode(value), decode = bytes => new TextDecoder().decode(bytes);

// The same revisions the host source publishes: one input `notes`, so each matches the saved release as a newer revision.
async function notesInventory(variant) {
  const snapshot = await noteFixture(variant === 'newer' ? 'updated' : variant);
  if (variant === 'newer') {
    const declaration = JSON.parse(decode(snapshot.declarationBytes));
    declaration.package.version = '1.0.2';
    snapshot.declarationBytes = encode(JSON.stringify(declaration));
  }
  const input = { id: 'notes', kind: 'local', locator: { input: 'notes' }, resolvedIdentity: { sha256: await digestBytes(snapshot.declarationBytes) } };
  const result = await intakeDeclaration({ input, ...snapshot, materialSource: { kind: 'local', input: 'notes' } });
  assert.equal(result.status, 'ok', JSON.stringify(result.diagnostics));
  return result.value;
}
const FACT_LABEL = { authority: 'Authority', evidence: 'Evidence', availability: 'Availability' };
const factLines = facts => facts.map(fact => `${FACT_LABEL[fact.kind]}: ${fact.message}`).sort();

export async function runMaintenanceBrowser({ origin, output, playwrightModule, sourcePath }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const folder = join(output, 'personal');
  const personalSources = {
    LICENSE: 'MIT License\nCopyright 2026 Example\nPermission is hereby granted, free of charge.\n',
    'skills/example/SKILL.md': '---\nname: example\ndescription: Keep personal choices understandable.\nlicense: MIT\n---\n\nUse support/checklist.txt.\n',
    'skills/example/support/checklist.txt': 'Preserve exact choices and truthful origins.\n',
  };
  for (const [path, text] of Object.entries(personalSources)) { await mkdir(dirname(join(folder, path)), { recursive: true }); await writeFile(join(folder, path), text); }
  const publish = revisions => writeFile(sourcePath, JSON.stringify({ revisions }));
  const maintained = await readInstalledRelease({ root: dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'))), sourceInput: 'maintained' });
  const inventories = [{ release: maintained.release, materialSource: { kind: 'local', input: 'maintained' } }, ...await installedFamilies(),
    await notesInventory('current')];
  const updated = await notesInventory('updated'), newer = await notesInventory('newer');
  const now = () => new Date().toISOString();
  const day = offset => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const futureDate = day(30), pastDate = day(-1);
  // Explicit setup step, never a Workbench action: checked scan evidence for the review note, supplied to the page like any evidence file.
  const sourceRoot = join(output, 'review-source');
  for (const material of inventories.at(-1).materials) { const path = join(sourceRoot, material.path); await mkdir(dirname(path), { recursive: true }); await writeFile(path, material.bytes); }
  const scan = await runScan({ schema: 'urn:aihq:scan:request:1.0.0', source: { kind: 'local', path: sourceRoot },
    selection: { paths: inventories.at(-1).materials.map(material => material.path).sort(), excludedPaths: [] }, detectors: [{ detectorId: 'detector.aih-binding-gate', configuration: {} }] });
  assert.equal(scan.status, 'assessment', JSON.stringify(scan));
  const evidence = await prepareArtifact({ report: scan.report, annexes: scan.annexes.map(annex => ({ id: annex.id, bytes: Buffer.from(annex.bytesBase64, 'base64') })) });
  const evidencePath = join(output, 'review-evidence.unsigned.json'); await writeFile(evidencePath, evidence.bytes);
  // The journey's own evidence must really bind findings to the note: the page review below selects one by its
  // bound identity. This is the same public inspection chain the page uses; it fails here, with the journey's
  // evidence and inventory, instead of as a bare select timeout on the page.
  const bound = await inspectReviewEvidence({ evidenceBytes: evidence.bytes, inventory: inventories.at(-1), itemId: NOTE, configuration: {} });
  assert.equal(bound.status, 'ok', JSON.stringify(bound.diagnostics ?? bound));
  assert.ok(bound.value.bindings.length >= 1, `The journey evidence binds no checked finding to ${NOTE}: ${JSON.stringify(bound.value.view ?? bound.value).slice(0, 400)}`);
  const browser = await chromium.launch({ headless: true });
  const errors = [], failedResponses = []; let observed; let operations = [], categoriesSent = [], checkInputs = [];
  const openPage = async () => {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1100 } });
    const page = await context.newPage(); observed = page; page.setDefaultTimeout(30_000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 500) failedResponses.push(`${response.status()} ${response.url()}`); });
    page.on('request', request => {
      const operation = /\/api\/authoring-([\w-]+)$/.exec(new URL(request.url()).pathname)?.[1];
      if (!operation || request.method() !== 'POST') return;
      operations.push(operation);
      if (operation === 'maintenance-check') {
        const body = JSON.parse(request.postData() ?? '{}');
        categoriesSent.push(body.categories); checkInputs.push(body.envelopeBytes ? 'envelope' : body.bytes ? 'policy' : 'none');
      }
    });
    await page.goto(origin + '/');
    await page.locator('#browse-family option[value="Catalog"]').waitFor({ state: 'attached' });
    if (await page.locator('#setup-dialog').isVisible()) {
      await page.getByRole('radio', { name: /Vibe coder/ }).check();
      for (let step = 0; step < 3; step++) await page.locator('#setup-next').click();
      await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
    }
    return page;
  };
  const download = async (page, trigger, path) => { const event = page.waitForEvent('download'); await trigger(); await (await event).saveAs(path); return new Uint8Array(await readFile(path)); };
  const saveDraft = (page, path) => download(page, async () => { await openPolicyDrawer(page); await page.locator('#policy-draft-save').click(); }, path);
  const sameBytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
  const checkedText = page => page.locator('#policy-updates-checked').textContent();
  const checkedAt = text => /(\d{4}-\d\d-\d\dT[\d:.]+Z)/.exec(text)?.[1];
  const groupsOf = page => page.locator('#policy-updates h4').evaluateAll(heads => Object.fromEntries(heads.map(head =>
    [head.textContent, [...head.parentElement.children].slice(1).map(entry => entry.innerText)])));
  const groupRows = async (page, label) => (await groupsOf(page))[label] ?? [];
  const section = (page, label) => page.locator('#policy-updates h4').filter({ hasText: new RegExp(`^${label}$`) }).locator('..');
  const categoryLines = page => page.locator('#policy-updates-categories p').allInnerTexts();
  const waitSettled = (page, previous) => page.waitForFunction(before => {
    const text = document.getElementById('policy-updates-checked')?.textContent ?? '';
    return text !== before && text !== '' && !text.startsWith('Checking') && !/unknown until checked/.test(text);
  }, previous ?? null);
  const checkNow = async page => {
    const previous = await checkedText(page), seen = operations.length;
    await page.locator('#policy-updates-check').click();
    await waitSettled(page, previous);
    return operations.slice(seen);
  };
  const openSaved = async (page, path, heading) => {
    const original = JSON.parse(await readFile(path, 'utf8'));
    const checked = page.waitForResponse(response => {
      if (!response.url().endsWith('/api/authoring-maintenance-check')) return false;
      try {
        const body = JSON.parse(response.request().postData()), bytes = body.envelopeBytes ?? body.bytes;
        const input = JSON.parse(decode(Uint8Array.from(bytes)));
        const policyOf = value => value.savedIntent?.base64 ? JSON.parse(Buffer.from(value.savedIntent.base64, 'base64').toString('utf8')) : value;
        return JSON.stringify(policyOf(input).metadata?.['aih.workbench']?.roots) === JSON.stringify(policyOf(original).metadata?.['aih.workbench']?.roots);
      } catch { return false; }
    });
    await openPolicyWorkspace(page); await openPolicyFileActions(page); await page.locator('#policy-open').setInputFiles(path);
    await drawer(page).getByRole('button', { name: 'Validate and reopen', exact: true }).click();
    await page.locator('#policy-draft-status').filter({ hasText: heading }).waitFor();
    await openPolicySection(page, 'Available updates');
    await checked;
    await page.locator('#policy-updates-check:not([disabled])').waitFor();
    await waitSettled(page, null);
  };
  const recordedNote = envelope => envelope.records.find(record => record.schema === MAINTENANCE_CHECK_SCHEMA);
  const dispositions = envelope => envelope.records.filter(record => record.schema === MAINTENANCE_DISPOSITION_SCHEMA);
  const headlessCheck = async (envelopeBytes, candidateInventories) => {
    const result = await checkMaintenance({ envelopeBytes, inventories, candidateInventories, now: now() });
    assert.equal(result.status, 'ok', JSON.stringify(result.diagnostics));
    return result.value;
  };
  const shownChoices = async page => (await page.locator('#policy-draft-roots > div').evaluateAll(rows => rows.map(row => [row.dataset.itemId, row.dataset.status]))).sort();
  const draftRevision = async page => Number(/Draft revision (\d+)/.exec(await page.locator('#policy-draft-note').textContent())?.[1]);
  const choose = async (page, family, id) => {
    await page.locator('#nav-sources').click(); await chooseCatalogSupport(page, 'all'); await chooseCatalogFamily(page, family);
    await addFromCatalog(page, id);
  };
  // The evidence panel is the existing review flow's own: open it, then supply the original evidence bytes.
  const supplyEvidence = async page => {
    await openPolicyWorkspace(page); await openSetupAdvanced(page);
    await page.locator('summary').filter({ hasText: 'Evidence review and reconsideration' }).click();
    await drawer(page).getByLabel('Review evidence files', { exact: true }).setInputFiles(evidencePath);
    await drawer(page).getByText('Original evidence bytes loaded').waitFor();
  };
  // The updates section sits below the policy steps; bring it to the top of the scrolled view before capturing.
  const shot = async (page, name) => {
    await page.locator('#policy-updates').evaluate(node => node.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: join(output, name), fullPage: true });
  };
  const scenarios = [], revisions = {}, observedFacts = {};
  try {
    // 1. The source publishes nothing newer. Choose the independent review note and save the policy.
    await publish(['current']);
    const authoring = await openPage();
    // A personal skill (not rebound in the fresh pages) is chosen as well, so this saved policy reopens as an unresolved draft;
    // the review note stays resolved. The fully resolved route is journeyed separately below.
    await setPersonalFolder(authoring, folder);
    await authoring.locator('#personal-result').filter({ hasText: 'Folder validated' }).waitFor();
    await choose(authoring, 'Personal', PERSONAL);
    await choose(authoring, 'Independent', NOTE);
    const policyPath = join(output, 'policy.downloaded.json');
    const policyBytes = await download(authoring, async () => { await openPolicyDrawer(authoring); await openSetupAdvanced(authoring).then(() => authoring.locator('#policy-save').click()); }, policyPath);
    assert.deepEqual(JSON.parse(decode(policyBytes)).metadata['aih.workbench'].roots.map(root => root.itemId).sort(), [NOTE, PERSONAL].sort());
    scenarios.push('save-independent-choice');

    // 2. A newer revision is published. Reopening the saved policy checks automatically; nothing is changed by it.
    await publish(['current', 'updated']);
    const reopened = await openPage();
    operations = []; categoriesSent = [];
    await openSaved(reopened, policyPath, OPENED);
    assert.deepEqual(operations.filter(operation => !['read', 'draft-open', 'maintenance-check', 'improvements-check', 'workspace-read', 'trials-read', 'evidence-states', 'tool-host'].includes(operation)), [], 'Opening may only read.');
    assert.deepEqual(categoriesSent, [['content']]);
    assert.match(await checkedText(reopened), /^Last checked \d{4}/);
    let groups = await groupsOf(reopened);
    assert.deepEqual(Object.keys(groups), ['Needs attention']);
    assert.equal(groups['Needs attention'].length, 1);
    const row = groups['Needs attention'][0];
    assert.match(row, /Review note/);
    assert.deepEqual(await shownChoices(reopened), [[NOTE, 'resolved'], [PERSONAL, 'unresolved']].sort());
    assert.match(row, /review-notes-catalog 1\.0\.1/); assert.match(row, /New revision available\./);
    assert.deepEqual(await categoryLines(reopened), ['Content: checked', 'Software: not selected', 'Client: not selected', 'Environment: not selected']);
    for (const [name, box] of [['content', true], ['software', false], ['client', false], ['environment', false]])
      assert.equal(await reopened.getByLabel(`Check ${name} updates`, { exact: true }).isChecked(), box);
    assert.match(await reopened.locator('#policy-updates').textContent(), /only read the supplied sources; nothing is applied or scheduled/);
    const draftBefore = await draftRevision(reopened), firstCheck = checkedAt(await checkedText(reopened));
    // Saving the envelope records the last successful check first; the check itself wrote nothing.
    const bytesBefore = await saveDraft(reopened, join(output, 'policy.draft.before-check.json'));
    const envelopeBefore = JSON.parse(decode(bytesBefore));
    assert.equal(envelopeBefore.revision.sequence, draftBefore + 1);
    assert.deepEqual(dispositions(envelopeBefore), [], 'Checking records no choice.');
    const noteBefore = recordedNote(envelopeBefore);
    assert.equal(noteBefore.required, false); assert.equal(noteBefore.checkedAt, firstCheck);
    assert.deepEqual(noteBefore.categories, [{ category: 'content', state: 'checked' }, { category: 'software', state: 'not-selected' },
      { category: 'client', state: 'not-selected' }, { category: 'environment', state: 'not-selected' }]);
    const headlessFirst = await headlessCheck(bytesBefore, [...inventories, updated]);
    assert.deepEqual(headlessFirst.updates.map(update => [update.promoted, update.attention]), [[true, 'new']]);
    assert.deepEqual(headlessFirst.lastCheck, { checkedAt: noteBefore.checkedAt, categories: noteBefore.categories });
    const savedRevision = await draftRevision(reopened);
    assert.equal(savedRevision, envelopeBefore.revision.sequence);
    const ranCheck = await checkNow(reopened);
    assert.deepEqual(ranCheck, ['maintenance-check'], 'Check now performs one bounded read and nothing else.');
    assert.equal(await draftRevision(reopened), savedRevision, 'A check alone leaves the envelope revision unchanged.');
    const bytesAfter = await saveDraft(reopened, join(output, 'policy.draft.after-check.json'));
    const envelopeAfter = JSON.parse(decode(bytesAfter)), noteAfter = recordedNote(envelopeAfter);
    assert.equal(envelopeAfter.revision.sequence, savedRevision + 1);
    assert.ok(noteAfter.checkedAt > noteBefore.checkedAt, 'Saving after a newer check records that check.');
    const unrelated = envelope => envelope.records.filter(record => record.schema !== MAINTENANCE_CHECK_SCHEMA);
    assert.deepEqual(unrelated(envelopeAfter), unrelated(envelopeBefore)); assert.deepEqual(envelopeAfter.savedIntent, envelopeBefore.savedIntent);
    const pageFacts = (await groupRows(reopened, 'Needs attention'))[0].split('\n').filter(line => /^(Authority|Evidence|Availability):/.test(line));
    assert.equal(pageFacts.length, headlessFirst.updates[0].facts.length, 'The page shows exactly the facts the headless check reports.');
    observedFacts.first = headlessFirst.updates[0].facts;
    await shot(reopened, '01-update-available.png');
    scenarios.push('automatic-check-on-open', 'category-line-content-only', 'check-is-read-only', 'check-alone-leaves-envelope-unchanged', 'save-records-last-successful-check');
    revisions.beforeDisposition = envelopeAfter.revision.sequence;

    // 3. Skip that exact revision and save the envelope.
    await section(reopened, 'Needs attention').getByRole('button', { name: 'Skip this revision', exact: true }).click();
    await section(reopened, 'Skipped revisions').waitFor();
    await reopened.locator('#policy-draft-status').filter({ hasText: 'Update choice recorded' }).waitFor();
    groups = await groupsOf(reopened);
    assert.equal(groups['Needs attention'], undefined);
    assert.match(groups['Skipped revisions'][0], /Skipped this exact revision\./);
    const envelopePath = join(output, 'policy.draft.skipped.journey.json');
    const skippedBytes = await saveDraft(reopened, envelopePath);
    const skipped = JSON.parse(decode(skippedBytes));
    assert.equal(skipped.revision.sequence, envelopeAfter.revision.sequence + 2, 'One revision for the choice and one for the recorded check.');
    assert.equal(skipped.executable, false);
    const [skipRecord, ...others] = dispositions(skipped);
    assert.deepEqual(others, []);
    assert.equal(skipRecord.required, false); assert.equal(skipRecord.disposition, 'skip'); assert.equal(skipRecord.category, 'content');
    assert.deepEqual(skipRecord.candidate, { kind: 'content-revision', releaseSha256: updated.release.sha256, itemId: NOTE,
      itemSha256: updated.release.items.find(item => item.id === NOTE).itemSha256 });
    assert.equal(skipRecord.subject.releaseSha256, inventories.at(-1).release.sha256);
    assert.ok(sameBytes(Buffer.from(skipped.savedIntent.base64, 'base64'), policyBytes), 'The saved policy bytes inside the envelope are untouched.');
    revisions.afterSkip = skipped.revision.sequence;
    scenarios.push('skip-exact-revision-saved-not-required');

    // 4. A fresh page opens the envelope; the skip is preserved, the revision is not promoted again.
    const skippedPage = await openPage();
    await openSaved(skippedPage, envelopePath, OPENED);
    groups = await groupsOf(skippedPage);
    assert.deepEqual(Object.keys(groups), ['Skipped revisions']);
    assert.match(groups['Skipped revisions'][0], /review-notes-catalog 1\.0\.1/);
    assert.match(groups['Skipped revisions'][0], /Skipped this exact revision\./);
    assert.match(await checkedText(skippedPage), /^Last checked/);
    const headlessSkipped = await headlessCheck(skippedBytes, [...inventories, updated]);
    assert.deepEqual(headlessSkipped.updates.map(update => [update.disposition?.disposition, update.promoted, update.attention]), [['skip', false, null]]);
    await shot(skippedPage, '02-skip-preserved-after-reopen.png');
    scenarios.push('reopen-preserves-exact-skip', 'headless-agreement-skip');

    // 5. A newer revision is published: it appears separately as needing attention while the skip stays. Defer it.
    await publish(['current', 'updated', 'newer']);
    assert.deepEqual(await checkNow(skippedPage), ['maintenance-check']);
    groups = await groupsOf(skippedPage);
    assert.equal(groups['Needs attention'].length, 1); assert.match(groups['Needs attention'][0], /review-notes-catalog 1\.0\.2/);
    assert.match(groups['Needs attention'][0], /New revision available\./);
    assert.equal(groups['Skipped revisions'].length, 1); assert.match(groups['Skipped revisions'][0], /review-notes-catalog 1\.0\.1/);
    await shot(skippedPage, '03-newer-revision-needs-attention.png');
    const needs = section(skippedPage, 'Needs attention');
    await needs.locator('input[type="date"]').fill(futureDate);
    await needs.getByRole('button', { name: 'Defer', exact: true }).click();
    await section(skippedPage, 'Deferred').waitFor();
    groups = await groupsOf(skippedPage);
    assert.equal(groups['Needs attention'], undefined);
    assert.match(groups.Deferred[0], /review-notes-catalog 1\.0\.2/); assert.match(groups.Deferred[0], new RegExp(`Deferred until ${futureDate}\\.`));
    assert.match(groups['Skipped revisions'][0], /review-notes-catalog 1\.0\.1/);
    await shot(skippedPage, '04-newer-deferred.png');
    const deferredPath = join(output, 'policy.draft.deferred.journey.json');
    const deferredBytes = await saveDraft(skippedPage, deferredPath);
    const deferred = JSON.parse(decode(deferredBytes));
    assert.deepEqual(dispositions(deferred).map(record => [record.disposition, record.candidate.releaseSha256, record.deferUntil, record.required]).sort(),
      [['defer', newer.release.sha256, futureDate, false], ['skip', updated.release.sha256, undefined, false]].sort());
    const savedCheck = recordedNote(deferred);
    assert.ok(savedCheck, 'The saved envelope records its last successful check.');
    const headlessDeferred = await headlessCheck(deferredBytes, [...inventories, updated, newer]);
    assert.deepEqual(headlessDeferred.updates.map(update => [update.candidate.releaseSha256, update.disposition.disposition, update.promoted]).sort(),
      [[updated.release.sha256, 'skip', false], [newer.release.sha256, 'defer', false]].sort());
    revisions.afterDefer = deferred.revision.sequence;
    scenarios.push('newer-revision-separate', 'skip-stays', 'defer-with-future-date', 'headless-agreement-defer');

    // 6. The source becomes unreachable: the last check time is kept, nothing says there are no updates.
    const lastGood = checkedAt(await checkedText(skippedPage));
    assert.ok(lastGood);
    await rm(sourcePath, { force: true });
    assert.deepEqual(await checkNow(skippedPage), ['maintenance-check']);
    const offline = await checkedText(skippedPage);
    assert.match(offline, /^Updates as of /); assert.equal(checkedAt(offline), lastGood); assert.match(offline, /Some updates are unknown\./);
    assert.deepEqual(await categoryLines(skippedPage), ['Content: unknown — sources are unavailable', 'Software: not selected', 'Client: not selected', 'Environment: not selected']);
    groups = await groupsOf(skippedPage);
    assert.equal(groups.Deferred.length, 1); assert.equal(groups['Skipped revisions'].length, 1);
    assert.equal(groups['Preserved choices'], undefined, 'Each retained choice is listed once.');
    assert.doesNotMatch(await skippedPage.locator('#policy-updates').textContent(), /No updates were offered/);
    const offlineHeadless = await headlessCheck(deferredBytes, null);
    assert.deepEqual(offlineHeadless.categories[0], { category: 'content', selected: true, state: 'unknown', reason: 'sources-unavailable' });
    assert.deepEqual(offlineHeadless.updates, []); assert.deepEqual(offlineHeadless.preserved.map(entry => entry.state), ['unknown', 'unknown']);
    await shot(skippedPage, '05-offline-last-check-kept.png');
    scenarios.push('offline-keeps-last-check-time', 'offline-shows-unknown-not-no-updates', 'headless-agreement-offline');

    // 6b. A fresh page reopens the saved envelope while the source is still unreachable: the check time recorded in
    // the envelope is shown, content is unknown now, and the saved choices are preserved, not dropped.
    const offlineReopen = await openPage();
    await openSaved(offlineReopen, deferredPath, OPENED);
    const reopenedOffline = await checkedText(offlineReopen);
    assert.match(reopenedOffline, /^Updates as of /); assert.equal(checkedAt(reopenedOffline), savedCheck.checkedAt); assert.match(reopenedOffline, /Some updates are unknown\./);
    assert.deepEqual(await categoryLines(offlineReopen), ['Content: unknown — sources are unavailable', 'Software: not selected', 'Client: not selected', 'Environment: not selected']);
    const recordedText = await offlineReopen.locator('#policy-updates-recorded').textContent();
    assert.ok(recordedText.includes(savedCheck.checkedAt)); assert.match(recordedText, /Content: checked/);
    groups = await groupsOf(offlineReopen);
    assert.deepEqual(Object.keys(groups), ['Preserved choices']); assert.equal(groups['Preserved choices'].length, 2);
    assert.doesNotMatch(await offlineReopen.locator('#policy-updates').textContent(), /No updates were offered/);
    const reopenedHeadless = await headlessCheck(deferredBytes, null);
    assert.deepEqual(reopenedHeadless.lastCheck, { checkedAt: savedCheck.checkedAt, categories: savedCheck.categories });
    await shot(offlineReopen, '06-offline-reopen-recorded-check.png');
    scenarios.push('offline-reopen-shows-recorded-check', 'headless-agreement-recorded-check');

    // 6c. The source returns. A defer date that has been reached needs attention again when the envelope is
    // reopened or checked; nothing is scheduled or applied.
    await publish(['current', 'updated', 'newer']);
    assert.deepEqual(await checkNow(skippedPage), ['maintenance-check']);
    assert.match(await checkedText(skippedPage), /^Last checked/);
    const deferredNow = section(skippedPage, 'Deferred');
    await deferredNow.locator('input[type="date"]').fill(pastDate);
    await deferredNow.getByRole('button', { name: 'Defer', exact: true }).click();
    await skippedPage.locator('#policy-draft-status').filter({ hasText: 'Update choice recorded' }).waitFor();
    await section(skippedPage, 'Needs attention').waitFor();
    groups = await groupsOf(skippedPage);
    assert.equal(groups.Deferred, undefined);
    assert.match(groups['Needs attention'][0], /review-notes-catalog 1\.0\.2/);
    assert.match(groups['Needs attention'][0], new RegExp(`Defer date reached \\(${pastDate}\\); needs attention\\.`));
    const reachedPath = join(output, 'policy.draft.defer-reached.journey.json');
    const reachedBytes = await saveDraft(skippedPage, reachedPath);
    const reached = JSON.parse(decode(reachedBytes));
    assert.deepEqual(dispositions(reached).map(record => [record.disposition, record.deferUntil]).sort(), [['defer', pastDate], ['skip', undefined]].sort());
    const headlessReached = await headlessCheck(reachedBytes, [...inventories, updated, newer]);
    assert.deepEqual(headlessReached.updates.map(update => [update.package.version, update.attention, update.promoted]).sort(), [['1.0.1', null, false], ['1.0.2', 'defer-date-reached', true]]);
    const reachedPage = await openPage();
    operations = [];
    await openSaved(reachedPage, reachedPath, OPENED);
    assert.deepEqual(operations.filter(operation => !['read', 'draft-open', 'maintenance-check', 'improvements-check', 'workspace-read', 'trials-read', 'evidence-states', 'tool-host'].includes(operation)), [], 'Reopening only reads; nothing is scheduled or applied.');
    groups = await groupsOf(reachedPage);
    assert.equal(groups['Needs attention'].length, 1);
    assert.match(groups['Needs attention'][0], new RegExp(`Defer date reached \\(${pastDate}\\); needs attention\\.`));
    assert.equal(groups['Skipped revisions'].length, 1);
    assert.equal(await draftRevision(reachedPage), reached.revision.sequence, 'Reopening leaves the envelope revision unchanged.');
    await shot(reachedPage, '07-defer-date-reached-after-reopen.png');
    revisions.afterDeferReached = reached.revision.sequence;
    scenarios.push('defer-past-date-saved', 'reopen-defer-date-reached-needs-attention', 'no-scheduler-reads-only', 'headless-agreement-defer-date-reached');

    // 7. A category the Workbench cannot read is unknown; selecting it selects nothing else.
    categoriesSent = [];
    await skippedPage.getByLabel('Check software updates', { exact: true }).check();
    assert.deepEqual(await checkNow(skippedPage), ['maintenance-check']);
    assert.deepEqual(categoriesSent, [['content', 'software']]);
    assert.deepEqual(await categoryLines(skippedPage), ['Content: checked', 'Software: unknown — no supported reader in this Workbench', 'Client: not selected', 'Environment: not selected']);
    for (const [name, box] of [['content', true], ['software', true], ['client', false], ['environment', false]])
      assert.equal(await skippedPage.getByLabel(`Check ${name} updates`, { exact: true }).isChecked(), box);
    assert.match(await checkedText(skippedPage), /Some updates are unknown\./);
    await shot(skippedPage, '08-extra-category-unknown.png');
    scenarios.push('extra-category-unknown-no-reader', 'categories-never-expand');

    // 8. A fully resolved saved policy, with a recorded review decision, gets the same check. The review decision comes
    // from the existing evidence-review flow on the review note; its facts are then shown on the row, whatever the choice.
    await publish(['current', 'updated']);
    const resolvedAuthoring = await openPage();
    await choose(resolvedAuthoring, 'Independent', NOTE);
    await supplyEvidence(resolvedAuthoring);
    await drawer(resolvedAuthoring).getByLabel('Evidence review subject', { exact: true }).selectOption({ label: NOTE });
    await drawer(resolvedAuthoring).getByRole('button', { name: 'Inspect evidence', exact: true }).click();
    await resolvedAuthoring.getByText(/findings bound to the checked subject/).waitFor();
    await drawer(resolvedAuthoring).getByLabel('Review decision ID', { exact: true }).fill(REVIEW);
    await drawer(resolvedAuthoring).getByLabel('Review owner', { exact: true }).fill('fixture-owner');
    await drawer(resolvedAuthoring).getByLabel('Reviewer', { exact: true }).fill('fixture-reviewer');
    await drawer(resolvedAuthoring).getByLabel('Review disposition', { exact: true }).selectOption('false-alarm');
    await drawer(resolvedAuthoring).getByLabel('Review reason', { exact: true }).fill('Fixture note intentionally has no license declaration.');
    // A person chooses the checked finding they are reviewing, by its bound identity (detector · rule ·
    // finding), not a positional index. If Core's page inspection reports no findings while the journey's own
    // evidence binds them, fail with the page's diagnostics instead of a bare select timeout.
    const findingSelect = drawer(resolvedAuthoring).getByLabel('Checked finding', { exact: true });
    // Native select options are attached without their own visible box until the dropdown opens.
    const firstFinding = findingSelect.locator('option:not([value=""])').first();
    if (!await firstFinding.waitFor({ state: 'attached', timeout: 10_000 }).then(() => true).catch(() => false)) {
      await drawer(resolvedAuthoring).getByText('Checked evidence diagnostics').click();
      const diagnostics = await drawer(resolvedAuthoring).locator('pre').filter({ hasText: '{' }).last().innerText().catch(() => '(diagnostics unreadable)');
      throw new Error(`Core's page inspection bound no checked finding to ${NOTE}, while the journey evidence binds ${bound.value.bindings.length}. Page diagnostics: ${diagnostics.slice(0, 1200)}`);
    }
    await findingSelect.selectOption({ label: await firstFinding.textContent() });
    await drawer(resolvedAuthoring).getByRole('button', { name: 'Propose human review', exact: true }).click();
    await resolvedAuthoring.locator('#policy-accept:not([disabled])').waitFor(); await resolvedAuthoring.locator('#policy-accept').click();
    const resolvedPath = join(output, 'policy.resolved.downloaded.json');
    const resolvedBytes = await download(resolvedAuthoring, async () => { await openPolicyDrawer(resolvedAuthoring); await openSetupAdvanced(resolvedAuthoring).then(() => resolvedAuthoring.locator('#policy-save').click()); }, resolvedPath);
    const resolvedIntent = JSON.parse(decode(resolvedBytes)).metadata['aih.workbench'];
    assert.deepEqual(resolvedIntent.roots.map(root => root.itemId), [NOTE]);
    assert.deepEqual(resolvedIntent.reviews.records.map(record => [record.id, record.state]), [[REVIEW, 'current']]);
    const reviewed = await openDraft({ bytes: resolvedBytes, inventories, reviewEvidence: [evidence.bytes] });
    assert.equal(reviewed.status, 'ok', JSON.stringify(reviewed.diagnostics));
    assert.equal(reviewed.value.editing, 'available', 'Every recorded choice resolves.');
    const resolvedHeadless = await headlessCheck(reviewed.value.envelopeBytes, [...inventories, updated]);
    assert.equal(resolvedHeadless.updates.length, 1);
    const expectedFacts = factLines(resolvedHeadless.updates[0].facts);
    assert.ok(expectedFacts.length > 0, 'The recorded review decision is a real evidence fact.');
    assert.ok(expectedFacts.some(line => line.startsWith(`Evidence: Review decision ${REVIEW} `)), expectedFacts.join('\n'));
    observedFacts.resolved = resolvedHeadless.updates[0].facts;

    const resolvedPage = await openPage();
    operations = []; categoriesSent = []; checkInputs = [];
    await supplyEvidence(resolvedPage);
    await openPolicyFileActions(resolvedPage); await resolvedPage.locator('#policy-open').setInputFiles(resolvedPath);
    await drawer(resolvedPage).getByRole('button', { name: 'Validate and reopen', exact: true }).click();
    await resolvedPage.locator('#policy-status').filter({ hasText: 'Saved choices recovered' }).waitFor();
    await openPolicySection(resolvedPage, 'Available updates');
    await waitSettled(resolvedPage, null);
    assert.equal(await resolvedPage.locator('#policy-draft').isHidden(), true, 'A resolved policy reopens as an ordinary policy, not a draft.');
    assert.equal(await resolvedPage.locator('#policy-updates').isVisible(), true);
    assert.deepEqual(operations.filter(operation => !['read', 'maintenance-check', 'improvements-check', 'workspace-read', 'trials-read', 'evidence-states', 'tool-host'].includes(operation)), [], 'Opening may only read.');
    assert.deepEqual(checkInputs, ['policy']); assert.deepEqual(categoriesSent, [['content']]);
    groups = await groupsOf(resolvedPage);
    assert.deepEqual(Object.keys(groups), ['Needs attention']);
    assert.match(groups['Needs attention'][0], /New revision available\./);
    const shownFacts = async (page, label) => factLines((await groupRows(page, label))[0].split('\n').filter(line => /^(Authority|Evidence|Availability):/.test(line)).map(line => {
      const [kind, ...message] = line.split(': '); return { kind: Object.entries(FACT_LABEL).find(([, text]) => text === kind)[0], message: message.join(': ') };
    }));
    assert.deepEqual(await shownFacts(resolvedPage, 'Needs attention'), expectedFacts);
    // Keep current: the update stays available and is listed, but is not promoted as needing attention.
    await section(resolvedPage, 'Needs attention').getByRole('button', { name: 'Keep current', exact: true }).click();
    await section(resolvedPage, 'Kept current').waitFor();
    await resolvedPage.locator('#policy-draft-status').filter({ hasText: 'Update choice recorded' }).waitFor();
    assert.equal(await resolvedPage.locator('#policy-draft').isVisible(), true, 'Recording a choice on a policy saves it as a draft.');
    groups = await groupsOf(resolvedPage);
    assert.equal(groups['Needs attention'], undefined);
    assert.equal(groups['Kept current'].length, 1);
    assert.match(groups['Kept current'][0], /Keep current — this update remains available\./); assert.match(groups['Kept current'][0], /review-notes-catalog 1\.0\.1/);
    assert.deepEqual(await shownFacts(resolvedPage, 'Kept current'), expectedFacts, 'Facts stay visible whatever the choice.');
    assert.equal(await draftRevision(resolvedPage), 2);
    await shot(resolvedPage, '09-resolved-policy-keep-current.png');
    // Then skip that exact revision, save the draft and reopen it.
    await section(resolvedPage, 'Kept current').getByRole('button', { name: 'Skip this revision', exact: true }).click();
    await section(resolvedPage, 'Skipped revisions').waitFor();
    assert.equal((await groupsOf(resolvedPage))['Kept current'], undefined);
    const resolvedDraftPath = join(output, 'policy.resolved.skipped.journey.json');
    const resolvedDraftBytes = await saveDraft(resolvedPage, resolvedDraftPath);
    const resolvedDraft = JSON.parse(decode(resolvedDraftBytes));
    assert.deepEqual(dispositions(resolvedDraft).map(record => [record.disposition, record.required, record.candidate.releaseSha256]), [['skip', false, updated.release.sha256]]);
    assert.ok(recordedNote(resolvedDraft)); assert.equal(resolvedDraft.revision.sequence, 4, 'Keep current, skip, then the recorded check.');
    assert.ok(sameBytes(Buffer.from(resolvedDraft.savedIntent.base64, 'base64'), resolvedBytes), 'The saved policy bytes inside the envelope are untouched.');
    const afterSkip = await shownFacts(resolvedPage, 'Skipped revisions');
    assert.deepEqual(afterSkip, expectedFacts);
    const resolvedReopened = await openPage();
    operations = [];
    await supplyEvidence(resolvedReopened);
    await openSaved(resolvedReopened, resolvedDraftPath, 'Saved draft reopened');
    assert.deepEqual(operations.filter(operation => !['read', 'draft-open', 'maintenance-check', 'improvements-check', 'workspace-read', 'trials-read', 'evidence-states', 'tool-host'].includes(operation)), [], 'Reopening only reads.');
    groups = await groupsOf(resolvedReopened);
    assert.deepEqual(Object.keys(groups), ['Skipped revisions']);
    assert.match(groups['Skipped revisions'][0], /Skipped this exact revision\./);
    assert.deepEqual(await shownFacts(resolvedReopened, 'Skipped revisions'), expectedFacts);
    const resolvedAgain = await headlessCheck(resolvedDraftBytes, [...inventories, updated]);
    assert.deepEqual(resolvedAgain.updates.map(update => [update.disposition?.disposition, update.promoted, update.attention]), [['skip', false, null]]);
    assert.deepEqual(factLines(resolvedAgain.updates[0].facts), expectedFacts);
    await shot(resolvedReopened, '10-resolved-policy-skip-reopened.png');
    revisions.resolvedDraft = resolvedDraft.revision.sequence;
    scenarios.push('resolved-policy-update-shown', 'resolved-policy-check-reads-saved-bytes', 'keep-current-stays-available', 'review-fact-on-row-with-disposition',
      'resolved-policy-skip-becomes-saved-draft', 'resolved-policy-skip-survives-reopen', 'headless-agreement-resolved-policy');

    assert.deepEqual(errors, []); assert.deepEqual(failedResponses, []);
    await writeFile(join(output, 'maintenance-evidence.json'), JSON.stringify({ status: 'passed', entry: '/', chromium: browser.version(), scenarios, categories: UPDATE_CATEGORIES,
      candidates: { updated: updated.release.sha256, newer: newer.release.sha256 }, envelopeRevisions: revisions, defer: { future: futureDate, past: pastDate },
      recordedCheck: { checkedAt: savedCheck.checkedAt, categories: savedCheck.categories }, factsObserved: observedFacts, errors, failedResponses }, null, 2));
    console.log(`Maintenance journey passed: ${output}`);
  } catch (error) {
    await observed?.screenshot({ path: join(output, 'maintenance-failure.png'), fullPage: true }).catch(() => {});
    await writeFile(join(output, 'maintenance-failure.json'), JSON.stringify({ error: error.message, errors, failedResponses, scenarios,
      text: await observed?.locator('body').innerText().catch(() => '') }, null, 2));
    throw error;
  } finally { await browser.close(); }
}
