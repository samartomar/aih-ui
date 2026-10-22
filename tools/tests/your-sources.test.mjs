import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { folderSources, forgetFolder, forgetGitHub, githubName, isYourSource, PASTE_NOT_YET, rememberFolder, rememberedFolders, rememberedGitHub, rememberGitHub } from '../../src/catalog/your-sources.js';
import { projectItems } from '../../src/catalog/authoring-model.js';
import { familyLabel } from '../../src/catalog/frameworks.js';
import { frameworkRows } from '../../src/catalog/frameworks.js';

// Test-only items shaped like the consumer host's catalog: a folder's skills are the "Personal" family, one release per
// folder the page was granted.
const item = (id, family, releaseSha256 = `${family}-release`) => ({ id, kind: 'skill', family, label: id, root: { releaseSha256 } });
const entry = value => ({ entryId: `${value.root.releaseSha256}/${value.id}`, authoringItem: value });
const catalog = [
  item('ext.tdd', 'Extensions'), item('personal.skill.alpha', 'Personal', 'a'.repeat(64)), item('personal.skill.beta', 'Personal', 'a'.repeat(64)),
  item('personal.skill.alpha', 'Personal', 'b'.repeat(64)), item('ecc.agent', 'ECC'),
].map(entry);

function memory() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
}
const refusing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };

test('a folder\'s skills are Your sources, never a framework', () => {
  assert.equal(isYourSource({ family: 'Personal' }), true);
  assert.equal(isYourSource({ family: 'Extensions' }), false);
  assert.equal(frameworkRows(catalog.map(value => value.authoringItem)).some(row => row.family === 'Personal'), false);
});

test('one source per added folder, named by the folder, with its own skills', () => {
  const named = new Map([['a'.repeat(64), 'my-skills'], ['b'.repeat(64), 'team-skills']]);
  const sources = folderSources(catalog, { named, remembered: [] });
  assert.deepEqual(sources.map(source => [source.name, source.state, source.entries.map(value => value.authoringItem.id)]), [
    ['my-skills', 'session', ['personal.skill.alpha', 'personal.skill.beta']],
    ['team-skills', 'session', ['personal.skill.alpha']],
  ]);
});

test('a granted folder whose name this page does not know is still listed, and says so', () => {
  const [source] = folderSources(catalog.slice(0, 3), { named: new Map(), remembered: [] });
  assert.equal(source.state, 'session');
  assert.match(source.name, /folder chosen on this page/i);
});

test('a remembered folder this page has no grant for needs choosing again; one it has is not listed twice', () => {
  const named = new Map([['a'.repeat(64), 'my-skills']]);
  const sources = folderSources(catalog.slice(0, 3), { named, remembered: ['my-skills', 'old-skills'] });
  assert.deepEqual(sources.map(source => [source.name, source.state, source.entries.length]), [['my-skills', 'session', 2], ['old-skills', 'choose-again', 0]]);
});

test('folder names are remembered in this browser only; storage that refuses forgets harmlessly', () => {
  const storage = memory();
  rememberFolder('my-skills', storage); rememberFolder('team-skills', storage); rememberFolder('my-skills', storage);
  assert.deepEqual(rememberedFolders(storage), ['my-skills', 'team-skills']);
  forgetFolder('my-skills', storage);
  assert.deepEqual(rememberedFolders(storage), ['team-skills']);
  assert.doesNotMatch([...storage.values.values()].join(), /SKILL.md|bytes|grant/i, 'only names are kept, never content or a grant');
  storage.values.set('aih-workbench-your-sources', '{not json');
  assert.deepEqual(rememberedFolders(storage), []);
  assert.deepEqual(rememberedFolders(refusing), []);
  assert.doesNotThrow(() => rememberFolder('x', refusing));
  assert.doesNotThrow(() => forgetFolder('x', refusing));
});

