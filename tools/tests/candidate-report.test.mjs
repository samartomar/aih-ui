import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { candidateLayout } from '../candidate/layout.mjs';
import { writeReport } from '../candidate/report.mjs';
import { redact, redactJson } from '../candidate/redact.mjs';

async function contents(root) {
  const result = {};
  for (const item of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (item.isFile()) { const path = join(item.parentPath, item.name); result[relative(root, path).split(sep).join('/')] = await readFile(path, 'utf8'); }
  }
  return result;
}
test('redacts credential formats, sensitive pairs, nested JSON and both home styles', () => {
  const secrets = ['ghp_abcdef', 'gho_abcdef', 'ghu_abcdef', 'ghs_abcdef', 'ghr_abcdef', 'github_pat_abcdef', 'sk-ant-abcdef', 'sk-abcdef', 'bearer-value', 'header-value', 'url-user:url-pass', 'pem-value', 'pair-value', 'json-value'];
  const input = `${secrets.slice(0, 8).join(' ')}\nBearer bearer-value\nAuthorization: header-value\nhttps://url-user:url-pass@host/path\n-----BEGIN RSA PRIVATE KEY-----\npem-value\n-----END RSA PRIVATE KEY-----\nMY_TOKEN=pair-value\n"apiKey": "json-value"\nC:/Users/Owner C:\\Users\\Owner`;
  const result = redact(input, { realHome: 'C:\\Users\\Owner' });
  for (const secret of secrets) assert.ok(!result.includes(secret), secret);
  assert.equal((result.match(/<real-home>/g) ?? []).length, 2);
  assert.deepEqual(redactJson({ nested: [{ apiKey: 'hidden', text: 'ghp_abcdef' }], authorization: { value: 'hidden' } }), { nested: [{ apiKey: '[redacted]', text: '[redacted]' }], authorization: '[redacted]' });
});
test('report confines writes, records missing inputs and redacts all bundle text', async t => {
  const root = await mkdtemp(join(tmpdir(), 'candidate-report-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const layout = candidateLayout(root), realHome = '/fake/owner';
  for (const dir of [layout.state, layout.logs, layout.config, layout.savedIntents]) await mkdir(dir, { recursive: true });
  await writeFile(layout.manifest, JSON.stringify({ schema: 'candidate', label: 'owner', packages: { core: { sha256: 'a'.repeat(64), commit: '1234567890', tarball: '/archive/core.tgz' } } }));
  await writeFile(layout.server, JSON.stringify({ pid: 999999, url: 'http://localhost:4300', port: 4300, startedAt: 'today', packages: [{ name: '@aihq/core', version: '1.0.0' }] }));
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
  assert.equal(JSON.parse(bundle['identity.json']).running, false);
  assert.equal(JSON.parse(bundle['identity.json']).manifest.packages[0].tarball, 'core.tgz');
  const after = await contents(root);
  for (const [path, value] of Object.entries(after)) if (!path.startsWith('reports/')) assert.equal(value, before[path], path);
});
test('report includes only newest three checks, bounded tails, and refuses external links', async t => {
  const root = await mkdtemp(join(tmpdir(), 'candidate-report-'));
  const outside = await mkdtemp(join(tmpdir(), 'candidate-outside-'));
  t.after(() => Promise.all([root, outside].map(path => rm(path, { recursive: true, force: true }))));
  const layout = candidateLayout(root);
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
