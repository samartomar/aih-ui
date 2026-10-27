import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openPolicyAdvanced, openPolicyFileActions, openSourceDetails, closePolicyDrawer, openPolicySection } from './policy-drawer.mjs';
async function enter(page, origin, theme, { hasTool = true } = {}) {
  await page.goto(origin + '/');
  await page.locator('#framework-navigation [data-framework]').first().waitFor();
  if (await page.locator('#setup-dialog').isVisible()) {
    await page.getByRole('radio', { name: /Vibe coder/ }).check();
    for (let index = 0; index < 4; index++) await page.locator('#setup-next').click();
    await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
  }
  const toggle = page.getByRole('button', { name: `Switch to ${theme} mode`, exact: true });
  if (await toggle.count()) await toggle.click();
  if (hasTool) await page.waitForFunction(() => document.getElementById('framework-guidance').textContent.includes('Choose content'));
}
async function framework(page, value) {
  await page.locator(`[data-framework="internal:${value.framework.id}:${value.sha256}"]`).click();
  await page.waitForFunction(name => document.querySelector('.wb-source-heading').textContent === name, value.framework.name);
}
async function save(page, path) {
  if (await page.locator('#added-notice-dismiss').isVisible()) await page.locator('#added-notice-dismiss').click();
  await page.locator('#your-setup').click(); await openPolicyAdvanced(page);
  const pending = page.waitForEvent('download'); await page.locator('#policy-save').click();
  await (await pending).saveAs(path); await closePolicyDrawer(page);
  return JSON.parse(await readFile(path, 'utf8'));
}
const intentOf = value => value.records?.find(record => record.intent)?.intent ?? value.metadata['aih.workbench'];
const setChoices = policy => intentOf(policy).provenance.flatMap(source => source.materialSource.workbenchSetChoices?.choices ?? []);
export async function runBrowseBrowser({ origin, output, playwrightModule, expected }) {
  await mkdir(output, { recursive: true }); const { chromium } = await import(playwrightModule); const browser = await chromium.launch({ headless: true });
  const errors = [], outcomes = [];
  try {
    for (const theme of ['dark', 'light']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
      await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude'));
      const page = await context.newPage(); page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message));
      await enter(page, origin, theme);
      const catalog = await (await context.request.get(origin + '/api/authoring-catalog')).json();
      const first = catalog.frameworks.find(row => row.state === 'ready');
      assert.equal(await page.locator('.wb-source-heading').innerText(), first.name, 'Fresh entry uses supported source order');
      assert.match(await page.locator('#framework-navigation').innerText(), /linux|windows|macos|darwin|win32|unknown OS/);
      await framework(page, expected.prepared);
      const basics = expected.prepared.items[0];
      await page.getByRole('button', { name: `Add ${basics.id}`, exact: true }).click();
      await page.getByRole('button', { name: `Remove ${basics.id}`, exact: true }).waitFor();
      await page.getByRole('button', { name: `Remove ${basics.id}`, exact: true }).click();
      await page.getByRole('button', { name: `Add ${basics.id}`, exact: true }).waitFor();
      await page.getByRole('button', { name: `Add ${basics.id}`, exact: true }).click();
      await page.getByRole('button', { name: `Remove ${basics.id}`, exact: true }).waitFor();
      await page.locator('#catalog-search').fill('grill-me'); await framework(page, expected.additional);
      assert.equal(await page.locator('#catalog-search').inputValue(), 'grill-me', 'Framework switching preserves search');
      const grill = expected.additional.grill;
      const card = page.locator(`[data-card-id="${expected.additional.sha256}/${grill.id}"]`);
      await card.getByRole('button', { name: `Add ${grill.id}`, exact: true }).click();
      await card.getByRole('button', { name: `Remove ${grill.id}`, exact: true }).waitFor();
      await card.getByRole('button', { name: `Remove ${grill.id}`, exact: true }).click();
      await card.getByRole('button', { name: `Add ${grill.id}`, exact: true }).waitFor();
      await card.getByRole('button', { name: `Add ${grill.id}`, exact: true }).click();
      await card.getByRole('button', { name: `Remove ${grill.id}`, exact: true }).waitFor();
      assert.equal(await card.locator('[data-fact=state]').filter({ hasText: 'Organization policy' }).count(), 0, 'Personal mode has no organization badge');
      const individual = await save(page, join(output, `${theme}-individual.json`));
      const intent = individual.metadata['aih.workbench'];
      assert.ok(intent.roots.some(root => root.itemId === basics.id), 'The unrelated single-recipe choice remains');
      assert.equal(intent.pins.find(pin => pin.itemId === grill.id).recipe.sha256, grill.recipes['claude-code'].sha256);
      for (const source of intent.provenance) assert.equal(source.materialSource.internalContent.archiveSha256, expected.prepared.archiveSha256);
      await card.click(); await openSourceDetails(page);
      assert.ok(await page.locator('#main-content').evaluate(node => node.getBoundingClientRect().top >= document.querySelector('header').getBoundingClientRect().bottom), 'Opening a long inspector keeps the pane shell in place');
      assert.match(await page.locator('#inspector-browse-facts').innerText(), /mattpocock\/skills/);
      assert.match(await page.locator('#inspector-browse-facts').innerText(), /Chosen by.*aih-extensions/);
      assert.match(await page.locator('#inspector-browse-facts').innerText(), /Comes with/);
      await page.screenshot({ path: join(output, `${theme}-inspector.png`), animations: 'disabled' });
      await page.locator('#close-inspector-btn').click();
      await page.locator('#catalog-filter-disclosure > summary').click(); await page.locator('#catalog-reset-filters').click(); await page.locator('#catalog-filters-close').click();
      assert.equal(await page.locator('.wb-source-heading').innerText(), expected.additional.framework.name, 'Reset keeps framework context');
      await page.waitForFunction(count => document.querySelectorAll('#cards-grid [data-card-id]').length === count, expected.additional.defaults);
      await page.locator('#browse-all-items').check();
      await page.waitForFunction(count => document.querySelectorAll('#cards-grid [data-card-id]').length === count, expected.additional.choosable);
      await page.locator('#browse-all-items').uncheck();
      const addedSets = page.waitForResponse(response => /authoring-(?:draft-edit|edit)$/.test(response.url()));
      await page.locator('[data-add-sets]').click();
      const setResult = await (await addedSets).json();
      if (setResult.status !== 'ok') await writeFile(join(output, `${theme}-sets-refusal.json`), JSON.stringify(setResult, null, 2));
      assert.equal(setResult.status, 'ok', JSON.stringify(setResult.diagnostics));
      await page.waitForFunction(() => document.getElementById('framework-guidance').textContent.includes('Chosen sets added'));
      const setsPolicy = await save(page, join(output, `${theme}-sets.json`));
      assert.deepEqual(setChoices(setsPolicy).map(choice => choice.request), expected.additional.requests);
      assert.ok(setChoices(setsPolicy).every(choice => choice.origins.length));
      assert.ok(setsPolicy.metadata['aih.workbench'].roots.some(root => root.itemId === basics.id));
      await page.screenshot({ path: join(output, `${theme}-extensions.png`), animations: 'disabled' });
      await page.locator('#your-tool-trigger').click(); await page.locator('[data-tool="copilot"]').click();
      await page.locator('#catalog-search').fill('grill-me');
      const unavailable = card.getByRole('button', { name: `Remove ${grill.id}`, exact: true });
      await unavailable.waitFor();
      // Existing choices remain removable; the unsupported new recipe is explained before Add.
      await page.locator('#catalog-search').fill(''); await page.locator('#browse-all-items').check();
      const unavailableCard = page.locator('#cards-grid [data-card-id]').filter({ has: page.locator('button[aria-label^="Add "]:disabled') }).first();
      await unavailableCard.waitFor(); assert.match(await unavailableCard.locator('[data-fact=state]').filter({ hasText: 'Can’t be added yet' }).getAttribute('title'), /No unambiguous Catalog recipe/);
      const unchanged = await save(page, join(output, `${theme}-unavailable-preserved.json`)); assert.deepEqual(unchanged, setsPolicy);
      await page.locator('#your-tool-trigger').click(); await page.locator('[data-tool="claude"]').click();
      await framework(page, expected.ecc);
      await page.locator('#starting-sets .more-sets > summary').click();
      await page.locator(`[data-set-id="${expected.ecc.optionSet.id}"]`).click();
      if (!(await page.locator('#starting-sets .more-sets').evaluate(node => node.open))) await page.locator('#starting-sets .more-sets > summary').click();
      for (const chosen of await page.locator('#starting-sets [data-set-id][aria-pressed=true]').evaluateAll(nodes => nodes.map(node => node.dataset.setId))) if (chosen !== expected.ecc.optionSet.id) {
        const button = page.locator(`#starting-sets [data-set-id="${chosen}"]`);
        if (!(await button.isVisible())) { const more = page.locator('#starting-sets .more-sets'); if (!(await more.evaluate(node => node.open))) await more.locator('> summary').click(); }
        await button.click();
      }
      await page.locator(`#starting-sets input[data-option="${expected.ecc.language.id}"]`).check();
      await page.waitForFunction(ids => {
        const actual = [...document.querySelectorAll('#cards-grid [data-card-id]')].map(node => node.dataset.cardId.split('/')[1]).sort();
        return JSON.stringify(actual) === JSON.stringify(ids.slice().sort());
      }, expected.ecc.visible);
      const addedOptions = page.waitForResponse(response => /authoring-(?:draft-edit|edit)$/.test(response.url()));
      await page.locator('[data-add-sets]').click();
      const optionResult = await (await addedOptions).json();
      assert.ok(optionResult.diagnostics?.some(value => value.code === 'POLICY_BOUND_EXCEEDED'), 'The real large ECC policy keeps its existing executable bound');
      const recordedOptions = page.waitForResponse(response => response.url().endsWith('/api/authoring-draft-edit'));
      await page.locator('#browse-keep-draft').click();
      const recorded = await (await recordedOptions).json();
      if (recorded.status !== 'ok') await writeFile(join(output, `${theme}-options-refusal.json`), JSON.stringify(recorded, null, 2));
      assert.equal(recorded.status, 'ok', JSON.stringify(recorded.diagnostics));
      await page.waitForFunction(() => document.getElementById('framework-guidance').textContent.includes('Chosen sets added'));
      await page.locator('#your-setup').click();
      const downloadOptions = page.waitForEvent('download'); await page.locator('#policy-draft-save').click();
      await (await downloadOptions).saveAs(join(output, `${theme}-options.json`)); await closePolicyDrawer(page);
      const optionsPolicy = JSON.parse(await readFile(join(output, `${theme}-options.json`), 'utf8'));
      assert.equal(optionsPolicy.executable, false);
      assert.deepEqual(setChoices(optionsPolicy).filter(choice => choice.request.release.releaseSha256 === expected.ecc.sha256).map(choice => choice.request), expected.ecc.requests);
      assert.ok(intentOf(optionsPolicy).roots.some(root => root.itemId === basics.id));
      await page.screenshot({ path: join(output, `${theme}-ecc-language.png`), animations: 'disabled' });
      await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: join(output, `${theme}-narrow.png`) });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      outcomes.push({ theme, positiveSingle: basics.id, positivePlural: grill.id, sets: setChoices(setsPolicy).length, language: expected.ecc.language.id });
      await context.close();
    }
    assert.deepEqual(errors, []); await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'passed', outcomes, errors, humanAcceptance: 'pending', scope: 'ordinary running page, public packed fixtures; no installation or native launch' }, null, 2));
  } finally { await browser.close(); }
}
export async function runBrowseReopenBrowser({ origin, output, savedDirectory, playwrightModule, expected }) {
  await mkdir(output, { recursive: true }); const { chromium } = await import(playwrightModule); const browser = await chromium.launch({ headless: true });
  try { for (const theme of ['dark', 'light']) {
    const context = await browser.newContext(); await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude'));
    const page = await context.newPage(); page.setDefaultTimeout(30000); await enter(page, origin, theme);
    await openPolicyFileActions(page); await page.locator('#policy-open').setInputFiles(join(savedDirectory, `${theme}-options.json`));
    await page.locator('#policy-draft-status').filter({ hasText: /Saved draft reopened/i }).waitFor();
    await closePolicyDrawer(page); await framework(page, expected.ecc);
    await page.locator('#your-setup').click(); const reopenedDownload = page.waitForEvent('download'); await page.locator('#policy-draft-save').click();
    await (await reopenedDownload).saveAs(join(output, `${theme}-sets-reopened.json`)); await closePolicyDrawer(page);
    const saved = JSON.parse(await readFile(join(output, `${theme}-sets-reopened.json`), 'utf8'));
    const original = JSON.parse(await readFile(join(savedDirectory, `${theme}-options.json`), 'utf8'));
    assert.deepEqual(intentOf(saved), intentOf(original), 'Fresh host and browser retain exact source, tool recipe, sets/options/origins');
    assert.deepEqual(saved.savedIntent, original.savedIntent, 'The original policy bytes remain exact');
    await framework(page, expected.additional);
    await page.route('**/api/authoring-catalog', async route => { const response = await route.fetch(); const catalog = await response.json(); await route.fulfill({ response, json: { ...catalog, frameworks: catalog.frameworks.filter(row => row.sha256 !== expected.additional.sha256), items: catalog.items.filter(item => item.root.releaseSha256 !== expected.additional.sha256) } }); });
    await page.reload();
    await page.locator('.framework-missing').filter({ hasText: expected.additional.framework.name }).waitFor();
    assert.match(await page.locator('.framework-missing').innerText(), /unavailable.*saved choices are unchanged/);
    assert.notEqual(await page.locator('.wb-source-heading').innerText(), expected.additional.framework.name);
    await page.screenshot({ path: join(output, `${theme}-reopened-missing-framework.png`) }); await context.close();
  } await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'passed', humanAcceptance: 'pending' })); }
  finally { await browser.close(); }
}
export async function runOptionalHookBrowser({ origin, output, playwrightModule, savedDirectory }) {
  await mkdir(output, { recursive: true }); const { chromium } = await import(playwrightModule); const browser = await chromium.launch({ headless: true });
  try { for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } }); await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude'));
    const page = await context.newPage(); page.setDefaultTimeout(30000); await enter(page, origin, theme);
    if (savedDirectory) {
      await openPolicyFileActions(page); await page.locator('#policy-open').setInputFiles(join(savedDirectory, `${theme}-excluded-hook.json`));
      await page.getByRole('button', { name: 'Validate and reopen', exact: true }).click();
      await page.locator('#policy-status').filter({ hasText: 'Saved choices recovered from exact source snapshots.' }).waitFor(); await closePolicyDrawer(page);
      const reopened = await save(page, join(output, `${theme}-reopened-hook.json`));
      assert.deepEqual(reopened, JSON.parse(await readFile(join(savedDirectory, `${theme}-excluded-hook.json`), 'utf8')));
      await context.close(); continue;
    }
    assert.match(await page.locator('#framework-navigation').innerText(), /Test fixture sources/);
    const catalog = await (await context.request.get(origin + '/api/authoring-catalog')).json();
    const fixture = catalog.frameworks.find(row => row.kind === 'fixture' && row.reason?.startsWith('Selection-only public golden') && row.sets?.length);
    const alternate = catalog.frameworks.find(row => row.reason?.startsWith('Distinct checked version'));
    assert.equal(alternate.id, fixture.id); assert.notEqual(alternate.sha256, fixture.sha256);
    await page.locator(`[data-framework="fixture:${alternate.id}:${alternate.sha256}"]`).click(); await page.locator('#browse-all-items').check();
    const unrelated = page.locator('#cards-grid button[aria-label^="Add "]:not(:disabled)').first(); const unrelatedId = (await unrelated.getAttribute('aria-label')).slice(4);
    await unrelated.click(); await page.getByRole('button', { name: `Remove ${unrelatedId}`, exact: true }).waitFor();
    if (await page.locator('#added-notice-dismiss').isVisible()) await page.locator('#added-notice-dismiss').click();
    const set = fixture.sets.find(set => set.members.some(member => member.optional));
    const member = set.members.find(member => member.optional);
    await page.locator(`[data-framework="fixture:${fixture.id}:${fixture.sha256}"]`).click();
    const details = page.locator('#starting-sets .set-members'); await details.locator('> summary').click();
    const tick = details.locator(`input[data-member="${member.item.itemId}"]`);
    assert.equal(await tick.isChecked(), false, 'The published optional hook starts unticked');
    await tick.check().catch(async error => { await page.screenshot({ path: join(output, `${theme}-hook-failed.png`) }); await writeFile(join(output, `${theme}-hook-failed.html`), await page.content()); throw error; }); await page.waitForFunction(id => document.querySelector(`input[data-member="${id}"]`)?.checked, member.item.itemId);
    await page.locator('#starting-sets .set-note').filter({ hasText: 'refused' }).waitFor();
    await tick.uncheck();
    await page.locator('[data-add-sets]').click();
    await page.waitForFunction(() => document.getElementById('framework-guidance').textContent.includes('Chosen sets added'));
    const policy = await save(page, join(output, `${theme}-excluded-hook.json`)); const intent = policy.metadata['aih.workbench'];
    assert.ok(intent.exclusions.some(value => value.itemId === member.item.itemId && value.releaseSha256 === fixture.sha256), 'An exclusion binds the exact selected set release, not the first framework version');
    assert.ok(intent.roots.some(root => root.releaseSha256 === alternate.sha256 && root.itemId === unrelatedId), 'The other version’s unrelated choice remains');
    assert.ok(!intent.pins.some(value => value.itemId === member.item.itemId));
    assert.ok(setChoices(policy).some(choice => choice.request.members.some(value => value.item.itemId === member.item.itemId && value.include === false)));
    await page.screenshot({ path: join(output, `${theme}-optional-hook-fixture.png`) }); await context.close();
  } await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'passed', scope: 'Separate public Catalog optional-hook fixture; not an ECC hook, installation or native run', humanAcceptance: 'pending' })); }
  finally { await browser.close(); }
}