test('a paste is never read: the page says what is missing for npm commands and branch links', () => {
  assert.match(PASTE_NOT_YET, /can't be added yet/i);
  assert.match(PASTE_NOT_YET, /samartomar\/aih-catalog#120/, 'no published parser for pasted links');
  assert.match(PASTE_NOT_YET, /npm[^.]*samartomar\/aih-catalog#123[^.]*samartomar\/aih-scan#120/i, 'npm packages');
  assert.match(PASTE_NOT_YET, /branch[^.]*exact commit[^.]*samartomar\/aih-catalog#122/i, 'branch links');
  assert.match(PASTE_NOT_YET, /unverified note/i);
});

// The page's own markup.
const html = readFileSync(new URL('../../src/index.html', import.meta.url), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const section = id => {
  const start = html.indexOf(`id="${id}"`), tag = html.lastIndexOf('<', start), name = /<(\w+)/.exec(html.slice(tag))[1];
  let depth = 0;
  for (const match of html.slice(tag).matchAll(new RegExp(`<(/?)${name}\\b`, 'g'))) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return html.slice(tag, tag + match.index);
  }
  return html.slice(tag);
};

test('Your sources has its own place in the left panel, after the frameworks and apart from them', () => {
  const rail = section('nav-rail');
  assert.match(rail, /id="nav-your-sources-add"[^>]*>[\s\S]*?Add a source/);
  assert.ok(rail.indexOf('id="your-sources-nav"') > rail.indexOf('id="framework-list"'), 'after the frameworks');
  assert.doesNotMatch(section('framework-list-section'), /your-sources/);
});

test('the folder picker lives under Your sources with its ids kept, and no longer under Advanced', () => {
  const sources = section('your-sources');
  for (const id of ['personal-folder', 'personal-binding', 'personal-result']) {
    assert.match(sources, new RegExp(`id="${id}"`), id);
    assert.doesNotMatch(section('catalog-advanced'), new RegExp(`id="${id}"`), id);
  }
  assert.match(sources, /type="file" webkitdirectory/);
  assert.match(section('your-sources-folder'), /skills\/&lt;name&gt;\/SKILL\.md/, 'the expected layout is shown');
  assert.match(section('your-sources-folder'), /reload/i, 'the page-session grant is said plainly');
  assert.doesNotMatch(section('catalog-workspace'), /id="your-sources"/);
});

test('the kinds that cannot be added yet are disabled and say why, with no links out', () => {
  for (const [id, reason] of [['your-sources-npm', /samartomar\/aih-catalog#123[\s\S]*samartomar\/aih-scan#120/], ['your-sources-paste', /samartomar\/aih-catalog#120/]]) {
    const kind = section(id);
    assert.match(kind, reason, id);
    assert.doesNotMatch(kind, /href=/, `${id} links nowhere`);
  }
  assert.match(section('your-sources-npm'), /<button[^>]*disabled/);
  assert.match(section('your-sources-paste'), /<button[^>]*disabled/, 'nothing pasted can be added');
  assert.doesNotMatch(section('your-sources'), /href="https?:/, 'no links out to directories');
});

// GitHub sources (#125): items compiled with a git origin, one source per repository commit.
const COMMIT = 'd81f3a183412e71a5b1e84ca21bc1a35eea03a60';
const github = (id, release = 'c'.repeat(64), skillPath = `skills/productivity/${id}/SKILL.md`) => entry({ ...item(`github.skill.${id}`, 'Personal', release),
  sources: [{ id: 'github', origin: { kind: 'git', repository: 'https://github.com/mattpocock/skills', revision: COMMIT } }],
  metadata: { sourceFacts: { provenance: { path: skillPath, revision: COMMIT } } } });

test('a GitHub source is its own entry, named owner/repo@shortsha, apart from the folders', () => {
  const sources = folderSources([...catalog.slice(0, 3), github('grill-me'), github('teach')], { named: new Map([['a'.repeat(64), 'my-skills']]), remembered: [] });
  assert.deepEqual(sources.map(source => [source.name, source.kind, source.state, source.entries.length]), [['my-skills', 'folder', 'session', 2], ['mattpocock/skills@d81f3a1', 'github', 'session', 2]]);
  assert.equal(githubName({ repository: 'mattpocock/skills', commit: COMMIT }), 'mattpocock/skills@d81f3a1');
});

test('a remembered GitHub source this page has not added is offered to add again; one it has is listed once', () => {
  const remembered = { repository: 'mattpocock/skills', commit: COMMIT, path: 'skills/productivity' }, other = { repository: 'acme/tools', commit: 'e'.repeat(40), path: 'skills' };
  const sources = folderSources([github('grill-me')], { named: new Map(), remembered: [], rememberedGitHub: [remembered, other] });
  assert.deepEqual(sources.map(source => [source.name, source.state]), [['mattpocock/skills@d81f3a1', 'session'], ['acme/tools@eeeeeee', 'add-again']]);
  assert.deepEqual(sources[1].github, other);
});

test('GitHub sources are remembered in this browser as repository, commit and folder only', () => {
  const storage = memory(), value = { repository: 'mattpocock/skills', commit: COMMIT, path: 'skills/productivity' };
  rememberGitHub(value, storage); rememberGitHub({ ...value }, storage);
  assert.deepEqual(rememberedGitHub(storage), [value]);
  forgetGitHub(value, storage);
  assert.deepEqual(rememberedGitHub(storage), []);
  storage.values.set('aih-workbench-your-sources-github', JSON.stringify([{ repository: 'x', commit: 'main', path: 'p' }, 'junk']));
  assert.deepEqual(rememberedGitHub(storage), [], 'only exact entries are read back');
  assert.deepEqual(rememberedGitHub(refusing), []);
  assert.doesNotThrow(() => rememberGitHub(value, refusing));
});

test("the inspector shows a GitHub item's repository, commit and folder as its source", () => {
  const [projected] = projectItems([github('grill-me').authoringItem]);
  assert.deepEqual(projected.subject.source, { type: 'github', repository: 'mattpocock/skills', commit: COMMIT, path: 'skills/productivity/grill-me', release: 'Personal', revision: 'c'.repeat(64) });
  const [folder] = projectItems([catalog[1].authoringItem]);
  assert.equal(folder.subject.source.type, 'local');
});

test('Your sources content is labelled Your sources, not Personal', () => {
  assert.equal(familyLabel('Personal'), 'Your sources');
});

test('a GitHub repository is added by exact owner/repo, commit and folder; the bounds and the install gap are said plainly', () => {
  const kind = section('your-sources-github');
  for (const id of ['your-sources-github-repository', 'your-sources-github-commit', 'your-sources-github-path', 'your-sources-github-add', 'your-sources-github-result']) assert.match(kind, new RegExp(`id="${id}"`), id);
  assert.doesNotMatch(kind, /disabled/);
  assert.match(kind, /40-character commit/);
  assert.match(kind, /branch or tag is refused/i);
  assert.match(kind, /8 MB[\s\S]*30 seconds/);
  assert.match(kind, /Nothing is run/);
  assert.match(kind, /can't be installed yet[\s\S]*samartomar\/aih-catalog#124/);
  assert.doesNotMatch(kind, /href=/);
});
