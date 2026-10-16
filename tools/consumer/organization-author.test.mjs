import test from 'node:test';
import assert from 'node:assert/strict';
import { readJourneyEnvelope, writeJourneyEnvelope, projectJourneyEnvelope, JOURNEY_RECORD_KINDS } from './journey.mjs';
import { ORGANIZATION_DRAFT_RECORD_SCHEMA, organizationDraftProblem, organizationEntryId, organizationTargetId } from './organization-draft-record.mjs';
import { digestBytes } from './intake.mjs';
import { stable, managementIdOf } from './headless.mjs';
import { startConsumer } from './server.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createGitHubFixture, enterpriseFixture } from './github-fixture.mjs';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOrganizationPolicy, previewOrganizationObligations } from '@aihq/core/contracts';
const encode = value => new TextEncoder().encode(value);
const hex = char => char.repeat(64);
const savedIntentBytes = encode(JSON.stringify({ schema: 'urn:aihq:core:execution-policy:1.3.0', mode: 'enterprise', selections: [], metadata: {} }) + '\n');
const ITEM = { releaseSha256: hex('a'), itemId: 'mattpocock.implement', itemSha256: hex('b') };

async function sampleRecord(overrides = {}) {
  const entry = { id: await organizationEntryId({ ...ITEM, scope: 'project' }), item: { ...ITEM }, scope: 'project', inputs: {} };
  const target = { scope: 'project' };
  return { id: 'organization-draft', schema: ORGANIZATION_DRAFT_RECORD_SCHEMA, required: true, entries: [entry], targets: [{ id: await organizationTargetId(target), ...target }], ...overrides };
}
// Re-seals an envelope after a test edits it, so the reader reaches the check under test rather than the digest check.
async function reseal(envelope, mutate) {
  const doc = structuredClone(envelope);
  mutate(doc);
  const { sha256: _omitted, ...revision } = doc.revision;
  doc.revision.sha256 = await digestBytes(encode(stable({ ...doc, revision })));
  return encode(JSON.stringify(doc, null, 2) + '\n');
}

test('the organization draft record is a registered, required journey kind with a closed shape', async () => {
  assert.deepEqual(JOURNEY_RECORD_KINDS[ORGANIZATION_DRAFT_RECORD_SCHEMA], { kind: 'organization-draft', version: '1.0.0', required: true });
  assert.equal(ORGANIZATION_DRAFT_RECORD_SCHEMA, 'urn:aihq:workbench:journey-record:organization-draft:1.0.0');
  assert.equal(organizationDraftProblem(await sampleRecord()), null);
  // Everything a person has not decided yet stays absent: the record is valid while unresolved.
  const full = await sampleRecord({ policyId: 'acme-baseline', source: { provider: 'github', repository: { owner: 'acme', name: 'policies' }, path: 'org/policy.json', revision: { kind: 'branch', value: 'main' } } });
  full.entries[0] = { ...full.entries[0], obligation: 'required', clients: ['claude'], repositories: ['github.com/acme/app'], inputs: { agentDirectory: { fixed: '.claude' }, other: { choices: ['a', 'b'] }, free: { allowDeclared: true } } };
  assert.equal(organizationDraftProblem(full), null);
  const bad = async (mutate, pointer) => {
    const record = await sampleRecord();
    mutate(record);
    assert.equal(organizationDraftProblem(record), pointer);
  };
  await bad(record => { record.extra = 1; }, '');
  await bad(record => { record.id = 'draft'; }, '/id');
  await bad(record => { record.required = false; }, '/required');
  await bad(record => { record.schema = 'urn:aihq:workbench:journey-record:organization-draft:2.0.0'; }, '/schema');
  await bad(record => { record.policyId = 'has space'; }, '/policyId');
  await bad(record => { record.source = { provider: 'gitlab', repository: { owner: 'a', name: 'b' }, path: 'p.json', revision: { kind: 'branch', value: 'main' } }; }, '/source');
  await bad(record => { record.entries[0].id = 'entry-xyz'; }, '/entries/0/id');
  await bad(record => { record.entries[0].extra = true; }, '/entries/0');
  await bad(record => { record.entries[0].scope = 'machine'; }, '/entries/0/scope');
  await bad(record => { record.entries[0].obligation = 'mandatory'; }, '/entries/0/obligation');
  await bad(record => { record.entries[0].clients = []; }, '/entries/0/clients');
  await bad(record => { record.entries[0].clients = ['claude', 'claude']; }, '/entries/0/clients');
  await bad(record => { record.entries[0].repositories = ['']; }, '/entries/0/repositories');
  await bad(record => { record.entries[0].inputs = { x: { fixed: 1, choices: [1] } }; }, '/entries/0/inputs/x');
  await bad(record => { record.entries[0].inputs = { x: { choices: [] } }; }, '/entries/0/inputs/x');
  await bad(record => { record.entries[0].inputs = { x: { choices: [1, 1] } }; }, '/entries/0/inputs/x');
  await bad(record => { record.entries[0].inputs = { x: { allowDeclared: false } }; }, '/entries/0/inputs/x');
  await bad(record => { record.entries.push(structuredClone(record.entries[0])); }, '/entries/1/id');
  await bad(record => { record.targets[0].client = ''; }, '/targets/0/client');
  await bad(record => { record.targets[0].id = 'target-abc'; }, '/targets/0/id');
  await bad(record => { record.targets = Array.from({ length: 65 }, (_, i) => ({ id: `target-${String(i).padStart(32, '0')}`, scope: 'project', client: `c${i}` })); }, '/targets');
});

test('a source that is not shell-safe is never accepted into a record', async () => {
  const source = (overrides = {}) => ({ provider: 'github', repository: { owner: 'acme', name: 'policies' }, path: 'org/policy.json', revision: { kind: 'branch', value: 'main' }, ...overrides });
  const problem = async value => organizationDraftProblem(await sampleRecord({ source: value }));
  assert.equal(await problem(source()), null);
  assert.equal(await problem(source({ revision: { kind: 'commit', value: 'a'.repeat(40) } })), null);
  assert.equal(await problem(source({ revision: { kind: 'tag', value: 'release/v1.2.0' } })), null);
  for (const unsafe of [
    source({ repository: { owner: 'acme;rm', name: 'policies' } }), source({ repository: { owner: '-acme', name: 'policies' } }),
    source({ repository: { owner: 'acme', name: '..' } }), source({ repository: { owner: 'acme', name: 'a b' } }),
    source({ repository: { owner: 'acme', name: '-x' } }), source({ path: '-n.json' }), source({ path: '-rf/a.json' }), source({ path: 'org/-x.json' }),
    source({ path: '../policy.json' }), source({ path: '/policy.json' }), source({ path: 'org/$(id).json' }), source({ path: 'org/policy.txt' }), source({ path: 'a//b.json' }),
    source({ revision: { kind: 'branch', value: 'main; rm -rf /' } }), source({ revision: { kind: 'branch', value: '-main' } }), source({ revision: { kind: 'branch', value: 'a..b' } }),
    source({ revision: { kind: 'tag', value: '/v1' } }), source({ revision: { kind: 'tag', value: 'v1/' } }), source({ revision: { kind: 'commit', value: 'main' } }),
    source({ revision: { kind: 'commit', value: 'A'.repeat(40) } }), source({ revision: { kind: 'ref', value: 'main' } }), source({ extra: 1 })
  ]) assert.equal(await problem(unsafe), '/source', JSON.stringify(unsafe));
});

