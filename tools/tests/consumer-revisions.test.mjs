import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('a delayed reopen cannot replace newer policy edits or mode', async () => {
  const nodes = new Map();
  const document = { getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, { value: id === 'mode' ? 'vibe' : '', textContent: '',
      listeners: {}, addEventListener(event, callback) { this.listeners[event] = callback; }, replaceChildren() {} });
    return nodes.get(id);
  } };
  let deliver;
  const delayed = new Promise(resolve => { deliver = resolve; });
  const fetch = async url => ({ json: async () => url === '/api/catalog'
    ? { items: [], releaseSha256: 'test', hostAvailable: false, packages: [] } : delayed });
  const source = await readFile(new URL('../../src/consumer.js', import.meta.url), 'utf8');
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
  await new AsyncFunction('document', 'fetch', source)(document, fetch);
  const pending = nodes.get('reopen').onclick();
  nodes.get('policy').value = 'newer edit'; nodes.get('policy').listeners.input();
  deliver({ valid: true, editable: true, policy: { mode: 'enterprise' }, intent: { roots: [], excludedItemIds: [] } });
  await pending;
  assert.equal(nodes.get('mode').value, 'vibe');
  assert.equal(nodes.get('policy').value, 'newer edit');
  assert.equal(nodes.get('reopen-result').textContent, '');
});
