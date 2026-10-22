import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startConsumer } from './server.mjs';
import { tarball } from './github-archive-fixture.mjs';
import { archiveUrl, downloadArchive } from './github-archive.mjs';

const COMMIT = 'd81f3a183412e71a5b1e84ca21bc1a35eea03a60';
const skill = (name, extra = '') => ({ path: `skills/productivity/${name}/SKILL.md`, text: `---\nname: ${name}\ndescription: The ${name} skill.\n${extra}---\n\nInstructions.\n` });
const repository = [{ path: '', type: '5' }, { path: 'LICENSE', text: 'MIT License\nCopyright 2026 Example' }, { path: 'CHANGELOG.md', type: '2', linkname: 'docs/CHANGELOG.md' },
  { path: 'skills/productivity/README.md', text: 'About these skills.' }, skill('grill-me'), { path: 'skills/productivity/grill-me/agents/openai.yaml', text: 'a: 1' }, skill('teach')];
const exact = { repository: 'mattpocock/skills', commit: COMMIT, path: 'skills/productivity' };

// The host with a local stand-in for GitHub: it records each URL asked for and serves a fixture archive.
async function host(archive = tarball(repository)) {
  const asked = [];
  const started = await startConsumer({ githubDownload: async url => { asked.push(url); return { status: 'ok', diagnostics: [], value: archive }; } });
  const call = async (operation, body = {}, client = 'client-github') => (await fetch(`${started.origin}/api/authoring-${operation}`, {
    method: 'POST', headers: { origin: started.origin, 'content-type': 'application/json', 'x-aih-client': client }, body: JSON.stringify(body) })).json();
  const catalog = async (client = 'client-github') => (await fetch(`${started.origin}/api/authoring-catalog`, { headers: { 'x-aih-client': client } })).json();
  return { asked, call, catalog, close: () => new Promise(resolve => started.server.close(resolve)) };
}

