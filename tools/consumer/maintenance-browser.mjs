// Ordinary Workbench journey: available updates for a saved choice are checked on open and on Check now,
// each exact revision keeps its own skip/defer choice inside the saved envelope, and the check only reads.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { readInstalledRelease } from '@aihq/catalog/node';
import { fileURLToPath } from 'node:url';
import { checkMaintenance, MAINTENANCE_DISPOSITION_SCHEMA, UPDATE_CATEGORIES } from './maintenance.mjs';
import { intakeDeclaration, digestBytes } from './intake.mjs';
import { noteFixture } from './note-fixture.mjs';
import { installedFamilies } from './installed-families.mjs';

const NOTE = 'consumer-proof.review-note', PERSONAL = 'personal.skill.example', OPENED = 'Unresolved draft opened';
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
  const futureDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const browser = await chromium.launch({ headless: true });
  const errors = [], failedResponses = []; let observed; let operations = [], categoriesSent = [];
  const openPage = async () => {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1100 } });
    const page = await context.newPage(); observed = page; page.setDefaultTimeout(30_000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 500) failedResponses.push(`${response.status()} ${response.url()}`); });
    page.on('request', request => {
      const operation = /\/api\/authoring-([\w-]+)$/.exec(new URL(request.url()).pathname)?.[1];
      if (!operation || request.method() !== 'POST') return;
      operations.push(operation);
      if (operation === 'maintenance-check') categoriesSent.push(JSON.parse(request.postData() ?? '{}').categories);
    });
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
  const sameBytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
  const checkedText = page => page.locator('#policy-updates-checked').textContent();
  const checkedAt = text => /(\d{4}-\d\d-\d\dT[\d:.]+Z)/.exec(text)?.[1];
  const groupsOf = page => page.locator('#policy-updates h4').evaluateAll(heads => Object.fromEntries(heads.map(head =>
    [head.textContent, [...head.parentElement.children].slice(1).map(entry => entry.innerText)])));
  const groupRows = async (page, label) => (await groupsOf(page))[label] ?? [];
  const section = (page, label) => page.locator('#policy-updates h4').filter({ hasText: new RegExp(`^${label}$`) }).locator('..');
  const categoryLines = page => page.locator('#policy-updates > div').nth(1).locator('p').allInnerTexts();
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
    await page.locator('#nav-policy').click(); await page.locator('#policy-open').setInputFiles(path);
    await page.getByRole('button', { name: 'Validate and reopen', exact: true }).click();
    await page.locator('#policy-draft-status').filter({ hasText: heading }).waitFor();
    await waitSettled(page, null);
  };
  const dispositions = envelope => envelope.records.filter(record => record.schema === MAINTENANCE_DISPOSITION_SCHEMA);
  const headlessCheck = async (envelopeBytes, candidateInventories) => {
    const result = await checkMaintenance({ envelopeBytes, inventories, candidateInventories, now: now() });
    assert.equal(result.status, 'ok', JSON.stringify(result.diagnostics));
    return result.value;
  };
  const shownChoices = async page => (await page.locator('#policy-draft-roots > div').evaluateAll(rows => rows.map(row => [row.dataset.itemId, row.dataset.status]))).sort();
  const draftRevision = async page => Number(/Draft revision (\d+)/.exec(await page.locator('#policy-draft-note').textContent())?.[1]);
  const scenarios = [], revisions = {}, observedFacts = {};
  try {
    // 1. The source publishes nothing newer. Choose the independent review note and save the policy.
    await publish(['current']);
    const authoring = await openPage();
    // A saved policy whose every choice resolves reopens as an ordinary policy, which holds no envelope. The envelope route is an
    // unresolved draft, so a personal skill (not rebound in the fresh pages) is chosen as well; the review note stays resolved.
    const choose = async (family, id) => {
      await authoring.locator('#nav-sources').click(); await authoring.locator('#browse-support').selectOption('all'); await authoring.locator('#browse-family').selectOption(family);
      await authoring.getByRole('button', { name: `Choose ${id}`, exact: true }).click();
      await authoring.locator('#policy-accept:not([disabled])').waitFor(); await authoring.locator('#policy-accept').click();
    };
    await authoring.locator('#personal-folder').setInputFiles(folder);
    await authoring.locator('#personal-result').filter({ hasText: 'Folder validated' }).waitFor();
    await choose('Personal', PERSONAL);
    await choose('Independent', NOTE);
    const policyPath = join(output, 'policy.downloaded.json');
    const policyBytes = await download(authoring, () => authoring.locator('#policy-save').click(), policyPath);
    assert.deepEqual(JSON.parse(decode(policyBytes)).metadata['aih.workbench'].roots.map(root => root.itemId).sort(), [NOTE, PERSONAL].sort());
    scenarios.push('save-independent-choice');

    // 2. A newer revision is published. Reopening the saved policy checks automatically; nothing is changed by it.
    await publish(['current', 'updated']);
    const reopened = await openPage();
    operations = []; categoriesSent = [];
    await openSaved(reopened, policyPath, OPENED);
    assert.deepEqual(operations.filter(operation => !['read', 'draft-open', 'maintenance-check'].includes(operation)), [], 'Opening may only read.');
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
    const draftBefore = await draftRevision(reopened);
    const bytesBefore = await download(reopened, () => reopened.locator('#policy-draft-save').click(), join(output, 'policy.draft.before-check.json'));
    const envelopeBefore = JSON.parse(decode(bytesBefore));
    assert.equal(envelopeBefore.revision.sequence, draftBefore);
    assert.deepEqual(dispositions(envelopeBefore), [], 'Checking records no choice.');
    const headlessFirst = await headlessCheck(bytesBefore, [...inventories, updated]);
    assert.deepEqual(headlessFirst.updates.map(update => [update.promoted, update.attention]), [[true, 'new']]);
    const ranCheck = await checkNow(reopened);
    assert.deepEqual(ranCheck, ['maintenance-check'], 'Check now performs one bounded read and nothing else.');
    assert.equal(await draftRevision(reopened), draftBefore);
    const bytesAfter = await download(reopened, () => reopened.locator('#policy-draft-save').click(), join(output, 'policy.draft.after-check.json'));
    assert.ok(sameBytes(bytesBefore, bytesAfter), 'A check leaves the draft envelope bytes unchanged.');
    const pageFacts = (await groupRows(reopened, 'Needs attention'))[0].split('\n').filter(line => /^(Authority|Evidence|Availability):/.test(line));
    assert.equal(pageFacts.length, headlessFirst.updates[0].facts.length, 'The page shows exactly the facts the headless check reports.');
    observedFacts.first = headlessFirst.updates[0].facts;
    await reopened.screenshot({ path: join(output, '01-update-available.png'), fullPage: true });
    scenarios.push('automatic-check-on-open', 'category-line-content-only', 'check-is-read-only', 'envelope-bytes-unchanged-by-check');
    revisions.beforeDisposition = envelopeBefore.revision.sequence;

    // 3. Skip that exact revision and save the envelope.
    await section(reopened, 'Needs attention').getByRole('button', { name: 'Skip this revision', exact: true }).click();
    await section(reopened, 'Skipped revisions').waitFor();
    await reopened.locator('#policy-draft-status').filter({ hasText: 'Update choice recorded' }).waitFor();
    groups = await groupsOf(reopened);
    assert.equal(groups['Needs attention'], undefined);
    assert.match(groups['Skipped revisions'][0], /Skipped this exact revision\./);
    const envelopePath = join(output, 'policy.draft.skipped.journey.json');
    const skippedBytes = await download(reopened, () => reopened.locator('#policy-draft-save').click(), envelopePath);
    const skipped = JSON.parse(decode(skippedBytes));
    assert.equal(skipped.revision.sequence, envelopeBefore.revision.sequence + 1);
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
    await skippedPage.screenshot({ path: join(output, '02-skip-preserved-after-reopen.png'), fullPage: true });
    scenarios.push('reopen-preserves-exact-skip', 'headless-agreement-skip');

    // 5. A newer revision is published: it appears separately as needing attention while the skip stays. Defer it.
    await publish(['current', 'updated', 'newer']);
    assert.deepEqual(await checkNow(skippedPage), ['maintenance-check']);
    groups = await groupsOf(skippedPage);
    assert.equal(groups['Needs attention'].length, 1); assert.match(groups['Needs attention'][0], /review-notes-catalog 1\.0\.2/);
    assert.match(groups['Needs attention'][0], /New revision available\./);
    assert.equal(groups['Skipped revisions'].length, 1); assert.match(groups['Skipped revisions'][0], /review-notes-catalog 1\.0\.1/);
    await skippedPage.screenshot({ path: join(output, '03-newer-revision-needs-attention.png'), fullPage: true });
    const needs = section(skippedPage, 'Needs attention');
    await needs.locator('input[type="date"]').fill(futureDate);
    await needs.getByRole('button', { name: 'Defer', exact: true }).click();
    await section(skippedPage, 'Deferred').waitFor();
    groups = await groupsOf(skippedPage);
    assert.equal(groups['Needs attention'], undefined);
    assert.match(groups.Deferred[0], /review-notes-catalog 1\.0\.2/); assert.match(groups.Deferred[0], new RegExp(`Deferred until ${futureDate}\\.`));
    assert.match(groups['Skipped revisions'][0], /review-notes-catalog 1\.0\.1/);
    await skippedPage.screenshot({ path: join(output, '04-newer-deferred.png'), fullPage: true });
    const deferredPath = join(output, 'policy.draft.deferred.journey.json');
    const deferredBytes = await download(skippedPage, () => skippedPage.locator('#policy-draft-save').click(), deferredPath);
    const deferred = JSON.parse(decode(deferredBytes));
    assert.deepEqual(dispositions(deferred).map(record => [record.disposition, record.candidate.releaseSha256, record.deferUntil, record.required]).sort(),
      [['defer', newer.release.sha256, futureDate, false], ['skip', updated.release.sha256, undefined, false]].sort());
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
    await skippedPage.screenshot({ path: join(output, '05-offline-last-check-kept.png'), fullPage: true });
    scenarios.push('offline-keeps-last-check-time', 'offline-shows-unknown-not-no-updates', 'headless-agreement-offline');

    // 7. A category the Workbench cannot read is unknown; selecting it selects nothing else.
    await publish(['current', 'updated', 'newer']);
    categoriesSent = [];
    await skippedPage.getByLabel('Check software updates', { exact: true }).check();
    assert.deepEqual(await checkNow(skippedPage), ['maintenance-check']);
    assert.deepEqual(categoriesSent, [['content', 'software']]);
    assert.deepEqual(await categoryLines(skippedPage), ['Content: checked', 'Software: unknown — no supported reader in this Workbench', 'Client: not selected', 'Environment: not selected']);
    for (const [name, box] of [['content', true], ['software', true], ['client', false], ['environment', false]])
      assert.equal(await skippedPage.getByLabel(`Check ${name} updates`, { exact: true }).isChecked(), box);
    assert.match(await checkedText(skippedPage), /Some updates are unknown\./);
    await skippedPage.screenshot({ path: join(output, '06-extra-category-unknown.png'), fullPage: true });
    scenarios.push('extra-category-unknown-no-reader', 'categories-never-expand');

    assert.deepEqual(errors, []); assert.deepEqual(failedResponses, []);
    await writeFile(join(output, 'maintenance-evidence.json'), JSON.stringify({ status: 'passed', entry: '/', chromium: browser.version(), scenarios, categories: UPDATE_CATEGORIES,
      candidates: { updated: updated.release.sha256, newer: newer.release.sha256 }, envelopeRevisions: revisions, defer: { until: futureDate },
      factsObserved: observedFacts, errors, failedResponses }, null, 2));
    console.log(`Maintenance journey passed: ${output}`);
  } catch (error) {
    await observed?.screenshot({ path: join(output, 'maintenance-failure.png'), fullPage: true }).catch(() => {});
    await writeFile(join(output, 'maintenance-failure.json'), JSON.stringify({ error: error.message, errors, failedResponses, scenarios,
      text: await observed?.locator('body').innerText().catch(() => '') }, null, 2));
    throw error;
  } finally { await browser.close(); }
}
