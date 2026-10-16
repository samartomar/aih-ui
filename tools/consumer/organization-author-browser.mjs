// Organization baseline journey in the running Workbench: an organization author drafts, previews and exports a baseline,
// the export is published to the controlled GitHub fixture by hand, and a developer then consumes it as ordinary authority.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeClientIds } from '@aihq/core/harness';
import { readInstalledRelease } from '@aihq/catalog/node';
import { composeAuthoring, freshAuthoring } from './headless.mjs';
import { readJourneyEnvelope, writeJourneyEnvelope } from './journey.mjs';
import { organizationTargetId } from './organization-draft-record.mjs';

const attacker = { provider: 'github', repository: { owner: 'attacker', name: 'redirect' }, path: 'evil.json', revision: { kind: 'branch', value: 'evil' } };
const redirect = { organizationSource: attacker, source: attacker, repository: attacker.repository, path: attacker.path, revision: attacker.revision };
const IMPLEMENT = 'mattpocock.implement', CODE_REVIEW = 'mattpocock.code-review', TDD = 'mattpocock.tdd', GRILLING = 'mattpocock.grilling';
// A listed client displays as "Label (id)" and an unlisted one as its id, so a target is matched on the id alone.
const targetText = (scope, client, repository = '') => new RegExp(`^${scope} · (?:.* \\()?${client}\\)?${repository ? ` · ${repository.replace(/\./g, '\\.')}` : ''}`);
const PROJECT_TARGET = targetText('project', 'claude', 'github.com/fixture-org/app'), USER_TARGET = targetText('user', 'claude');
const base = '/repos/fixture-org/authority/git/';

// The developer's ordinary Enterprise policy: Implement at project scope (Catalog adds its Code Review dependency),
// carrying metadata that tries to redirect the authority source.
export async function developerPolicyBytes() {
  const root = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
  const installed = await readInstalledRelease({ root, sourceInput: 'maintained' });
  if (!installed.valid) throw Error(JSON.stringify(installed.diagnostics));
  const materials = await Promise.all(installed.release.items.map(item => item.recipe).map(async recipe => ({ ...recipe, bytes: new Uint8Array(await readFile(join(root, recipe.path))) })));
  const inventory = { release: installed.release, materialSource: installed.source, materials };
  const intent = freshAuthoring(), item = installed.release.items.find(item => item.id === IMPLEMENT);
  intent.roots.push({ releaseSha256: installed.release.sha256, itemId: item.id, itemSha256: item.itemSha256, scope: 'project', configuration: { agentDirectory: '.claude' }, originIds: ['direct'] });
  const basePolicyBytes = new TextEncoder().encode(JSON.stringify({ schema: 'urn:aihq:core:execution-policy:1.3.0', mode: 'enterprise', selections: [], metadata: { 'aih.workbench': freshAuthoring() } }));
  const composed = await composeAuthoring({ basePolicyBytes, intent, inventories: [inventory] });
  if (composed.status !== 'ok') throw Error(JSON.stringify(composed));
  const { policy } = composed.value;
  return new TextEncoder().encode(JSON.stringify({ ...policy, metadata: { ...policy.metadata, ...redirect } }));
}

