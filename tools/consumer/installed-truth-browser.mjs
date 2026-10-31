// The installed list and "Remove this set" read back from Core alone, in a fresh browser session after a real
// Workbench install of real Catalog sets. Expectations come from the page's own Catalog and Core answers (the
// catalog and managed-inventory responses it receives), never from hand-built fixtures; every count is exact and an
// empty expectation fails.
import assert from 'node:assert/strict';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
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
    for (let step = 0; step < 3; step++) await page.locator('#setup-next').click();
    await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
  }
  const destination = theme === 'light' ? 'Switch to light mode' : 'Switch to dark mode';
  if (await page.getByRole('button', { name: destination, exact: true }).count()) await page.getByRole('button', { name: destination, exact: true }).first().click();
  return page;
}

// The page's own answers: the Catalog it browses and the latest Core inventory it was given.
function recordAnswers(page) {
  const answers = { catalog: undefined, inventory: undefined, removal: undefined };
  page.on('response', async response => {
    const operation = response.url().match(/\/api\/authoring-(catalog|managed|remove)$/)?.[1];
    if (!operation) return;
    // A response the page itself could not read (a superseded or aborted request) is no answer.
    const body = await response.json().catch(() => undefined);
    if (operation === 'catalog' && body?.items) answers.catalog = body; else if (operation === 'managed' && body?.selections) answers.inventory = body;
    else if (operation === 'remove' && body?.removals) answers.removal = body;
  });
  return answers;
}

async function newContext(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => localStorage.setItem('wb-your-tool', 'claude'));
  return context;
}

// The framework guidance before Add answers: the prompt the page shows with and without a chosen tool, and what it says
// while the host is adding the sets (controller.js).
const GUIDANCE_PROMPTS = ['Choose content below.', 'Choose your tools in the header', 'Adding chosen sets'];

// Chooses exactly these starting sets of one framework through the set picker, adds them and installs. Add's answer
// replaces the guidance prompt, as long as Core takes (the same 600 s as the other Add waits); anything but "Chosen sets
// added" fails with the page's own words, and a screenshot of the page is kept in the case's output.
async function installSets(page, family, setIds, output) {
  await pickSets(page, family, setIds);
  await page.locator('[data-add-sets]').click();
  try {
    await page.waitForFunction(prompts => { const text = document.getElementById('framework-guidance').textContent.trim();
      return text && !prompts.some(prompt => text.startsWith(prompt)); }, GUIDANCE_PROMPTS, { timeout: 600_000 });
    const guidance = (await page.locator('#framework-guidance').textContent()).trim();
    assert.match(guidance, /^Chosen sets added/, `Adding ${family} sets ${setIds.join(', ')}: ${guidance}`);
  } catch (error) {
    if (output) { await mkdir(output, { recursive: true }); await page.screenshot({ path: join(output, `add-sets-failed-${family}-${Date.now()}.png`), fullPage: true }).catch(() => {}); }
    throw error;
  }
  await openPolicyDrawer(page);
  await page.locator('#install-button:not([disabled])').waitFor({ timeout: 180_000 });
  await page.locator('#install-button').click();
  await page.locator('#install-message[data-outcome]').waitFor({ timeout: 240_000 });
  assert.equal(await page.locator('#install-message').getAttribute('data-outcome'), 'installed', await page.locator('#install-message').innerText());
}

// Ticks exactly these starting sets of one framework in the set picker, without adding them.
async function pickSets(page, family, setIds) {
  await chooseCatalogFamily(page, family);
  const choices = page.locator('#starting-sets [data-set-id]');
  await choices.first().waitFor({ state: 'attached' });
  for (const id of await choices.evaluateAll(nodes => nodes.map(node => node.dataset.setId))) {
    const choice = page.locator(`#starting-sets [data-set-id="${id}"]`);
    if ((await choice.getAttribute('aria-pressed') === 'true') === setIds.includes(id)) continue;
    // A set under "More sets" is reached by opening its list, as a person would; choosing a set outside it closes it.
    const details = choice.locator('xpath=ancestor::details[1]');
    if (await details.count() && !await details.evaluate(node => node.open)) await details.locator('xpath=./summary').click();
    await choice.click();
  }
  for (const id of setIds) assert.equal(await page.locator(`#starting-sets [data-set-id="${id}"]`).getAttribute('aria-pressed'), 'true', `set ${id} is chosen`);
}

// A fresh session: nothing of the installing session's draft is open, so the list can only come from Core.
export async function freshInstalledList(browser, origin, theme, errors, { catalog = true } = {}) {
  const context = await newContext(browser);
  const page = await openPage(context, origin, theme, errors);
  const answers = recordAnswers(page);
  await page.reload();
  await page.locator('#browse-family option[value="Extensions"]').waitFor({ state: 'attached' });
  await openPolicyDrawer(page);
  await page.waitForFunction(() => { const note = document.getElementById('installed-note'); return note && !/Checking what is installed/.test(note.textContent) && document.querySelectorAll('#installed-list li').length > 0; }, undefined, { timeout: 120_000 });
  for (let attempt = 0; attempt < 100 && ((catalog && !answers.catalog) || !answers.inventory); attempt++) await page.waitForTimeout(100);
  if (catalog) assert.ok(answers.catalog?.items?.length, 'the page received its Catalog');
  assert.ok(answers.inventory?.selections?.length, 'the page received a non-empty Core inventory');
  return { context, page, answers };
}

const catalogItem = (catalog, itemId) => catalog.items.find(item => item.id === itemId);
// Catalog display.name (1.7 publishes it as `name`), with a rule's or skill's namespace in brackets.
const displayName = item => { const name = item.display?.name ?? item.name; const namespace = item.namespace ?? item.payload?.namespace; return namespace ? `${name} (${namespace})` : name; };
const setName = (catalog, set) => catalog.frameworks.flatMap(framework => framework.id === set.framework ? framework.sets ?? [] : [])
  .find(candidate => candidate.id === set.setId && (candidate.setSha256 === undefined || candidate.setSha256 === set.setSha256))?.name;
