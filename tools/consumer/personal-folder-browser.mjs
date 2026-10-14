// One ordinary installed Chromium journey, without injected inventories or pages.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startConsumer } from './server.mjs';
import { intakePersonalFolder } from './personal-folder.mjs';
import { readAuthoring } from './headless.mjs';
import { installedFamilies } from './installed-families.mjs';
import { readInstalledRelease } from '@aihq/catalog/node';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const output = process.env.AIH_FOLDER_EVIDENCE ?? await mkdtemp(join(tmpdir(), 'aih-folder-browser-'));
await mkdir(output, { recursive: true });
const folder = join(output, 'personal'), invalidFolder = join(output, 'unrecognized');
const marker = join(output, 'script-executed');
const sources = {
  LICENSE: 'MIT License\nCopyright 2026 Example\nPermission is hereby granted, free of charge.\n',
  'skills/example/SKILL.md': '---\nname: example\ndescription: Keep personal choices understandable.\nlicense: MIT\n---\n\nUse support/checklist.txt. Never run supplied code during intake.\n',
  'skills/example/support/checklist.txt': 'Keep exact choices and truthful origins.\n',
  'skills/example/intake-marker.mjs': `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed');\n`,
  'skills/second/SKILL.md': '---\nname: second\ndescription: A second recognized skill.\nlicense: MIT\n---\n\nAdditional instructions.\n'
};
for (const [path, text] of Object.entries(sources)) { await mkdir(dirname(join(folder, path)), { recursive: true }); await writeFile(join(folder, path), text); }
await mkdir(invalidFolder, { recursive: true }); await writeFile(join(invalidFolder, 'README.md'), 'Unrecognized personal format.');
const started = await startConsumer();
let browser, observedPage;
const errors = [];
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage(); page.setDefaultTimeout(30_000);
  observedPage = page;
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${started.origin}/authoring`);
  await page.locator('#summary').filter({ hasText: '"roots"' }).waitFor();
  assert.deepEqual(JSON.parse(await page.locator('#policy').inputValue()).metadata['aih.workbench'].roots, []);
  for (const family of ['Extensions', 'ECC', 'Superpowers', 'Anthropic']) assert.ok((await page.locator('#family').textContent()).includes(family));
  await page.locator('#folder').setInputFiles(invalidFolder);
  await page.locator('#folder-result').filter({ hasText: 'LOCAL_FOLDER_INVALID' }).waitFor();
  assert.ok(!(await page.locator('#family').textContent()).includes('Personal'));
  await page.locator('#folder').setInputFiles(folder);
  await page.locator('#folder-result').filter({ hasText: 'Folder validated' }).waitFor();
  await page.locator('#family').selectOption('Personal');
  await page.locator('#items legend').filter({ hasText: 'example' }).waitFor();
  assert.equal(await page.locator('#items fieldset').count(), 2);
  const provenance = await page.locator('#items pre').first().textContent();
  assert.match(provenance, /"kind": "local"/); assert.doesNotMatch(provenance, /github.com/);
  assert.match(await page.locator('#items').textContent(), /unknown · native-execution/);
  assert.match(await page.locator('#items').textContent(), /unsupported · automatic-guardrails/);
  await page.getByRole('button', { name: 'Choose personal.skill.example', exact: true }).click();
  await page.locator('#accept:not([disabled])').waitFor(); await page.locator('#accept').click();
  // Every maintained family remains selectable alongside the local root.
  for (const [family, id] of [['Extensions', 'extensions.matt.ask-matt'], ['ECC', 'ecc.skill.accessibility'], ['Superpowers', 'superpowers.skill.brainstorming'], ['Anthropic', 'anthropic.skill.academy-guide']]) {
    await page.locator('#family').selectOption(family);
    await page.getByRole('button', { name: `Choose ${id}`, exact: true }).click();
    await page.locator('#accept:not([disabled])').waitFor(); await page.locator('#accept').click();
  }
  const saved = JSON.parse(await page.locator('#policy').inputValue());
  assert.equal(saved.metadata['aih.workbench'].roots.length, 5);
  assert.doesNotMatch(JSON.stringify(saved), /grantId|x-aih-client|hostPath/);
  const download = page.waitForEvent('download'); await page.locator('#save').click();
  const savedPath = join(output, 'policy.downloaded.json'); await (await download).saveAs(savedPath);
  const policyBytes = new Uint8Array(await readFile(savedPath));
  const fresh = await browser.newContext({ acceptDownloads: true });
  const reopened = await fresh.newPage(); reopened.setDefaultTimeout(30_000);
  observedPage = reopened;
  reopened.on('pageerror', error => errors.push(error.message));
  await reopened.goto(`${started.origin}/authoring`); await reopened.locator('#summary').filter({ hasText: '"roots"' }).waitFor();
  assert.ok(!(await reopened.locator('#family').textContent()).includes('Personal'));
  await reopened.locator('#open').setInputFiles(savedPath);
  await reopened.locator('#proposal').filter({ hasText: 'Original bytes retained' }).waitFor();
  await reopened.locator('#reopen').click();
  await reopened.locator('#proposal').filter({ hasText: 'SOURCE_REVISION_UNAVAILABLE' }).waitFor();
  assert.equal(await reopened.locator('#folder-binding option').count(), 2);
  await writeFile(join(folder, 'skills/example/support/checklist.txt'), 'Changed supporting content.\n');
  await reopened.locator('#folder').setInputFiles(folder);
  await reopened.locator('#folder-result').filter({ hasText: 'LOCAL_ROOT_CHANGED' }).waitFor();
  assert.deepEqual(JSON.parse(await reopened.locator('#policy').inputValue()), saved);
  assert.ok(!(await reopened.locator('#family').textContent()).includes('Personal'));
  await writeFile(join(folder, 'skills/example/support/checklist.txt'), sources['skills/example/support/checklist.txt']);
  // Hold the real server's post-grant catalog response to expose premature
  // readiness. No page, release or validation result is fabricated here.
  let releaseCatalog, observeCatalog, finishCatalog, heldCatalog;
  const catalogGate = new Promise(resolve => { releaseCatalog = resolve; });
  const catalogObserved = new Promise(resolve => { observeCatalog = resolve; });
  const catalogFinished = new Promise(resolve => { finishCatalog = resolve; });
  const holdCatalog = async route => {
    const response = await route.fetch(); heldCatalog = await response.json(); observeCatalog();
    await catalogGate; await route.fulfill({ response }); finishCatalog();
  };
  await reopened.route('**/api/authoring-catalog', holdCatalog);
  try {
    await reopened.locator('#folder').setInputFiles(folder);
    await catalogObserved;
    assert.ok(heldCatalog.items.some(item => item.family === 'Personal'), 'The real server retains this client’s granted inventory.');
    const pendingStatus = await reopened.locator('#folder-result').textContent();
    if (/Exact folder rebound/.test(pendingStatus)) {
      // Reproduce the real caller: immediate Reopen after the premature signal
      // advances the draft revision before the pending catalog can render.
      await reopened.locator('#reopen').click();
      await reopened.locator('#proposal').filter({ hasText: '"editing": "available"' }).waitFor();
      releaseCatalog(); await catalogFinished; await reopened.waitForLoadState('networkidle');
      assert.equal(await reopened.locator('#family option[value="Personal"]').count(), 1,
        'Immediate reopen after reported readiness must keep Personal browsable.');
    }
    assert.doesNotMatch(pendingStatus, /Exact folder rebound/,
      'Rebinding must not report ready while the refreshed catalog is still pending.');
    assert.ok(!(await reopened.locator('#family').textContent()).includes('Personal'));
    releaseCatalog();
    await reopened.locator('#folder-result').filter({ hasText: 'Exact folder rebound' }).waitFor();
    await reopened.locator('#reopen').click(); await reopened.locator('#proposal').filter({ hasText: '"editing": "available"' }).waitFor();
    await reopened.locator('#family').selectOption('Personal');
    assert.equal(await reopened.locator('#items fieldset').count(), 2);
  } finally { releaseCatalog(); await catalogFinished; await reopened.unroute('**/api/authoring-catalog', holdCatalog); }
  assert.deepEqual(JSON.parse(await reopened.locator('#summary').textContent()).roots, saved.metadata['aih.workbench'].roots);
  // A separate effect-free headless call acquires the same files through the
  // same intake and public validators; browser state is never its inventory.
  const files = Object.entries(sources).map(([path, text]) => ({ path, bytes: [...new TextEncoder().encode(text)] }));
  const personal = await intakePersonalFolder({ files }); assert.equal(personal.status, 'ok');
  const maintained = await readInstalledRelease({ root: dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'))), sourceInput: 'maintained' });
  const headless = await readAuthoring({ policyBytes, inventories: [{ release: maintained.release, materialSource: { kind: 'local', input: 'maintained' } }, ...await installedFamilies(), personal.value] });
  assert.equal(headless.value.editing, 'available', JSON.stringify(headless));
  assert.deepEqual(headless.value.intent.roots, saved.metadata['aih.workbench'].roots);
  assert.deepEqual(headless.value.policy.selections, saved.selections);
  await assert.rejects(access(marker)); assert.deepEqual(errors, []);
  await reopened.screenshot({ path: join(output, 'fresh-rebound.png'), fullPage: true });
  await writeFile(join(output, 'browser-evidence.json'), JSON.stringify({ status: 'passed', entry: '/authoring', chromium: browser.version(),
    families: ['Extensions', 'ECC', 'Superpowers', 'Anthropic', 'Personal'], roots: saved.metadata['aih.workbench'].roots,
    scenarios: ['invalid-folder-refused', 'two-skills-recognized', 'local-origin', 'five-family-selection', 'actual-download', 'fresh-context-missing-root', 'changed-root-refused', 'exact-explicit-rebind', 'catalog-ready-before-success', 'immediate-reopen-preserves-personal-browsing', 'headless-agreement', 'no-supplied-code-execution'], errors }, null, 2));
  console.log(`Ordinary personal-folder Chromium journey passed: ${output}`);
} catch (error) {
  await writeFile(join(output, 'browser-failure.json'), JSON.stringify({ message: error.message, errors,
    proposal: await observedPage?.locator('#proposal').textContent().catch(() => ''), family: await observedPage?.locator('#family').inputValue().catch(() => '') }, null, 2));
  throw error;
} finally {
  await browser?.close(); await new Promise(resolve => started.server.close(resolve));
}