test('the journey writer and reader keep an unresolved organization draft and refuse malformed ones', async () => {
  const record = await sampleRecord();
  const written = await writeJourneyEnvelope({ savedIntentBytes, records: [record] });
  assert.equal(written.status, 'ok', JSON.stringify(written.diagnostics));
  // The record does not bind the saved-intent digest and is stored exactly as written.
  assert.deepEqual(written.value.envelope.records, [record]);
  const read = await readJourneyEnvelope(written.value.envelopeBytes);
  assert.equal(read.status, 'ok', JSON.stringify(read.diagnostics));
  assert.equal(read.value.supported, true);
  assert.deepEqual(read.diagnostics, []);
  assert.deepEqual(projectJourneyEnvelope(read.value.envelope).records, [{ id: 'organization-draft', schema: ORGANIZATION_DRAFT_RECORD_SCHEMA, required: true, supported: true }]);

  for (const mutate of [r => { r.extra = 1; }, r => { r.required = false; }, r => { r.entries[0].id = 'entry-nothex'; }, r => { r.entries[0].id = `entry-${'0'.repeat(32)}`; }, r => { r.targets[0].id = `target-${'0'.repeat(32)}`; }]) {
    const malformed = await sampleRecord();
    mutate(malformed);
    const refused = await writeJourneyEnvelope({ savedIntentBytes, records: [malformed] });
    assert.equal(refused.status, 'refused', JSON.stringify(malformed));
    assert.equal(refused.diagnostics[0].code, 'INPUT_INVALID');
    assert.match(refused.diagnostics[0].path, /^\/records\/0/);
  }
  // The reader refuses the same record when it arrives in bytes, with a valid digest so the record itself is what is checked.
  for (const [mutate, pointer] of [[doc => { doc.records[0].extra = 1; }, '/records/0'], [doc => { doc.records[0].required = false; }, '/records/0'],
    [doc => { doc.records[0].entries[0].id = 'entry-nothex'; }, '/records/0']]) {
    const refused = await readJourneyEnvelope(await reseal(written.value.envelope, mutate));
    assert.equal(refused.status, 'refused');
    assert.equal(refused.diagnostics[0].code, 'INPUT_INVALID');
    assert.equal(refused.diagnostics[0].path, pointer);
  }
  const derived = await readJourneyEnvelope(await reseal(written.value.envelope, doc => { doc.records[0].entries[0].id = `entry-${'1'.repeat(32)}`; }));
  assert.equal(derived.status, 'refused');
  assert.equal(derived.diagnostics[0].path, '/records/0/entries/0/id');
  const target = await readJourneyEnvelope(await reseal(written.value.envelope, doc => { doc.records[0].targets[0].id = `target-${'1'.repeat(32)}`; }));
  assert.equal(target.diagnostics[0].path, '/records/0/targets/0/id');
});

