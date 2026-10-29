// The installed list and "Remove this set" read back from Core alone, in a fresh browser session after a real
// Workbench install of real Catalog sets. Expectations come from the page's own Catalog and Core answers (the
// catalog and managed-inventory responses it receives), never from hand-built fixtures; every count is exact and an
// empty expectation fails.
import assert from 'node:assert/strict';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chooseCatalogFamily, openPolicyDrawer } from './policy-drawer.mjs';

async function openPage(context, origin, theme, errors) {
  const page = await context.newPage(); page.setDefaultTimeout(60_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/');
  await page.locator('#browse-family option[value="Extensions"]').waitFor({ state: 'attached' });
  if (await page.locator('#setup-dialog').isVisible()) {
    await page.getByRole('radio', { name: /Vibe coder/ }).check();
    for (let step = 0; step < 4; step++) await page.locator('#setup-next').click();
    await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
  }
  const destination = theme === 'light' ? 'Switch to light mode' : 'Switch to dark mode';
  if (await page.getByRole('button', { name: destination, exact: true }).count()) await page.getByRole('button', { name: destination, exact: true }).first().click();
  return page;
}

// The page's own answers: the Catalog it browses and the latest Core inventory it was given.
function recordAnswers(page) {
  const answers = { catalog: undefined, inventory: undefined };
  page.on('response', async response => {
    const operation = response.url().match(/\/api\/authoring-(catalog|managed)$/)?.[1];
    if (!operation) return;
    // A response the page itself could not read (a superseded or aborted request) is no answer.
    const body = await response.json().catch(() => undefined);
    if (operation === 'catalog' && body?.items) answers.catalog = body; else if (operation === 'managed' && body?.selections) answers.inventory = body;
  });
  return answers;
}

async function newContext(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude'));
  return context;
}

// Chooses exactly these starting sets of one framework through the set picker, adds them and installs.
async function installSets(page, family, setIds) {
  await chooseCatalogFamily(page, family);
  const more = page.locator('#starting-sets details > summary').filter({ hasText: /More sets/ });
  if (await more.count() && !await more.first().evaluate(node => node.parentElement.open)) await more.first().click();
  const choices = page.locator('#starting-sets [data-set-id]');
  await choices.first().waitFor();
  for (const id of await choices.evaluateAll(nodes => nodes.map(node => node.dataset.setId))) {
    const choice = page.locator(`#starting-sets [data-set-id="${id}"]`);
    if ((await choice.getAttribute('aria-pressed') === 'true') !== setIds.includes(id)) await choice.click();
  }
  for (const id of setIds) assert.equal(await page.locator(`#starting-sets [data-set-id="${id}"]`).getAttribute('aria-pressed'), 'true', `set ${id} is chosen`);
  await page.locator('[data-add-sets]').click();
  await page.waitForFunction(() => document.getElementById('framework-guidance').textContent.includes('Chosen sets added'));
  await openPolicyDrawer(page);
  await page.locator('#install-button:not([disabled])').waitFor({ timeout: 180_000 });
  await page.locator('#install-button').click();
  await page.locator('#install-message[data-outcome]').waitFor({ timeout: 240_000 });
  assert.equal(await page.locator('#install-message').getAttribute('data-outcome'), 'installed', await page.locator('#install-message').innerText());
}

// A fresh session: nothing of the installing session's draft is open, so the list can only come from Core.
async function freshInstalledList(browser, origin, theme, errors) {
  const context = await newContext(browser);
  const page = await openPage(context, origin, theme, errors);
  const answers = recordAnswers(page);
  await page.reload();
  await page.locator('#browse-family option[value="Extensions"]').waitFor({ state: 'attached' });
  await openPolicyDrawer(page);
  await page.waitForFunction(() => { const note = document.getElementById('installed-note'); return note && !/Checking what is installed/.test(note.textContent) && document.querySelectorAll('#installed-list li').length > 0; }, undefined, { timeout: 120_000 });
  for (let attempt = 0; attempt < 100 && (!answers.catalog || !answers.inventory); attempt++) await page.waitForTimeout(100);
  assert.ok(answers.catalog?.items?.length, 'the page received its Catalog');
  assert.ok(answers.inventory?.selections?.length, 'the page received a non-empty Core inventory');
  return { context, page, answers };
}

const catalogItem = (catalog, itemId) => catalog.items.find(item => item.id === itemId);
// Catalog display.name (1.7 publishes it as `name`), with a rule's or skill's namespace in brackets.
const displayName = item => { const name = item.display?.name ?? item.name; const namespace = item.namespace ?? item.payload?.namespace; return namespace ? `${name} [${namespace}]` : name; };
const setName = (catalog, set) => catalog.frameworks.flatMap(framework => framework.id === set.framework ? framework.sets ?? [] : [])
  .find(candidate => candidate.id === set.setId && (candidate.setSha256 === undefined || candidate.setSha256 === set.setSha256))?.name;
const setOrigins = selection => (selection.origins ?? []).filter(origin => origin.reasonIncluded === 'in-set' && origin.set).map(origin => origin.set);
const lines = text => text.split('\n').map(line => line.trim()).filter(Boolean);

export async function runInstalledListTruthBrowser({ origin, output, project, playwrightModule, theme = 'dark' }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const installing = await newContext(browser);
    await installSets(await openPage(installing, origin, theme, errors), 'Superpowers', ['superpowers']);
    await installing.close();
    const { page, answers: before } = await freshInstalledList(browser, origin, theme, errors);
    // One installed file is edited by hand, as a person might; Core then reports it changed.
    const edited = before.inventory.selections.find(selection => selection.kind === 'skill' && setOrigins(selection).length);
    assert.ok(edited, 'Core lists an installed skill from the set');
    const skillFile = edited.members.map(member => member.path).find(path => /SKILL\.md$/.test(path));
    assert.ok(skillFile && existsSync(skillFile) && skillFile.startsWith(project), 'the edited file is in the project');
    await appendFile(skillFile, '\nEdited by hand after install.\n');
    const answers = recordAnswers(page);
    await page.reload();
    await page.locator('#browse-family option[value="Extensions"]').waitFor({ state: 'attached' });
    await openPolicyDrawer(page);
    await page.waitForFunction(() => document.querySelectorAll('#installed-list li').length > 0 && !/Checking what is installed/.test(document.getElementById('installed-note').textContent), undefined, { timeout: 120_000 });
    for (let attempt = 0; attempt < 100 && (!answers.catalog || !answers.inventory); attempt++) await page.waitForTimeout(100);
    const { catalog, inventory } = answers;
    const panel = await page.locator('#installed-panel').innerText();
    const shown = lines(panel);
    const selections = inventory.selections;
    // Exact counts: Core lists the set's chosen members plus what they need, and the set as Catalog publishes it.
    const set = setOrigins(selections.find(selection => setOrigins(selection).length))[0];
    const offered = catalog.frameworks.find(framework => framework.id === set.framework)?.sets?.find(candidate => candidate.id === set.setId);
    assert.ok(offered?.members?.length, 'Catalog publishes the installed set and its members');
    const inSet = selections.filter(selection => setOrigins(selection).some(value => value.setId === set.setId));
    assert.ok(inSet.length > 0 && inSet.length <= offered.members.length, `Core lists ${inSet.length} installed members of the ${offered.members.length}-member set`);
    assert.deepEqual(inSet.map(selection => selection.item.itemId).filter(id => !offered.members.some(member => member.item.itemId === id)), [], 'every in-set item is a Catalog member of the set');

    assert.doesNotMatch(panel, /Not in your setup/, 'a fresh session shows what Core installed, not a comparison with an empty draft');
    assert.equal(shown.filter(line => line === 'Installed').length, 0, 'no bare per-row "Installed"');
    assert.doesNotMatch(panel, /exact set [0-9a-f]{64}/, 'the set is named, not shown as a digest');
    const name = setName(catalog, set);
    assert.ok(name, 'Catalog names the installed set');
    assert.equal(shown.filter(line => line === name).length, 1, `one heading for the set the user picked, "${name}"`);
    assert.equal(await page.getByRole('button', { name: `Remove this set: ${name}`, exact: true }).count(), 1, '"Remove this set" for the installed set');
    // Each Core selection is one row, under its Catalog display name.
    for (const selection of selections) {
      const item = catalogItem(catalog, selection.item.itemId);
      assert.ok(item, `Catalog publishes ${selection.item.itemId}`);
      const expected = displayName(item);
      assert.equal(shown.filter(line => line === expected).length, 1, `one row named "${expected}" for ${selection.managementId}\n${panel}`);
      assert.doesNotMatch(panel, new RegExp(`^${selection.item.itemId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'), 'no bare item id as a name');
    }
    assert.equal(await page.locator('[data-installed-row]').count(), selections.length, `exactly ${selections.length} installed rows`);
    for (const selection of inSet) {
      const row = page.locator(`[data-installed-row="${selection.managementId}"]`);
      assert.match(await row.innerText(), new RegExp(`From set ${name}`), `${selection.name} names its origin as the Catalog set "${name}"`);
    }
    // Core's file state in contract wording; the untouched rows say nothing they cannot back.
    const editedRow = page.locator(`[data-installed-row="${edited.managementId}"]`);
    assert.match(await editedRow.innerText(), /Changed since install \(your tool already uses the changed copy\)/, 'changed file state in contract wording');
    const changed = selections.filter(selection => selection.members.some(member => member.fileState === 'changed'));
    assert.deepEqual(changed.map(selection => selection.managementId), [edited.managementId], 'Core reports exactly the edited selection changed');
    assert.equal(shown.filter(line => /^Changed since install/.test(line)).length, 1, 'exactly one changed row');
    await page.screenshot({ path: join(output, `installed-list-${theme}.png`), fullPage: true });
    await writeFile(join(output, `installed-list-${theme}.json`), JSON.stringify({ status: 'passed', rows: selections.length, set: { ...set, name }, inSet: inSet.length, panel, errors }, null, 2));
    assert.deepEqual(errors, []);
    return { status: 'passed' };
  } finally { await browser.close(); }
}

export async function runSetRemovalTruthBrowser({ origin, output, project, playwrightModule, theme = 'dark' }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    // Two real overlapping Extensions sets: Misc and Extensions specialists share one Catalog member.
    const installing = await newContext(browser);
    await installSets(await openPage(installing, origin, theme, errors), 'Extensions', ['extensions.template.specialists', 'misc']);
    await installing.close();
    const { page, answers } = await freshInstalledList(browser, origin, theme, errors);
    const { catalog } = answers, before = answers.inventory.selections;
    const extensions = catalog.frameworks.find(framework => framework.id === 'extensions' && framework.sets?.some(set => set.id === 'misc'));
    const misc = extensions.sets.find(set => set.id === 'misc'), specialists = extensions.sets.find(set => set.id === 'extensions.template.specialists');
    const miscIds = new Set(misc.members.map(member => member.item.itemId)), specialistIds = new Set(specialists.members.map(member => member.item.itemId));
    const shared = [...miscIds].filter(id => specialistIds.has(id));
    assert.equal(shared.length, 1, 'Catalog publishes exactly one member in both sets');
    const inMisc = before.filter(selection => setOrigins(selection).some(set => set.setId === 'misc'));
    assert.equal(inMisc.length, miscIds.size, `Core lists all ${miscIds.size} Misc members installed`);
    // What removing Misc must take: its members no other set or direct choice owns, and what only they need.
    const owned = selection => (selection.origins ?? []).filter(origin => origin.reasonIncluded !== 'required-by');
    const onlyMisc = before.filter(selection => owned(selection).length && owned(selection).every(origin => origin.reasonIncluded === 'in-set' && origin.set?.setId === 'misc'));
    const onlyMiscItems = new Set(onlyMisc.map(selection => selection.item.itemId));
    const needed = before.filter(selection => !owned(selection).length && selection.origins.every(origin => onlyMiscItems.has(origin.requiredBy?.itemId)));
    const removed = [...onlyMisc, ...needed];
    assert.equal(onlyMisc.length, miscIds.size - shared.length, `exactly ${miscIds.size - shared.length} Misc members belong to Misc alone`);
    const keptSelection = before.find(selection => selection.item.itemId === shared[0]);
    assert.ok(keptSelection, 'the shared member is installed');

    const listed = answers.inventory;
    const calls = [];
    page.on('request', request => { if (/\/api\/authoring-(remove|apply)$/.test(request.url())) calls.push(request.url().split('authoring-')[1]); });
    await page.getByRole('button', { name: `Remove this set: ${misc.name}`, exact: true }).click();
    const section = page.locator('[data-installed-set]').filter({ has: page.getByRole('button', { name: `Remove this set: ${misc.name}`, exact: true }) });
    await section.getByRole('button', { name: 'Confirm remove', exact: true }).waitFor({ timeout: 120_000 });
    const review = await section.innerText();
    assert.match(review, new RegExp(`${displayName(catalogItem(catalog, shared[0]))}: Kept; also part of ${specialists.name}`), `the shared member is kept for "${specialists.name}"\n${review}`);
    await section.getByRole('button', { name: 'Confirm remove', exact: true }).click();
    const message = page.locator('#installed-message[data-outcome]');
    await message.waitFor({ timeout: 240_000 });
    const result = await message.innerText();
    assert.equal(await message.getAttribute('data-outcome'), 'removed', result);
    assert.deepEqual(calls, ['remove', 'apply'], 'one reviewed removal preview and one Apply');
    assert.doesNotMatch(result, /unverified|project--|user--|absent/i, `outcomes in contract wording, without management ids\n${result}`);
    for (const selection of removed) assert.match(result, new RegExp(`${displayName(catalogItem(catalog, selection.item.itemId))}: Removed`), `${selection.name} reported removed`);
    assert.match(result, new RegExp(`${displayName(catalogItem(catalog, shared[0]))}: Kept; also part of ${specialists.name}`), 'the kept member is reported in contract wording');

    // Core confirms: exactly the Misc-only selections are gone, their files absent, the shared one kept for specialists.
    for (let attempt = 0; attempt < 600 && answers.inventory === listed; attempt++) await page.waitForTimeout(100);
    assert.notEqual(answers.inventory, listed, 'the list was read again from Core after the removal');
    const after = answers.inventory;
    const afterIds = new Set(after.selections.map(selection => selection.managementId));
    assert.deepEqual(removed.filter(selection => afterIds.has(selection.managementId)).map(selection => selection.managementId), [], 'every removed selection is gone from Core');
    assert.equal(after.selections.length, before.length - removed.length, `exactly ${removed.length} selections removed`);
    const keptAfter = after.selections.find(selection => selection.managementId === keptSelection.managementId);
    assert.deepEqual(setOrigins(keptAfter).map(set => set.setId), ['extensions.template.specialists'], 'the shared member keeps only its other set');
    const gone = removed.flatMap(selection => selection.members.map(member => member.path)).filter(path => path.startsWith(project) && existsSync(path));
    assert.deepEqual(gone, [], 'every removed file is absent on disk');
    assert.equal(await page.getByRole('button', { name: `Remove this set: ${misc.name}`, exact: true }).count(), 0, 'Misc is no longer listed');
    await page.screenshot({ path: join(output, `set-removal-${theme}.png`), fullPage: true });
    await writeFile(join(output, `set-removal-${theme}.json`), JSON.stringify({ status: 'passed', removed: removed.length, kept: shared, review, result, calls, errors }, null, 2));
    assert.deepEqual(errors, []);
    return { status: 'passed' };
  } finally { await browser.close(); }
}