export async function runBrowseFactsBrowser({ origin, output, playwrightModule, expected, specimens, fallbackSpecimen }) {
  await mkdir(output, { recursive: true }); const { chromium } = await import(playwrightModule); const browser = await chromium.launch({ headless: true });
  const outcomes = [], errors = [];
  try { for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
    await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude'));
    const base = await (await context.request.post(origin + '/api/authoring-browse-content', { headers: { origin }, data: { enterprise: true, tool: 'claude', releaseSha256: expected.additional.sha256, sets: expected.additional.requests } })).json();
    assert.equal(base.status, 'read'); let current;
    const fallbackBase = await (await context.request.post(origin + '/api/authoring-browse-content', { headers: { origin }, data: { tool: 'kiro', releaseSha256: expected.fallback.sha256, sets: [] } })).json();
    assert.equal(fallbackSpecimen.releaseSha256, expected.fallback.sha256);

    await context.route('**/api/authoring-browse-content', async route => {
      const body = route.request().postDataJSON();
      if (current?.fallback) {
        if (body.releaseSha256 !== expected.fallback.sha256) return route.continue();
        return route.fulfill({ json: { ...fallbackBase, platform: fallbackSpecimen.platform, compatibility: fallbackSpecimen.compatibility, host: { status: 'unavailable', reason: 'Windows x64 static fixture, not current-host execution.' } } });
      }
      if (!current || body.releaseSha256 !== expected.additional.sha256) return route.continue();
      if (current.boundaryResponse) return route.fulfill({ json: current.boundaryResponse });
      const specimen = structuredClone(base);
      specimen.scans = [{ itemId: expected.additional.grill.id, ...current.result }];
      await route.fulfill({ json: specimen });
    });
    const page = await context.newPage(); page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message));
    await enter(page, origin, theme);
    for (const specimen of specimens) {
      current = specimen; await framework(page, expected.prepared);
      const received = page.waitForResponse(response => response.url().endsWith('/api/authoring-browse-content') && response.request().postDataJSON()?.releaseSha256 === expected.additional.sha256);
      await framework(page, expected.additional); await received; await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      await page.locator('#catalog-search').fill('grill-me');
      const card = page.locator(`[data-card-id="${expected.additional.sha256}/${expected.additional.grill.id}"]`);
      const badge = card.locator(`[data-fact="scan"][data-state="${specimen.result.summary.state}"]`);
      await badge.waitFor();
      assert.ok((await badge.innerText()).trim());
      assert.equal((await card.innerText()).includes('Verified'), specimen.row === 17, 'Only the public positive row uses Verified');
      await page.keyboard.press('Tab'); await badge.focus(); await page.locator('#wb-tooltip:not([hidden])').waitFor();
      assert.match(await page.locator('#wb-tooltip').innerText(), /evidence, not installation authority/);
      await badge.tap(); assert.equal(await page.locator('#wb-tooltip').isVisible(), true);
      if ([1, 9, 17].includes(specimen.row)) await page.screenshot({ path: join(output, `${theme}-scan-row-${specimen.row}.png`) });
      outcomes.push({ theme, row: specimen.row, name: specimen.name, state: specimen.result.summary.state });
    }
    current = { fallback: true };
    await page.locator('#your-tool-trigger').click(); await page.locator('[data-tool="kiro"]').click();
    await framework(page, expected.fallback); await page.locator('#catalog-search').fill(''); await page.locator('#browse-all-items').check();
    const fallback = page.locator('#browse-unsupported'); await fallback.locator('> summary').waitFor(); await fallback.locator('> summary').click();
    await fallback.getByText(new RegExp(`Installed as a ${expected.fallback.kind}`)).waitFor();
    await page.screenshot({ path: join(output, `${theme}-fallback.png`) });
    await page.locator('#your-tool-trigger').click(); await page.locator('[data-tool="claude"]').click();
    current = specimens.at(-1); await framework(page, expected.additional); await page.locator('#catalog-search').fill('grill-me'); await page.locator('#browse-all-items').check();
    const policy = page.locator('#cards-grid [data-fact="state"]').filter({ hasText: 'Organization policy unavailable' }); await policy.first().waitFor();
    for (const state of ['unavailable', 'failed']) {
      current = { boundaryResponse: { status: state, reason: `Controlled ${state} browse fixture` } };
      await framework(page, expected.prepared); await framework(page, expected.additional);
      await page.locator('#cards-grid [data-fact="fit"]').filter({ hasText: `Tool fit ${state}` }).waitFor();
      await page.locator('#starting-sets .set-note').filter({ hasText: `Controlled ${state}` }).waitFor();
      await page.screenshot({ path: join(output, `${theme}-${state}.png`) });
    }
    current = specimens.at(-1); await framework(page, expected.prepared); await framework(page, expected.additional);
    await page.locator('#cards-grid [data-fact="scan"][data-state="verified"]').waitFor();
    // Compute contrast from the actual themed page, including nested backgrounds.
    const contrast = await page.locator('#starting-sets .set-choice, #starting-sets .set-add, .framework-context, .framework-landing, #cards-grid .browse-fact, #cards-grid .browse-fact span').evaluateAll(nodes => {
      const rgb = value => (value.match(/[\d.]+/g) ?? []).map(Number);
      const blend = (fg, bg) => { const alpha = fg[3] ?? 1; return fg.slice(0, 3).map((v, i) => v * alpha + bg[i] * (1 - alpha)); };
      const background = node => { const chain = []; for (let p = node; p; p = p.parentElement) chain.unshift(p); return chain.reduce((color, p) => blend(rgb(getComputedStyle(p).backgroundColor), color), [255,255,255]); };
      const lum = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((a,v,i) => a + v * [.2126,.7152,.0722][i], 0);
      return nodes.filter(n => n.getBoundingClientRect().width && n.innerText.trim()).map(node => { const bg = background(node), fg = blend(rgb(getComputedStyle(node).color), bg); const a = lum(bg), b = lum(fg); return { text: node.innerText, ratio: (Math.max(a,b)+.05)/(Math.min(a,b)+.05) }; });
    });
    assert.ok(contrast.length); assert.deepEqual(contrast.filter(row => row.ratio < 4.5), [], 'New text meets 4.5 contrast in the running page');
    await writeFile(join(output, `${theme}-contrast.json`), JSON.stringify(contrast, null, 2)); await context.close();
  }
  assert.deepEqual(errors, []); await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'passed', outcomes, scope: 'Controlled public Scan decision-table outputs in a clearly marked running fixture page. Fixture authentication is not actual prepared-content authentication. No detector, installation or native usage.', humanAcceptance: 'pending' }, null, 2));
  } finally { await browser.close(); }
}

