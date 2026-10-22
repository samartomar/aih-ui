// Browser proof uses the ordinary application, public intake and exact installed facts.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { sourceExamples, sourceExample } from './source-facts-fixture.mjs';
import { intakePersonalFolder } from './personal-folder.mjs';
import { installedFamilies } from './installed-families.mjs';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export async function runSourceFactsBrowser({ origin, output, playwrightModule }) {
  const began = performance.now();
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); page.setDefaultTimeout(30_000);
  const errors = [], observed = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(origin + '/');
    await page.locator('#browse-family option[value="ECC"]').waitFor({ state: 'attached' });
    if (await page.locator('#setup-dialog').isVisible()) {
      await page.getByRole('radio', { name: /Vibe coder/ }).check();
      // First-run Vibe setup: experience, AI clients, review.
      for (let step = 0; step < 3; step++) await page.locator('#setup-next').click();
      await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
    }
    await page.locator('#browse-support').selectOption('all');
    await page.locator('#browse-family').selectOption('ECC');
    const first = page.locator('#cards-grid [data-card-id]').first();
    await first.click();
    const key = await first.getAttribute('data-card-id');
    const maintained = (await installedFamilies()).flatMap(entry => entry.release.items.map(item => ({ key: `${entry.release.sha256}/${item.id}`, item }))).find(value => value.key === key)?.item;
    assert.ok(maintained?.metadata.sourceFacts);
    assert.equal(await page.locator('#details-desc').textContent(), maintained.metadata.sourceFacts.description.value);
    observed.push({ id: 'maintained', facts: maintained.metadata.sourceFacts, key });
    assert.match(await page.locator('#details-source').textContent(), /Source profile/);
    await page.screenshot({ path: join(output, 'maintained-source.png'), fullPage: true });
    for (const example of sourceExamples) {
      const { snapshot, result } = await sourceExample(example);
      assert.equal(result.status, 'ok', JSON.stringify(result));
      const transport = JSON.stringify(snapshot, (_key, value) => value instanceof Uint8Array ? [...value] : value);
      await page.locator('#nav-policy').click();
      const response = page.waitForResponse(value => value.url().endsWith('/api/authoring-intake'));
      await page.getByLabel('Portable declaration snapshot').setInputFiles({ name: `${example.id}.json`, mimeType: 'application/json', buffer: Buffer.from(transport) });
      assert.equal((await (await response).json()).status, 'ok');
      await page.locator('#browse-family option[value="Independent"]').waitFor({ state: 'attached' });
      await page.locator('#nav-sources').click();
      await page.locator('#browse-family').selectOption('Independent');
      const item = result.value.release.items[0], facts = item.metadata.sourceFacts;
      const card = page.locator(`[data-card-id="${result.value.release.sha256}/${item.id}"]`);
      await card.click();
      assert.ok((await page.locator('#details-source').textContent()).includes(facts.provenance.sha256));
      assert.match(await page.locator('#details-desc').textContent(), /Description not declared/);
      await page.getByText('Source declarations — separate from installation requirements', { exact: true }).click();
      if (example.id === 'hooks') for (const fact of ['PreToolUse', 'Bash', 'reviewed-handler']) assert.ok((await page.locator('#details-source').textContent()).includes(fact));
      if (example.id === 'mcp') {
        assert.match(await page.locator('#details-source').textContent(), /Individual tool metadata/);
        assert.match(await page.locator('#details-source').textContent(), /values withheld/);
        assert.doesNotMatch(await page.locator('#details-source').textContent(), /fixture-sensitive-value/);
      }
      assert.ok((await page.locator('#details-source').textContent()).includes(facts.status));
      await page.screenshot({ path: join(output, `${example.id}.png`), fullPage: true });
      observed.push({ id: example.id, facts, releaseSha256: result.value.release.sha256, browser: await page.locator('#details-source').textContent() });
    }
    const source = '---\nname: example\ndescription: |\n  Source purpose line one.\n  Source purpose line two.\ncompatibility: Requires a terminal\nmetadata:\n  owner: Source author\n---\n<script>neverEvaluateSource()</script>\n';
    const folder = join(output, 'personal');
    const files = [{ path: 'LICENSE', bytes: [...Buffer.from('Personal license terms.')] }, { path: 'skills/example/SKILL.md', bytes: [...Buffer.from(source)] }];
    for (const file of files) { const path = join(folder, file.path); await mkdir(dirname(path), { recursive: true }); await writeFile(path, Uint8Array.from(file.bytes)); }
    const personal = await intakePersonalFolder({ files }); assert.equal(personal.status, 'ok');
    await page.locator('#personal-folder').setInputFiles(folder);
    await page.locator('#personal-result').filter({ hasText: 'Folder validated' }).waitFor();
    await page.locator('#browse-family').selectOption('Personal');
    await page.locator('#cards-grid [data-card-id]').click();
    assert.equal(await page.locator('#details-desc').textContent(), personal.value.release.items[0].metadata.sourceFacts.description.value);
    await page.getByText('Original source material (may contain sensitive values)', { exact: true }).click();
    await page.getByRole('button', { name: 'Read original source as text', exact: true }).click();
    await page.locator('#details-source pre').filter({ hasText: 'neverEvaluateSource()' }).waitFor();
    assert.equal(await page.locator('#details-source script').count(), 0);
    await page.getByRole('button', { name: 'Choose personal.skill.example', exact: true }).click();
    await page.locator('#policy-accept:not([disabled])').waitFor(); await page.locator('#policy-accept').click();
    const before = await page.locator('#policy-bytes').textContent();
    await page.locator('#nav-scan-review').click();
    const panel = page.getByRole('region', { name: 'Latest Scan evidence' });
    await panel.getByLabel('Scan content', { exact: true }).selectOption(`${personal.value.release.sha256}/personal.skill.example`);
    await panel.getByRole('button', { name: 'Check Scan evidence', exact: true }).click();
    await panel.getByRole('status').filter({ hasText: 'No assessment available: no evidence source configured or supplied' }).waitFor();
    assert.equal(await page.locator('#policy-bytes').textContent(), before);
    await page.screenshot({ path: join(output, 'unconfigured-evidence.png'), fullPage: true });
    const response = page.waitForResponse(value => value.url().endsWith('/api/authoring-scan-evidence'));
    await panel.getByLabel('Evidence for latest view', { exact: true }).setInputFiles({ name: 'unsupported.json', mimeType: 'application/json', buffer: Buffer.from('{"schema":"urn:aihq:scan:report:9.0.0"}') });
    const failed = await (await response).json(); assert.equal(failed.status, 'selected');
    assert.equal(failed.checks[0].status, 'failed');
    await panel.getByRole('status').filter({ hasText: 'unsupported-report' }).waitFor();
    await page.screenshot({ path: join(output, 'unsupported-evidence.png'), fullPage: true });
    assert.equal(await page.locator('#policy-bytes').textContent(), before);
    await page.locator('#nav-policy').click();
    const download = page.waitForEvent('download'); await page.locator('#policy-save').click();
    const path = join(output, 'policy.downloaded.json'); await (await download).saveAs(path);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), JSON.parse(before));
    assert.deepEqual(errors, []);
    const resolution = Object.fromEntries(await Promise.all(['@aihq/core', '@aihq/catalog/source', '@aihq/catalog/reader', '@aihq/scan/read'].map(async name => {
      const path = fileURLToPath(import.meta.resolve(name));
      return [name, { path, sha256: createHash('sha256').update(await readFile(path)).digest('hex') }];
    })));
    await writeFile(join(output, 'source-facts-evidence.json'), JSON.stringify({ fixture: true, limits: 'Controlled profile/evidence failure fixtures; no detector execution or native-use claim.', elapsedMs: performance.now() - began, resolution, observed, personal: personal.value.release.items[0].metadata.sourceFacts, failed, errors }, null, 2));
  } finally { await browser.close(); }
}
