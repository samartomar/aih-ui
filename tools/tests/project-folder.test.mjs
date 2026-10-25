import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { checkProjectFolder, createProjectFolder, shared } from '../consumer/project-folder.mjs';

async function layout() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'project-folder-')));
  const home = join(base, 'home'), envHome = join(base, 'env-home'), project = join(home, 'code', 'app');
  for (const directory of [project, envHome, join(home, '.aih', 'core')]) await mkdir(directory, { recursive: true });
  await writeFile(join(base, 'notes.txt'), 'x');
  return { base, home, envHome, project, options: { home, env: { HOME: envHome } }, done: () => rm(base, { recursive: true, force: true }) };
}

test('accepts an existing folder and names its real path', async () => {
  const fixture = await layout();
  try {
    assert.deepEqual(await checkProjectFolder(fixture.project, fixture.options), { status: 'ok', project: fixture.project });
    assert.deepEqual(await checkProjectFolder(join(fixture.home, 'code', '.', 'app'), fixture.options), { status: 'ok', project: fixture.project });
  } finally { await fixture.done(); }
});

test('refuses each unsafe path with a plain reason', async () => {
  const fixture = await layout();
  const reason = async path => (await checkProjectFolder(path, fixture.options)).reason;
  try {
    assert.match(await reason(''), /Type the full path/);
    assert.match(await reason('code/app'), /full path/);
    assert.match(await reason(join(fixture.base, 'missing')), /does not exist/);
    assert.match(await reason(join(fixture.base, 'notes.txt')), /is a file, not a folder/);
    assert.match(await reason(parse(fixture.base).root), /whole drive/);
    assert.match(await reason(fixture.home), /home folder/);
    assert.match(await reason(fixture.envHome), /home folder/);
    assert.match(await reason(join(fixture.home, '.aih')), /Core keeps its own records/);
    assert.match(await reason(join(fixture.home, '.aih', 'core')), /Core keeps its own records/);
    for (const path of ['', 'code/app', fixture.home]) assert.equal((await checkProjectFolder(path, fixture.options)).status, 'refused');
  } finally { await fixture.done(); }
});

test('refuses the account\'s own home even when the environment names a different one', async () => {
  const fixture = await layout(), account = join(fixture.base, 'account');
  try {
    await mkdir(join(account, '.aih'), { recursive: true });
    const options = { ...fixture.options, accountHome: account };
    assert.match((await checkProjectFolder(account, options)).reason, /home folder/);
    assert.match((await checkProjectFolder(join(account, '.aih'), options)).reason, /Core keeps its own records/);
    assert.equal((await checkProjectFolder(fixture.project, options)).status, 'ok');
  } finally { await fixture.done(); }
});

test('the host default stays until a folder is chosen; the change replaces the execution hosts', async () => {
  const fixture = await layout(), changes = [];
  try {
    const none = createProjectFolder({ onChange: project => changes.push(project), options: fixture.options });
    assert.deepEqual(none.read(), { project: null, source: 'none' });
    const folder = createProjectFolder({ initial: 'C:/configured', onChange: project => changes.push(project), options: fixture.options });
    assert.deepEqual(folder.read(), { project: 'C:/configured', source: 'host-default' });
    assert.equal((await folder.choose('relative')).status, 'refused');
    assert.deepEqual(folder.read(), { project: 'C:/configured', source: 'host-default' });
    assert.deepEqual(changes, []);
    assert.deepEqual(await folder.choose(fixture.project), { status: 'ok', project: fixture.project, source: 'chosen' });
    assert.deepEqual(changes, [fixture.project]);
  } finally { await fixture.done(); }
});

test('a switch while Install or Remove is running is refused and changes nothing', async () => {
  const fixture = await layout(), changes = [];
  try {
    const folder = createProjectFolder({ initial: 'C:/configured', onChange: project => changes.push(project), options: fixture.options });
    let finish; const running = folder.run(() => new Promise(resolve => { finish = resolve; }));
    const refused = await folder.choose(fixture.project);
    assert.equal(refused.status, 'busy'); assert.equal(refused.code, 'FOLDER_BUSY'); assert.match(refused.reason, /Wait for it to finish/);
    assert.deepEqual(folder.read(), { project: 'C:/configured', source: 'host-default' });
    // A preparation that starts while the path is being checked also keeps the old folder.
    finish('done'); assert.equal(await running, 'done');
    let release; const checking = folder.choose(fixture.project), second = folder.run(() => new Promise(resolve => { release = resolve; }));
    assert.equal((await checking).status, 'busy'); release(); await second;
    finish = () => {};
    finish('done'); assert.equal(await running, 'done');
    assert.equal((await folder.choose(fixture.project)).status, 'ok');
    assert.deepEqual(changes, [fixture.project]);
  } finally { await fixture.done(); }
});

test('before each run the chosen folder is checked again; a folder replaced or removed since is refused', async () => {
  const fixture = await layout();
  try {
    const folder = createProjectFolder({ initial: 'C:/configured', onChange: () => {}, options: fixture.options });
    assert.equal(await folder.verify(), undefined, 'the host default is the override and is not re-checked');
    assert.equal((await folder.choose(fixture.project)).status, 'ok');
    assert.equal(await folder.verify(), undefined);
    // The same path now leads somewhere else.
    const elsewhere = join(fixture.base, 'elsewhere'); await mkdir(elsewhere);
    await rename(fixture.project, join(fixture.base, 'moved'));
    await symlink(elsewhere, fixture.project, 'junction');
    const replaced = await folder.verify();
    assert.equal(replaced.code, 'FOLDER_CHANGED'); assert.match(replaced.reason, /no longer the folder you chose/);
    await rm(fixture.project, { recursive: true, force: true });
    assert.match((await folder.verify()).reason, /does not exist/);
  } finally { await fixture.done(); }
});

test('first-folder preparation runs once at a time, later callers wait for it, and a failure can be retried', async () => {
  let runs = 0, fail = true, release;
  const task = shared(async () => { runs++; await new Promise(resolve => { release = resolve; }); if (fail) throw new Error('disk full'); });
  const first = task(), second = task();
  release(); await assert.rejects(first, /disk full/); await assert.rejects(second, /disk full/);
  assert.equal(runs, 1);
  fail = false; const retry = task(); release(); await retry; await task();
  assert.equal(runs, 2);
});
