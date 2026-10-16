// Ordinary Workbench journey: declare a workspace with members and a relationship, bind local checkouts deliberately
// (a fork needs confirmation and is not confirmed, different worktrees stay different bindings, a moved checkout is
// rebound with confirmation), save and reopen, export for sharing without any local binding, and open a declaration of
// a version this Workbench does not support read-only. Every repository is a controlled local fixture created here:
// nothing real is inspected and nothing is fetched. The fixture remote carries a fake credential so the journey can show
// that it never reaches a page, a response, a saved draft or a shared export.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInstalledRelease } from '@aihq/catalog/node';
import { listItems } from '@aihq/catalog/reader';
import { composeAuthoring, freshAuthoring, openDraft, stable } from './headless.mjs';
import { digestBytes } from './intake.mjs';
import { installedFamilies } from './installed-families.mjs';
import { WORKSPACE_DECLARATION_RECORD_SCHEMA, LOCAL_BINDING_RECORD_SCHEMA } from './workspace-record.mjs';

const decode = bytes => new TextDecoder().decode(bytes), encode = value => new TextEncoder().encode(value);
const ROOT = 'mattpocock.implement';
const SAVED_REASON = 'guided-setup rules 1.0.0: goal.build. Goal: add tests to my app. Project: JavaScript.';
const TOKEN = 'fixture-token';
const READS = ['read', 'draft-open', 'maintenance-check', 'improvements-check', 'workspace-read'];
const WORKSPACE_WRITES = ['workspace-edit', 'workspace-bind', 'workspace-unbind'];
const ALLOWED = [...READS, 'workspace-edit', 'workspace-plan', 'workspace-bind', 'workspace-verify', 'workspace-export'];
// The page shell links its web fonts (static HTML, not the Workspace section): the only requests that may leave the origin.
const SHELL_FONTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const OPENED = /Saved draft reopened|Unresolved draft opened/;
const READ_ONLY = 'This workspace uses a record version this Workbench does not support. It is shown read-only; the original bytes are kept unchanged.';
const SHARE_NOTE = 'Local checkout bindings, absolute paths and credentials are not included.';
const FORK_REASON = "The checkout's remote is a fork: same name under a different owner.";
const MOVED_REASON = 'This member was bound to a different folder; confirm the checkout moved.';
const VERIFIED = 'Verified: matches the recorded checkout';
const UNVERIFIED = 'Not verified since opening — select Verify checkouts';
const NOT_FOUND = 'Checkout not found — it may have moved; rebind it';

// Git on controlled fixtures only: no network, no global writes, no console window.
function git(cwd, ...args) {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
    cwd, encoding: 'utf8', windowsHide: true, timeout: 30_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } });
  assert.equal(result.status, 0, `git ${args[0]}: ${result.stderr}`);
  return result.stdout.trim();
}
async function makeFixtures(area) {
  await mkdir(area, { recursive: true });
  const repo = async (name, remote) => {
    const folder = join(area, name); await mkdir(folder);
    git(folder, 'init', '-q', '-b', 'main'); git(folder, 'remote', 'add', 'origin', remote);
    git(folder, 'commit', '-q', '--allow-empty', '-m', `${name} fixture commit`);
    return { folder, revision: git(folder, 'rev-parse', 'HEAD') };
  };
  const api = await repo('api', `https://user:${TOKEN}@github.com/acme/api.git`);
  const forkRepo = await repo('ui-fork', 'https://github.com/someone-else/ui.git');
  const ui = await repo('ui', 'https://github.com/acme/ui.git');
  const linked = join(area, 'api-wt');
  git(api.folder, 'worktree', 'add', '-q', '-b', 'linked', linked);
  return { api, fork: forkRepo, ui, linked, relocated: join(area, 'relocated', 'ui-checkout') };
}
// The envelope with its digest recomputed after a headless edit, as an explicit setup step (never a Workbench action).
async function resign(bytes, mutate) {
  const doc = JSON.parse(decode(bytes));
  mutate(doc);
  const { sha256: _omitted, ...revision } = doc.revision;
  doc.revision.sha256 = await digestBytes(encode(stable({ ...doc, revision })));
  return encode(JSON.stringify(doc, null, 2) + '\n');
}

