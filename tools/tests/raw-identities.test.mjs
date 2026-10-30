import test from 'node:test';
import assert from 'node:assert/strict';
import { rawIdentities } from '../consumer/installed-truth-browser.mjs';

const catalog = { items: [
  { id: 'ecc.mcp.github', name: 'github', description: 'Unverified provider: shares its configuration key with ecc.mcp.gitlab.' },
  { id: 'ecc.mcp.gitlab', name: 'gitlab' },
], frameworks: [{ id: 'ecc', name: 'ECC', sets: [{ id: 'engineering', name: 'Engineering', setSha256: 'a'.repeat(64) },
  { id: 'misc', name: 'Misc', setSha256: 'c0ffee12'.repeat(8) }, { id: 'extensions.template.specialists', name: 'Extensions specialists', setSha256: 'b'.repeat(64) }] }] };
const found = text => rawIdentities(text, { catalog }).found.map(entry => entry.value);

test('the no-raw-ids scan leaves Catalog\'s description prose alone and still finds a raw id elsewhere', () => {
  const shown = ['github', 'Unverified provider: shares its   configuration key with ecc.mcp.gitlab.', 'Our engineering skills'].join('\n');
  assert.deepEqual(rawIdentities(shown, { catalog }).found, []);
  const raw = rawIdentities(`${shown}\nRequired by ecc.mcp.gitlab\nengineering\n${'a'.repeat(64)}`, { catalog }).found.map(entry => [entry.what, entry.value]);
  assert.deepEqual(raw, [['item id', 'ecc.mcp.gitlab'], ['set id', 'engineering'], ['sha256', 'a'.repeat(64)]]);
});

test('an id followed by sentence punctuation or inside a path is still found', () => {
  assert.deepEqual(found("Couldn't check whether your tool already has ecc.mcp.gitlab."), ['ecc.mcp.gitlab']);
  assert.deepEqual(found('Kept for ecc.mcp.gitlab, and more'), ['ecc.mcp.gitlab']);
  assert.deepEqual(found('Recorded as extensions/extensions.template.specialists/'), ['extensions.template.specialists']);
  assert.deepEqual(found('Files: .claude/rules/typescript/coding-style.md'), [], 'a file path is not an id');
  assert.deepEqual(found('create-file: Write .claude/skills/ask-matt/ecc.mcp.gitlab/NOTICE.md → /home/me/p/.claude/skills/ecc.mcp.gitlab/NOTICE.md'), [],
    'a folder Core names after an item, inside the file path it writes, is where the file goes, not a label');
});

test('a one-word id after the words that introduce one, and short digest prefixes, are found', () => {
  for (const text of ['github — left out of set misc', 'Left out from misc', 'Also in: misc', 'Required by misc', 'Replaces\nmisc · other'])
    assert.deepEqual(found(text), ['misc'], text);
  assert.deepEqual(found('A miscellaneous set of tools from many places'), [], 'the word in prose is not an id');
  assert.deepEqual(found('Misc'), [], 'the set name is not its id');
  assert.deepEqual(found('exact set c0ffee1'), ['c0ffee12'.repeat(8)]);
  assert.deepEqual(found('exact set c0ffee12'), ['c0ffee12'.repeat(8)]);
  assert.deepEqual(found('When used: 1234567 bytes'), [], 'a number is not a digest prefix');
  assert.deepEqual(found('exact set c0ffee'), [], 'six characters are not checked');
});
