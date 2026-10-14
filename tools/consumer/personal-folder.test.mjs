import test from 'node:test';
import assert from 'node:assert/strict';
import { startConsumer } from './server.mjs';
import { mkdtemp, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    assert.equal(missing.value.editing, 'unavailable');
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
