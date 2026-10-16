// Reviewed-batch demonstration in installed Chromium against the real Workbench. Two disposable client homes: A (existing, with the
// person's own files) and B (added). Everything the person does goes through the page. Filesystem and host-configuration changes
// below are test setup (removing the unowned file, creating the process marker, clearing the stale-target fault), never page
// capabilities: the page and its HTTP routes can name only the current batch and the continuation choice. The process counts its own
// executions, counted by the fixture's `procCount`, so the journey can show that a reload never runs it again.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';

const NOTE = 'Listed by Core; not checked as installed or connected';
const ATOMIC = 'there is no all-or-nothing promise';
const RERUN = 'Core cannot confirm whether this earlier process ran; run it again only if you know it is safe.';
const exists = path => lstat(path).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
export async function runBatchBrowser({ origin, output, playwrightModule, fixturePath, conflictFile, procMarker, procCount, userFiles }) {
  const started = Date.now();
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const config = JSON.parse(await readFile(fixturePath, 'utf8'));
  const [homeA, homeB] = [config.homes.a, config.homes.b];
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage(); page.setDefaultTimeout(30_000);
  const errors = [], screenshots = [], timings = {};
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const shot = async name => { await page.screenshot({ path: join(output, name), fullPage: true }); screenshots.push(name); };
  const text = id => page.locator(`#batch-${id}`).innerText();
  const disabled = id => page.locator(`#batch-${id}`).isDisabled();
  // One page action and the host answer it produced, with the page settled afterwards.
  const act = async (id, route) => {
    const answered = page.waitForResponse(response => new URL(response.url()).pathname === `/api/${route}` && response.request().method() === 'POST');
    const began = Date.now();
    await page.locator(`#batch-${id}`).click();
    const response = await answered, answer = await response.json();
    assert.equal(response.status(), 200, JSON.stringify(answer));
    await page.locator('#batch-status').filter({ hasNotText: 'Working…' }).waitFor();
    timings[`${route}-${Object.keys(timings).length}`] = Date.now() - began;
    return answer;
  };
  const opened = async () => { await page.locator('#batch-review:enabled').waitFor(); return (await text('id')).trim(); };
  // The table rows as observed: label, scope, outcome, reason.
  const rows = () => page.locator('#batch-outcomes tr').evaluateAll(trs => trs.map(tr => {
    const cells = [...tr.children].map(cell => cell.innerText.trim());
    return { label: cells[0], scope: cells[1], outcome: tr.dataset.outcome, shown: cells[2], reason: cells[3] };
  }));
  const byLabel = (all, label) => all.filter(row => row.label === label);
  const processRuns = procCount;
  const userBytes = async () => Object.fromEntries(await Promise.all(Object.keys(userFiles).map(async path => [path, await readFile(path, 'utf8')])));
  let evidence;
  try {
    assert.equal(await exists(conflictFile), true, 'The conflict variant starts with B\'s target already owned by the person.');
    const client = await (await fetch(`${origin}/api/batch`)).json();
    assert.equal(client.status, 'ok', JSON.stringify(client));
    const label = id => client.clients.labels[id] ?? id;

    // (a) The reviewed batch: scopes with Core's labels, actions, edges, checks, the continuation choice.
    await page.goto(`${origin}/batch.html`);
    const firstId = await opened();
    assert.match(firstId, /^batch-[a-f0-9]{32}$/);
    const scopes = await text('scopes');
    for (const scope of client.projection.scopes) assert.ok(scopes.includes(label(scope.client)) && scopes.includes(scope.id), `scope ${scope.id} shows its Core client label`);
    assert.equal(scopes.split(NOTE).length - 1, client.projection.scopes.length, 'every scope says listing is not installed/connected');
    const actions = await text('actions');
    for (const action of client.projection.actions) assert.ok(actions.includes(action.id));
    assert.ok(actions.includes('b-core → b-dependent'), 'the dependency edge is shown');
    const checks = await text('checks');
    for (const kind of ['shared-input', 'unrelated-state', 'conflict', 'core-review']) assert.ok(checks.includes(kind), `disclosed check ${kind}`);
    assert.equal(await page.locator('#batch-continuation').inputValue(), 'stop');
    assert.ok((await page.locator('#batch-content').innerText()).includes(ATOMIC));
    assert.equal(await disabled('apply'), true, 'Apply is not available before a review.');
    await shot('batch-1-reviewed-batch.png');

    // (b) Review shows the conflict before anything is applied.
    const conflicted = await act('review', 'batch-review');
    assert.equal(conflicted.review.ready, false);
    const conflicts = await text('conflicts');
    assert.ok(conflicts.includes('b-core') && conflicts.includes('STATE_CONFLICT'), conflicts);
    assert.match(await text('review-summary'), /1 conflict\(s\)\. Apply is blocked\./);
    assert.equal(await disabled('apply'), true);
    assert.equal(await exists(join(homeB, '.codex', 'b-dependent.md')), false, 'Review writes nothing.');
    await shot('batch-2-conflict-before-apply.png');

    // (c) The person resolves the conflict (test setup removes the unowned file) and chooses to continue independent work.
    await rm(conflictFile);
    const chosen = page.waitForResponse(response => new URL(response.url()).pathname === '/api/batch-continuation');
    await page.locator('#batch-continuation').selectOption('continue-independent');
    assert.equal((await chosen).status(), 200);
    await page.locator('#batch-status').filter({ hasText: 'Continuation choice saved' }).waitFor();
    const chosenId = (await text('id')).trim();
    assert.notEqual(chosenId, firstId, 'The saved choice is part of the content-derived batch id.');
    assert.equal(await page.locator('#batch-review-section').isHidden(), true, 'A changed batch needs a fresh review.');
    assert.equal(await disabled('apply'), true);
    assert.equal((await act('review', 'batch-review')).review.ready, true);
    assert.match(await text('review-summary'), /No conflicts reported/);
    await page.locator('#batch-apply:enabled').waitFor();
    await shot('batch-3-review-ready.png');

    // Shared material drifts after the review. The host answers the run itself: a 409 that keeps its codes and the conflict list,
    // the page shows them and applies nothing, and a fresh review of the restored material is ready again.
    const sharedFile = join(config.materialRoot, 'shared.txt'), sharedBytes = await readFile(sharedFile);
    await writeFile(sharedFile, 'drifted after the review');
    const refusing = page.waitForResponse(response => new URL(response.url()).pathname === '/api/batch-run');
    await page.locator('#batch-apply').click();
    const refusal = await refusing, refused = await refusal.json();
    assert.equal(refusal.status(), 409, JSON.stringify(refused));
    assert.equal(refused.diagnostics[0].code, 'BATCH_CONFLICTS');
    assert.ok(refused.review.conflicts.some(conflict => conflict.kind === 'shared-input' && conflict.input === 'shared' && conflict.reason === 'changed'), JSON.stringify(refused.review.conflicts));
    await page.locator('#batch-status').filter({ hasText: 'Nothing was applied' }).waitFor();
    assert.match(await text('conflicts'), /Shared input shared is changed/);
    assert.equal(await disabled('apply'), true, 'The refused review leaves Apply blocked.');
    assert.equal(await exists(join(homeA, '.claude', 'a-extra.md')), false, 'A refused run applies nothing.');
    await shot('batch-3b-run-refused.png');
    await writeFile(sharedFile, sharedBytes);
    assert.equal((await act('review', 'batch-review')).review.ready, true);
    await page.locator('#batch-apply:enabled').waitFor();
    const before = await userBytes();
    const partial = await act('apply', 'batch-run'), report = partial.report;
    const failed = await rows();
    assert.equal(report.atomic, false);
    assert.equal(await page.locator('#batch-review-section').isHidden(), true, 'A finished run does not leave its review looking current.');
    assert.equal(failed.length, report.actions.length + report.scopes.length);
    const one = label => { const found = byLabel(failed, label); assert.equal(found.length, 1, label); return found[0]; };
    assert.deepEqual([one('b-core').outcome, one('b-core').reason], ['failed', 'REVIEW_STALE'], JSON.stringify(failed));
    assert.deepEqual([one('b-dependent').outcome, one('b-dependent').reason], ['cancelled', 'dependency-failed']);
    assert.equal(one('a-extra').outcome, 'completed');
    assert.equal(one('b-proc').outcome, 'unknown');
    assert.match(one('b-proc').reason, /exit-code/);
    const unrelated = byLabel(failed, 'Unrelated state');
    assert.deepEqual(unrelated.map(row => [row.scope, row.outcome]), [['scope-a', 'untouched'], ['scope-b', 'untouched']]);
    assert.deepEqual([...new Set(failed.map(row => row.outcome))].sort(), ['cancelled', 'completed', 'failed', 'unknown', 'untouched']);
    assert.match(await text('counts'), /1 completed, 1 failed, 0 untouched, 1 cancelled, 1 unknown/);
    assert.ok((await text('atomic-note')).includes(ATOMIC));
    assert.deepEqual(await userBytes(), before, 'The person\'s own files are byte-identical.');
    assert.equal(await exists(join(homeA, '.claude', 'a-extra.md')), true, 'The independent action completed.');
    assert.equal(await exists(join(homeB, '.codex', 'b-core.md')), false, 'The failed action left nothing behind.');
    assert.equal(await exists(join(homeB, '.codex', 'b-dependent.md')), false, 'The cancelled action wrote nothing.');
    // Running the opaque process spent the person's choice to run it: the saved batch now keeps it, and the page shows that batch.
    assert.equal(await processRuns(), 1, 'The process ran once.');
    const spentId = partial.current.batchId;
    assert.equal(report.consumedBy, spentId); assert.notEqual(spentId, chosenId);
    assert.equal(partial.current.projection.supersedes, chosenId);
    assert.equal((await text('id')).trim(), spentId);
    assert.deepEqual(partial.current.projection.actions.filter(action => action.retain).map(action => action.id), ['b-proc']);
    assert.equal(await page.locator('#batch-rerun-b-proc').isChecked(), false, 'The spent choice is not shown as chosen.');
    await shot('batch-4-partial-failure.png');

    // (d) The person fixes the cause (test setup: the process marker, and the fault is cleared). Recover reinspects, keeps A's
    // finished work and prepares a superseding batch, reviewed fresh. b-proc is an opaque process Core cannot show as done, so
    // recovery keeps it and the person chooses Run again for it (it ended unknown); running then completes only the remaining work.
    await writeFile(procMarker, 'ok\n');
    await writeFile(fixturePath, JSON.stringify({ ...config, faults: {} }));
    const kept = await act('recover', 'batch-recover');
    assert.notEqual(kept.batchId, spentId);
    assert.equal(kept.projection.supersedes, spentId);
    assert.deepEqual(kept.projection.actions.filter(action => action.retain).map(action => action.id), ['a-extra', 'b-proc']);
    assert.deepEqual(kept.projection.actions.filter(action => action.unverifiable).map(action => action.id), ['b-proc'], 'only the process is unverifiable');
    assert.equal(kept.review.ready, true);
    assert.equal(await page.locator('#batch-actions input[data-action]').count(), 1, 'Run again is offered for the unverifiable action only.');
    assert.equal(await page.locator('#batch-rerun-b-proc').isChecked(), false);
    assert.equal((await text('actions')).split(RERUN).length - 1, 1, 'the warning is shown once, beside the choice');
    await shot('batch-5a-recovered-process-kept.png');
    const choosing = page.waitForResponse(response => new URL(response.url()).pathname === '/api/batch-recover');
    await page.locator('#batch-rerun-b-proc').click();
    const choice = await choosing, recovered = await choice.json();
    assert.equal(choice.status(), 200, JSON.stringify(recovered));
    await page.locator('#batch-status').filter({ hasText: 'Recovered from' }).waitFor();
    assert.equal(recovered.projection.supersedes, kept.batchId);
    assert.deepEqual(recovered.projection.actions.filter(action => action.retain).map(action => action.id), ['a-extra'], 'the chosen process is scheduled again; the finished file work stays kept');
    assert.match(await text('supersedes'), new RegExp(`Supersedes ${kept.batchId}`));
    assert.equal(await page.locator('#batch-rerun-b-proc').isChecked(), true);
    assert.equal(recovered.review.ready, true);
    assert.equal((await text('id')).trim(), recovered.batchId);
    await page.locator('#batch-apply:enabled').waitFor();
    await shot('batch-5-recovered-fresh-review.png');
    const second = await act('apply', 'batch-run'), fresh = second.report;
    const done = await rows();
    assert.equal(fresh.batchId, recovered.batchId);
    for (const id of ['b-core', 'b-dependent', 'b-proc']) assert.equal(byLabel(done, id)[0].outcome, 'completed', id);
    assert.deepEqual([byLabel(done, 'a-extra')[0].outcome, byLabel(done, 'a-extra')[0].reason], ['untouched', 'retained-earlier-result']);
    assert.equal(byLabel(done, 'Unrelated state').every(row => row.outcome === 'untouched'), true);
    assert.deepEqual(await userBytes(), before);
    assert.equal(await exists(join(homeB, '.codex', 'b-core.md')), true);
    assert.equal(await exists(join(homeB, '.codex', 'b-dependent.md')), true);
    assert.equal(await processRuns(), 2, 'The chosen process ran once more.');
    const respentId = second.current.batchId;
    assert.equal(fresh.consumedBy, respentId); assert.equal(second.current.projection.supersedes, recovered.batchId);
    assert.equal(await page.locator('#batch-rerun-b-proc').isChecked(), false, 'The choice was spent by the run.');
    await shot('batch-6-recovered-complete.png');

    // (e) Reload: the batch the run left reopens from the envelope file alone. Nothing from the run, session or review survives,
    // and the spent Run again choice does not either: the process is kept, unticked, and applying the batch does not run it again.
    await page.reload();
    assert.equal(await opened(), respentId);
    assert.match(await text('supersedes'), new RegExp(`Supersedes ${recovered.batchId}`));
    assert.equal(await page.locator('#batch-rerun-b-proc').isChecked(), false, 'A spent Run again choice is not restored on reload.');
    assert.match(await text('actions'), /Kept without running: Core cannot confirm this earlier work/);
    assert.equal(await page.locator('#batch-continuation').inputValue(), 'continue-independent');
    assert.equal(await page.locator('#batch-review-section').isHidden(), true);
    assert.equal(await page.locator('#batch-outcome-section').isHidden(), true);
    assert.equal(await disabled('apply'), true, 'Reload never restores a prepared handle; a fresh review is needed.');
    const saved = await readFile(config.envelopePath, 'utf8');
    assert.doesNotMatch(saved, /sessionId|reviewDigest|runId|"outcome"/, 'The envelope holds no session, review digest or outcome.');
    assert.equal((await act('review', 'batch-review')).review.ready, true);
    await page.locator('#batch-apply:enabled').waitFor();
    await shot('batch-7-reopened.png');
    const reapplied = await act('apply', 'batch-run'), reran = await rows();
    assert.equal(reapplied.report.consumedBy, undefined, 'Nothing was spent by the reapplied batch.');
    assert.deepEqual([byLabel(reran, 'b-proc')[0].outcome, byLabel(reran, 'b-proc')[0].reason], ['untouched', 'retained-unverifiable']);
    assert.equal(await processRuns(), 2, 'Reload and Apply did not run the process again.');
    // Recover again after the process ran: the earlier Run again is not carried into a new attempt; the process is kept.
    const again = await act('recover', 'batch-recover');
    assert.deepEqual(again.projection.actions.filter(action => action.retain).map(action => action.id).sort(), ['a-extra', 'b-core', 'b-dependent', 'b-proc']);
    assert.equal(await page.locator('#batch-rerun-b-proc').isChecked(), false, 'Run again needs a fresh choice.');

    // The browser logs the one deliberately refused run (409) as a console error; nothing else may be logged.
    const refusedLogs = errors.filter(message => /status of 409/.test(message));
    assert.equal(refusedLogs.length, 1, JSON.stringify(errors));
    assert.deepEqual(errors.filter(message => !refusedLogs.includes(message)), []);
    evidence = { status: 'passed', screenshots, batches: { initial: firstId, chosen: chosenId, spent: spentId, kept: kept.batchId, recovered: recovered.batchId, respent: respentId }, processRuns: await processRuns(), partial: failed, recovered: done, reapplied: reran, timingsMs: timings };
    await writeFile(join(output, 'batch-evidence.json'), JSON.stringify(evidence, null, 2));
  } catch (error) {
    await page.screenshot({ path: join(output, 'batch-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
  console.log(`Reviewed batch journey passed in ${((Date.now() - started) / 1000).toFixed(1)} s: ${output}`);
  return evidence;
}