// ---- Through the consumer server ----------------------------------------------------------------
async function post(started, operation, body = {}) {
  const response = await fetch(`${started.origin}/api/authoring-${operation}`, { method: 'POST', headers: { origin: started.origin, 'content-type': 'application/json', 'x-aih-client': 'organization-author-test' }, body: JSON.stringify(body) });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
async function withConsumer(options, run) {
  const started = await startConsumer(options);
  try { return await run(started); } finally { await new Promise(resolve => started.server.close(resolve)); }
}
async function catalogRefs(started) {
  const catalog = await (await fetch(`${started.origin}/api/authoring-catalog`, { headers: { 'x-aih-client': 'organization-author-test' } })).json();
  const ref = id => { const item = catalog.items.find(entry => entry.id === id); assert.ok(item, id); return { releaseSha256: item.root.releaseSha256, itemId: id }; };
  return { ref, catalog };
}
// A running draft: every edit goes through the HTTP operation and must succeed unless `refused` is asked for.
async function startDraft(started) {
  const created = await post(started, 'organization-new', {});
  assert.equal(created.status, 'ok', JSON.stringify(created));
  const state = { envelopeBytes: created.value.envelopeBytes, draft: created.value.draft };
  return { state, started,
    async edit(operation) {
      const result = await post(started, 'organization-edit', { envelopeBytes: state.envelopeBytes, operation });
      assert.equal(result.status, 'ok', JSON.stringify(result));
      state.envelopeBytes = result.value.envelopeBytes; state.draft = result.value.draft;
      return state.draft;
    },
    async refused(operation) {
      const result = await post(started, 'organization-edit', { envelopeBytes: state.envelopeBytes, operation });
      assert.equal(result.status, 'refused', JSON.stringify(result));
      assert.deepEqual(result.originalBytes, state.envelopeBytes);
      return result;
    },
    entry(draft, id, scope = 'project') { const found = (draft ?? state.draft).entries.find(entry => entry.item.itemId === id && entry.scope === scope); assert.ok(found, id); return found; },
    preview: () => post(started, 'organization-preview', { envelopeBytes: state.envelopeBytes }),
    export: () => post(started, 'organization-export', { envelopeBytes: state.envelopeBytes }) };
}
const SOURCE = { provider: 'github', repository: { owner: 'acme', name: 'policies' }, path: 'org/baseline.json', revision: { kind: 'branch', value: 'main' } };
const AGENT_DIR = { fixed: '.claude' };

test('an unresolved organization draft saves, reopens identically and edits through closed operations', async () => {
  await withConsumer({}, async started => {
    const { ref } = await catalogRefs(started);
    const d = await startDraft(started);
    assert.equal(d.state.draft.policyId, null); assert.equal(d.state.draft.source, null);
    assert.deepEqual(d.state.draft.entries, []); assert.deepEqual(d.state.draft.targets, []);
    assert.deepEqual(d.state.draft.unresolved.map(item => item.path), ['/policyId', '/source']);
    assert.equal(d.state.draft.projection.revision.sequence, 1);
    assert.deepEqual(d.state.draft.projection.records, [{ id: 'organization-draft', schema: ORGANIZATION_DRAFT_RECORD_SCHEMA, required: true, supported: true }]);

    const implement = ref('mattpocock.implement');
    const draft = await d.edit({ kind: 'add-entry', ...implement, scope: 'project' });
    assert.equal(draft.projection.revision.sequence, 2);
    const entry = d.entry(draft, 'mattpocock.implement');
    assert.deepEqual({ available: entry.available, obligation: entry.obligation, enforcement: entry.enforcement, clients: entry.clients, repositories: entry.repositories },
      { available: true, obligation: null, enforcement: null, clients: null, repositories: null });
    assert.equal(entry.label, 'Implement'); assert.equal(entry.kind, 'skill');
    assert.deepEqual(entry.dependencies, ['mattpocock.code-review']); assert.deepEqual(entry.supportedScopes, ['project']);
    assert.deepEqual(entry.inputs, [{ name: 'agentDirectory', description: entry.inputs[0].description, required: true, default: '.claude', permission: null }]);
    // What has not been decided is listed, with the entry it belongs to, and nothing is guessed.
    assert.deepEqual(draft.unresolved.filter(item => item.entryId === entry.id).map(item => item.path), ['/entries/0/obligation', '/entries/0/inputs/agentDirectory']);

    await d.edit({ kind: 'set-selectors', entryId: entry.id, clients: ['claude'], repositories: ['github.com/acme/app'] });
    await d.edit({ kind: 'add-target', scope: 'project', client: 'claude' });
    await d.edit({ kind: 'add-target', scope: 'project' });
    const saved = structuredClone(d.state);
    // Reopening needs only the saved bytes: the same envelope, the same draft, the same unresolved list.
    const reopened = await post(started, 'organization-open', { bytes: saved.envelopeBytes });
    assert.equal(reopened.status, 'ok', JSON.stringify(reopened));
    assert.deepEqual(reopened.value.envelopeBytes, saved.envelopeBytes);
    assert.deepEqual(reopened.value.draft, saved.draft);
    assert.deepEqual(reopened.value.draft.unresolved, saved.draft.unresolved);
    const read = await readJourneyEnvelope(Uint8Array.from(saved.envelopeBytes));
    assert.equal(read.status, 'ok'); assert.equal(read.value.supported, true);

    // Closed operations: anything else is refused and leaves the bytes exactly as they were.
    for (const bad of [{ kind: 'nope' }, { kind: 'set-policy-id', policyId: 'has space' }, { kind: 'set-policy-id', policyId: '-leading-hyphen' }, { kind: 'set-policy-id', policyId: 'a'.repeat(129) }, { kind: 'set-policy-id', policyId: 'a', extra: 1 },
      { kind: 'set-source', source: { ...SOURCE, path: '../x.json' } }, { kind: 'add-entry', ...implement, scope: 'machine' }, { kind: 'add-entry', ...implement, scope: 'project' },
      { kind: 'add-entry', releaseSha256: implement.releaseSha256, itemId: 'no.such.item', scope: 'project' }, { kind: 'remove-entry', entryId: 'entry-nothing' },
      { kind: 'set-obligation', entryId: entry.id, obligation: 'mandatory' }, { kind: 'set-selectors', entryId: entry.id, clients: [] },
      { kind: 'set-input', entryId: entry.id, name: 'nope', permission: AGENT_DIR }, { kind: 'set-input', entryId: entry.id, name: 'agentDirectory', permission: { fixed: 1, allowDeclared: true } },
      { kind: 'set-input', entryId: entry.id, name: 'agentDirectory', permission: { choices: [] } }, { kind: 'add-target', scope: 'project', client: 'claude' },
      { kind: 'add-target', scope: 'everywhere' }, { kind: 'remove-target', targetId: 'target-nothing' }]) await d.refused(bad);

    // Every decision is recorded as one more revision, and clearing one returns it to unresolved.
    const before = d.state.draft.projection.revision.sequence;
    let current = await d.edit({ kind: 'set-policy-id', policyId: 'acme-baseline' });
    current = await d.edit({ kind: 'set-source', source: SOURCE });
    assert.equal(current.policyId, 'acme-baseline'); assert.deepEqual(current.source, SOURCE);
    current = await d.edit({ kind: 'set-obligation', entryId: entry.id, obligation: 'required' });
    assert.equal(d.entry(current, 'mattpocock.implement').enforcement, 'enforced');
    current = await d.edit({ kind: 'set-obligation', entryId: entry.id, obligation: 'recommended' });
    assert.equal(d.entry(current, 'mattpocock.implement').enforcement, 'advisory');
    current = await d.edit({ kind: 'set-input', entryId: entry.id, name: 'agentDirectory', permission: AGENT_DIR });
    assert.deepEqual(d.entry(current, 'mattpocock.implement').inputs[0].permission, AGENT_DIR);
    assert.deepEqual(current.unresolved, []);
    current = await d.edit({ kind: 'set-input', entryId: entry.id, name: 'agentDirectory', permission: null });
    assert.deepEqual(current.unresolved.map(item => item.path), ['/entries/0/inputs/agentDirectory']);
    current = await d.edit({ kind: 'set-source', source: null });
    assert.equal(current.source, null);
    current = await d.edit({ kind: 'remove-target', targetId: current.targets[0].id });
    assert.equal(current.targets.length, 1);
    current = await d.edit({ kind: 'remove-entry', entryId: entry.id });
    assert.deepEqual(current.entries, []);
    assert.equal(current.projection.revision.sequence, before + 9);

    // Bytes that are not a draft are refused, never read as one.
    const policy = await post(started, 'new', { mode: 'enterprise' });
    const notAnEnvelope = await post(started, 'organization-open', { bytes: policy.value.policyBytes });
    assert.equal(notAnEnvelope.status, 'refused'); assert.equal(notAnEnvelope.diagnostics[0].code, 'INPUT_INVALID');
    const bare = await writeJourneyEnvelope({ savedIntentBytes, records: [] });
    const missing = await post(started, 'organization-open', { bytes: [...bare.value.envelopeBytes] });
    assert.equal(missing.status, 'refused'); assert.equal(missing.diagnostics[0].code, 'ORGANIZATION_DRAFT_MISSING');
    const junk = await post(started, 'organization-open', { bytes: ['x'] });
    assert.equal(junk.status, 'refused');
    const unknown = await post(started, 'organization-nothing', {});
    assert.equal(unknown.status, 'refused');
  });
});

test('an organization draft starts from the same empty Enterprise policy an Enterprise draft does', async () => {
  await withConsumer({}, async started => {
    const enterprise = await post(started, 'new', { mode: 'enterprise' });
    assert.equal(enterprise.status, 'ok', JSON.stringify(enterprise));
    const created = await post(started, 'organization-new', {});
    const read = await readJourneyEnvelope(Uint8Array.from(created.value.envelopeBytes));
    assert.deepEqual([...read.value.savedIntentBytes], enterprise.value.policyBytes);
  });
});

test('an entry whose Catalog content is unavailable is kept as saved, listed, and does not block editing the others', async () => {
  await withConsumer({}, async started => {
    const { ref } = await catalogRefs(started);
    const d = await startDraft(started);
    await d.edit({ kind: 'add-entry', ...ref('mattpocock.code-review'), scope: 'project' });
    // Write the same draft with one more entry whose release is not supplied to this Workbench.
    const read = await readJourneyEnvelope(Uint8Array.from(d.state.envelopeBytes));
    const missing = { releaseSha256: hex('c'), itemId: 'vanished.item', itemSha256: hex('d') };
    const record = structuredClone(read.value.records[0]);
    record.entries.push({ id: await organizationEntryId({ ...missing, scope: 'project' }), item: missing, scope: 'project', obligation: 'required', inputs: { mode: { fixed: 'strict' } } });
    const written = await writeJourneyEnvelope({ savedIntentBytes: read.value.savedIntentBytes, records: [record], previous: read.value });
    d.state.envelopeBytes = [...written.value.envelopeBytes];
    const opened = await post(started, 'organization-open', { bytes: d.state.envelopeBytes });
    assert.equal(opened.status, 'ok', JSON.stringify(opened));
    const gone = d.entry(opened.value.draft, 'vanished.item');
    assert.equal(gone.available, false);
    assert.equal(gone.obligation, 'required'); assert.deepEqual(gone.inputs.map(input => [input.name, input.permission]), [['mode', { fixed: 'strict' }]]);
    assert.ok(opened.value.draft.unresolved.some(item => item.entryId === gone.id && item.path === '/entries/1/item'));
    d.state.draft = opened.value.draft;
    // Other entries stay editable and the unavailable one is preserved exactly in the record.
    const edited = await d.edit({ kind: 'set-obligation', entryId: d.entry(null, 'mattpocock.code-review').id, obligation: 'prohibited' });
    const kept = d.entry(edited, 'vanished.item');
    assert.deepEqual(kept.item, missing); assert.equal(kept.obligation, 'required');
    assert.deepEqual(kept.inputs.map(input => [input.name, input.permission]), [['mode', { fixed: 'strict' }]]);
    // Its inputs cannot be re-checked, so only clearing is possible; removing it works.
    await d.refused({ kind: 'set-input', entryId: kept.id, name: 'mode', permission: { fixed: 'lenient' } });
    // Preview and export refuse while it remains.
    for (const operation of ['preview', 'export']) {
      const refused = await d[operation]();
      assert.equal(refused.status, 'refused', operation);
      assert.equal(refused.diagnostics[0].code, 'ORGANIZATION_DRAFT_UNRESOLVED');
      assert.ok(refused.diagnostics[0].details.unresolved.some(item => item.entryId === kept.id));
    }
    const removed = await d.edit({ kind: 'remove-entry', entryId: kept.id });
    assert.deepEqual(removed.entries.map(entry => entry.item.itemId), ['mattpocock.code-review']);
  });
});

// ---- Preview ------------------------------------------------------------------------------------
// Authors a whole baseline through the same operations the page uses.
async function author(d, ref, { policyId = 'acme-baseline', source = SOURCE, entries = [], targets = [] }) {
  if (policyId) await d.edit({ kind: 'set-policy-id', policyId });
  if (source) await d.edit({ kind: 'set-source', source });
  for (const spec of entries) {
    const scope = spec.scope ?? 'project';
    const entry = d.entry(await d.edit({ kind: 'add-entry', ...ref(spec.id), scope }), spec.id, scope);
    if (spec.obligation) await d.edit({ kind: 'set-obligation', entryId: entry.id, obligation: spec.obligation });
    if (spec.clients || spec.repositories) await d.edit({ kind: 'set-selectors', entryId: entry.id, clients: spec.clients ?? null, repositories: spec.repositories ?? null });
    if (spec.inputs !== false) for (const input of entry.inputs) await d.edit({ kind: 'set-input', entryId: entry.id, name: input.name, permission: spec.inputs?.[input.name] ?? { fixed: input.default } });
  }
  for (const target of targets) await d.edit({ kind: 'add-target', ...target });
  return d.state.draft;
}
const targetOf = (preview, scope, client) => {
  const found = preview.value.targets.find(entry => entry.target.scope === scope && entry.target.client === client);
  assert.ok(found, `${scope}/${client}`);
  return found;
};
const byItem = records => Object.fromEntries(records.map(record => [record.itemId, record]));

test('preview reports Core admission, advisory and fulfillment per target and the contradiction a prohibited dependency causes', async () => {
  await withConsumer({}, async started => {
    const { ref } = await catalogRefs(started);
    const d = await startDraft(started);
    await author(d, ref, { entries: [{ id: 'mattpocock.implement', obligation: 'required' }, { id: 'mattpocock.code-review', obligation: 'prohibited' }, { id: 'mattpocock.tdd', obligation: 'recommended' }],
      targets: [{ scope: 'project' }, { scope: 'user' }] });
    const preview = await d.preview();
    assert.equal(preview.status, 'ok', JSON.stringify(preview));
    assert.deepEqual(preview.diagnostics, []);
    assert.equal(preview.value.candidate.status, 'valid', JSON.stringify(preview.value.candidate));
    assert.deepEqual(preview.value.candidate.unresolved, []);

    const project = targetOf(preview, 'project');
    assert.equal(project.status, 'ok');
    const selected = byItem(project.selection);
    assert.deepEqual(Object.keys(selected).sort(), ['mattpocock.code-review', 'mattpocock.implement', 'mattpocock.tdd']);
    assert.deepEqual([selected['mattpocock.implement'].origin, selected['mattpocock.tdd'].origin, selected['mattpocock.code-review'].origin], ['authored', 'authored', 'dependency']);
    assert.deepEqual(selected['mattpocock.code-review'].requiredBy, ['Implement']);
    assert.deepEqual(selected['mattpocock.implement'].configuration, { agentDirectory: '.claude' });
    // The dependency is explicitly prohibited, so the baseline contradicts itself for this target: Core says so and the page relays it.
    assert.equal(project.enforced.admitted, false);
    assert.ok(project.enforced.diagnostics.some(diagnostic => diagnostic.reason === 'prohibited'));
    assert.deepEqual(project.contradictions.map(({ itemId, label, requiredBy, reason }) => ({ itemId, label, requiredBy, reason })),
      [{ itemId: 'mattpocock.code-review', label: 'Code Review', requiredBy: ['Implement'], reason: 'prohibited' }]);
    assert.match(project.contradictions[0].message, /Implement/);
    // Required fulfillment and advisory use Core's own statuses.
    assert.deepEqual(project.fulfillment.map(({ itemId, label, status, applicability }) => ({ itemId, label, status, applicability })),
      [{ itemId: 'mattpocock.implement', label: 'Implement', status: 'fulfilled', applicability: 'applies' }]);
    assert.deepEqual(project.advisory.map(({ itemId, status }) => ({ itemId, status })), [{ itemId: 'mattpocock.tdd', status: 'taken' }]);
    assert.deepEqual(project.unsupported, []);

    // A user-scope target: nothing in this baseline applies there, and Core says not applicable rather than not fulfilled.
    const user = targetOf(preview, 'user');
    assert.equal(user.status, 'ok');
    assert.deepEqual(user.selection, []);
    assert.deepEqual(user.fulfillment.map(({ itemId, status }) => ({ itemId, status })), [{ itemId: 'mattpocock.implement', status: 'not-applicable' }]);
    assert.deepEqual(user.contradictions, []); assert.equal(user.enforced.admitted, true);
    // The target ids are the draft's own.
    assert.deepEqual(preview.value.targets.map(entry => entry.target.id), d.state.draft.targets.map(entry => entry.id));
  });
});

test('required fulfillment and every enforced result come verbatim from Core for the same document and selections', async () => {
  await withConsumer({}, async started => {
    const { ref, catalog } = await catalogRefs(started);
    const d = await startDraft(started);
    await author(d, ref, { entries: [{ id: 'mattpocock.implement', obligation: 'required' }, { id: 'mattpocock.tdd', obligation: 'recommended', clients: ['claude'] }, { id: 'mattpocock.wizard', obligation: 'permitted' }],
      targets: [{ scope: 'project', client: 'claude' }, { scope: 'project', client: 'codex' }, { scope: 'project' }] });
    const exported = await d.export();
    assert.equal(exported.status, 'ok', JSON.stringify(exported));
    const document = parseOrganizationPolicy(new TextDecoder().decode(Uint8Array.from(exported.value.candidateBytes)));
    assert.equal(document.valid, true, JSON.stringify(document.diagnostics));
    const preview = await d.preview();
    const catalogRoot = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
    const recipeInputs = itemId => JSON.parse(readFileSync(join(catalogRoot, catalog.items.find(item => item.id === itemId).recipe.path), 'utf8')).inputs ?? {};
    const strip = ({ itemId: _itemId, label: _label, ...record }) => record;
    for (const target of preview.value.targets) {
      assert.equal(target.status, 'ok', JSON.stringify(target));
      const selections = target.selection.map(selection => ({ id: selection.id, organizationSelectionId: selection.organizationSelectionId, scope: selection.scope,
        recipeIdentity: document.document.selections.find(entry => entry.selectionId === selection.organizationSelectionId).recipeIdentity,
        inputs: recipeInputs(selection.itemId), configuration: selection.configuration, privateInputs: [] }));
      const { id: _targetId, ...declared } = target.target;
      const direct = previewOrganizationObligations({ organization: document.document, selections, lifecycle: [], target: declared });
      assert.equal(direct.status, 'ok', JSON.stringify(direct));
      assert.deepEqual(target.enforced, direct.value.enforced);
      assert.deepEqual(target.advisory.map(strip), direct.value.advisory);
      assert.deepEqual(target.fulfillment.map(strip), direct.value.fulfillment);
    }
    // The three targets differ the way Core says they do.
    const claude = targetOf(preview, 'project', 'claude'), codex = targetOf(preview, 'project', 'codex'), unknown = targetOf(preview, 'project', undefined);
    assert.deepEqual(claude.selection.map(selection => selection.itemId).sort(), ['mattpocock.code-review', 'mattpocock.implement', 'mattpocock.tdd']);
    assert.deepEqual(claude.advisory.map(record => [record.itemId, record.status]), [['mattpocock.tdd', 'taken']]);
    assert.deepEqual(codex.advisory.map(record => [record.itemId, record.applicability]), [['mattpocock.tdd', 'not-applicable']]);
    // Without a declared client the selector cannot be decided; that is its own condition, never "unsupported".
    assert.deepEqual(unknown.advisory.map(record => [record.itemId, record.applicability, record.status]), [['mattpocock.tdd', 'unknown', 'not-taken']]);
    assert.deepEqual(unknown.omitted.map(({ itemId, reason }) => ({ itemId, reason })), [{ itemId: 'mattpocock.tdd', reason: 'applicability-unknown' }]);
    assert.deepEqual(unknown.unsupported, []);
    assert.deepEqual(unknown.selection.map(selection => selection.itemId).sort(), ['mattpocock.code-review', 'mattpocock.implement']);
  });
});

test('a required control Catalog cannot publish for the target scope is an unsupported control, explained plainly', async () => {
  await withConsumer({}, async started => {
    const { ref } = await catalogRefs(started);
    const d = await startDraft(started);
    await author(d, ref, { entries: [{ id: 'mattpocock.wizard', scope: 'user', obligation: 'required' }, { id: 'mattpocock.tdd', scope: 'user', obligation: 'recommended' }], targets: [{ scope: 'user' }, { scope: 'project' }] });
    const wizard = d.entry(null, 'mattpocock.wizard', 'user');
    assert.deepEqual(wizard.supportedScopes, ['project']);
    const preview = await d.preview();
    assert.equal(preview.status, 'ok', JSON.stringify(preview));
    assert.equal(preview.value.candidate.status, 'valid', JSON.stringify(preview.value.candidate));
    const user = targetOf(preview, 'user');
    assert.equal(user.status, 'ok');
    assert.deepEqual(user.selection, []);
    assert.deepEqual(user.unsupported.map(({ entryId, itemId, label, obligation, reason, status }) => ({ entryId, itemId, label, obligation, reason, status })), [
      { entryId: wizard.id, itemId: 'mattpocock.wizard', label: 'Wizard', obligation: 'required', reason: 'scope-unsupported', status: 'not-fulfilled' },
      { entryId: d.entry(null, 'mattpocock.tdd', 'user').id, itemId: 'mattpocock.tdd', label: 'Test-Driven Development', obligation: 'recommended', reason: 'scope-unsupported', status: 'not-taken' }]);
    const message = user.unsupported[0].message;
    assert.match(message, /^Required control unavailable: Wizard is required for user scope, but Catalog publishes it only for project scope\./);
    assert.match(message, /A developer in this target cannot select it, so Core reports it not-fulfilled\./);
    assert.match(message, /Only the organization can revise this requirement; written guidance is not enforcement\.$/);
    // Core's own result for the same entry is relayed alongside, unchanged.
    assert.deepEqual(user.fulfillment.map(record => [record.itemId, record.status]), [['mattpocock.wizard', 'not-fulfilled']]);
    // It is not a problem at a scope where nothing was required.
    assert.deepEqual(targetOf(preview, 'project').unsupported, []);
    // The candidate still exports: the organization states its requirement even where it cannot be met.
    const exported = await d.export();
    assert.equal(exported.status, 'ok', JSON.stringify(exported));
    const candidate = JSON.parse(new TextDecoder().decode(Uint8Array.from(exported.value.candidateBytes)));
    assert.deepEqual(candidate.selections.map(entry => [entry.obligation, entry.scopes]), [['required', ['user']], ['recommended', ['user']]]);
    assert.equal(new Set(candidate.selections.map(entry => entry.selectionId)).size, 2);
  });
});

test('preview of an incomplete draft previews what is decided and lists what was left out; a target Core refuses is reported as refused', async () => {
  await withConsumer({}, async started => {
    const { ref } = await catalogRefs(started);
    const d = await startDraft(started);
    await author(d, ref, { policyId: null, source: null, entries: [{ id: 'mattpocock.implement', obligation: 'required' }, { id: 'mattpocock.tdd', inputs: false }],
      targets: [{ scope: 'project' }, { scope: 'project', client: 'not-a-client' }] });
    const preview = await d.preview();
    assert.equal(preview.status, 'ok', JSON.stringify(preview));
    assert.equal(preview.value.candidate.status, 'incomplete');
    assert.deepEqual(preview.value.candidate.unresolved.map(item => item.path), ['/policyId', '/source', '/entries/1/obligation', '/entries/1/inputs/agentDirectory']);
    const decided = targetOf(preview, 'project', undefined);
    assert.equal(decided.status, 'ok');
    assert.deepEqual(decided.selection.map(selection => selection.itemId).sort(), ['mattpocock.code-review', 'mattpocock.implement']);
    assert.deepEqual(decided.omitted.map(({ itemId, reason }) => ({ itemId, reason })), [{ itemId: 'mattpocock.tdd', reason: 'obligation-unset' }]);
    const refused = targetOf(preview, 'project', 'not-a-client');
    assert.equal(refused.status, 'refused');
    assert.equal(refused.diagnostics[0].path, '/target/client');
    assert.deepEqual(refused.selection, []);
    // Export refuses until it is complete, naming each open item.
    const exported = await d.export();
    assert.equal(exported.status, 'refused');
    assert.equal(exported.diagnostics[0].code, 'ORGANIZATION_DRAFT_UNRESOLVED');
    assert.deepEqual(exported.diagnostics[0].details.unresolved.map(item => item.path), ['/policyId', '/source', '/entries/1/obligation', '/entries/1/inputs/agentDirectory']);
  });
});

// ---- Export -------------------------------------------------------------------------------------
const decodeBytes = array => new TextDecoder().decode(Uint8Array.from(array));

test('export refuses an unresolved or contradictory draft, naming what to resolve', async () => {
  await withConsumer({}, async started => {
    const { ref } = await catalogRefs(started);
    const d = await startDraft(started);
    const unresolved = await d.export();
    assert.equal(unresolved.status, 'refused');
    assert.equal(unresolved.diagnostics[0].code, 'ORGANIZATION_DRAFT_UNRESOLVED');
    assert.deepEqual(unresolved.diagnostics[0].details.unresolved.map(item => item.path), ['/policyId', '/source']);
    assert.deepEqual(unresolved.originalBytes, d.state.envelopeBytes);

    // Requiring an item while prohibiting what it needs is a contradiction even when no target was declared.
    await author(d, ref, { entries: [{ id: 'mattpocock.implement', obligation: 'required' }, { id: 'mattpocock.code-review', obligation: 'prohibited' }] });
    const contradictory = await d.export();
    assert.equal(contradictory.status, 'refused', JSON.stringify(contradictory));
    assert.equal(contradictory.diagnostics[0].code, 'ORGANIZATION_CANDIDATE_CONTRADICTION');
    const [first] = contradictory.diagnostics[0].details.contradictions;
    assert.equal(first.itemId, 'mattpocock.code-review'); assert.deepEqual(first.requiredBy, ['Implement']); assert.equal(first.target.scope, 'project');
    // The same finding is previewed, not hidden, so the author can see it and fix it.
    const previewed = await d.preview();
    assert.equal(previewed.status, 'ok');

    // Approving the dependency explicitly resolves it: the explicit entry wins over the implied one.
    const review = d.entry(null, 'mattpocock.code-review');
    await d.edit({ kind: 'set-obligation', entryId: review.id, obligation: 'permitted' });
    const resolved = await d.export();
    assert.equal(resolved.status, 'ok', JSON.stringify(resolved));
    const candidate = JSON.parse(decodeBytes(resolved.value.candidateBytes));
    assert.deepEqual(candidate.selections.map(entry => entry.obligation).sort(), ['permitted', 'required']);

    // A selector Core does not know makes the candidate invalid: Core's diagnostics are returned, not paraphrased.
    await d.edit({ kind: 'set-selectors', entryId: review.id, clients: ['not-a-client'], repositories: null });
    const invalid = await d.export();
    assert.equal(invalid.status, 'refused');
    assert.equal(invalid.diagnostics[0].code, 'ORGANIZATION_CANDIDATE_INVALID');
    assert.equal(invalid.diagnostics[0].details.owner, 'core');
    assert.ok(invalid.diagnostics[0].details.diagnostics.some(diagnostic => diagnostic.reason === 'unknown-client'));
    const previewInvalid = await d.preview();
    assert.equal(previewInvalid.value.candidate.status, 'invalid');
    assert.ok(previewInvalid.value.candidate.diagnostics.some(diagnostic => diagnostic.reason === 'unknown-client'));
  });
});

// A contradiction that only a selector-restricted target reveals must not escape just because nobody declared that target.
const restrictedContradiction = async (restrict, expectedTarget) => withConsumer({}, async started => {
  const { ref } = await catalogRefs(started);
  const d = await startDraft(started);
  await author(d, ref, { entries: [{ id: 'mattpocock.implement', obligation: 'required', ...restrict.implement }, { id: 'mattpocock.code-review', obligation: 'prohibited', ...restrict.review }] });
  assert.deepEqual(d.state.draft.targets, []);
  assert.deepEqual(d.state.draft.unresolved, []);
  const refused = await d.export();
  assert.equal(refused.status, 'refused', JSON.stringify(refused));
  assert.equal(refused.diagnostics[0].code, 'ORGANIZATION_CANDIDATE_CONTRADICTION');
  const found = refused.diagnostics[0].details.contradictions;
  assert.ok(found.some(item => item.itemId === 'mattpocock.code-review' && item.target.scope === 'project'
    && item.target.client === expectedTarget.client && item.target.repository === expectedTarget.repository), JSON.stringify(found));
  // The implicit targets only gate export: preview lists exactly the targets the author declared.
  const previewed = await d.preview();
  assert.equal(previewed.status, 'ok');
  assert.deepEqual(previewed.value.targets, []);
  // Declaring the target shows the same finding, and approving the dependency settles it with the selectors still in place.
  await d.edit({ kind: 'add-target', scope: 'project', ...(expectedTarget.client ? { client: expectedTarget.client } : {}), ...(expectedTarget.repository ? { repository: expectedTarget.repository } : {}) });
  assert.equal((await d.export()).diagnostics[0].code, 'ORGANIZATION_CANDIDATE_CONTRADICTION');
  await d.edit({ kind: 'set-obligation', entryId: d.entry(null, 'mattpocock.code-review').id, obligation: 'permitted' });
  const resolved = await d.export();
  assert.equal(resolved.status, 'ok', JSON.stringify(resolved));
});

test('export refuses a contradiction only a client-restricted target reveals, without a declared claude target', async () => {
  await restrictedContradiction({ implement: { clients: ['claude'] }, review: {} }, { client: 'claude' });
});

test('export refuses a contradiction only a repository-restricted target reveals, without a declared repository target', async () => {
  await restrictedContradiction({ implement: { repositories: ['github.com/acme/app'] }, review: {} }, { repository: 'github.com/acme/app' });
});

test('export checks the combination of selectors that different entries name', async () => {
  // The prohibition applies only to one repository and the requirement only to one client, so only their product contradicts.
  await restrictedContradiction({ implement: { clients: ['claude'] }, review: { repositories: ['github.com/acme/app'] } }, { client: 'claude', repository: 'github.com/acme/app' });
});

test('export refuses, and never silently skips, a baseline whose selectors combine into more targets than can be checked', async () => {
  await withConsumer({}, async started => {
    const { ref } = await catalogRefs(started);
    const d = await startDraft(started);
    const repositories = Array.from({ length: 1100 }, (_, index) => `github.com/acme/app-${index}`);
    await author(d, ref, { entries: [{ id: 'mattpocock.implement', obligation: 'required', repositories }] });
    const refused = await d.export();
    assert.equal(refused.status, 'refused', JSON.stringify(refused).slice(0, 500));
    assert.equal(refused.diagnostics[0].code, 'ORGANIZATION_CONSISTENCY_UNCHECKED');
    assert.match(refused.diagnostics[0].message, /narrow/i);
    assert.deepEqual(refused.diagnostics[0].details, { combinations: 1101, limit: 1024 });
    assert.deepEqual(refused.originalBytes, d.state.envelopeBytes);
    // Narrowing the selectors lets every combination be checked.
    await d.edit({ kind: 'set-selectors', entryId: d.entry(null, 'mattpocock.implement').id, repositories: repositories.slice(0, 3) });
    assert.equal((await d.export()).status, 'ok');
  });
});

// ---- Authority entries do not depend on a runnable example configuration ----------------------
const GUARD = 'extensions.claude.hook.git-guard', GUARD_SOURCE = 'extensions.hook-source.git-guard';

test('a prohibited entry needs neither input permissions nor a configuration to export', async () => {
  await withConsumer({}, async started => {
    const { ref } = await catalogRefs(started);
    const d = await startDraft(started);
    await author(d, ref, { entries: [{ id: GUARD, obligation: 'prohibited', inputs: false }] });
    assert.deepEqual(d.state.draft.unresolved, []);
    const exported = await d.export();
    assert.equal(exported.status, 'ok', JSON.stringify(exported));
    const document = JSON.parse(decodeBytes(exported.value.candidateBytes));
    assert.equal(parseOrganizationPolicy(JSON.stringify(document)).valid, true);
    assert.deepEqual(document.selections.map(entry => [entry.obligation, entry.scopes, entry.inputs]), [['prohibited', ['project'], {}]]);
    const previewed = await d.preview();
    assert.equal(previewed.value.candidate.status, 'valid');
  });
});

test('a required entry whose value only developers can declare is still part of the document and Core fulfillment', async () => {
  await withConsumer({}, async started => {
    const { ref } = await catalogRefs(started);
    const d = await startDraft(started);
    await author(d, ref, { entries: [{ id: GUARD, obligation: 'required', inputs: { hookCommand: { allowDeclared: true } } }], targets: [{ scope: 'project' }] });
    // Catalog says the hook needs its hook source; with no value to compose from, its dependency set cannot be checked through Core.
    const waiting = await d.preview();
    assert.equal(waiting.value.candidate.status, 'incomplete');
    const open = waiting.value.candidate.unresolved.filter(item => item.entryId === d.entry(null, GUARD).id);
    assert.equal(open.length, 1, JSON.stringify(open));
    assert.match(open[0].message, /fixed value or choices/);
    assert.equal((await d.export()).diagnostics[0].code, 'ORGANIZATION_DRAFT_UNRESOLVED');
    // It is in the example-less preview regardless: omitted from the selection, present in Core's own fulfillment.
    const project = targetOf(waiting, 'project');
    assert.equal(project.status, 'ok');
    assert.deepEqual(project.omitted.filter(item => item.itemId === GUARD).map(item => item.reason), ['needs-declared-value']);
    assert.deepEqual(project.selection, []);
    assert.deepEqual(project.fulfillment.map(({ itemId, status }) => ({ itemId, status })), [{ itemId: GUARD, status: 'not-fulfilled' }]);

    // Approving the direct dependency is not enough: a prohibited transitive dependency would go unseen, so it stays unresolved.
    await author(d, ref, { policyId: null, source: null, entries: [{ id: GUARD_SOURCE, obligation: 'permitted' }, { id: 'extensions.notices', obligation: 'prohibited', inputs: false }] });
    const refused = await d.export();
    assert.equal(refused.status, 'refused', JSON.stringify(refused));
    assert.equal(refused.diagnostics[0].code, 'ORGANIZATION_DRAFT_UNRESOLVED');
    const still = await d.preview();
    assert.equal(still.value.candidate.status, 'incomplete');
    assert.ok(still.value.candidate.unresolved.some(item => item.entryId === d.entry(null, GUARD).id));
    assert.deepEqual(targetOf(still, 'project').fulfillment.filter(({ itemId }) => itemId === GUARD).map(({ status }) => status), ['not-fulfilled']);
  });
});

test('an entry named without composing it carries the id ordinary composition assigns', async () => {
  await withConsumer({}, async started => {
    const { ref, catalog } = await catalogRefs(started);
    // The id Enterprise composition assigns an item is the shared helper's, so an entry that cannot be composed is still admitted by the same id.
    const fresh = await post(started, 'new', { mode: 'enterprise' });
    const intent = JSON.parse(decodeBytes(fresh.value.policyBytes)).metadata['aih.workbench'];
    const item = catalog.items.find(entry => entry.id === 'mattpocock.implement');
    intent.roots.push({ ...item.root, configuration: { agentDirectory: '.claude' }, originIds: ['direct'] });
    const composed = await post(started, 'compose', { policyBytes: fresh.value.policyBytes, intent });
    assert.equal(composed.status, 'ok', JSON.stringify(composed));
    const selection = composed.value.policy.selections.find(candidate => candidate.recipe && candidate.managementId.endsWith('--mattpocock.implement'));
    const provenance = composed.value.intent.provenance.find(entry => entry.releaseSha256 === item.root.releaseSha256);
    assert.equal(managementIdOf({ scope: selection.scope, packageName: provenance.package.name, itemId: 'mattpocock.implement' }), selection.managementId);
    assert.equal(selection.organizationSelectionId, selection.managementId);

    // The same item as a prohibited entry (never composed) is named by that id.
    const d = await startDraft(started);
    await author(d, ref, { entries: [{ id: 'mattpocock.implement', obligation: 'prohibited', inputs: false }] });
    const exported = await d.export();
    assert.equal(exported.status, 'ok', JSON.stringify(exported));
    assert.equal(JSON.parse(decodeBytes(exported.value.candidateBytes)).selections[0].selectionId, selection.organizationSelectionId);
  });
});

test('the exported candidate is a valid 1.1.0 document whose identities match what an ordinary Enterprise draft composes', async () => {
  await withConsumer({}, async started => {
    const { ref, catalog } = await catalogRefs(started);
    const d = await startDraft(started);
    await author(d, ref, { entries: [{ id: 'mattpocock.implement', obligation: 'required' }, { id: 'mattpocock.tdd', obligation: 'recommended', clients: ['claude'], repositories: ['github.com/acme/app'] },
      { id: 'mattpocock.wizard', obligation: 'prohibited' }], targets: [{ scope: 'project', client: 'claude' }] });
    const exported = await d.export();
    assert.equal(exported.status, 'ok', JSON.stringify(exported));
    const { fileName, candidateBytes, explanationFileName, explanation, handoff } = exported.value;
    assert.equal(fileName, 'acme-baseline.organization-policy.json'); assert.equal(explanationFileName, 'acme-baseline.explanation.md');
    const text = decodeBytes(candidateBytes);
    // Bytes are the canonical, human-readable serialization and round-trip through Core's own parser.
    const parsed = parseOrganizationPolicy(text);
    assert.equal(parsed.valid, true, JSON.stringify(parsed.diagnostics));
    assert.equal(text, JSON.stringify(JSON.parse(text), null, 2) + '\n');
    const document = JSON.parse(text);
    assert.equal(document.schema, 'urn:aihq:core:organization-policy:1.1.0'); assert.equal(document.id, 'acme-baseline');
    const byRecipe = Object.fromEntries(document.selections.map(entry => [entry.selectionId, entry]));
    assert.equal(document.selections.length, 4);
    assert.deepEqual(document.selections.map(entry => entry.obligation), ['required', 'recommended', 'prohibited', 'permitted']);
    const [implement, tdd, wizard, dependency] = document.selections;
    assert.deepEqual(implement.scopes, ['project']); assert.deepEqual(implement.inputs, { agentDirectory: { fixed: '.claude' } }); assert.deepEqual(implement.lifecycle, { replace: true, remove: true });
    assert.deepEqual(tdd.clients, ['claude']); assert.deepEqual(tdd.repositories, ['github.com/acme/app']);
    assert.deepEqual(wizard.inputs, {}); assert.equal('lifecycle' in wizard, false);
    // The dependency is approved with what requires it: permitted, fixed to the composed configuration, no selectors.
    assert.deepEqual(Object.keys(dependency).sort(), ['inputs', 'lifecycle', 'obligation', 'recipeIdentity', 'scopes', 'selectionId']);
    assert.equal(Object.keys(byRecipe).length, 4);

    // Metadata records the draft that produced it and never where it will be read from.
    const meta = document.metadata['aih.workbench'];
    assert.equal(meta.journeyId, d.state.draft.projection.id); assert.equal(meta.revisionSha256, d.state.draft.projection.revision.sha256);
    assert.deepEqual(meta.entries.map(entry => [entry.itemId, entry.origin, entry.requiredBy]), [['mattpocock.implement', 'authored', undefined], ['mattpocock.tdd', 'authored', undefined],
      ['mattpocock.wizard', 'authored', undefined], ['mattpocock.code-review', 'dependency', ['mattpocock.implement']]]);
    assert.deepEqual(meta.entries.map(entry => entry.selectionId), document.selections.map(entry => entry.selectionId));
    for (const entry of meta.entries) assert.match(entry.itemSha256, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(document).includes('acme/policies'), false);
    assert.equal(JSON.stringify(document).includes('org/baseline.json'), false);

    // An ordinary Enterprise composition of the same items assigns exactly these identities.
    const fresh = await post(started, 'new', { mode: 'enterprise' });
    const intent = JSON.parse(decodeBytes(fresh.value.policyBytes)).metadata['aih.workbench'];
    for (const id of ['mattpocock.implement', 'mattpocock.tdd', 'mattpocock.wizard']) {
      const item = catalog.items.find(entry => entry.id === id);
      intent.roots.push({ ...item.root, configuration: { agentDirectory: '.claude' }, originIds: ['direct'] });
    }
    const composed = await post(started, 'compose', { policyBytes: fresh.value.policyBytes, intent });
    assert.equal(composed.status, 'ok', JSON.stringify(composed));
    const composedIds = composed.value.policy.selections.map(selection => selection.organizationSelectionId).sort();
    assert.deepEqual(composedIds, document.selections.map(entry => entry.selectionId).sort());
    for (const selection of composed.value.policy.selections) assert.equal(byRecipe[selection.organizationSelectionId].scopes[0], selection.scope);

    // The explanation is plain Markdown for the people who review the change.
    assert.match(explanation, /^# Organization baseline acme-baseline/);
    for (const label of ['### Implement', '### Test-Driven Development', '### Wizard', '### Code Review']) assert.ok(explanation.includes(label), label);
    assert.match(explanation, /Enforced: Required/); assert.match(explanation, /Advisory: Recommended/); assert.match(explanation, /Enforced: Prohibited/); assert.match(explanation, /Enforced: Permitted/);
    assert.match(explanation, /Clients: claude/); assert.match(explanation, /Repositories: github\.com\/acme\/app/);
    assert.match(explanation, /agentDirectory must be "\.claude"/);
    assert.match(explanation, /Included as a dependency of: mattpocock\.implement/);
    assert.match(explanation, /Repository: `acme\/policies`/); assert.match(explanation, /Path: `org\/baseline\.json`/); assert.match(explanation, /Ref: `refs\/heads\/main`/);
    assert.ok(explanation.includes(handoff.activation));

    // The handoff names exactly what the GitHub authority contract will read, and copyable steps.
    assert.deepEqual({ repository: handoff.repository, path: handoff.path, ref: handoff.ref, location: handoff.location, source: handoff.source },
      { repository: 'acme/policies', path: 'org/baseline.json', ref: 'refs/heads/main', location: 'acme/policies/org/baseline.json@refs/heads/main', source: SOURCE });
    const branch = `aih/organization-policy-acme-baseline-r${d.state.draft.projection.revision.sequence}`;
    assert.equal(handoff.gitSteps, ['# Run from the folder that holds acme-baseline.organization-policy.json.', 'git clone https://github.com/acme/policies.git', 'cd policies', 'git switch main',
      `git switch -c ${branch}`, 'mkdir -p org', 'cp ../acme-baseline.organization-policy.json org/baseline.json', 'git add org/baseline.json',
      'git commit -m "Update organization baseline acme-baseline"', `git push -u origin ${branch}`].join('\n'));
    assert.equal(handoff.prSteps, `gh pr create --repo acme/policies --base main --head ${branch} --title "Update organization baseline acme-baseline" --body-file ../acme-baseline.explanation.md`);
    assert.match(handoff.activation, /^Exporting does not publish or activate this candidate\./);
    assert.ok(handoff.activation.includes('acme/policies/org/baseline.json@refs/heads/main'));
  });
});

test('a tag or commit source says plainly that the configured source stays fixed until the operator moves it', async () => {
  await withConsumer({}, async started => {
    const { ref } = await catalogRefs(started);
    const d = await startDraft(started);
    await author(d, ref, { entries: [{ id: 'mattpocock.tdd', obligation: 'required' }], source: { ...SOURCE, path: 'baseline.json', revision: { kind: 'tag', value: 'policy/v1' } } });
    const tag = (await d.export()).value.handoff;
    assert.equal(tag.ref, 'refs/tags/policy/v1');
    assert.match(tag.gitSteps, /^git switch --detach refs\/tags\/policy\/v1$/m);
    assert.doesNotMatch(tag.gitSteps, /mkdir/);
    assert.match(tag.prSteps, /fixed tag policy\/v1/); assert.match(tag.prSteps, /move the tag policy\/v1/);
    assert.doesNotMatch(tag.prSteps, /--base/);
    const sha = 'f'.repeat(40);
    await d.edit({ kind: 'set-source', source: { ...SOURCE, revision: { kind: 'commit', value: sha } } });
    const commit = (await d.export()).value.handoff;
    assert.equal(commit.ref, sha); assert.equal(commit.location, `acme/policies/org/baseline.json@${sha}`);
    assert.match(commit.gitSteps, new RegExp(`^git switch --detach ${sha}$`, 'm'));
    assert.match(commit.prSteps, /fixed commit/); assert.match(commit.prSteps, /AIH_ORGANIZATION_SOURCE/);
    assert.match(commit.activation, /Exporting does not publish or activate this candidate\./);
  });
});

// ---- Authority ----------------------------------------------------------------------------------
const attacker = { provider: 'github', repository: { owner: 'attacker', name: 'redirect' }, path: 'evil.json', revision: { kind: 'branch', value: 'evil' } };
const redirect = { organizationSource: attacker, source: attacker, repository: attacker.repository, path: attacker.path, revision: attacker.revision };
const revisionOf = authority => Object.fromEntries(['resolvedCommit', 'blobId', 'contentDigest'].map(key => [key, authority[key]]));
// What an ordinary developer does: compose an Enterprise policy for some Catalog items, then hand it to the host.
async function developerPolicy(started, catalog, itemIds, metadata = {}) {
  const fresh = await post(started, 'new', { mode: 'enterprise' });
  const intent = JSON.parse(decodeBytes(fresh.value.policyBytes)).metadata['aih.workbench'];
  for (const id of itemIds) {
    const item = catalog.items.find(entry => entry.id === id);
    const configuration = Object.fromEntries(Object.entries(item.inputs ?? {}).filter(([, spec]) => spec.default !== undefined).map(([name, spec]) => [name, spec.default]));
    intent.roots.push({ ...item.root, configuration, originIds: ['direct'] });
  }
  const composed = await post(started, 'compose', { policyBytes: fresh.value.policyBytes, intent });
  assert.equal(composed.status, 'ok', JSON.stringify(composed));
  const policy = composed.value.policy;
  return [...new TextEncoder().encode(JSON.stringify({ ...policy, metadata: { ...policy.metadata, ...metadata } }))];
}

test('exporting performs no GitHub request and leaves the active authority and what it admits unchanged', async () => {
  const fixture = createGitHubFixture(), projectRoot = await mkdtemp(join(tmpdir(), 'organization-author-'));
  const enterprise = await enterpriseFixture();
  fixture.publish(enterprise.document); fixture.install();
  let started;
  try {
    started = await startConsumer({ organizationSource: fixture.source, projectRoot, controls: { logging: 'off' } });
    const { ref, catalog } = await catalogRefs(started);
    // Authoring, previewing and exporting a candidate are local: the configured source is never read for them.
    const d = await startDraft(started);
    await author(d, ref, { entries: [{ id: 'mattpocock.tdd', obligation: 'required' }], targets: [{ scope: 'project' }] });
    assert.equal((await d.preview()).status, 'ok');
    const exported = await d.export();
    assert.equal(exported.status, 'ok', JSON.stringify(exported));
    assert.deepEqual(fixture.requests, []);

    const active = await post(started, 'authority-source');
    assert.equal(active.status, 'ok', JSON.stringify(active));
    const read = fixture.requests.length;
    assert.ok(read > 0);
    await d.export(); await d.preview();
    assert.equal(fixture.requests.length, read, 'export and preview add no GitHub request');
    const unchanged = await post(started, 'authority-source');
    assert.deepEqual(revisionOf(unchanged.authority), revisionOf(active.authority));
    assert.deepEqual(unchanged.source, fixture.source);
    assert.equal(unchanged.authority.policyId, 'controlled-organization');

    // A developer policy only the candidate would admit is still not admitted: the candidate is not active.
    const onlyCandidate = await developerPolicy(started, catalog, ['mattpocock.tdd']);
    const denied = await post(started, 'authority', { policyBytes: onlyCandidate });
    assert.equal(denied.status, 'ok', JSON.stringify(denied));
    assert.equal(denied.value.admitted, false, JSON.stringify(denied.value));
    assert.deepEqual(revisionOf(denied.value.authority), revisionOf(active.authority));
    const admitted = await post(started, 'authority', { policyBytes: await developerPolicy(started, catalog, ['mattpocock.code-review']) });
    assert.equal(admitted.value.admitted, true, JSON.stringify(admitted.value));
  } finally { if (started) await new Promise(resolve => started.server.close(resolve)); fixture.restore(); await rm(projectRoot, { recursive: true, force: true }); }
});

test('once the candidate is published at the configured source, an ordinary Enterprise draft is admitted against it and cannot redirect where it is read', async () => {
  const fixture = createGitHubFixture(), projectRoot = await mkdtemp(join(tmpdir(), 'organization-author-'));
  const before = fixture.publish({ schema: 'urn:aihq:core:organization-policy:1.0.0', id: 'controlled-organization', selections: [], metadata: redirect });
  fixture.install();
  let started;
  try {
    started = await startConsumer({ organizationSource: fixture.source, projectRoot, controls: { logging: 'off' } });
    const { ref, catalog } = await catalogRefs(started);
    const d = await startDraft(started);
    await author(d, ref, { policyId: 'acme-baseline', source: { ...SOURCE, repository: { owner: fixture.source.repository.owner, name: fixture.source.repository.name }, path: fixture.source.path },
      entries: [{ id: 'mattpocock.implement', obligation: 'required' }, { id: 'mattpocock.tdd', obligation: 'recommended' }] });
    const exported = await d.export();
    assert.equal(exported.status, 'ok', JSON.stringify(exported));
    // Under the current document nothing is admitted.
    const developer = await developerPolicy(started, catalog, ['mattpocock.implement', 'mattpocock.tdd'], redirect);
    const unpublished = await post(started, 'authority', { ...redirect, policyBytes: developer });
    assert.equal(unpublished.value.admitted, false);
    assert.equal(unpublished.value.authority.resolvedCommit, before.resolvedCommit);

    // The operator merges the candidate; only then does the source read it.
    const published = fixture.publish(JSON.parse(decodeBytes(exported.value.candidateBytes)));
    const next = await post(started, 'authority-source', redirect);
    assert.equal(next.status, 'ok', JSON.stringify(next));
    assert.equal(next.authority.resolvedCommit, published.resolvedCommit); assert.equal(next.authority.policyId, 'acme-baseline');
    const admitted = await post(started, 'authority', { ...redirect, policyBytes: developer });
    assert.equal(admitted.status, 'ok', JSON.stringify(admitted));
    assert.equal(admitted.value.admitted, true, JSON.stringify(admitted.value));
    assert.deepEqual(admitted.value.authority.source, fixture.source);
    assert.equal(admitted.value.authority.resolvedCommit, published.resolvedCommit);
    assert.equal(admitted.value.authority.policyId, 'acme-baseline');
    // Something the baseline does not name is still refused.
    const outside = await post(started, 'authority', { ...redirect, policyBytes: await developerPolicy(started, catalog, ['mattpocock.wizard'], redirect) });
    assert.equal(outside.value.admitted, false);
    // Every read stayed under the configured repository; the redirect fields in the derived policy named nothing that was fetched.
    const base = `/repos/${fixture.source.repository.owner}/${fixture.source.repository.name}/git/`;
    assert.ok(fixture.requests.length > 0);
    for (const path of fixture.requests) assert.ok(path.startsWith(base), path);
    assert.ok(!fixture.requests.some(path => /attacker|evil|redirect/.test(path)));
  } finally { if (started) await new Promise(resolve => started.server.close(resolve)); fixture.restore(); await rm(projectRoot, { recursive: true, force: true }); }
});

// ---- Shipped schema -----------------------------------------------------------------------------
async function shippedSchema(name) {
  for (const base of ['../../schemas/', '../schemas/']) {
    try { return JSON.parse(await readFile(new URL(`${base}${name}`, import.meta.url), 'utf8')); } catch { /* try the other consumer layout */ }
  }
  return undefined;
}

test('the shipped organization-draft schema agrees with the record the writer produces', async t => {
  const schema = await shippedSchema('journey-record-organization-draft-1.0.0.json'), envelope = await shippedSchema('journey-envelope-1.0.0.json');
  if (!schema || !envelope) return t.skip('schema files are not present in this consumer layout; tools/write-authoring-schemas.mjs --check verifies them');
  const full = await sampleRecord({ policyId: 'acme-baseline', source: { ...SOURCE } });
  full.entries[0] = { ...full.entries[0], obligation: 'required', clients: ['claude'], repositories: ['github.com/acme/app'], inputs: { agentDirectory: AGENT_DIR } };
  full.targets[0] = { ...full.targets[0], client: 'claude', repository: 'github.com/acme/app' };
  full.targets[0].id = await organizationTargetId(full.targets[0]);
  assert.equal(organizationDraftProblem(full), null);
  assert.equal(schema.$id, ORGANIZATION_DRAFT_RECORD_SCHEMA); assert.equal(schema.properties.schema.const, ORGANIZATION_DRAFT_RECORD_SCHEMA);
  assert.equal(schema.properties.id.const, 'organization-draft'); assert.equal(schema.properties.required.const, true); assert.equal(schema.additionalProperties, false);
  assert.deepEqual([...schema.required].sort(), ['entries', 'id', 'required', 'schema', 'targets']);
  assert.deepEqual(Object.keys(schema.properties).sort(), Object.keys(full).sort());
  const entry = schema.properties.entries.items, target = schema.properties.targets.items;
  assert.deepEqual(Object.keys(entry.properties).sort(), Object.keys(full.entries[0]).sort());
  assert.deepEqual([...entry.required].sort(), ['id', 'inputs', 'item', 'scope']);
  assert.deepEqual(Object.keys(target.properties).sort(), Object.keys(full.targets[0]).sort());
  assert.deepEqual([...target.required].sort(), ['id', 'scope']);
  assert.match(full.entries[0].id, new RegExp(entry.properties.id.pattern)); assert.match(full.targets[0].id, new RegExp(target.properties.id.pattern));
  assert.deepEqual(entry.properties.obligation.enum, ['required', 'recommended', 'permitted', 'prohibited']);
  assert.deepEqual(entry.properties.inputs.additionalProperties.oneOf.map(rule => Object.keys(rule.properties)[0]), ['fixed', 'choices', 'allowDeclared']);
  // The source patterns accept what the reader accepts and the ones it refuses for being unsafe.
  const { source } = schema.properties;
  const owner = new RegExp(source.properties.repository.properties.owner.pattern), name = new RegExp(source.properties.repository.properties.name.pattern), path = new RegExp(source.properties.path.pattern);
  assert.ok(owner.test('acme') && name.test('policies') && path.test('org/baseline.json'));
  assert.ok(!owner.test('acme;rm') && !name.test('a b') && !path.test('org/$(id).json') && !path.test('org/policy.txt') && !path.test('x/baseline-json'));
  const commit = source.properties.revision.allOf[0];
  assert.equal(commit.if.properties.kind.const, 'commit'); assert.match('a'.repeat(40), new RegExp(commit.then.properties.value.pattern)); assert.doesNotMatch('main', new RegExp(commit.then.properties.value.pattern));
  // The envelope schema validates the record by reference, after the two maintenance kinds.
  const rules = envelope.properties.records.items.allOf.map(rule => [rule.if.properties.schema.const, rule.then.$ref]);
  assert.deepEqual(rules.at(-1), [ORGANIZATION_DRAFT_RECORD_SCHEMA, ORGANIZATION_DRAFT_RECORD_SCHEMA]);
  assert.equal(rules.length, 3);
});
