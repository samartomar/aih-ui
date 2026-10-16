import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, mkdtemp, utimes } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planBatch } from './batch.mjs';
import { createBatchHost } from './batch-host.mjs';
import { batchFixture } from './batch-fixture.mjs';
import { homeEnvironment } from './home-environment.mjs';
import { replaceEnvelope, revisionOf } from './envelope-file.mjs';

// The host-level test applies through Core, which keeps its records under the account home: a disposable one, set before the first Core call.
Object.assign(process.env, homeEnvironment(mkdtempSync(join(tmpdir(), 'ui35-envelope-home-'))));

const NOW = '2026-10-16T09:00:00Z';
const scratch = () => mkdtemp(join(tmpdir(), 'ui35-envelope-'));
const valueOf = result => { assert.equal(result.status, 'ok', JSON.stringify(result.diagnostics)); return result.value; };
// Distinct envelopes, each with a revision of its own, as the attempts that replace the stored one would have.
const variants = (bytes, count) => Array.from({ length: count }, (_, index) => {
  const doc = JSON.parse(Buffer.from(bytes).toString('utf8'));
  doc.revision.sha256 = (index + 1).toString(16).repeat(64);
  return new TextEncoder().encode(JSON.stringify(doc, null, 2) + '\n');
});

test('of several replaces that name the same revision, exactly one is applied and the rest are refused', async () => {
  const f = await batchFixture(await scratch(), { applyEarlier: false }), root = await scratch(), path = join(root, 'envelope.json');
  const expectedRevisionSha256 = revisionOf(f.envelopeBytes), bytes = variants(f.envelopeBytes, 5);
  await writeFile(path, f.envelopeBytes);
  // A lock file an earlier version of this module could leave behind is no part of the protocol now: an old one changes nothing.
  const old = new Date(Date.now() - 60_000);
  await writeFile(`${path}.lock`, 'dead-writer'); await utimes(`${path}.lock`, old, old);
  const settled = await Promise.allSettled(bytes.map(next => replaceEnvelope(path, next, { expectedRevisionSha256 })));
  const won = settled.flatMap((result, index) => result.status === 'fulfilled' ? [index] : []);
  assert.equal(won.length, 1, JSON.stringify(settled.map(result => result.reason?.code ?? 'won')));
  assert.deepEqual(settled.filter(result => result.status === 'rejected').map(result => result.reason.code), Array(4).fill('BATCH_ENVELOPE_CHANGED'));
  assert.deepEqual(new Uint8Array(await readFile(path)), bytes[won[0]], 'the file holds the winner\'s bytes');
  assert.deepEqual((await readdir(root)).filter(name => name.endsWith('.tmp')), [], 'no temporary file is left behind');
});

test('a replace is a compare-and-swap on the stored revision, and a refused one changes nothing', async () => {
  const f = await batchFixture(await scratch(), { applyEarlier: false }), root = await scratch(), path = join(root, 'envelope.json');
  const [first, second] = variants(f.envelopeBytes, 2), revision = revisionOf(f.envelopeBytes);
  await writeFile(path, f.envelopeBytes);
  await assert.rejects(replaceEnvelope(path, first), TypeError, 'the expected revision is required');
  await assert.rejects(replaceEnvelope(path, first, { expectedRevisionSha256: 'f'.repeat(64) }), { code: 'BATCH_ENVELOPE_CHANGED' });
  assert.deepEqual(new Uint8Array(await readFile(path)), f.envelopeBytes, 'a stale writer left the file as it was');
  await replaceEnvelope(path, first, { expectedRevisionSha256: revision });
  assert.deepEqual(new Uint8Array(await readFile(path)), first);
  await assert.rejects(replaceEnvelope(path, second, { expectedRevisionSha256: revision }), { code: 'BATCH_ENVELOPE_CHANGED' }, 'the revision it read is no longer the stored one');
  await replaceEnvelope(path, second, { expectedRevisionSha256: revisionOf(first) });
  assert.deepEqual(new Uint8Array(await readFile(path)), second);
  await assert.rejects(replaceEnvelope(join(root, 'missing.json'), first, { expectedRevisionSha256: revision }), { code: 'BATCH_ENVELOPE_CHANGED' }, 'nothing stored is nothing to replace');
  assert.deepEqual((await readdir(root)).sort(), ['envelope.json'], 'no temporary file is left behind');
});

test('a refused or failed replace does not hold up the next one for the same file', async () => {
  const f = await batchFixture(await scratch(), { applyEarlier: false }), root = await scratch(), path = join(root, 'envelope.json');
  const [bytes] = variants(f.envelopeBytes, 1), revision = revisionOf(f.envelopeBytes);
  await writeFile(path, f.envelopeBytes);
  const turns = await Promise.allSettled([replaceEnvelope(path, bytes, { expectedRevisionSha256: 'f'.repeat(64) }),
    replaceEnvelope(join(root, 'no-such-folder', 'envelope.json'), bytes, { expectedRevisionSha256: revision }), replaceEnvelope(path, bytes, { expectedRevisionSha256: revision })]);
  assert.deepEqual(turns.map(turn => turn.status), ['rejected', 'rejected', 'fulfilled']);
  assert.deepEqual(new Uint8Array(await readFile(path)), bytes);
});

test('two runs of the same kept process from the same stored bytes against one real file run it once', async () => {
  const f = await batchFixture(await scratch(), { applyEarlier: false }), root = await scratch(), path = join(root, 'envelope.json');
  await writeFile(f.procMarker, 'ok');
  const kept = valueOf(await planBatch({ ...f.plan, scopes: [f.plan.scopes[1]], inputs: [], actions: [{ ...f.action('b-proc', 'scope-b', 'b-proc'), retain: true }] }));
  await writeFile(path, kept.envelopeBytes);
  const persist = (bytes, { expectedRevisionSha256 }) => replaceEnvelope(path, bytes, { expectedRevisionSha256 });
  const again = { rerun: ['b-proc'], rerunRevision: revisionOf(kept.envelopeBytes) };
  const attempt = () => createBatchHost({ materialRoots: f.materialRoots, controls: { logging: 'off' } })
    .runBatch({ envelopeBytes: kept.envelopeBytes, batchId: kept.record.id, approve: { batchId: kept.record.id }, persist, now: NOW, ...again });
  const reports = await Promise.all([attempt(), attempt()]);
  for (const report of reports) assert.equal(report.status, 'ok', JSON.stringify(report.diagnostics));
  assert.deepEqual(reports.map(report => report.actions.map(action => [action.outcome, action.reason])).sort(),
    [[['completed', null]], [['failed', 'consent-not-recorded']]]);
  assert.equal(await f.procCount(), 1, 'the opaque process ran once');
  assert.notEqual(revisionOf(new Uint8Array(await readFile(path))), revisionOf(kept.envelopeBytes), 'the one attempt moved the stored revision');
});
