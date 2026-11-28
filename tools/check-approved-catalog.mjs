import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { delimiter } from 'node:path';
import { chromium } from 'playwright';

const [preview, previousGuidance] = process.argv.slice(2);
if (!preview || !previousGuidance || !process.env.AIH_APPROVED_CATALOG_CONTENT) {
  throw new Error('Supply the preview URL, the earlier Modern Web Guidance document, and the preview’s AIH_APPROVED_CATALOG_CONTENT.');
}
const pageUrl = new URL('/#intake/individual/content', preview);
const catalogUrl = new URL('/api/authoring-catalog', preview);
const response = await fetch(catalogUrl);
assert.equal(response.status, 200);
const catalog = await response.json();
assert.equal(catalog.state, 'read-only');
assert.deepEqual(catalog.problems, []);
const packagesResponse = await fetch(new URL('/api/packages', preview));
assert.equal(packagesResponse.status, 200);
const { packages } = await packagesResponse.json();
assert.equal(packages.find(pkg => pkg.name === 'scan')?.version, '0.1.0');
const digest = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const configured = await Promise.all(process.env.AIH_APPROVED_CATALOG_CONTENT.split(delimiter).map(digest));
for (const sha256 of configured) assert.ok(catalog.frameworks.some(framework => framework.sha256 === sha256), sha256);
assert.equal(new Set(catalog.items.map(item => item.id)).size, catalog.items.length);

const previousId = await digest(previousGuidance);
const modernGuide = catalog.frameworks.find(framework => framework.frameworkId === 'modern-web-guidance' && framework.category === 'guidance');
assert.ok(modernGuide, 'Catalog publishes the category of Modern Web Guidance');
const oldItem = catalog.items.find(item => item.framework === previousId && item.title === 'chrome-extensions');
const newItem = catalog.items.find(item => item.framework === modernGuide.id && item.title === 'chrome-extensions');
assert.match(oldItem.contentSha256, /^[a-f0-9]{64}$/);
assert.equal(oldItem.contentSha256, newItem.contentSha256);
assert.equal(oldItem.itemId, newItem.itemId);
assert.notEqual(oldItem.id, newItem.id);

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const category = page.getByRole('combobox', { name: 'Category', exact: true });
  const type = page.getByRole('combobox', { name: 'Type', exact: true });
  const framework = page.getByRole('combobox', { name: 'Framework', exact: true });
  const search = page.getByRole('searchbox', { name: 'Search Catalog' });
  const clear = page.getByRole('button', { name: 'Clear filters', exact: true });
  const total = page.getByRole('status').filter({ hasText: /matching items?/ });
  await page.goto(pageUrl.href);
  await framework.locator(`option[value="${modernGuide.id}"]`).waitFor({ state: 'attached' });
  assert.equal(await total.innerText(), `${catalog.items.length} matching items`);
  assert.equal(await category.inputValue(), '');
  assert.equal(await type.inputValue(), '');
  assert.deepEqual(await category.getByRole('option').allTextContents(),
    ['All categories', 'Workflow frameworks', 'Guidance', 'Domain skills', 'AI setups', 'Uncategorized']);

  await category.selectOption('workflow-framework');
  await search.fill('Superpowers');
  await page.getByText('Superpowers · Workflow frameworks · Hook', { exact: true }).waitFor();
  await clear.click();
  await category.selectOption('guidance');
  await type.selectOption('skill');
  await framework.selectOption(modernGuide.id);
  assert.equal(await total.innerText(), '2 matching items');
  await page.getByRole('checkbox', { name: 'chrome-extensions', exact: true }).check();
  await page.getByRole('checkbox', { name: 'modern-web-guidance', exact: true }).waitFor();
  await category.selectOption('ai-setup');
  await page.getByText('No items match these filters.', { exact: true }).waitFor();
  await category.selectOption('guidance');
  assert.equal(await page.getByRole('checkbox', { name: 'chrome-extensions', exact: true }).isChecked(), true);
  await clear.click();
  assert.equal(await total.innerText(), `${catalog.items.length} matching items`);

  await category.selectOption('ai-setup');
  await search.fill('code-review-graph');
  const toolSetup = page.locator('.ix-picker-row').filter({ has: page.getByText('code-review-graph · AI setups · AI setup', { exact: true }) });
  const mcp = page.locator('.ix-picker-row').filter({ hasText: 'code-review-graph · AI setups · MCP server' });
  await toolSetup.getByRole('link', { name: 'Tool Setup', exact: true }).waitFor();
  await mcp.waitFor();
  assert.equal(await mcp.getByRole('link', { name: 'Tool Setup', exact: true }).count(), 0);
  await type.selectOption('mcp');
  assert.equal(await total.innerText(), '1 matching item');
  assert.equal(await toolSetup.count(), 0);
  await type.selectOption('');
  await toolSetup.getByRole('button', { name: 'Inspect', exact: true }).click();
  await page.getByText('Compatibility', { exact: true }).waitFor();
  await toolSetup.getByRole('link', { name: 'Tool Setup', exact: true }).click();
  await page.waitForURL('**/#intake/individual/tools');
  await page.getByRole('heading', { name: 'Tool Setup', exact: true }).waitFor();

  await page.getByRole('link', { name: 'Catalog and your files', exact: true }).click();
  await framework.locator(`option[value="${previousId}"]`).waitFor({ state: 'attached' });
  await category.selectOption('uncategorized');
  await framework.selectOption(previousId);
  await page.getByRole('heading', { name: 'Google Chrome Modern Web Guidance · Uncategorized' }).waitFor();
  await page.getByRole('checkbox', { name: 'chrome-extensions', exact: true }).check();
  await page.getByRole('checkbox', { name: 'modern-web-guidance', exact: true }).check();

  // Model a host restart with the old pin removed, using the normal host's public response for both pins.
  await page.route(catalogUrl.href, route => route.fulfill({ json: {
    ...catalog,
    items: catalog.items.filter(item => item.framework !== previousId),
    frameworks: catalog.frameworks.filter(framework => framework.id !== previousId),
  } }));
  await page.reload();
  await framework.locator(`option[value="${modernGuide.id}"]`).waitFor({ state: 'attached' });
  await page.getByText('Previously chosen items need review', { exact: true }).click();
  await page.getByText(oldItem.id, { exact: true }).waitFor();
  await framework.selectOption(modernGuide.id);
  assert.equal(await page.getByRole('checkbox', { name: 'chrome-extensions', exact: true }).isChecked(), true);
  assert.equal(await page.getByRole('checkbox', { name: 'modern-web-guidance', exact: true }).isChecked(), false);
  await page.getByRole('button', { name: `Remove choice ${oldItem.id}`, exact: true }).click();
  await page.getByText(oldItem.id, { exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('checkbox', { name: 'chrome-extensions', exact: true }).isChecked(), true);
  console.log(`Workbench browser checked ${catalog.frameworks.length} frameworks and ${catalog.items.length} items.`);
  for (const { name, version, sha256 } of packages) console.log(`${name} ${version} · ${sha256}`);
} finally {
  await browser.close();
}
