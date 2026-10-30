// Ordinary Workbench journey: a suggested Catalog item is tried in a bounded trial. The quality it must meet is defined first,
// every bound shows its unit, value and "advisory (not enforced)", a trial that misses its quality bar is "no qualifying
// improvement" whatever the overhead did, a stop ends the evaluation without claiming anything was undone (restoration is tracked
// apart), and an inconclusive keep adds only the one chosen item and claims no improvement. Overhead rows are Core's
// context-change results. Nothing is applied, no model is called and nothing is spent.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInstalledRelease } from '@aihq/catalog/node';
import { listItems } from '@aihq/catalog/reader';
import { composeAuthoring, editDraft, freshAuthoring, openDraft } from './headless.mjs';
import { installedFamilies } from './installed-families.mjs';
import { DRAFT_RECORD_SCHEMA } from './journey.mjs';
import { IMPROVEMENT_SUGGESTION_SCHEMA, IMPROVEMENT_DISMISSAL_SCHEMA } from './improvements.mjs';
import { TRIAL_SCHEMA, DIMENSION_LABELS } from './trials.mjs';
import { RESTORATION_STATUSES } from './trial-record.mjs';
import { drawer, openPolicyDrawer, openPolicyFileActions, openPolicySection } from './policy-drawer.mjs';
import { openPolicyWorkspace } from './advanced-browser.mjs';

const decode = bytes => new TextDecoder().decode(bytes);
const ROOT = 'mattpocock.implement', UNRELATED = 'aihq.project-context', SKIPPED = 'mattpocock.wait-what', SUGGESTED = 'mattpocock.tdd', CLIENTS = ['claude', 'codex'];
const SAVED_REASON = 'guided-setup rules 1.0.0: goal.build. Goal: add tests to my app. Project: JavaScript.';
const READS = ['read', 'draft-open', 'maintenance-check', 'improvements-check', 'workspace-read', 'trials-read', 'evidence-states', 'tool-host'];
// A trial step writes exactly its record and re-reads. The drawer may also re-read the chosen tool's host, read-only, while
// that host has given no answer (F15 retries an unavailable answer on each change); only that read is set aside.
const written = operations => operations.filter(operation => operation !== 'tool-host');
const OPENED = /Saved draft reopened|Unresolved draft opened/;
const NO_CAP = 'No enforcement mechanism is available here, so no bound is a cap.';
const COST_UNKNOWN = 'Model or service spending: no cost source is connected, so it is unknown.';

