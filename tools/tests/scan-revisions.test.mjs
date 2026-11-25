import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { indexedRevisions, readRevisions } from '../workbench/scan-revisions.mjs';

const KEY = 'git-sha1:' + 'a'.repeat(40);
const sha = text => createHash('sha256').update(text).digest('hex');
const asset = (name, ext = 'json') => ({ url: `/scan/${name}.${ext}`, sha256: sha(name), bytes: name.length });
const entry = revision => ({ revision, summary: asset(`r${revision}-summary`), bundle: asset(`r${revision}-bundle`, 'sigstore'), sarif: [asset(`r${revision}-sarif`, 'sarif')] });
const SKILL = 'SKILL.md';
const content = [{ sourcePath: 'skills/demo/' + SKILL, sha256: sha('skill'), executable: false, bytes: Buffer.from('skill') }];

function summary(revision, tools = [{ tool: 'skillspector', version: '2.13.6', mode: 'static', result: 'pass', counts: {} }], extra = {}) {
  return { format: 'aih-scan-summary/1', scanKey: KEY, revision, label: 'clean', score: 0, coverage: 'complete',
    files: [{ path: SKILL, mode: '100644', part: 'text', sha256: sha('skill') }], tools, sarif: [], ...extra };
}

// Contract-shaped @aihq/scan/read: readSummary, verifySummary (signer trust, withdrawals), matchScan.
function fakeScan(table) {
  const calls = { verify: [], match: [] };
  const byUrl = url => table[url.match(/r(\d+)-/)[1]];
  return {
    calls,
    readAsset: async url => Buffer.from(url),
    assetPath: value => value.url,
    scan: {
      readSummary: bytes => ({ status: 'ok', summary: byUrl(String(bytes)).summary }),
      async verifySummary(bytes, bundle, signers, options) {
        const row = byUrl(String(bytes));
        calls.verify.push({ revision: row.summary.revision, bundle: String(bundle), signers, options });
        if (row.verify === 'invalid') return { status: 'refused', reason: 'invalid-signature', verified: false, withdrawn: false, signer: null, summary: row.summary };
        const withdrawn = row.verify === 'withdrawn';
        return { status: 'ok', verified: true, withdrawn, signer: { identity: 'aihq-scan-production', trusted: row.verify === 'trusted' }, summary: row.summary };
      },
      async matchScan(verified, files) {
        const row = table[String(verified.summary.revision)];
        calls.match.push({ revision: verified.summary.revision, verified, files });
        return { status: 'ok', matches: row.matches !== false, coverage: 'complete', signer: verified.signer, scanKey: KEY, differences: { missing: [], extra: [], changed: [], modeChanged: [] } };
      },
    },
  };
}

test('a one-record-per-key index still reads as a single revision', async () => {
  assert.deepEqual(indexedRevisions(entry(1)).revisions.map(r => r.revision), [1]);
  const h = fakeScan({ 1: { summary: summary(1), verify: 'trusted' } });
  const read = await readRevisions({ ...h, scanKey: KEY, entry: entry(1), files: content });
  assert.equal(read.defaultRevision, 1);
  assert.deepEqual(read.revisions.map(r => r.revision), [1]);
  assert.equal(read.revisions[0].trusted, true);
});

