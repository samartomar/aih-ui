// N1: an organisation policy read from a local file the host names, through Core's local reader.
// Only the page is driven: first-run setup as an Enterprise Developer, one real Catalog Superpowers skill added from
// its card, Review, then the organisation file changes before Install. The page's own setup must be an Enterprise
// policy, so the organisation source applies and Install refuses with Core's stale-policy sentence, writing nothing.
// Usage: AIH_CONSUMER_DIR=<packed consumer> PLAYWRIGHT_MODULE=<url> node tools/consumer/local-policy-browser.mjs [evidenceDir]
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deriveRecipeIdentity } from '@aihq/core/contracts';
import { installedFamilies } from './installed-families.mjs';
import { inlineRecipelessSelections } from './headless.mjs';
import { addFromCatalog, chooseCatalogFamily, openPolicyDrawer } from './policy-drawer.mjs';

const STALE_POLICY = "Your organisation's policy changed since the preview; nothing was installed.";
const consumerDir = resolve(process.env.AIH_CONSUMER_DIR);
const output = resolve(process.argv[2] ?? join(consumerDir, 'local-policy-evidence'));
await mkdir(output, { recursive: true });
const project = await mkdtemp(join(tmpdir(), 'aih-local-policy-'));
const catalogRoot = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
const inventories = await installedFamilies({ root: catalogRoot });
const superpowers = inventories.find(entry => entry.family === 'Superpowers');
const item = superpowers.release.items.find(candidate => candidate.kind === 'skill' && candidate.name === 'brainstorming');
assert.ok(item, 'Catalog publishes the Superpowers brainstorming skill');

