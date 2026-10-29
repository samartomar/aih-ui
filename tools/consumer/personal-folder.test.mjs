import test from 'node:test';
import assert from 'node:assert/strict';
import { startConsumer } from './server.mjs';
import { installedFamilies } from './installed-families.mjs';
import { freshAuthoring, composeAuthoring, editAuthoring } from './headless.mjs';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const bytes = text => [...new TextEncoder().encode(text)];
export const folderFiles = (text = 'Personal instructions.') => [
  { path: 'LICENSE', bytes: bytes('MIT License\nCopyright 2026 Example\nPermission is hereby granted.') },
  { path: 'skills/example/SKILL.md', bytes: bytes(`---\nname: example\ndescription: A personal example.\nlicense: MIT\n---\n\n${text}\n`) },
  { path: 'skills/example/support/checklist.txt', bytes: bytes('Keep exact choices.') }
];
test('personal folder grant is client-local and exact saved choices require fresh explicit rebinding', async () => {
  const started = await startConsumer();
  const call = async (client, operation, body = {}) => (await fetch(`${started.origin}/api/authoring-${operation}`, {
    method: 'POST', headers: { origin: started.origin, 'content-type': 'application/json', 'x-aih-client': client }, body: JSON.stringify(body)
  })).json();
  const catalog = async client => (await fetch(`${started.origin}/api/authoring-catalog`, { headers: { 'x-aih-client': client } })).json();
  try {
    const granted = await call('client-one', 'folder', { files: folderFiles() });
    assert.equal(granted.status, 'ok', JSON.stringify(granted));
    const personal = (await catalog('client-one')).items.find(item => item.family === 'Personal');
    assert.deepEqual(personal.sources[0].origin.kind, 'local');
    assert.match(personal.sources[0].origin.revision, /^[a-f0-9]{64}$/);
    assert.equal((await catalog('client-two')).items.some(item => item.family === 'Personal'), false);
    const fresh = await call('client-one', 'new');
    const selected = await call('client-one', 'edit', { policyBytes: fresh.value.policyBytes, operation: { type: 'select', root: personal.root } });
    assert.equal(selected.status, 'ok', JSON.stringify(selected));
    const policyBytes = selected.value.policyBytes;
    assert.doesNotMatch(new TextDecoder().decode(Uint8Array.from(policyBytes)), /grantId|client-one|hostPath/);
    const missing = await call('client-two', 'read', { policyBytes });
    // A client without the grant sees the exact choice as unresolved, not as an unreadable document.
    assert.equal(missing.value.editing, 'unresolved');
    assert.deepEqual(missing.value.intent, selected.value.intent);
    assert.equal(missing.value.roots.find(root => root.itemId === personal.root.itemId).status, 'unresolved');
    const changed = await call('client-two', 'folder', { files: folderFiles('Changed instructions.'), rebind: granted.value.input });
    assert.equal(changed.status, 'refused');
    assert.equal(changed.diagnostics[0].code, 'LOCAL_ROOT_CHANGED');
    assert.equal((await catalog('client-two')).items.some(item => item.family === 'Personal'), false);
    const rebound = await call('client-two', 'folder', { files: folderFiles(), rebind: granted.value.input });
    assert.equal(rebound.status, 'ok', JSON.stringify(rebound));
    const reopened = await call('client-two', 'read', { policyBytes });
    assert.equal(reopened.status, 'ok', JSON.stringify(reopened));
    assert.deepEqual(reopened.value.intent, selected.value.intent);
  } finally { await new Promise(resolve => started.server.close(resolve)); }
});
test('invalid and unrecognized folder content gives actionable feedback without acquiring an inventory', async () => {
  const started = await startConsumer();
  try {
    const cases = [
      { files: [{ path: '../SKILL.md', bytes: bytes('unsafe') }], message: /canonical relative/ },
      { files: [{ path: 'notes.txt', bytes: bytes('unrecognized') }], message: /LICENSE/ },
      { files: [folderFiles()[0], { path: 'README.md', bytes: bytes('not a skill') }], message: /Recognized layout/ },
      { files: [folderFiles()[0], { path: 'skills/example/SKILL.md', bytes: bytes('no front matter') }], message: /front matter/ },
      { files: [...folderFiles(), { path: 'LICENSE', bytes: bytes('duplicate') }], message: /unique/ },
      { files: [...folderFiles(), { path: 'skills/example/support', bytes: bytes('file-directory conflict') }], message: /parent directory/ },
      { files: [{ path: 'LICENSE', bytes: [-1] }], message: /byte arrays/ }
    ];
    for (const { files, message } of cases) {
      const result = await (await fetch(`${started.origin}/api/authoring-folder`, { method: 'POST', headers: { origin: started.origin, 'content-type': 'application/json', 'x-aih-client': 'invalid-client' }, body: JSON.stringify({ files }) })).json();
      assert.equal(result.status, 'refused'); assert.match(result.diagnostics[0].message, message);
    }
    const catalog = await (await fetch(`${started.origin}/api/authoring-catalog`, { headers: { 'x-aih-client': 'invalid-client' } })).json();
    assert.equal(catalog.items.some(item => item.family === 'Personal'), false);
  } finally { await new Promise(resolve => started.server.close(resolve)); }
});
test('choosing a single skill directory explains which parent layout is supported', async () => {
  const started = await startConsumer();
  try {
    const files = folderFiles().map(file => ({ ...file, path: file.path.replace('skills/example/', '') }));
    const grant = await (await fetch(`${started.origin}/api/authoring-folder`, { method: 'POST', headers: { origin: started.origin, 'content-type': 'application/json', 'x-aih-client': 'root-skill-client' }, body: JSON.stringify({ files }) })).json();
    assert.equal(grant.status, 'refused', JSON.stringify(grant));
    assert.match(grant.diagnostics[0].message, /Choose the parent folder containing skills/);
    const catalog = await (await fetch(`${started.origin}/api/authoring-catalog`, { headers: { 'x-aih-client': 'root-skill-client' } })).json();
    assert.equal(catalog.items.some(item => item.family === 'Personal'), false);
  } finally { await new Promise(resolve => started.server.close(resolve)); }
});
test('only the granted client can prepare personal material and acquisition never runs bundled scripts', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'aih-personal-target-'));
  const marker = join(projectRoot, 'script-executed');
  const files = [...folderFiles(), { path: 'skills/example/marker.mjs', bytes: bytes(`import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed');`) }];
  const started = await startConsumer({ projectRoot });
  const call = async (client, operation, body = {}) => (await fetch(`${started.origin}/api/authoring-${operation}`, { method: 'POST', headers: { origin: started.origin, 'content-type': 'application/json', 'x-aih-client': client }, body: JSON.stringify(body) })).json();
  try {
    const grant = await call('granted-client', 'folder', { files }); assert.equal(grant.status, 'ok', JSON.stringify(grant));
    const catalog = await (await fetch(`${started.origin}/api/authoring-catalog`, { headers: { 'x-aih-client': 'granted-client' } })).json();
    const root = catalog.items.find(item => item.family === 'Personal').root;
    const fresh = await call('granted-client', 'new');
    const selected = await call('granted-client', 'edit', { policyBytes: fresh.value.policyBytes, operation: { type: 'select', root } });
    const body = { policyBytes: selected.value.policyBytes };
    const absent = await call('ungranted-client', 'prepare', body); assert.notEqual(absent.status, 'ready');
    const prepared = await call('granted-client', 'prepare', body); assert.equal(prepared.status, 'ready', JSON.stringify(prepared));
    const stolen = await call('ungranted-client', 'apply', { sessionId: prepared.sessionId, reviewDigest: prepared.review.reviewDigest }); assert.equal(stolen.status, 'lost');
    await assert.rejects(access(marker));
    // Bindings are independent of approval; adding content discards old handles.
    await call('granted-client', 'folder', { files: folderFiles(), rebind: undefined });
    const stale = await call('granted-client', 'apply', { sessionId: prepared.sessionId, reviewDigest: prepared.review.reviewDigest }); assert.equal(stale.status, 'lost');
    await assert.rejects(access(marker));
    assert.equal(await readFile(join(projectRoot, 'script-executed')).catch(() => null), null);
  } finally { await new Promise(resolve => started.server.close(resolve)); }
});

