import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installedFamilies } from './installed-families.mjs';

const consumer = dirname(fileURLToPath(import.meta.url));
const pageRoot = join(consumer, '..', 'page');
const catalogRoot = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
const families = await installedFamilies({ root: catalogRoot, sourceInput: 'catalog-controller-browser' });
const eccFamily = families.find(family => family.family === 'ECC');
const extensionsFamily = families.find(family => family.family === 'Extensions');
const portable = (family, item) => ({ ...item, root: { releaseSha256: family.release.sha256, itemId: item.id, itemSha256: item.itemSha256, scope: item.scopes[0], configuration: {}, originIds: ['direct'] }, package: family.release.package, family: family.family, sources: family.release.sources.filter(source => item.sourceIds.includes(source.id)) });
const ecc = portable(eccFamily, eccFamily.release.items.find(item => item.id === 'ecc.skill.accessibility'));
const legacy = portable(extensionsFamily, extensionsFamily.release.items.find(item => item.id === 'extensions.matt.grill-me'));
const framework = {
  id: eccFamily.release.framework.id,
  name: eccFamily.release.framework.name,
  sha256: eccFamily.release.sha256,
  state: 'ready',
  sets: [],
  version: eccFamily.release.framework.version,
};

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/summary.json') {
      response.writeHead(200, { 'content-type': 'application/json' }); response.end('{}'); return;
    }
    if (pathname === '/api/contract-check') {
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ state: 'passed', checks: [] })); return;
    }
    const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    const path = normalize(join(pageRoot, relative));
    if (!path.startsWith(pageRoot + '/')) throw new Error('outside page assets');
    let bytes = await readFile(path);
    if (relative === 'index.html') bytes = Buffer.from(bytes.toString('utf8').replace('<script type="module" src="main.js"></script>', ''));
    response.writeHead(200, { 'content-type': pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : 'text/html' });
    response.end(bytes);
  } catch (error) {
    response.writeHead(404, { 'content-type': 'text/plain' }); response.end(error.message);
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const browser = await chromium.launch({ headless: true });
const errors = [];
const only = process.env.CATALOG_CASE;
let passed = 0;

async function openController() {
  const page = await browser.newPage();
  page.setDefaultTimeout(5_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async ({ items, framework }) => {
    const { createCatalog } = await import('/catalog/controller.js');
    const requests = [], pending = [];
    const authoring = {
      catalog: { frameworks: [framework], items },
      intent: { roots: [{ releaseSha256: framework.sha256, itemId: items[0].id, scope: 'project', configuration: {}, originIds: ['direct'] }], pins: [], provenance: [] },
      bytes: new TextEncoder().encode('{}'),
      evidenceRevision: 0,
      revision: 0,
      folderRevision: 0,
      subscribe(listener) { this.listener = listener; return () => {}; },
      request(operation, body) {
        requests.push({ operation, body });
        if (operation === 'browse-content') return new Promise(resolve => pending.push({ body, resolve }));
        return Promise.resolve({ status: 'ok' });
      },
    };
    const catalog = createCatalog({ authoring, onSummary() {}, onSelectEntry() {} });
    window.ui165Controller = { catalog, authoring, requests, pending };
    catalog.setTool({ id: 'claude', label: 'Claude Code' });
    await catalog.start();
  }, { items: [ecc, legacy], framework });
  await page.waitForFunction(() => window.ui165Controller.pending.length === 1);
  return page;
}

function browseResult(marker) {
  return {
    status: 'read',
    compatibility: { items: [], sets: [], checks: [], pluginRoutes: [{ framework: framework.id, state: 'listed', lines: [marker] }] },
    resolution: { status: 'ok', value: { selections: [] } },
    host: { status: 'unavailable', reason: 'Not requested in this controller fixture.' },
  };
}

async function noFramework() {
  const page = await openController();
  const before = await page.evaluate(() => window.ui165Controller.requests.length);
  await page.locator('#rail-scope-list button').filter({ hasText: 'Extensions' }).evaluate(button => button.click());
  await page.waitForFunction(() => document.getElementById('starting-sets').textContent.includes('Starting sets unavailable: no framework is open.'));
  assert.equal(await page.locator('#framework-plugin-routes').count(), 0, 'old framework routes are invalidated');
  await page.waitForTimeout(75);
  const requests = await page.evaluate(() => window.ui165Controller.requests);
  assert.equal(requests.length, before, 'legacy navigation neither recurses nor starts another framework read');
  assert.ok(requests.every(({ body }) => body.releaseSha256 !== null && body.releaseSha256 !== undefined), 'every read has a framework identity');
  assert.equal(await page.evaluate(() => window.ui165Controller.authoring.intent.roots[0].itemId), ecc.id, 'saved choices survive legacy navigation');
  await page.close();
}

async function folderOrdering() {
  const page = await openController();
  await page.evaluate(() => {
    const { authoring } = window.ui165Controller;
    authoring.folderRevision++;
    authoring.listener();
  });
  await page.waitForFunction(() => window.ui165Controller.pending.length === 2, 'the folder snapshot starts a fresh read');
  await page.evaluate(marker => {
    const { pending } = window.ui165Controller;
    pending[1].resolve(marker);
  }, browseResult('CURRENT_FOLDER_REPLY'));
  await page.locator('#framework-plugin-routes').filter({ hasText: 'CURRENT_FOLDER_REPLY' }).waitFor();
  await page.evaluate(marker => {
    const { pending } = window.ui165Controller;
    pending[0].resolve(marker);
  }, browseResult('STALE_FOLDER_REPLY'));
  await page.waitForTimeout(75);
  const routes = await page.locator('#framework-plugin-routes').textContent();
  assert.match(routes, /CURRENT_FOLDER_REPLY/);
  assert.doesNotMatch(routes, /STALE_FOLDER_REPLY/);
  assert.equal(await page.evaluate(() => window.ui165Controller.requests.filter(({ operation }) => operation === 'browse-content').length), 2);
  await page.close();
}

try {
  if (!only || only === 'no-framework') { await noFramework(); passed++; console.log('✔ no-framework navigation invalidates real DOM facts without recursion'); }
  if (!only || only === 'folder') { await folderOrdering(); passed++; console.log('✔ a late old-folder reply cannot replace current real DOM facts'); }
  assert.deepEqual(errors, []);
  console.log(`catalog-controller browser: pass ${passed} fail 0`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
