import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { managementIdOf } from '../../src/app/management-id.js';
import { managementIdOf as composed } from '../consumer/intent-shape.mjs';

test('the id the Workbench gives an item at a scope is scope, package and item id', () => {
  assert.equal(managementIdOf({ scope: 'project', packageName: '@aihq/catalog', itemId: 'extensions.matt.grilling' }), 'project--aihq.catalog--extensions.matt.grilling');
  assert.equal(managementIdOf({ scope: 'user', packageName: 'plain', itemId: 'x' }), 'user--plain--x');
});

test('composition uses this same builder, and the browser copy is the same file, so the two cannot drift', async () => {
  assert.equal(composed({ scope: 'project', packageName: '@a/b', itemId: 'c' }), managementIdOf({ scope: 'project', packageName: '@a/b', itemId: 'c' }));
  const [page, headless] = await Promise.all(['../../src/app/management-id.js', '../consumer/management-id.mjs']
    .map(file => readFile(new URL(file, import.meta.url), 'utf8')));
  const lf = text => text.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
  assert.equal(lf(headless), lf(page));
  assert.doesNotMatch(page, /^\s*import\b|\bdocument\b|\bwindow\b|node:|\bprocess\b|\bBuffer\b/m);
  assert.match(await readFile(new URL('../consumer/intent-shape.mjs', import.meta.url), 'utf8'), /from '\.\/management-id\.mjs'/);
});