export async function runSetActionAccessBrowser({ origin, output, playwrightModule, expected }) {
  await mkdir(output, { recursive: true }); const { chromium } = await import(playwrightModule); const browser = await chromium.launch({ headless: true });
  try { for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ hasTouch: true }); const page = await context.newPage(); await enter(page, origin, theme, { hasTool: false }); await framework(page, expected.additional);
    let edits = 0; page.on('request', request => { if (/authoring-(?:draft-edit|edit)$/.test(new URL(request.url()).pathname)) edits++; });
    const add = page.locator('[data-add-sets]'); assert.equal(await add.isDisabled(), false); assert.equal(await add.getAttribute('aria-disabled'), 'true');
    await page.keyboard.press('Tab'); await add.focus(); await page.locator('#wb-tooltip:not([hidden])').waitFor(); assert.match(await page.locator('#wb-tooltip').innerText(), /Choose your tool/);
    await add.tap(); assert.equal(await page.locator('#wb-tooltip').isVisible(), true); await add.click(); assert.equal(edits, 0, 'A focusable unavailable action grants no edit');
    await page.screenshot({ path: join(output, `${theme}-choose-tool-explanation.png`) }); await context.close();
  } await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'passed', humanAcceptance: 'pending' })); } finally { await browser.close(); }
}

