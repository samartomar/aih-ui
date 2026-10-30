// A Vibe coder's picks, then a switch to Enterprise Developer: the picks were made outside the organisation's policy,
// so the page says so once, prepares and installs nothing from them, and offers a new Enterprise setup that leaves
// them as they were. Real Catalog Superpowers content, a local organisation source, only the page is driven.
// Usage: AIH_CONSUMER_DIR=<packed consumer> PLAYWRIGHT_MODULE=<url> node tools/consumer/enterprise-switch-browser.mjs [evidenceDir]
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installedFamilies } from './installed-families.mjs';
import { addFromCatalog, chooseCatalogFamily, openPolicyDrawer, openPolicyFileActions } from './policy-drawer.mjs';

const NOTICE = "These choices were made outside your organisation's policy. Start a new Enterprise setup to install them under it.";
const START = 'Start a new Enterprise setup';
const consumerDir = resolve(process.env.AIH_CONSUMER_DIR);
const output = resolve(process.argv[2] ?? join(consumerDir, 'enterprise-switch-evidence'));
await mkdir(output, { recursive: true });
const project = await mkdtemp(join(tmpdir(), 'aih-enterprise-switch-'));
const catalogRoot = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
const superpowers = (await installedFamilies({ root: catalogRoot })).find(entry => entry.family === 'Superpowers');
const item = superpowers.release.items.find(candidate => candidate.kind === 'skill' && candidate.name === 'brainstorming');
const other = superpowers.release.items.find(candidate => candidate.kind === 'skill' && candidate.name !== 'brainstorming');
assert.ok(item && other, 'Catalog publishes Superpowers skills');
// The organisation permits nothing; it only has to be configured for Enterprise to mean something.
const organizationPath = join(output, 'organization-policy.json');
await writeFile(organizationPath, JSON.stringify({ schema: 'urn:aihq:core:organization-policy:1.2.0', id: 'local-organization', selections: [
  { selectionId: 'no-hooks', scopes: ['project'], obligation: 'prohibited', content: { kind: 'hook' } }] }, null, 2) + '\n');
const sourcePath = join(output, 'organization-source.json');
await writeFile(sourcePath, JSON.stringify({ provider: 'local', path: organizationPath }));
process.env.AIH_ORGANIZATION_SOURCE = sourcePath;
process.env.AIH_CONSUMER_PROJECT = project;

