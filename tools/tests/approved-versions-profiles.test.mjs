import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createPortableProfiles } from '../server/portable-profiles.mjs';
import { installedVersions, versionUnavailable } from '../../src/approved/versions.js';
import { portableProfile, readProfile, readTeamProfile, resolveProfileChoices } from '../../src/approved/profile-model.js';
import { loadPublicProfile, publicProfileSource } from '../../src/approved/profile-sharing.js';

test('a draft reference requires the exact installed package versions', () => {
  const data = { packages: { core: { version: '2.0.0' }, catalog: { version: '1.0.0' }, scan: { version: '1.1.0' } } };
  const current = installedVersions(data);
  assert.equal(versionUnavailable({}, data), false);
  assert.equal(versionUnavailable(current, data), false);
  assert.equal(versionUnavailable({ ...current, core: '1.0.0' }, data), true);
  assert.equal(versionUnavailable({ core: '2.0.0' }, data), true);
  assert.equal(versionUnavailable(current, { packages: {} }), true);
});

test('the host Profile library projects portable files only and refuses cross-origin reads', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'workbench-profiles-test-'));
  t.after(() => rm(folder, { force: true, recursive: true }));
  const file = join(folder, 'profiles.json');
  await writeFile(file, JSON.stringify([
    { format: 'aih-portable-profile/1', id: 'one', name: 'Profile', catalogIds: ['chosen'],
      firstTask: 'Review changes', instructions: 'Test first', privateMetadata: 'should not be returned' },
    { format: 'unknown' },
  ]));
  const endpoint = createPortableProfiles(file);

  async function fetchProfile(origin) {
    let status, body;
    const response = {
      writeHead(code) { status = code; },
      end(bytes) { body = JSON.parse(bytes); },
    };
    const request = { method: 'GET', headers: { host: '127.0.0.1:6200', origin }, socket: { localPort: 6200 } };
    assert.equal(await endpoint(request, response, '/api/approved-profiles'), true);
    return { status, body };
  }

  const accepted = await fetchProfile('http://127.0.0.1:6200');
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.status, 'partial');
  assert.equal(accepted.body.profiles.length, 1);
  const [profile] = accepted.body.profiles;
  assert.deepEqual(profile.items, ['chosen']);
  assert.equal(profile.firstTask, 'Review changes');
  assert.equal(profile.instructions, 'Test first');
  assert.equal(Object.hasOwn(profile, 'privateMetadata'), false);

  const refused = await fetchProfile('http://127.0.0.1:6201');
  assert.equal(refused.status, 403);
  assert.deepEqual(refused.body.profiles, []);
});

const profile = {
  format: 'aih-workbench-profile/1', id: 'developer', name: 'Developer', description: 'Review a change',
  items: ['old-id', 'pinned:second', 'missing'], clients: ['claude', 'removed'],
  firstTask: 'Read the\npatch.\n', instructions: 'Ask before editing.\n',
  byo: [{ name: 'Internal', kind: 'skill', source: 'C:/private/source', revision: 'private-sha' }],
  files: [
    { name: 'AGENTS.md', text: '# Team rules\r\n', allowUpdates: true },
    { name: 'personal.md', text: 'Private notes', allowUpdates: false },
  ],
};
const catalog = {
  items: [{ id: 'pinned:first', itemId: 'old-id' }, { id: 'pinned:second', itemId: 'second' }],
  clients: [{ id: 'claude' }],
};

test('saving a private or legacy Profile preserves its own sources and supporting files', () => {
  assert.deepEqual(readProfile(JSON.parse(JSON.stringify(profile))), profile);
  const { items, clients, ...rest } = profile;
  const legacy = { ...rest, format: 'aih-portable-profile/1', catalogIds: items };
  assert.deepEqual(readProfile(legacy), { ...profile, clients: [] });
});

test('all share destinations get an exact Catalog-only Profile by default', () => {
  const choices = resolveProfileChoices(profile, catalog);
  const baseline = portableProfile(profile, choices);
  assert.deepEqual(baseline, {
    format: profile.format, id: profile.id, name: profile.name, description: profile.description,
    items: ['pinned:first', 'pinned:second'], clients: ['claude'],
  });
  const included = portableProfile(profile, choices, { firstTask: true, files: new Set([0]) });
  assert.deepEqual(included, {
    ...baseline, firstTask: profile.firstTask,
    files: [{ name: 'AGENTS.md', text: '# Team rules\r\n', allowUpdates: false }],
  });
  assert.equal(portableProfile(profile, choices, { instructions: true }).instructions, profile.instructions);
  assert.deepEqual(readTeamProfile(JSON.parse(JSON.stringify(included))), included);
  assert.throws(() => readTeamProfile({ ...baseline, byo: [] }));
  assert.throws(() => readTeamProfile({ ...baseline, files: [{ name: '../AGENTS.md', text: 'text', allowUpdates: false }] }));
  assert.throws(() => readTeamProfile({ ...baseline, files: [{ name: 'AGENTS.md', text: 'text', allowUpdates: false, localPath: 'private' }] }));
});

