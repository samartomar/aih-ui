// N1: an organisation policy read from a local file the host names, through Core's local reader.
// Real Catalog Superpowers content in an Enterprise setup; the file changes between the preview and Install.
// Usage: AIH_CONSUMER_DIR=<packed consumer> PLAYWRIGHT_MODULE=<url> node tools/consumer/local-policy-browser.mjs [evidenceDir]
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deriveRecipeIdentity } from '@aihq/core/contracts';
import { installedFamilies } from './installed-families.mjs';
import { drawer, openPolicyDrawer, openPolicyFileActions } from './policy-drawer.mjs';

const STALE_POLICY = "Your organisation's policy changed since the preview; nothing was installed.";
const consumerDir = resolve(process.env.AIH_CONSUMER_DIR);
const output = resolve(process.argv[2] ?? join(consumerDir, 'local-policy-evidence'));
await mkdir(output, { recursive: true });
const project = await mkdtemp(join(tmpdir(), 'aih-local-policy-'));
const catalogRoot = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
const superpowers = (await installedFamilies({ root: catalogRoot })).find(entry => entry.family === 'Superpowers');
const item = superpowers.release.items.find(candidate => candidate.kind === 'skill' && candidate.name === 'brainstorming');
assert.ok(item, 'Catalog publishes the Superpowers brainstorming skill');

// The organisation document prohibits hooks; once the setup is composed it also permits the chosen recipes.
const organizationPath = join(output, 'organization-policy.json');
const organization = { schema: 'urn:aihq:core:organization-policy:1.2.0', id: 'local-organization', selections: [
  { selectionId: 'no-hooks', scopes: ['project'], obligation: 'prohibited', content: { kind: 'hook' } }] };
await writeFile(organizationPath, JSON.stringify(organization, null, 2) + '\n');
const sourcePath = join(output, 'organization-source.json');
await writeFile(sourcePath, JSON.stringify({ provider: 'local', path: organizationPath }));
process.env.AIH_ORGANIZATION_SOURCE = sourcePath;
process.env.AIH_CONSUMER_PROJECT = project;

const repo = resolve(process.env.AIH_REPO ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const { createWorkbench } = await import(pathToFileURL(join(repo, 'tools/server/workbench.mjs')).href);
const { listen } = await import(pathToFileURL(join(repo, 'tools/server/static.mjs')).href);
const summary = JSON.parse(await readFile(join(consumerDir, 'prototype/summary.json'), 'utf8'));
const workbench = await createWorkbench({ consumerDir, runDir: join(consumerDir, 'prototype'), summary, settingsPath: join(project, 'settings.json') });
const address = await listen(workbench.server, 0);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const browser = await chromium.launch({ headless: true });
const facts = { item: item.id, source: 'local' };
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude'));
  page = await context.newPage(); page.setDefaultTimeout(30_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const origin = `http://127.0.0.1:${address.port}`;
  const post = async (operation, body) => (await fetch(`${origin}/api/authoring-${operation}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  // The host names the source; the page reads it as configured and labels the file.
  const authority = await post('authority-source', {});
  facts.authority = { status: authority.status, diagnostics: authority.diagnostics };
  assert.equal(authority.status, 'ok', JSON.stringify(authority.diagnostics));
  assert.equal(authority.source?.provider, 'local');
  await page.goto(origin + '/');
  await page.locator('#browse-family option[value="Superpowers"]').waitFor({ state: 'attached' });
  // An Enterprise Developer: the organisation's policy governs what is installed.
  await page.getByRole('radio', { name: /Enterprise/ }).check(); await page.locator('#setup-next').click();
  await page.getByRole('radio', { name: /Developer/ }).check();
  for (let step = 0; step < 6 && await page.locator('#setup-dialog').isVisible(); step++) await page.locator('#setup-next').click();
  await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
  // The Enterprise policy file a Developer opens: one real Superpowers skill, composed by the Workbench's own authoring.
  const fresh = await post('new', { mode: 'enterprise', tool: 'claude' });
  assert.equal(fresh.status, 'ok', JSON.stringify(fresh.diagnostics));
  const added = await post('edit', { policyBytes: fresh.value.policyBytes, tool: 'claude',
    operation: { type: 'select', root: { releaseSha256: superpowers.release.sha256, itemId: item.id, itemSha256: item.itemSha256, scope: 'project', configuration: {}, originIds: ['direct'] }, tool: 'claude' } });
  assert.equal(added.status, 'ok', JSON.stringify(added.diagnostics));
  const policyPath = join(output, 'enterprise-policy.json');
  await writeFile(policyPath, Uint8Array.from(added.value.policyBytes));
  const policy = JSON.parse(await readFile(policyPath, 'utf8'));
  facts.mode = policy.mode;
  assert.equal(facts.mode, 'enterprise');
  // The organisation permits exactly these rendered recipes, by Core's recipe identity.
  for (const selection of policy.selections) {
    const identity = await deriveRecipeIdentity({ recipe: selection.recipe.inline });
    assert.equal(identity.status, 'ok', JSON.stringify(identity));
    organization.selections.push({ selectionId: selection.organizationSelectionId, recipeIdentity: identity.value.recipeIdentity, scopes: ['project'],
      obligation: 'permitted', inputs: {}, lifecycle: { replace: true, remove: true } });
  }
  await writeFile(organizationPath, JSON.stringify(organization, null, 2) + '\n');
  await openPolicyFileActions(page); await page.locator('#policy-open').setInputFiles(policyPath);
  await drawer(page).getByRole('button', { name: 'Validate and reopen', exact: true }).click();
  await page.locator('#policy-status').filter({ hasText: 'Saved choices recovered' }).waitFor();
  await openPolicyDrawer(page);
  await page.locator('#authority-source').filter({ hasText: `Policy from ${organizationPath.split(/[\\/]/).pop()}` }).waitFor({ state: 'attached' });
  // The preview is ready once Install is offered.
  await page.locator('#install-button:not([disabled])').waitFor({ timeout: 120_000 });
  facts.preview = (await page.locator('#install-review-rows').textContent()).slice(0, 400);
  assert.match(facts.preview, /brainstorming/);
  // The organisation changes its policy after the preview.
  await writeFile(organizationPath, JSON.stringify({ ...organization, metadata: { revision: 'changed after preview' } }, null, 2) + '\n');
  await page.locator('#install-button').click();
  await page.locator('#install-message[data-outcome="stale"]').filter({ hasText: STALE_POLICY }).waitFor({ timeout: 120_000 });
  // Once the fresh preview is back, Core's words are still what the page says.
  await page.locator('#install-button:not([disabled])').waitFor({ timeout: 120_000 });
  facts.message = (await page.locator('#install-message').innerText()).trim();
  assert.ok(facts.message.startsWith(STALE_POLICY), facts.message);
  const written = (await readdir(project, { recursive: true })).filter(path => path.startsWith('.claude'));
  facts.written = written;
  assert.deepEqual(written, [], 'nothing was installed');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(output, 'stale-policy.png'), fullPage: true });
  await context.close();
  await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'passed', ...facts }, null, 2));
} catch (error) {
  facts.installPanel = await page?.locator('#install-message').innerText().catch(() => undefined);
  await page?.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(join(output, 'failure.json'), JSON.stringify({ status: 'failed', message: error.message, ...facts }, null, 2));
  throw error;
} finally {
  await browser.close();
  workbench.server.closeAllConnections();
  await new Promise(resolveClose => workbench.server.close(resolveClose));
}
console.log(JSON.stringify({ status: 'passed', ...facts }));
