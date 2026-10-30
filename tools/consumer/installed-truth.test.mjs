// Which recorded origins a Workbench install gives its items, from real Catalog content and the public
// composition: a set's own members are owned by the set (configured or not), an item the user also chose directly
// stays chosen, and the two-scope case is attempted for real and reported when this Core cannot produce it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveSelections, readReleaseContent, readReleaseSets } from '@aihq/catalog/reader';
import { createHash } from 'node:crypto';
import { stable } from './primitives.mjs';
import { readFileSync } from 'node:fs';
import { compileReleaseSets } from '@aihq/catalog/producer';
import { composeAuthoring, freshAuthoring } from './headless.mjs';
import * as setChoices from './set-choices.mjs';
import { pinSelectedRecipes } from './selected-recipe.mjs';
import { installedFamilies } from './installed-families.mjs';
import { createHost } from './host.mjs';

// The Workbench's own installed-list grouping, from the checkout AIH_REPO names (check-workbench sets it).
const repo = resolve(process.env.AIH_REPO ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const installedList = await import(pathToFileURL(join(repo, 'src/app/installed-list.js')).href);

const catalogRoot = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
const inventories = await installedFamilies({ root: catalogRoot, sourceInput: 'installed-truth' });
const release = id => inventories.find(entry => entry.release.framework?.id === id);
const requestFor = (entry, setId, scope = 'project') => {
  const set = entry.release.sets.find(candidate => candidate.id === setId);
  assert.ok(set, `Catalog publishes ${setId}`);
  return { release: { releaseSha256: entry.release.sha256, scope }, setId, setSha256: set.setSha256, options: {}, members: [] };
};
const directRoot = (entry, itemId, scope = 'project') => {
  const item = entry.release.items.find(candidate => candidate.id === itemId);
  assert.ok(item, `Catalog publishes ${itemId}`);
  return { releaseSha256: entry.release.sha256, itemId, itemSha256: item.itemSha256, scope, configuration: {}, originIds: ['direct'] };
};
const chooseDirect = (intent, root) => {
  if (!intent.origins.some(origin => origin.id === 'direct')) intent.origins.push({ id: 'direct', kind: 'direct' });
  intent.roots.push(root); pinSelectedRecipes(intent, inventories, root, 'claude');
};
const reasons = origins => origins.map(origin => origin.reasonIncluded === 'in-set' ? `in-set:${origin.set.setId}` : origin.reasonIncluded === 'required-by' ? `required-by:${origin.requiredBy.itemId}` : origin.reasonIncluded).sort();

test('a set\'s members are owned by the set, and an input for an item outside it adds no choice', () => {
  assert.equal(typeof setChoices.setOwnedOrigins, 'function', 'the composition decides set ownership of configured roots');
  const ecc = release('ecc');
  // Catalog keeps required-input MCP servers out of every starting set: ECC's platform-configs set has 5 members and
  // none of them take an input, and the 15 required-input ECC items belong to no published set.
  const request = requestFor(ecc, 'ecc.module.platform-configs');
  const set = ecc.release.sets.find(candidate => candidate.id === request.setId);
  const memberItems = set.members.map(member => ecc.release.items.find(item => item.id === member.item.itemId));
  assert.equal(memberItems.length, 5, 'Catalog publishes 5 platform-configs members');
  assert.equal(memberItems.filter(item => Object.keys(item.inputs ?? {}).length).length, 0, 'no platform-configs member takes an input');
  const requiresInput = ecc.release.items.filter(item => Object.values(item.inputs ?? {}).some(input => input.required));
  assert.equal(requiresInput.length, 15, 'Catalog publishes 15 ECC items with required inputs');
  const inSomeSet = new Set(inventories.flatMap(entry => (entry.release.sets ?? []).flatMap(candidate => candidate.members.map(member => `${entry.release.sha256}/${member.item.itemId}`))));
  assert.deepEqual(requiresInput.filter(item => inSomeSet.has(`${ecc.release.sha256}/${item.id}`)).map(item => item.id), [], 'no required-input item is in a published set');
  // A remembered input for an item outside the chosen set never makes it a new choice.
  const value = name => join(tmpdir(), 'aih-installed-truth', name);
  const configurations = requiresInput.map(item => ({ releaseSha256: ecc.release.sha256, itemId: item.id, scope: 'project',
    configuration: Object.fromEntries(Object.entries(item.inputs).filter(([, input]) => input.required).map(([name]) => [name, value(name)])) }));
  const intent = freshAuthoring();
  const chosen = setChoices.selectSetChoices({ intent, inventories, sets: [request], tool: 'claude', configurations });
  assert.equal(chosen.status, 'ok', JSON.stringify(chosen.diagnostics ?? []));
  assert.deepEqual(intent.roots.filter(root => requiresInput.some(item => item.id === root.itemId)).map(root => root.itemId), [], 'an input for an item outside the set adds no root');
  assert.deepEqual(intent.roots.filter(root => Object.keys(root.configuration).length), [], 'no root carries a configuration');
  // The same resolution the composition runs: every root and the saved set request.
  const releases = Object.fromEntries(inventories.map(entry => [entry.release.sha256, entry.release]));
  const resolution = resolveSelections({ releases, sets: setChoices.setChoicesOf(intent).map(choice => choice.request),
    roots: intent.roots.map(({ releaseSha256, itemId, scope, configuration }) => ({ releaseSha256, itemId, scope, configuration })), skips: [] });
  assert.equal(resolution.status, 'ok', JSON.stringify(resolution.diagnostics ?? []));
  const members = resolution.value.selections.filter(selection => memberItems.some(item => item.id === selection.item.itemId));
  assert.equal(members.length, memberItems.length, 'every member is selected');
  for (const selection of members) assert.deepEqual(reasons(setChoices.setOwnedOrigins(intent, selection)), ['in-set:ecc.module.platform-configs'], `${selection.item.itemId} is owned by its set alone`);
  assert.equal(resolution.value.selections.some(selection => requiresInput.some(item => item.id === selection.item.itemId)), false, 'no required-input item is selected');
});

test('a configured member that only a set added is owned by the set, not recorded as chosen', () => {
  // No published set has a member with a required input, so a selection-only set over the published ECC content
  // with its published sets taken off holds one.
  const ecc = release('ecc');
  const document = JSON.parse(readFileSync(fileURLToPath(import.meta.resolve('@aihq/catalog/release-ecc.content.json')), 'utf8'));
  delete document.sets;
  const contentBytes = new TextEncoder().encode(stable(document) + '\n');
  const content = readReleaseContent(contentBytes, { expectedSha256: createHash('sha256').update(contentBytes).digest('hex') });
  assert.ok(content.valid, JSON.stringify(content.diagnostics));
  const member = content.release.items.find(item => Object.values(item.inputs ?? {}).some(input => input.required));
  assert.ok(member, 'Catalog publishes an ECC item with a required input');
  const built = compileReleaseSets({ release: content.release, sets: [{ id: 'fixture.configured', name: 'Configured member fixture', description: 'Selection-only set whose member takes a required input.', offer: 'pre-ticked',
    members: [{ item: { framework: content.release.framework.id, itemId: member.id }, optional: false, defaultOn: true }] }] });
  assert.equal(built.status, 'ok', JSON.stringify(built));
  const checked = readReleaseSets(built.value.bytes, { expectedSha256: built.value.sha256, release: content.release });
  assert.ok(checked.valid, JSON.stringify(checked.diagnostics));
  const fixture = { ...ecc, release: checked.release ?? checked.value.release };
  const fixtureInventories = inventories.map(entry => entry === ecc ? fixture : entry);
  const request = requestFor(fixture, 'fixture.configured');
  const configuration = Object.fromEntries(Object.entries(member.inputs).filter(([, input]) => input.required).map(([name]) => [name, join(tmpdir(), 'aih-installed-truth', name)]));
  const intent = freshAuthoring();
  const chosen = setChoices.selectSetChoices({ intent, inventories: fixtureInventories, sets: [request], tool: 'claude',
    configurations: [{ releaseSha256: fixture.release.sha256, itemId: member.id, scope: 'project', configuration }] });
  assert.equal(chosen.status, 'ok', JSON.stringify(chosen.diagnostics ?? []));
  const root = intent.roots.find(candidate => candidate.itemId === member.id);
  assert.ok(root, 'the configured member is a root');
  assert.deepEqual(root.configuration, configuration, 'the root carries its configuration');
  const releases = Object.fromEntries(fixtureInventories.map(entry => [entry.release.sha256, entry.release]));
  const resolution = resolveSelections({ releases, sets: setChoices.setChoicesOf(intent).map(choice => choice.request),
    roots: intent.roots.map(({ releaseSha256, itemId, scope, configuration }) => ({ releaseSha256, itemId, scope, configuration })), skips: [] });
  assert.equal(resolution.status, 'ok', JSON.stringify(resolution.diagnostics ?? []));
  const selection = resolution.value.selections.find(candidate => candidate.item.itemId === member.id);
  assert.deepEqual(reasons(selection.origins), ['chosen', 'in-set:fixture.configured'], 'Catalog records the root as chosen');
  assert.deepEqual(reasons(setChoices.setOwnedOrigins(intent, selection)), ['in-set:fixture.configured'], 'the set alone owns it');
  assert.deepEqual(selection.configuration, configuration, 'its configuration is kept');
});

test('an item chosen directly and through a set stays a root and keeps its chosen origin; set-only members do not', async () => {
  const extensions = release('extensions');
  const shared = 'extensions.skill.setup-pre-commit';
  const intent = freshAuthoring();
  chooseDirect(intent, directRoot(extensions, shared));
  const chosen = setChoices.selectSetChoices({ intent, inventories, sets: [requestFor(extensions, 'misc'), requestFor(extensions, 'extensions.template.specialists')], tool: 'claude' });
  assert.equal(chosen.status, 'ok', JSON.stringify(chosen.diagnostics ?? []));
  const root = intent.roots.find(candidate => candidate.itemId === shared);
  assert.ok(root.originIds.includes('direct'), 'the direct choice stays a root');
  const composed = await composeAuthoring({ intent, inventories, tool: 'claude' });
  assert.equal(composed.status, 'ok', JSON.stringify(composed.diagnostics ?? []));
  const byItem = id => composed.value.policy.selections.find(selection => selection.item?.itemId === id);
  assert.deepEqual(reasons(byItem(shared).origins), ['chosen', 'in-set:extensions.template.specialists', 'in-set:misc']);
  const misc = extensions.release.sets.find(set => set.id === 'misc').members.map(member => member.item.itemId).filter(id => id !== shared);
  assert.equal(misc.length, 3, 'Misc has three members of its own');
  for (const id of misc) assert.deepEqual(reasons(byItem(id).origins), ['in-set:misc'], `${id} is owned by Misc alone`);
});

test('a set at project scope and the same item chosen directly at user scope', async t => {
  // The removal rule is tested on the running page only when Core can install both. ECC MCP servers are the only
  // Catalog items offered at user scope; compose them for real and report Core's answer when it cannot.
  const ecc = release('ecc');
  const userCapable = ecc.release.items.filter(item => item.scopes?.includes('user') && !Object.keys(item.inputs ?? {}).length);
  assert.ok(userCapable.length > 0, 'Catalog offers items at user scope');
  const intent = freshAuthoring();
  chooseDirect(intent, directRoot(ecc, userCapable[0].id, 'user'));
  const composed = await composeAuthoring({ intent, inventories, tool: 'claude' });
  if (composed.status !== 'ok') {
    const detail = JSON.stringify(composed.diagnostics?.map(value => ({ code: value.code, message: value.message, core: value.details?.diagnostics })));
    assert.match(detail, /no user location|scope-not-bound/, `only Core's missing user location may stop this case: ${detail}`);
    t.skip(`incomplete: Core cannot install ${userCapable[0].id} at user scope for Claude Code (${detail}); no two-scope install exists to remove a set from`);
    return;
  }
  assert.fail('Core now installs a user-scope item: add the running-page two-scope removal case');
});

test('removing a set keeps its member that the user also chose directly, for the other set and the direct choice', async t => {
  assert.equal(typeof installedList.setRemovalEntries, 'function', 'the installed list says what "Remove this set" sends to Core');
  const scratch = await mkdtemp(join(tmpdir(), 'aih-installed-truth-')), projectRoot = join(scratch, 'project');
  await mkdir(projectRoot, { recursive: true });
  t.after(async () => { await rm(scratch, { recursive: true, force: true }); });
  const extensions = release('extensions');
  const shared = 'extensions.skill.setup-pre-commit';
  const intent = freshAuthoring();
  chooseDirect(intent, directRoot(extensions, shared));
  assert.equal(setChoices.selectSetChoices({ intent, inventories, sets: [requestFor(extensions, 'misc'), requestFor(extensions, 'extensions.template.specialists')], tool: 'claude' }).status, 'ok');
  const composed = await composeAuthoring({ intent, inventories, tool: 'claude' });
  assert.equal(composed.status, 'ok', JSON.stringify(composed.diagnostics ?? []));
  const host = createHost({ projectRoot, materialRoots: { ...Object.fromEntries(inventories.map(entry => [entry.materialSource.input, catalogRoot])), catalog: catalogRoot },
    recipeMaterials: inventories.flatMap(entry => entry.materials), controls: { logging: 'off' } });
  const prepared = await host.prepareSession({ policyText: new TextDecoder().decode(composed.value.policyBytes) });
  assert.equal(prepared.status, 'ready', JSON.stringify(prepared.diagnostics ?? []));
  assert.equal((await host.applyApproved({ sessionId: prepared.sessionId, reviewDigest: prepared.review.reviewDigest })).completion, 'complete');
  const before = await host.managedInventory();
  const group = installedList.originGroups(before).find(candidate => candidate.set?.setId === 'misc');
  assert.ok(group, 'the installed list groups Misc by its recorded origin');
  const entries = installedList.setRemovalEntries(group);
  const sharedEntry = entries.find(entry => before.selections.find(selection => selection.managementId === entry.managementId).item.itemId === shared);
  assert.deepEqual(sharedEntry.origin, { set: group.set }, 'the shared member loses only the Misc origin');
  assert.deepEqual(sharedEntry.keptFor.map(set => set.setId), ['extensions.template.specialists'], 'it is kept for the other set by name');
  const own = entries.filter(entry => entry !== sharedEntry);
  assert.equal(own.length, 3, 'Misc removes its three own members');
  assert.ok(own.every(entry => !entry.origin), 'they leave whole');
  const removal = await host.prepareRemovalSession({ removals: entries.map(({ managementId, origin }) => ({ managementId, ...(origin ? { origin } : {}) })), scope: 'project', mode: 'vibe' });
  assert.equal(removal.disposition, 'prepared', JSON.stringify(removal.diagnostics ?? []));
  assert.deepEqual(removal.removals.map(entry => entry.change), entries.map(entry => entry.origin ? 'remove-origin' : 'remove-selection'));
  const run = await host.applyApproved({ sessionId: removal.preparation.sessionId, reviewDigest: removal.preparation.review.reviewDigest });
  assert.equal(run.completion, 'complete', JSON.stringify(run.diagnostics ?? []));
  const after = await host.managedInventory();
  const ownIds = new Set(own.map(entry => entry.managementId));
  assert.deepEqual(after.selections.filter(selection => ownIds.has(selection.managementId)).map(selection => selection.managementId), [], 'Misc\'s own members are gone');
  const files = before.selections.filter(selection => ownIds.has(selection.managementId)).flatMap(selection => selection.members.map(member => member.path));
  assert.ok(files.length > 0 && files.every(path => !existsSync(path)), 'their files are absent');
  const kept = after.selections.find(selection => selection.managementId === sharedEntry.managementId);
  assert.deepEqual(reasons(kept.origins.filter(origin => origin.reasonIncluded !== 'required-by')), ['chosen', 'in-set:extensions.template.specialists'], 'the shared member keeps the direct choice and the other set');
});