test('member Profile preview uses exact installed Catalog identity and current policy eligibility', () => {
  const allowed = { ...catalog, items: [catalog.items[0]] };
  const choices = resolveProfileChoices(profile, catalog, allowed);
  assert.equal(choices.eligible, false);
  assert.deepEqual(choices.items.map(({ value }) => value?.id), ['pinned:first', undefined, undefined]);
  const ambiguous = { ...catalog, items: [...catalog.items, { id: 'pinned:new', itemId: 'old-id' }] };
  assert.equal(resolveProfileChoices(profile, ambiguous, allowed).items[0].value, undefined);
});

test('public Profile links require a pinned GitHub JSON file and send no credentials', async t => {
  const sha = 'a'.repeat(40);
  const url = 'https://github.com/team/profiles/blob/' + sha + '/files/my%20profile.json';
  const source = publicProfileSource(url);
  assert.equal(source.path, 'files/my profile.json');
  assert.equal(source.revision, sha);
  assert.throws(() => publicProfileSource(url.replace(sha, 'main')));
  assert.throws(() => publicProfileSource(url.replace('github.com', 'github.com.local')));
  assert.throws(() => publicProfileSource(url.replace('files/', 'files%2F')));
  const baseline = portableProfile(profile, resolveProfileChoices(profile, catalog));
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(baseline)));
  assert.deepEqual(await loadPublicProfile(url), { profile: baseline, source });
  assert.equal(fetch.mock.calls[0].arguments[0], source.raw);
  assert.equal(fetch.mock.calls[0].arguments[1].credentials, 'omit');
  assert.equal(fetch.mock.calls[0].arguments[1].redirect, 'error');
});

test('a managed Profile with mixed CLI eligibility keeps an incompatible item unavailable', async () => {
  const {resolveProfileChoices} = await import('../../src/approved/profile-model.js');
  const data = {items:[{id:'a/skill'}], clients:[{id:'claude-code'}, {id:'codex'}]};
  const allowed = {...data, itemClients:{'a/skill':['claude-code']}};
  const profile = {items:['a/skill'], clients:['claude-code','codex']};
  assert.equal(resolveProfileChoices(profile, data, allowed).eligible, false);
  assert.equal(resolveProfileChoices({...profile, clients:['claude-code']}, data, allowed).eligible, true);
});

test('a Profile item outside policy shows its title or plain Catalog ID, never a qualified ID', async () => {
  const { profileChoiceLabel } = await import('../../src/approved/profiles.js');
  const release = 'a'.repeat(64);
  const data = { items: [{ id: release + '/superpowers.skill.brainstorming', itemId: 'superpowers.skill.brainstorming', title: 'Brainstorming' }],
    clients: [{ id: 'codex', name: 'Codex CLI' }] };
  assert.equal(profileChoiceLabel({ id: release + '/superpowers.skill.brainstorming' }, data), 'Brainstorming');
  assert.equal(profileChoiceLabel({ id: 'superpowers.skill.brainstorming' }, data), 'Brainstorming');
  assert.equal(profileChoiceLabel({ id: release + '/superpowers.skill.writing-plans' }, data), 'superpowers.skill.writing-plans');
  assert.equal(profileChoiceLabel({ id: 'x', value: { title: 'Chosen' } }, data), 'Chosen');
  assert.equal(profileChoiceLabel({ id: 'codex' }, data, 'name'), 'Codex CLI');
  assert.equal(profileChoiceLabel({ id: 'kiro' }, data, 'name'), 'kiro');
});

test('Propose team Profile follows the host GitHub canPropose answer', async () => {
  const { canProposeTeamProfile } = await import('../../src/approved/profiles.js');
  const ready = { status: 'ready', canPropose: true };
  assert.equal(canProposeTeamProfile('enterprise', 'team', ready), true);
  assert.equal(canProposeTeamProfile('admin', 'saved', ready), true);
  assert.equal(canProposeTeamProfile('enterprise', 'team', { status: 'ready', canPropose: false }), false);
  assert.equal(canProposeTeamProfile('enterprise', 'saved', { status: 'unavailable', canPropose: true }), false);
  assert.equal(canProposeTeamProfile('enterprise', 'team', null), false);
  assert.equal(canProposeTeamProfile('enterprise', 'host', ready), false);
  assert.equal(canProposeTeamProfile('individual', 'saved', ready), false);
});
