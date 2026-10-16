import test from 'node:test';
import assert from 'node:assert/strict';
import { compareIdentity, compareRenderedIdentity } from '../candidate/smoke.mjs';

const pkg = { name: '@aihq/core', sha256: 'a'.repeat(64), commit: '1234567890abcdef', tarball: '/candidate/core.tgz' };
const identity = { packages: [pkg] };
const summary = { ok: true, packages: [{ ...pkg, name: 'core', packageName: pkg.name, tarball: 'C:\\candidate\\core.tgz' }] };
test('package identity accepts matching basenames across platforms', () => {
  assert.deepEqual(compareIdentity(identity, summary), []);
});
for (const field of ['sha256', 'commit', 'tarball']) test(`package identity reports ${field} mismatch`, () => {
  assert.match(compareIdentity(identity, { ...summary, packages: [{ ...summary.packages[0], [field]: 'different' }] }).join('\n'), new RegExp(field));
});
test('package identity reports missing package and unsuccessful response', () => {
  assert.match(compareIdentity(identity, { ok: true, packages: [] }).join('\n'), /missing.*@aihq\/core/i);
  assert.ok(compareIdentity(identity, { ok: false }).length);
});
const rendered = { stripText: `${pkg.name} 1234567`, provenanceText: `${pkg.sha256} ${pkg.commit}` };
test('rendered identity accepts short strip commit and full disclosure', () => {
  assert.deepEqual(compareRenderedIdentity(identity, rendered), []);
});
for (const [label, value] of [
  ['package name', { ...rendered, stripText: '1234567' }],
  ['short commit', { ...rendered, stripText: pkg.name }],
  ['sha256', { ...rendered, provenanceText: pkg.commit }],
  ['full commit', { ...rendered, provenanceText: `${pkg.sha256} 1234567` }],
]) test(`rendered identity reports missing ${label}`, () => {
  assert.ok(compareRenderedIdentity(identity, value).length);
});

test('smoke writes failure artifacts without a browser and refuses API redirects', async t => {
  const { smokeCandidate } = await import('../candidate/smoke.mjs');
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const output = await mkdtemp(join(tmpdir(), 'candidate-smoke-'));
  const requests = [];
  const origin = 'http://127.0.0.1:4300';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push(url);
    assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 302, headers: { location: 'http://other.invalid/never-follow' } });
  });
  t.after(() => rm(output, { recursive: true, force: true }));
  const result = await smokeCandidate({ origin, identity, output, playwrightModule: 'data:text/javascript,throw%20new%20Error("browser%20unavailable")' });
  assert.equal(result.ok, false);
  assert.ok(result.mismatches.some(message => message.includes('HTTP 302')));
  assert.ok(result.mismatches.some(message => message.includes('browser unavailable')));
  assert.deepEqual(requests, [origin + '/api/packages']);
  const record = JSON.parse(await readFile(join(output, 'smoke.json'), 'utf8'));
  assert.equal(record.origin, origin);
  assert.ok(record.checkedAt);
  assert.ok((await readFile(join(output, 'smoke.log'), 'utf8')).includes('ok: false'));
});