test('an exact repository, commit and folder lists its skills under Your sources with the repository and commit as their source', async () => {
  const { asked, call, catalog, close } = await host();
  try {
    const added = await call('github', exact);
    assert.equal(added.status, 'ok', JSON.stringify(added));
    assert.deepEqual(asked, [`https://codeload.github.com/mattpocock/skills/tar.gz/${COMMIT}`]);
    assert.equal(added.value.name, 'mattpocock/skills@d81f3a1');
    assert.deepEqual(added.value.source, exact);
    assert.equal(added.value.installable, false);
    assert.match(added.value.installReason, /can't be installed yet.*samartomar\/aih-catalog#124/);
    const items = (await catalog()).items.filter(item => item.root.releaseSha256 === added.value.releaseSha256);
    assert.deepEqual(items.map(item => item.id).sort(), ['github.skill.grill-me', 'github.skill.teach']);
    for (const item of items) {
      assert.equal(item.family, 'Personal');
      assert.deepEqual(item.sources[0].origin, { kind: 'git', repository: 'https://github.com/mattpocock/skills', revision: COMMIT });
    }
    const grill = items.find(item => item.id === 'github.skill.grill-me');
    assert.equal(grill.metadata.sourceFacts.provenance.path, 'skills/productivity/grill-me/SKILL.md');
    assert.equal(grill.metadata.sourceFacts.provenance.revision, COMMIT);
    // The folder's other files are support material; the README beside the skills and the root symlink are not.
    assert.equal(grill.materials.length, 3);
    assert.ok(grill.materials.every(material => material.path.startsWith(`release/materials/github.com/mattpocock/skills/${COMMIT}/`)));
    assert.equal((await catalog('another-client')).items.some(item => item.root.releaseSha256 === added.value.releaseSha256), false, 'one page client only');
  } finally { await close(); }
});

test('a branch, tag or short commit is refused with a plain reason and nothing is fetched', async () => {
  const { asked, call, close } = await host();
  try {
    for (const commit of ['main', 'v1.2.0', 'd81f3a1']) {
      const refused = await call('github', { ...exact, commit });
      assert.equal(refused.status, 'refused');
      assert.equal(refused.diagnostics[0].code, 'GITHUB_EXACT_COMMIT_REQUIRED');
      assert.match(refused.diagnostics[0].message, /needs an exact commit/);
    }
    assert.equal((await call('github', { ...exact, repository: 'https://github.com/mattpocock/skills' })).diagnostics[0].code, 'GITHUB_REPOSITORY_INVALID');
    assert.deepEqual(asked, [], 'nothing was fetched');
  } finally { await close(); }
});

test('content from a GitHub source can be chosen, but Install refuses it and names the missing Catalog capability', async () => {
  const project = await mkdtemp(join(tmpdir(), 'aih-github-project-'));
  const asked = [];
  const started = await startConsumer({ projectRoot: project, githubDownload: async url => { asked.push(url); return { status: 'ok', diagnostics: [], value: tarball(repository) }; } });
  const call = async (operation, body = {}) => (await fetch(`${started.origin}/api/authoring-${operation}`, {
    method: 'POST', headers: { origin: started.origin, 'content-type': 'application/json', 'x-aih-client': 'client-install' }, body: JSON.stringify(body) })).json();
  try {
    const added = await call('github', exact);
    const item = (await (await fetch(`${started.origin}/api/authoring-catalog`, { headers: { 'x-aih-client': 'client-install' } })).json()).items.find(value => value.root.releaseSha256 === added.value.releaseSha256);
    const fresh = await call('new');
    const selected = await call('edit', { policyBytes: fresh.value.policyBytes, operation: { type: 'select', root: item.root } });
    assert.equal(selected.status, 'ok', JSON.stringify(selected));
    const prepared = await call('prepare', { policyBytes: selected.value.policyBytes });
    assert.equal(prepared.status, 'refused', JSON.stringify(prepared));
    assert.equal(prepared.diagnostics[0].code, 'GITHUB_NOT_INSTALLABLE');
    assert.match(prepared.diagnostics[0].message, /can't be installed yet.*samartomar\/aih-catalog#124/);
    assert.deepEqual(await readdir(project), [], 'nothing was written to the project');
  } finally { await new Promise(resolve => started.server.close(resolve)); }
});

test('Catalog refusals and archive bounds come back plainly and add nothing', async () => {
  const cases = [
    [tarball([{ path: 'LICENSE', text: 'MIT' }, { path: 'skills/productivity/notes.md', text: 'no skill here' }]), 'GITHUB_SOURCE_INVALID', /Recognized layout/],
    [tarball([{ path: 'skills/productivity/teach/SKILL.md', text: skill('teach').text }]), 'GITHUB_SOURCE_INVALID', /LICENSE/],
    [tarball([{ path: 'LICENSE', text: 'MIT' }, { path: 'skills/productivity/teach/SKILL.md', text: 'no front matter' }]), 'GITHUB_SOURCE_INVALID', /front matter/],
    [tarball([{ path: 'LICENSE', text: 'MIT' }, { path: 'skills/productivity/wrong/SKILL.md', text: skill('teach').text }]), 'GITHUB_SOURCE_INVALID', /match its directory/],
    [tarball([...repository, { path: 'skills/productivity/teach/link', type: '2', linkname: '../../../LICENSE' }]), 'GITHUB_ARCHIVE_UNSAFE', /symbolic link/],
    [tarball(repository, { commit: 'f'.repeat(40) }), 'GITHUB_ARCHIVE_COMMIT_MISMATCH', /exact commit/],
  ];
  for (const [archive, code, message] of cases) {
    const { call, catalog, close } = await host(archive);
    try {
      const refused = await call('github', exact);
      assert.equal(refused.status, 'refused', code);
      assert.equal(refused.diagnostics[0].code, code);
      assert.match(refused.diagnostics[0].message, message);
      assert.equal((await catalog()).items.some(item => item.id.startsWith('github.')), false);
    } finally { await close(); }
  }
});

test('a forgotten GitHub source is no longer listed', async () => {
  const { call, catalog, close } = await host();
  try {
    const added = await call('github', exact);
    assert.equal((await call('github-forget', { releaseSha256: added.value.releaseSha256 })).status, 'ok');
    assert.equal((await catalog()).items.some(item => item.root.releaseSha256 === added.value.releaseSha256), false);
    assert.equal((await call('github-forget', { releaseSha256: added.value.releaseSha256 })).diagnostics[0].code, 'GITHUB_SOURCE_UNKNOWN');
  } finally { await close(); }
});

test('one GitHub download at a time: a second add while one is downloading is refused, not queued', async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const asked = [];
  const started = await startConsumer({ githubDownload: async url => { asked.push(url); await held; return { status: 'ok', diagnostics: [], value: tarball(repository) }; } });
  const call = async (client) => (await fetch(`${started.origin}/api/authoring-github`, {
    method: 'POST', headers: { origin: started.origin, 'content-type': 'application/json', 'x-aih-client': client }, body: JSON.stringify(exact) })).json();
  try {
    const first = call('client-a');
    while (!asked.length) await new Promise(resolve => setTimeout(resolve, 10));
    const second = await call('client-b');
    assert.equal(second.diagnostics[0].code, 'GITHUB_BUSY');
    release();
    assert.equal((await first).status, 'ok');
    assert.equal(asked.length, 1);
  } finally { await new Promise(resolve => started.server.close(resolve)); }
});

// Opt-in only (AIH_GITHUB_LIVE=1): the real download from GitHub. CI never sets it, so CI needs no network.
test('live: the exact commit downloads from codeload.github.com within the bounds', { skip: process.env.AIH_GITHUB_LIVE !== '1' }, async () => {
  const fetched = await downloadArchive(archiveUrl({ owner: 'mattpocock', repo: 'skills', commit: COMMIT }));
  assert.equal(fetched.status, 'ok', JSON.stringify(fetched));
  const started = await startConsumer();
  try {
    const added = await (await fetch(`${started.origin}/api/authoring-github`, { method: 'POST', headers: { origin: started.origin, 'content-type': 'application/json', 'x-aih-client': 'client-live' }, body: JSON.stringify(exact) })).json();
    assert.equal(added.status, 'ok', JSON.stringify(added));
    assert.ok(added.value.itemIds.includes('github.skill.grill-me'));
  } finally { await new Promise(resolve => started.server.close(resolve)); }
});
