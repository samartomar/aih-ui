// ECC's default pick minus the two sets whose MCP servers need inputs. The pre-ticked sets plus "rules (typescript)" are
// added on the running page (246 items) within the policy byte bounds. Review of the whole pick names each MCP server whose
// required inputs the Workbench cannot supply ("Needs {input}") and writes nothing. Without the two sets that bring those
// servers in, Review names every namespaced rule and Install writes every file Core previewed. Real Catalog content;
// Catalog's own resolution gives the counts. The largest TypeScript profile ("full") is recorded too: it is still refused by a named bound (the
// 850,000-byte saved intent, and Core's 256 origins per selection), never by a crash.
// Usage: AIH_CONSUMER_DIR=<packed consumer> PLAYWRIGHT_MODULE=<url> node tools/consumer/ecc-policy-size-browser.mjs [evidenceDir]
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveSelections } from '@aihq/catalog/reader';
import { frameworkFixtures } from './framework-fixtures.mjs';
import { installedFamilies } from './installed-families.mjs';
import { chooseCatalogFamily, closePolicyDrawer, openPolicyDrawer } from './policy-drawer.mjs';

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
  pick.selections = resolved.value.selections;
}
const itemOf = selection => release.items.find(item => item.id === selection.item.itemId);
// Some of the default pick's MCP servers read host values. The host supplies each secret as a private input, by selection
// id. A value that is not secret could only be the selection's configuration, and Catalog declares none of them as item
// inputs, so nothing can supply it: those servers are what Review must name.
const privateInputs = {}, needs = {};
for (const selection of picks[0].selections) {
  const inputs = Object.entries(itemOf(selection).requirements?.inputs ?? {}).filter(([, input]) => input.required !== false);
  const secret = inputs.filter(([, input]) => input.sensitive).map(([name]) => name), plain = inputs.filter(([, input]) => !input.sensitive).map(([name]) => name);
  if (secret.length) privateInputs[selection.id] = Object.fromEntries(secret.map(name => [name, `fixture-${name}`]));
  if (plain.length) needs[selection.item.itemId] = plain;
}
const unsupplied = Object.keys(needs);
assert.deepEqual([...unsupplied].sort(), ['ecc.mcp.ecc-memory-vault', 'ecc.mcp.ito-compute', 'ecc.mcp.jira', 'ecc.mcp.omega-memory']);
const resolvedBy = requests => { const resolved = resolveSelections({ releases: { [release.sha256]: release }, sets: requests, roots: [], skips: [] });
  assert.equal(resolved.status, 'ok', JSON.stringify(resolved.diagnostics)); return resolved.value.selections; };