// The status line is the one signal every author action ends with, after the view has re-rendered.
async function settle(page, act) {
  await page.evaluate(() => { document.getElementById('org-status').textContent = ''; });
  await act();
  await page.locator('#org-status:not(:empty)').waitFor();
  return (await page.locator('#org-status').textContent()).trim();
}
async function edit(page, act) { assert.match(await settle(page, act), /^Organization draft updated/); }
const entryRow = (page, itemId, scope) => page.locator('#organization-author [data-entry-id]').filter({ has: page.locator('h4', { hasText: `· ${itemId} · ${scope}` }) });
const labelOf = async row => (await row.locator('h4').textContent()).split(' · ')[0];
const targetPreview = (page, text) => page.locator('#org-preview-results [data-preview-target]').filter({ has: page.locator('h4', { hasText: text }) });
const section = async (target, name) => (await target.locator(`[data-section="${name}"] pre`).textContent()).trim();
// The page scrolls inside its panes, so each capture first brings the evidence it exists to show into view.
async function shot(page, output, name, evidence) {
  await evidence.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, name + '.png'), fullPage: true });
}
async function download(page, click, path) {
  const [file] = await Promise.all([page.waitForEvent('download'), click()]);
  await file.saveAs(path); return new Uint8Array(await readFile(path));
}
const readDraft = page => page.evaluate(() => ({
  policyId: document.getElementById('org-policy-id').value,
  source: ['owner', 'name', 'path', 'ref'].map(id => document.getElementById(`org-source-${id}`).value),
  entries: [...document.querySelectorAll('#organization-author [data-entry-id]')].map(row => ({ title: row.querySelector('h4').textContent,
    obligation: row.querySelector('[data-field="obligation"]').value, badge: row.querySelector('[data-field="enforcement"]').textContent,
    inputs: [...row.querySelectorAll('[data-input-name]')].map(input => [input.dataset.inputName, input.querySelector('[data-field="permission-kind"]').value, input.querySelector('[data-field="permission-value"]').value]) })),
  targets: [...document.querySelectorAll('#organization-author [data-target-id]')].map(row => row.querySelector('span').textContent),
  unresolved: [...document.querySelectorAll('#org-unresolved li')].map(item => item.textContent) }));

async function addEntry(page, itemId, scope) {
  const value = await page.locator('#org-add-item option').evaluateAll((options, id) => options.find(option => option.value.endsWith(`/${id}`))?.value, itemId);
  assert.ok(value, `Catalog item ${itemId} is offered`);
  await page.locator('#org-add-item').selectOption(value); await page.locator('#org-add-scope').selectOption(scope);
  await edit(page, () => page.locator('#org-add-entry').click());
}
const setObligation = (page, itemId, scope, obligation) => edit(page, () => entryRow(page, itemId, scope).locator('select[data-field="obligation"]').selectOption(obligation));
async function setFixedInput(page, itemId, scope, name, value) {
  const input = entryRow(page, itemId, scope).locator(`[data-input-name="${name}"]`);
  await input.locator('select[data-field="permission-kind"]').selectOption('fixed'); await input.locator('input[data-field="permission-value"]').fill(value);
  await edit(page, () => input.locator('button[data-action="apply-input"]').click());
}
const addTarget = async (page, scope, client, repository = '') => {
  await page.locator('#org-target-scope').selectOption(scope); if (client) await page.locator('#org-target-client').selectOption(client); await page.locator('#org-target-repository').fill(repository);
  await edit(page, () => page.locator('#org-target-add').click());
};
const preview = async page => assert.match(await settle(page, () => page.locator('#org-preview').click()), /^Core preview returned candidate status/);