const setOrigins = selection => (selection.origins ?? []).filter(origin => origin.reasonIncluded === 'in-set' && origin.set).map(origin => origin.set);
// Every path Core's removal review deletes or writes back, the members of items it freed included (Core lists those under
// the removal that freed them), and every file its review removes whole (such as an entry file Core created): the
// preview must show each of them.
function assertPreviewListsRemovals(review, removal) {
  const members = (removal?.removals ?? []).flatMap(entry => entry.members ?? []).filter(member => ['remove', 'restore'].includes(member.action)).map(member => member.path);
  const files = (removal?.preparation?.review?.operations ?? []).filter(operation => operation.effects === 'remove-file').map(operation => operation.details?.target).filter(Boolean);
  assert.ok(members.length, `Core's removal review touches some member\n${JSON.stringify(removal)}`);
  const missing = [...new Set([...members, ...files])].filter(path => !review.includes(path));
  assert.deepEqual(missing, [], `the preview lists every file Core removes\n${review}`);
  return { members: members.length, files: files.length };
}

const lines = text => text.split('\n').map(line => line.trim()).filter(Boolean);
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const count = (text, pattern) => (text.match(new RegExp(pattern, 'g')) ?? []).length;
// Sentences this page used to make up; neither the contract (workbench-reads, "Your setup") nor its amendment 3.2.3 has
// them. "Kept; still needed by {names}" and "Couldn't confirm it's kept." are now approved wording.
const INVENTED = [/From set /, /Also in set/, /Replaced by a newer item/, /Missing since install/, /your own choices/, /: Removed\b/, /: Restored\b/];

export async function runInstalledListTruthBrowser({ origin, output, project, playwrightModule, theme = 'dark' }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const installing = await newContext(browser);
    await installSets(await openPage(installing, origin, theme, errors), 'Superpowers', ['superpowers'], output);
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
    await installSets(await openPage(installing, origin, theme, errors), 'Extensions', ['extensions.template.specialists', 'misc'], output);
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
    for (let attempt = 0; attempt < 100 && !answers.removal; attempt++) await page.waitForTimeout(100);
    const previewed = assertPreviewListsRemovals(review, answers.removal);
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
    await writeFile(join(output, `${label}-${theme}.json`), JSON.stringify({ status: 'passed', removed: expectedRemoved, kept: expectedKept, previewed, review, result, calls, errors }, null, 2));
    assert.deepEqual(errors, []);
    return { status: 'passed' };
  } finally { await browser.close(); }
}

// Keeps a framework's pre-ticked sets, adds the sets named, and installs (as the large-install check does).
async function installWithSets(page, family, setIds) {
  await chooseCatalogFamily(page, family);
  await page.locator('#starting-sets [data-set-id]').first().waitFor({ state: 'attached' });
  for (const id of setIds) {
    const choice = page.locator(`#starting-sets [data-set-id="${id}"]`);
    // A set under "More sets" is reached by opening its disclosure, as a person would.
    const details = choice.locator('xpath=ancestor::details[1]');
    if (await details.count() && !await details.evaluate(node => node.open)) await details.locator('xpath=./summary').click();
    if (await choice.getAttribute('aria-pressed') !== 'true') await choice.click();
    await page.waitForFunction(id => document.querySelector(`[data-set-id="${id}"]`)?.getAttribute('aria-pressed') === 'true', id);
  }
  await page.locator('#starting-sets [data-add-sets]').click();
  await page.waitForFunction(() => document.getElementById('framework-guidance').textContent.includes('Chosen sets added'), undefined, { timeout: 600_000 });
  await openPolicyDrawer(page);
  await page.locator('#install-button:not([disabled])').waitFor({ timeout: 600_000 });
  await page.locator('#install-button').click();
  await page.locator('#install-message[data-outcome]').waitFor({ timeout: 900_000 });
  assert.equal(await page.locator('#install-message').getAttribute('data-outcome'), 'installed', await page.locator('#install-message').innerText());
}

// A namespaced ECC rule from the real TypeScript rules set: the installed list and the removal outcome name it
// "{display.name} ({namespace})", the same form the browse cards use.
export async function runNamespacedRuleTruthBrowser({ origin, output, project, playwrightModule, theme = 'dark' }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [], itemId = 'ecc.rule.typescript.coding-style', expected = 'TypeScript and JavaScript Coding Style (typescript)';
  try {
    const installing = await newContext(browser);
    await installWithSets(await openPage(installing, origin, theme, errors), 'ECC', ['ecc.rules.typescript']);
    await installing.close();
    const { page, answers } = await freshInstalledList(browser, origin, theme, errors);
    const item = catalogItem(answers.catalog, itemId);
    assert.ok(item, `Catalog publishes ${itemId}`);
    assert.equal(displayName(item), expected, 'Catalog display.name with its own namespace in round brackets');
    const selection = answers.inventory.selections.find(entry => entry.item.itemId === itemId && entry.scope === 'project');
    assert.ok(selection, `Core lists ${itemId} installed`);
    const panel = await page.locator('#installed-panel').innerText();
    const names = await page.locator('[data-installed-row] > div > span.font-medium').allInnerTexts();
    assert.equal(names.length, answers.inventory.selections.length, 'every installed row is named');
    assert.deepEqual(names.filter(name => name === expected), [expected], `one row named "${expected}"\n${names.join('\n')}`);
    assert.deepEqual(names.filter(name => /\[[^\]]*\]/.test(name)), [], `no name with square brackets\n${panel}`);
    const row = page.locator(`[data-installed-row="${selection.managementId}"]`);
    assert.equal(await row.locator('.font-medium').first().innerText(), expected, 'the row is named in the contract form');
    await row.getByRole('button', { name: 'Remove', exact: true }).first().click();
    await row.getByRole('button', { name: 'Confirm remove', exact: true }).waitFor({ timeout: 120_000 });
    const review = await row.innerText();
    assert.ok(lines(review).some(line => line.startsWith(`${expected}: `)), `the review step names "${expected}"\n${review}`);
    await row.getByRole('button', { name: 'Confirm remove', exact: true }).click();
    const message = page.locator('#installed-message[data-outcome]');
    await message.waitFor({ timeout: 240_000 });
    const result = await message.innerText();
    assert.equal(await message.getAttribute('data-outcome'), 'removed', result);
    assert.equal(count(result, escape(`${expected}: removed`)), 1, `"${expected}: removed" reported once\n${result}`);
    assert.doesNotMatch(result, /\[typescript\]/, result);
    await page.screenshot({ path: join(output, `namespaced-rule-${theme}.png`), fullPage: true });
    await writeFile(join(output, `namespaced-rule-${theme}.json`), JSON.stringify({ status: 'passed', expected, review, result, errors }, null, 2));
    assert.deepEqual(errors, []);
    return { status: 'passed' };
  } finally { await browser.close(); }
}

