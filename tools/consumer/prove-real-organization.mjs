// One finite real repository-backed acceptance batch. No GitHub mutations here.
// An operator advances the independently selected source while this test holds
// a real live preparation. No mocked authority transport or native client calls.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createHost } from 'aih-ui/execution-host';
import { readAuthoring, inspectReviewEvidence, recordReview, composeAuthoring, editAuthoring } from 'aih-ui/authoring';
import { organizationFixture } from './organization-fixture.mjs';
import { startConsumer } from './server.mjs';
const [output, repository, transition = 'wait'] = process.argv.slice(2);
if (!output || !/^[\w-]+\/[\w.-]+$/.test(repository ?? '')) throw Error('Usage: proof output owner/dedicated-private-repository [wait|retained]');
if (!['wait', 'retained'].includes(transition)) throw Error('Choose an explicit transition mode.');
const began = Date.now();
await mkdir(output, { recursive: true });
const capture = async (name, value) => { await writeFile(join(output, `${name}.json`), JSON.stringify(value, null, 2) + '\n'); return value; };
// Explicit test-runner credential acquisition; never printed, persisted or browser supplied.
const credential = process.env.AIH_ORG_TOKEN ?? spawnSync('gh', ['auth', 'token'], { encoding: 'utf8', windowsHide: true }).stdout.trim();
if (!credential) throw Error('Existing GitHub account access is required.');
const controls = { authentication: { kind: 'bearer', token: credential }, logging: 'off' };
const [owner, name] = repository.split('/');
const source = ref => ({ provider: 'github', repository: { owner, name }, path: 'policy/org.json', revision: { kind: 'branch', value: ref } });
const f = await organizationFixture(join(output, 'materials'));
const evidencePaths = [process.env.UI6_NOTE_EVIDENCE, process.env.UI6_CATALOG_EVIDENCE].filter(Boolean);
const reviewEvidence = await Promise.all(evidencePaths.map(async path => new Uint8Array(await readFile(path))));
assert.equal(reviewEvidence.length, 2, 'Supply exact original note and maintained-domain review artifacts.');
let policyBytes = f.policyBytes;
for (const [index, target] of [
  { releaseSha256: f.inventories[1].release.sha256, itemId: 'consumer-proof.review-note' },
  { releaseSha256: f.inventories[0].release.sha256, itemId: 'mattpocock.domain-modeling' }
].entries()) {
  const inventory = f.inventories.find(i => i.release.sha256 === target.releaseSha256);
  const inspected = await inspectReviewEvidence({ evidenceBytes: reviewEvidence[index], inventory, itemId: target.itemId });
  assert.equal(inspected.status, 'ok', JSON.stringify(inspected));
  const reviewed = await recordReview({ policyBytes, inventories: f.inventories, reviewEvidence, evidenceBytes: reviewEvidence[index], target,
    finding: inspected.value.bindings[0].finding, decision: { id: `ui6-organization-review-${index}`, owner: { kind: 'organization', id: 'ui6-test-organization' }, actor: 'test-policy-reviewer', recordedAt: '2026-10-13T21:00:00Z', disposition: index ? 'false-alarm' : 'accepted-risk', reason: 'Bounded test organization review; optional evidence is separate from Core authority.' } });
  assert.equal(reviewed.status, 'ok', JSON.stringify(reviewed)); policyBytes = reviewed.value.policyBytes;
}
await writeFile(join(output, 'reviewed-input.json'), policyBytes);
for (const [i, bytes] of reviewEvidence.entries()) await writeFile(join(output, `original-evidence-${i}.json`), bytes);
const target = join(output, 'enterprise-project'); await mkdir(target, { recursive: true });
await writeFile(join(target, 'unrelated.txt'), 'User-owned unrelated state\n');
await writeFile(join(target, 'unowned.txt'), 'Unowned state\n');
const hostFor = (ref, projectRoot = target, auth = controls) => createHost({ projectRoot, organizationSource: source(ref), materialRoots: f.materialRoots, recipeMaterials: f.recipeMaterials, controls: auth });
const baseRef = transition === 'wait' ? 'main' : 'scenario/admitted';
const direct = hostFor(baseRef);
let browser, started;
const extraServers = [];
const errors = [], cases = [];
try {
  const initial = await capture('initial-current-authority', await direct.inspectAuthority({ policyText: new TextDecoder().decode(policyBytes) }));
  assert.equal(initial.status, 'ok'); assert.equal(initial.value.admitted, true); cases.push('real private GitHub current-authority retrieval and exact Core preview');
  const deniedPolicy = JSON.parse(new TextDecoder().decode(policyBytes));
  deniedPolicy.selections.find(s => s.configuration.agentDirectory).configuration.agentDirectory = '.outside';
  const denied = await capture('denied-configuration', await direct.prepareSession({ policyText: JSON.stringify(deniedPolicy) }));
  assert.equal(denied.status, 'blocked'); assert.ok(denied.diagnostics.some(d => d.code === 'AUTHORITY_DENIED')); cases.push('denied configuration through actual Prepare');
  const extra = f.inventories[0].release.items.find(i => i.id === 'mattpocock.codebase-design');
  const extraChoice = await editAuthoring({ policyBytes, inventories: f.inventories, reviewEvidence, operation: { type: 'select', root: { releaseSha256: f.inventories[0].release.sha256, itemId: extra.id, itemSha256: extra.itemSha256, scope: 'project', configuration: {}, originIds: ['direct'] } } });
  assert.equal(extraChoice.status, 'ok', JSON.stringify(extraChoice));
  const deniedChoice = await capture('denied-choice', await direct.prepareSession({ policyText: new TextDecoder().decode(extraChoice.value.policyBytes) }));
  assert.equal(deniedChoice.status, 'blocked'); assert.ok(deniedChoice.diagnostics.some(d => d.reason === 'selection-not-admitted')); cases.push('unadmitted new choice refused without changing installed state');
  const unavailable = await capture('unavailable-authority', await hostFor(baseRef, target, { logging: 'off', authentication: { kind: 'none' } }).inspectAuthority({ policyText: new TextDecoder().decode(policyBytes) }));
  assert.equal(unavailable.status, 'refused'); assert.ok(unavailable.diagnostics.some(d => d.code === 'AUTHORITY_UNAVAILABLE'));
  const unavailablePrepare = await capture('unavailable-prepare', await hostFor(baseRef, target, { logging: 'off', authentication: { kind: 'none' } }).prepareSession({ policyText: new TextDecoder().decode(policyBytes) }));
  assert.equal(unavailablePrepare.status, 'blocked'); cases.push('real private authority unavailable without credentials; no fallback');
  started = await startConsumer({ projectRoot: target, organizationSource: source(baseRef), controls, suppliedInventories: f.inventories.slice(1) });
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ acceptDownloads: true }); page.setDefaultTimeout(20000); page.on('pageerror', e => errors.push(e.message));
  const clickResult = async (id, operation) => { const response = page.waitForResponse(r => r.url().endsWith(`/api/authoring-${operation}`)); await page.locator(`#${id}`).click(); return (await response).json(); };
  await page.goto(`${started.origin}/authoring`); await page.locator('#summary').filter({ hasText: '"roots"' }).waitFor();
  await page.locator('#open').setInputFiles(join(output, 'reviewed-input.json'));
  await page.locator('#authority-summary').filter({ hasText: 'Advisory preview admits' }).waitFor();
  await page.locator('#review-file').setInputFiles([join(output, 'original-evidence-0.json'), join(output, 'original-evidence-1.json')]);
  await page.locator('#review-facts').filter({ hasText: 'Original evidence bytes loaded' }).waitFor();
  const reopened = await capture('browser-reopen', await clickResult('reopen', 'read')); assert.equal(reopened.value.editing, 'available');
  const downloaded = page.waitForEvent('download'); await page.locator('#save').click(); const savedPath = join(output, 'policy.downloaded.json'); await (await downloaded).saveAs(savedPath);
  const savedBytes = new Uint8Array(await readFile(savedPath)); assert.deepEqual(savedBytes, policyBytes);
  const fresh = await browser.newPage({ acceptDownloads: true }); fresh.setDefaultTimeout(20000); fresh.on('pageerror', e => errors.push(e.message));
  await fresh.goto(`${started.origin}/authoring`); await fresh.locator('#summary').filter({ hasText: '"roots"' }).waitFor();
  await fresh.locator('#open').setInputFiles(savedPath); await fresh.locator('#authority-summary').filter({ hasText: 'Advisory preview admits' }).waitFor();
  await fresh.locator('#review-file').setInputFiles([join(output, 'original-evidence-0.json'), join(output, 'original-evidence-1.json')]);
  await fresh.locator('#review-facts').filter({ hasText: 'Original evidence bytes loaded' }).waitFor();
  await fresh.locator('#reopen').click(); await fresh.locator('#proposal').filter({ hasText: '"editing": "available"' }).waitFor();
  const headless = await readAuthoring({ policyBytes: savedBytes, inventories: f.inventories, reviewEvidence });
  assert.deepEqual(JSON.parse(await fresh.locator('#policy').inputValue()).metadata['aih.workbench'], headless.value.intent);
  assert.ok(headless.value.intent.reviews.records.every(r => r.owner.kind === 'organization')); cases.push('actual download/fresh import/headless agreement; organization reviews for Catalog and BYO');
  const preparation = await capture('browser-prepare', await clickResult('prepare', 'prepare')); assert.equal(preparation.status, 'ready', JSON.stringify(preparation));
  assert.ok(preparation.review.operations.every(o => o.scope === 'project' && o.kind === 'file.write'));
  const applied = await capture('browser-apply', await clickResult('apply', 'apply')); assert.equal(applied.completion, 'complete', JSON.stringify(applied));
  assert.equal(await readFile(join(target, 'unrelated.txt'), 'utf8'), 'User-owned unrelated state\n');
  assert.equal(await readFile(join(target, 'unowned.txt'), 'utf8'), 'Unowned state\n'); cases.push('mixed Enterprise actual file Apply preserves unrelated and unowned state');
  if (transition === 'wait') {
    const stalePreparation = await capture('before-authority-advance', await clickResult('prepare', 'prepare')); assert.equal(stalePreparation.status, 'ready');
    console.log(`PREPARED_WAITING_FOR_AUTHORITY_ADVANCE ${join(output, 'authority-advanced.signal.json')}`);
    const waitDeadline = Date.now() + 120000;
    while (true) {
      try { await access(join(output, 'authority-advanced.signal.json')); break; } catch {}
      if (Date.now() >= waitDeadline) throw Error('Finite authority transition wait expired');
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const stale = await capture('stale-browser-apply', await clickResult('apply', 'apply'));
    assert.equal(stale.completion, 'rejected'); assert.ok(stale.diagnostics.some(d => d.code === 'REVIEW_STALE')); cases.push('real current main advanced between browser Prepare/Apply; Core rejected stale handle');
  }
  const withdrawn = await capture('withdrawn-current-authority', await hostFor('main').inspectAuthority({ policyText: new TextDecoder().decode(policyBytes) }));
  assert.equal(withdrawn.value.admitted, false); assert.equal(withdrawn.value.affectedChoices.length, 1); assert.equal(withdrawn.value.stillValidChoices.length, 4);
  const withdrawalServer = await startConsumer({ projectRoot: target, organizationSource: source('main'), controls, suppliedInventories: f.inventories.slice(1) }); extraServers.push(withdrawalServer.server);
  const withdrawalPage = await browser.newPage({ acceptDownloads: true }); withdrawalPage.setDefaultTimeout(20000); withdrawalPage.on('pageerror', e => errors.push(e.message));
  await withdrawalPage.goto(`${withdrawalServer.origin}/authoring`); await withdrawalPage.locator('#summary').filter({ hasText: '"roots"' }).waitFor();
  await withdrawalPage.locator('#open').setInputFiles(savedPath); await withdrawalPage.locator('#authority-summary').filter({ hasText: '1 affected; 4 still valid' }).waitFor();
  const refreshResponse = withdrawalPage.waitForResponse(r => r.url().endsWith('/api/authoring-authority')); await withdrawalPage.locator('#authority-refresh').click();
  const refreshed = await capture('browser-explicit-authority-refresh', await (await refreshResponse).json());
  assert.equal(refreshed.value.authority.resolvedCommit, withdrawn.value.authority.resolvedCommit);
  const stillOriginal = withdrawalPage.waitForEvent('download'); await withdrawalPage.locator('#save').click(); const originalAfterRefresh = join(output, 'withdrawn.policy.downloaded.json'); await (await stillOriginal).saveAs(originalAfterRefresh);
  assert.deepEqual(new Uint8Array(await readFile(originalAfterRefresh)), policyBytes); cases.push('withdrawn source checked on fresh browser open and explicit Refresh; original policy and organization reviews unchanged');
  const blockedInventoryResponse = withdrawalPage.waitForResponse(r => r.url().endsWith('/api/authoring-managed')); await withdrawalPage.locator('#managed-refresh').click(); await blockedInventoryResponse;
  const blockedRemovalResponse = withdrawalPage.waitForResponse(r => r.url().endsWith('/api/authoring-remove')); await withdrawalPage.getByRole('button', { name: `Review removal ${f.withdrawnSelection.managementId}`, exact: true }).click();
  const browserBlocked = await capture('blocked-browser-recovery', await (await blockedRemovalResponse).json());
  assert.ok(browserBlocked.preparation.diagnostics.some(d => d.code === 'AUTHORITY_DENIED' && d.reason === 'lifecycle-remove'));
  assert.equal(await withdrawalPage.locator('#apply').isDisabled(), true);
  await withdrawalPage.locator('#authority-section').screenshot({ path: join(output, 'withdrawal-browser.png') });
  const blocked = await capture('blocked-recovery', await hostFor('scenario/blocked').prepareRemovalSession({ managementId: f.withdrawnSelection.managementId, scope: 'project', mode: 'enterprise' }));
  assert.notEqual(blocked.disposition, 'invalid');
  assert.ok([...blocked.diagnostics, ...(blocked.preparation?.diagnostics ?? [])].some(d => d.code === 'AUTHORITY_DENIED' && d.reason === 'lifecycle-remove'), JSON.stringify(blocked));
  cases.push('withdrawal affects exactly code-review; blocked removal requires organization action');
  const recovery = hostFor('scenario/recovery');
  // Deliberately edit an owned file: Core must report a conflict and preserve it.
  const originalNote = await readFile(join(target, 'note.md')); await writeFile(join(target, 'note.md'), Buffer.concat([originalNote, Buffer.from('\nUser edit\n')]));
  const changed = await capture('changed-owned-removal', await recovery.prepareRemovalSession({ managementId: f.policy.selections.find(s => s.recipe.reference.path.includes('review-note')).managementId, scope: 'project', mode: 'enterprise' }));
  assert.notEqual(changed.disposition, 'invalid');
  assert.ok([...changed.diagnostics, ...(changed.preparation?.diagnostics ?? [])].some(d => d.code === 'STATE_CONFLICT' && d.reason === 'managed-content-changed'), JSON.stringify(changed));
  assert.match(await readFile(join(target, 'note.md'), 'utf8'), /User edit/);
  // Restore only the exact test-owned edit, then explicitly prepare replacement.
  await writeFile(join(target, 'note.md'), originalNote);
  const currentIntent = structuredClone(headless.value.intent), nextRoot = f.updated.intent.roots.find(r => r.itemId === 'consumer-proof.review-note');
  currentIntent.roots = currentIntent.roots.map(r => r.itemId === nextRoot.itemId ? nextRoot : r);
  currentIntent.origins = f.updated.intent.origins; currentIntent.inputs = currentIntent.inputs.filter(i => i.id !== 'notes');
  const shared = f.inventories[0].release.items.find(i => i.id === 'mattpocock.domain-modeling');
  currentIntent.roots.push({ releaseSha256: f.inventories[0].release.sha256, itemId: shared.id, itemSha256: shared.itemSha256, scope: 'project', configuration: {}, originIds: ['direct'] });
  const updated = await composeAuthoring({ basePolicyBytes: policyBytes, intent: currentIntent, inventories: f.inventories, reviewEvidence });
  assert.equal(updated.status, 'ok', JSON.stringify(updated));
  await writeFile(join(output, 'updated-policy.json'), updated.value.policyBytes);
  const updatedReady = await capture('recovery-replacement-prepare', await recovery.prepareSession({ policyText: new TextDecoder().decode(updated.value.policyBytes) }));
  assert.equal(updatedReady.status, 'ready', JSON.stringify(updatedReady));
  const replaced = await capture('recovery-replacement-apply', await recovery.applyApproved({ sessionId: updatedReady.sessionId, reviewDigest: updatedReady.review.reviewDigest }));
  assert.equal(replaced.completion, 'complete', JSON.stringify(replaced));
  assert.ok(updated.value.intent.reviews.history.some(r => r.id === 'ui6-organization-review-0'));
  assert.equal(updated.value.intent.reviews.records.find(r => r.id === 'ui6-organization-review-1').state, 'current'); cases.push('permitted mixed replacement; affected review history retained and unrelated organization review current');
  const recoveryServer = await startConsumer({ projectRoot: target, organizationSource: source('scenario/recovery'), controls, suppliedInventories: f.inventories.slice(1) }); extraServers.push(recoveryServer.server);
  const recoveryPage = await browser.newPage(); recoveryPage.setDefaultTimeout(20000); recoveryPage.on('pageerror', e => errors.push(e.message));
  await recoveryPage.goto(`${recoveryServer.origin}/authoring`); await recoveryPage.locator('#summary').filter({ hasText: '"roots"' }).waitFor();
  await recoveryPage.locator('#open').setInputFiles(join(output, 'updated-policy.json')); await recoveryPage.locator('#authority-summary').filter({ hasText: 'Advisory preview admits' }).waitFor();
  const inventoryResponse = recoveryPage.waitForResponse(r => r.url().endsWith('/api/authoring-managed')); await recoveryPage.locator('#managed-refresh').click(); await inventoryResponse;
  const removalResponse = recoveryPage.waitForResponse(r => r.url().endsWith('/api/authoring-remove')); await recoveryPage.getByRole('button', { name: `Review removal ${f.withdrawnSelection.managementId}`, exact: true }).click();
  const removal = await capture('permitted-removal-prepare', await (await removalResponse).json());
  assert.equal(removal.preparation?.status, 'ready', JSON.stringify(removal));
  const removalApply = recoveryPage.waitForResponse(r => r.url().endsWith('/api/authoring-apply')); await recoveryPage.locator('#apply:not([disabled])').click();
  const removed = await capture('permitted-removal-apply', await (await removalApply).json());
  assert.equal(removed.completion, 'complete', JSON.stringify(removed));
  const managed = await capture('retained-managed', await recovery.managedInventory());
  assert.ok(managed.selections.some(s => s.managementId.includes('domain-modeling'))); assert.ok(!managed.selections.some(s => s.managementId === f.withdrawnSelection.managementId));
  assert.equal(await readFile(join(target, 'unowned.txt'), 'utf8'), 'Unowned state\n'); cases.push('permitted removal retains still-used shared dependencies and unowned state');
  const trimmed = await editAuthoring({ policyBytes: updated.value.policyBytes, inventories: f.inventories, reviewEvidence,
    operation: { type: 'remove-root', root: nextRoot } });
  assert.equal(trimmed.status, 'ok', JSON.stringify(trimmed));
  assert.ok(trimmed.value.policy.selections.some(s => s.managementId.includes('domain-modeling')));
  const noteManagementId = updated.value.policy.selections.find(s => s.organizationSelectionId === 'ui6-next-note').managementId;
  const removeNote = await capture('byo-removal-prepare', await recovery.prepareRemovalSession({ managementId: noteManagementId, scope: 'project', mode: 'enterprise' }));
  assert.equal(removeNote.preparation?.status, 'ready', JSON.stringify(removeNote));
  assert.equal((await capture('byo-removal-apply', await recovery.applyApproved({ sessionId: removeNote.preparation.sessionId, reviewDigest: removeNote.preparation.review.reviewDigest }))).completion, 'complete');
  await assert.rejects(readFile(join(target, 'note.md')), { code: 'ENOENT' });
  assert.ok((await recovery.managedInventory()).selections.some(s => s.managementId.includes('domain-modeling'))); cases.push('BYO root trim and actual removal preserve explicitly shared Catalog root');
  const vibeTarget = join(output, 'vibe-project'); await mkdir(vibeTarget, { recursive: true });
  const vibe = createHost({ projectRoot: vibeTarget, materialRoots: f.materialRoots, recipeMaterials: f.recipeMaterials, controls: { logging: 'off' } });
  const vibePolicy = { ...f.policy, mode: 'vibe', selections: f.policy.selections.map(({ organizationSelectionId, ...s }) => s) };
  const vibeReady = await capture('vibe-prepare', await vibe.prepareSession({ policyText: JSON.stringify(vibePolicy) })); assert.equal(vibeReady.status, 'ready');
  assert.equal((await capture('vibe-apply', await vibe.applyApproved({ sessionId: vibeReady.sessionId, reviewDigest: vibeReady.review.reviewDigest }))).completion, 'complete');
  const vibeUpdated = { ...f.updated.policy, mode: 'vibe', selections: f.updated.policy.selections.map(({ organizationSelectionId, ...s }) => s) };
  const vibeNext = await vibe.prepareSession({ policyText: JSON.stringify(vibeUpdated) }); assert.equal(vibeNext.status, 'ready');
  assert.equal((await capture('vibe-update', await vibe.applyApproved({ sessionId: vibeNext.sessionId, reviewDigest: vibeNext.review.reviewDigest }))).completion, 'complete');
  const vibeRemove = await vibe.prepareRemovalSession({ managementId: f.withdrawnSelection.managementId, scope: 'project', mode: 'vibe' }); assert.equal(vibeRemove.preparation?.status, 'ready');
  assert.equal((await capture('vibe-removal', await vibe.applyApproved({ sessionId: vibeRemove.preparation.sessionId, reviewDigest: vibeRemove.preparation.review.reviewDigest }))).completion, 'complete'); cases.push('aligned mixed Vibe Prepare/Apply/update/removal through public Core');
  const vibeNote = await vibe.prepareRemovalSession({ managementId: noteManagementId, scope: 'project', mode: 'vibe' }); assert.equal(vibeNote.preparation?.status, 'ready');
  assert.equal((await capture('vibe-byo-removal', await vibe.applyApproved({ sessionId: vibeNote.preparation.sessionId, reviewDigest: vibeNote.preparation.review.reviewDigest }))).completion, 'complete');
  await page.locator('#authority-section').screenshot({ path: join(output, 'authority-browser.png') });
  assert.deepEqual(errors, []);
  await capture('real-organization-summary', { status: 'passed', repository, transition, node: process.version, elapsedMs: Date.now() - began, cases, errors,
    downloadSha256: createHash('sha256').update(policyBytes).digest('hex'), initialAuthority: initial.value.authority, withdrawnAuthority: withdrawn.value.authority,
    limits: ['Dedicated private test repository; no production enforcement or native client execution.', 'Advisory preview is separate from current Core Prepare/Apply.', 'Human review records are portable attribution, not organization authorization.'] });
  console.log('REAL_ORGANIZATION_PROOF_PASSED');
} finally { await browser?.close(); for (const server of extraServers) await new Promise(resolve => server.close(resolve)); if (started) await new Promise(resolve => started.server.close(resolve)); }
