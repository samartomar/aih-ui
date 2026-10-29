// The ECC pick must fit the policy byte bounds: the pre-ticked sets plus "rules (typescript)", and the largest
// TypeScript profile ("full"). Real Catalog content, chosen on the running page; Catalog's own resolution gives the counts.
// Usage: AIH_CONSUMER_DIR=<packed consumer> PLAYWRIGHT_MODULE=<url> node tools/consumer/ecc-policy-size-browser.mjs [evidenceDir]
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveSelections } from '@aihq/catalog/reader';
import { frameworkFixtures } from './framework-fixtures.mjs';
import { installedFamilies } from './installed-families.mjs';
import { chooseCatalogFamily } from './policy-drawer.mjs';

const consumerDir = resolve(process.env.AIH_CONSUMER_DIR);
const output = resolve(process.argv[2] ?? join(consumerDir, 'ecc-policy-size-evidence'));
await mkdir(output, { recursive: true });
const project = await mkdtemp(join(tmpdir(), 'aih-ecc-size-'));
const fixtureDirectory = join(output, 'fixtures');
const reviewed = JSON.parse(await readFile(join(consumerDir, 'reviewed-packages.json'), 'utf8'));
const fixture = await frameworkFixtures(fixtureDirectory, reviewed.find(entry => entry.name === 'catalog'));
const sources = join(fixtureDirectory, 'sources.json');
await writeFile(sources, JSON.stringify(fixture.scenarios.browse));
const catalogRoot = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
const release = (await installedFamilies({ root: catalogRoot })).find(entry => entry.family === 'ECC').release;
const request = (id, options = {}) => { const set = release.sets.find(candidate => candidate.id === id);
  return { release: { releaseSha256: release.sha256, scope: 'project' }, setId: set.id, setSha256: set.setSha256, options, members: [] }; };
const preTicked = release.sets.filter(set => set.offer === 'pre-ticked').map(set => set.id);
const picks = [
  { name: 'default', sets: [...preTicked, 'ecc.rules.typescript'], requests: [...preTicked.map(id => request(id)), request('ecc.rules.typescript')], expected: 246 },
  { name: 'full', sets: ['ecc.profile.full'], option: 'typescript', requests: [request('ecc.profile.full', { languages: ['typescript'] })], expected: 476 },
];
for (const pick of picks) {
  const resolved = resolveSelections({ releases: { [release.sha256]: release }, sets: pick.requests, roots: [], skips: [] });
  assert.equal(resolved.status, 'ok', JSON.stringify(resolved.diagnostics));
  pick.resolved = resolved.value.selections.length;
  assert.equal(pick.resolved, pick.expected, `Catalog resolves the ${pick.name} pick to ${pick.expected} items`);
}
await writeFile(join(fixtureDirectory, 'controls.json'), JSON.stringify({ privateInputs: {} }));
process.env.AIH_CONSUMER_PROJECT = project;
process.env.AIH_FRAMEWORK_SOURCES = sources;
process.env.AIH_CONSUMER_CONTROLS = join(fixtureDirectory, 'controls.json');
const repo = resolve(process.env.AIH_REPO ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const { createWorkbench } = await import(pathToFileURL(join(repo, 'tools/server/workbench.mjs')).href);
const { listen } = await import(pathToFileURL(join(repo, 'tools/server/static.mjs')).href);
const summary = JSON.parse(await readFile(join(consumerDir, 'prototype/summary.json'), 'utf8'));
const workbench = await createWorkbench({ consumerDir, runDir: join(consumerDir, 'prototype'), summary, settingsPath: join(project, 'settings.json') });
const address = await listen(workbench.server, 0);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const browser = await chromium.launch({ headless: true });
const results = [];
let page;
try {
  const origin = `http://127.0.0.1:${address.port}`;
  const errors = [];
  for (const pick of picks) {
    // A fresh page per pick, with the pick as the page's own saved browsing choice for this framework.
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(({ key, requests }) => { localStorage.setItem('wb-your-tool', 'claude');
      if (!sessionStorage.getItem('aih-ui-set-browsing')) sessionStorage.setItem('aih-ui-set-browsing', JSON.stringify([[key, { requests, allItems: false }]])); },
      { key: release.sha256, requests: pick.requests });
    page = await context.newPage(); page.setDefaultTimeout(30_000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/');
    await page.locator('#browse-family option[value="ECC"]').waitFor({ state: 'attached' });
    if (await page.locator('#setup-dialog').isVisible()) {
      await page.getByRole('radio', { name: /Vibe coder/ }).check();
      for (let step = 0; step < 4; step++) await page.locator('#setup-next').click();
      await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
    }
    await chooseCatalogFamily(page, 'ECC');
    await page.locator('#starting-sets [data-add-sets]').waitFor();
    const chosen = await page.locator('#starting-sets [data-set-id][aria-pressed="true"]').evaluateAll(nodes => nodes.map(node => node.dataset.setId).sort());
    assert.deepEqual(chosen, [...pick.sets].sort());
    if (pick.option) await page.locator(`#starting-sets [data-option="${pick.option}"]:checked`).waitFor({ state: 'attached' });
    const response = page.waitForResponse(candidate => candidate.url().endsWith('/api/authoring-edit') && candidate.request().method() === 'POST', { timeout: 120_000 });
    await page.locator('#starting-sets [data-add-sets]').evaluate(node => node.click());
    const edited = await (await response).json();
    const guidance = page.locator('#framework-guidance');
    await guidance.filter({ hasText: /Chosen sets added|bound|could not be added|refused/i }).waitFor();
    const policyBytes = edited.value?.policyBytes?.length;
    results.push({ pick: pick.name, resolvedItems: pick.resolved, status: edited.status, selections: edited.value?.policy?.selections?.length,
      policyBytes, guidance: (await guidance.innerText()).trim(), diagnostics: edited.diagnostics?.map(value => `${value.code}: ${value.message}`) });
    await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'running', results }, null, 2));
    await page.screenshot({ path: join(output, `${pick.name}.png`), fullPage: true });
    await context.close();
  }
  for (const result of results) {
    assert.equal(result.status, 'ok', `${result.pick}: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.policyBytes <= 1_000_000, `${result.pick}: ${result.policyBytes} policy bytes`);
    assert.match(result.guidance, /^Chosen sets added/);
  }
  assert.ok(results.find(result => result.pick === 'default').policyBytes <= 850_000, 'the default ECC pick leaves headroom under the bound');
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'passed', results }, null, 2));
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {});
  const shownSets = await page?.locator('#starting-sets [data-set-id]').evaluateAll(nodes => nodes.map(node => node.dataset.setId)).catch(() => undefined);
  await writeFile(join(output, 'failure.json'), JSON.stringify({ status: 'failed', message: error.message, results, shownSets }, null, 2));
  throw error;
} finally {
  await browser.close();
  workbench.server.closeAllConnections();
  await new Promise(resolveClose => workbench.server.close(resolveClose));
}
console.log(JSON.stringify({ status: 'passed', results }));
