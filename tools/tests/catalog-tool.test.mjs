import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogToolOnRefresh } from '../../src/catalog/catalog-tool.js';

// The catalog refreshes more than once while the page opens. The first refresh can come before the framework releases
// have loaded: then only the Catalog's default release is there, and it declares no tool names (samartomar/aih-ui#136).

test('a saved tool survives a first refresh that comes before the framework releases load', () => {
  const saved = 'claude-code';
  let current = '';
  // 1. Only the default release: no tool declared, no framework loaded. The choice waits; nothing is forgotten.
  const early = catalogToolOnRefresh({ declared: [], frameworksLoaded: false, saved, current });
  assert.deepEqual(early, { tool: '', forget: '' });
  current = early.tool;
  // 2. The framework releases arrive: the saved tool comes back, although the page's current tool is now ''.
  const loaded = catalogToolOnRefresh({ declared: ['claude-code', 'codex'], frameworksLoaded: true, saved, current });
  assert.deepEqual(loaded, { tool: 'claude-code', forget: '' });
  current = loaded.tool;
  // 3. Later refreshes keep it.
  assert.deepEqual(catalogToolOnRefresh({ declared: ['claude-code', 'codex'], frameworksLoaded: true, saved, current }), { tool: 'claude-code', forget: '' });
});

test('a saved tool is forgotten only when the loaded frameworks no longer declare it, and the caller is told which', () => {
  assert.deepEqual(catalogToolOnRefresh({ declared: ['codex'], frameworksLoaded: false, saved: 'claude-code', current: '' }), { tool: '', forget: '' },
    'before the frameworks load nothing is forgotten');
  assert.deepEqual(catalogToolOnRefresh({ declared: ['codex'], frameworksLoaded: true, saved: 'claude-code', current: '' }), { tool: '', forget: 'claude-code' });
});

test('the latest choice is the saved one; with storage blocked the page keeps what was chosen on it', () => {
  // A choice made on the page is saved at once, so the saved value is the latest one.
  assert.equal(catalogToolOnRefresh({ declared: ['claude-code', 'codex'], frameworksLoaded: true, saved: 'codex', current: 'claude-code' }).tool, 'codex');
  // Storage refused: nothing is saved, and the page's own choice stays.
  assert.deepEqual(catalogToolOnRefresh({ declared: ['claude-code'], frameworksLoaded: true, saved: '', current: 'claude-code' }), { tool: 'claude-code', forget: '' });
  // A page choice the Catalog no longer declares is dropped; there is nothing saved to forget.
  assert.deepEqual(catalogToolOnRefresh({ declared: ['codex'], frameworksLoaded: true, saved: '', current: 'claude-code' }), { tool: '', forget: '' });
  // Nothing chosen: nothing to restore.
  assert.deepEqual(catalogToolOnRefresh({ declared: ['claude-code'], frameworksLoaded: true, saved: '', current: '' }), { tool: '', forget: '' });
});