export const runSetRemovalTruthBrowser = options => runSetRemoval({ theme: 'dark', ...options });

// Update one item: the real ECC TypeScript rules installed through the page, then, on a Workbench restarted
// on a newer Catalog in which exactly one installed item changed, that item's Update and Confirm update. The caller
// compares the project's files and Core's inventory before and after.
export async function runUpdateOneInstallBrowser({ origin, output, playwrightModule, theme = 'dark' }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const installing = await newContext(browser);
    await installWithSets(await openPage(installing, origin, theme, errors), 'ECC', ['ecc.rules.typescript']);
    await installing.close();
    const { answers } = await freshInstalledList(browser, origin, theme, errors);
    assert.deepEqual(errors, []);
    return { status: 'passed', inventory: answers.inventory };
  } finally { await browser.close(); }
}

export async function runUpdateOneBrowser({ origin, output, playwrightModule, theme = 'dark', itemId }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    // A Catalog read from a package root of its own keeps its recipes inline, a body past what the browser's
    // protocol buffers for a test to read back, so the page asks its host whether it publishes the item.
    const { page, answers } = await freshInstalledList(browser, origin, theme, errors, { catalog: false });
    const published = await page.evaluate(async id => (await (await fetch('/api/authoring-catalog')).json()).items.some(item => item.id === id), itemId);
    assert.ok(published, `the newer Catalog publishes ${itemId}`);
    const selection = answers.inventory.selections.find(entry => entry.item?.itemId === itemId && entry.scope === 'project');
    assert.ok(selection, `Core lists ${itemId} installed`);
    // Only the changed item offers an update.
    const offered = await page.locator('[data-installed-row]').filter({ has: page.locator('[data-installed-state="update-available"]') })
      .evaluateAll(rows => rows.map(row => row.dataset.installedRow));
    assert.deepEqual(offered, [selection.managementId], 'only the changed item shows "Update available"');
    const row = page.locator(`[data-installed-row="${selection.managementId}"]`);
    // Every update the page asks for: what the host sent Core, and Core's answer to it.
    const updates = [];
    page.on('response', response => { if (response.url().endsWith('/api/authoring-update')) updates.push(response.json().catch(error => ({ unreadable: error.message }))); });
    await row.getByRole('button', { name: 'Update', exact: true }).click();
    const confirm = row.getByRole('button', { name: 'Confirm update', exact: true });
    await confirm.waitFor({ timeout: 240_000 });
    const message = page.locator('#installed-message');
    await page.waitForFunction(() => !/Checking the replacement/.test(document.getElementById('installed-message')?.textContent ?? ''), undefined, { timeout: 240_000 });
    assert.equal(await confirm.isEnabled(), true, `Confirm update is offered: ${await message.innerText()}\n${await row.innerText()}`);
    const review = await row.innerText();
    await confirm.click();
    await page.waitForFunction(() => ['updated', 'failed', 'unknown', 'kept'].includes(document.getElementById('installed-message')?.dataset.outcome), undefined, { timeout: 240_000 });
    const result = await message.innerText();
    assert.equal(await message.getAttribute('data-outcome'), 'updated', result);
    // The update was prepared as an install is: the host sent a 1.6.0 replacement Core renders from the named Catalog
    // release, with its binding, and Core answered with managed update 1.1.0 and a review naming its binding and Scan state.
    const prepared = await Promise.all(updates);
    assert.ok(prepared.length >= 1, 'the page asked the host for the update');
    const sent = prepared.map(answer => {
      assert.equal(answer.schema, 'urn:aihq:core:managed-update-preparation:1.1.0', `Core read a request naming its policy: ${JSON.stringify(answer).slice(0, 600)}`);
      assert.equal(answer.disposition, 'prepared', JSON.stringify(answer.updates));
      assert.equal(answer.request?.policy, 'urn:aihq:core:execution-policy:1.6.0', JSON.stringify(answer.request));
      assert.ok(answer.request.catalogReleases >= 1, 'the request names the Catalog release');
      assert.deepEqual(answer.request.replacements.map(({ managementId, recipe, bindingDigest }) => ({ managementId, recipe, bindingDigest })),
        [{ managementId: selection.managementId, recipe: 'rendered-by-core', bindingDigest: true }]);
      assert.equal(answer.preparation?.review?.schema, 'urn:aihq:core:prepared-work:1.7.0');
      const reviewed = answer.preparation.review.selections.find(entry => entry.managementId === selection.managementId);
      assert.ok(reviewed?.layout && reviewed.scanState, `the review names the replacement's binding and Scan state: ${JSON.stringify(reviewed)}`);
      return { request: answer.request, schema: answer.schema, review: answer.preparation.review.schema, layout: reviewed.layout, scanState: reviewed.scanState };
    });
    await page.screenshot({ path: join(output, `update-one-${theme}.png`), fullPage: true });
    const after = await freshInstalledList(browser, origin, theme, errors, { catalog: false });
    // The newer release's set has a digest of its own; the installed set keeps the name Catalog publishes for its id.
    const offeredSets = await after.page.evaluate(async () => (await (await fetch('/api/authoring-catalog')).json()).frameworks
      .flatMap(framework => (framework.sets ?? []).map(set => ({ framework: framework.id, id: set.id, name: set.name, setSha256: set.setSha256 }))));
    const headings = await after.page.locator('#installed-list [data-installed-set]').evaluateAll(sections => sections.map(section =>
      ({ set: section.dataset.installedSet, heading: section.querySelector('p')?.textContent ?? '', exact: section.querySelector('p')?.title ?? '' })));
    assert.ok(headings.length, 'the installed list has a set section');
    for (const { set, heading, exact } of headings) {
      const [framework, setId, setSha256] = exact.split('/');
      const offered = offeredSets.find(entry => entry.framework === framework && entry.id === setId);
      assert.ok(offered, `the newer Catalog offers ${setId}`);
      // A recorded digest the newer release no longer has is that set's earlier release (pending contract row 32).
      assert.equal(heading, offered.setSha256 === setSha256 ? offered.name : `${offered.name} (earlier release)`, `the ${set} heading is Catalog's name for the set`);
      assert.notEqual(heading, setId, 'no raw set id as a heading');
    }
    assert.deepEqual(errors, []);
    await writeFile(join(output, `update-one-${theme}.json`), JSON.stringify({ status: 'passed', itemId, managementId: selection.managementId, review, result, sent, headings, errors }, null, 2));
    return { status: 'passed', managementId: selection.managementId, members: selection.members.map(member => member.path), result, sent, inventory: after.answers.inventory };
  } finally { await browser.close(); }
}

