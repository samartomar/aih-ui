// Ordinary Workbench journey: improvement suggestions are explained from fixed rules, the optional AI prompt is
// attributed and copy-only, a dismissal survives saving and reopening, and a dismissed suggestion returns only for a
// new reason or on request. No model is called and nothing is applied.
// Not journeyed here: "a label change does not reset identity". Identity and revision exclude labels, descriptions and the
// release digest by construction and the consumer tests prove it against digest-checked installed releases; faking a
// second Catalog release in the running page would prove nothing more.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInstalledRelease } from '@aihq/catalog/node';
import { listItems } from '@aihq/catalog/reader';
import { composeAuthoring, freshAuthoring, openDraft } from './headless.mjs';
import { installedFamilies } from './installed-families.mjs';
import { intakeDeclaration, digestBytes } from './intake.mjs';
import { noteFixture } from './note-fixture.mjs';
import { IMPROVEMENT_SUGGESTION_SCHEMA, IMPROVEMENT_DISMISSAL_SCHEMA } from './improvements.mjs';
import { UNKNOWNS, FRICTION_UNKNOWN, IMPROVEMENT_RULES_VERSION } from './improvement-rules.mjs';

const decode = bytes => new TextDecoder().decode(bytes);
const ROOT = 'mattpocock.implement', CLIENTS = ['claude', 'codex'];
const SAVED_REASON = 'guided-setup rules 1.0.0: goal.build. Goal: add tests to my app. Project: JavaScript.';
const READS = ['read', 'draft-open', 'maintenance-check', 'improvements-check', 'workspace-read', 'trials-read'];
const OPENED = /Saved draft reopened|Unresolved draft opened/;

