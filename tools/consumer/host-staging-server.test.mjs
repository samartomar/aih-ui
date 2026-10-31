// A real Workbench host stages its startup Catalog material when it knows the project folder; once its server closes,
// none of it is left in the temporary folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startConsumer } from './server.mjs';

test('a host started for a project folder leaves no staged material after its server closes', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'host-staging-server-'));
  const variable = process.platform === 'win32' ? 'TEMP' : 'TMPDIR', saved = process.env[variable];
  t.after(async () => { if (saved === undefined) delete process.env[variable]; else process.env[variable] = saved; await rm(scratch, { recursive: true, force: true }); });
  const temporary = join(scratch, 'tmp'), project = join(scratch, 'project');
  await mkdir(temporary); await mkdir(project);
  process.env[variable] = temporary;
  assert.equal(tmpdir(), temporary);
  const started = await startConsumer({ projectRoot: project });
  const staged = (await readdir(temporary)).filter(name => name.startsWith('aih-authoring-materials-'));
  assert.equal(staged.length, 1, `the host staged its startup material once: ${staged.join(', ')}`);
  await new Promise(resolve => started.server.close(resolve));
  assert.deepEqual((await readdir(temporary)).filter(name => name.startsWith('aih-')), []);
});
