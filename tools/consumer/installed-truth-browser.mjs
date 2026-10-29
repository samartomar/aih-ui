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
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const count = (text, pattern) => (text.match(new RegExp(pattern, 'g')) ?? []).length;
// Sentences this page used to make up; the contract has none of them (workbench-reads, "Your setup").
const INVENTED = [/From set /, /Also in set/, /Replaced by a newer item/, /Missing since install/, /your own choices/, /still needed by/, /Couldn't confirm it's kept/, /: Removed\b/, /: Restored\b/];

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
    // Exact counts: the set was added with its default ticks, so Core lists exactly Catalog's default-on members
    // in the set, plus what they need.
    const set = setOrigins(selections.find(selection => setOrigins(selection).length))[0];
    const offered = catalog.frameworks.find(framework => framework.id === set.framework)?.sets?.find(candidate => candidate.id === set.setId);
    const expectedMembers = (offered?.members ?? []).filter(member => member.defaultOn).map(member => member.item.itemId).sort();
    assert.ok(expectedMembers.length > 0, 'Catalog publishes default-on members for the installed set');
    const inSet = selections.filter(selection => setOrigins(selection).some(value => value.setId === set.setId));
    assert.deepEqual(inSet.map(selection => selection.item.itemId).sort(), expectedMembers, `Core lists exactly the set's ${expectedMembers.length} default-on members`);

    assert.doesNotMatch(panel, /Not in your setup/, 'a fresh session shows what Core installed, not a comparison with an empty draft');
    for (const pattern of INVENTED) assert.doesNotMatch(panel, pattern, `no sentence outside the contract (${pattern})`);
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
      assert.doesNotMatch(panel, new RegExp(`^${escape(selection.item.itemId)}$`, 'm'), 'no bare item id as a name');
    }
    assert.equal(await page.locator('[data-installed-row]').count(), selections.length, `exactly ${selections.length} installed rows`);
    // The origin is the set the user picked: every in-set row sits under that set's Catalog name.
    const section = page.locator(`[data-installed-set="${set.setId}/${set.setSha256}"]`);
    assert.equal(await section.locator('> div > p').first().innerText(), name, 'the set section is headed by its Catalog name');
    for (const selection of inSet) assert.equal(await section.locator(`[data-installed-row="${selection.managementId}"]`).count(), 1, `${selection.name} is listed under "${name}"`);
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

