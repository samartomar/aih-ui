import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInstalledRelease } from '@aihq/catalog/node';
import { intakePersonalFolder } from './personal-folder.mjs';
import { readAuthoring } from './headless.mjs';
import { installedFamilies } from './installed-families.mjs';
import { addFromCatalog, closePolicyDrawer, drawer, openPolicyDrawer, openPolicyFileActions } from './policy-drawer.mjs';
import { openCatalogAdvanced, openPolicyWorkspace, openSetupAdvanced, chooseFamily, chooseFramework, chooseSupport, choosePersonalFolder } from './advanced-browser.mjs';

export async function runIntegratedBrowser({ origin, output, playwrightModule }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const folder = join(output, 'personal'), invalid = join(output, 'invalid'), marker = join(output, 'intake-executed');
  const sources = {
    LICENSE: 'MIT License\nCopyright 2026 Example\nPermission is hereby granted, free of charge.\n',
    'skills/example/SKILL.md': '---\nname: example\ndescription: Keep personal choices understandable.\nlicense: MIT\n---\n\nUse support/checklist.txt.\n',
    'skills/example/support/checklist.txt': 'Preserve exact choices and truthful origins.\n',
    'skills/example/intake-marker.mjs': `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed');\n`,
  };
  for (const [path, text] of Object.entries(sources)) { await mkdir(dirname(join(folder, path)), { recursive: true }); await writeFile(join(folder, path), text); }
  await mkdir(invalid, { recursive: true }); await writeFile(join(invalid, 'README.md'), 'Unrecognized format.');
  const browser = await chromium.launch({ headless: true });
  const errors = [], failedResponses = []; let observed;
  const pageSetup = async context => {
    const page = await context.newPage(); observed = page; page.setDefaultTimeout(30_000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 500) failedResponses.push(`${response.status()} ${response.url()}`); });
    await page.goto(origin + '/');
    await page.locator('#browse-family option[value="Extensions"]').waitFor({ state: 'attached' });
    if (await page.locator('#setup-dialog').isVisible()) {
      await page.getByRole('radio', { name: /Vibe coder/ }).check();
      for (let step = 0; step < 4; step++) await page.locator('#setup-next').click();
      await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
    }
    return page;
  };
  try {
    const page = await pageSetup(await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } }));
    const policy = async p => JSON.parse(await p.locator('#policy-bytes').textContent());
    assert.deepEqual((await policy(page)).metadata['aih.workbench'].roots, []);
    for (const family of ['Extensions', 'ECC', 'Superpowers', 'Anthropic']) assert.equal(await page.locator(`#browse-family option[value="${family}"]`).count(), 1);
    // The left panel lists the frameworks only, under the owner's names.
    assert.deepEqual(await page.locator('#framework-list button > span:first-child').allInnerTexts(), ['AIH-Extensions', 'ECC', 'Anthropic', 'Superpowers']);
    assert.equal(await page.locator('iframe').count(), 0); assert.equal(new URL(page.url()).pathname, '/');
    await chooseFramework(page, 'Extensions'); await page.locator('#catalog-search').fill('matt');
    assert.ok(await page.getByRole('button', { name: 'Add extensions.matt.ask-matt', exact: true }).isVisible());
    // Supporting material is not a card (#133); a card's details say what comes with it, from Catalog's resolver.
    await page.locator('#catalog-search').fill('notices');
    assert.equal(await page.locator('#cards-grid [data-card-id$="/extensions.notices"]').count(), 0, 'the notices are not a card');
    await page.locator('#catalog-search').fill('matt');
    await page.locator('#cards-grid [data-card-id$="/extensions.matt.ask-matt"]').click();
    await page.locator('#details-comes-with').filter({ hasText: /Comes with 1 supporting file: Extensions licenses and upstream notices\./ }).waitFor();
    await openCatalogAdvanced(page); await page.locator('#catalog-search').fill('notices');
    await page.locator('#catalog-tools-supporting').filter({ hasText: /^Show supporting material \(\d+\)$/ }).click();
    await page.locator('#cards-grid [data-card-id$="/extensions.notices"]').waitFor();
    await page.locator('#catalog-tools-supporting').click();
    await page.locator('#catalog-search').fill('');
    // Starting sets (#134): framework items are not cards; the line above the cards offers the sets that fit Your tool,
    // worked out from what each requires, and Add all adds one in a step that Undo takes back to the exact prior state.
    assert.equal(await page.locator('#cards-grid [data-card-id$="/extensions.template.complete"]').count(), 0, 'a starting set is not a card');
    await page.locator('#starting-sets-note').filter({ hasText: /^This framework has 6 starting sets\. Choose your tool/ }).waitFor();
    const idle = await page.locator('#policy-current-context').textContent();
    assert.match(idle, /No changes waiting to download/);
    await openCatalogAdvanced(page); await page.locator('#browse-target').selectOption('claude-code');
    await page.locator('#starting-sets-note').filter({ hasText: /^4 more starting sets in this framework need items the Catalog does not mark supported for claude-code\./ }).waitFor();
    const whole = page.locator('#starting-sets-list .wb-starting-set').filter({ hasText: 'claude-code whole workflow convenience template' });
    assert.equal(await page.locator('#starting-sets-list .wb-starting-set').count(), 2, 'only the claude-code sets');
    assert.match(await whole.locator('.wb-starting-set-brings').textContent(), /^46 skills, 4 agents, 2 commands, plus 2 supporting files; 3 hooks optional$/);
    await whole.getByRole('button', { name: 'Add all for my tool: claude-code whole workflow convenience template' }).click();
    await page.locator('#added-notice-message').filter({ hasText: 'Added claude-code whole workflow convenience template to your setup: 46 skills, 4 agents, 2 commands, plus 2 supporting files.' }).waitFor();
    assert.equal((await policy(page)).metadata['aih.workbench'].pins.length, 55, 'the set and everything it requires, in one step');
    assert.equal(await page.locator('#your-setup').textContent(), 'Your setup (1)');
    // An item the set brought in is in the setup as a needed item: its card says who needs it and offers no second Add (#134).
    await page.locator('#catalog-search').fill('grill-me');
    const grillMe = page.locator('#cards-grid [data-card-id$="/extensions.matt.grill-me"] button').filter({ hasText: /^In your setup/ });
    assert.equal(await grillMe.textContent(), 'In your setup (needed by claude-code whole workflow convenience template)');
    assert.equal(await grillMe.isDisabled(), true);
    await page.locator('#added-notice-undo').click();
    await page.locator('#added-notice-message').filter({ hasText: /^Undone: claude-code whole workflow convenience template is no longer in your setup\.$/ }).waitFor();
    assert.equal(await page.locator('#policy-current-context').textContent(), idle, 'Undo returns the status bar to the exact prior state');
    await page.getByRole('button', { name: 'Add extensions.matt.grill-me', exact: true }).waitFor();
    await page.locator('#catalog-search').fill('');
    await page.locator('#added-notice-dismiss').click();
    // Hooks (#135): not cards; a Hooks section offers the ones for Your tool, with the command each runs. The Catalog
    // publishes no command, so each row says so and asks for the reviewed command through the configuration editor.
    assert.equal(await page.locator('#cards-grid [data-card-id$="/extensions.claude.hook.git-guard"]').count(), 0, 'a hook is not a card');
    const hookRows = page.locator('#hooks-list .wb-hook');
    assert.equal(await hookRows.count(), 3);
    for (const text of await hookRows.allInnerTexts()) {
      assert.match(text, /Command it runs\s+The Catalog does not publish the command this hook runs\./);
      assert.doesNotMatch(text, /For claude-code|kiro/);
    }
    const gitGuard = hookRows.filter({ hasText: 'Claude Code: git-guard hook group' });
    await gitGuard.getByRole('textbox', { name: 'hookCommand for Claude Code: git-guard hook group' }).fill('node "$CLAUDE_PROJECT_DIR/.aih-extensions/source/hooks/git-guard.mjs"');
    await gitGuard.getByRole('button', { name: 'Add with this command' }).click();
    await page.locator('#added-notice-message').filter({ hasText: /^Added Claude Code: git-guard hook group/ }).waitFor();
    assert.equal(await gitGuard.getByRole('button', { name: 'Added: Claude Code: git-guard hook group' }).isDisabled(), true);
    const installHook = page.locator('#install-hooks .wb-install-hook');
    assert.equal(await installHook.textContent(), 'Claude Code: git-guard hook group runs this command' + 'node "$CLAUDE_PROJECT_DIR/.aih-extensions/source/hooks/git-guard.mjs"'
      + "claude-code will run this command each time the hook's event happens. The Catalog does not say which event that is.");
    await page.locator('#added-notice-undo').click();
    await page.locator('#added-notice-message').filter({ hasText: /^Undone: Claude Code: git-guard hook group is no longer in your setup\.$/ }).waitFor();
    assert.equal(await page.locator('#install-hooks .wb-install-hook').count(), 0);
    await page.locator('#added-notice-dismiss').click();
    await openCatalogAdvanced(page); await page.locator('#browse-target').selectOption('kiro-ide');
    assert.equal(await page.locator('#hooks').isHidden(), true, 'no Hooks section for a tool with no hooks here');
    await openCatalogAdvanced(page); await page.locator('#browse-target').selectOption('claude-code');
    await openCatalogAdvanced(page); await page.locator('#browse-target').selectOption('');
    await openCatalogAdvanced(page); await page.locator('#rail-scope-list button').filter({ hasText: 'Extensions' }).first().click();
    await chooseFramework(page, 'ECC');
    assert.ok(await page.getByRole('button', { name: 'Add ecc.skill.accessibility', exact: true }).isVisible(), 'Changing families clears the alternate rail filter.');
    await chooseFramework(page, 'Extensions');
    const before = await page.locator('#policy-bytes').textContent();
    await chooseSupport(page, 'unknown'); assert.match(await page.locator('#support-counts').textContent(), /with unknown facts/);
    await chooseSupport(page, 'all'); assert.equal(await page.locator('#policy-bytes').textContent(), before);
    await choosePersonalFolder(page, invalid);
    await page.locator('#personal-result').filter({ hasText: 'LOCAL_FOLDER_INVALID' }).waitFor();
    await choosePersonalFolder(page, folder);
    await page.locator('#personal-result').filter({ hasText: 'Folder validated' }).waitFor();
    // A GitHub repository needs an exact commit: a branch name is refused before anything is fetched, and nothing is added (#125).
    await page.locator('#your-sources-github-repository').fill('mattpocock/skills');
    await page.locator('#your-sources-github-commit').fill('main');
    await page.locator('#your-sources-github-path').fill('skills/productivity');
    await page.locator('#your-sources-github-add').click();
    await page.locator('#your-sources-github-result').filter({ hasText: 'needs an exact commit' }).waitFor();
    assert.match(await page.locator('#your-sources-github-result').textContent(), /nothing was fetched/);
    // The folder is one of Your sources, named by the folder, with its skill as a card (#124).
    await page.locator('#your-sources-list section h2').filter({ hasText: /^personal$/ }).waitFor();
    assert.deepEqual(await page.locator('#your-sources-rail button span.truncate').allInnerTexts(), ['personal']);
    assert.equal(await page.locator('#your-sources-list [data-card-id]').count(), 1);
    assert.equal(await page.locator('#framework-list button[data-family="Personal"]').count(), 0, 'a folder is never a framework');
    // Its Advanced home, the Family list, still lists the same content.
    await chooseFamily(page, 'Personal');
    assert.equal(await page.locator('#cards-grid [data-card-id]').count(), 1);
    await page.locator('#your-sources-nav').click();
    await page.locator('#your-sources-list [data-card-id]').click();
    assert.match(await page.locator('#details-source').textContent(), /Local folder explicitly selected/);
    assert.match(await page.locator('#details-capabilities').textContent(), /native-execution/);
    assert.match(await page.locator('#details-capabilities').textContent(), /automatic-guardrails/);
    await page.screenshot({ path: join(output, 'personal-inspector.png'), fullPage: true });
    const selections = [['Personal', 'personal.skill.example'], ['Extensions', 'extensions.matt.ask-matt'], ['ECC', 'ecc.skill.accessibility'], ['Superpowers', 'superpowers.skill.brainstorming'], ['Anthropic', 'anthropic.skill.academy-guide']];
    for (const [family, id] of selections) {
      if (family === 'Personal') { await page.locator('#your-sources-rail button').filter({ hasText: 'personal' }).click(); await addFromCatalog(page, id, '#your-sources-list'); }
      else { await page.locator('#nav-sources').click(); await chooseFramework(page, family); await addFromCatalog(page, id); }
      await closePolicyDrawer(page);
    }
    const saved = await policy(page); assert.equal(saved.metadata['aih.workbench'].roots.length, 5);
    assert.doesNotMatch(JSON.stringify(saved), /grantId|x-aih-client|hostPath/);
    await openSetupAdvanced(page).then(() => page.locator('#check-project-policy').click()); await page.locator('#policy-status').filter({ hasText: 'Policy and exact sources validated' }).waitFor();
    const download = page.waitForEvent('download'); await openPolicyDrawer(page); await openSetupAdvanced(page).then(() => page.locator('#policy-save').click());
    const savedPath = join(output, 'policy.downloaded.json'); await (await download).saveAs(savedPath);
    const policyBytes = new Uint8Array(await readFile(savedPath));
    await page.screenshot({ path: join(output, 'policy-saved.png'), fullPage: true });
    // A reload ends the page session's grant: Your sources says plainly that the folder needs choosing again.
    await page.reload(); await page.locator('#browse-family option[value="Extensions"]').waitFor({ state: 'attached' });
    assert.equal(await page.locator('#browse-family option[value="Personal"]').count(), 0);
    await page.locator('#your-sources-rail button').filter({ hasText: 'choose again' }).filter({ hasText: 'personal' }).click();
    await page.locator('#your-sources-list').getByRole('button', { name: 'Choose personal again', exact: true }).waitFor();
    assert.match(await page.locator('#your-sources-list').textContent(), /can't read personal any more/);
    const fresh = await pageSetup(await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } }));
    assert.equal(await fresh.locator('#browse-family option[value="Personal"]').count(), 0);
    await openPolicyWorkspace(fresh); await openPolicyFileActions(fresh); await fresh.locator('#policy-open').setInputFiles(savedPath);
    await drawer(fresh).getByRole('button', { name: 'Validate and reopen', exact: true }).click();
    await fresh.locator('#policy-status').filter({ hasText: 'SOURCE_REVISION_UNAVAILABLE' }).waitFor();
    assert.equal(await fresh.locator('#policy-save').isDisabled(), true);
    await fresh.locator('#nav-sources').click(); assert.equal(await fresh.locator('#personal-binding option').count(), 2);
    await writeFile(join(folder, 'skills/example/support/checklist.txt'), 'Changed content.\n');
    await choosePersonalFolder(fresh, folder);
    await fresh.locator('#personal-result').filter({ hasText: 'LOCAL_ROOT_CHANGED' }).waitFor();
    assert.deepEqual(await policy(fresh), saved);
    await writeFile(join(folder, 'skills/example/support/checklist.txt'), sources['skills/example/support/checklist.txt']);
    let releaseCatalog, observedCatalog; const gate = new Promise(resolve => { releaseCatalog = resolve; }); const observedGate = new Promise(resolve => { observedCatalog = resolve; });
    await fresh.route('**/api/authoring-catalog', async route => { const response = await route.fetch(); observedCatalog(); await gate; await route.fulfill({ response }); });
    await choosePersonalFolder(fresh, folder); await observedGate;
    assert.doesNotMatch(await fresh.locator('#personal-result').textContent(), /Exact folder rebound/);
    releaseCatalog(); await fresh.locator('#personal-result').filter({ hasText: 'Exact folder rebound' }).waitFor(); await fresh.unroute('**/api/authoring-catalog');
    await openPolicyWorkspace(fresh); await openPolicyFileActions(fresh); await drawer(fresh).getByRole('button', { name: 'Validate and reopen', exact: true }).click();
    await fresh.locator('#policy-status').filter({ hasText: 'Saved choices recovered' }).waitFor();
    assert.deepEqual((await policy(fresh)).metadata['aih.workbench'].roots, saved.metadata['aih.workbench'].roots);
    assert.deepEqual((await policy(fresh)).selections, saved.selections);
    const personal = await intakePersonalFolder({ files: Object.entries(sources).map(([path, text]) => ({ path, bytes: [...new TextEncoder().encode(text)] })) }); assert.equal(personal.status, 'ok');
    const maintained = await readInstalledRelease({ root: dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'))), sourceInput: 'maintained' });
    const headless = await readAuthoring({ policyBytes, inventories: [{ release: maintained.release, materialSource: { kind: 'local', input: 'maintained' } }, ...await installedFamilies(), personal.value] });
    assert.equal(headless.value.editing, 'available', JSON.stringify(headless));
    assert.deepEqual(headless.value.intent.roots, saved.metadata['aih.workbench'].roots); assert.deepEqual(headless.value.policy.selections, saved.selections);
    await assert.rejects(access(marker)); assert.deepEqual(errors, []); assert.deepEqual(failedResponses, []);
    await fresh.screenshot({ path: join(output, 'fresh-rebound.png'), fullPage: true });
    await writeFile(join(output, 'browser-evidence.json'), JSON.stringify({ status: 'passed', entry: '/', chromium: browser.version(), roots: saved.metadata['aih.workbench'].roots,
      scenarios: ['existing-shell', 'four-installed-families', 'matt-extensions', 'target-support-facts', 'filters-preserve-artifact', 'invalid-folder', 'local-provenance', 'five-root-proposals', 'actual-policy-download', 'fresh-reopen-refused', 'changed-root-refused', 'explicit-exact-rebind', 'catalog-ready-before-success', 'headless-agreement', 'no-code-executed'], errors }, null, 2));
    console.log(`Integrated ordinary Workbench journey passed: ${output}`);
  } catch (error) {
    await observed?.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {});
    await writeFile(join(output, 'failure.json'), JSON.stringify({ error: error.message, errors, text: await observed?.locator('body').innerText().catch(() => '') }, null, 2)); throw error;
  } finally { await browser.close(); }
}
