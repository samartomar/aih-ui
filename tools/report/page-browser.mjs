// The report page's saved-snapshot section in Chromium against a running Workbench: the host validates with the
// installed @aihq/core/report and the page shows exactly the bytes the shared renderer draws, in a sandboxed frame.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadReportRenderer } from './core-report.mjs';
import { WORKFLOW_SNAPSHOT_TEXT } from './fixtures.mjs';

export async function runReportPageBrowser({ origin, consumerDir, output, playwrightModule }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const renderer = await loadReportRenderer(consumerDir);
  const snapshot = renderer.data.importSnapshot(WORKFLOW_SNAPSHOT_TEXT);
  const snapshotPath = join(output, 'snapshot.json'); await writeFile(snapshotPath, WORKFLOW_SNAPSHOT_TEXT);
  const unsupportedPath = join(output, 'unsupported.json');
  await writeFile(unsupportedPath, JSON.stringify({ ...JSON.parse(WORKFLOW_SNAPSHOT_TEXT), schema: 'urn:aihq:report:snapshot:9.0.0' }));

  // The route takes same-origin JSON posts only.
  const post = (headers, body = WORKFLOW_SNAPSHOT_TEXT, query = '') => fetch(`${origin}/api/report-render${query}`, { method: 'POST', headers, body });
  assert.equal((await post({ origin: 'https://untrusted.example', 'content-type': 'application/json' })).status, 403, 'a foreign origin is refused');
  assert.equal((await post({ 'content-type': 'application/json' })).status, 403, 'a post without an origin is refused');
  assert.equal((await post({ origin, 'content-type': 'text/plain' })).status, 415, 'only JSON is accepted');
  assert.equal((await post({ origin, 'content-type': 'application/json' }, WORKFLOW_SNAPSHOT_TEXT, '?mode=live')).status, 400, 'an unknown mode is refused');
  assert.equal((await fetch(`${origin}/api/report-render`)).status, 405, 'GET is refused');
  assert.equal((await post({ origin, 'content-type': 'application/json' }, ' '.repeat(2_097_153))).status, 413, 'a body past the cap is refused');
  // Far past the cap the host stops reading and closes: the client sees the 413 or a closed connection, and the host keeps serving.
  const far = await post({ origin, 'content-type': 'application/json' }, ' '.repeat(4 * 1024 * 1024)).then(response => response.status, () => 'closed');
  assert.ok(far === 413 || far === 'closed', `a body far past the cap is refused (${far})`);
  const invalid = await post({ origin, 'content-type': 'application/json' }, '{"schema":');
  assert.equal(invalid.status, 422); assert.equal((await invalid.json()).diagnostics[0].code, 'INPUT_INVALID');

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/report.html`);
    assert.equal(await page.locator('#snapshot-render').isDisabled(), true, 'Render waits for a file');
    await page.setInputFiles('#snapshot-file', snapshotPath);
    for (const mode of ['report', 'demo']) {
      await page.selectOption('#snapshot-mode', mode);
      await page.click('#snapshot-render');
      await page.waitForFunction(() => !document.getElementById('snapshot-frame').hidden);
      const shown = await page.locator('#snapshot-frame').evaluate(frame => ({ srcdoc: frame.srcdoc, sandbox: frame.getAttribute('sandbox') }));
      assert.equal(shown.srcdoc, renderer.renderReport(snapshot, { mode }), `${mode}: the page shows the shared renderer's bytes`);
      assert.equal(shown.sandbox, 'allow-scripts', `${mode}: the document runs in an opaque-origin sandbox`);
      const frame = page.frameLocator('#snapshot-frame');
      await frame.locator('#sec-skillgov').waitFor({ state: 'attached' });
      assert.equal(await frame.locator('main section').count(), 14, `${mode}: the 14 V9 sections`);
      assert.equal(await page.locator('#snapshot-save').isHidden(), false, `${mode}: the same bytes can be saved`);
      assert.equal(await page.locator('#snapshot-save').evaluate(async link => (await (await fetch(link.href)).blob()).type), 'application/octet-stream', `${mode}: the save is download-only`);
      if (mode === 'report') {
        assert.equal(await frame.locator('main section[data-state="live"]').count(), 5);
        assert.equal(await page.locator('#snapshot-demo-note').isHidden(), true);
        assert.match(await page.locator('#snapshot-status').innerText(), /Saved snapshot display/);
      } else {
        assert.equal(await page.locator('#snapshot-demo-note').isHidden(), false, 'the page labels the design sample');
        assert.equal(await frame.locator('.demo-banner').count(), 1, 'the document labels the design sample');
        assert.match(await page.locator('#snapshot-status').innerText(), /design sample/);
      }
      await page.locator('#snapshot-report').screenshot({ path: join(output, `report-page-${mode}.png`) });
    }
    await page.setInputFiles('#snapshot-file', unsupportedPath);
    await page.selectOption('#snapshot-mode', 'report');
    await page.click('#snapshot-render');
    await page.waitForFunction(() => /not rendered/.test(document.getElementById('snapshot-status').textContent));
    assert.match(await page.locator('#snapshot-status').innerText(), /SCHEMA_UNSUPPORTED/);
    assert.equal(await page.locator('#snapshot-frame').isHidden(), true, 'an invalid snapshot shows no page');
    assert.equal(await page.locator('#snapshot-save').isHidden(), true, 'an invalid snapshot offers nothing to save');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
  console.log('Report page renders a saved snapshot and the design sample through the shared V9 renderer, and refuses an unsupported snapshot.');
}
