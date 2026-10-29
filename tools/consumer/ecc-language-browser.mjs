import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readInstalledPreparedContent } from '@aihq/catalog/node';
import { resolveSelections } from '@aihq/catalog/reader';
import { frameworkFixtures } from './framework-fixtures.mjs';
import { installedFamilies } from './installed-families.mjs';
import { addFromCatalog, chooseCatalogFamily, openPolicyDrawer } from './policy-drawer.mjs';

const consumerDir = resolve(process.env.AIH_CONSUMER_DIR);
const output = resolve(process.argv[2] ?? join(consumerDir, 'ecc-language-evidence'));
await mkdir(output, { recursive: true });
const project = await mkdtemp(join(tmpdir(), 'aih-ecc-language-'));
const fixtureDirectory = join(output, 'fixtures');
const reviewed = JSON.parse(await readFile(join(consumerDir, 'reviewed-packages.json'), 'utf8'));
const catalogArtifact = reviewed.find(entry => entry.name === 'catalog');
const fixture = await frameworkFixtures(fixtureDirectory, catalogArtifact);
const sources = join(fixtureDirectory, 'sources.json');
await writeFile(sources, JSON.stringify(fixture.scenarios.browse));

const catalogRoot = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
const inventory = (await installedFamilies({ root: catalogRoot })).find(entry => entry.family === 'ECC');
const npmCache = process.env.AIH_TEST_NPM_CACHE;
const npmCli = process.env.npm_execpath;
assert.ok(npmCache, 'Set AIH_TEST_NPM_CACHE to an existing integrity-verified npm cache');
assert.ok(npmCli, 'The running npm supplies its actual CLI path');
const configurations = inventory.release.items.filter(item => item.inputs?.npmCache || item.inputs?.npmCli).map(item => ({
  releaseSha256: inventory.release.sha256, itemId: item.id, scope: 'project',
  configuration: { ...(item.inputs?.npmCache ? { npmCache } : {}), ...(item.inputs?.npmCli ? { npmCli } : {}) },
}));
const resolved = resolveSelections({ releases: { [inventory.release.sha256]: inventory.release }, sets: fixture.expected.ecc.requests, roots: configurations, skips: [] });
assert.equal(resolved.status, 'ok', JSON.stringify(resolved.diagnostics));
const privateInputs = {};
for (const selection of resolved.value.selections) {
  const item = inventory.release.items.find(candidate => candidate.id === selection.item.itemId);
  const names = Object.keys(item.requirements?.inputs ?? {});
  if (names.length) privateInputs[selection.id] = Object.fromEntries(names.map(name => [name, name === 'AIHQ_MCP_BROWSERBASE_ROOT' ? consumerDir : `fixture-${name}`]));
}
const expectedRules = resolved.value.selections.filter(selection => inventory.release.items.find(item => item.id === selection.item.itemId)?.kind === 'rule'
  && inventory.release.items.find(item => item.id === selection.item.itemId)?.payload?.namespace === 'typescript');
assert.ok(expectedRules.length > 0, 'TypeScript selects real namespaced rules');

const controls = join(fixtureDirectory, 'controls.json');
await writeFile(controls, JSON.stringify({ privateInputs }));
process.env.AIH_CONSUMER_PROJECT = project;
process.env.AIH_FRAMEWORK_SOURCES = sources;
process.env.AIH_CONSUMER_CONTROLS = controls;
const repo = resolve(process.env.AIH_REPO ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const { createWorkbench } = await import(pathToFileURL(join(repo, 'tools/server/workbench.mjs')).href);
const { listen } = await import(pathToFileURL(join(repo, 'tools/server/static.mjs')).href);
const summary = JSON.parse(await readFile(join(consumerDir, 'prototype/summary.json'), 'utf8'));
const workbench = await createWorkbench({ consumerDir, runDir: join(consumerDir, 'prototype'), summary, settingsPath: join(project, 'settings.json') });
const address = await listen(workbench.server, 0);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const browser = await chromium.launch({ headless: true });
let ruleFilesWritten = 0;
const actualRulePaths = [];
const relativeFiles = async directory => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await relativeFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
};
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude'));
  const page = await context.newPage(); page.setDefaultTimeout(30_000);
  const origin = `http://127.0.0.1:${address.port}`;
  await page.goto(origin + '/');
  await page.locator('#browse-family option[value="ECC"]').waitFor({ state: 'attached' });
  if (await page.locator('#setup-dialog').isVisible()) {
    await page.getByRole('radio', { name: /Vibe coder/ }).check();
    for (let step = 0; step < 4; step++) await page.locator('#setup-next').click();
    await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
  }
  console.log('F20 stage: open ECC');
  await chooseCatalogFamily(page, 'ECC');
  await page.locator('#starting-sets .set-refusal').waitFor();
  await page.locator(`[data-set-id="${fixture.expected.ecc.optionSet.id}"]`).waitFor({ state: 'attached' });
  await page.locator(`[data-set-id="${fixture.expected.ecc.optionSet.id}"]`).evaluate(node => { const details = node.closest('details'); if (details) details.open = true; node.click(); });
  console.log('F20 stage: pick TypeScript');
  await page.evaluate(id => { const input = document.querySelector(`[data-option="${id}"]`); input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); }, fixture.expected.ecc.language.id);
  console.log('F20 stage: add configured sets');
  const post = async (operation, body) => {
    const response = await fetch(`${origin}/api/authoring-${operation}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return response.json();
  };
  const fresh = await post('new', { mode: 'vibe', tool: 'claude' });
  assert.equal(fresh.status, 'ok', JSON.stringify(fresh.diagnostics));
  const addedResult = await post('edit', { policyBytes: fresh.value.policyBytes,
    operation: { type: 'select-sets', sets: fixture.expected.ecc.requests, configurations, tool: 'claude' } });
  assert.equal(addedResult.status, 'ok', JSON.stringify(addedResult.diagnostics));
  await page.reload();
  await openPolicyDrawer(page);
  const review = await page.locator('#install-review-rows').innerText();
  assert.match(review, /coding-style \(typescript\)/);
  await page.locator('#install-button:not([disabled])').waitFor();
  console.log('F20 stage: install');
  await page.locator('#install-button').click();
  await page.locator('#install-message[data-outcome="installed"]').waitFor({ timeout: 120_000 });
  const files = await relativeFiles(project);
  actualRulePaths.push(...files.filter(path => path.startsWith(join(project, '.claude', 'rules'))).map(path => relative(project, path).replaceAll('\\', '/')));
  const namespaced = actualRulePaths.filter(path => path.split('/').includes('typescript'));
  ruleFilesWritten = namespaced.length;
  assert.equal(ruleFilesWritten, expectedRules.length, 'Core flattens namespaced rules');
  await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'passed', language: 'typescript', expectedRuleCount: expectedRules.length, ruleFilesWritten, actualRulePaths }, null, 2));
  await context.close();
} catch (error) {
  await writeFile(join(output, 'failure.json'), JSON.stringify({ status: 'failed', message: error.message, expectedRuleCount: expectedRules.length, ruleFilesWritten, actualRulePaths }, null, 2));
  throw error;
} finally {
  await browser.close();
  workbench.server.closeAllConnections();
  await new Promise(resolveClose => workbench.server.close(resolveClose));
}
console.log(JSON.stringify({ status: 'passed', language: 'typescript', ruleFilesWritten, expectedRuleCount: expectedRules.length }));
