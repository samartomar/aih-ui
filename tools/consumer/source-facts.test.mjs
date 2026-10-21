import test from 'node:test';
import assert from 'node:assert/strict';
import { installedFamilies } from './installed-families.mjs';
import { createScanEvidenceHost } from './scan-evidence-host.mjs';
test('personal content without configured evidence reports absence without invalid comparison context', async () => {
  const personal = await intakePersonalFolder({ files: [
    { path: 'LICENSE', bytes: [...new TextEncoder().encode('Personal license terms.')] },
    { path: 'skills/no-evidence/SKILL.md', bytes: [...new TextEncoder().encode('---\nname: no-evidence\ndescription: Personal content without an assessment.\n---\nInstructions.\n')] }
  ] });
  assert.equal(personal.status, 'ok');
  const inventory = personal.value;
  assert.equal(inventory.release.baseline, undefined);
  const result = await createScanEvidenceHost().check({ inventory, itemId: inventory.release.items[0].id, evaluationTime: '2026-10-20T12:00:00.000Z' });
  assert.equal(result.status, 'unconfigured', JSON.stringify(result));
  assert.deepEqual(result.assessments, []);
  assert.equal(result.selectedScanId, null);
});

import { intakePersonalFolder } from './personal-folder.mjs';
import { extractSourceFacts } from '@aihq/catalog/source';
test('personal Agent Skills retains shared multiline purpose, extensions and field provenance', async () => {
  const content = '---\nname: example\ndescription: |\n  First source line.\n  Second source line.\ncompatibility: Requires a terminal\nmetadata:\n  owner: Example\n---\nBody stays separate.\n';
  const files = [{ path: 'LICENSE', bytes: [...new TextEncoder().encode('Personal license terms.')] }, { path: 'skills/example/SKILL.md', bytes: [...new TextEncoder().encode(content)] }];
  const result = await intakePersonalFolder({ files });
  assert.equal(result.status, 'ok', JSON.stringify(result));
  const facts = result.value.release.items[0].metadata.sourceFacts;
  assert.deepEqual(facts, extractSourceFacts({ profile: 'agent-skills', path: files[1].path, revision: facts.provenance.revision, bytes: Uint8Array.from(files[1].bytes) }));
  assert.equal(facts.description.value, 'First source line.\nSecond source line.\n');
  assert.equal(facts.native.compatibility, 'Requires a terminal');
  assert.equal(facts.native.metadata.owner, 'Example');
});

import { startConsumer } from './server.mjs';
test('personal source material is exact text available only to its granted page client', async () => {
  const started = await startConsumer();
  const call = async (client, operation, body = {}) => (await fetch(`${started.origin}/api/authoring-${operation}`, { method: 'POST', headers: { origin: started.origin, 'content-type': 'application/json', 'x-aih-client': client }, body: JSON.stringify(body) })).json();
  const text = '---\nname: example\ndescription: Original purpose.\n---\n<script>neverEvaluate()</script>\n';
  const files = [{ path: 'LICENSE', bytes: [...new TextEncoder().encode('Personal license terms.')] }, { path: 'skills/example/SKILL.md', bytes: [...new TextEncoder().encode(text)] }];
  try {
    const granted = await call('source-owner', 'folder', { files });
    assert.equal(granted.status, 'ok', JSON.stringify(granted));
    const target = `${granted.value.input.releaseSha256}/personal.skill.example`;
    const original = await call('source-owner', 'source-material', { target });
    assert.equal(original.status, 'read', JSON.stringify(original));
    assert.equal(original.text, text);
    assert.equal((await call('other-client', 'source-material', { target })).status, 'unavailable');
    for (const [source, expected] of [['---\nname: example\n---\nBody is not purpose.\n', 'profile-error'], ['---\nname: [invalid\n---\n', 'malformed']]) {
      const failed = await intakePersonalFolder({ files: [files[0], { path: files[1].path, bytes: [...new TextEncoder().encode(source)] }] });
      assert.equal(failed.status, 'refused');
      assert.equal(failed.diagnostics[0].details.sourceFacts.status, expected);
    }
  } finally { await new Promise(resolve => started.server.close(resolve)); }
});