// An update the newer Catalog item cannot have yet: Update is offered, and the page stops before Core is asked, naming
// in the Catalog's own words the item the newer version needs that is not installed. Nothing can be confirmed.
export async function runUpdateBlockedBrowser({ origin, output, playwrightModule, theme = 'dark', itemId }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const { page, answers } = await freshInstalledList(browser, origin, theme, errors, { catalog: false });
    const catalog = await page.evaluate(async () => (await (await fetch('/api/authoring-catalog')).json()).items.map(({ id, name, label, display, namespace, payload, dependencies }) =>
      ({ id, name, label, display, namespace, payload: payload && { namespace: payload.namespace }, dependencies })));
    const item = catalogItem({ items: catalog }, itemId);
    assert.ok(item, `the newer Catalog publishes ${itemId}`);
    const selection = answers.inventory.selections.find(entry => entry.item?.itemId === itemId && entry.scope === 'project');
    assert.ok(selection, `Core lists ${itemId} installed`);
    // The item the newer version requires that nothing installed provides.
    const installedIds = new Set(answers.inventory.selections.map(entry => entry.item?.itemId));
    const missing = (item.dependencies?.requires ?? []).map(ref => ref.itemId).filter(id => !installedIds.has(id));
    assert.equal(missing.length, 1, `the newer ${itemId} requires exactly one item that is not installed: ${missing.join(', ')}`);
    const row = page.locator(`[data-installed-row="${selection.managementId}"]`);
    await row.locator('[data-installed-state="update-available"]').waitFor();
    const updates = [];
    page.on('request', request => { if (request.url().endsWith('/api/authoring-update')) updates.push(request.url()); });
    await row.getByRole('button', { name: 'Update', exact: true }).click();
    const message = page.locator('#installed-message');
    await page.waitForFunction(() => { const node = document.getElementById('installed-message'); return node && node.textContent && !/Checking the replacement/.test(node.textContent); }, undefined, { timeout: 240_000 });
    const text = await message.innerText();
    assert.equal(await message.getAttribute('data-outcome'), 'not-prepared', `the update stops: ${text}\n${await row.innerText()}`);
    const expected = `Update cannot go ahead: ${displayName(item)} needs ${displayName(catalogItem({ items: catalog }, missing[0]))}, which is not installed. Nothing was updated.`;
    assert.equal(text, expected);
    assert.equal(await row.getByRole('button', { name: 'Confirm update', exact: true }).count() === 0
      || !await row.getByRole('button', { name: 'Confirm update', exact: true }).isEnabled(), true, 'nothing can be confirmed');
    assert.equal(updates.length, 1, 'the page asked its host once');
    await page.screenshot({ path: join(output, `update-requirement-${theme}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    return { status: 'passed', message: text };
  } finally { await browser.close(); }
}

// Items added one at a time from their cards (after `browse` brings the cards into view; what it returns runs after the
// adds), then installed together.
async function addAndInstall(page, browse, itemIds) {
  const afterAdds = await browse();
  const notices = [];
  for (const itemId of itemIds) {
    await page.locator('#cards-grid').getByRole('button', { name: `Add ${itemId}`, exact: true }).click();
    // Added, or refused: the refusal opens Your setup with the page's status saying "Nothing was added".
    const notice = page.locator('#added-notice-message').filter({ hasText: /\S/ }), refused = page.locator('#policy-status').filter({ hasText: /^Nothing was added/ });
    await notice.or(refused).first().waitFor();
    notices.push(await (await notice.isVisible() ? notice : refused).innerText());
    assert.match(notices.at(-1), /^Added /, `the Add of ${itemId} was accepted: ${notices.at(-1)}`);
    await page.locator('#added-notice-dismiss').click();
  }
  await afterAdds?.();
  await openPolicyDrawer(page);
  await page.locator('#install-button:not([disabled])').waitFor({ timeout: 180_000 });
  await page.locator('#install-button').click();
  await page.locator('#install-message[data-outcome]').waitFor({ timeout: 240_000 });
  assert.equal(await page.locator('#install-message').getAttribute('data-outcome'), 'installed', await page.locator('#install-message').innerText());
  return notices;
}

// Project basics' shared block in a project with nothing to detect: it is added and installed, listed with the two
// items it needs, and its block is written into CLAUDE.md. Its card's Add is used after the page has Core's fit for it.
export async function runSharedBlockTruthBrowser({ origin, output, project, playwrightModule, theme = 'dark' }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [], itemId = 'project-basics.shared-block';
  try {
    const installing = await newContext(browser);
    const page = await openPage(installing, origin, theme, errors);
    const added = await addAndInstall(page, async () => {
      // The card's Add is clicked only once the page holds Core's fit for this framework's cards.
      const framework = page.locator('#framework-navigation button[data-framework^="internal:project-basics"]');
      const releaseSha256 = (await framework.getAttribute('data-framework')).split(':')[2];
      const fit = page.waitForResponse(response => response.url().endsWith('/api/authoring-browse-content') && response.ok()
        && response.request().postData()?.includes(releaseSha256), { timeout: 120_000 });
      await framework.click();
      if (!await page.locator('#browse-all-items').isChecked()) await page.locator('#browse-all-items').check();
      const answer = await (await fit).json();
      assert.ok(answer.compatibility?.items?.some(entry => entry.item.itemId === itemId), 'the fit answer covers the shared block');
      await page.locator('#cards-grid [data-card-id]').filter({ hasNotText: 'Tool fit loading' }).first().waitFor();
      assert.equal(await page.locator('#browse-unsupported').filter({ hasText: 'Shared block' }).count(), 0, 'the shared block is not filed under what does not work');
    }, [itemId]);
    await installing.close();
    const { page: listed, answers } = await freshInstalledList(browser, origin, theme, errors);
    const basics = answers.inventory.selections.filter(selection => selection.item?.framework === 'project-basics');
    assert.deepEqual(basics.map(selection => selection.item.itemId).sort(), ['project-basics.router', 'project-basics.shared-block', 'project-basics.working-rules']);
    assert.ok(basics.every(selection => !Object.hasOwn(selection, 'projectFacts')), 'no project facts were recorded for a project with none');
    const row = listed.locator(`[data-installed-item="${itemId}"]`);
    assert.equal(await row.count(), 1, 'the shared block has its own installed row');
    const text = await row.innerText();
    assert.match(text, /\+ 2 it needs/, text);
    const claude = await readFile(join(project, 'CLAUDE.md'), 'utf8');
    assert.match(claude, /<!-- BEGIN aih:shared -->[\s\S]+<!-- END aih:shared -->/, 'CLAUDE.md holds the shared block');
    await listed.screenshot({ path: join(output, `shared-block-${theme}.png`), fullPage: true });
    await writeFile(join(output, `shared-block-${theme}.json`), JSON.stringify({ status: 'passed', added, row: text, selections: basics.map(selection => selection.item.itemId),
      claudeMd: claude.match(/<!-- BEGIN aih:shared -->[^\n]*\n?/)?.[0], errors }, null, 2));
    assert.deepEqual(errors, []);
    return { status: 'passed' };
  } finally { await browser.close(); }
}

// An item chosen alone whose only requirement is a supporting document: the list folds that document under it as
// what it needs, and removing the item removes the document too, since nothing else needs it.
export async function runNeededRemovalTruthBrowser({ origin, output, project, playwrightModule, theme = 'dark' }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [], itemId = 'extensions.hook.git-guard', neededId = 'extensions.notices';
  try {
    const installing = await newContext(browser);
    const page = await openPage(installing, origin, theme, errors);
    const added = await addAndInstall(page, async () => { await chooseCatalogFamily(page, 'Extensions'); await page.locator('#catalog-search').fill('git-guard'); }, [itemId]);
    await installing.close();
    const { page: listed, answers } = await freshInstalledList(browser, origin, theme, errors);
    const before = answers.inventory.selections;
    const chosen = before.find(selection => selection.item?.itemId === itemId), needed = before.find(selection => selection.item?.itemId === neededId);
    assert.ok(chosen && needed, `Core lists both installed: ${JSON.stringify(before.map(selection => selection.item?.itemId))}`);
    const row = listed.locator(`[data-installed-item="${itemId}"]`);
    assert.equal(await row.count(), 1, `git-guard has its own installed row\n${await listed.locator('#installed-list').innerText()}`);
    const text = await row.innerText();
    assert.match(text, /\+ 1 it needs/, `the row names what it needs\n${await listed.locator('#installed-list').innerText()}`);
    assert.equal(await row.locator(`[data-installed-needed="${needed.managementId}"]`).count(), 1, 'the notices are folded under git-guard');
    assert.equal(await listed.locator(`[data-installed-other="${needed.managementId}"]`).count(), 0, 'the notices are not another installed item');
    answers.removal = undefined;
    await row.locator('> div').first().getByRole('button', { name: 'Remove', exact: true }).click();
    const message = listed.locator('#installed-message[data-outcome]'), previewed = [];
    for (let round = 0; round < 5 && !await message.count(); round++) {
      const confirm = row.getByRole('button', { name: 'Confirm remove', exact: true });
      await confirm.or(message).first().waitFor({ timeout: 120_000 });
      if (await confirm.isVisible()) {
        for (let attempt = 0; attempt < 100 && !answers.removal; attempt++) await listed.waitForTimeout(100);
        previewed.push(assertPreviewListsRemovals(await row.innerText(), answers.removal));
        answers.removal = undefined;
        await confirm.click(); await listed.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), undefined, { timeout: 240_000 }); }
    }
    await message.waitFor({ timeout: 240_000 });
    const result = await message.innerText();
    assert.equal(await message.getAttribute('data-outcome'), 'removed', result);
    const listedBefore = answers.inventory;
    for (let attempt = 0; attempt < 600 && answers.inventory === listedBefore; attempt++) await listed.waitForTimeout(100);
    const after = answers.inventory?.selections ?? [];
    assert.deepEqual(after.filter(selection => [itemId, neededId].includes(selection.item?.itemId)).map(selection => selection.item.itemId), [], `nothing of git-guard or its notices is left\n${result}`);
    const left = [chosen, needed].flatMap(selection => selection.members.map(member => member.path)).filter(path => path.startsWith(project) && existsSync(path));
    assert.deepEqual(left, [], 'their files are absent on disk');
    await listed.screenshot({ path: join(output, `needed-removal-${theme}.png`), fullPage: true });
    await writeFile(join(output, `needed-removal-${theme}.json`), JSON.stringify({ status: 'passed', added, row: text, previewed, result,
      before: before.map(selection => selection.item?.itemId), after: after.map(selection => selection.item?.itemId), errors }, null, 2));
    assert.deepEqual(errors, []);
    return { status: 'passed' };
  } finally { await browser.close(); }
}

// Raw identities in a screen's visible text: every Catalog item id (and those of the items they replace) and set id,
// every Core management id and recorded set id, and every sha256, whole or as a prefix of 7 or more characters, that the
// page's Catalog and Core answers carry. Text is read as words and path segments, a trailing ".", "," or "/" trimmed,
// and each checked against the known ids, so an id ending a sentence or inside an id path is found while a file path,
// even one with a folder named after an item, is not. An id that is one plain word (a set id such as "misc") is a word prose uses too, so it counts only where it
// stands alone as a line or follows the words this page introduces an id with ("set ", "from ", "Also in: ",
// "Required by ", "Replaces"). An id that is also a published name (an item or set named by its id) is a name, and is
// skipped. Catalog's own descriptions are shown as Catalog wrote them (an MCP server's provider note may name another
// item), so that prose is taken out before the scan.
const prose = value => value.replace(/\s+/g, ' ').trim();
const INTRODUCED = /(?:\bset |\bfrom |\bAlso in: |\bRequired by |\bReplaces\s+)([a-z]+)(?![A-Za-z0-9_.-])/g;
export function rawIdentities(text, { catalog, inventory }) {
  const descriptions = [...new Set([...catalog.items.map(item => item.description),
    ...catalog.frameworks.flatMap(framework => [framework.description, ...(framework.sets ?? []).map(set => set.description)])]
    .filter(value => typeof value === 'string' && prose(value).length >= 20).map(prose))].sort((a, b) => b.length - a.length);
  text = text.split('\n').map(line => descriptions.reduce((rest, description) => rest.split(description).join(' '), prose(line))).join('\n');
  const names = new Set([...catalog.items.flatMap(item => [item.name, item.label, item.display?.name, displayName(item)]),
    ...catalog.frameworks.flatMap(framework => [framework.name, ...(framework.sets ?? []).map(set => set.name)])].filter(Boolean));
  const ids = new Map();
  for (const item of catalog.items) {
    ids.set(item.id, 'item id');
    for (const entry of item.supersedes ?? []) ids.set(entry.itemId, 'item id');
  }
  for (const framework of catalog.frameworks) for (const set of framework.sets ?? []) ids.set(set.id, 'set id');
  for (const selection of inventory?.selections ?? []) {
    ids.set(selection.managementId, 'management id'); if (selection.item?.itemId) ids.set(selection.item.itemId, 'item id');
    for (const set of setOrigins(selection)) ids.set(set.setId, 'set id');
  }
  const found = [], named = new Set(), seen = new Set();
  const report = (id, context) => {
    const what = ids.get(id);
    if (!what || seen.has(id)) return;
    if (names.has(id)) { named.add(id); return; }
    seen.add(id); found.push({ what, value: id, context });
  };
  const word = id => /^[a-z]+$/.test(id);
  for (const line of lines(text)) {
    if (word(line)) report(line, `${line} (a line of its own)`);
    // A file path (rooted, relative to a dot folder, or ending in a file name) is where a file goes; a folder Core names
    // after an item is part of it, not a label, so it is not split.
    const filePath = token => /^(?:[./~]|[A-Za-z]:[\\/])/.test(token) || /\/[^/]*\.[A-Za-z0-9]{1,8}$/.test(token);
    for (const token of line.split(/[\s;:()"'“”‘’[\]·—→]+/)) for (const part of [token, ...(filePath(token) ? [] : token.split('/'))]) {
      const trimmed = part.replace(/[.,/]+$/, '');
      if (trimmed && !word(trimmed)) report(trimmed, line);
    }
  }
  for (const match of text.matchAll(INTRODUCED)) report(match[1], text.slice(Math.max(0, match.index - 40), match.index + match[0].length + 40));
  const shas = [...new Set(JSON.stringify([catalog, inventory ?? null]).match(/[0-9a-f]{64}/g) ?? [])];
  for (const match of text.matchAll(/(?<![0-9A-Za-z])[0-9a-f]{7,}(?![0-9A-Za-z])/g)) {
    if (/^\d+$/.test(match[0])) continue; // a number, such as a byte count
    const context = text.slice(Math.max(0, match.index - 60), match.index + match[0].length + 60);
    const sha = shas.find(value => value.startsWith(match[0]));
    if (sha) found.push({ what: 'sha256', value: sha, context });
    else if (match[0].length === 64) found.push({ what: 'sha256', value: match[0], context });
  }
  return { found, named: [...named] };
}

// Pick, review, Your setup, install and the installed list say names only. Two overlapping Extensions sets are picked,
// an item that replaces another is inspected, the sets are added and reviewed, installed, and the installed list read
// back in a fresh session. Each screen's visible text is kept, then scanned against every identity the page's Catalog
// and the final Core inventory carry; the scan fails on any raw item id, management id, set id or sha256.
export async function runNoRawIdsBrowser({ origin, output, playwrightModule, theme = 'dark' }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [], screens = {};
  const keep = async (name, page, locator = page.locator('body')) => {
    screens[name] = await locator.innerText();
    await page.screenshot({ path: join(output, `no-raw-ids-${name}-${theme}.png`), fullPage: true });
  };
  try {
    const context = await newContext(browser);
    const page = await openPage(context, origin, theme, errors);
    const answers = recordAnswers(page);
    await page.reload();
    await page.locator('#browse-family option[value="Extensions"]').waitFor({ state: 'attached' });
    for (let attempt = 0; attempt < 100 && !answers.catalog; attempt++) await page.waitForTimeout(100);
    const { catalog } = answers;
    assert.ok(catalog?.items?.length, 'the page received its Catalog');
    // Pick: the sets ticked in the picker, then the inspector of an Extensions item that replaces another.
    const extensions = catalog.frameworks.find(framework => framework.id === 'extensions' && framework.sets?.some(set => set.id === 'misc'));
    await pickSets(page, extensions.name, ['extensions.template.specialists', 'misc']);
    await keep('pick', page);
    const replacing = catalog.items.find(item => item.supersedes?.length && item.root?.releaseSha256 === extensions.sha256);
    assert.ok(replacing, 'Catalog publishes an Extensions item that replaces another');
    await page.locator('#catalog-search').fill(replacing.name ?? replacing.label);
    const card = page.locator(`#cards-grid [data-card-id="${replacing.root.releaseSha256}/${replacing.id}"]`);
    await card.locator('.wb-card-title').click();
    await page.locator('#inspector-browse-facts').waitFor();
    assert.match(await page.locator('#inspector-browse-facts').innerText(), /Replaces/, 'the inspector says what the item replaces');
    await keep('inspector', page);
    await page.locator('#close-inspector-btn').click();
    await page.locator('#catalog-search').fill('');
    // Review and Your setup: the drawer once the sets are added and Core's review is ready, with its disclosures open.
    await page.locator('#starting-sets [data-add-sets]').click();
    await page.waitForFunction(() => document.getElementById('framework-guidance').textContent.includes('Chosen sets added'), undefined, { timeout: 600_000 });
    await openPolicyDrawer(page);
    await page.locator('#install-button:not([disabled])').waitFor({ timeout: 600_000 });
    const drawer = page.locator('#policy-review-panel');
    for (const summary of await drawer.locator('#install-details > summary, details.setup-choice-needs > summary').all()) if (!await summary.evaluate(node => node.parentElement.open)) await summary.click();
    assert.ok(await drawer.locator('[data-review-set]').count(), 'the review groups its rows under the picked sets');
    assert.ok(await drawer.locator('[data-choice-set]').count(), 'Your choices groups its rows under the picked sets');
    await keep('review-and-setup', page, drawer);
    await page.locator('#install-button').click();
    await page.locator('#install-message[data-outcome]').waitFor({ timeout: 900_000 });
    assert.equal(await page.locator('#install-message').getAttribute('data-outcome'), 'installed', await page.locator('#install-message').innerText());
    await keep('install', page, drawer);
    await context.close();
    // Installed: the list Core reads back in a fresh session.
    const after = await freshInstalledList(browser, origin, theme, errors);
    await keep('installed', after.page, after.page.locator('#policy-review-panel'));
    const inventory = after.answers.inventory;
    const scans = Object.fromEntries(Object.entries(screens).map(([name, text]) => [name, rawIdentities(text, { catalog: after.answers.catalog ?? catalog, inventory })]));
    await writeFile(join(output, `no-raw-ids-${theme}.json`), JSON.stringify({ replacing: replacing.id, selections: inventory.selections.length,
      scans: Object.fromEntries(Object.entries(scans).map(([name, scan]) => [name, scan.found])), namedIds: [...new Set(Object.values(scans).flatMap(scan => scan.named))], screens, errors }, null, 2));
    const raw = Object.fromEntries(Object.entries(scans).filter(([, scan]) => scan.found.length).map(([name, scan]) => [name, scan.found]));
    assert.deepEqual(raw, {}, 'no raw identity on any screen');
    assert.deepEqual(errors, []);
    return { status: 'passed' };
  } finally { await browser.close(); }
}

// Two real ECC rule sets, each of whose rules requires ECC's shared notices.
export const ECC_SETS = ['ecc.rules.typescript', 'ecc.rules.golang'];
const ECC_NOTICES = 'ecc.notices';
const eccOf = inventory => (inventory?.selections ?? []).filter(selection => selection.item?.framework === 'ecc');

// The same ECC sets installed through the page in this host's project; what Core then lists of ECC there.
export async function installEccSetsBrowser({ origin, output, playwrightModule, theme = 'dark' }) {
  const { chromium } = await import(playwrightModule);
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const installing = await newContext(browser);
    await installSets(await openPage(installing, origin, theme, errors), 'ECC', ECC_SETS, output);
    await installing.close();
    const { answers } = await freshInstalledList(browser, origin, theme, errors);
    assert.deepEqual(errors, []);
    return { status: 'passed', itemIds: eccOf(answers.inventory).map(selection => selection.item.itemId).sort() };
  } finally { await browser.close(); }
}

// What Core lists of ECC in this host's project, read by the page in a fresh session.
export async function readEccInstalledBrowser({ origin, playwrightModule, theme = 'dark' }) {
  const { chromium } = await import(playwrightModule);
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const { answers } = await freshInstalledList(browser, origin, theme, errors);
    assert.deepEqual(errors, []);
    return { status: 'passed', itemIds: eccOf(answers.inventory).map(selection => selection.item.itemId).sort() };
  } finally { await browser.close(); }
}

