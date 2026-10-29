// Which recorded origins a Workbench install gives its items, from real Catalog content and the public
// composition: a set's own members are owned by the set (configured or not), an item the user also chose directly
// stays chosen, and the two-scope case is attempted for real and reported when this Core cannot produce it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolveSelections } from '@aihq/catalog/reader';
import { composeAuthoring, freshAuthoring } from './headless.mjs';
import * as setChoices from './set-choices.mjs';
import { pinSelectedRecipes } from './selected-recipe.mjs';
import { installedFamilies } from './installed-families.mjs';

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

test('a configured member that only a set added is owned by the set, not recorded as chosen', () => {
  assert.equal(typeof setChoices.setOwnedOrigins, 'function', 'the composition decides set ownership of configured roots');
  const ecc = release('ecc');
  // ECC's platform-configs set is the published set whose members declare required inputs (npm MCP servers).
  const request = requestFor(ecc, 'ecc.module.platform-configs');
  const set = ecc.release.sets.find(candidate => candidate.id === request.setId);
  const configured = set.members.map(member => ecc.release.items.find(item => item.id === member.item.itemId)).filter(item => Object.values(item.inputs ?? {}).some(input => input.required));
  assert.equal(configured.length, 15, 'Catalog publishes 15 platform-configs members with required inputs');
  const value = name => join(tmpdir(), 'aih-installed-truth', name);
  const configurations = configured.map(item => ({ releaseSha256: ecc.release.sha256, itemId: item.id, scope: 'project',
    configuration: Object.fromEntries(Object.entries(item.inputs).filter(([, input]) => input.required).map(([name]) => [name, value(name)])) }));
  const intent = freshAuthoring();
  const chosen = setChoices.selectSetChoices({ intent, inventories, sets: [request], tool: 'claude', configurations });
  assert.equal(chosen.status, 'ok', JSON.stringify(chosen.diagnostics ?? []));
  const roots = intent.roots.filter(root => Object.keys(root.configuration).length);
  assert.equal(roots.length, configured.length, 'every configured member is a root carrying its configuration');
  // The same resolution the composition runs: every root and the saved set request.
  const releases = Object.fromEntries(inventories.map(entry => [entry.release.sha256, entry.release]));
  const resolution = resolveSelections({ releases, sets: setChoices.setChoicesOf(intent).map(choice => choice.request),
    roots: intent.roots.map(({ releaseSha256, itemId, scope, configuration }) => ({ releaseSha256, itemId, scope, configuration })), skips: [] });
  assert.equal(resolution.status, 'ok', JSON.stringify(resolution.diagnostics ?? []));
  const members = resolution.value.selections.filter(selection => configured.some(item => item.id === selection.item.itemId));
  assert.equal(members.length, configured.length);
  for (const selection of members) {
    assert.deepEqual(reasons(selection.origins), ['chosen', 'in-set:ecc.module.platform-configs'], 'Catalog records the root as chosen');
    assert.deepEqual(reasons(setChoices.setOwnedOrigins(intent, selection)), ['in-set:ecc.module.platform-configs'], `${selection.item.itemId} is owned by its set alone`);
    assert.deepEqual(selection.configuration, configurations.find(root => root.itemId === selection.item.itemId).configuration, 'its configuration is kept');
  }
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
