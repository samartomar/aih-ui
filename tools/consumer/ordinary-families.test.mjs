import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startConsumer } from './server.mjs';
import { readAuthoring } from './headless.mjs';
import { installedFamilies } from './installed-families.mjs';

test('ordinary authoring exposes all four packaged families with empty initial choices', async () => {
  const started = await startConsumer();
  try {
    const catalog = await (await fetch(`${started.origin}/api/authoring-catalog`)).json();
    for (const family of ['Extensions', 'ECC', 'Superpowers', 'Anthropic']) {
      assert.ok(catalog.items.some(item => item.family === family), `Missing required family: ${family}`);
    }
    const result = await (await fetch(`${started.origin}/api/authoring-new`, {
      method: 'POST', headers: { origin: started.origin, 'content-type': 'application/json' }, body: '{}'
    })).json();
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.value.intent.roots, []);
    assert.deepEqual(result.value.intent.pins, []);
  } finally { await new Promise(resolve => started.server.close(resolve)); }
});

test('ordinary launch refuses a package that omits a required family export', async () => {
  const manifest = fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'));
  const original = await readFile(manifest);
  const value = JSON.parse(original);
  delete value.exports['./release-anthropic.json'];
  await writeFile(manifest, JSON.stringify(value));
  try {
    await assert.rejects(async () => {
      const started = await startConsumer();
      await new Promise(resolve => started.server.close(resolve));
    }, /anthropic/i);
  } finally { await writeFile(manifest, original); }
});

test('four-family choices retain exact pins, required dependencies and Matt origin on fresh reopen', async () => {
  const started = await startConsumer();
  const call = async (operation, body = {}) => (await fetch(`${started.origin}/api/authoring-${operation}`, {
    method: 'POST', headers: { origin: started.origin, 'content-type': 'application/json' }, body: JSON.stringify(body)
  })).json();
  try {
    const catalog = await (await fetch(`${started.origin}/api/authoring-catalog`)).json();
    let result = await call('new');
    const expected = [
      ['Extensions', 'extensions.matt.ask-matt'], ['ECC', 'ecc.skill.accessibility'],
      ['Superpowers', 'superpowers.skill.brainstorming'], ['Anthropic', 'anthropic.skill.academy-guide']
    ];
    for (const [family, id] of expected) {
      const item = catalog.items.find(item => item.id === id && item.family === family);
      assert.ok(item, `${family}: missing representative ${id}`);
      result = await call('edit', { policyBytes: result.value.policyBytes, operation: { type: 'select', root: item.root } });
      assert.equal(result.status, 'ok', JSON.stringify(result.diagnostics));
    }
    const saved = result.value;
    const matt = catalog.items.find(item => item.id === 'extensions.matt.ask-matt');
    assert.equal(matt.sources[0].origin.repository, 'https://github.com/mattpocock/skills');
    for (const id of ['extensions.notices', 'ecc.notices', 'superpowers.notices']) {
      assert.ok(saved.intent.pins.some(pin => pin.itemId === id), `Required dependency missing: ${id}`);
      assert.ok(!saved.intent.roots.some(root => root.itemId === id), 'Dependency must remain an implicit selection');
    }
    // A fresh ordinary host and the headless consumer read the downloaded bytes.
    const fresh = await startConsumer();
    try {
      const reopened = await (await fetch(`${fresh.origin}/api/authoring-read`, {
        method: 'POST', headers: { origin: fresh.origin, 'content-type': 'application/json' },
        body: JSON.stringify({ policyBytes: saved.policyBytes })
      })).json();
      assert.equal(reopened.value.editing, 'available', JSON.stringify(reopened));
      assert.deepEqual(reopened.value.intent, saved.intent);
      const headless = await readAuthoring({ policyBytes: Uint8Array.from(saved.policyBytes), inventories: await installedFamilies() });
      assert.equal(headless.value.editing, 'available');
      assert.deepEqual(headless.value.intent, saved.intent);
      const provenance = saved.intent.provenance.find(entry => entry.releaseSha256 === matt.root.releaseSha256);
      assert.deepEqual(provenance.sources.find(source => source.id === 'matt'), matt.sources[0]);
    } finally { await new Promise(resolve => fresh.server.close(resolve)); }
  } finally { await new Promise(resolve => started.server.close(resolve)); }
});