export async function runOrganizationAuthorBrowser({ page, output, fixture, refreshAuthority }) {
  const states = [], methods = [], fetchBefore = globalThis.fetch;
  // The fixture keeps only paths, so the method of every GitHub request is recorded here to show each one is a read.
  globalThis.fetch = (input, options) => {
    if (new URL(typeof input === 'string' || input instanceof URL ? input : input.url).origin === 'https://api.github.com') methods.push((options?.method ?? input?.method ?? 'GET').toUpperCase());
    return fetchBefore(input, options);
  };
  try {
    // 1. The Policy workspace with the configured source; remember the revision developers read today.
    const first = (await refreshAuthority(page)).authority, revisionA = { resolvedCommit: first.resolvedCommit, blobId: first.blobId, contentDigest: first.contentDigest };
    await page.locator('#organization-author > summary').click();

    // 2. A new draft with four entries and two declared targets.
    await edit(page, () => page.locator('#org-draft-new').click());
    await addEntry(page, IMPLEMENT, 'project'); await setObligation(page, IMPLEMENT, 'project', 'required');
    await addEntry(page, CODE_REVIEW, 'project'); await setObligation(page, CODE_REVIEW, 'project', 'prohibited');
    await addEntry(page, TDD, 'user'); await setObligation(page, TDD, 'user', 'required');
    await addEntry(page, GRILLING, 'project'); await setObligation(page, GRILLING, 'project', 'recommended');
    for (const [itemId, scope] of [[IMPLEMENT, 'project'], [TDD, 'user'], [GRILLING, 'project']]) await setFixedInput(page, itemId, scope, 'agentDirectory', '.claude');
    // Both pickers offer Core-supported ids only; entry clients allow multiple choices.
    assert.deepEqual(await page.locator('#org-target-client option').evaluateAll(options => options.map(option => option.value).filter(Boolean)), [...nativeClientIds]);
    const clients = entryRow(page, IMPLEMENT, 'project').locator('select[data-field="clients"]');
    assert.equal(await clients.getAttribute('multiple'), '');
    assert.deepEqual(await clients.locator('option').evaluateAll(options => options.map(option => option.value)), [...nativeClientIds]);
    await clients.selectOption(['claude', 'codex']);
    await edit(page, () => entryRow(page, IMPLEMENT, 'project').locator('[data-action="apply-selectors"]').click());
    assert.deepEqual(await clients.evaluate(control => [...control.selectedOptions].map(option => option.value)), ['claude', 'codex']);
    await clients.selectOption([]);
    await edit(page, () => entryRow(page, IMPLEMENT, 'project').locator('[data-action="apply-selectors"]').click());
    await addTarget(page, 'project', 'claude', 'github.com/fixture-org/app'); await addTarget(page, 'user', 'claude');
    // Removing a row keeps keyboard focus in the list: it moves to the same action on the row now in that place.
    await addTarget(page, 'project', 'codex');
    const removable = page.locator('#organization-author [data-target-id]').filter({ hasText: targetText('project', 'codex') }).locator('button[data-action="remove-target"]');
    await removable.focus(); await edit(page, () => page.keyboard.press('Enter'));
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.action ?? document.activeElement?.id), 'remove-target');
    const implement = await labelOf(entryRow(page, IMPLEMENT, 'project')), codeReview = await labelOf(entryRow(page, CODE_REVIEW, 'project')), tdd = await labelOf(entryRow(page, TDD, 'user'));
    states.push('drafted');

    // 3. Policy id and source stay unset and are listed as open choices; the draft survives Save and Open.
    const unresolved = (await readDraft(page)).unresolved;
    assert.equal(unresolved.length, 2, unresolved.join('\n'));
    assert.match(await page.locator('#org-unresolved').textContent(), /policy id/i); assert.match(await page.locator('#org-unresolved').textContent(), /GitHub repository, path and ref/);
    const before = await readDraft(page), draftPath = join(output, 'organization-draft.journey.json');
    await download(page, () => page.locator('#org-draft-save').click(), draftPath);
    await edit(page, () => page.locator('#org-draft-new').click());
    assert.equal((await readDraft(page)).entries.length, 0);
    assert.match(await settle(page, () => page.locator('#org-draft-open').setInputFiles(draftPath)), /^Organization draft updated/);
    assert.deepEqual(await readDraft(page), before);
    assert.deepEqual(before.entries.map(entry => [entry.obligation, entry.badge]), [['required', 'Enforced'], ['prohibited', 'Enforced'], ['required', 'Enforced'], ['recommended', 'Advisory']]);
    // Old saved client facts stay visible and labelled; opening does not rewrite them.
    const read = await readJourneyEnvelope(new Uint8Array(await readFile(draftPath)));
    assert.equal(read.status, 'ok');
    const records = structuredClone(read.value.records), record = records.find(record => record.id === 'organization-draft');
    record.entries[0].clients = ['not-a-client']; record.targets[0].client = 'not-a-client';
    record.targets[0].id = await organizationTargetId(record.targets[0]);
    const legacy = await writeJourneyEnvelope({ savedIntentBytes: read.value.savedIntentBytes, records, previous: read.value });
    assert.equal(legacy.status, 'ok');
    const legacyPath = join(output, 'organization-legacy-client.journey.json'); await writeFile(legacyPath, legacy.value.envelopeBytes);
    assert.match(await settle(page, () => page.locator('#org-draft-open').setInputFiles(legacyPath)), /unknown-client/);
    const unknown = entryRow(page, IMPLEMENT, 'project').locator('select[data-field="clients"] option[value="not-a-client"]');
    // The option's own disabled and selected state is read: Playwright's isDisabled does not report a disabled <option>.
    assert.deepEqual(await unknown.evaluate(option => [option.disabled, option.selected]), [true, true]); assert.match(await unknown.textContent(), /not known to Core/);
    assert.match(await page.locator('#organization-author [data-target-id]').first().textContent(), /not-a-client.*Not known to the installed Core/);
    await preview(page); assert.match(await page.locator('#org-preview-results').textContent(), /Candidate: invalid[\s\S]*unknown-client/);
    const keptPath = join(output, 'organization-legacy-client-saved.journey.json');
    assert.deepEqual(await download(page, () => page.locator('#org-draft-save').click(), keptPath), legacy.value.envelopeBytes);
    await edit(page, () => page.locator('#org-draft-open').setInputFiles(draftPath));
    assert.deepEqual(await readDraft(page), before);
    states.push('reopened-unresolved'); await shot(page, output, 'organization-draft-unresolved', page.locator('#org-unresolved'));

    // 4. Preview: Core finds the contradiction on the project target and the unsupported control on the user target.
    await preview(page);
    assert.match(await page.locator('#org-preview-results').textContent(), /Candidate: incomplete/);
    const project = targetPreview(page, PROJECT_TARGET), user = targetPreview(page, USER_TARGET);
    assert.equal(await project.count(), 1); assert.equal(await user.count(), 1);
    assert.match(await section(project, 'contradictions'), new RegExp(`${codeReview} is required by ${implement}`));
    const enforced = await section(project, 'enforced');
    assert.match(enforced, /Admitted: false/); assert.match(enforced, /prohibited/);
    const projectFulfillment = await section(project, 'fulfillment');
    assert.match(projectFulfillment, new RegExp(`^${implement}: \\S+`, 'm'));
    const unsupported = await section(user, 'unsupported');
    assert.ok(unsupported.includes(tdd), unsupported); assert.match(unsupported, /Required control unavailable/);
    states.push('preview-contradiction'); await shot(page, output, 'organization-preview-contradiction', project.locator('[data-section="contradictions"]'));

    // 5. Export is refused while choices are open, and again while the candidate contradicts itself.
    const unresolvedRefusal = await settle(page, () => page.locator('#org-export').click());
    assert.match(unresolvedRefusal, /ORGANIZATION_DRAFT_UNRESOLVED/); assert.equal(await page.locator('#org-export-download').count(), 0);
    await page.locator('#org-policy-id').fill('fixture-baseline'); await edit(page, () => page.locator('#org-policy-id-apply').click());
    await page.locator('#org-source-owner').fill(fixture.source.repository.owner); await page.locator('#org-source-name').fill(fixture.source.repository.name);
    await page.locator('#org-source-path').fill(fixture.source.path); await page.locator('#org-source-ref-kind').selectOption(fixture.source.revision.kind); await page.locator('#org-source-ref').fill(fixture.source.revision.value);
    await edit(page, () => page.locator('#org-source-apply').click());
    const contradictionRefusal = await settle(page, () => page.locator('#org-export').click());
    assert.match(contradictionRefusal, /ORGANIZATION_CANDIDATE_CONTRADICTION/); assert.equal(await page.locator('#org-export-download').count(), 0);
    states.push('export-refused');
    await setObligation(page, CODE_REVIEW, 'project', 'permitted'); await setFixedInput(page, CODE_REVIEW, 'project', 'agentDirectory', '.claude');
    assert.deepEqual((await readDraft(page)).unresolved, []);
    await preview(page);
    assert.match(await page.locator('#org-preview-results').textContent(), /Candidate: valid/);
    for (const target of [project, user]) assert.equal(await section(target, 'contradictions'), 'None reported.');
    assert.match(await section(project, 'enforced'), /Admitted: true/);
    const consistentFulfillment = await section(project, 'fulfillment');
    assert.match(consistentFulfillment, new RegExp(`^${implement}: \\S+`, 'm'));
    states.push('preview-consistent'); await shot(page, output, 'organization-preview-consistent', project.locator('[data-section="fulfillment"]'));

    // 6. Export hands over repository, path, ref and steps; nothing here publishes, signs or authenticates.
    const activation = await settle(page, () => page.locator('#org-export').click());
    assert.match(activation, /does not publish or activate/);
    assert.equal((await page.locator('#org-handoff-repository').textContent()).trim(), 'fixture-org/authority');
    assert.equal((await page.locator('#org-handoff-path').textContent()).trim(), 'policy/organization.json');
    assert.equal((await page.locator('#org-handoff-ref').textContent()).trim(), 'refs/heads/main');
    assert.match(await page.locator('#org-handoff-git').textContent(), /git clone https:\/\/github\.com\/fixture-org\/authority\.git[\s\S]*git push -u origin/);
    assert.match(await page.locator('#org-handoff-pr').textContent(), /gh pr create --repo fixture-org\/authority/);
    assert.match(await page.locator('#org-handoff-activation').textContent(), /does not publish or activate this candidate/);
    const controls = await page.locator('#organization-author button').allTextContents();
    assert.deepEqual(controls.filter(text => /publish|sign|authenticat/i.test(text)), [], controls.join('\n'));
    const candidate = await download(page, () => page.locator('#org-export-download').click(), join(output, 'fixture-baseline.organization-policy.json'));
    const candidateDocument = JSON.parse(new TextDecoder().decode(candidate));
    assert.equal(candidateDocument.schema, 'urn:aihq:core:organization-policy:1.1.0'); assert.equal(candidateDocument.id, 'fixture-baseline');
    states.push('exported'); await shot(page, output, 'organization-export-handoff', page.locator('#org-handoff-git'));

    // 7. Exporting activated nothing: developers still read revision A, and only the configured repository was read.
    const unchanged = (await refreshAuthority(page)).authority;
    assert.deepEqual({ resolvedCommit: unchanged.resolvedCommit, blobId: unchanged.blobId, contentDigest: unchanged.contentDigest }, revisionA);
    assert.ok(fixture.requests.every(path => path.startsWith(base)), fixture.requests.join('\n')); assert.deepEqual([...new Set(methods)], ['GET']);
    states.push('not-activated');

    // 8. Once the candidate is merged (published to the fixture) the same developer page reads revision B and consumes it.
    fixture.publish(candidateDocument);
    const second = (await refreshAuthority(page)).authority, revisionB = { resolvedCommit: second.resolvedCommit, blobId: second.blobId, contentDigest: second.contentDigest };
    for (const key of Object.keys(revisionB)) assert.notEqual(revisionB[key], revisionA[key], key);
    assert.equal((await page.locator('#authority-source-policy').textContent()).trim(), 'fixture-baseline');
    states.push('published');
    const policyPath = join(output, 'developer-policy.json'); await writeFile(policyPath, await developerPolicyBytes());
    await page.locator('#policy-open').setInputFiles(policyPath);
    await page.getByRole('button', { name: 'Validate and reopen', exact: true }).click();
    await page.locator('#policy-status').filter({ hasText: 'Saved choices recovered' }).waitFor();
    const prepared = page.waitForResponse(response => response.url().endsWith('/api/authoring-prepare') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Prepare exact effects', exact: true }).click();
    const review = await (await prepared).json();
    assert.equal(review.status, 'ready', JSON.stringify(review));
    const apply = page.getByRole('button', { name: 'Approve and Apply reviewed effects', exact: true });
    await apply.and(page.locator(':not([disabled])')).waitFor();
    await page.locator('#authority-source-review[data-review="current"]').waitFor();
    for (const key of Object.keys(revisionB)) assert.equal(review.review.inputs.organization[key], revisionB[key], key);
    assert.ok(fixture.requests.every(path => path.startsWith(base)), fixture.requests.join('\n')); assert.deepEqual([...new Set(methods)], ['GET']);
    states.push('developer-consumes'); await shot(page, output, 'organization-developer-consumes', page.locator('#authority-source-review'));

    const summary = { states, revisions: { A: revisionA, B: revisionB }, candidatePolicyId: candidateDocument.id, projectFulfillment: consistentFulfillment, fixtureRequests: fixture.requests.length, liveNetwork: false };
    await writeFile(join(output, 'organization-author-summary.json'), JSON.stringify(summary, null, 2));
    return summary;
  } catch (error) {
    await page.screenshot({ path: join(output, 'organization-author-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally { globalThis.fetch = fetchBefore; }
}