export async function runImprovementsBrowser({ origin, output, playwrightModule, settingsPath, sourcePath }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  // Explicit setup step, never a Workbench action: the draft guided setup would have saved, built headlessly.
  const maintained = await readInstalledRelease({ root: dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'))), sourceInput: 'maintained' });
  const inventories = [{ release: maintained.release, materialSource: { kind: 'local', input: 'maintained' } }, ...await installedFamilies()];
  const root = listItems(maintained.release).find(item => item.id === ROOT);
  assert.ok(root, `${ROOT} is offered by the installed Catalog.`);
  const intent = { ...freshAuthoring(), roots: [{ releaseSha256: maintained.release.sha256, itemId: ROOT, itemSha256: root.itemSha256, scope: 'project', configuration: {},
    originIds: ['direct'], reason: SAVED_REASON }] };
  const composed = await composeAuthoring({ intent, inventories });
  assert.equal(composed.status, 'ok', JSON.stringify(composed.diagnostics));
  const opened = await openDraft({ bytes: composed.value.policyBytes, inventories });
  assert.equal(opened.status, 'ok', JSON.stringify(opened.diagnostics));
  const importPath = join(output, 'guided-setup.draft.json');
  await writeFile(importPath, opened.value.envelopeBytes);

  const browser = await chromium.launch({ headless: true });
  const errors = [], failedResponses = [], popups = [];
  let observed, operations = [], requests = [], checkResponses = 0, setupRoute, previousSettings, previousSource;
  const openPage = async () => {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1100 } });
    // Headless evidence stays on the supplied local origin.
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(origin).origin ? route.continue() : route.abort());
    // A page-level clipboard stand-in: the journey observes what is copied without touching the machine's real clipboard.
    await context.addInitScript(() => { window.__copied = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copied.push(text); } } }); });
    const page = await context.newPage(); observed = page; page.setDefaultTimeout(30_000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('popup', popup => popups.push(popup.url()));
    page.on('response', response => {
      if (response.status() >= 500) failedResponses.push(`${response.status()} ${response.url()}`);
      if (response.request().method() === 'POST' && /\/api\/authoring-improvements-check$/.test(new URL(response.url()).pathname)) checkResponses++;
    });
    page.on('request', request => {
      requests.push(`${request.method()} ${request.url()}`);
      const operation = /\/api\/authoring-([\w-]+)$/.exec(new URL(request.url()).pathname)?.[1];
      if (operation && request.method() === 'POST') operations.push(operation);
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
  const saveDraft = (page, path) => download(page, () => page.locator('#policy-draft-save').click(), path);
  const section = page => page.locator('#policy-improvements');
  const groupCards = (page, label) => section(page).locator('h4').filter({ hasText: new RegExp(`^${label}$`) }).locator('..').locator('[data-suggestion-id]');
  const groupLabels = page => section(page).locator('h4').allInnerTexts();
  const improvementStatus = page => section(page).locator('p[role="status"]');
  // A check is settled when its response arrived and the section left "Checking improvements…".
  const settled = async (page, seen) => {
    while (checkResponses <= seen) await page.waitForTimeout(50);
    await improvementStatus(page).filter({ hasText: /^Checked / }).waitFor();
  };
  const act = async (page, trigger) => {
    const seen = checkResponses, from = operations.length;
    await trigger(); await settled(page, seen);
    return operations.slice(from);
  };
  const openSaved = async (page, path) => {
    const seen = checkResponses; operations = [];
    await page.locator('#nav-policy').click(); await page.locator('#policy-open').setInputFiles(path);
    await page.getByRole('button', { name: 'Validate and reopen', exact: true }).click();
    await page.locator('#policy-draft-status').filter({ hasText: OPENED }).waitFor();
    await settled(page, seen);
    return [...operations];
  };
  const suggestWith = (page, goal) => act(page, async () => { await section(page).locator('#policy-improvements-goal').fill(goal); await section(page).locator('#policy-improvements-suggest').click(); });
  const dismissLeading = page => act(page, () => groupCards(page, 'Leading suggestion').first().getByRole('button', { name: 'Dismiss', exact: true }).click());
  const shot = async (page, name) => {
    // The page scrolls inside its own panes, so the window is made tall enough to show every card.
    await page.setViewportSize({ width: 1440, height: 2600 });
    await page.screenshot({ path: join(output, name) });
    await page.setViewportSize({ width: 1440, height: 1100 });
    return name;
  };
  const records = (envelopeBytes, schema) => JSON.parse(decode(envelopeBytes)).records.filter(record => record.schema === schema);
  const steps = {}, screenshots = [];
  try {
    // 1. Setup. The person saves their AI clients (an explicit setup step), then imports the guided-setup draft as a file.
    const first = await openPage();
    const setup = await first.evaluate(async clients => {
      const response = await fetch('/api/workbench-settings/clients', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clients }) });
      return { status: response.status, body: await response.json() };
    }, CLIENTS);
    if (setup.status === 200) { assert.deepEqual(setup.body.settings.clients, CLIENTS); setupRoute = 'settings-api'; }
    else {
      // An installed Core that does not publish its client list cannot validate a client choice, so the service refuses every one.
      // The same saved-setup file is then written directly, which is all the endpoint would have done.
      assert.equal(setup.status, 422, JSON.stringify(setup.body)); assert.match(setup.body.error, /supported AI clients are unavailable/);
      assert.ok(settingsPath, 'The host supplies the setup file location.');
      const saved = JSON.parse(await readFile(settingsPath, 'utf8')); previousSettings = saved;
      await writeFile(settingsPath, JSON.stringify({ ...saved, clients: CLIENTS }, null, 2) + '\n');
      setupRoute = 'settings-file';
    }
    const saved = await first.evaluate(async () => (await fetch('/api/workbench-settings')).json());
    assert.deepEqual(saved.settings.clients, CLIENTS, 'The Workbench reads the saved clients.');
    // A client Core lists is named by its Harness label; without a published list or label, by its id.
    const { coreTargets } = await first.evaluate(async () => (await fetch('/api/packages')).json());
    const named = id => coreTargets?.state === 'published' && typeof coreTargets.labels?.[id] === 'string' ? coreTargets.labels[id] : id;

    // 2. Opening shows a leading suggestion and alternatives, explained, and only reads.
    steps.open = await openSaved(first, importPath);
    assert.deepEqual(steps.open.filter(operation => !READS.includes(operation)), [], 'Opening may only read.');
    assert.ok(steps.open.includes('improvements-check'));
    assert.deepEqual(await groupLabels(first), ['Leading suggestion', 'Alternatives']);
    assert.equal(await groupCards(first, 'Leading suggestion').count(), 1);
    const leading = groupCards(first, 'Leading suggestion').first();
    const tddId = await leading.getAttribute('data-suggestion-id');
    const leadingText = await leading.innerText();
    assert.match(leadingText, /Scope: project/); assert.match(leadingText, /Goal: add tests to my app/);
    assert.match(leadingText, /Your saved goal “add tests to my app” mentions “tests”\./);
    assert.match(leadingText, /^Adds \d+ files?, \d+ bytes in total, and needs \d+ other items?/m);
    assert.match(leadingText, /Applies in this project only/);
    for (const unknown of UNKNOWNS) assert.ok(leadingText.includes(unknown), `Unknown shown: ${unknown}`);
    assert.doesNotMatch(leadingText, /Shown again/);
    const alternatives = await groupCards(first, 'Alternatives').allInnerTexts();
    assert.equal(alternatives.length, CLIENTS.length);
    for (const client of CLIENTS) {
      const card = alternatives.find(text => text.includes(`You use ${named(client)} (Workbench setup), but this policy does not give it the shared project instructions.`));
      assert.ok(card, `A client-instructions suggestion for ${client}.`);
      assert.match(card, /Scope: project/); assert.match(card, /Adds \d+ files?/);
      for (const unknown of UNKNOWNS) assert.ok(card.includes(unknown));
    }
    assert.match(await section(first).textContent(), /No model is called and nothing is applied or sent\./);
    screenshots.push(await shot(first, '1-suggestions.png'));

    // 3. The AI prompt is attributed and copy-only: copying makes no request of any kind and opens no popup.
    const promptButtons = leading.getByRole('button', { name: 'Ask your AI client', exact: true });
    await promptButtons.click();
    const textarea = leading.locator('textarea');
    const promptText = await textarea.inputValue();
    assert.equal(await textarea.evaluate(node => node.readOnly), true);
    assert.match(promptText, new RegExp(`Suggested by the AIH Workbench improvement rules ${IMPROVEMENT_RULES_VERSION.replaceAll('.', '\\.')}`));
    assert.match(promptText, /AI advice/);
    assert.match(await leading.innerText(), /AI advice — paste this into an AI client you already use\. The Workbench sends nothing, runs nothing and calls no model\./);
    const requestsBefore = requests.length, popupsBefore = popups.length;
    await leading.getByRole('button', { name: 'Copy prompt', exact: true }).click();
    await first.locator('#policy-draft-status').filter({ hasText: 'Prompt copied.' }).waitFor();
    // A short quiet period, so a request started by the copy would have been observed.
    await first.waitForTimeout(300);
    assert.deepEqual(await first.evaluate(() => window.__copied), [promptText], 'Exactly the prompt shown is copied, once.');
    assert.deepEqual(requests.slice(requestsBefore), [], 'Copying makes no request of any kind.');
    assert.equal(popups.length, popupsBefore, 'Copying opens no window.');
    steps.copy = [];
    screenshots.push(await shot(first, '2-ai-prompt.png'));

    // 4. Dismiss the TDD suggestion: it moves to Dismissed; saving the draft keeps the dismissal.
    steps.dismiss = await dismissLeading(first);
    assert.ok(steps.dismiss.includes('improvements-record'), steps.dismiss.join());
    assert.deepEqual(steps.dismiss.filter(operation => !['improvements-record', 'improvements-check'].includes(operation)), []);
    assert.equal(await groupCards(first, 'Dismissed').count(), 1);
    assert.equal(await groupCards(first, 'Dismissed').first().getAttribute('data-suggestion-id'), tddId, 'Dismissing keeps the identity.');
    assert.match(await groupCards(first, 'Dismissed').first().innerText(), /mentions “tests”/);
    assert.ok(!(await groupLabels(first)).includes('Leading suggestion') || (await groupCards(first, 'Leading suggestion').evaluateAll((nodes, id) => nodes.every(node => node.dataset.suggestionId !== id), tddId)));
    screenshots.push(await shot(first, '3-dismissed.png'));
    const savedPath = join(output, 'dismissed.draft.json');
    const savedBytes = await saveDraft(first, savedPath);
    const dismissals = records(savedBytes, IMPROVEMENT_DISMISSAL_SCHEMA), suggestionsSaved = records(savedBytes, IMPROVEMENT_SUGGESTION_SCHEMA);
    assert.equal(dismissals.length, 1); assert.equal(suggestionsSaved.length, 1);
    assert.equal(suggestionsSaved[0].id, tddId); assert.equal(dismissals[0].suggestion.id, tddId); assert.equal(dismissals[0].required, false);

    // 5. A fresh page opens the saved envelope: the dismissal survived. The same reason does not nudge again.
    const reopened = await openPage();
    steps.reopen = await openSaved(reopened, savedPath);
    assert.deepEqual(steps.reopen.filter(operation => !READS.includes(operation)), [], 'Reopening only reads.');
    assert.equal(await groupCards(reopened, 'Dismissed').count(), 1);
    const tddAfterReopen = await groupCards(reopened, 'Dismissed').first().getAttribute('data-suggestion-id');
    assert.equal(tddAfterReopen, tddId, 'The suggestion keeps its identity across reopening.');
    assert.ok(!(await groupLabels(reopened)).includes('Leading suggestion') || (await groupCards(reopened, 'Leading suggestion').evaluateAll((nodes, id) => nodes.every(node => node.dataset.suggestionId !== id), tddId)));
    screenshots.push(await shot(reopened, '4-reopened-dismissed.png'));
    steps.sameReason = await suggestWith(reopened, 'write more tests');
    assert.deepEqual(steps.sameReason, ['improvements-check'], 'Suggesting again only reads.');
    assert.equal(await groupCards(reopened, 'Dismissed').count(), 1);
    assert.equal(await groupCards(reopened, 'Dismissed').first().getAttribute('data-suggestion-id'), tddId, 'The same reason keeps it dismissed.');
    assert.doesNotMatch(await section(reopened).innerText(), /Shown again/);

    // 6. A new reason (different rule) is a material change: it is shown again, with the reason.
    steps.newReason = await suggestWith(reopened, 'fewer regressions');
    assert.deepEqual(steps.newReason, ['improvements-check']);
    assert.equal(await groupCards(reopened, 'Dismissed').count(), 0);
    const again = groupCards(reopened, 'Leading suggestion').first();
    assert.equal(await again.getAttribute('data-suggestion-id'), tddId, 'Re-promotion keeps the identity.');
    const againText = await again.innerText();
    assert.ok(againText.includes('Shown again: a new reason applies — You asked about “fewer regressions”, which mentions “regressions”.'), againText);
    screenshots.push(await shot(reopened, '5-repromoted.png'));

    // 7. Dismiss it again, then ask to see it: "Show again" returns it active with no dismissal.
    steps.dismissAgain = await dismissLeading(reopened);
    assert.ok(steps.dismissAgain.includes('improvements-record'));
    assert.equal(await groupCards(reopened, 'Dismissed').count(), 1);
    assert.equal(await groupCards(reopened, 'Dismissed').first().getAttribute('data-suggestion-id'), tddId);
    steps.showAgain = await act(reopened, () => groupCards(reopened, 'Dismissed').first().getByRole('button', { name: 'Show again', exact: true }).click());
    assert.ok(steps.showAgain.includes('improvements-record'));
    assert.deepEqual(steps.showAgain.filter(operation => !['improvements-record', 'improvements-check'].includes(operation)), []);
    assert.equal(await groupCards(reopened, 'Dismissed').count(), 0);
    const requested = groupCards(reopened, 'Leading suggestion').first();
    assert.equal(await requested.getAttribute('data-suggestion-id'), tddId);
    assert.doesNotMatch(await requested.innerText(), /Shown again/);
    assert.equal(await requested.getByRole('button', { name: 'Dismiss', exact: true }).count(), 1);
    screenshots.push(await shot(reopened, '6-shown-on-request.png'));
    const finalBytes = await saveDraft(reopened, join(output, 'shown-on-request.draft.json'));
    assert.deepEqual(records(finalBytes, IMPROVEMENT_DISMISSAL_SCHEMA), [], 'Showing it again removes the dismissal.');

    // 8. Explicit headless setup: the saved guided goal plus a direct current notes selection.
    // Intake exactly the snapshot/input the running mixed service holds, so release and item digests match.
    assert.ok(sourcePath, 'The host supplies its file-backed update source for the content-change journey.');
    previousSource = await readFile(sourcePath);
    await writeFile(sourcePath, JSON.stringify({ revisions: ['current'] }));
    const snapshot = await noteFixture();
    const input = { id: 'notes', kind: 'local', locator: { input: 'notes' }, resolvedIdentity: { sha256: await digestBytes(snapshot.declarationBytes) } };
    const notes = await intakeDeclaration({ input, ...snapshot, materialSource: { kind: 'local', input: 'notes' } });
    assert.equal(notes.status, 'ok', JSON.stringify(notes.diagnostics));
    const note = listItems(notes.value.release).find(item => item.id === 'consumer-proof.review-note');
    assert.ok(note, 'The current notes release contains the review note.');
    const contentInventories = [...inventories, notes.value];
    const contentIntent = { ...intent, roots: [...intent.roots, { releaseSha256: notes.value.release.sha256,
      itemId: note.id, itemSha256: note.itemSha256, scope: 'project', configuration: {}, originIds: ['direct'] }] };
    const contentComposed = await composeAuthoring({ intent: contentIntent, inventories: contentInventories });
    assert.equal(contentComposed.status, 'ok', JSON.stringify(contentComposed.diagnostics));
    const contentOpened = await openDraft({ bytes: contentComposed.value.policyBytes, inventories: contentInventories });
    assert.equal(contentOpened.status, 'ok', JSON.stringify(contentOpened.diagnostics));
    const contentPath = join(output, 'content-change.draft.json');
    await writeFile(contentPath, contentOpened.value.envelopeBytes);
    const contentPage = await openPage();
    steps.contentOpen = await openSaved(contentPage, contentPath);
    assert.deepEqual(steps.contentOpen.filter(operation => !READS.includes(operation)), [], 'Opening for content changes only reads.');
    assert.ok(steps.contentOpen.includes('improvements-check'));
    const coverage = contentPage.locator('#policy-improvements-coverage');
    assert.equal(await coverage.isVisible(), true, 'Coverage is visible.');
    const currentCoverage = await coverage.innerText();
    assert.match(currentCoverage, /content[- ]changes?/i);
    assert.match(currentCoverage, /\bchecked\b/i, 'The configured current revision was checked.');
    const cards = section(contentPage).locator('[data-suggestion-id]');
    const testPlan = cards.filter({ hasText: 'Test plan note' });
    const style = cards.filter({ hasText: 'Style note' });
    assert.equal(await testPlan.count(), 0); assert.equal(await style.count(), 0);

    await writeFile(sourcePath, JSON.stringify({ revisions: ['expanded'] }));
    steps.contentSuggest = await suggestWith(contentPage, '');
    assert.deepEqual(steps.contentSuggest, ['improvements-check'], 'Checking the newer content only reads.');
    assert.equal(await testPlan.count(), 1, 'The goal-relevant new note is suggested.');
    assert.equal(await style.count(), 0, 'The unrelated new note is never suggested.');
    const contentId = await testPlan.getAttribute('data-suggestion-id');
    const contentText = await testPlan.innerText();
    const contentTriggers = await testPlan.locator('p').filter({ hasText: /is new in review-notes-catalog 1\.1\.0/ }).allInnerTexts();
    assert.equal(contentTriggers.length, 1);
    assert.match(contentText, /is new in review-notes-catalog 1\.1\.0/);
    assert.match(contentText, /your saved goal “add tests to my app”/i);
    assert.match(contentText, /mentions “tests”/);
    for (const unknown of UNKNOWNS) assert.ok(contentText.includes(unknown), `Unknown shown: ${unknown}`);
    assert.equal(await coverage.isVisible(), true);
    const expandedCoverage = await coverage.innerText();
    assert.match(expandedCoverage, /content[- ]changes?/i); assert.match(expandedCoverage, /\bchecked\b/i);
    assert.ok(expandedCoverage.includes(FRICTION_UNKNOWN), 'The friction unknown names the missing interface.');

    steps.contentDismiss = await act(contentPage, () => testPlan.getByRole('button', { name: 'Dismiss', exact: true }).click());
    assert.ok(steps.contentDismiss.includes('improvements-record'));
    assert.deepEqual(steps.contentDismiss.filter(operation => !['improvements-record', 'improvements-check'].includes(operation)), []);
    steps.contentSameReason = await suggestWith(contentPage, '');
    assert.deepEqual(steps.contentSameReason, ['improvements-check'], 'Suggesting the same content reason only reads.');
    const dismissedContent = groupCards(contentPage, 'Dismissed').filter({ hasText: 'Test plan note' });
    assert.equal(await dismissedContent.count(), 1);
    assert.equal(await testPlan.count(), 1, 'There is no duplicate active card after dismissal.');
    assert.equal(await dismissedContent.getAttribute('data-suggestion-id'), contentId);
    const dismissedText = await dismissedContent.innerText();
    assert.deepEqual(await dismissedContent.locator('p').filter({ hasText: /is new in review-notes-catalog 1\.1\.0/ }).allInnerTexts(), contentTriggers, 'The exact content-change reason stays the same.');
    assert.match(dismissedText, /is new in review-notes-catalog 1\.1\.0/);
    assert.match(dismissedText, /your saved goal “add tests to my app”/i);
    assert.doesNotMatch(dismissedText, /Shown again/);
    assert.equal(await style.count(), 0);
    await contentPage.setViewportSize({ width: 1440, height: 2600 });
    await contentPage.screenshot({ path: join(output, 'content-change.png'), fullPage: true });
    screenshots.push('content-change.png');
    const contentChange = { savedGoal: 'add tests to my app', savedNotesRelease: notes.value.release.sha256,
      current: { revisions: ['current'], coverage: currentCoverage, testPlanSuggestions: 0, styleSuggestions: 0 },
      expanded: { revisions: ['expanded'], coverage: expandedCoverage, suggestionId: contentId, text: contentText, styleSuggestions: 0 },
      dismissed: { suggestionId: contentId, text: dismissedText, sameReasonStaysDismissed: true } };

    assert.deepEqual(errors, []); assert.deepEqual(failedResponses, []);
    await writeFile(join(output, 'improvements-evidence.json'), JSON.stringify({ status: 'passed', entry: '/', chromium: browser.version(), rulesVersion: IMPROVEMENT_RULES_VERSION,
      savedGoal: SAVED_REASON, clients: CLIENTS, clientSetup: setupRoute, screenshots, operations: steps, tddSuggestionId: { beforeReopen: tddId, afterReopen: tddAfterReopen },
      contentChange, copy: { requests: 0, popups: 0, clipboardEqualsPrompt: true }, errors, failedResponses }, null, 2));
    console.log(`Improvements journey passed: ${output}`);
  } catch (error) {
    await observed?.screenshot({ path: join(output, 'improvements-failure.png'), fullPage: true }).catch(() => {});
    await writeFile(join(output, 'improvements-failure.json'), JSON.stringify({ error: error.message, errors, failedResponses, steps,
      text: await observed?.locator('body').innerText().catch(() => '') }, null, 2));
    throw error;
  } finally {
    if (previousSource !== undefined) await writeFile(sourcePath, previousSource);
    if (previousSettings) await writeFile(settingsPath, JSON.stringify(previousSettings, null, 2) + '\n');
    await browser.close();
  }
}
