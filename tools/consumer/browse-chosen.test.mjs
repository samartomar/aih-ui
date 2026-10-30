// Q6 regression: the card/inspector host read reflects the ARTIFACT's roots (like the drawer), not the
// current set-request resolution; an unavailable host answer is explicit per chosen item, never clean.
// Runs in the consumer context; no host inspection executes (no project folder is supplied).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { readInstalledPreparedContent } from '@aihq/catalog/node';
import { browseContent } from './browse-content.mjs';

const catalogRoot = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
const prepared = await readInstalledPreparedContent({ root: catalogRoot, frameworkId: 'ecc', sourceInput: 'browse-chosen' });
if (!prepared.valid) throw new Error('ECC prepared fixture unavailable');
const inventories = [{ release: prepared.release, family: prepared.release.framework.name, materialSource: { kind: 'local', input: 'browse-chosen' }, materials: [], fixture: 'browse chosen regression' }];
const servers = prepared.release.items.filter(item => item.kind === 'mcp-server');
const skills = prepared.release.items.filter(item => item.kind === 'skill' && !Object.keys(item.inputs ?? {}).length);
const preTicked = prepared.release.sets?.find(set => set.offer === 'pre-ticked');

test('chosen for the host read comes from the artifact roots, not the set request', async () => {
  // No sets selected, but the artifact roots name a server: it must be the chosen host item.
  const byRoots = await browseContent(inventories, { tool: 'claude', releaseSha256: prepared.release.sha256, sets: [], configurations: [], chosen: [servers[0].id] }, undefined, undefined);
  assert.equal(byRoots.status, 'read');
  assert.deepEqual(byRoots.chosenItemIds, [servers[0].id], 'an artifact root is chosen even with no set request');
  assert.equal(byRoots.host.status, 'unavailable');
  assert.match(byRoots.host.reason, /Choose a project folder/, 'the unavailable answer is explicit, never clean');
  // A set request that is NOT in the artifact must not mark its members chosen.
  if (preTicked) {
    const request = { release: { releaseSha256: prepared.release.sha256, scope: 'project' }, setId: preTicked.id, setSha256: preTicked.setSha256, options: {}, members: [] };
    const bySetsOnly = await browseContent(inventories, { tool: 'claude', releaseSha256: prepared.release.sha256, sets: [request], configurations: [], chosen: [skills[0].id] }, undefined, undefined);
    assert.deepEqual(bySetsOnly.chosenItemIds, [skills[0].id], 'unadded set members are not checked as chosen');
  }
});

test('an explicit empty chosen list inspects nothing, never falling back to the set request (Q6-R)', async () => {
  const result = await browseContent(inventories, { tool: 'claude', releaseSha256: prepared.release.sha256, sets: [], configurations: [], chosen: [] }, '/nonexistent-test-project', undefined);
  assert.equal(result.status, 'read');
  assert.deepEqual(result.chosenItemIds, []);
  assert.match(result.host.reason, /Nothing is chosen/, 'explicit emptiness is honored, not replaced by set members');
});

test('the fallback (no artifact roots supplied) keeps the previous set-request behavior', async () => {
  const result = await browseContent(inventories, { tool: 'claude', releaseSha256: prepared.release.sha256, sets: [], configurations: [] }, undefined, undefined);
  assert.equal(result.status, 'read');
  assert.deepEqual(result.chosenItemIds, [], 'without artifact roots the set-request resolution decides, as before');
});

// A card is judged with the items its Add brings ("+ N it needs"), as the Add and the set paths are: Core's
// dependency-missing for a requirement the Add supplies is no blocker, and a blocker Core reports for any of those
// items still holds the card back.
const basics = await readInstalledPreparedContent({ root: catalogRoot, frameworkId: 'project-basics', sourceInput: 'browse-fit' });
const extensions = await readInstalledPreparedContent({ root: catalogRoot, frameworkId: 'extensions', sourceInput: 'browse-fit' });
const fitInventories = [basics, extensions].map(read => ({ release: read.release, family: read.release.framework.name, materialSource: { kind: 'local', input: 'browse-fit' }, materials: [] }));
const fitOf = async (tool, read, itemId) => (await browseContent(fitInventories, { tool, releaseSha256: read.release.sha256, sets: [], configurations: [], chosen: [] }, undefined, undefined))
  .compatibility.items.find(entry => entry.item.itemId === itemId);
const blocked = fit => fit.support === 'none' || Boolean(fit.notRendered) || fit.staticBlockers.length > 0;

test('a card whose requirements its Add brings is judged together with them', async () => {
  for (const itemId of ['project-basics.router', 'project-basics.shared-block']) {
    const fit = await fitOf('claude', basics, itemId);
    assert.equal(blocked(fit), false, `${itemId}: ${JSON.stringify(fit)}`);
  }
  assert.equal(blocked(await fitOf('claude', extensions, 'extensions.hook.git-guard')), false);
});

test('a card with a genuine blocker, its own or a requirement\'s, still does not work', async () => {
  const guard = await fitOf('kiro', extensions, 'extensions.hook.git-guard');
  const codes = guard.staticBlockers.map(blocker => blocker.code);
  assert.ok(codes.includes('protocol-not-spoken'), JSON.stringify(guard));
  assert.ok(!codes.includes('dependency-missing'), 'the notices come with it, so they are not missing');
  // Core cannot place the notices beside a hook Kiro cannot run; its own words say so on the card.
  assert.ok(guard.staticBlockers.some(blocker => blocker.itemId === 'extensions.notices' && /supporting document/.test(blocker.detail)), JSON.stringify(guard.staticBlockers));
  const shared = await fitOf('kiro', basics, 'project-basics.shared-block');
  assert.equal(shared.notRendered?.reason, 'scope-not-bound', JSON.stringify(shared));
  assert.equal(blocked(await fitOf('claude', extensions, 'extensions.notices')), true, 'a supporting document alone is still not a card that works');
});