const repo = resolve(process.env.AIH_REPO ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const { createWorkbench } = await import(pathToFileURL(join(repo, 'tools/server/workbench.mjs')).href);
const { listen } = await import(pathToFileURL(join(repo, 'tools/server/static.mjs')).href);
const summary = JSON.parse(await readFile(join(consumerDir, 'prototype/summary.json'), 'utf8'));
const workbench = await createWorkbench({ consumerDir, runDir: join(consumerDir, 'prototype'), summary, settingsPath: join(project, 'settings.json') });
const origin = `http://127.0.0.1:${(await listen(workbench.server, 0)).port}`;
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const browser = await chromium.launch({ headless: true });
const facts = { item: item.id };
const written = async () => (await readdir(project, { recursive: true })).filter(path => path.startsWith('.claude'));
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude'));
  page = await context.newPage(); page.setDefaultTimeout(30_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  // The policy the page itself holds: the last one its own authoring answered with.
  let policy;
  page.on('response', async response => {
    if (!/\/api\/authoring-(new|edit)$/.test(new URL(response.url()).pathname)) return;
    const value = await response.json().catch(() => undefined);
    if (value?.status === 'ok' && Array.isArray(value.value?.policyBytes)) policy = JSON.parse(new TextDecoder().decode(Uint8Array.from(value.value.policyBytes)));
  });
  await page.goto(origin + '/');
  await page.locator('#browse-family option[value="Superpowers"]').waitFor({ state: 'attached' });
  // First run as a Vibe coder, and one pick, ready to install.
  await page.locator('#setup-dialog').waitFor();
  await page.getByRole('radio', { name: /Vibe coder/ }).check();
  for (let step = 0; step < 6 && await page.locator('#setup-dialog').isVisible(); step++) await page.locator('#setup-next').click();
  await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
  await chooseCatalogFamily(page, 'Superpowers');
  await addFromCatalog(page, item.id);
  await openPolicyDrawer(page);
  await page.locator('#install-button:not([disabled])').waitFor({ timeout: 120_000 });
  const picked = structuredClone(policy);
  facts.pickedMode = picked.mode;
  // Settings → Change mode… → Enterprise Developer.
  await page.locator('#policy-review-panel-title').press('Escape');
  await page.locator('#org-modal-trigger').click();
  await page.locator('#workbench-mode-trigger').click();
  await page.locator('input[name="workbench-mode"][value="developer"]').check();
  await page.locator('#workbench-mode-save').click();
  await page.locator('#workbench-mode-dialog').waitFor({ state: 'hidden' });
  // Give a page without the notice the time to settle, then read what a person sees.
  await page.locator('#enterprise-setup-notice').waitFor({ timeout: 10_000 }).catch(() => {});
  facts.noticeShown = await page.locator('#enterprise-setup-notice').isVisible().catch(() => false);
  facts.noticeCount = (await page.locator('body').innerText()).split(NOTICE).length - 1;
  await openPolicyDrawer(page);
  facts.installOffered = await page.locator('#install-button').isEnabled();
  if (facts.installOffered) {
    // Without the fix the earlier preview is still offered; Install shows what happens to the vibe picks.
    await page.locator('#install-button').click();
    await page.locator('#install-message[data-outcome]').waitFor({ timeout: 120_000 }).catch(() => {});
    facts.installMessage = (await page.locator('#install-message').innerText()).trim();
  }
  facts.writtenAfterSwitch = await written();
  // Another pick is refused, and the setup still holds only the earlier one.
  const before = JSON.stringify(policy);
  await page.locator('#policy-review-panel-title').press('Escape');
  await page.locator('#cards-grid').getByRole('button', { name: `Add ${other.id}`, exact: true }).click();
  await page.waitForTimeout(2_000);
  facts.secondPickChanged = JSON.stringify(policy) !== before;
  assert.equal(facts.pickedMode, 'vibe');
  assert.equal(facts.noticeShown, true, 'the page shows the notice after the switch');
  assert.equal(facts.noticeCount, 1, 'the notice is shown once');
  assert.equal((await page.locator('#enterprise-setup-notice').innerText()).replace(/\s+/g, ' ').trim(), `${NOTICE} ${START}`);
  assert.equal(facts.installOffered, false, 'Install is not offered');
  assert.deepEqual(facts.writtenAfterSwitch, [], 'nothing was installed');
  assert.equal(facts.secondPickChanged, false, 'a pick under the mismatched policy is refused');
  await page.screenshot({ path: join(output, 'notice.png') });
  // A new Enterprise setup: empty, in Enterprise mode, and the notice is gone. The earlier picks were not moved into it.
  await page.getByRole('button', { name: START, exact: true }).click();
  await page.locator('#enterprise-setup-notice').waitFor({ state: 'hidden' });
  facts.newMode = policy.mode;
  facts.newSelections = policy.selections.length;
  assert.equal(facts.newMode, 'enterprise');
  assert.equal(facts.newSelections, 0, 'the earlier picks are not carried over');
  await openPolicyFileActions(page);
  assert.equal(await page.locator('#policy-review-panel').getByRole('button', { name: 'Download original artifact', exact: true }).isEnabled(), true, 'the earlier policy stays downloadable');
  assert.deepEqual(await written(), []);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(output, 'new-enterprise-setup.png') });
  await context.close();
  await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'passed', ...facts }, null, 2));
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {});
  const failure = { status: 'failed', message: error.message, ...facts, writtenAfterSwitch: facts.writtenAfterSwitch?.slice(0, 5), writtenCount: facts.writtenAfterSwitch?.length };
  await writeFile(join(output, 'failure.json'), JSON.stringify(failure, null, 2));
  console.error(JSON.stringify(failure));
  throw error;
} finally {
  await browser.close();
  workbench.server.closeAllConnections();
  await new Promise(resolveClose => workbench.server.close(resolveClose));
}
console.log(JSON.stringify({ status: 'passed', ...facts }));
