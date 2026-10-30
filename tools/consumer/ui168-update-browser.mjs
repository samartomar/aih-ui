import assert from 'node:assert/strict';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { addFromCatalog, chooseCatalogFamily, openPolicyDrawer } from './policy-drawer.mjs';

export async function noteInventory(variant = 'current') {
  const { fileURLToPath } = await import('node:url');
  const { compileProducerDeclaration, compileTransitionRelease } = await import('@aihq/catalog/producer');
  const { readReleaseContent } = await import('@aihq/catalog/reader');
  const { digestBytes } = await import('./primitives.mjs');
  const { installedFamilies } = await import('./installed-families.mjs');
  const { NOTE_SOURCE_REVISION } = await import('./note-fixture.mjs');
  const declaration = JSON.parse(await readFile(fileURLToPath(import.meta.resolve('@aihq/catalog/fixtures/producer-declaration-3.2.0-valid.json')), 'utf8'));
  const inventory = (await installedFamilies()).find(entry => entry.family === 'Extensions');
  const sourceItem = inventory.release.items.find(item => item.id === 'extensions.notices');
  const item = structuredClone(declaration.items[0]);
  Object.assign(item, { id: 'extensions.notices', source: 'notes', label: 'Review note', description: 'An independently authored review note.', requires: [], recipePath: 'recipe.json',
    materials: [{ id: 'license', path: 'LICENSE' }, { id: 'asset-1', path: 'NOTICE.md' }], kind: 'skill', payload: { dirName: 'notes', invocation: 'model-allowed', invocationBasis: 'default' } });
  Object.assign(declaration, { package: { name: 'review-notes-catalog', version: variant === 'updated' ? '1.0.1' : '1.0.0' },
    framework: { id: 'extensions', name: 'Extensions', version: '1.0.0', description: 'Checked lifecycle fixture content.' },
    sources: [{ id: 'notes', repository: 'example/review-notes', licensePath: 'LICENSE', license: 'MIT' }], items: [item] });
  const recipe = JSON.parse(new TextDecoder().decode(inventory.materials.find(material => material.sha256 === sourceItem.recipe.sha256).bytes));
  recipe.id = item.id;
  recipe.operations = recipe.operations.filter(operation => ['write-license', 'write-asset-1'].includes(operation.id));
  recipe.checks = recipe.checks.filter(check => ['check-license', 'check-asset-1'].includes(check.id));
  recipe.materials = [];
  for (const check of recipe.checks) check.sha256 = { materialSha256: check.id === 'check-license' ? 'license' : 'asset-1' };
  const files = {};
  for (const descriptor of sourceItem.materials.filter(material => ['license', 'asset-1'].includes(material.id))) {
    const path = descriptor.id === 'license' ? 'LICENSE' : 'NOTICE.md';
    let bytes = inventory.materials.find(material => material.sha256 === descriptor.sha256).bytes;
    if (variant === 'updated' && descriptor.id === 'asset-1') bytes = new TextEncoder().encode(`${new TextDecoder().decode(bytes)}\nAn explicit updated note snapshot.\n`);
    files[path] = bytes;
  }
  files['recipe.json'] = new TextEncoder().encode(JSON.stringify(recipe));
  const declarationBytes = new TextEncoder().encode(JSON.stringify(declaration));
  const snapshot = { declarationBytes, sourceFiles: [{ source: 'notes', revision: NOTE_SOURCE_REVISION, files }] };
  const input = { id: `ui168-${variant}`, kind: 'local', locator: { input: `ui168-${variant}` }, resolvedIdentity: { sha256: await digestBytes(declarationBytes) } };
  const compiled = compileProducerDeclaration({ declaration, sourceFiles: snapshot.sourceFiles });
  assert.equal(compiled.status, 'ok', JSON.stringify(compiled.diagnostics));
  const checked = readReleaseContent(compiled.value.releaseBytes, { expectedSha256: compiled.value.releaseSha256 });
  assert.equal(checked.valid, true, JSON.stringify(checked.diagnostics));
  const transitioned = compileTransitionRelease({ releases: { [checked.release.sha256]: checked.release }, earlier: [checked.release.sha256], framework: declaration.framework, package: declaration.package,
    items: [{ id: item.id, kind: item.kind, role: 'choosable', copies: [{ releaseSha256: checked.release.sha256, itemId: item.id }] }] });
  assert.equal(transitioned.status, 'ok', JSON.stringify(transitioned.diagnostics));
  const release = readReleaseContent(transitioned.value.releaseBytes, { expectedSha256: transitioned.value.releaseSha256 });
  assert.equal(release.valid, true, JSON.stringify(release.diagnostics));
  const materials = [...new Map([...compiled.value.materials, ...transitioned.value.materials].map(material => [material.path, material])).values()];
  return { family: 'Independent', release: release.release, materialSource: { kind: 'local', input: input.id }, input: { ...input, releaseSha256: release.release.sha256 }, materials, declarationBytes };
}

