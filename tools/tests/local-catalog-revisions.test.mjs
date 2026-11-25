// Host-level Scan revision reads on a minimal fixture consumer. Its installed packages are
// contract-shaped fakes of the public @aihq/catalog and @aihq/scan entries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalCatalog } from '../workbench/local-catalog.mjs';

const PIN = '7c525bd7d8b6e8a0c756d79f7e29f44ec38bff26', REPO = 'https://github.com/samartomar/aih-catalog';
const SOURCE = { id: 'upstream', repository: 'https://github.com/example/skills', commit: 'c'.repeat(40) };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const key = c => 'git-sha1:' + c.repeat(40);
const SKILL = Buffer.from('# Demo\n');

async function writePackage(consumer, name, exports, files) {
  const root = join(consumer, 'node_modules', ...name.split('/'));
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name, version: '0.0.0-dev.1', type: 'module', exports }));
  for (const [file, text] of Object.entries(files)) await writeFile(join(root, file), text);
}

const fakeReader = `
export const readRecipe = () => ({ status: 'ok', sha256: '7bdb820e826980a8ad94c4d847f42db0cca2bc0e065f38317811adc83da5848a', recipe: { id: 'trio', members: [], aiSetup: {} } });
export const readQualification = () => ({ status: 'refused' });
export const readToolProfile = () => ({ status: 'ok', profile: { name: 'Claude Code', version: 1 } });
export const readContent = bytes => ({ status: 'ok', content: JSON.parse(Buffer.from(bytes).toString('utf8')) });
export const listItems = content => content.items;
export const derive = item => ({ sourceIds: [...new Set(item.files.map(file => file.sourceId))], packagePath: [], size: 0 });
export const availability = () => ({ available: true });
export const planInstall = () => ({ status: 'ok', plan: [] });
export const planRecipe = () => ({ status: 'ok', plan: [] });`;
// Trust is carried by the bundle bytes; matching compares supplied bytes with the summary's files.
const fakeScan = `
import { createHash } from 'node:crypto';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function readSummary(bytes) {
  const summary = JSON.parse(Buffer.from(bytes).toString('utf8'));
  return summary.format === 'aih-scan-summary/1' ? { status: 'ok', summary } : { status: 'unsupported-version', reason: 'format' };
}
export async function verifySummary(bytes, bundle) {
  const read = readSummary(bytes), trust = JSON.parse(Buffer.from(bundle).toString('utf8'));
  if (read.status !== 'ok') return read;
  return { status: 'ok', verified: true, withdrawn: false, signer: { identity: 'publisher', trusted: trust.trusted === true }, summary: read.summary };
}
export async function matchScan(verified, files) {
  const wanted = verified.summary.files.map(file => file.path + ':' + file.sha256).sort().join();
  const given = files.map(file => file.path + ':' + sha(file.bytes)).sort().join();
  return { status: 'ok', matches: wanted === given, coverage: 'complete', signer: verified.signer, scanKey: verified.summary.scanKey, differences: { missing: [], extra: [], changed: [], modeChanged: [] } };
}
export async function readFindings() { return { status: 'ok', findings: [] }; }`;

const summary = (scanKey, revision, extra = {}) => ({ format: 'aih-scan-summary/1', scanKey, revision, label: 'clean', score: 0, coverage: 'complete',
  scannedAt: '2026-11-0' + revision + 'T00:00:00Z', files: [{ path: 'SKILL.md', mode: '100644', part: 'text', sha256: sha(SKILL) }],
  tools: [{ tool: 'skillspector', version: '2.13.6', mode: 'static', result: 'pass', counts: {} }], sarif: [], ...extra });

// items: [{ id, scanKey, revisions: [{ revision, trusted, summary? }], legacy? }]
async function fixture(t, items, { cached = true } = {}) {
  const consumer = await mkdtemp(join(tmpdir(), 'aih-ui-revisions-'));
  t.after(() => rm(consumer, { recursive: true, force: true }));
  await writePackage(consumer, '@aihq/catalog', { './reader': './reader.js', './contracts': './contracts.js' },
    { 'reader.js': fakeReader, 'contracts.js': "export const toolProfiles = { 'claude-code': '{}' };" });
  await writePackage(consumer, '@aihq/scan', { './read': './read.js' }, { 'read.js': fakeScan });
  const file = { sourceId: SOURCE.id, sourcePath: 'skills/demo/SKILL.md', sha256: sha(SKILL), executable: false, bytes: SKILL.length };
  const content = { framework: { id: 'demo', name: 'Demo' }, sources: [SOURCE],
    items: items.map(item => ({ id: item.id, kind: 'skill', name: item.id, description: '', scanKey: item.scanKey, files: [file] })) };
  const text = JSON.stringify(content);
  await mkdir(join(consumer, 'public', 'scan'), { recursive: true });
  await mkdir(join(consumer, 'public', 'workbench'), { recursive: true });
  await writeFile(join(consumer, 'public', 'catalog.json'), JSON.stringify({ data: { repository: REPO, commit: PIN, files: [{ path: 'data/demo/content.json', sha256: sha(text) }] }, documents: [text] }));
  await writeFile(join(consumer, 'public', 'workbench', 'tool-setup-data.json'), JSON.stringify({ source: { repository: REPO, commit: PIN }, recipe: {}, qualifications: {} }));
  const records = {}, summaries = {};
  const put = async (name, value) => {
    const bytes = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
    await writeFile(join(consumer, 'public', 'scan', name), bytes);
    return { url: '/scan/' + name, sha256: sha(bytes), bytes: bytes.length };
  };
  for (const item of items) {
    const stem = item.scanKey.replace(':', '-');
    const listed = [];
    for (const revision of item.revisions) {
      const value = await put(`${stem}-r${revision.revision}-summary.json`, revision.summary ?? summary(item.scanKey, revision.revision));
      summaries[item.id + '@' + revision.revision] = value.sha256;
      listed.push({ revision: revision.revision, summary: value, bundle: await put(`${stem}-r${revision.revision}-bundle.sigstore`, { trusted: revision.trusted }), sarif: [] });
    }
    records[item.scanKey] = item.legacy ? listed[0] : { revisions: listed };
  }
  await writeFile(join(consumer, 'public', 'scan', 'index.json'), JSON.stringify({ catalogCommit: PIN, release: 'fixture', records }));
  let cache;
  if (cached) {
    cache = join(consumer, 'source-cache.json');
    await writeFile(cache, JSON.stringify({ source: { repository: SOURCE.repository, commit: SOURCE.commit }, files: [{ path: file.sourcePath, sha256: file.sha256, bytes: { data: SKILL.toString('base64') } }] }));
  }
  return { local: await createLocalCatalog(consumer, cache), summaries };
}

