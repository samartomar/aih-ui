// Ordinary Workbench journey: an unresolved draft is opened, edited, saved as a journey
// envelope, reopened in a fresh page and compiled for its resolved choices only.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInstalledRelease } from '@aihq/catalog/node';
import { readAuthoring, openDraft } from './headless.mjs';
import { installedFamilies } from './installed-families.mjs';
import { closePolicyDrawer, openPolicyAdvanced, openPolicyFileActions } from './policy-drawer.mjs';

const PERSONAL = 'personal.skill.example', MAINTAINED = ['mattpocock.grill-with-docs', 'mattpocock.code-review'];

export async function runUnresolvedDraftBrowser({ origin, output, playwrightModule }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  const folder = join(output, 'personal');
  const sources = {
    LICENSE: 'MIT License\nCopyright 2026 Example\nPermission is hereby granted, free of charge.\n',
    'skills/example/SKILL.md': '---\nname: example\ndescription: Keep personal choices understandable.\nlicense: MIT\n---\n\nUse support/checklist.txt.\n',
    'skills/example/support/checklist.txt': 'Preserve exact choices and truthful origins.\n',
  };
  for (const [path, text] of Object.entries(sources)) { await mkdir(dirname(join(folder, path)), { recursive: true }); await writeFile(join(folder, path), text); }
  const maintained = await readInstalledRelease({ root: dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'))), sourceInput: 'maintained' });
  const maintainedInventory = { release: maintained.release, materialSource: { kind: 'local', input: 'maintained' } };
  const browser = await chromium.launch({ headless: true });
  const errors = [], failedResponses = []; let observed;
  const openPage = async () => {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(); observed = page; page.setDefaultTimeout(30_000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 500) failedResponses.push(`${response.status()} ${response.url()}`); });
    await page.goto(origin + '/');
    await page.locator('#browse-family option[value="Catalog"]').waitFor({ state: 'attached' });
    if (await page.locator('#setup-dialog').isVisible()) {
      await page.getByRole('radio', { name: /Vibe coder/ }).check();
      for (let step = 0; step < 4; step++) await page.locator('#setup-next').click();
      await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
    }
    return page;
  };
  const choose = async (page, family, id) => {
    await page.locator('#nav-sources').click(); await page.locator('#browse-support').selectOption('all'); await page.locator('#browse-family').selectOption(family);
    await closePolicyDrawer(page); await page.getByRole('button', { name: `Choose ${id}`, exact: true }).click();
    await page.locator('#policy-accept:not([disabled])').waitFor(); await page.locator('#policy-accept').click();
  };
  const download = async (page, trigger, path) => { const event = page.waitForEvent('download'); await trigger(); await (await event).saveAs(path); return new Uint8Array(await readFile(path)); };
  const shownChoices = page => page.locator('#policy-draft-roots > div').evaluateAll(rows => rows.map(row => [row.dataset.itemId, row.dataset.status]));
  const sameBytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
  try {
    // Context A: choose a personal skill and a maintained item with a dependency, then save the policy.
    const authoring = await openPage();
    await authoring.locator('#personal-folder').setInputFiles(folder);
    await authoring.locator('#personal-result').filter({ hasText: 'Folder validated' }).waitFor();
    await choose(authoring, 'Personal', PERSONAL);
    await choose(authoring, 'Catalog', MAINTAINED[0]);
    const savedPath = join(output, 'policy.downloaded.json');
    const policyBytes = await download(authoring, () => authoring.locator('#policy-save').click(), savedPath);
    const saved = JSON.parse(new TextDecoder().decode(policyBytes));
    assert.deepEqual(saved.metadata['aih.workbench'].roots.map(root => root.itemId).sort(), [PERSONAL, MAINTAINED[0]].sort());

    // Context B: the personal source is not rebound, so its choice reopens as unresolved with nothing dropped.
    const fresh = await openPage();
    assert.equal(await fresh.locator('#browse-family option[value="Personal"]').count(), 0);
    await fresh.locator('#nav-policy').click(); await openPolicyFileActions(fresh); await fresh.locator('#policy-open').setInputFiles(savedPath);
    await fresh.getByRole('button', { name: 'Validate and reopen', exact: true }).click();
    await fresh.locator('#policy-draft-status').filter({ hasText: 'Unresolved draft opened' }).waitFor();
    assert.deepEqual((await shownChoices(fresh)).sort(), [[MAINTAINED[0], 'resolved'], [PERSONAL, 'unresolved']].sort());
    const personalRow = fresh.locator(`#policy-draft-roots > div[data-item-id="${PERSONAL}"]`);
    assert.match(await personalRow.textContent(), /Unresolved — source unavailable/);
    assert.match(await fresh.locator('#policy-draft-note').textContent(), /not an executable policy/);
    await openPolicyAdvanced(fresh); assert.equal(await fresh.getByRole('button', { name: 'Prepare exact effects', exact: true }).isDisabled(), true);
    assert.match(await fresh.locator('#policy-host-status').textContent(), /not an executable policy/);
    assert.equal(await fresh.locator('#policy-save').isDisabled(), true);
    const original = await download(fresh, () => fresh.getByRole('button', { name: 'Download original artifact', exact: true }).click(), join(output, 'policy.original.downloaded.json'));
    assert.ok(sameBytes(original, policyBytes), 'The original artifact stays byte-identical.');
    await fresh.screenshot({ path: join(output, '01-unresolved-open.png'), fullPage: true });

    // A safe edit keeps the unresolved choice and adds a maintained item through the draft operations.
    await choose(fresh, 'Catalog', MAINTAINED[1]);
    await fresh.locator('#policy-draft-status').filter({ hasText: 'Draft change accepted' }).waitFor();
    const edited = await shownChoices(fresh);
    assert.deepEqual(edited.map(([id]) => id).sort(), [PERSONAL, ...MAINTAINED].sort());
    assert.equal(edited.find(([id]) => id === PERSONAL)[1], 'unresolved');
    await fresh.screenshot({ path: join(output, '02-edited.png'), fullPage: true });
    assert.match(await fresh.locator('#policy-draft-save-note').textContent(), /not executable/);
    const envelopePath = join(output, 'policy.draft.journey.json');
    const envelopeBytes = await download(fresh, () => fresh.locator('#policy-draft-save').click(), envelopePath);
    const envelope = JSON.parse(new TextDecoder().decode(envelopeBytes));
    assert.equal(envelope.schema, 'urn:aihq:workbench:journey-envelope:1.0.0');
    assert.equal(envelope.executable, false);
    assert.ok(!('selections' in envelope), 'An envelope carries no execution policy of its own.');
    assert.ok(sameBytes(Buffer.from(envelope.savedIntent.base64, 'base64'), policyBytes), 'The envelope keeps the exact original policy bytes.');
    assert.deepEqual(envelope.records[0].intent.roots.map(root => root.itemId).sort(), [PERSONAL, ...MAINTAINED].sort());

    // Context C: a fresh page opens the envelope with the same meaning.
    const reopened = await openPage();
    await reopened.locator('#nav-policy').click(); await openPolicyFileActions(reopened); await reopened.locator('#policy-open').setInputFiles(envelopePath);
    await reopened.locator('#policy-draft-status').filter({ hasText: 'Unresolved draft opened' }).waitFor();
    assert.deepEqual(await shownChoices(reopened), edited);
    const headless = await openDraft({ bytes: envelopeBytes, inventories: [maintainedInventory, ...await installedFamilies()] });
    assert.equal(headless.status, 'ok', JSON.stringify(headless.diagnostics));
    assert.equal(headless.value.editing, 'unresolved');
    assert.deepEqual(headless.value.roots.map(root => [root.itemId, root.status]), edited);
    assert.deepEqual(headless.value.intent, envelope.records[0].intent);
    assert.ok(sameBytes(headless.value.savedIntentBytes, policyBytes));
    const again = await download(reopened, () => reopened.getByRole('button', { name: 'Download original artifact', exact: true }).click(), join(output, 'policy.original.reopened.json'));
    assert.ok(sameBytes(again, policyBytes), 'The envelope reopens to the original policy bytes.');
    await reopened.screenshot({ path: join(output, '03-saved-reopened.png'), fullPage: true });

    // Whole-draft compile is refused up front with the blocking reference; resolved choices compile on their own.
    assert.equal(await reopened.locator('#policy-draft-compile-all').isDisabled(), true, 'Whole-draft compile is unavailable while a choice is unresolved.');
    const compileNote = await reopened.locator('#policy-draft-compile-note').textContent();
    assert.match(compileNote, /whole draft cannot be compiled yet/);
    assert.match(compileNote, /SCOPE_UNRESOLVED/);
    assert.match(compileNote, new RegExp(PERSONAL));
    assert.equal(await reopened.locator('#policy-save').isDisabled(), true);
    await reopened.screenshot({ path: join(output, '04-compile-refused.png'), fullPage: true });
    await reopened.locator('#policy-draft-compile-resolved').click();
    await reopened.locator('#policy-draft-status').filter({ hasText: 'now the current executable policy' }).waitFor();
    const compiledBytes = new TextEncoder().encode(await reopened.locator('#policy-bytes').textContent());
    const compiled = await readAuthoring({ policyBytes: compiledBytes, inventories: [maintainedInventory] });
    assert.equal(compiled.status, 'ok', JSON.stringify(compiled));
    assert.equal(compiled.value.editing, 'available', JSON.stringify(compiled.value.diagnostics));
    assert.deepEqual(compiled.value.intent.roots.map(root => root.itemId).sort(), [...MAINTAINED].sort());
    assert.match(await reopened.locator('#policy-host-status').textContent(), /Execution is not connected/);
    await openPolicyAdvanced(reopened); assert.equal(await reopened.getByRole('button', { name: 'Prepare exact effects', exact: true }).isDisabled(), true);
    assert.equal(await reopened.locator('#policy-draft-save').isEnabled(), true);
    await reopened.screenshot({ path: join(output, '05-compile-allowed.png'), fullPage: true });
    // Replacing a choice is a safe draft edit too; changing the draft withdraws the compiled policy.
    await reopened.getByRole('combobox', { name: `Replacement for ${MAINTAINED[1]}`, exact: true }).selectOption({ label: 'Grilling · Catalog' });
    await reopened.getByRole('button', { name: `Replace ${MAINTAINED[1]}`, exact: true }).click();
    await reopened.locator('#policy-accept:not([disabled])').waitFor(); await reopened.locator('#policy-accept').click();
    await reopened.locator('#policy-draft-status').filter({ hasText: 'Draft change accepted' }).waitFor();
    assert.deepEqual((await shownChoices(reopened)).map(([id]) => id).sort(), [PERSONAL, MAINTAINED[0], 'mattpocock.grilling'].sort());
    assert.match(await reopened.locator('#policy-summary').textContent(), /not executable/);
    assert.deepEqual(errors, []); assert.deepEqual(failedResponses, []);
    await writeFile(join(output, 'unresolved-draft-evidence.json'), JSON.stringify({ status: 'passed', entry: '/', chromium: browser.version(), choices: edited,
      compiledRoots: compiled.value.intent.roots.map(root => root.itemId), envelopeRevision: envelope.revision.sequence,
      scenarios: ['unresolved-markers', 'nothing-dropped', 'safe-edit', 'envelope-not-executable', 'exact-original-bytes', 'fresh-reopen-same-meaning', 'headless-agreement',
        'whole-compile-refused', 'resolved-compile-allowed', 'prepare-gated', 'replace-withdraws-compiled'], errors }, null, 2));
    console.log(`Unresolved draft journey passed: ${output}`);
  } catch (error) {
    await observed?.screenshot({ path: join(output, 'unresolved-draft-failure.png'), fullPage: true }).catch(() => {});
    await writeFile(join(output, 'unresolved-draft-failure.json'), JSON.stringify({ error: error.message, errors, failedResponses, text: await observed?.locator('body').innerText().catch(() => '') }, null, 2));
    throw error;
  } finally { await browser.close(); }
}