test('the newest trusted, unwithdrawn, matching revision is the default and earlier ones stay listed smallest first', async () => {
  const h = fakeScan({
    1: { summary: summary(1), verify: 'trusted' },
    2: { summary: summary(2), verify: 'trusted' },
    3: { summary: summary(3), verify: 'trusted', matches: false },
    4: { summary: summary(4), verify: 'untrusted' },
    5: { summary: summary(5), verify: 'withdrawn' },
    6: { summary: summary(6), verify: 'invalid' },
  });
  const indexed = { revisions: [entry(6), entry(2), entry(4), entry(1), entry(5), entry(3)] };
  const read = await readRevisions({ ...h, scanKey: KEY, entry: indexed, files: content });
  assert.equal(read.defaultRevision, 2);
  assert.deepEqual(read.revisions.map(r => r.revision), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(read.revisions.map(r => r.eligible), [true, true, false, false, false, false]);
  assert.equal(read.revisions[2].match.status, 'differs');
  assert.equal(read.revisions[4].withdrawn, true);
  assert.equal(read.revisions[5].verification.status, 'refused');
});

test('verifySummary runs first and matchScan receives its exact result with the Catalog bytes', async () => {
  const h = fakeScan({ 1: { summary: summary(1), verify: 'trusted' } });
  await readRevisions({ ...h, scanKey: KEY, entry: entry(1), files: content });
  assert.equal(h.calls.verify.length, 1);
  assert.equal(h.calls.verify[0].bundle, '/scan/r1-bundle.sigstore');
  assert.equal(h.calls.match.length, 1);
  assert.equal(h.calls.match[0].verified.signer.identity, 'aihq-scan-production');
  assert.deepEqual(h.calls.match[0].files, [{ path: SKILL, mode: '100644', bytes: content[0].bytes }]);
});

test('a revision that was not verified is never matched or chosen', async () => {
  const h = fakeScan({ 1: { summary: summary(1), verify: 'invalid' } });
  const read = await readRevisions({ ...h, scanKey: KEY, entry: entry(1), files: content });
  assert.equal(h.calls.match.length, 0);
  assert.equal(read.defaultRevision, null);
  assert.equal(read.revisions[0].match.status, 'not-checked');
});

test('without pinned item bytes the content match is reported as not checked and no revision is a trusted default', async () => {
  const h = fakeScan({ 1: { summary: summary(1), verify: 'trusted' }, 2: { summary: summary(2), verify: 'untrusted' } });
  const read = await readRevisions({ ...h, scanKey: KEY, entry: { revisions: [entry(1), entry(2)] }, files: null });
  assert.equal(h.calls.match.length, 0);
  assert.deepEqual(read.revisions.map(r => r.match.status), ['not-checked', 'not-checked']);
  assert.equal(read.defaultRevision, null);
});

test('a summary whose revision differs from the record that names it is refused', async () => {
  const h = fakeScan({ 1: { summary: summary(7), verify: 'trusted' }, 2: { summary: summary(2), verify: 'trusted' } });
  await assert.rejects(readRevisions({ ...h, scanKey: KEY, entry: { revisions: [entry(2), entry(1)] }, files: content }),
    error => error.code === 'CATALOG_INPUT_INVALID' && /revision/.test(error.message));
  const other = fakeScan({ 1: { summary: { ...summary(1), scanKey: 'git-sha1:' + 'b'.repeat(40) }, verify: 'trusted' } });
  await assert.rejects(readRevisions({ ...other, scanKey: KEY, entry: entry(1), files: content }), { code: 'CATALOG_INPUT_INVALID' });
});

test('malformed or duplicate revisions refuse the index entry', () => {
  for (const bad of [{ revisions: [] }, { revisions: [entry(1), entry(1)] }, { revisions: [{ ...entry(1), revision: 0 }] }, { revisions: [entry(1)], withdrawals: 'x' }, null]) {
    assert.throws(() => indexedRevisions(bad), { code: 'CATALOG_INPUT_INVALID' });
  }
});

test('indexed withdrawals are passed to verifySummary for every revision', async () => {
  const h = fakeScan({ 1: { summary: summary(1), verify: 'withdrawn' }, 2: { summary: summary(2), verify: 'trusted' } });
  const withdrawal = { withdrawal: asset('w1-withdrawn'), bundle: asset('w1-bundle', 'sigstore') };
  const read = await readRevisions({ ...h, scanKey: KEY, entry: { revisions: [entry(1), entry(2)], withdrawals: [withdrawal] }, files: content });
  assert.deepEqual(h.calls.verify.map(call => call.options.withdrawn.map(String)), [['/scan/w1-withdrawn.json'], ['/scan/w1-withdrawn.json']]);
  assert.deepEqual(h.calls.verify.map(call => call.options.withdrawnBundle.map(String)), [['/scan/w1-bundle.sigstore'], ['/scan/w1-bundle.sigstore']]);
  assert.equal(read.defaultRevision, 2);
});

test('the AI client, its version and effort are shown where a summary records them; static tools show as static', async () => {
  const ai = { tool: 'skillspector', version: '2.13.6', mode: 'ai', result: 'pass', counts: {},
    ai: { via: 'cli', provider: 'claude_cli', model: 'claude-opus-5-5', effort: 'medium', client: { name: 'claude', version: '2.1.330' } } };
  const plain = { tool: 'cisco-skill-scanner', version: '2.3.2', mode: 'ai', result: 'pass', counts: {}, ai: { via: 'provider', provider: 'openai', model: 'gpt-x' } };
  const h = fakeScan({ 1: { summary: summary(1), verify: 'trusted' }, 2: { summary: summary(2, [ai, plain]), verify: 'trusted' } });
  const read = await readRevisions({ ...h, scanKey: KEY, entry: { revisions: [entry(1), entry(2)] }, files: content });
  assert.deepEqual(read.revisions[0].producer, [{ tool: 'skillspector', version: '2.13.6', mode: 'static', label: 'skillspector 2.13.6 · Static' }]);
  assert.deepEqual(read.revisions[1].producer, [
    { tool: 'skillspector', version: '2.13.6', mode: 'ai', model: 'claude-opus-5-5', client: { name: 'claude', version: '2.1.330' }, effort: 'medium',
      label: 'skillspector 2.13.6 · AI · claude-opus-5-5 · claude 2.1.330 · effort medium' },
    { tool: 'cisco-skill-scanner', version: '2.3.2', mode: 'ai', model: 'gpt-x', label: 'cisco-skill-scanner 2.3.2 · AI · gpt-x' },
  ]);
  assert.equal(read.revisions[0].mode, 'static');
  assert.equal(read.revisions[1].mode, 'ai');
});

test('with no trusted matching revision the newest trusted, unwithdrawn and not contradicted one is shown, else the newest', async () => {
  const h = fakeScan({ 1: { summary: summary(1), verify: 'trusted' }, 2: { summary: summary(2), verify: 'trusted' }, 3: { summary: summary(3), verify: 'untrusted' } });
  const unmatched = await readRevisions({ ...h, scanKey: KEY, entry: { revisions: [entry(1), entry(2), entry(3)] }, files: null });
  assert.equal(unmatched.defaultRevision, null);
  assert.equal(unmatched.fallbackRevision, 2);
  const none = fakeScan({ 1: { summary: summary(1), verify: 'trusted', matches: false }, 2: { summary: summary(2), verify: 'withdrawn' } });
  const contradicted = await readRevisions({ ...none, scanKey: KEY, entry: { revisions: [entry(1), entry(2)] }, files: content });
  assert.equal(contradicted.defaultRevision, null);
  assert.equal(contradicted.fallbackRevision, 2);
  const trusted = fakeScan({ 1: { summary: summary(1), verify: 'trusted' } });
  assert.equal((await readRevisions({ ...trusted, scanKey: KEY, entry: entry(1), files: content })).fallbackRevision, 1);
});
