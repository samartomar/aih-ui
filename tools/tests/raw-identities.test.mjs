import test from 'node:test';
import assert from 'node:assert/strict';
import { rawIdentities } from '../consumer/installed-truth-browser.mjs';

const catalog = { items: [
  { id: 'ecc.mcp.github', name: 'github', description: 'Unverified provider: shares its configuration key with ecc.mcp.gitlab.' },
  { id: 'ecc.mcp.gitlab', name: 'gitlab' },
], frameworks: [{ id: 'ecc', name: 'ECC', sets: [{ id: 'engineering', name: 'Engineering', setSha256: 'a'.repeat(64) }] }] };

test('the no-raw-ids scan leaves Catalog\'s description prose alone and still finds a raw id elsewhere', () => {
  const shown = ['github', 'Unverified provider: shares its   configuration key with ecc.mcp.gitlab.', 'Our engineering skills'].join('\n');
  assert.deepEqual(rawIdentities(shown, { catalog }).found, []);
  const raw = rawIdentities(`${shown}\nRequired by ecc.mcp.gitlab\nengineering\n${'a'.repeat(64)}`, { catalog }).found.map(entry => [entry.what, entry.value]);
  assert.deepEqual(raw, [['item id', 'ecc.mcp.gitlab'], ['set id', 'engineering'], ['sha256', 'a'.repeat(64)]]);
});
