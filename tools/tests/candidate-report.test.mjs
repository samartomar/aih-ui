import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { claimDataDir } from '../candidate/data-dir.mjs';
import { MANIFEST_SCHEMA, candidateLayout } from '../candidate/layout.mjs';
import { writeReport } from '../candidate/report.mjs';
import { redact, redactJson } from '../candidate/redact.mjs';

async function contents(root) {
  const result = {};
  for (const item of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (item.isFile()) { const path = join(item.parentPath, item.name); result[relative(root, path).split(sep).join('/')] = await readFile(path, 'utf8'); }
  }
  return result;
}
// A data directory the candidate made (it has its marker), removed afterwards.
async function candidateArea(t) {
  const root = await mkdtemp(join(tmpdir(), 'candidate-report-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  claimDataDir(root);
  return { root, layout: candidateLayout(root) };
}
const manifestText = candidate => JSON.stringify({ schema: MANIFEST_SCHEMA, candidate,
  packages: Object.fromEntries(['core', 'catalog', 'scan'].map((name, at) => [name, { tarball: `/archive/${name}.tgz`, sha256: String(at + 1).repeat(64), commit: `${at + 1}234567890` }])) });
const refused = code => error => { assert.equal(error.code, code, error.message); return true; };

test('redacts credential formats, sensitive pairs, nested JSON and both home styles', () => {
  const secrets = ['ghp_abcdef', 'gho_abcdef', 'ghu_abcdef', 'ghs_abcdef', 'ghr_abcdef', 'github_pat_abcdef', 'sk-ant-abcdef', 'sk-abcdef', 'bearer-value', 'header-value', 'url-user:url-pass', 'pem-value', 'pair-value', 'json-value'];
  const input = `${secrets.slice(0, 8).join(' ')}\nBearer bearer-value\nAuthorization: header-value\nhttps://url-user:url-pass@host/path\n-----BEGIN RSA PRIVATE KEY-----\npem-value\n-----END RSA PRIVATE KEY-----\nMY_TOKEN=pair-value\n"apiKey": "json-value"\nC:/Users/Owner C:\\Users\\Owner`;
  const result = redact(input, { realHome: 'C:\\Users\\Owner' });
  for (const secret of secrets) assert.ok(!result.includes(secret), secret);
  assert.equal((result.match(/<real-home>/g) ?? []).length, 2);
  assert.deepEqual(redactJson({ nested: [{ apiKey: 'hidden', text: 'ghp_abcdef' }], authorization: { value: 'hidden' } }), { nested: [{ apiKey: '[redacted]', text: '[redacted]' }], authorization: '[redacted]' });
});
test('auth is redacted only as a whole word of a name, so authority and author are kept', () => {
  for (const name of ['auth', '_auth', 'auth_token', 'authorization', 'authToken', 'npm-auth']) {
    assert.equal(redact(`${name}=hidden-value`), `${name}=[redacted]`, name);
    assert.equal(redact(`${name}: hidden-value`), `${name}: [redacted]`, name);
    assert.equal(redact(`{"${name}": "hidden-value"}`), `{"${name}": "[redacted]"}`, name);
    assert.deepEqual(redactJson({ [name]: 'hidden-value' }), { [name]: '[redacted]' }, name);
  }
  for (const name of ['authority', 'author', 'authoring', 'authorId', 'oauthless']) {
    assert.equal(redact(`${name}=kept-value`), `${name}=kept-value`, name);
    assert.equal(redact(`${name}: kept-value`), `${name}: kept-value`, name);
    assert.equal(redact(`{"${name}": "kept-value"}`), `{"${name}": "kept-value"}`, name);
    assert.deepEqual(redactJson({ [name]: 'kept-value' }), { [name]: 'kept-value' }, name);
  }
});
test('redacts name: value pairs outside JSON, bare npm tokens, JWTs and AWS access keys, and keeps URLs and plain text', () => {
  const npm = `npm_${'a1B2c3D4e5'.repeat(3)}`, jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJl', aws = 'AKIAIOSFODNN7EXAMPLE', temporary = 'ASIAIOSFODNN7EXAMPLE';
  const result = redact(`password: hunter2\napi_key: key-value\nproxy: http://host:8080/path\nnote: nothing secret here\nfound ${npm} and ${jwt} and ${aws} and ${temporary} today\nnpm_short`);
  for (const secret of ['hunter2', 'key-value', npm, jwt, aws, temporary]) assert.ok(!result.includes(secret), secret);
  for (const kept of ['proxy: http://host:8080/path', 'note: nothing secret here', 'npm_short', 'found ', ' today']) assert.ok(result.includes(kept), kept);
});

test('report confines writes, records missing inputs and redacts all bundle text', async t => {
  const { root, layout } = await candidateArea(t), realHome = '/fake/owner';
  for (const dir of [layout.state, layout.logs, layout.config, layout.savedIntents]) await mkdir(dir, { recursive: true });
  await writeFile(layout.manifest, manifestText('owner candidate'));
  await writeFile(layout.server, JSON.stringify({ pid: 999999, state: 'starting', url: 'http://localhost:4300', port: 4300, startedAt: 'today', packages: [{ name: '@aihq/core', version: '1.0.0' }] }));
  await writeFile(layout.serverLog, `ghp_secret123 sk-ant-secret123 https://user:secret@host ${realHome}`);
  await writeFile(layout.settings, JSON.stringify({ apiKey: 'hidden-key', path: realHome }));
  await writeFile(join(layout.savedIntents, 'saved.json'), '{"token":"saved-secret"}');
  const before = await contents(root);
  const { bundleDir, files } = await writeReport({ dataDir: root, realHome, now: new Date('2026-01-02T03:04:05Z') });
  assert.ok(bundleDir.startsWith(layout.reports + sep));
  const bundle = await contents(bundleDir), text = Object.values(bundle).join('\n');
  for (const name of ['identity.json', 'environment.json', 'ISSUE.md', 'README.md', 'logs/server.log', 'records/config/settings.json']) assert.ok(files.includes(name), name);
  for (const secret of ['ghp_secret123', 'sk-ant-secret123', 'user:secret', 'hidden-key', 'saved-secret', realHome]) assert.ok(!text.includes(secret), secret);
  for (const heading of ['Steps to reproduce', 'Expected result', 'Actual result', 'not present', 'not observed evidence']) assert.ok(text.includes(heading), heading);
  const identity = JSON.parse(bundle['identity.json']);
  assert.equal(identity.running, false);
  assert.equal(identity.server.state, 'starting');
  assert.equal(identity.manifest.candidate, 'owner candidate');
  assert.deepEqual(identity.manifest.packages.map(pkg => [pkg.name, pkg.tarball]), [['@aihq/core', 'core.tgz'], ['@aihq/scan', 'scan.tgz'], ['@aihq/catalog', 'catalog.tgz']]);
  assert.match(bundle['ISSUE.md'], /Candidate: owner candidate/);
  assert.match(bundle['README.md'], /records\/live: not captured/);
  const after = await contents(root);
  for (const [path, value] of Object.entries(after)) if (!path.startsWith('reports/')) assert.equal(value, before[path], path);
});
test('an unreadable manifest is reported as such, and the report is still written', async t => {
  const { root, layout } = await candidateArea(t);
  await writeFile(layout.manifest, JSON.stringify({ schema: 'something-else' }));
  const { bundleDir } = await writeReport({ dataDir: root });
  const identity = JSON.parse(await readFile(join(bundleDir, 'identity.json'), 'utf8'));
  assert.match(identity.manifest, /^unreadable: /);
  assert.match(await readFile(join(bundleDir, 'ISSUE.md'), 'utf8'), /Candidate: unreadable: /);
});
test('report refuses a missing directory and one that is not a candidate data directory, with coded refusals', async t => {
  const { root } = await candidateArea(t);
  const plain = await mkdtemp(join(tmpdir(), 'candidate-plain-'));
  t.after(() => rm(plain, { recursive: true, force: true }));
  await writeFile(join(plain, 'keep.txt'), 'keep');
  await assert.rejects(writeReport({ dataDir: join(root, 'absent') }), refused('CANDIDATE_DATA_FOREIGN'));
  await assert.rejects(writeReport({ dataDir: plain }), refused('CANDIDATE_DATA_FOREIGN'));
  assert.deepEqual(await readdir(plain), ['keep.txt']);
});
test('report includes only newest three checks, bounded tails, and refuses external links', async t => {
  const { root, layout } = await candidateArea(t);
  const outside = await mkdtemp(join(tmpdir(), 'candidate-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  for (let i = 0; i < 4; i++) {
    const dir = join(layout.checks, `run-${i}`); await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'check.log'), i === 3 ? 'x'.repeat(1024 * 1024 + 100) + '\nEND' : `run ${i}`);
    await utimes(dir, i + 1, i + 1);
  }
  await mkdir(layout.config);
  await writeFile(join(outside, 'secret.json'), '{"outside":"never-copy"}');
  await symlink(join(outside, 'secret.json'), layout.settings);
  const { bundleDir } = await writeReport({ dataDir: root });
  const bundle = await contents(bundleDir), text = Object.values(bundle).join('\n');
  assert.ok(!Object.keys(bundle).some(path => path.includes('run-0')));
  assert.ok(text.includes('truncated') && text.includes('END'));
  assert.ok(!text.includes('never-copy'));
});
test('a ready candidate adds its readiness report and batch as redacted live records, and a failing route is listed, never fatal', async t => {
  const { root, layout } = await candidateArea(t);
  const seen = [];
  const service = createServer((request, response) => {
    seen.push([request.method, request.url, request.headers.origin]);
    if (request.url === '/api/readiness-report') response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ok', note: 'ghp_livesecret123' }));
    else response.writeHead(500, { 'content-type': 'application/json' }).end('{}');
  });
  await new Promise(done => service.listen(0, '127.0.0.1', done));
  t.after(() => service.close());
  const origin = `http://127.0.0.1:${service.address().port}`;
  await mkdir(layout.state, { recursive: true });
  await writeFile(layout.server, JSON.stringify({ pid: process.pid, state: 'ready', url: `${origin}/`, port: service.address().port, startedAt: 'today' }));
  const { bundleDir, files } = await writeReport({ dataDir: root });
  assert.deepEqual(seen, [['GET', '/api/readiness-report', origin], ['GET', '/api/batch', origin]]);
  assert.ok(files.includes('records/live/readiness-report.json'));
  assert.ok(!files.includes('records/live/batch.json'));
  const live = await readFile(join(bundleDir, 'records', 'live', 'readiness-report.json'), 'utf8');
  assert.ok(!live.includes('ghp_livesecret123'));
  assert.equal(JSON.parse(live).status, 'ok');
  assert.match(await readFile(join(bundleDir, 'README.md'), 'utf8'), /records\/live\/batch\.json: not available: HTTP 500/);
  assert.equal(JSON.parse(await readFile(join(bundleDir, 'identity.json'), 'utf8')).running, true);
});
test('live records are not requested from an address that is not local', async t => {
  const { root, layout } = await candidateArea(t);
  await mkdir(layout.state, { recursive: true });
  await writeFile(layout.server, JSON.stringify({ pid: process.pid, state: 'ready', url: 'http://example.invalid:4300/' }));
  let asked = false;
  const { bundleDir } = await writeReport({ dataDir: root, fetchImpl: async () => { asked = true; return new Response('{}'); } });
  assert.equal(asked, false);
  assert.match(await readFile(join(bundleDir, 'README.md'), 'utf8'), /records\/live: not available: the recorded address is not a local one/);
});
