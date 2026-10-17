import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileFrictionEvidence } from '../server/authoring.mjs';

// The demo/test evidence file is bounded by the friction adapter's own limit, loaded from the consumer directory, never a copy of the number:
// a file beyond it reads as unreadable (null) at the host, so one malformed fixture never makes the adapter refuse the whole check.
async function withConsumer(limit, run) {
  const dir = await mkdtemp(join(tmpdir(), 'aih-friction-source-'));
  try {
    await mkdir(join(dir, 'consumer'));
    await writeFile(join(dir, 'consumer', 'friction.mjs'), `export const MAX_EVIDENCE = ${limit};\n`);
    await run(dir, async (name, entries) => { const path = join(dir, name); await writeFile(path, typeof entries === 'string' ? entries : JSON.stringify({ entries })); return path; });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const entries = count => Array.from({ length: count }, (_, index) => ({ id: `cap-${index}`, capturedAt: '2026-10-10T09:00:00Z', result: { n: index } }));

test('the evidence file is bounded by the consumer directory\'s MAX_EVIDENCE, whatever its value', async () => {
  await withConsumer(3, async (dir, write) => {
    const read = await fileFrictionEvidence(dir, await write('at-limit.json', entries(3)));
    const kept = await read();
    assert.equal(kept.length, 3); assert.equal(kept.every(entry => entry.fixture === true), true);
    assert.equal(await (await fileFrictionEvidence(dir, await write('over.json', entries(4))))(), null);
  });
  await withConsumer(300, async (dir, write) => {
    assert.equal((await (await fileFrictionEvidence(dir, await write('wide.json', entries(257))))()).length, 257);
    assert.equal(await (await fileFrictionEvidence(dir, await write('wider.json', entries(301))))(), null);
  });
});

test('a malformed or missing evidence file is unreadable, never an exception, and entries are labelled fixture', async () => {
  await withConsumer(8, async (dir, write) => {
    for (const body of ['{', '{"entries":"x"}', '{"entries":[null]}', '{"entries":[[]]}', '{"entries":[1]}']) assert.equal(await (await fileFrictionEvidence(dir, await write('bad.json', body)))(), null, body);
    assert.equal(await (await fileFrictionEvidence(dir, join(dir, 'missing.json')))(), null);
    assert.equal(await (await fileFrictionEvidence(dir, await write('none.json', '{"entries":null}')))(), undefined, 'A host with no history yet holds none.');
    const [forced] = await (await fileFrictionEvidence(dir, await write('claims.json', [{ id: 'a', fixture: false }])))();
    assert.equal(forced.fixture, true);
  });
});

test('authoring.mjs holds no copy of the evidence limit', async () => {
  const source = await readFile(new URL('../server/authoring.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /entries\.length\s*>\s*\d+/);
});
