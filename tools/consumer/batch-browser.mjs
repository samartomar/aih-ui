// Disposable fixture journey. Filesystem changes below are test setup, never page capabilities.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm, lstat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';

const within = (root, path) => { const part = relative(root, path); return part !== '' && part !== '..' && !part.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(part); };
export async function runBatchBrowser({ origin, output, playwrightModule, fixturePath }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const config = JSON.parse(await readFile(fixturePath, 'utf8'));
  const roots = Object.values(config.homes);
  const request = async (path, body) => {
    const response = await fetch(origin + '/api/' + path, body ? { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
    const answer = await response.json();
    assert.equal(response.status, 200, JSON.stringify(answer)); assert.equal(answer.status, 'ok', JSON.stringify(answer));
    return answer;
  };
  const initial = await request('batch');
  // A setup-only inspection identifies a real file target, then unowned content
  // supplies the conflict variant. No path or fault enters an HTTP request.
  const inspected = await request('batch-review', { batchId: initial.batchId });
  assert.equal(inspected.review.ready, true, JSON.stringify(inspected.review));
  const candidates = inspected.review.scopes.flatMap(scope => scope.operations ?? []).filter(operation =>
    typeof operation.target === 'string' && roots.some(root => within(root, operation.target)) && operation.effects !== 'already-satisfied');
  let conflictTarget;
  for (const operation of candidates) {
    if (await lstat(operation.target).then(() => false, error => { if (error.code === 'ENOENT') return true; throw error; })) { conflictTarget = operation.target; break; }
  }
  assert.ok(conflictTarget, 'Fixture must offer an absent file target for the conflict variant.');
  await mkdir(dirname(conflictTarget), { recursive: true });
  await writeFile(conflictTarget, 'Unowned fixture content: review must block this target.\n', { flag: 'wx' });
  assert.ok(candidates[0]?.action, 'Fixture review must associate each target with an action.');
  if (!Object.keys(config.faults ?? {}).length) {
    config.faults = { [candidates[0].action]: 'stale-target' };
    await writeFile(fixturePath, JSON.stringify(config));
  }
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  const errors = [], screenshots = [];
  page.on('pageerror', error => errors.push(error.message));
  const act = async (id, route) => {
    const answered = page.waitForResponse(response => new URL(response.url()).pathname === `/api/${route}` && response.request().method() === 'POST');
    await page.locator(`#batch-${id}`).click();
    const response = await answered, answer = await response.json();
    assert.equal(response.status(), 200, JSON.stringify(answer));
    await page.locator('#batch-status').filter({ hasNotText: 'Working…' }).waitFor();
    return answer;
  };
  const shot = async name => { await page.screenshot({ path: join(output, name), fullPage: true }); screenshots.push(name); };
  let report, recovered;
  try {
    await page.goto(origin + '/batch.html');
    await page.locator('#batch-review:enabled').waitFor();
    assert.ok((await page.locator('#batch-scopes').innerText()).includes('Listed by Core; not checked as installed or connected'));
    assert.equal(await page.locator('#batch-apply').isDisabled(), true);
    await act('review', 'batch-review');
    assert.ok((await page.locator('#batch-conflicts').innerText()).length > 0);
    assert.equal(await page.locator('#batch-apply').isDisabled(), true);
    await shot('batch-conflict.png');
    await rm(conflictTarget);
    // The fixture permits independent work. Exercise the person's saved choice,
    // including review invalidation and reopen from durable envelope bytes.
    const selected = page.waitForResponse(response => response.url().endsWith('/api/batch-continuation'));
    await page.locator('#batch-continuation').selectOption('continue-independent');
    assert.equal((await selected).status(), 200);
    await page.locator('#batch-review:enabled').waitFor();
    assert.equal(await page.locator('#batch-apply').isDisabled(), true);
    const chosenId = (await page.locator('#batch-id').innerText()).trim();
    await page.reload(); await page.locator('#batch-review:enabled').waitFor();
    assert.equal((await page.locator('#batch-id').innerText()).trim(), chosenId);
    assert.equal(await page.locator('#batch-continuation').inputValue(), 'continue-independent');
    await act('review', 'batch-review');
    await page.locator('#batch-apply:enabled').waitFor();
    await shot('batch-review.png');
    report = (await act('apply', 'batch-run')).report;
    assert.deepEqual([...new Set(report.actions.map(action => action.outcome))].sort(), ['cancelled', 'completed', 'failed', 'unknown', 'untouched']);
    assert.equal(report.atomic, false);
    assert.ok(report.scopes.every(scope => scope.unrelated.outcome === 'untouched'), 'Unrelated state stays byte-identical in both fixture scopes.');
    assert.equal(await page.locator('#batch-outcomes tr').count(), report.actions.length + report.scopes.length);
    await shot('batch-partial-failure.png');
    // Remove only the directory created by the configured stale-target fault.
    // Successful outputs and unrelated state remain in place for reinspection.
    const configured = JSON.parse(await readFile(fixturePath, 'utf8'));
    for (const action of Object.keys(configured.faults ?? {})) {
      for (const operation of candidates.filter(operation => operation.action === action)) {
        assert.ok(roots.some(root => within(root, operation.target)));
        if (await lstat(operation.target).then(stat => stat.isDirectory(), () => false)) await rm(operation.target, { recursive: true });
      }
    }
    await writeFile(fixturePath, JSON.stringify({ ...configured, faults: {} }));
    recovered = await act('recover', 'batch-recover');
    assert.notEqual(recovered.batchId, report.batchId);
    assert.equal(recovered.projection.supersedes, report.batchId);
    await page.reload(); await page.locator('#batch-review:enabled').waitFor();
    assert.equal((await page.locator('#batch-id').innerText()).trim(), recovered.batchId);
    assert.equal(await page.locator('#batch-apply').isDisabled(), true, 'Reload never restores a prepared handle.');
    await act('review', 'batch-review');
    await page.locator('#batch-apply:enabled').waitFor();
    const fresh = (await act('apply', 'batch-run')).report;
    assert.equal(fresh.batchId, recovered.batchId);
    assert.ok(fresh.actions.some(action => action.outcome === 'untouched' && action.reason === 'retained-earlier-result'));
    await shot('batch-recovered.png');
    assert.deepEqual(errors, []);
    await writeFile(join(output, 'batch-evidence.json'), JSON.stringify({ status: 'passed', screenshots, report, recovered: recovered.batchId, fresh, errors }, null, 2));
  } catch (error) {
    await page.screenshot({ path: join(output, 'batch-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
}