// The organisation document prohibits hooks; once the page has composed the setup it also permits the chosen recipes.
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
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const browser = await chromium.launch({ headless: true });
const facts = { item: item.id, source: 'local' };
const folder = dirname(organizationPath), leaks = [], errors = [], servers = [];
// A Workbench with its own saved setup, so each session starts at first-run setup.
async function startWorkbench(name) {
  const started = await createWorkbench({ consumerDir, runDir: join(consumerDir, 'prototype'), summary, settingsPath: join(project, `${name}-settings.json`) });
  servers.push(started.server);
  return `http://127.0.0.1:${(await listen(started.server, 0)).port}`;
}
// The page's own path: first-run setup as an Enterprise Developer (the rest of the dialog keeps its defaults), then
// the brainstorming skill added from its card. Returns the page and the policy the page's authoring answered with.
async function composeOnPage(origin) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude'));
  const page = await context.newPage(); page.setDefaultTimeout(30_000);
  page.on('pageerror', error => errors.push(error.message));
  const held = { page, context, policy: undefined };
  page.on('response', async response => {
    const text = await response.text().catch(() => '');
    // The file's folder stays on the host: no response the page receives names it.
    if (text.includes(folder)) leaks.push(new URL(response.url()).pathname);
    if (!/\/api\/authoring-(new|edit)$/.test(new URL(response.url()).pathname)) return;
    const value = (() => { try { return JSON.parse(text); } catch { return undefined; } })();
    if (value?.status === 'ok' && Array.isArray(value.value?.policyBytes)) held.policy = JSON.parse(new TextDecoder().decode(Uint8Array.from(value.value.policyBytes)));
  });
  await page.goto(origin + '/');
  await page.locator('#browse-family option[value="Superpowers"]').waitFor({ state: 'attached' });
  await page.locator('#setup-dialog').waitFor();
  await page.getByRole('radio', { name: /Enterprise/ }).check(); await page.locator('#setup-next').click();
  await page.getByRole('radio', { name: /Developer/ }).check();
  for (let step = 0; step < 6 && await page.locator('#setup-dialog').isVisible(); step++) await page.locator('#setup-next').click();
  await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
  await chooseCatalogFamily(page, 'Superpowers');
  await addFromCatalog(page, item.id);
  for (let attempt = 0; attempt < 100 && !held.policy?.selections?.some(selection => selection.item?.itemId === item.id); attempt++) await page.waitForTimeout(100);
  assert.ok(held.policy?.selections?.some(selection => selection.item?.itemId === item.id), 'the page composed a setup holding the picked skill');
  return held;
}
let page;
try {
  // The organisation publishes its permissions first. The page prepares a preview as soon as the setup changes, so
  // a first session takes the same page steps only to learn the exact setup the page composes; it never installs.
  const scouting = await composeOnPage(await startWorkbench('scouting'));
  facts.scoutingMode = scouting.policy.mode;
  await writeFile(join(output, 'page-policy.json'), JSON.stringify(scouting.policy, null, 2) + '\n');
  await scouting.context.close();
  // The organisation permits exactly the recipes that setup renders, by Core's recipe identity.
  for (const selection of inlineRecipelessSelections({ policy: scouting.policy, inventories }).selections) {
    const identity = await deriveRecipeIdentity({ recipe: selection.recipe.inline });
    assert.equal(identity.status, 'ok', JSON.stringify(identity));
    organization.selections.push({ selectionId: selection.organizationSelectionId ?? selection.id, recipeIdentity: identity.value.recipeIdentity, scopes: ['project'],
      obligation: 'permitted', inputs: {}, lifecycle: { replace: true, remove: true } });
  }
  facts.permitted = organization.selections.length - 1;
  await writeFile(organizationPath, JSON.stringify(organization, null, 2) + '\n');
  // The person: dialog, Enterprise, Developer, pick.
  const session = await composeOnPage(await startWorkbench('person'));
  page = session.page;
  facts.mode = session.policy.mode;
  // Review: Your setup's drawer holds the preview; it is ready once Install is offered.
  await openPolicyDrawer(page);
  await page.locator('#install-button:not([disabled])').waitFor({ timeout: 120_000 });
  facts.preview = (await page.locator('#install-review-rows').textContent()).slice(0, 400);
  assert.match(facts.preview, /brainstorming/);
  facts.authoritySource = (await page.locator('#authority-source').textContent().catch(() => ''))?.trim();
  // The organisation changes its policy after the preview.
  await writeFile(organizationPath, JSON.stringify({ ...organization, metadata: { revision: 'changed after preview' } }, null, 2) + '\n');
  await page.locator('#install-button').click();
  await page.locator('#install-message[data-outcome]').waitFor({ timeout: 120_000 });
  facts.outcome = await page.locator('#install-message').getAttribute('data-outcome');
  // Core's sentence exactly, as the contract words it.
  facts.staleMessage = (await page.locator('#install-message').innerText()).trim();
  facts.written = (await readdir(project, { recursive: true })).filter(path => path.startsWith('.claude'));
  assert.equal(facts.staleMessage, STALE_POLICY);
  assert.equal(facts.outcome, 'stale');
  assert.deepEqual(facts.written, [], 'nothing was installed');
  assert.equal(facts.mode, 'enterprise', 'the page\'s Enterprise Developer setup is an Enterprise policy');
  assert.ok(facts.authoritySource.includes(`Policy from ${organizationPath.split(/[\\/]/).pop()}`), facts.authoritySource);
  // Once the fresh preview is back, Core's words are still what the page says.
  await page.locator('#install-button:not([disabled])').waitFor({ timeout: 120_000 }).catch(() => {});
  facts.message = (await page.locator('#install-message').innerText()).trim();
  assert.equal(facts.message, STALE_POLICY);
  assert.deepEqual((await readdir(project, { recursive: true })).filter(path => path.startsWith('.claude')), [], 'nothing was installed');
  assert.deepEqual(errors, []);
  facts.leaks = leaks;
  assert.deepEqual(leaks, [], 'the policy file\'s folder reached the page');
  await page.screenshot({ path: join(output, 'stale-policy.png'), fullPage: true });
  await session.context.close();
  await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'passed', ...facts }, null, 2));
} catch (error) {
  facts.installPanel = await page?.locator('#install-message').innerText().catch(() => undefined);
  await page?.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(join(output, 'failure.json'), JSON.stringify({ status: 'failed', message: error.message, ...facts }, null, 2));
  console.error(JSON.stringify({ status: 'failed', ...facts, written: facts.written?.slice(0, 5), writtenCount: facts.written?.length }));
  throw error;
} finally {
  await browser.close();
  for (const server of servers) { server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose)); }
}
console.log(JSON.stringify({ status: 'passed', ...facts }));
