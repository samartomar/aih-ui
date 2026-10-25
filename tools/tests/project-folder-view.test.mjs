import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folderSummary, readRecent, rememberFolder, saveRecent } from '../../src/app/project-folder.js';

const store = (initial = {}) => { const values = { ...initial }; return { getItem: key => values[key] ?? null, setItem: (key, value) => { values[key] = value; }, values }; };
const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

test('remembers up to five recent folders, newest first, each once', () => {
  let list = [];
  for (const path of ['C:\\p\\a', 'C:\\p\\b', 'C:\\p\\c', 'C:\\p\\d', 'C:\\p\\e', 'C:\\p\\f']) list = rememberFolder(list, path);
  assert.deepEqual(list, ['C:\\p\\f', 'C:\\p\\e', 'C:\\p\\d', 'C:\\p\\c', 'C:\\p\\b']);
  assert.deepEqual(rememberFolder(list, 'c:/p/d'), ['c:/p/d', 'C:\\p\\f', 'C:\\p\\e', 'C:\\p\\c', 'C:\\p\\b']);
  assert.deepEqual(rememberFolder(['/home/me/app'], '/home/me/App'), ['/home/me/App', '/home/me/app']);
});

test('recent folders survive in storage and the page works without it', () => {
  const storage = store();
  saveRecent(storage, ['C:\\p\\a']);
  assert.deepEqual(readRecent(storage), ['C:\\p\\a']);
  assert.deepEqual(readRecent(store({ 'wb-recent-project-folders': '{not json' })), []);
  assert.deepEqual(readRecent(store({ 'wb-recent-project-folders': JSON.stringify(['ok', 3, '', 'two', 'a', 'b', 'c', 'd']) })), ['ok', 'two', 'a', 'b', 'c']);
  assert.deepEqual(readRecent(broken), []);
  assert.doesNotThrow(() => saveRecent(broken, ['x']));
  assert.deepEqual(readRecent(undefined), []);
});

test('says which folder Install uses, in the words of the default screen', () => {
  assert.deepEqual(folderSummary({ project: 'C:\\work\\sample-js-app', source: 'host-default' }),
    { name: 'sample-js-app', path: 'C:\\work\\sample-js-app', note: 'The default for this Workbench.' });
  assert.deepEqual(folderSummary({ project: '/srv/app', source: 'chosen' }), { name: 'app', path: '/srv/app', note: '' });
  assert.deepEqual(folderSummary({ project: null, source: 'none' }),
    { name: 'No project folder', path: '', note: 'Choose the project folder to install into and to see what is installed there.' });
});