export async function runWorkspaceBrowser({ origin, output, playwrightModule }) {
  const { chromium } = await import(playwrightModule);
  await mkdir(output, { recursive: true });
  // Explicit setup step: the draft guided setup would have saved, built headlessly (as the improvements journey does).
  const maintained = await readInstalledRelease({ root: dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'))), sourceInput: 'maintained' });
  const inventories = [{ release: maintained.release, materialSource: { kind: 'local', input: 'maintained' } }, ...await installedFamilies()];
  const root = listItems(maintained.release).find(item => item.id === ROOT);
  assert.ok(root, `${ROOT} is offered by the installed Catalog.`);
  const intent = { ...freshAuthoring(), roots: [{ releaseSha256: maintained.release.sha256, itemId: ROOT, itemSha256: root.itemSha256, scope: 'project', configuration: {},
    originIds: ['direct'], reason: SAVED_REASON }] };
  const composed = await composeAuthoring({ intent, inventories });
  assert.equal(composed.status, 'ok', JSON.stringify(composed.diagnostics));
  const opened = await openDraft({ bytes: composed.value.policyBytes, inventories });
  assert.equal(opened.status, 'ok', JSON.stringify(opened.diagnostics));
  const importPath = join(output, 'guided-setup.draft.json');
  await writeFile(importPath, opened.value.envelopeBytes);
  // A fresh area per run; the folder name is unique so a leaked path of any form is recognizable.
  const unique = `ws-${randomBytes(6).toString('hex')}`, area = join(output, 'fixtures', unique);
  const fixtures = await makeFixtures(area);
  const pathForms = folder => [folder, folder.replaceAll('\\', '/'), JSON.stringify(folder).slice(1, -1), JSON.stringify(folder.replaceAll('\\', '/')).slice(1, -1)];
  const leaks = bytes => {
    const text = decode(bytes), lower = text.toLowerCase();
    return [...pathForms(area), unique].filter(form => lower.includes(form.toLowerCase())).concat(text.includes(TOKEN) ? [TOKEN] : []);
  };

  const browser = await chromium.launch({ headless: true });
  const errors = [], failedResponses = [], popups = [], outside = [], bodies = [];
  let observed, operations = [];
  const openPage = async () => {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1100 } });
    const page = await context.newPage(); observed = page; page.setDefaultTimeout(30_000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('popup', popup => popups.push(popup.url()));
    page.on('response', response => {
      if (response.status() >= 500) failedResponses.push(`${response.status()} ${response.url()}`);
      // Every service answer is kept so the journey can prove none of them carries the credential.
      if (new URL(response.url()).pathname.startsWith('/api/')) bodies.push(response.text().then(text => ({ url: response.url(), text }), () => ({ url: response.url(), text: '' })));
    });
    page.on('request', request => {
      const url = new URL(request.url());
      if (/^https?:$/.test(url.protocol) && url.origin !== new URL(origin).origin && !(request.method() === 'GET' && SHELL_FONTS.includes(url.hostname))) outside.push(`${request.method()} ${request.url()}`);
      const operation = /\/api\/authoring-([\w-]+)$/.exec(url.pathname)?.[1];
      if (operation && request.method() === 'POST') operations.push(operation);
    });
    await page.goto(origin + '/');
    await page.locator('#browse-family option[value="Catalog"]').waitFor({ state: 'attached' });
    if (await page.locator('#setup-dialog').isVisible()) {
      await page.getByRole('radio', { name: /Vibe coder/ }).check();
      for (let step = 0; step < 4; step++) await page.locator('#setup-next').click();
      await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
    }
    return page;
  };
  const download = async (page, trigger, path) => { const event = page.waitForEvent('download'); await trigger(); await (await event).saveAs(path); return new Uint8Array(await readFile(path)); };
  const section = page => page.locator('#policy-repositories');
  const input = (page, label) => section(page).locator(`input[aria-label="${label}"]`);
  const select = (page, label) => section(page).locator(`select[aria-label="${label}"]`);
  const card = (page, id) => section(page).locator(`[data-member-id="${id}"]`);
  const rows = (page, id) => card(page, id).locator(':scope > div');
  const button = (scope, name) => scope.getByRole('button', { name, exact: true });
  const sectionText = page => section(page).innerText();
  // A request is settled when its answer arrived and the section left "Reading workspace…".
  const idle = page => page.waitForFunction(() => !/Reading workspace/.test(document.querySelector('#policy-repositories [role="status"]')?.textContent ?? ''));
  const act = async (page, operation, trigger) => {
    const from = operations.length, answered = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/api/authoring-${operation}`));
    await trigger(); await answered; await idle(page);
    return operations.slice(from).filter(name => name.startsWith('workspace-'));
  };
  const openSaved = async (page, path) => {
    operations = [];
    await page.locator('#nav-policy').click(); await page.locator('#policy-open').setInputFiles(path);
    await page.getByRole('button', { name: 'Validate and reopen', exact: true }).click();
    await page.locator('#policy-draft-status').filter({ hasText: OPENED }).waitFor();
    await page.waitForFunction(() => /Declare workspace|Workspace choice|revision|WORKSPACE_VERSION_UNSUPPORTED/.test(document.querySelector('#policy-repositories')?.textContent ?? ''));
    await idle(page);
    return [...operations];
  };
  const shot = async (page, name, { whole = false } = {}) => {
    // The page scrolls inside its own panes, so the window is made tall enough to show the whole section. The Workspace
    // section is captured readably; the whole page only where its place among the other sections matters.
    await section(page).scrollIntoViewIfNeeded();
    await page.setViewportSize({ width: 1440, height: 3200 });
    await section(page).scrollIntoViewIfNeeded();
    await (whole ? page : section(page)).screenshot({ path: join(output, name) });
    await page.setViewportSize({ width: 1440, height: 1100 });
    return name;
  };
  const noToken = async page => assert.ok(!(await page.locator('body').innerText()).includes(TOKEN), 'The credential is never shown.');
  const records = (envelopeBytes, schema) => JSON.parse(decode(envelopeBytes)).records.filter(record => record.schema === schema);
  const memberForm = async (page, member) => {
    await input(page, 'Member id').fill(member.id); await input(page, 'Remote identity').fill(member.identity);
    for (const field of ['responsibilities', 'instructions', 'contracts']) {
      await select(page, `${field} status`).selectOption(member[field] ? 'known' : 'unresolved');
      await input(page, `${field} (comma-separated)`).fill(member[field] ?? '');
    }
  };
  const steps = {}, screenshots = [];
  try {
    // 1. Open a saved policy as a draft: the Workspace section offers to declare, and opening only reads.
    const first = await openPage();
    steps.open = await openSaved(first, importPath);
    assert.deepEqual(steps.open.filter(operation => !READS.includes(operation)), [], 'Opening may only read.');
    assert.ok(steps.open.includes('workspace-read'));
    await section(first).scrollIntoViewIfNeeded();
    assert.match(await section(first).locator('h3').innerText(), /^Workspace$/);
    await button(section(first), 'Declare workspace').waitFor();
    assert.equal(await button(section(first), 'Declare workspace').isEnabled(), true);
    assert.equal(await section(first).locator('p[role="status"]').innerText(), '');
    screenshots.push(await shot(first, '1-declare-control.png'), await shot(first, '1-declare-control-page.png', { whole: true }));

    // 2. Declare a workspace with two members; the unknown fields stay unresolved and the relationship map is unresolved.
    await input(first, 'Workspace label').fill('Acme platform');
    steps.declare = await act(first, 'workspace-edit', () => button(section(first), 'Declare workspace').click());
    assert.deepEqual(steps.declare, ['workspace-edit']);
    await button(section(first), 'Save member').waitFor();
    await memberForm(first, { id: 'api', identity: 'github.com/acme/api', responsibilities: 'HTTP API', instructions: 'AGENTS.md', contracts: 'openapi/api.yaml' });
    steps.apiMember = await act(first, 'workspace-edit', () => button(section(first), 'Save member').click());
    await memberForm(first, { id: 'ui', identity: 'github.com/acme/ui' });
    steps.uiMember = await act(first, 'workspace-edit', () => button(section(first), 'Save member').click());
    assert.deepEqual([...steps.apiMember, ...steps.uiMember], ['workspace-edit', 'workspace-edit']);
    const apiText = await card(first, 'api').innerText(), uiText = await card(first, 'ui').innerText();
    assert.match(apiText, /^api: github\.com\/acme\/api/);
    assert.match(apiText, /responsibilities: Known: HTTP API/); assert.match(apiText, /instructions: Known: AGENTS\.md/); assert.match(apiText, /contracts: Known: openapi\/api\.yaml/);
    assert.match(uiText, /^ui: github\.com\/acme\/ui/);
    for (const field of ['responsibilities', 'instructions', 'contracts']) assert.match(uiText, new RegExp(`${field}: Unresolved`));
    assert.ok(!/Known:/.test(uiText), 'No ui field is claimed known.');
    const noRelationships = await sectionText(first);
    assert.ok(noRelationships.includes('Relationships: unresolved — 0 confirmed so far; this map may be incomplete.'), noRelationships);
    assert.doesNotMatch(noRelationships, /declared complete by the owner/);
    assert.match(await section(first).locator('p[role="status"]').innerText(), /Workspace choice recorded\. Save the draft to keep it\./);
    screenshots.push(await shot(first, '2-declared-unresolved.png'));

    // 3. One confirmed relationship still leaves the map unresolved, never complete.
    await select(first, 'From member').selectOption('ui'); await select(first, 'To member').selectOption('api');
    await select(first, 'Relationship kind').selectOption('consumes-api'); await select(first, 'Provenance kind').selectOption('owner');
    steps.relationship = await act(first, 'workspace-edit', () => button(section(first), 'Add relationship').click());
    assert.deepEqual(steps.relationship, ['workspace-edit']);
    const oneRelationship = await sectionText(first);
    assert.ok(oneRelationship.includes('ui → api: consumes-api; owner'), oneRelationship);
    assert.ok(oneRelationship.includes('Relationships: unresolved — 1 confirmed so far; this map may be incomplete.'), oneRelationship);
    assert.doesNotMatch(oneRelationship, /declared complete by the owner/);
    screenshots.push(await shot(first, '3-relationship-unresolved.png'));

    // 4. Inspect the api checkout: ready, then bind. The row shows what was observed and never the credential.
    await input(first, 'Checkout folder for api').fill(fixtures.api.folder);
    steps.inspectApi = await act(first, 'workspace-plan', () => button(card(first, 'api'), 'Inspect checkout').click());
    assert.deepEqual(steps.inspectApi, ['workspace-plan']);
    assert.equal(await rows(first, 'api').count(), 0, 'Inspecting binds nothing.');
    assert.equal(await button(card(first, 'api'), 'Bind checkout').count(), 1);
    assert.equal(await button(card(first, 'api'), 'Confirm and bind').count(), 0);
    steps.bindApi = await act(first, 'workspace-bind', () => button(card(first, 'api'), 'Bind checkout').click());
    assert.deepEqual(steps.bindApi, ['workspace-bind']);
    assert.equal(await rows(first, 'api').count(), 1);
    const short = fixtures.api.revision.slice(0, 12), apiRow = await rows(first, 'api').first().innerText();
    assert.ok(apiRow.includes(`Repository: github.com/acme/api; revision: ${short}; branch: main; worktree: main; clean`), apiRow);
    assert.ok(apiRow.toLowerCase().includes(fixtures.api.folder.toLowerCase()), 'The binding shows the selected checkout folder.');
    assert.match(apiRow, /Result: matched/); assert.ok(apiRow.includes(VERIFIED), `Binding verifies the fresh observation: ${apiRow}`);
    await noToken(first);
    screenshots.push(await shot(first, '4-api-bound.png'));

    // 5. A linked worktree of the same repository is a second, different binding.
    await input(first, 'Checkout folder for api').fill(fixtures.linked);
    steps.inspectLinked = await act(first, 'workspace-plan', () => button(card(first, 'api'), 'Inspect checkout').click());
    assert.equal(await button(card(first, 'api'), 'Bind checkout').count(), 1, 'A different worktree is a new binding, not a confirmation.');
    steps.bindLinked = await act(first, 'workspace-bind', () => button(card(first, 'api'), 'Bind checkout').click());
    assert.deepEqual(steps.bindLinked, ['workspace-bind']);
    assert.equal(await rows(first, 'api').count(), 2);
    const worktrees = await rows(first, 'api').evaluateAll(nodes => nodes.map(node => /worktree: (\w+)/.exec(node.innerText)?.[1]));
    assert.deepEqual([...worktrees].sort(), ['linked', 'main']);
    const linkedRow = (await rows(first, 'api').allInnerTexts()).find(text => text.includes('worktree: linked'));
    assert.ok(linkedRow.includes('branch: linked') && linkedRow.includes(`revision: ${short}`) && linkedRow.toLowerCase().includes(fixtures.linked.toLowerCase()), linkedRow);
    await noToken(first);
    screenshots.push(await shot(first, '5-two-worktrees.png'));

    // 6. A fork needs confirmation: nothing is bound until "Confirm and bind", and it is not confirmed here.
    await input(first, 'Checkout folder for ui').fill(fixtures.fork.folder);
    steps.inspectFork = await act(first, 'workspace-plan', () => button(card(first, 'ui'), 'Inspect checkout').click());
    assert.deepEqual(steps.inspectFork, ['workspace-plan']);
    const forkText = await card(first, 'ui').innerText();
    assert.ok(forkText.includes(FORK_REASON), forkText);
    assert.ok(forkText.includes('github.com/someone-else/ui'), forkText);
    assert.equal(await button(card(first, 'ui'), 'Confirm and bind').count(), 1);
    assert.equal(await button(card(first, 'ui'), 'Bind checkout').count(), 0, 'A fork is never bound without confirmation.');
    assert.equal(await rows(first, 'ui').count(), 0, 'No binding exists for the fork.');
    assert.ok(!steps.inspectFork.includes('workspace-bind'));
    screenshots.push(await shot(first, '6-fork-needs-confirmation.png'));
    // Declined: the real checkout is inspected instead and is ready.
    await input(first, 'Checkout folder for ui').fill(fixtures.ui.folder);
    steps.inspectUi = await act(first, 'workspace-plan', () => button(card(first, 'ui'), 'Inspect checkout').click());
    const uiPlan = await card(first, 'ui').innerText();
    assert.ok(!uiPlan.includes(FORK_REASON) && !uiPlan.includes('someone-else'), 'The declined fork plan is gone.');
    assert.equal(await button(card(first, 'ui'), 'Bind checkout').count(), 1);
    assert.equal(await button(card(first, 'ui'), 'Confirm and bind').count(), 0);
    steps.bindUi = await act(first, 'workspace-bind', () => button(card(first, 'ui'), 'Bind checkout').click());
    assert.deepEqual(steps.bindUi, ['workspace-bind']);
    assert.equal(await rows(first, 'ui').count(), 1);
    assert.ok((await rows(first, 'ui').first().innerText()).includes(`Repository: github.com/acme/ui; revision: ${fixtures.ui.revision.slice(0, 12)}; branch: main; worktree: main; clean`));
    assert.ok(!(await sectionText(first)).includes('someone-else'), 'The fork was never bound.');
    screenshots.push(await shot(first, '7-ui-bound-after-declining-fork.png'));

    // 7. Save the draft, reopen it in a fresh page: members, relationship and bindings are back, unverified until Verify.
    const savedPath = join(output, 'workspace.draft.json');
    const savedBytes = await download(first, () => first.locator('#policy-draft-save').click(), savedPath);
    assert.equal(records(savedBytes, WORKSPACE_DECLARATION_RECORD_SCHEMA).length, 1);
    assert.equal(records(savedBytes, LOCAL_BINDING_RECORD_SCHEMA).length, 3, 'The local draft keeps its bindings.');
    assert.deepEqual(leaks(savedBytes).filter(leak => leak === TOKEN), [], 'The saved draft never holds the credential.');
    const reopened = await openPage();
    steps.reopen = await openSaved(reopened, savedPath);
    assert.deepEqual(steps.reopen.filter(operation => !READS.includes(operation)), [], 'Reopening only reads.');
    const back = await sectionText(reopened);
    assert.ok(back.includes('Acme platform'), back);
    assert.match(await card(reopened, 'api').innerText(), /^api: github\.com\/acme\/api/); assert.match(await card(reopened, 'ui').innerText(), /^ui: github\.com\/acme\/ui/);
    assert.ok(back.includes('ui → api: consumes-api; owner'));
    assert.ok(back.includes('Relationships: unresolved — 1 confirmed so far; this map may be incomplete.'));
    assert.equal(await rows(reopened, 'api').count(), 2); assert.equal(await rows(reopened, 'ui').count(), 1);
    for (const text of [...await rows(reopened, 'api').allInnerTexts(), ...await rows(reopened, 'ui').allInnerTexts()]) assert.ok(text.includes(UNVERIFIED), text);
    screenshots.push(await shot(reopened, '8-reopened-unverified.png'));
    steps.verify = await act(reopened, 'workspace-verify', () => button(section(reopened), 'Verify checkouts').click());
    assert.deepEqual(steps.verify, ['workspace-verify']);
    for (const text of [...await rows(reopened, 'api').allInnerTexts(), ...await rows(reopened, 'ui').allInnerTexts()]) assert.ok(text.includes(VERIFIED) && !text.includes(UNVERIFIED), text);
    assert.equal(await rows(reopened, 'api').count() + await rows(reopened, 'ui').count(), 3);
    await noToken(reopened);
    screenshots.push(await shot(reopened, '9-verified.png'));

    // 8. The ui folder moves on disk: Verify reports it missing; rebinding the new folder needs the moved confirmation.
    await mkdir(join(area, 'relocated'), { recursive: true });
    await rename(fixtures.ui.folder, fixtures.relocated);
    steps.verifyMoved = await act(reopened, 'workspace-verify', () => button(section(reopened), 'Verify checkouts').click());
    assert.deepEqual(steps.verifyMoved, ['workspace-verify']);
    const missing = await rows(reopened, 'ui').first().innerText();
    assert.ok(missing.includes(NOT_FOUND), missing);
    for (const text of await rows(reopened, 'api').allInnerTexts()) assert.ok(text.includes(VERIFIED), 'The other checkouts are still verified.');
    screenshots.push(await shot(reopened, '10-checkout-not-found.png'));
    await input(reopened, 'Checkout folder for ui').fill(fixtures.relocated);
    steps.inspectMoved = await act(reopened, 'workspace-plan', () => button(rows(reopened, 'ui').first(), 'Rebind (moved)').click());
    assert.deepEqual(steps.inspectMoved, ['workspace-plan']);
    const movedText = await card(reopened, 'ui').innerText();
    assert.ok(movedText.includes(MOVED_REASON), movedText);
    assert.equal(await button(card(reopened, 'ui'), 'Confirm and bind').count(), 1);
    assert.equal(await rows(reopened, 'ui').count(), 1, 'The old binding stays until the move is confirmed.');
    screenshots.push(await shot(reopened, '11-moved-needs-confirmation.png'));
    steps.rebind = await act(reopened, 'workspace-bind', () => button(card(reopened, 'ui'), 'Confirm and bind').click());
    assert.deepEqual(steps.rebind, ['workspace-bind']);
    assert.equal(await rows(reopened, 'ui').count(), 1, 'The old row is replaced, not duplicated.');
    const movedRow = await rows(reopened, 'ui').first().innerText();
    assert.ok(movedRow.toLowerCase().includes(fixtures.relocated.toLowerCase()), movedRow);
    assert.ok(!movedRow.toLowerCase().includes(fixtures.ui.folder.toLowerCase() + '\n') && !movedRow.includes(NOT_FOUND), movedRow);
    assert.match(movedRow, /Result: confirmed/); assert.ok(movedRow.includes(MOVED_REASON));
    assert.ok(!(await sectionText(reopened)).includes(NOT_FOUND), 'Nothing is left missing.');
    screenshots.push(await shot(reopened, '12-rebound.png'));

    // 9. Export for sharing: the file carries the declaration, and no binding, folder or credential in any form.
    const exportPath = join(output, 'workspace.share.json');
    let exported;
    steps.export = await act(reopened, 'workspace-export', async () => { exported = await download(reopened, () => button(section(reopened), 'Export for sharing').click(), exportPath); });
    assert.deepEqual(steps.export, ['workspace-export']);
    const exportedText = decode(exported);
    assert.ok(!exportedText.includes('local-binding'), 'No local-binding record is exported.');
    assert.deepEqual(leaks(exported), [], 'No folder of any form and no credential is exported.');
    assert.ok(exportedText.includes(WORKSPACE_DECLARATION_RECORD_SCHEMA) && exportedText.includes('github.com/acme/api') && exportedText.includes('github.com/acme/ui'));
    assert.equal(records(exported, LOCAL_BINDING_RECORD_SCHEMA).length, 0);
    assert.equal(records(exported, WORKSPACE_DECLARATION_RECORD_SCHEMA).length, 1);
    assert.ok((await sectionText(reopened)).includes(SHARE_NOTE));
    assert.equal(await rows(reopened, 'ui').count(), 1, 'Exporting leaves the local bindings in the open draft.');
    screenshots.push(await shot(reopened, '13-exported-note.png'));
    // The local draft after the move still holds bindings; only it is used for the unsupported-version setup below.
    const currentBytes = await download(reopened, () => reopened.locator('#policy-draft-save').click(), join(output, 'workspace-moved.draft.json'));
    assert.equal(records(currentBytes, LOCAL_BINDING_RECORD_SCHEMA).length, 3);

    // 10. A declaration of a version this Workbench does not support opens read-only, and the page writes nothing.
    const futurePath = join(output, 'unsupported-version.draft.json');
    const futureSchema = WORKSPACE_DECLARATION_RECORD_SCHEMA.replace(/:1\.0\.0$/, ':2.0.0');
    const future = await resign(currentBytes, doc => { for (const record of doc.records) if (record.schema === WORKSPACE_DECLARATION_RECORD_SCHEMA) record.schema = futureSchema; });
    assert.ok(decode(future).includes(':workspace-declaration:2.0.0'));
    await writeFile(futurePath, future);
    const unsupportedPage = await openPage();
    steps.unsupported = await openSaved(unsupportedPage, futurePath);
    assert.deepEqual(steps.unsupported.filter(operation => !READS.includes(operation)), [], 'Opening an unsupported version only reads.');
    const notice = await sectionText(unsupportedPage);
    assert.ok(notice.includes(READ_ONLY), notice); assert.ok(notice.includes('WORKSPACE_VERSION_UNSUPPORTED'), notice);
    assert.equal(await section(unsupportedPage).locator('button:enabled, input:enabled, select:enabled').count(), 0, 'Every workspace control is disabled.');
    const disabledControls = await section(unsupportedPage).locator('button, input, select').count();
    // Attempting each visible action changes nothing: disabled controls cannot start a request.
    for (const control of await section(unsupportedPage).locator('button').all()) await control.click({ force: true, timeout: 2000 }).catch(() => {});
    await unsupportedPage.waitForTimeout(300);
    assert.deepEqual(operations.filter(operation => WORKSPACE_WRITES.concat(['workspace-plan', 'workspace-verify', 'workspace-export']).includes(operation)), [], 'The page made no workspace write request.');
    screenshots.push(await shot(unsupportedPage, '14-unsupported-read-only.png'), await shot(unsupportedPage, '14-unsupported-read-only-page.png', { whole: true }));
    const keptBytes = await download(unsupportedPage, () => unsupportedPage.locator('#policy-draft-save').click(), join(output, 'unsupported-version.saved.json'));
    // Saving adds a revision (as for any draft); the unsupported declaration and every binding are carried verbatim.
    assert.deepEqual(records(keptBytes, futureSchema), records(future, futureSchema), 'The unsupported record is carried unchanged.');
    assert.equal(records(keptBytes, futureSchema).length, 1); assert.equal(records(keptBytes, WORKSPACE_DECLARATION_RECORD_SCHEMA).length, 0);
    assert.deepEqual(records(keptBytes, LOCAL_BINDING_RECORD_SCHEMA), records(future, LOCAL_BINDING_RECORD_SCHEMA), 'The bindings are carried unchanged.');

    // The whole run: only expected operations, same-origin only, no popups, no page errors, no 5xx, no credential in any answer.
    const answered = await Promise.all(bodies);
    for (const { url, text } of answered) assert.ok(!text.includes(TOKEN), `No service answer carries the credential: ${new URL(url).pathname}`);
    assert.deepEqual(outside, []); assert.deepEqual(popups, []); assert.deepEqual(errors, []); assert.deepEqual(failedResponses, []);
    await writeFile(join(output, 'workspace-evidence.json'), JSON.stringify({ status: 'passed', entry: '/', chromium: browser.version(), screenshots, operations: steps,
      binding: { worktrees, apiRevision: short }, export: { bytes: exported.length, bindingRecords: 0, leaks: 0, note: SHARE_NOTE },
      unsupported: { disabledControls, writeRequests: 0, recordsCarriedUnchanged: true }, serviceAnswersChecked: answered.length, errors, failedResponses }, null, 2));
    console.log(`Workspace journey passed: ${output}`);
    await rm(join(output, 'fixtures'), { recursive: true, force: true });
  } catch (error) {
    await observed?.screenshot({ path: join(output, 'workspace-failure.png'), fullPage: true }).catch(() => {});
    await writeFile(join(output, 'workspace-failure.json'), JSON.stringify({ error: error.message, errors, failedResponses, outside, operations: steps,
      text: (await observed?.locator('body').innerText().catch(() => '') ?? '').replaceAll(TOKEN, '[token]') }, null, 2));
    throw error;
  } finally {
    await browser.close();
  }
}