export async function runEvidenceRefreshBrowser({ origin, output, playwrightModule, expected, positive }) {
  await mkdir(output, { recursive: true }); const { chromium } = await import(playwrightModule); const browser = await chromium.launch({ headless: true }); const outcomes = [];
  try { for (const theme of ['dark', 'light']) {
    const context = await browser.newContext(); await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude')); let injected = false;
    await context.route('**/api/authoring-browse-content', async route => {
      const body = route.request().postDataJSON();
      if (injected || body.releaseSha256 !== expected.additional.sha256) return route.continue();
      const response = await route.fetch(); const value = await response.json(); value.scans = [{ itemId: expected.additional.grill.id, ...positive.result }]; injected = true;
      await route.fulfill({ response, json: value });
    });
    const page = await context.newPage(); page.setDefaultTimeout(30000); await enter(page, origin, theme); await framework(page, expected.additional); await page.locator('#catalog-search').fill('grill-me');
    const card = page.locator(`[data-card-id="${expected.additional.sha256}/${expected.additional.grill.id}"]`); await card.locator('[data-fact=scan][data-state=verified]').waitFor();
    await openPolicySection(page, 'Evidence review and reconsideration');
    const changed = page.waitForResponse(response => response.url().endsWith('/api/authoring-browse-content') && response.request().postDataJSON().reviewEvidence?.length);
    await page.getByLabel('Review evidence files', { exact: true }).setInputFiles({ name: 'public-other-content-report.json', mimeType: 'application/json', buffer: Buffer.from(positive.evidenceBytes) });
    const changedValue = await (await changed).json(); const changedSummary = changedValue.scans.find(value => value.itemId === expected.additional.grill.id).summary;
    assert.notEqual(changedSummary.state, 'verified', 'The actual backend never inherits controlled fixture authentication');
    await closePolicyDrawer(page); await card.locator(`[data-fact=scan][data-state="${changedSummary.state}"]`).waitFor(); assert.equal(await card.locator('[data-state=verified]').count(), 0, 'Changing supplied evidence invalidates the visible positive summary');
    await openPolicySection(page, 'Evidence review and reconsideration');
    const latest = page.getByRole('region', { name: 'Latest Scan evidence', exact: true });
    await latest.getByLabel('Search evidence subjects', { exact: true }).fill('grill-me'); await latest.getByLabel('Scan content', { exact: true }).selectOption(`${expected.additional.sha256}/${expected.additional.grill.id}`);
    const history = latest.getByLabel('Scan history', { exact: true }); await history.locator('option[value^="scan:sha256:"]').first().waitFor({ state: 'attached' }); const scanId = await history.locator('option[value^="scan:sha256:"]').first().getAttribute('value'); await history.selectOption(scanId);
    const retained = page.waitForResponse(response => response.url().endsWith('/api/authoring-browse-content') && response.request().postDataJSON().reviewEvidenceIds?.includes(scanId));
    await latest.getByRole('button', { name: 'Use this exact assessment for a human review', exact: true }).click();
    const retainedValue = await (await retained).json(); assert.equal(retainedValue.status, 'read'); const retainedSummary = retainedValue.scans.find(value => value.itemId === expected.additional.grill.id).summary;
    assert.equal(retainedSummary.state, changedSummary.state); assert.equal(retainedSummary.why, changedSummary.why, 'Retained assessment IDs resolve to the same original bytes before browsing');
    const unknownClient = await context.request.post(origin + '/api/authoring-browse-content', { headers: { origin }, data: { tool: 'claude', releaseSha256: expected.additional.sha256, reviewEvidenceIds: [scanId] } });
    const refused = await unknownClient.json(); assert.equal(refused.status, 'refused'); assert.equal(refused.diagnostics[0].code, 'EVIDENCE_UNAVAILABLE', 'Another client cannot borrow a retained evidence identity');
    await closePolicyDrawer(page); await card.locator(`[data-fact=scan][data-state="${retainedSummary.state}"]`).waitFor(); await page.screenshot({ path: join(output, `${theme}-refreshed-evidence.png`) });
    outcomes.push({ theme, supplied: changedSummary.state, retained: retainedSummary.state, unknownClientRefused: true }); await context.close();
  } await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'passed', outcomes, scope: 'A labeled public positive summary specimen is replaced through ordinary evidence upload; all later summaries and retained-ID refusals use the actual packed backend, no fixture authentication or native use', humanAcceptance: 'pending' }, null, 2)); } finally { await browser.close(); }
}