// The preview round as the installed list shows it: each item's message and the files Core would remove.
const previewText = preview => preview.steps.map(step => [`${step.entry.name}: ${step.message}`, ...step.files.map(file => `${file.action}  ${file.path}`)].join('\n')).join('\n');

// The ECC sets are removed twice from this project while another project under the same account home keeps them
// (check-installed-truth.mjs installs them there first and checks them afterwards). First both sets in ONE request:
// the installed list offers one set per Remove, so the page's own removal modules are given both sets' entries, as
// "Remove this set" builds them, and preview once; ECC's notices must be folded into that preview and be gone after.
// Then, installed again, one set after the other through "Remove this set". Each time nothing of ECC may be left here.
export async function runEccSetsRemovalTruthBrowser({ origin, output, project, playwrightModule, theme = 'dark' }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [], evidence = { together: undefined, rounds: [] };
  const install = async () => {
    const installing = await newContext(browser);
    await installSets(await openPage(installing, origin, theme, errors), 'ECC', ECC_SETS, output);
    await installing.close();
    const listed = await freshInstalledList(browser, origin, theme, errors);
    const ecc = eccOf(listed.answers.inventory);
    assert.ok(ecc.some(selection => selection.item.itemId === ECC_NOTICES), `Core lists ${ECC_NOTICES} installed: ${JSON.stringify(ecc.map(selection => selection.item.itemId))}`);
    return { ...listed, ecc };
  };
  const leftOnDisk = ecc => ecc.flatMap(selection => selection.members.map(member => member.path)).filter(path => path.startsWith(project) && existsSync(path));
  try {
    // Both sets in one request. "Remove this set" is opened and cancelled once only to read the page's own request.
    const first = await install();
    const sent = [];
    first.page.on('request', request => { if (request.url().endsWith('/api/authoring-remove')) sent.push({ headers: request.headers(), body: JSON.parse(request.postData() ?? '{}') }); });
    const opened = first.page.locator(`[data-installed-set^="${ECC_SETS[0]}/"]`);
    await opened.locator('> div').first().getByRole('button').first().click();
    await opened.getByRole('button', { name: 'Cancel', exact: true }).waitFor({ timeout: 120_000 });
    await opened.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(sent.length, 1, 'Remove this set asked Core once');
    const { removals: _removals, scope: _scope, mode, ...base } = sent[0].body;
    const headers = Object.fromEntries(Object.entries(sent[0].headers).filter(([name]) => name === 'x-aih-client' || name === 'content-type'));
    first.answers.removal = undefined; sent.length = 0;
    const preview = await first.page.evaluate(async ({ inventory, setIds, base, headers, mode }) => {
      const { previewRemoval } = await import('/app/installed-removal.js');
      const { groupInstalled, setRemovalEntries } = await import('/app/installed-list.js');
      const groups = groupInstalled({ inventory }).originGroups.filter(group => setIds.includes(group.set?.setId));
      const entries = groups.flatMap(group => setRemovalEntries(group).map(({ keptFor: _kept, ...entry }) => entry));
      const request = async (operation, body) => (await fetch(`/api/authoring-${operation}`, { method: 'POST', headers, body: JSON.stringify({ ...base, ...body }) })).json();
      return { sets: groups.length, preview: await previewRemoval({ entries, request, mode }) };
    }, { inventory: first.answers.inventory, setIds: ECC_SETS, base, headers, mode });
    assert.equal(preview.sets, ECC_SETS.length, 'both sets are listed as installed sets');
    assert.equal(sent.length, 1, 'both sets were previewed in one request');
    for (let attempt = 0; attempt < 100 && !first.answers.removal; attempt++) await first.page.waitForTimeout(100);
    const together = previewText(preview.preview), removal = first.answers.removal;
    const previewed = assertPreviewListsRemovals(together, removal);
    assert.ok(preview.preview.canConfirm, together);
    const notices = first.ecc.find(selection => selection.item.itemId === ECC_NOTICES);
    const noticesFiles = notices.members.map(member => member.path);
    assert.ok(noticesFiles.length, `${ECC_NOTICES} has files`);
    assert.deepEqual(noticesFiles.filter(path => !together.includes(path)), [], `${ECC_NOTICES} is folded into the one preview\n${together}`);
    const done = await first.page.evaluate(async ({ preview, base, headers, mode }) => {
      const { confirmRemoval } = await import('/app/installed-removal.js');
      const request = async (operation, { purpose: _purpose, ...body }) => (await fetch(`/api/authoring-${operation}`, { method: 'POST', headers, body: JSON.stringify({ ...base, ...body }) })).json();
      const result = await confirmRemoval({ preview, request, mode });
      const inventory = await request('managed', {});
      return { outcome: result.outcome, message: result.message, inventory };
    }, { preview: preview.preview, base, headers, mode });
    assert.equal(done.outcome, 'removed', done.message);
    evidence.together = { previewed, preview: together, result: done.message, left: eccOf(done.inventory).map(selection => ({ itemId: selection.item.itemId, origins: selection.origins })) };
    await writeFile(join(output, `ecc-sets-removal-${theme}.json`), JSON.stringify({ status: 'checking', ...evidence, errors }, null, 2));
    assert.deepEqual(eccOf(done.inventory).map(selection => selection.item.itemId), [], 'after one request for both sets nothing of ECC is left, its notices included');
    assert.deepEqual(leftOnDisk(first.ecc), [], 'every ECC file is absent on disk after the one request');
    await first.context.close();

    // One set after the other through "Remove this set".
    const { page, answers, ecc } = await install();
    for (const setId of ECC_SETS) {
      const listed = answers.inventory;
      answers.removal = undefined;
      const section = page.locator(`[data-installed-set^="${setId}/"]`);
      assert.equal(await section.count(), 1, `${setId} is listed as an installed set\n${await page.locator('#installed-list').innerText()}`);
      await section.locator('> div').first().getByRole('button').first().click();
      await section.getByRole('button', { name: 'Confirm remove', exact: true }).waitFor({ timeout: 120_000 });
      const review = await section.innerText();
      for (let attempt = 0; attempt < 100 && !answers.removal; attempt++) await page.waitForTimeout(100);
      const removal = answers.removal, previewed = assertPreviewListsRemovals(review, removal);
      await section.getByRole('button', { name: 'Confirm remove', exact: true }).click();
      // Each round's outcome is read once Core's list has been read again after it, so an earlier round's message is not taken for it.
      for (let attempt = 0; attempt < 2400 && answers.inventory === listed; attempt++) await page.waitForTimeout(100);
      assert.notEqual(answers.inventory, listed, 'the list was read again from Core after the removal');
      const message = page.locator('#installed-message[data-outcome]');
      await message.waitFor({ timeout: 60_000 });
      const result = await message.innerText();
      assert.equal(await message.getAttribute('data-outcome'), 'removed', result);
      evidence.rounds.push({ setId, previewed, review, result, removals: removal.removals.map(entry => ({ managementId: entry.managementId, ...(entry.origin ? { origin: entry.origin } : {}),
        disposition: entry.disposition, change: entry.change, members: (entry.members ?? []).map(member => `${member.action} ${member.path}`) })),
        left: eccOf(answers.inventory).map(selection => ({ itemId: selection.item.itemId, origins: selection.origins })) });
    }
    const after = answers.inventory?.selections ?? [];
    await writeFile(join(output, `ecc-sets-removal-${theme}.json`), JSON.stringify({ status: 'checking', before: ecc.map(selection => selection.item.itemId), ...evidence, errors }, null, 2));
    assert.deepEqual(eccOf(answers.inventory).map(selection => selection.item.itemId), [], 'nothing of ECC is left, its notices included');
    assert.deepEqual(leftOnDisk(ecc), [], 'every ECC file is absent on disk');
    await page.screenshot({ path: join(output, `ecc-sets-removal-${theme}.png`), fullPage: true });
    await writeFile(join(output, `ecc-sets-removal-${theme}.json`), JSON.stringify({ status: 'passed', before: ecc.map(selection => selection.item.itemId), ...evidence,
      after: after.map(selection => selection.item?.itemId), errors }, null, 2));
    assert.deepEqual(errors, []);
    return { status: 'passed' };
  } finally { await browser.close(); }
}