async function openPage(browser, origin, theme) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude'));
  const page = await context.newPage(); page.setDefaultTimeout(30_000);
  await page.goto(origin + '/');
  await page.locator('#browse-family option[value="Independent"]').waitFor({ state: 'attached' });
  if (await page.locator('#setup-dialog').isVisible()) {
    await page.getByRole('radio', { name: /Vibe coder/ }).check();
    for (let step = 0; step < 4; step++) await page.locator('#setup-next').click();
  }
  const destination = theme === 'light' ? 'Switch to light mode' : 'Switch to dark mode';
  if (await page.getByRole('button', { name: destination, exact: true }).count()) await page.getByRole('button', { name: destination, exact: true }).first().click();
  return { context, page };
}

export async function runUi168UpdateInstallBrowser({ origin, output, playwrightModule, theme = 'dark' }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const { context, page } = await openPage(browser, origin, theme);
    const preparations = [];
    page.on('response', response => { if (response.url().endsWith('/api/authoring-prepare')) void response.json().then(value => preparations.push(value)).catch(() => {}); });
    await chooseCatalogFamily(page, 'Independent');
    await addFromCatalog(page, 'extensions.notices');
    await openPolicyDrawer(page);
    await page.locator('#install-button').waitFor();
    assert.equal(await page.locator('#install-button').isEnabled(), true, `${await page.locator('#install-message').innerText()} ${JSON.stringify(preparations)}`);
    await page.locator('#install-button').click();
    await page.locator('#install-message[data-outcome="installed"]').waitFor({ timeout: 120_000 });
    await context.close();
    return { status: 'passed' };
  } finally { await browser.close(); }
}

export async function runUi168UpdateVerifyBrowser({ origin, output, project, playwrightModule, theme = 'dark', edited = false, operationState = undefined }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    if (edited) await appendFile(join(project, '.aih-extensions', 'notices', 'NOTICE.md'), '\nLocal edit must survive.\n');
    const { context, page } = await openPage(browser, origin, theme);
    const applies = [];
    page.on('response', response => { if (/\/api\/authoring-apply(-status)?$/.test(response.url())) void response.json().then(value => { if (value.status !== 'running') applies.push(value); }).catch(() => {}); });
    await openPolicyDrawer(page);
    const installed = page.locator('[data-installed-other]').filter({ hasText: 'Review note' }).first();
    await installed.waitFor();
    await installed.locator('[data-installed-state="update-available"]').waitFor();
    if (operationState === 'loading') await page.route('**/api/authoring-update', async route => { await new Promise(done => setTimeout(done, 500)); await route.continue(); });
    if (operationState === 'unavailable') await page.route('**/api/authoring-update', route => route.fulfill({ json: { disposition: 'unavailable', diagnostics: [{ message: 'Update unavailable fixture' }] } }));
    if (operationState === 'failed') await page.route('**/api/authoring-update', route => route.abort());
    await installed.getByRole('button', { name: 'Update', exact: true }).click();
    if (operationState === 'loading') await page.locator('#installed-message').filter({ hasText: 'Checking the replacement…' }).waitFor();
    if (operationState === 'unavailable') {
      await page.locator('#installed-message').filter({ hasText: 'Update cannot go ahead: Update unavailable fixture. Nothing was updated.' }).waitFor();
      await writeFile(join(output, `update-unavailable-${theme}.json`), JSON.stringify({ status: 'passed', state: operationState }, null, 2));
      return { status: 'passed' };
    }
    if (operationState === 'failed') {
      await page.locator('#installed-message').filter({ hasText: 'Update did not start:' }).waitFor();
      await writeFile(join(output, `update-failed-${theme}.json`), JSON.stringify({ status: 'passed', state: operationState }, null, 2));
      return { status: 'passed' };
    }
    const preview = installed.locator('[data-update-preview]');
    await preview.waitFor();
    assert.match(await preview.innerText(), /replacement/i);
    if (edited) assert.match(await preview.innerText(), /conflict[\s\S]*managed-content-changed/i);
    await installed.getByRole('button', { name: 'Confirm update', exact: true }).click();
    await page.locator('#installed-message[data-outcome="updated"], #installed-message[data-outcome="failed"]').waitFor({ timeout: 120_000 });
    assert.equal(await page.locator('#installed-message').getAttribute('data-outcome'), 'updated', `${await page.locator('#installed-message').innerText()} ${JSON.stringify(applies)}`);
    assert.match(await page.locator('#installed-message').innerText(), /Review note:[\s\S]*(updated|unchanged|kept)/);
    const note = await readFile(join(project, '.aih-extensions', 'notices', 'NOTICE.md'), 'utf8');
    if (edited) assert.match(note, /Local edit must survive\./);
    else assert.match(note, /An explicit updated note snapshot\./);
    await page.screenshot({ path: join(output, `update-${theme}-${edited ? 'edited' : 'clean'}.png`), fullPage: true });
    await writeFile(join(output, `update-${theme}-${edited ? 'edited' : 'clean'}.json`), JSON.stringify({ status: 'passed', edited, message: await page.locator('#installed-message').innerText() }, null, 2));
    await context.close();
    return { status: 'passed' };
  } finally { await browser.close(); }
}