// Two real overlapping Extensions sets, Misc and Extensions specialists, share one Catalog member. Removing Misc must take Misc's own members and what only they need,
// and keep the shared member for the other set. Expectations come from Catalog's sets and Core's required-by records,
// so the "Remove this set" control is exercised before anything about recorded set ownership is checked.
async function runSetRemoval({ origin, output, project, playwrightModule, theme }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [], label = 'set-removal';
  const sharedId = 'extensions.skill.setup-pre-commit';
  try {
    const installing = await newContext(browser);
    await installSets(await openPage(installing, origin, theme, errors), 'Extensions', ['extensions.template.specialists', 'misc']);
    await installing.close();
    const { page, answers } = await freshInstalledList(browser, origin, theme, errors);
    const { catalog } = answers, before = answers.inventory.selections;
    const extensions = catalog.frameworks.find(framework => framework.id === 'extensions' && framework.sets?.some(set => set.id === 'misc'));
    const misc = extensions.sets.find(set => set.id === 'misc'), specialists = extensions.sets.find(set => set.id === 'extensions.template.specialists');
    const miscIds = misc.members.map(member => member.item.itemId), specialistIds = new Set(specialists.members.map(member => member.item.itemId));
    const shared = miscIds.filter(id => specialistIds.has(id));
    assert.deepEqual(shared, [sharedId], 'Catalog publishes exactly one member in both sets');
    const byItem = id => before.find(selection => selection.item.itemId === id && selection.scope === 'project');
    for (const id of miscIds) assert.ok(byItem(id), `Core lists Misc member ${id} installed`);
    // Misc's own members leave, and then whatever Core records as required only by selections that leave.
    const leaving = new Set(miscIds.filter(id => !specialistIds.has(id)).map(id => byItem(id).managementId));
    for (let grew = true; grew;) {
      grew = false;
      for (const selection of before) {
        if (leaving.has(selection.managementId) || !selection.origins?.length) continue;
        if (selection.origins.every(origin => origin.reasonIncluded === 'required-by' && leaving.has(before.find(candidate => candidate.scope === selection.scope && candidate.item.itemId === origin.requiredBy?.itemId)?.managementId))) { leaving.add(selection.managementId); grew = true; }
      }
    }
    const removed = before.filter(selection => leaving.has(selection.managementId));
    assert.ok(removed.length >= miscIds.length - shared.length, 'Misc has members of its own to remove');
    const keptSelection = byItem(sharedId);
    const nameOf = selection => displayName(catalogItem(catalog, selection.item.itemId));
    const expectedRemoved = removed.map(selection => `${nameOf(selection)}: removed`).sort();
    const expectedKept = [`${nameOf(keptSelection)}: Kept; also part of ${specialists.name}`];

    const listed = answers.inventory;
    const calls = [];
    page.on('request', request => { if (/\/api\/authoring-(remove|apply)$/.test(request.url())) calls.push(request.url().split('authoring-')[1]); });
    // The set's own control: the button in the Misc section's heading row.
    const section = page.locator(`[data-installed-set^="misc/"]`);
    assert.equal(await section.count(), 1, 'Misc is listed as an installed set');
    const control = section.locator('> div').first().getByRole('button').first();
    const controlName = await control.getAttribute('aria-label') ?? await control.innerText();
    await control.click();
    await section.getByRole('button', { name: 'Confirm remove', exact: true }).waitFor({ timeout: 120_000 });
    const review = await section.innerText();
    // Exactly the kept member, named with the other set, and one reviewed step for each member that leaves.
    assert.deepEqual(lines(review).filter(line => /^[^:]+: Kept; /.test(line)), expectedKept, `review keeps exactly the shared member\n${review}`);
    assert.equal(lines(review).filter(line => /^[^:]+: \d+ members are reviewed for removal\.$/.test(line)).length, removed.length, `review removes exactly ${removed.length} items\n${review}`);
    await section.getByRole('button', { name: 'Confirm remove', exact: true }).click();
    const message = page.locator('#installed-message[data-outcome]');
    await message.waitFor({ timeout: 240_000 });
    const result = await message.innerText();
    assert.equal(await message.getAttribute('data-outcome'), 'removed', result);
    assert.deepEqual(calls, ['remove', 'apply'], 'one reviewed removal preview and one Apply');
    for (const pattern of INVENTED) assert.doesNotMatch(result, pattern, `no sentence outside the contract (${pattern})\n${result}`);
    assert.doesNotMatch(result, /unverified|project--|user--|absent/i, `outcomes without management ids or "unverified"\n${result}`);
    // Exact outcome lines: each expected one once, and nothing else.
    for (const line of [...expectedRemoved, ...expectedKept]) assert.equal(count(result, escape(line)), 1, `"${line}" reported once\n${result}`);
    assert.equal(count(result, ': removed') + count(result, ': Kept; '), expectedRemoved.length + expectedKept.length, `only the expected outcomes\n${result}`);
    assert.equal(controlName, `Remove this set: ${misc.name}`, 'the control is "Remove this set", named for the set');

    // Core confirms: exactly those selections are gone, their files absent, the shared one kept for its other owners.
    for (let attempt = 0; attempt < 600 && answers.inventory === listed; attempt++) await page.waitForTimeout(100);
    assert.notEqual(answers.inventory, listed, 'the list was read again from Core after the removal');
    const after = answers.inventory;
    const afterIds = new Set(after.selections.map(selection => selection.managementId));
    assert.deepEqual(removed.filter(selection => afterIds.has(selection.managementId)).map(selection => selection.managementId), [], 'every removed selection is gone from Core');
    assert.equal(after.selections.length, before.length - removed.length, `exactly ${removed.length} selections removed`);
    const ownersAfter = after.selections.find(selection => selection.managementId === keptSelection.managementId).origins
      .filter(origin => origin.reasonIncluded !== 'required-by').map(origin => origin.set?.setId ?? origin.reasonIncluded).sort();
    assert.deepEqual(ownersAfter, ['extensions.template.specialists'], 'the shared member keeps exactly its other set');
    const gone = removed.flatMap(selection => selection.members.map(member => member.path)).filter(path => path.startsWith(project) && existsSync(path));
    assert.deepEqual(gone, [], 'every removed file is absent on disk');
    assert.equal(await page.locator(`[data-installed-set^="misc/"]`).count(), 0, 'Misc is no longer listed');
    await page.screenshot({ path: join(output, `${label}-${theme}.png`), fullPage: true });
    await writeFile(join(output, `${label}-${theme}.json`), JSON.stringify({ status: 'passed', removed: expectedRemoved, kept: expectedKept, review, result, calls, errors }, null, 2));
    assert.deepEqual(errors, []);
    return { status: 'passed' };
  } finally { await browser.close(); }
}

export const runSetRemovalTruthBrowser = options => runSetRemoval({ theme: 'dark', ...options });
