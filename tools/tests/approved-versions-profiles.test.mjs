import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createPortableProfiles } from '../server/portable-profiles.mjs';
import { installedVersions, versionUnavailable } from '../../src/approved/versions.js';

test('a draft reference requires the exact installed package versions', () => {
  const data = { packages: { core: { version: '2.0.0' }, catalog: { version: '1.0.0' }, scan: { version: '1.1.0' } } };
  const current = installedVersions(data);
  assert.equal(versionUnavailable({}, data), false);
  assert.equal(versionUnavailable(current, data), false);
  assert.equal(versionUnavailable({ ...current, core: '1.0.0' }, data), true);
  assert.equal(versionUnavailable({ core: '2.0.0' }, data), true);
  assert.equal(versionUnavailable(current, { packages: {} }), true);
});

test('the host Profile library projects portable files only and refuses cross-origin reads', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'workbench-profiles-test-'));
  t.after(() => rm(folder, { force: true, recursive: true }));
  const file = join(folder, 'profiles.json');
  await writeFile(file, JSON.stringify([
    { format: 'aih-portable-profile/1', id: 'one', name: 'Profile', catalogIds: ['chosen'],
      firstTask: 'Review changes', instructions: 'Test first', privateMetadata: 'should not be returned' },
    { format: 'unknown' },
  ]));
  const endpoint = createPortableProfiles(file);

  async function fetchProfile(origin) {
    let status, body;
    const response = {
      writeHead(code) { status = code; },
      end(bytes) { body = JSON.parse(bytes); },
    };
    const request = { method: 'GET', headers: { host: '127.0.0.1:6200', origin }, socket: { localPort: 6200 } };
    assert.equal(await endpoint(request, response, '/api/approved-profiles'), true);
    return { status, body };
  }

  const accepted = await fetchProfile('http://127.0.0.1:6200');
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.status, 'partial');
  assert.equal(accepted.body.profiles.length, 1);
  const [profile] = accepted.body.profiles;
  assert.deepEqual(profile.items, ['chosen']);
  assert.equal(profile.firstTask, 'Review changes');
  assert.equal(profile.instructions, 'Test first');
  assert.equal(Object.hasOwn(profile, 'privateMetadata'), false);

  const refused = await fetchProfile('http://127.0.0.1:6201');
  assert.equal(refused.status, 403);
  assert.deepEqual(refused.body.profiles, []);
});
