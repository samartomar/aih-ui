import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rename, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homeEnvironment } from './consumer/home-environment.mjs';
import { createApprovedPersonal } from './server/approved-personal.mjs';
import { createLocalCatalog } from './workbench/local-catalog.mjs';

const [consumerArg, project] = process.argv.slice(2);
if (!consumerArg) throw new Error('Pass an installed consumer with reviewed Catalog inputs and source-cache.json.');
const consumer = resolve(consumerArg);
if (!project) {
  const root = await mkdtemp(join(tmpdir(), 'aih-approved-personal-check-'));
  const home = join(root, 'home'), projectFolder = join(root, 'project');
  try {
    await Promise.all([mkdir(home), mkdir(projectFolder)]);
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), consumer, projectFolder], {
      env: { ...process.env, ...homeEnvironment(home) }, stdio: 'inherit',
    });
    process.exitCode = result.status ?? 1;
  } finally { await rm(root, { recursive: true, force: true }); }
} else {
  const catalog = await createLocalCatalog(consumer);
  const native = createApprovedPersonal({ consumer, catalog: () => catalog, sourceConsumer: consumer, project });
  const framework = catalog.catalog.frameworks.find(row => row.id === 'superpowers');
  const itemId = 'superpowers.skill.brainstorming';
  const items = [{ id: framework.sha256 + '/' + itemId, itemId }];
  const session = 'fixture-session';
  const selection = { items, client: 'claude-code', binding: project, session };
  assert.deepEqual(await readdir(project), []);
  const substitute = await mkdtemp(join(project, 'directory-check-'));
  const original = substitute + '-original';
  const swap = createApprovedPersonal({consumer, catalog: () => catalog, sourceConsumer:consumer, project:substitute});
  const swapReview = await swap.prepare({...selection, binding:substitute});
  assert.equal(swapReview.status, 'ready');
  await rename(substitute, original);
  await mkdir(substitute);
  const refused = await swap.apply({id:swapReview.id, reviewDigest:swapReview.review.reviewDigest, session, confirmed:true});
  assert.equal(refused.status, 'unavailable');
  assert.deepEqual(await readdir(substitute), []);
  await rmdir(substitute);
  await rmdir(original);
  assert.equal((await native.prepare({ ...selection, binding: '' })).status, 'unavailable');
  assert.equal((await native.prepare({ ...selection, items: [{ ...items[0], id: 'wrong-release/' + itemId }] })).status, 'unavailable');
  const prepared = await native.prepare(selection);
  assert.equal(prepared.status, 'ready', JSON.stringify(prepared));
  assert.deepEqual(await readdir(project), []);
  const approval = { id: prepared.id, reviewDigest: prepared.review.reviewDigest, session, confirmed: true };
  assert.equal((await native.apply({ ...approval, session: 'another-session' })).status, 'unavailable');
  assert.equal((await native.apply({ ...approval, reviewDigest: 'other-digest' })).status, 'unavailable');
  assert.equal((await native.apply({ ...approval, confirmed: false })).status, 'unavailable');
  assert.deepEqual(await readdir(project), []);
  const applied = await native.apply(approval);
  assert.equal(applied.status, 'applied', JSON.stringify(applied));
  assert.equal(applied.fileState, 'match', JSON.stringify(applied));
  assert.ok((await readdir(project)).includes('.claude'));
  assert.equal((await native.apply(approval)).status, 'unavailable');
  console.log(JSON.stringify({ itemId, preparation: prepared.status, application: applied.status, fileState: applied.fileState }));
}
