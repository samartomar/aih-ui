import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { folderSources, forgetFolder, isYourSource, PASTE_NOT_YET, rememberFolder, rememberedFolders } from '../../src/catalog/your-sources.js';
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
  for (const [id, reason] of [['your-sources-npm', /samartomar\/aih-catalog#123[\s\S]*samartomar\/aih-scan#120/], ['your-sources-github', /coming next[\s\S]*#125/i], ['your-sources-paste', /samartomar\/aih-catalog#120/]]) {
    const kind = section(id);
    assert.match(kind, reason, id);
    assert.doesNotMatch(kind, /href=/, `${id} links nowhere`);
  }
  assert.match(section('your-sources-npm'), /<button[^>]*disabled/);
  assert.match(section('your-sources-github'), /<button[^>]*disabled/);
  assert.match(section('your-sources-paste'), /<button[^>]*disabled/, 'nothing pasted can be added');
  assert.doesNotMatch(section('your-sources'), /href="https?:/, 'no links out to directories');
});