const withheldSets = picks[0].requests.filter(request => resolvedBy([request]).some(selection => unsupplied.includes(selection.item.itemId))).map(request => request.setId);
assert.ok(withheldSets.every(id => !id.includes('rules')), 'no rule set carries such a server');
// What the default pick installs without them, by Catalog's own resolution.
const installable = resolvedBy(picks[0].requests.filter(request => !withheldSets.includes(request.setId)));
assert.ok(!installable.some(selection => unsupplied.includes(selection.item.itemId)));
const installableItems = installable.length;
// Every rule of the default pick, by namespace, as Review names it.
const rules = picks[0].selections.map(itemOf).filter(item => item.kind === 'rule');
const ruleNamespaces = {};
for (const item of rules) ruleNamespaces[item.payload.namespace] = (ruleNamespaces[item.payload.namespace] ?? 0) + 1;
assert.deepEqual(Object.keys(ruleNamespaces).sort(), ['common', 'typescript'], 'the default pick has common and TypeScript rules');
const reviewName = item => `${item.display?.name ?? item.name ?? item.label ?? item.id} (${item.payload.namespace})`;
const filesUnder = async directory => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path)); else if (entry.isFile()) files.push(path);
  }
  return files;
};
await writeFile(join(fixtureDirectory, 'controls.json'), JSON.stringify({ privateInputs }));
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
const results = [], prepares = [];
let page;
try {
  const origin = `http://127.0.0.1:${address.port}`;
  const errors = [];
  for (const pick of picks) {
    // A fresh page per pick, with the pick as the page's own saved browsing choice for this framework.
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    let inventory;
    context.on('response', async response => {
      const operation = response.url().match(/\/api\/authoring-(managed|prepare)$/)?.[1];
      if (!operation) return;
      const body = await response.json().catch(() => undefined);
      if (operation === 'managed' && body?.selections) inventory = body;
      if (operation === 'prepare' && body) prepares.push({ pick: pick.name, status: body.status, diagnostics: body.diagnostics?.slice(0, 8),
        needs: body.needs, operations: body.review?.operations?.length });
    });
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
    const result = { pick: pick.name, resolvedItems: pick.resolved, status: edited.status, schema: edited.value?.policy?.schema,
      selections: edited.value?.policy?.selections?.length, inlineRecipes: edited.value?.policy?.selections?.filter(selection => selection.recipe).length,
      catalogReleases: edited.value?.policy?.catalogReleases?.map(entry => entry.framework), policyBytes,
      intentBytes: edited.value?.intent ? new TextEncoder().encode(JSON.stringify(edited.value.intent)).length : undefined,
      guidance: (await guidance.innerText()).trim(), diagnostics: edited.diagnostics?.map(value => `${value.code}: ${value.message}`) };
    results.push(result);
    await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'running', results }, null, 2));
    await page.screenshot({ path: join(output, `${pick.name}.png`), fullPage: true });
    if (pick.name === 'default' && result.status === 'ok') {
      // Review of the whole pick: each server whose inputs cannot be supplied is named, Install is not offered and nothing is written.
      await openPolicyDrawer(page);
      await page.locator('#install-needs li').first().waitFor({ timeout: 180_000 });
      result.needsShown = await page.locator('#install-needs li').evaluateAll(nodes => nodes.map(node => ({ itemId: node.dataset.needsItem,
        text: node.innerText.trim(), needs: [...node.querySelectorAll('[data-needs-input]')].map(input => input.textContent) })));
      result.needsMessage = (await page.locator('#install-message').innerText()).trim();
      result.installOfferedWithNeeds = await page.locator('#install-button').isEnabled();
      result.writtenWithNeeds = [...await filesUnder(join(project, '.claude')), ...await filesUnder(join(project, '.aih'))].length;
      await page.screenshot({ path: join(output, 'default-needs.png'), fullPage: true });
      await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'running', results }, null, 2));
      assert.deepEqual(result.needsShown.map(row => row.itemId).sort(), [...unsupplied].sort(), 'Review names every server whose inputs cannot be supplied');
      for (const row of result.needsShown) {
        assert.deepEqual(row.needs, needs[row.itemId].map(name => `Needs ${name}`), `${row.itemId} names each missing input in the contract's words`);
        { const item = release.items.find(candidate => candidate.id === row.itemId); assert.ok(row.text.startsWith(item.name ?? item.label), row.text); }
      }
      assert.match(result.needsMessage, /^Can't install yet/);
      assert.equal(result.installOfferedWithNeeds, false, 'Install is not offered');
      assert.equal(result.writtenWithNeeds, 0, 'nothing is written');
      await closePolicyDrawer(page);
      // Untick the sets whose servers need host values that cannot be given, and update the chosen sets.
      for (const setId of withheldSets) {
        await page.locator(`#starting-sets [data-set-id="${setId}"]`).evaluate(node => { const details = node.closest('details'); if (details) details.open = true; node.click(); });
        await page.locator(`#starting-sets [data-set-id="${setId}"][aria-pressed="false"]`).waitFor({ state: 'attached' });
      }
      const updated = page.waitForResponse(candidate => candidate.url().endsWith('/api/authoring-edit') && candidate.request().method() === 'POST', { timeout: 120_000 });
      await page.locator('#starting-sets [data-add-sets]').evaluate(node => node.click());
      const narrowed = await (await updated).json();
      result.unsuppliedServers = unsupplied; result.withheldSets = withheldSets;
      result.installSelections = narrowed.value?.policy?.selections?.length;
      result.installPolicyBytes = narrowed.value?.policyBytes?.length;
      assert.equal(narrowed.status, 'ok', JSON.stringify(narrowed.diagnostics));
      // Review, then Install, on the same page.
      await openPolicyDrawer(page);
      await page.locator('#install-button:not([disabled])').waitFor({ timeout: 180_000 });
      await page.locator('#install-details').evaluate(node => { node.open = true; });
      const review = await page.locator('#install-review-rows').innerText();
      result.reviewMissing = rules.map(reviewName).filter(name => !review.includes(name));
      await page.screenshot({ path: join(output, 'default-review.png'), fullPage: true });
      assert.deepEqual(result.reviewMissing, [], 'Review names every rule with its namespace');
      result.previewedFiles = prepares.filter(entry => entry.status === 'ready').at(-1)?.operations;
      inventory = undefined;
      await page.locator('#install-button').click();
      await page.locator('#install-message[data-outcome="installed"]').waitFor({ timeout: 300_000 });
      for (let attempt = 0; attempt < 120 && !inventory; attempt++) await page.waitForTimeout(250);
      const written = (await filesUnder(join(project, '.claude', 'rules'))).map(path => relative(project, path).replaceAll('\\', '/')).sort();
      result.ruleFiles = written;
      result.ruleFilesByNamespace = {};
      for (const path of written) { const namespace = path.split('/')[2]; result.ruleFilesByNamespace[namespace] = (result.ruleFilesByNamespace[namespace] ?? 0) + 1; }
      result.installedItems = inventory?.selections.filter(selection => selection.item?.framework === 'ecc').length;
      result.installMessage = (await page.locator('#install-message').innerText()).trim();
      await page.screenshot({ path: join(output, 'default-installed.png'), fullPage: true });
      await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'running', results }, null, 2));
    }
    await context.close();
  }
  const chosen = results.find(result => result.pick === 'default');
  assert.equal(chosen.status, 'ok', `default: ${JSON.stringify(chosen.diagnostics)}`);
  assert.match(chosen.guidance, /^Chosen sets added/);
  assert.equal(chosen.schema, 'urn:aihq:core:execution-policy:1.6.0');
  assert.equal(chosen.selections, 246);
  assert.equal(chosen.inlineRecipes, 0, 'every selection names its item; Core renders the recipes');
  assert.deepEqual(chosen.catalogReleases, ['ecc']);
  assert.ok(chosen.policyBytes <= 850_000, `the default ECC pick leaves headroom under the 1,000,000-byte bound: ${chosen.policyBytes}`);
  // Install wrote every rule into its namespace folder, and Core lists every item.
  assert.deepEqual(chosen.ruleFilesByNamespace, ruleNamespaces, JSON.stringify(chosen.ruleFiles));
  assert.equal(chosen.ruleFiles.length, rules.length);
  assert.equal(chosen.installSelections, installableItems);
  assert.equal(chosen.installedItems, installableItems, 'Core lists every installed ECC item');
  assert.ok(chosen.previewedFiles > 0);
  assert.equal(chosen.installMessage.match(/^Confirmed on disk: all (\d+) files/)?.[1], String(chosen.previewedFiles), 'every file Core previewed is confirmed on disk');
  // The full profile is refused by a named bound, with the page's refusal wording.
  const full = results.find(result => result.pick === 'full');
  assert.equal(full.status, 'refused');
  assert.deepEqual(full.diagnostics.map(value => value.split(':')[0]), ['POLICY_BOUND_EXCEEDED']);
  assert.doesNotMatch(full.guidance, /^Chosen sets added/);
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'passed', results }, null, 2));
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {});
  const shownSets = await page?.locator('#starting-sets [data-set-id]').evaluateAll(nodes => nodes.map(node => node.dataset.setId)).catch(() => undefined);
  await writeFile(join(output, 'failure.json'), JSON.stringify({ status: 'failed', message: error.message, results, prepares, shownSets }, null, 2));
  throw error;
} finally {
  await browser.close();
  workbench.server.closeAllConnections();
  await new Promise(resolveClose => workbench.server.close(resolveClose));
}
console.log(JSON.stringify({ status: 'passed', results }));