export async function runTrialsBrowser({ origin, output, playwrightModule, settingsPath }) {
  const started = Date.now();
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  // Explicit setup step, never a Workbench action: the draft guided setup would have saved, with a second, unrelated choice and
  // an unrelated skip, so "unrelated selections are untouched" can be checked in the browser too.
  const maintained = await readInstalledRelease({ root: dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'))), sourceInput: 'maintained' });
  const inventories = [{ release: maintained.release, materialSource: { kind: 'local', input: 'maintained' } }, ...await installedFamilies()];
  const items = listItems(maintained.release), itemOf = id => { const item = items.find(candidate => candidate.id === id); assert.ok(item, `${id} is offered by the installed Catalog.`); return item; };
  const rootOf = (id, extra = {}) => ({ releaseSha256: maintained.release.sha256, itemId: id, itemSha256: itemOf(id).itemSha256, scope: 'project', configuration: {}, originIds: ['direct'], ...extra });
  const intent = { ...freshAuthoring(), roots: [rootOf(ROOT, { reason: SAVED_REASON }), rootOf(UNRELATED)] };
  const composed = await composeAuthoring({ intent, inventories });
  assert.equal(composed.status, 'ok', JSON.stringify(composed.diagnostics));
  const opened = await openDraft({ bytes: composed.value.policyBytes, inventories });
  assert.equal(opened.status, 'ok', JSON.stringify(opened.diagnostics));
  const skipped = await editDraft({ envelopeBytes: opened.value.envelopeBytes, inventories, operation: { type: 'skip', exclusion: { originId: 'direct', releaseSha256: maintained.release.sha256, itemId: SKIPPED, scope: 'project' } } });
  assert.equal(skipped.status, 'ok', JSON.stringify(skipped.diagnostics));
  const importPath = join(output, 'guided-setup.draft.json');
  await writeFile(importPath, skipped.value.envelopeBytes);
  const draftOf = bytes => JSON.parse(decode(bytes)).records.find(record => record.schema === DRAFT_RECORD_SCHEMA).intent;
  const before = draftOf(skipped.value.envelopeBytes);
  assert.equal(before.exclusions.length, 1, 'The imported draft holds the unrelated skip.');

  const browser = await chromium.launch({ headless: true });
  const errors = [], failedResponses = [], offOrigin = [];
  let observed, operations = [], seenOperations = new Map(), recorded = 0, readDone = 0, recordDone = 0, lastRead, previousSettings, setupRoute;
  const sameOrigin = url => new URL(url).origin === new URL(origin).origin;
  const openPage = async () => {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1100 } });
    // Headless evidence stays on the supplied local origin.
    await context.route('**/*', route => { if (sameOrigin(route.request().url())) return route.continue(); offOrigin.push(route.request().url()); return route.abort(); });
    const page = await context.newPage(); observed = page; page.setDefaultTimeout(30_000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.status() >= 500) failedResponses.push(`${response.status()} ${response.url()}`);
      const operation = response.request().method() === 'POST' ? /\/api\/authoring-([\w-]+)$/.exec(new URL(response.url()).pathname)?.[1] : undefined;
      if (operation === 'trials-read') { readDone++; lastRead = response; }
      if (operation === 'trials-record') recordDone++;
    });
    page.on('request', request => {
      const operation = /\/api\/authoring-([\w-]+)$/.exec(new URL(request.url()).pathname)?.[1];
      if (operation && request.method() === 'POST') { operations.push(operation); seenOperations.set(operation, (seenOperations.get(operation) ?? 0) + 1); }
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
  const trialsOf = page => page.locator('#policy-trials');
  const cards = page => trialsOf(page).locator('[data-trial-id]');
  const card = (page, id) => trialsOf(page).locator(`[data-trial-id="${id}"]`);
  const idle = page => trialsOf(page).locator('p[role="status"]').filter({ hasText: 'Save the draft to keep trial records.' }).waitFor();
  const labelled = (scope, label) => scope.locator(`[aria-label="${label}"]`);
  const suggestions = page => page.locator('#policy-improvements');
  const leadingCard = page => suggestions(page).locator('h4').filter({ hasText: /^Leading suggestion$/ }).locator('..').locator('[data-suggestion-id]').first();
  const suggestionsSettled = async page => suggestions(page).locator('p[role="status"]').filter({ hasText: /^Checked / }).waitFor();
  const openSaved = async (page, path) => {
    operations = [];
    await openPolicyWorkspace(page); await openPolicyFileActions(page); await page.locator('#policy-open').setInputFiles(path);
    await drawer(page).getByRole('button', { name: 'Validate and reopen', exact: true }).click();
    await page.locator('#policy-draft-status').filter({ hasText: OPENED }).waitFor();
    // Reopening used to run every check; a person now opens each section, so the update check whose note the save records runs too.
    await openPolicySection(page, 'Available updates');
    await openPolicySection(page, 'Improvement suggestions');
    await openPolicySection(page, 'Improvement trials');
    await suggestionsSettled(page); await idle(page);
    return [...operations];
  };
  // One recorded operation: waits for the record, the re-read that follows it and the view to settle.
  const act = async (page, trigger) => {
    const [seenRead, seenRecord, from] = [readDone, recordDone, operations.length];
    await trigger();
    while (recordDone <= seenRecord || readDone <= seenRead) await page.waitForTimeout(25);
    await idle(page);
    recorded++;
    return operations.slice(from);
  };
  const lastTrials = async () => (await (await lastRead).json()).value.trials;
  const shot = async (page, name) => {
    // The page scrolls inside its own panes, so the window is made tall enough to show every card.
    await page.setViewportSize({ width: 1440, height: 2600 });
    await page.screenshot({ path: join(output, name) });
    await page.setViewportSize({ width: 1440, height: 1100 });
    return name;
  };
  const textOf = locator => locator.innerText();
  const planFields = async (page, { task, outcome, checks, conditions }) => {
    const planning = trialsOf(page);
    await labelled(planning, 'Representative task').fill(task);
    await labelled(planning, 'Acceptable outcome').fill(outcome);
    for (const [index, text] of checks.entries()) {
      if (index > 0) await planning.getByRole('button', { name: 'Add quality check', exact: true }).click();
      await labelled(planning, `Quality check ${index + 1}`).fill(text);
    }
    await labelled(planning, 'Comparison conditions').fill(conditions);
  };
  const observe = (page, id, { option, target, kind = 'measured', amount, unit, result }) => act(page, async () => {
    const scope = card(page, id);
    await labelled(scope, 'Observation option').selectOption(option); await labelled(scope, 'Observation target').selectOption(target); await labelled(scope, 'Observation kind').selectOption(kind);
    if (target.startsWith('check:')) await labelled(scope, 'Quality result').selectOption(result);
    else { await labelled(scope, 'Observation amount').fill(String(amount)); await labelled(scope, 'Observation unit').fill(unit); }
    await scope.getByRole('button', { name: 'Record observation', exact: true }).click();
  });
  const press = (page, id, name) => act(page, () => card(page, id).getByRole('button', { name, exact: true }).click());
  const records = (envelopeBytes, schema) => JSON.parse(decode(envelopeBytes)).records.filter(record => record.schema === schema);
  const steps = {}, screenshots = [], facts = {};
  try {
    // 1. Setup. The person saves their AI clients (an explicit setup step), then imports the guided-setup draft as a file.
    const first = await openPage();
    const setup = await first.evaluate(async clients => {
      const response = await fetch('/api/workbench-settings/clients', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clients }) });
      return { status: response.status, body: await response.json() };
    }, CLIENTS);
    if (setup.status === 200) { assert.deepEqual(setup.body.settings.clients, CLIENTS); setupRoute = 'settings-api'; }
    else {
      // An installed Core that does not publish its client list cannot validate a client choice; the same saved-setup file is
      // then written directly, which is all the endpoint would have done.
      assert.equal(setup.status, 422, JSON.stringify(setup.body)); assert.match(setup.body.error, /supported AI clients are unavailable/);
      assert.ok(settingsPath, 'The host supplies the setup file location.');
      const saved = JSON.parse(await readFile(settingsPath, 'utf8')); previousSettings = saved;
      await writeFile(settingsPath, JSON.stringify({ ...saved, clients: CLIENTS }, null, 2) + '\n');
      setupRoute = 'settings-file';
    }
    steps.open = await openSaved(first, importPath);
    assert.deepEqual(steps.open.filter(operation => !READS.includes(operation)), [], 'Opening may only read.');
    assert.ok(steps.open.includes('trials-read'));
    assert.equal(await cards(first).count(), 0, 'No trial exists yet.');

    // 2. Plan a trial from the leading suggestion: the quality bar first, a time box that is already there, a second bound, the unknown cost kept.
    const leading = leadingCard(first), suggestionId = await leading.getAttribute('data-suggestion-id');
    assert.match(await textOf(leading), /Scope: project/);
    await leading.getByRole('button', { name: 'Plan a trial', exact: true }).click();
    const planning = trialsOf(first);
    await planning.getByRole('heading', { name: 'Plan a trial', exact: true }).waitFor();
    await planFields(first, { task: 'Add tests to a small module of the app.', outcome: 'The new tests catch a seeded regression.',
      checks: ['A seeded regression fails a test.', 'The tests pass on the unchanged module.'], conditions: 'Same task, same client, same repository state.' });
    const propose = planning.getByRole('button', { name: 'Propose trial', exact: true });
    // The plan opens with one advisory bound (a time box, no value yet), and a trial cannot be proposed without a finished bound.
    assert.deepEqual([await labelled(planning, 'Bound 1 label').inputValue(), await labelled(planning, 'Bound 1 value').inputValue(), await labelled(planning, 'Bound 1 unit').inputValue()], ['Time box', '', 'hours']);
    assert.equal(await propose.isDisabled(), true, 'The quality bar alone does not allow proposing: the bound has no value.');
    await labelled(planning, 'Bound 1 value').fill('2');
    assert.equal(await propose.isDisabled(), false);
    await planning.getByRole('button', { name: 'Add bound', exact: true }).click();
    await labelled(planning, 'Bound 2 label').fill('Spending'); await labelled(planning, 'Bound 2 value').fill('5'); await labelled(planning, 'Bound 2 unit').fill('USD');
    assert.ok((await textOf(planning)).includes(NO_CAP), 'The plan says no bound is a cap.');
    for (const index of [1, 2]) assert.deepEqual(await labelled(planning, `Bound ${index} enforcement`).locator('option').allInnerTexts(), ['Advisory (not enforced)'], 'Only advisory is offered without a mechanism.');
    assert.equal(await labelled(planning, 'Unknown cost 1').inputValue(), COST_UNKNOWN, 'The unknown cost is prefilled.');
    steps.propose = await act(first, () => planning.getByRole('button', { name: 'Propose trial', exact: true }).click());
    assert.deepEqual(written(steps.propose), ['trials-record', 'trials-read']);
    assert.equal(await cards(first).count(), 1);
    const trialA = await cards(first).first().getAttribute('data-trial-id');
    const proposedText = await textOf(card(first, trialA));
    for (const line of ['Proposed.', 'Scope: project', 'Quality bar: The new tests catch a seeded regression.', 'A seeded regression fails a test.', 'The tests pass on the unchanged module.',
      'Time box: 2 hours — advisory (not enforced)', 'Spending: 5 USD — advisory (not enforced)', COST_UNKNOWN]) assert.ok(proposedText.includes(line), `Proposed card shows: ${line}`);
    assert.doesNotMatch(proposedText, /\bcap\b.*enforced by/);
    screenshots.push(await shot(first, '01-proposed.png'));

    // 3. Start, record what was seen: the trial misses one quality check while its overhead is compared by Core where it can.
    steps.start = await press(first, trialA, 'Start');
    assert.match(await textOf(card(first, trialA)), /Started\./);
    await observe(first, trialA, { option: 'trial', target: 'check:check-1', result: 'passed' });
    await observe(first, trialA, { option: 'trial', target: 'check:check-2', result: 'failed' });
    await observe(first, trialA, { option: 'baseline', target: 'setup', kind: 'declared', amount: 10, unit: 'minutes' });
    await observe(first, trialA, { option: 'trial', target: 'setup', kind: 'declared', amount: 15, unit: 'minutes' });
    steps.measure = await press(first, trialA, 'Measure configured context');
    assert.deepEqual(written(steps.measure), ['trials-record', 'trials-read']);
    const measured = await textOf(card(first, trialA)), lines = measured.split('\n');
    for (const label of Object.values(DIMENSION_LABELS)) assert.ok(lines.some(line => line.startsWith(`${label}: `)), `An overhead row starts with its label: ${label}`);
    assert.ok(lines.includes('Indexing: not observed') && lines.includes('Maintenance: not observed'), 'A dimension with nothing recorded is not observed.');
    assert.match(measured, /trial: not met \(1 passed, 1 failed, 0 unknown\)/);
    assert.match(measured, /No demonstrated qualifying improvement: the trial did not meet the quality bar\./);
    const evaluated = (await lastTrials()).find(row => row.record.id === trialA).evaluation;
    assert.equal(evaluated.outcome, 'no-qualifying-improvement');
    const runtime = evaluated.overhead.find(row => row.dimension === 'runtime-context'), setupRow = evaluated.overhead.find(row => row.dimension === 'setup');
    assert.equal(runtime.status, 'available', JSON.stringify(runtime)); assert.equal(runtime.direction, 'increase'); assert.equal(runtime.unit, 'bytes');
    assert.ok(runtime.after > runtime.before, 'The trial adds configured material.');
    assert.ok(measured.includes(`Runtime/context (configured material size, not usage): ${runtime.before} → ${runtime.after} bytes, increase of ${runtime.absoluteDifference} bytes (${Math.round(Math.abs(runtime.percentage) * 10) / 10}% more than the baseline)`), `Core's byte comparison is shown: ${measured}`);
    assert.equal(setupRow.status, 'unavailable', JSON.stringify(setupRow));
    assert.ok(measured.includes(`Setup: 10 minutes → 15 minutes — not compared by Core (${setupRow.reason})`), `Core's reason is shown: ${setupRow.reason}`);
    const { claimSet, projection } = evaluated;
    if (claimSet) {
      assert.deepEqual(claimSet.calculations.map(entry => entry.method), ['context-change', 'context-change']);
      assert.deepEqual(projection.calculations.map(entry => entry.id).sort(), claimSet.calculations.map(entry => entry.id).sort(), 'The rows come from the Core projection of the trial claim set.');
    }
    facts.overhead = { runtimeContext: { before: runtime.before, after: runtime.after, unit: runtime.unit, direction: runtime.direction, absoluteDifference: runtime.absoluteDifference, percentage: runtime.percentage }, setup: { status: setupRow.status, reason: setupRow.reason } };
    screenshots.push(await shot(first, '02-no-qualifying.png'));

    // 4. A deliberately narrower outcome; a stop that asks for a partial restoration; the restoration then moves on its own.
    const qualification = 'Useful for small modules only.';
    await act(first, async () => { await labelled(card(first, trialA), 'Narrower outcome qualification').fill(qualification); await card(first, trialA).getByRole('button', { name: 'Accept narrower outcome', exact: true }).click(); });
    const narrower = await textOf(card(first, trialA));
    assert.ok(narrower.includes(`Accepted a narrower outcome: ${qualification}`));
    assert.match(narrower, /No demonstrated qualifying improvement/, 'Accepting a narrower outcome does not rewrite the evidence.');
    assert.deepEqual(await labelled(card(first, trialA), 'Request restoration').locator('option').allInnerTexts(), ['None', ...RESTORATION_STATUSES], 'The restoration request offers exactly the recorded statuses.');
    await act(first, async () => { await labelled(card(first, trialA), 'Decision reason').fill('The second check failed.'); await labelled(card(first, trialA), 'Request restoration').selectOption('partial'); await card(first, trialA).getByRole('button', { name: 'Stop', exact: true }).click(); });
    const stopped = await textOf(card(first, trialA));
    assert.ok(stopped.includes('Stopped. Evaluation ended. This does not mean anything was undone.'));
    assert.ok(stopped.includes('Restoration: partial (recorded by you)'));
    assert.ok(stopped.includes('Decision reason: The second check failed.'));
    assert.doesNotMatch(stopped, /Kept|adopted/);
    assert.deepEqual(await labelled(card(first, trialA), 'Restoration status').locator('option').allInnerTexts(), RESTORATION_STATUSES, 'The restoration status offers exactly the recorded statuses.');
    const effect = 'The notes file was left in place.';
    await act(first, async () => { await labelled(card(first, trialA), 'Restoration status').selectOption('partial'); await labelled(card(first, trialA), 'Restoration effects').fill(effect); await card(first, trialA).getByRole('button', { name: 'Record restoration', exact: true }).click(); });
    assert.ok((await textOf(card(first, trialA))).includes(effect));
    screenshots.push(await shot(first, '03-stopped-partial.png'));
    await act(first, async () => { await labelled(card(first, trialA), 'Restoration status').selectOption('completed'); await card(first, trialA).getByRole('button', { name: 'Record restoration', exact: true }).click(); });
    const restored = await textOf(card(first, trialA));
    assert.ok(restored.includes('Stopped. Evaluation ended. This does not mean anything was undone.'), 'Recording a restoration leaves the stop as it was.');
    assert.ok(restored.includes('Restoration: completed (recorded by you)'));
    assert.match(restored, /No demonstrated qualifying improvement/);
    const stoppedRecord = (await lastTrials()).find(row => row.record.id === trialA).record;
    assert.equal(stoppedRecord.state, 'stopped'); assert.equal(stoppedRecord.restoration.status, 'completed'); assert.equal(stoppedRecord.evidence.outcome, 'no-qualifying-improvement');
    assert.equal(stoppedRecord.narrower.qualification, qualification);

    // 5. A second trial of the same suggestion (suggest again: recording changed the open draft), revised once while proposed,
    // started and kept with nothing observed. The keep is inconclusive: it adds the one item and claims no improvement.
    await first.locator('#policy-improvements-suggest').click(); await suggestionsSettled(first);
    const again = leadingCard(first);
    assert.equal(await again.getAttribute('data-suggestion-id'), suggestionId, 'The same suggestion is offered again.');
    await again.getByRole('button', { name: 'Plan a trial', exact: true }).click();
    await trialsOf(first).getByRole('heading', { name: 'Plan a trial', exact: true }).waitFor();
    await planFields(first, { task: 'Add tests to a larger module.', outcome: 'The tests catch two seeded regressions.', checks: ['Both seeded regressions fail a test.'], conditions: 'Same client, larger module.' });
    await labelled(trialsOf(first), 'Bound 1 value').fill('3');
    await act(first, () => trialsOf(first).getByRole('button', { name: 'Propose trial', exact: true }).click());
    assert.equal(await cards(first).count(), 2);
    const trialB = await cards(first).first().getAttribute('data-trial-id');
    assert.notEqual(trialB, trialA);
    await card(first, trialB).getByRole('button', { name: 'Revise', exact: true }).click();
    await trialsOf(first).getByRole('heading', { name: 'Revise trial', exact: true }).waitFor();
    assert.equal(await labelled(trialsOf(first), 'Acceptable outcome').inputValue(), 'The tests catch two seeded regressions.');
    await labelled(trialsOf(first), 'Comparison conditions').fill('Same client, larger module, fresh checkout.');
    await labelled(trialsOf(first), 'Revision reason').fill('The first plan left the checkout unspecified.');
    steps.revise = await act(first, () => trialsOf(first).getByRole('button', { name: 'Propose revision', exact: true }).click());
    assert.equal(await cards(first).count(), 3);
    const revisedText = await textOf(card(first, trialB));
    assert.ok(revisedText.includes('Revised.'), revisedText);
    const trialC = await cards(first).first().getAttribute('data-trial-id');
    assert.ok(![trialA, trialB].includes(trialC));
    assert.ok((await textOf(card(first, trialC))).includes('Proposed.'));
    assert.ok((await textOf(card(first, trialC))).includes('Comparison conditions: Same client, larger module, fresh checkout.'));
    await press(first, trialC, 'Start');
    steps.keep = await press(first, trialC, 'Keep');
    assert.deepEqual(written(steps.keep), ['trials-record', 'trials-read']);
    const keptText = await textOf(card(first, trialC));
    assert.ok(keptText.includes('Kept. The evidence is inconclusive: this does not show an improvement.'), keptText);
    assert.doesNotMatch(keptText, /Kept\. The trial met the quality bar|Kept without/);
    assert.match(keptText, /Inconclusive: the trial's quality is not known yet\./);
    screenshots.push(await shot(first, '04-kept-inconclusive.png'));
    const shown = Object.fromEntries(await Promise.all([trialA, trialB, trialC].map(async id => [id, await textOf(card(first, id))])));

    // The saved draft gained exactly the one chosen root; everything else in the intent is as it was imported.
    const savedPath = join(output, 'trials.draft.json');
    const savedBytes = await download(first, async () => { await openPolicyDrawer(first); await first.locator('#policy-draft-save').click(); }, savedPath);
    const after = draftOf(savedBytes);
    const added = after.roots.filter(root => !before.roots.some(old => old.itemId === root.itemId && old.releaseSha256 === root.releaseSha256 && old.scope === root.scope));
    assert.equal(added.length, 1, 'Exactly one root was added.');
    assert.deepEqual([added[0].itemId, added[0].scope, added[0].releaseSha256], [SUGGESTED, 'project', maintained.release.sha256]);
    assert.equal(after.roots.length, before.roots.length + 1);
    assert.deepEqual(after.roots.filter(root => root !== added[0]), before.roots, 'Every other root is deep-equal to the imported one.');
    assert.deepEqual(after.origins, before.origins, 'Origins are unchanged.');
    assert.deepEqual(after.exclusions, before.exclusions, 'Exclusions are unchanged.');
    assert.ok(before.roots.some(root => root.itemId === UNRELATED) && after.roots.some(root => root.itemId === UNRELATED), 'The unrelated choice is still there.');
    const savedTrials = records(savedBytes, TRIAL_SCHEMA);
    assert.deepEqual(savedTrials.map(trial => trial.state).sort(), ['kept', 'revised', 'stopped']);
    assert.equal(savedTrials.find(trial => trial.id === trialC).evidence.outcome, 'inconclusive');
    assert.equal(savedTrials.find(trial => trial.id === trialC).adopted.root.itemId, SUGGESTED);
    assert.equal(records(savedBytes, IMPROVEMENT_SUGGESTION_SCHEMA).length, 1); assert.equal(records(savedBytes, IMPROVEMENT_DISMISSAL_SCHEMA).length, 0);
    facts.draft = { rootsBefore: before.roots.length, rootsAfter: after.roots.length, added: added[0].itemId, scope: added[0].scope, unrelatedRoot: UNRELATED, originsEqual: true, exclusionsEqual: true };

    // 6. A fresh page reopens the saved draft: every trial is shown again, identically, by reads alone.
    const reopened = await openPage();
    steps.reopen = await openSaved(reopened, savedPath);
    assert.deepEqual(steps.reopen.filter(operation => !READS.includes(operation)), [], 'Reopening only reads.');
    assert.equal(await cards(reopened).count(), 3);
    for (const id of [trialA, trialB, trialC]) assert.equal(await textOf(card(reopened, id)), shown[id], `Trial ${id} reads the same after reopening.`);
    assert.deepEqual(await cards(reopened).evaluateAll(nodes => nodes.map(node => node.dataset.trialId)), [trialC, trialB, trialA], 'Newest first.');
    screenshots.push(await shot(reopened, '05-reopened.png'));

    // 7. Only the expected operations ran; nothing failed, left the origin or opened a window.
    assert.deepEqual(errors, []); assert.deepEqual(failedResponses, []);
    // The page's own web-font stylesheet links are the only off-origin requests it makes; the routing aborts them, so nothing leaves.
    assert.deepEqual(offOrigin.filter(url => new URL(url).hostname !== 'fonts.googleapis.com'), [], 'Nothing but the font stylesheets left the origin.');
    // Besides those, the page itself starts a new policy when it loads and, on saving, first records the note of its last update check.
    const allowed = [...READS, 'trials-record', 'new', 'maintenance-record'];
    assert.deepEqual([...seenOperations.keys()].filter(operation => !allowed.includes(operation)), [], 'Only trial reads, trial records and the reads the improvements journey allows ran.');
    assert.equal(seenOperations.get('maintenance-record') ?? 0, 1, 'The only maintenance write is the check note recorded by the one save.');
    assert.ok(seenOperations.has('trials-read') && seenOperations.has('trials-record'));
    assert.equal(recordDone, recorded, 'Every recording the journey drove was a trials-record request.');
    const duration = Math.round((Date.now() - started) / 100) / 10;
    await writeFile(join(output, 'summary.json'), JSON.stringify({ status: 'passed', entry: '/', chromium: browser.version(), clients: CLIENTS, clientSetup: setupRoute, savedGoal: SAVED_REASON, screenshots,
      trials: { stoppedPartialThenCompleted: trialA, revised: trialB, keptInconclusive: trialC }, recordedOperations: recorded, operations: Object.fromEntries([...seenOperations].sort()), openOperations: steps.open, reopenOperations: steps.reopen,
      facts, blockedFontRequests: offOrigin.length, errors, failedResponses, durationSeconds: duration }, null, 2));
    console.log(`Trials journey passed in ${duration}s: ${output}`);
  } catch (error) {
    await observed?.screenshot({ path: join(output, 'trials-failure.png'), fullPage: true }).catch(() => {});
    await writeFile(join(output, 'trials-failure.json'), JSON.stringify({ error: error.message, errors, failedResponses, offOrigin, steps,
      text: await observed?.locator('body').innerText().catch(() => '') }, null, 2));
    throw error;
  } finally {
    if (previousSettings) await writeFile(settingsPath, JSON.stringify(previousSettings, null, 2) + '\n');
    await browser.close();
  }
}