// Core's apply records custody under the account home, so Prepare/Apply run in a child
// whose home is disposable; the parent process never applies with the developer's home.
const approvalChild = `import os from 'node:os'; import { readFileSync } from 'node:fs';
const [hostUrl, familiesUrl, inputPath] = process.argv.slice(1), input = JSON.parse(readFileSync(inputPath, 'utf8'));
if (os.homedir() !== input.home) throw new Error('Child home must be the disposable fixture home.');
const { createHost } = await import(hostUrl), { installedFamilies } = await import(familiesUrl);
const host = createHost({ projectRoot: input.projectRoot, materialRoots: { maintained: input.maintainedRoot, catalog: input.maintainedRoot }, recipeMaterials: (await installedFamilies()).flatMap(entry => entry.materials), controls: { logging: 'off' } });
const prepared = await host.prepareSession({ policyText: input.policyText });
const applied = prepared.sessionId ? await host.applyApproved({ sessionId: prepared.sessionId, reviewDigest: prepared.review.reviewDigest }) : undefined;
process.stdout.write(JSON.stringify({ home: os.homedir(), prepared, applied }));`;
test('one approval applies a selected item and its displayed required dependency set', async () => {
  const inventories = await installedFamilies(), entry = inventories.find(entry => entry.family === 'Extensions');
  const item = entry.release.items.find(item => item.id === 'extensions.matt.ask-matt');
  assert.ok(item);
  const fresh = await composeAuthoring({ intent: freshAuthoring(), inventories, tool: 'claude-code' });
  assert.equal(fresh.status, 'ok', JSON.stringify(fresh));
  const selected = await editAuthoring({ policyBytes: fresh.value.policyBytes, inventories, tool: 'claude-code',
    operation: { type: 'select', tool: 'claude-code', root: { releaseSha256: entry.release.sha256, itemId: item.id, scope: 'project', configuration: {} } } });
  assert.equal(selected.status, 'ok', JSON.stringify(selected));
  const { intent, inclusions, policy } = selected.value;
  assert.equal(intent.roots.length, 1); assert.equal(intent.roots[0].itemId, item.id);
  const dependencies = inclusions.filter(inclusion => inclusion.item.itemId !== item.id);
  assert.ok(dependencies.length > 0);
  assert.ok(dependencies.every(inclusion => inclusion.root.itemId === item.id));
  assert.deepEqual(intent.pins.map(pin => pin.itemId).sort(), [item.id, ...dependencies.map(inclusion => inclusion.item.itemId)].sort());
  assert.equal(policy.selections.length, intent.pins.length);
  // A rendered policy (1.5) carries each selection's recipe inline, so a selection is found by the exact item it records.
  const selectionOf = (releaseSha256, itemId) => {
    const release = inventories.find(entry => entry.release.sha256 === releaseSha256).release, published = release.items.find(candidate => candidate.id === itemId);
    const found = policy.selections.filter(selection => selection.item?.framework === release.framework.id && selection.item.itemId === itemId
      && selection.item.contentSha256 === published.contentSha256 && selection.item.behaviourSha256 === published.behaviourSha256);
    assert.equal(found.length, 1, `one selection records ${itemId}`);
    return found[0];
  };
  const rootSelection = selectionOf(entry.release.sha256, item.id);
  const dependencySelections = dependencies.map(({ item: ref }) => selectionOf(ref.releaseSha256, ref.itemId));
  assert.deepEqual(rootSelection.requires.slice().sort(), dependencySelections.map(selection => selection.id).sort());
  const scratch = await mkdtemp(join(tmpdir(), 'aih-single-approval-')), home = join(scratch, 'home'), projectRoot = join(scratch, 'project');
  for (const directory of [projectRoot, join(home, 'AppData', 'Local'), join(home, 'AppData', 'Roaming'), join(home, '.config'), join(home, '.local', 'state'), join(home, '.local', 'share'), join(home, '.cache')]) await mkdir(directory, { recursive: true });
  const inputPath = join(scratch, 'input.json');
  await writeFile(inputPath, JSON.stringify({ home, projectRoot, maintainedRoot: dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json'))), policyText: new TextDecoder().decode(selected.value.policyBytes) }));
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', approvalChild, new URL('./host.mjs', import.meta.url).href, new URL('./installed-families.mjs', import.meta.url).href, inputPath], {
    encoding: 'utf8', windowsHide: true, timeout: 120_000, maxBuffer: 20_000_000,
    env: { ...process.env, HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local'),
      XDG_CONFIG_HOME: join(home, '.config'), XDG_STATE_HOME: join(home, '.local', 'state'), XDG_DATA_HOME: join(home, '.local', 'share'), XDG_CACHE_HOME: join(home, '.cache') } });
  assert.equal(child.status, 0, child.stderr);
  const { home: childHome, prepared, applied } = JSON.parse(child.stdout);
  assert.equal(childHome, home);
  assert.equal(prepared.status, 'ready', JSON.stringify(prepared));
  assert.equal(typeof prepared.sessionId, 'string'); assert.equal(typeof prepared.review.reviewDigest, 'string');
  for (const selection of [rootSelection, ...dependencySelections]) {
    assert.ok(prepared.review.operations.some(operation => operation.id.startsWith(`${selection.id}/`)), `Review must cover ${selection.id}`);
  }
  assert.equal(applied.completion, 'complete', JSON.stringify(applied));
  assert.deepEqual(applied.operations.map(operation => operation.id).sort(), prepared.review.operations.map(operation => operation.id).sort());
  for (const operation of prepared.review.operations.filter(operation => operation.kind === 'file.write')) await access(operation.details.target);
});