test('a legacy one-record index stays ready', async t => {
  const { local } = await fixture(t, [{ id: 'demo.legacy', scanKey: key('a'), legacy: true, revisions: [{ revision: 1, trusted: true }] }]);
  const read = await local.evidence('demo.legacy');
  assert.equal(read.status, 'ready');
  assert.equal(read.summary.revision, 1);
});

test('a chosen revision is returned beside the newest trusted default', async t => {
  const { local } = await fixture(t, [{ id: 'demo.skill', scanKey: key('b'), revisions: [{ revision: 1, trusted: true }, { revision: 2, trusted: true }] }]);
  const latest = await local.evidence('demo.skill');
  assert.equal(latest.summary.revision, 2);
  assert.equal(latest.selection, 'default');
  const chosen = await local.evidence('demo.skill', 1);
  assert.equal(chosen.summary.revision, 1);
  assert.equal(chosen.selection, 'chosen');
  assert.equal(chosen.status, 'ready');
  assert.deepEqual(chosen.revisions.map(revision => [revision.revision, revision.default]), [[1, false], [2, true]]);
});

test('an unknown or invalid revision is refused with status 400', async t => {
  const { local } = await fixture(t, [{ id: 'demo.skill', scanKey: key('b'), revisions: [{ revision: 1, trusted: true }, { revision: 2, trusted: true }] }]);
  for (const revision of [3, 0, -1, 1.5, '1']) {
    await assert.rejects(local.evidence('demo.skill', revision), error => error.status === 400 && error.code === 'CATALOG_INPUT_INVALID', String(revision));
  }
  const { validate } = await import('../workbench/local-server.mjs');
  for (const action of ['catalog-evidence', 'record-review']) {
    for (const revision of [0, '1', 1.5]) {
      const body = action === 'catalog-evidence' ? { mode: 'vibe', itemId: 'demo.skill', revision }
        : { mode: 'enterprise', digest: 'd'.repeat(64), company: 'C', reviewer: 'R', team: '', decision: 'Accepted risk', note: 'n', itemId: 'demo.skill', revision };
      assert.throws(() => validate(action, body), error => error.status === 400, action + ' ' + revision);
    }
  }
  assert.doesNotThrow(() => validate('catalog-evidence', { mode: 'vibe', itemId: 'demo.skill', revision: 1 }));
});

test('a review of revision 1 binds revision 1 and its summary while revision 2 is the default', async t => {
  const { local, summaries } = await fixture(t, [{ id: 'demo.skill', scanKey: key('b'), revisions: [{ revision: 1, trusted: true }, { revision: 2, trusted: true }] }]);
  const { record, evidence } = await local.reviewEvidence('demo.skill', 1);
  assert.equal(record.summary.revision, 1);
  assert.equal(evidence.revision, 1);
  assert.equal(evidence.summary.sha256, summaries['demo.skill@1']);
  assert.notEqual(evidence.summary.sha256, summaries['demo.skill@2']);
  assert.equal((await local.reviewEvidence('demo.skill')).evidence.revision, 2);
});

test('an untrusted fallback is never shown as ready', async t => {
  const { local } = await fixture(t, [{ id: 'demo.skill', scanKey: key('b'), revisions: [{ revision: 1, trusted: false }] }]);
  const read = await local.evidence('demo.skill');
  assert.equal(read.selection, 'fallback');
  assert.equal(read.fallbackTier, 'newest-recorded');
  assert.equal(read.status, 'unverified');
});

test('without the source cache the newest trusted revision is shown as not checked here', async t => {
  const { local } = await fixture(t, [{ id: 'demo.skill', scanKey: key('b'), revisions: [{ revision: 1, trusted: true }, { revision: 2, trusted: false }] }], { cached: false });
  const read = await local.evidence('demo.skill');
  assert.equal(read.revision, 1);
  assert.equal(read.fallbackTier, 'trusted-unchecked');
  assert.equal(read.status, 'ready');
  assert.match(read.selectionNote, /trusted/i);
  assert.match(read.selectionNote, /not.*checked/i);
});

test('an unreadable revision keeps the readable ones available', async t => {
  const { local } = await fixture(t, [{ id: 'demo.skill', scanKey: key('b'), revisions: [{ revision: 1, trusted: true }, { revision: 2, trusted: true },
    { revision: 3, trusted: true, summary: { format: 'aih-scan-summary/9', scanKey: key('b'), revision: 3 } }] }]);
  const read = await local.evidence('demo.skill');
  assert.equal(read.revision, 2);
  assert.equal(read.status, 'ready');
  assert.equal(read.revisions[2].readable, false);
  const chosen = await local.evidence('demo.skill', 3);
  assert.equal(chosen.status, 'unreadable');
  assert.match(chosen.reason, /format/);
});
