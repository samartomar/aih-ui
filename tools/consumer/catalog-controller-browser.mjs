import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installedFamilies } from './installed-families.mjs';

const consumer = dirname(fileURLToPath(import.meta.url));
const pageRoot = join(consumer, '..', 'page');
// The journey clicks the real page as it is laid out; without its built Tailwind the page is unstyled and controls fall
// outside the viewport, so a missing stylesheet is named here rather than as a click timeout.
assert.ok(existsSync(join(pageRoot, 'styles', 'tailwind.css')), 'The page has no built styles/tailwind.css; build it before copying the page.');
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

async function openController(options = {}) {
  const page = await browser.newPage();
  page.setDefaultTimeout(5_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async ({ items, framework, options }) => {
    const { createCatalog } = await import('/catalog/controller.js');
    const requests = [], pending = [], approvalRequests = [], proposals = [];
    const scope = options.scope ?? 'project';
    const authoring = {
      catalog: { frameworks: [framework], items },
      intent: { roots: [{ releaseSha256: framework.sha256, itemId: items[0].id, scope, configuration: {}, originIds: ['direct'] }], pins: [], provenance: [] },
      bytes: new TextEncoder().encode(options.policy ?? '{}'),
      evidenceRevision: 0,
      revision: 0,
      folderRevision: 0,
      subscribe(listener) { this.listener = listener; return () => {}; },
      request(operation, body) {
        requests.push({ operation, body });
        if (operation === 'browse-content') return new Promise(resolve => pending.push({ body, resolve }));
        return Promise.resolve({ status: 'ok' });
      },
      propose(edit) { return new Promise(resolve => proposals.push({ edit, resolve })); },
      recordApproval(operation) { approvalRequests.push(operation); return Promise.resolve(options.approvalResult ?? { status: 'ok' }); },
    };
    const catalog = createCatalog({ authoring, onSummary() {}, onSelectEntry() {} });
    window.ui165Controller = { catalog, authoring, requests, pending, approvalRequests, proposals };
    catalog.setTool(options.tool ?? { id: 'claude', label: 'Claude Code' });
    await catalog.start();
  }, { items: options.items ?? [ecc, legacy], framework: options.framework ?? framework, options });
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

// A set Add says it is working until the host answers, and a second press meanwhile does nothing. The More sets list
// closes on a pointer anywhere else and on Escape, so it never stays over the Add button.
async function setAdd() {
  const page = await openController({ framework: { ...framework, sets: eccFamily.release.sets } });
  const sets = page.locator('#starting-sets'), guidance = page.locator('#framework-guidance');
  await sets.locator('.more-sets > summary').click();
  assert.equal(await sets.locator('.more-sets').evaluate(node => node.open), true);
  await page.locator('#framework-guidance').dispatchEvent('pointerdown');
  assert.equal(await sets.locator('.more-sets').evaluate(node => node.open), false, 'a pointer elsewhere closes More sets');
  await sets.locator('.more-sets > summary').click();
  await page.keyboard.press('Escape');
  assert.equal(await sets.locator('.more-sets').evaluate(node => node.open), false, 'Escape closes More sets');
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'SUMMARY', 'focus returns to its summary');
  await sets.locator('.more-sets > summary').click();
  await sets.locator('.more-sets [data-set-id]').first().click();
  assert.equal(await sets.locator('.more-sets').evaluate(node => node.open), true, 'choosing a set inside the list keeps it open');
  const add = sets.locator('[data-add-sets]');
  await add.click();
  await guidance.filter({ hasText: 'Adding chosen sets…' }).waitFor();
  assert.equal(await add.getAttribute('aria-busy'), 'true');
  assert.equal(await add.getAttribute('aria-disabled'), 'true');
  await add.click({ force: true });
  assert.equal(await page.evaluate(() => window.ui165Controller.proposals.length), 1, 'a second press while adding does nothing');
  await page.evaluate(() => window.ui165Controller.proposals[0].resolve({ status: 'ok', diagnostics: [] }));
  await guidance.filter({ hasText: 'Chosen sets added.' }).waitFor();
  assert.equal(await add.getAttribute('aria-busy'), null);
  assert.equal(await add.getAttribute('aria-disabled'), null);
  // A failed Add clears the working state too, and says why.
  await add.click();
  await guidance.filter({ hasText: 'Adding chosen sets…' }).waitFor();
  await page.evaluate(() => window.ui165Controller.proposals[1].resolve({ status: 'refused', diagnostics: [{ code: 'INPUT_INVALID', message: 'Exact set refusal.' }] }));
  await guidance.filter({ hasText: 'Exact set refusal.' }).waitFor();
  assert.equal(await add.getAttribute('aria-busy'), null);
  await page.close();
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

async function setupChoices() {
  const page = await browser.newPage(); page.setDefaultTimeout(5_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64);
  const item = (releaseSha256, id, label) => ({ id, label, kind: 'skill', root: { releaseSha256 } });
  const source = (members, exclusions = [], scope = 'user') => ({
    roots: [], pins: [], exclusions, origins: [{ id: 'set-origin', kind: 'set' }],
    provenance: [{ materialSource: { workbenchSetChoices: { choices: [{ originId: 'set-origin', request: {
      release: { releaseSha256: A, scope }, setId: 'starter', setSha256: 'exact-set-digest', members,
    } }] } } }],
  });
  await page.evaluate(async () => {
    const [{ createSetupChoices }, { el }] = await Promise.all([import('/app/setup-choices.js'), import('/app/dom.js')]);
    window.renderLeftOut = ({ source, items, frameworks }) => {
      document.body.replaceChildren();
      const client = { intent: source, catalog: { items, frameworks }, bytes: new TextEncoder().encode('{}'), candidate: undefined, draft: undefined };
      const view = createSetupChoices({ client, el, button: (label, action) => {
        const node = el('button', '', label); node.type = 'button'; node.addEventListener('click', action); return node;
      } });
      document.body.append(view.node); view.render();
      return [...document.querySelectorAll('[data-left-out-item]')].map(row => ({ id: row.dataset.leftOutItem, text: row.textContent }));
    };
  });
  const frameworks = [{ id: 'ecc', sha256: A }, { id: 'extensions', sha256: B }];
  const members = [{ item: { framework: 'extensions', itemId: 'shared' }, include: false }];
  const items = [item(A, 'shared', 'Wrong set release label'), item(B, 'shared', 'Actual member label')];
  const rows = await page.evaluate(({ source, items, frameworks }) => window.renderLeftOut({ source, items, frameworks }), { source: source(members), items, frameworks });
  assert.equal(rows.length, 1, 'a false-only saved request renders its left-out member');
  assert.match(rows[0].text, /Actual member label/);
  assert.match(rows[0].text, /\(your folders\)/);
  assert.match(rows[0].text, /\[extensions\]/);
  assert.doesNotMatch(rows[0].text, /Wrong set release label/);

  const ambiguous = await page.evaluate(({ source, items, frameworks }) => window.renderLeftOut({ source, items, frameworks }), {
    source: source(members), items: [...items, item(C, 'shared', 'Ambiguous other release')], frameworks: [...frameworks, { id: 'extensions', sha256: C }],
  });
  assert.equal(ambiguous.length, 1);
  assert.match(ambiguous[0].text, /extensions\/shared/);
  assert.doesNotMatch(ambiguous[0].text, /Actual member label|Ambiguous other release|Wrong set release label/);

  const sameFramework = await page.evaluate(({ source, items, frameworks }) => window.renderLeftOut({ source, items, frameworks }), {
    source: source([{ item: { framework: 'ecc', itemId: 'same' }, include: false }], [], 'project'),
    items: [item(A, 'same', 'Same framework')], frameworks,
  });
  assert.equal(sameFramework.length, 1);
  assert.doesNotMatch(sameFramework[0].text, /\[ecc\]/);
  assert.doesNotMatch(sameFramework[0].text, /your folders/);

  const duplicate = await page.evaluate(({ source, items, frameworks }) => window.renderLeftOut({ source, items, frameworks }), {
    source: source([{ item: { framework: 'ecc', itemId: 'same' }, include: false }], [{ originId: 'set-origin', releaseSha256: A, itemId: 'same', scope: 'project', reason: 'Recorded reason' }], 'project'),
    items: [item(A, 'same', 'Same framework')], frameworks,
  });
  assert.equal(duplicate.length, 1, 'the exclusion and false member render once');
  assert.match(duplicate[0].text, /Recorded reason/);
  await page.close();
}

async function installedStates() {
  const page = await browser.newPage(); page.setDefaultTimeout(5_000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const [{ createInstalledPanel }, { el }] = await Promise.all([import('/app/installed-panel.js'), import('/app/dom.js')]);
    const set = { framework: 'ecc', setId: 'alpha', setSha256: 'a'.repeat(64) };
    const policy = { selections: [
      { id: 'root', managementId: 'm-1', scope: 'project', requires: ['dep'], recipe: { reference: { sha256: 'r-1' } } },
      { id: 'dep', managementId: 'm-2', scope: 'project', requires: [], recipe: { reference: { sha256: 'r-2' } } },
    ] };
    const intent = { roots: [{ itemId: 'one' }], pins: [{ itemId: 'one', recipe: { sha256: 'r-1' } }, { itemId: 'two', recipe: { sha256: 'r-2' } }] };
    const inventory = { status: 'complete', selections: [
      { managementId: 'm-1', name: 'One', origins: [{ reasonIncluded: 'in-set', set }], members: [{ fileState: 'matches' }], updateState: 'current' },
      { managementId: 'm-2', name: 'Two', origins: [{ reasonIncluded: 'in-set', set }], members: [{ fileState: 'block-changed' }], updateState: 'superseded' },
    ] };
    const client = { catalog: { executionAvailable: true, items: [] }, requestCurrent: async () => inventory, intent, bytes: new TextEncoder().encode(JSON.stringify(policy)) };
    const panel = createInstalledPanel({ client, el, button: (label, action) => { const node = el('button', '', label); node.type = 'button'; node.addEventListener('click', action); return node; } });
    document.body.append(panel.node); await panel.refresh();
  });
  const needed = page.locator('[data-installed-needed="m-2"]'); await needed.waitFor({ state: 'attached' });
  await page.locator('[data-installed-item="one"] details summary').click(); await needed.waitFor();
  assert.equal(await needed.locator('[data-installed-state="superseded"]').count(), 1);
  assert.equal(await needed.locator('[data-installed-state="block-changed"]').count(), 1);
  const reference = page.locator('[data-set-reference="m-2"]');
  assert.equal(await reference.locator('[data-installed-state="superseded"]').count(), 1);
  assert.equal(await reference.locator('[data-installed-state="block-changed"]').count(), 1);
  assert.equal(await reference.getByRole('button', { name: 'Remove', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Remove', exact: true }).count(), 1, 'only the chosen root owns a Remove control');
  await page.close();
}

function installReview(targets, digest = 'digest') {
  return { target: { project: '/work/app' }, reviewDigest: digest, operations: targets.map((target, index) => ({
    id: `write-${index}`, kind: 'file.write', effects: 'create-file', purpose: `Write ${target}`, details: { target },
  })) };
}

async function previewQueue() {
  const page = await browser.newPage(); page.setDefaultTimeout(5_000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async review => {
    const [{ createInstallPanel }, { el }] = await Promise.all([import('/app/install-panel.js'), import('/app/dom.js')]);
    const pending = [];
    const client = {
      catalog: { executionAvailable: true, items: [] }, intent: { roots: [{ itemId: 'one' }], pins: [] }, bytes: new TextEncoder().encode('A'),
      requestHost(operation) {
        if (operation !== 'prepare') throw new Error('No Apply expected while queueing a preview');
        return new Promise(resolve => pending.push({ operation, resolve }));
      },
    };
    const panel = createInstallPanel({ client, el, button: (label, action) => { const node = el('button', '', label); node.type = 'button'; node.addEventListener('click', action); return node; } });
    document.body.append(panel.node); window.installPreview = { client, panel, pending, review };
    panel.render(); client.bytes = new TextEncoder().encode('B'); panel.render();
  }, installReview(['/work/app/inside.md', '/work/app-backup/settings.json', '/Work/App/case.md'], 'B'));
  await page.evaluate(() => window.installPreview.pending[0].resolve({ status: 'superseded' }));
  await page.waitForFunction(() => window.installPreview.pending.length === 2, 'a changed snapshot queues a fresh Prepare');
  await page.evaluate(() => {
    const { pending, review } = window.installPreview;
    pending[1].resolve({ status: 'ready', sessionId: 'session-B', review, operationSelections: [] });
  });
  await page.locator('#install-button:not([disabled])').waitFor();
  const files = await page.locator('#install-files').textContent();
  assert.match(files, /inside\.md/);
  assert.match(files, /\/work\/app-backup\/settings\.json/, 'a sibling prefix remains an absolute target');
  assert.match(files, /\/Work\/App\/case\.md/, 'POSIX case difference remains an absolute target');
  await page.close();
}

async function staleInstall() {
  const page = await browser.newPage(); page.setDefaultTimeout(5_000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async review => {
    const [{ createInstallPanel }, { el }] = await Promise.all([import('/app/install-panel.js'), import('/app/dom.js')]);
    let prepares = 0;
    const client = {
      catalog: { executionAvailable: true, items: [] }, intent: { roots: [{ itemId: 'one' }], pins: [] }, bytes: new TextEncoder().encode('A'),
      async requestHost(operation) {
        if (operation === 'apply') return { status: 'refused', diagnostics: [{ code: 'REVIEW_STALE', message: 'Original stale reason.' }] };
        prepares += 1;
        if (prepares === 1) return { status: 'ready', sessionId: 'held', review, operationSelections: [] };
        return { status: 'partial', diagnostics: [{ code: 'DISK_CONFLICT', message: 'Fresh disk conflict.' }] };
      },
    };
    const panel = createInstallPanel({ client, el, button: (label, action) => { const node = el('button', '', label); node.type = 'button'; node.addEventListener('click', action); return node; } });
    document.body.append(panel.node); panel.render();
  }, installReview(['/work/app/inside.md']));
  await page.locator('#install-button:not([disabled])').waitFor(); await page.locator('#install-button').click();
  const message = page.locator('#install-message');
  await message.filter({ hasText: /Fresh disk conflict/ }).waitFor();
  assert.match(await message.textContent(), /Original stale reason/);
  await page.close();
}

function approvalBrowseResult(item) {
  return {
    status: 'read', approvalShape: 'config',
    compatibility: { items: [{ item: { framework: framework.id, itemId: item.id }, support: 'supported', permissionStep: 'Allow this server.', reason: 'Harness approval fixture.' }], sets: [], checks: [], pluginRoutes: [] },
    resolution: { status: 'ok', value: { selections: [] } }, host: { status: 'unavailable', reason: 'Not requested.' },
  };
}

async function approvalIdentity() {
  const mcp = portable(eccFamily, eccFamily.release.items.find(item => item.kind === 'mcp-server'));
  const policy = JSON.stringify({ selections: [{ item: { framework: framework.id, itemId: mcp.id }, scope: 'project', tool: 'claude', recipe: { inline: { operations: [{ id: 'approve-server' }] } } }] });
  const open = async (options = {}) => {
    const page = await openController({ items: [mcp], policy, ...options });
    await page.evaluate(result => window.ui165Controller.pending[0].resolve(result), approvalBrowseResult(mcp));
    const box = page.locator('#cards-grid .browse-mcp-approval input'); await box.waitFor(); return { page, box };
  };
  const exact = await open(); assert.equal(await exact.box.isChecked(), true, 'the exact item/scope/tool approval is checked'); await exact.page.close();
  const foreign = await open({ tool: { id: 'other', label: 'Other Tool' } });
  assert.equal(await foreign.box.isChecked(), false, 'another tool never inherits the tick'); await foreign.page.close();
  const userItem = { ...mcp, root: { ...mcp.root, scope: 'user' } };
  const user = await openController({ items: [userItem], policy, scope: 'user', approvalResult: { status: 'refused', diagnostics: [{ message: 'exact approval refusal' }] } });
  await user.evaluate(result => window.ui165Controller.pending[0].resolve(result), approvalBrowseResult(userItem));
  const box = user.locator('#cards-grid .browse-mcp-approval input'); await box.waitFor();
  assert.equal(await box.isChecked(), false, 'another scope never inherits the tick');
  await box.click();
  await user.locator('#cards-grid [data-approval-error]').filter({ hasText: 'exact approval refusal' }).waitFor();
  assert.equal(await box.isChecked(), false, 'a refused grant restores the recorded unticked state');
  assert.equal(await box.isEnabled(), true);
  assert.equal(await user.evaluate(() => window.ui165Controller.approvalRequests[0].root.scope), 'user');
  await user.close();
}

async function approvalFailure() {
  const mcp = portable(eccFamily, eccFamily.release.items.find(item => item.kind === 'mcp-server'));
  const page = await browser.newPage(); page.setDefaultTimeout(5_000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async ({ item, browse }) => {
    const { renderBrowseFacts } = await import('/catalog/browse-facts.js');
    window.renderApproval = approved => {
      document.body.replaceChildren();
      const node = renderBrowseFacts(item, browse, { id: 'claude', label: 'Claude Code' }, { approved,
        onApprove: () => Promise.reject(new Error(approved ? 'exact revoke refusal' : 'exact grant refusal')) });
      document.body.append(node);
    };
  }, { item: mcp, browse: approvalBrowseResult(mcp) });
  await page.evaluate(() => window.renderApproval(false));
  const grant = page.locator('.browse-mcp-approval input'); await grant.click();
  await page.locator('[data-approval-error]').filter({ hasText: 'exact grant refusal' }).waitFor();
  assert.equal(await grant.isChecked(), false); assert.equal(await grant.isEnabled(), true);
  await page.evaluate(() => window.renderApproval(true));
  const revoke = page.locator('.browse-mcp-approval input'); await revoke.click();
  await page.locator('[data-approval-error]').filter({ hasText: 'exact revoke refusal' }).waitFor();
  assert.equal(await revoke.isChecked(), true, 'a refused revoke restores the recorded tick'); assert.equal(await revoke.isEnabled(), true);
  await page.close();
}

try {
  if (!only || only === 'no-framework') { await noFramework(); passed++; console.log('✔ no-framework navigation invalidates real DOM facts without recursion'); }
  if (!only || only === 'folder') { await folderOrdering(); passed++; console.log('✔ a late old-folder reply cannot replace current real DOM facts'); }
  if (!only || only === 'setup-choices') { await setupChoices(); passed++; console.log('✔ left-out rows preserve real member identity, scope and deduplication'); }
  if (!only || only === 'installed-states') { await installedStates(); passed++; console.log('✔ folded installed members keep their state badges without duplicate actions'); }
  if (!only || only === 'preview-queue') { await previewQueue(); passed++; console.log('✔ a changed snapshot queues a fresh preview with truthful paths'); }
  if (!only || only === 'stale-install') { await staleInstall(); passed++; console.log('✔ Install keeps stale and fresh preparation reasons together'); }
  if (!only || only === 'approval-identity') { await approvalIdentity(); passed++; console.log('✔ approval ticks bind exact item, scope and tool'); }
  if (!only || only === 'set-add') { await setAdd(); passed++; console.log('✔ set Add shows it is working, ignores a second press, and More sets closes on a pointer elsewhere or Escape'); }
  if (!only || only === 'approval-failure') { await approvalFailure(); passed++; console.log('✔ approval failures restore ticks and show exact reasons'); }
  assert.deepEqual(errors, []);
  console.log(`catalog-controller browser: pass ${passed} fail 0`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
