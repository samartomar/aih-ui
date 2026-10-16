// Three local phases against one mutable, in-process GitHub fixture.
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pageAssets, serviceAssets } from './server/assets.mjs';
import { buildCss } from './build-css.mjs';
import { createWorkbench } from './server/workbench.mjs';
import { listen } from './server/static.mjs';
import { callService } from './server/service-client.mjs';
import { coreTargetsSummary } from './server/core-targets-summary.mjs';
const [consumerInput, evidenceInput, ...args] = process.argv.slice(2);
if (!consumerInput || !evidenceInput || (args.length && (args.length !== 2 || args[0] !== '--port'))) throw Error('Usage: node tools/check-authority-source.mjs <consumerDir> <evidenceDir> [--port N]');
const port = Number(args[1] ?? 0);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid port');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..'), consumerDir = resolve(consumerInput), output = resolve(evidenceInput);
await mkdir(output, { recursive: true });
const runDir = join(output, 'page');
await buildCss(repo);
for (const [assets, destination] of [[pageAssets(repo), runDir], [serviceAssets(repo), consumerDir]]) {
  for (const asset of assets) { const path = join(destination, asset.to); await mkdir(dirname(path), { recursive: true }); await copyFile(join(repo, asset.from), path); }
}
// The page reads the same package summary the integrated check serves.
const packages = JSON.parse(await readFile(join(consumerDir, 'reviewed-packages.json'), 'utf8'));
const summary = { packages: await Promise.all(packages.map(async item => ({ ...item, packageName: `@aihq/${item.name}`, version: JSON.parse(await readFile(join(consumerDir, `node_modules/@aihq/${item.name}/package.json`), 'utf8')).version }))),
  coreTargets: coreTargetsSummary(callService(consumerDir, { op: 'coreTargets' })) };
const { createGitHubFixture, enterpriseFixture } = await import(pathToFileURL(join(consumerDir, 'consumer/github-fixture.mjs')));
const { openAuthorityPage, refreshAuthority, captureAuthority } = await import(pathToFileURL(join(consumerDir, 'consumer/authority-source-browser.mjs')));
const { chromium } = await import(pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')));
const fixture = createGitHubFixture(), enterprise = await enterpriseFixture();
const envKeys = ['AIH_ORGANIZATION_SOURCE', 'AIH_CONSUMER_PROJECT', 'AIH_CONSUMER_CONTROLS', 'AIH_REVIEW_TRUST', 'AIH_CONSUMER_PREVIOUS_CATALOG'];
const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
const states = [], revisions = [];
let started, browser, context, page;
async function closeServer() {
  if (started) { await new Promise(resolve => started.server.close(resolve)); started = undefined; }
}
async function start(phase) {
  started = await createWorkbench({ consumerDir, runDir, summary, settingsPath: join(output, `${phase}-settings.json`) });
  summary.entryCount = started.catalog.items.length; await writeFile(join(runDir, 'summary.json'), JSON.stringify(summary));
  const address = await listen(started.server, port);
  ({ page, context } = await openAuthorityPage({ browser, origin: `http://127.0.0.1:${address.port}` }));
}
try {
  for (const key of envKeys) delete process.env[key];
  fixture.install(); browser = await chromium.launch({ headless: true });
  await start('not-configured');
  await page.locator('#authority-source[data-state="not-configured"]').waitFor();
  const setup = await page.locator('#authority-source-setup').textContent();
  assert.match(setup, /AIH_ORGANIZATION_SOURCE/); assert.match(setup, /"provider":\s*"github"/);
  assert.equal(fixture.requests.length, 0);
  states.push('not-configured'); await captureAuthority(page, output, 'not-configured');
  await context.close(); await closeServer();
  const sourcePath = join(output, 'organization-source.json'), policyPath = join(output, 'enterprise-policy.json');
  await writeFile(sourcePath, JSON.stringify(fixture.source, null, 2));
  await writeFile(policyPath, enterprise.policyBytes);
  fixture.publish(enterprise.document);
  process.env.AIH_ORGANIZATION_SOURCE = sourcePath;
  process.env.AIH_CONSUMER_PROJECT = await mkdtemp(join(output, 'project-'));
  await start('configured');
  await page.locator('#authority-source[data-state="configured"]').waitFor();
  for (const [id, text] of Object.entries({ provider: 'github', repository: `${fixture.source.repository.owner}/${fixture.source.repository.name}`, path: fixture.source.path, ref: `${fixture.source.revision.kind} ${fixture.source.revision.value}` })) assert.equal((await page.locator(`#authority-source-${id}`).textContent()).trim(), text);
  for (const id of ['commit', 'blob', 'digest', 'retrieved', 'policy']) assert.ok((await page.locator(`#authority-source-${id}`).textContent()).trim(), id);
  await refreshAuthority(page); const current = await refreshAuthority(page);
  await page.locator('#authority-source-change[data-change="unchanged"]').waitFor();
  revisions.push(current.authority); states.push('configured', 'unchanged');
  await captureAuthority(page, output, 'configured');
  await page.locator('#policy-open').setInputFiles(policyPath);
  await page.getByRole('button', { name: 'Validate and reopen', exact: true }).click();
  await page.locator('#policy-status').filter({ hasText: 'Saved choices recovered' }).waitFor();
  await page.getByRole('button', { name: 'Prepare exact effects', exact: true }).click();
  const apply = page.getByRole('button', { name: 'Approve and Apply reviewed effects', exact: true });
  await apply.and(page.locator(':not([disabled])')).waitFor();
  await page.locator('#authority-source-review[data-review="current"]').waitFor(); states.push('current');
  fixture.publish({ ...enterprise.document, metadata: { fixture: 'changed revision' } });
  const changed = await refreshAuthority(page); revisions.push(changed.authority);
  for (const key of ['resolvedCommit', 'blobId', 'contentDigest']) assert.notEqual(changed.authority[key], current.authority[key], key);
  await page.locator('#authority-source-change[data-change="changed"]').waitFor();
  await page.locator('#authority-source-review[data-review="stale"]').waitFor(); assert.equal(await apply.isDisabled(), true);
  states.push('changed', 'stale'); await captureAuthority(page, output, 'changed-revision');
  // A failed read must not clear the stale review it already showed.
  fixture.withdraw(); await page.locator('#authority-source-refresh').click();
  await page.locator('#authority-source[data-state="refused"]').waitFor();
  await page.locator('#authority-source-review[data-review="stale"]').waitFor(); assert.equal(await apply.isDisabled(), true);
  states.push('refused', 'stale');
  assert.ok(fixture.requests.every(path => path.startsWith(`/repos/${fixture.source.repository.owner}/${fixture.source.repository.name}/git/`)));
  await writeFile(join(output, 'summary.json'), JSON.stringify({ states, revisions, fixtureRequests: fixture.requests.length, liveNetwork: false }, null, 2));
  console.log(`Authority source demo passed: ${output}`);
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: error.message, states }, null, 2)); throw error;
} finally {
  await browser?.close(); await closeServer(); fixture.restore();
  for (const key of envKeys) { if (previousEnv[key] === undefined) delete process.env[key]; else process.env[key] = previousEnv[key]; }
}
