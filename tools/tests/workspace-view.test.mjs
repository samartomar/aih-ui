import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthoringClient } from '../../src/app/authoring-client.js';
import * as workspace from '../../src/app/workspace-view.js';

const ok = value => ({ status: 'ok', value });
const draft = { envelopeBytes: [1], savedIntentBytes: [9], projection: { revision: { sequence: 1 } }, intent: { roots: [] } };
const projection = { workspace: { id: 'workspace-one', label: 'Team' }, members: [{ id: 'api', identity: 'github.com/acme/api', aliases: [], responsibilities: { status: 'unresolved' }, instructions: { status: 'unresolved' }, contracts: { status: 'unresolved' }, bindings: [] }], relationships: { status: 'unresolved', confirmed: [], suggested: [] }, unsupported: [] };
const reasons = ['additional-checkout', 'moved', 'fork', 'similar-name', 'ambiguous-remote', 'no-remote'];
const observed = { root: '/tmp/checkout', repository: 'github.com/acme/api', revision: 'a'.repeat(40), branch: 'main', worktree: { kind: 'linked' }, workingState: { clean: true } };
function service(t, ...script) {
  const calls = [], previous = globalThis.fetch;
  globalThis.fetch = async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => await script.shift() }; };
  t.after(() => { globalThis.fetch = previous; }); return calls;
}
class Node {
  constructor(tag, cls, text = '') { this.tag = tag; this.className = cls; this.textContent = text; this.children = []; this.listeners = {}; this.dataset = {}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, action) { this.listeners[name] = action; }
}
const elements = node => [node, ...node.children.flatMap(elements)];
const textOf = node => elements(node).map(node => node.textContent).join(' ');
const find = (built, text) => elements(built.node).find(node => node.tag === 'button' && node.textContent === text);
function view(client, options = {}) {
  const el = (tag, cls, text) => new Node(tag, cls, text);
  const button = (label, action) => { const node = el('button', '', label); node.addEventListener('click', action); return node; };
  return workspace.createWorkspaceView({ client, el, button, showStatus() {}, ...options });
}
function clientFor(plan) {
  const calls = [];
  const client = { draft, revision: 1, readWorkspace: async () => ok(projection),
    planBinding: async input => { calls.push(input); return ok(plan); },
    bindCheckout: async input => { calls.push(input); return ok({ projection }); },
    exportWorkspace: async () => ok({ envelopeBytes: [4, 5], excluded: { bindings: 1 } }) };
  return { client, calls };
}

test('relationship completeness is only an explicit owner declaration', () => {
  assert.equal(workspace.relationshipSummary({}), 'Relationships: unresolved — 0 confirmed so far; this map may be incomplete.');
  assert.equal(workspace.relationshipSummary({ relationships: { status: 'complete', confirmed: [] } }), 'Relationships: declared complete by the owner (0 confirmed).');
  assert.equal(workspace.relationshipSummary({ relationships: { status: 'unresolved', confirmed: [{}], shown: 'complete' } }), 'Relationships: unresolved — 1 confirmed so far; this map may be incomplete.');
});

test('form helpers trim lists and build the precise portable operations', () => {
  assert.deepEqual(workspace.memberOperation({ id: ' api ', identity: ' github.com/acme/api ', label: ' API ', responsibilitiesStatus: 'known', responsibilities: ' build, , test ', instructionsStatus: 'known', instructions: ' , ', contractsStatus: 'unresolved', contracts: 'ignore' }), {
    type: 'set-member', member: { id: 'api', identity: 'github.com/acme/api', aliases: [], label: 'API', responsibilities: { status: 'known', values: ['build', 'test'] }, instructions: { status: 'unresolved' }, contracts: { status: 'unresolved' } },
  });
  assert.deepEqual(workspace.memberOperation({ id: 'api', identity: 'github.com/acme/api', instructionsStatus: 'known', instructions: ' AGENTS.md, docs/rules.md ', contractsStatus: 'known', contracts: ' urn:api:v1, api.json ' }).member.instructions, { status: 'known', locations: ['AGENTS.md', 'docs/rules.md'] });
  assert.deepEqual(workspace.memberOperation({ contractsStatus: 'known', contracts: ' urn:api:v1, api.json ' }).member.contracts, { status: 'known', references: ['urn:api:v1', 'api.json'] });
  assert.deepEqual(workspace.relationshipOperation({ from: ' api ', to: ' ui ', kind: ' consumes-api ', provenanceKind: ' contract ', ref: ' api.json ' }), { type: 'set-relationship', relationship: { from: 'api', to: 'ui', kind: 'consumes-api', provenance: { kind: 'contract', ref: 'api.json' } } });
  assert.deepEqual(workspace.relationshipOperation({ from: 'api', to: 'ui', kind: 'depends-on', provenanceKind: 'owner', ref: ' ' }).relationship.provenance, { kind: 'owner' });
});

test('client workspace endpoints use policy or draft bytes and adopt only writes', async t => {
  const adopted = { ...draft, envelopeBytes: [2] };
  const calls = service(t, ok(projection), ok({ outcome: 'ready' }), ok({ projection, statuses: {} }), ok({ envelopeBytes: [8] }), ok({ draft: adopted, projection }), ok({ draft, projection }), ok({ draft: adopted, projection }), ok(projection));
  const client = createAuthoringClient(); client.publish({ policyBytes: [7], intent: {} });
  await client.readWorkspace(); await client.planBinding({ memberId: 'api', root: '/tmp/api', replaces: 'old' }); await client.verifyWorkspace(); await client.exportWorkspace();
  assert.equal(client.draft, undefined);
  await client.editWorkspace({ type: 'declare' });
  assert.deepEqual(client.draft.envelopeBytes, Uint8Array.of(2));
  const confirmation = { observationSha256: 'digest', reasons: ['moved'] };
  await client.bindCheckout({ memberId: 'api', root: '/tmp/api', replaces: 'old', confirmation });
  await client.unbindCheckout('binding-one'); await client.readWorkspace();
  assert.deepEqual(calls.map(c => c.url), ['read', 'plan', 'verify', 'export', 'edit', 'bind', 'unbind', 'read'].map(op => `/api/authoring-workspace-${op}`));
  for (const call of calls.slice(0, 5)) { assert.deepEqual(call.body.bytes, [7]); assert.equal(call.body.policyBytes, undefined); }
  assert.deepEqual(calls[1].body, { reviewEvidence: [], bytes: [7], memberId: 'api', root: '/tmp/api', replaces: 'old' });
  assert.deepEqual(calls[5].body, { reviewEvidence: [], envelopeBytes: [2], memberId: 'api', root: '/tmp/api', replaces: 'old', confirmation });
  assert.deepEqual(calls[6].body, { reviewEvidence: [], envelopeBytes: [1], bindingId: 'binding-one' });
  assert.deepEqual(calls[7].body.envelopeBytes, [2]); assert.deepEqual(client.bytes, Uint8Array.of(9));
  const empty = createAuthoringClient();
  for (const call of [() => empty.readWorkspace(), () => empty.planBinding({}), () => empty.verifyWorkspace(), () => empty.exportWorkspace(), () => empty.editWorkspace({}), () => empty.bindCheckout({}), () => empty.unbindCheckout('x')]) assert.equal((await call()).status, 'refused');
});

test('workspace reads and writes are superseded by a later artifact', async t => {
  for (const method of ['readWorkspace', 'planBinding', 'verifyWorkspace', 'exportWorkspace', 'editWorkspace', 'bindCheckout', 'unbindCheckout']) {
    let finish; service(t, new Promise(resolve => { finish = resolve; }));
    const client = createAuthoringClient(); client.publish({ policyBytes: [7], intent: {} });
    const running = client[method]({ memberId: 'api', root: '/tmp/api' }); client.importBytes(Uint8Array.of(8)); finish(ok({ draft, projection }));
    assert.deepEqual(await running, { status: 'superseded' }, method); assert.equal(client.draft, undefined);
  }
});

for (const outcome of ['confirm', 'ready', 'refused']) test(`binding ${outcome} presents only its allowed action`, async () => {
  const plan = { outcome, reasons: outcome === 'confirm' ? reasons : [], observationSha256: 'exact-digest', observed, refusal: { message: 'Unrelated repository' } };
  const { client, calls } = clientFor(plan); const built = view(client); await built.open();
  elements(built.node).find(n => n['aria-label'] === 'Checkout folder for api').value = '/tmp/checkout';
  await find(built, 'Inspect checkout').listeners.click();
  assert.deepEqual(calls[0], { memberId: 'api', root: '/tmp/checkout' });
  if (outcome === 'refused') { assert.match(textOf(built.node), /Unrelated repository/); assert.equal(find(built, 'Bind checkout'), undefined); assert.equal(find(built, 'Confirm and bind'), undefined); return; }
  assert.ok(textOf(built.node).includes('/tmp/checkout'), 'inspection shows the selected checkout root');
  if (outcome === 'confirm') for (const reason of reasons) assert.ok(textOf(built.node).includes(workspace.reasonText(reason)), reason);
  await find(built, outcome === 'confirm' ? 'Confirm and bind' : 'Bind checkout').listeners.click();
  assert.deepEqual(calls[1], { memberId: 'api', root: '/tmp/checkout', ...(outcome === 'confirm' ? { confirmation: { observationSha256: plan.observationSha256, reasons: plan.reasons } } : {}) });
});

test('export downloads exact bytes once and explains exclusions', async () => {
  const downloads = [], { client } = clientFor(); const built = view(client, { download: (...args) => downloads.push(args) }); await built.open();
  await find(built, 'Export for sharing').listeners.click();
  assert.deepEqual(downloads, [[[4, 5], 'workspace.share.json']]);
  assert.match(textOf(built.node), /Local checkout bindings, absolute paths and credentials are not included\./);
});

test('unsupported records are read-only, including version refusals', async () => {
  for (const result of [ok({ ...projection, unsupported: [{ id: 'future', schema: 'urn:aihq:workbench:journey-record:workspace-declaration:2.0.0' }] }), { status: 'refused', diagnostics: [{ code: 'WORKSPACE_VERSION_UNSUPPORTED', message: 'Future record' }] }]) {
    const { client } = clientFor(); client.readWorkspace = async () => result;
    const built = view(client); await built.open();
    assert.match(textOf(built.node), /This workspace uses a record version this Workbench does not support\. It is shown read-only; the original bytes are kept unchanged\./);
    assert.ok(elements(built.node).filter(n => ['button', 'input', 'select'].includes(n.tag)).every(n => n.disabled));
  }
});

test('no artifact explains how to start; pending records are inert and stale results retire', async () => {
  const { client } = clientFor(); client.draft = undefined;
  const built = view(client); assert.match(textOf(built.node), /Open a draft or a saved policy to declare a workspace\./);
  client.draft = draft; await built.open();
  let finish; client.editWorkspace = () => new Promise(resolve => { finish = resolve; });
  const running = find(built, 'Mark relationships complete').listeners.click();
  assert.ok(elements(built.node).filter(n => ['button', 'input', 'select'].includes(n.tag)).every(n => n.disabled));
  client.revision++; built.render(); finish({ status: 'superseded' }); await running;
  assert.equal(find(built, 'Save member'), undefined);
});

test('record URNs and explanations match the browser contract', () => {
  assert.equal(workspace.WORKSPACE_DECLARATION_RECORD_SCHEMA, 'urn:aihq:workbench:journey-record:workspace-declaration:1.0.0');
  assert.equal(workspace.LOCAL_BINDING_RECORD_SCHEMA, 'urn:aihq:workbench:journey-record:local-binding:1.0.0');
  assert.deepEqual(reasons.map(workspace.reasonText), [
    'This member is already bound to another folder; confirm this is an additional checkout (another worktree or clone). If the checkout moved, use Rebind (moved) instead.',
    'This member was bound to a different folder; confirm the checkout moved.',
    "The checkout's remote is a fork: same name under a different owner.",
    "The checkout's repository name only resembles the declared one.",
    'The checkout has remotes for different repositories, or the repository is declared by more than one member.',
    'The checkout has no recognizable remote, so its identity cannot be checked.',
  ]);
  assert.deepEqual(['current', 'changed', 'identity-changed', 'missing', 'declaration-changed', 'unverified'].map(workspace.bindingStatusText), [
    'Verified: matches the recorded checkout',
    'Changed since binding: revision or working state differs — rebind to record it',
    'Remote identity changed — inspect and confirm again',
    'Checkout not found — it may have moved; rebind it',
    'Declaration changed since binding — inspect and rebind',
    'Not verified since opening — select Verify checkouts',
  ]);
});

test('workspace records serialize with maintenance records using the adopted envelope', async t => {
  let finish;
  const calls = service(t, ok(draft), new Promise(resolve => { finish = resolve; }), ok({ envelopeBytes: [3] }));
  const client = createAuthoringClient(); await client.openDraft(Uint8Array.of(1));
  const first = client.editWorkspace({ type: 'declare' });
  const second = client.recordDisposition({ type: 'clear', id: 'old' });
  assert.equal(calls.length, 2);
  finish(ok({ draft: { ...draft, envelopeBytes: [2] }, projection })); await first; await second;
  assert.equal(calls[2].url, '/api/authoring-maintenance-record'); assert.deepEqual(calls[2].body.envelopeBytes, [2]);
  assert.deepEqual(client.draft.envelopeBytes, Uint8Array.of(3));
});

test('binding rows show recorded facts, verify statuses, and moved rebind targets', async () => {
  const binding = { id: 'binding-one', checkout: { root: '/tmp/old' }, observed, verification: { result: 'confirmed', reasons: ['moved'] }, status: 'unverified' };
  const bound = { ...projection, members: [{ ...projection.members[0], bindings: [binding] }] };
  const { client, calls } = clientFor({ outcome: 'confirm', reasons: ['moved'], observationSha256: 'new', observed });
  client.readWorkspace = async () => ok(bound);
  client.verifyWorkspace = async () => ok({ projection: structuredClone(bound), statuses: { 'binding-one': { status: 'changed' } } });
  client.unbindCheckout = async id => { calls.push(id); return ok({ projection }); };
  const built = view(client); await built.open();
  for (const fact of ['/tmp/old', 'aaaaaaaaaaaa', 'main', 'linked', 'clean', 'confirmed', workspace.reasonText('moved'), workspace.bindingStatusText('unverified')]) assert.ok(textOf(built.node).includes(fact), fact);
  await find(built, 'Verify checkouts').listeners.click();
  assert.ok(textOf(built.node).includes(workspace.bindingStatusText('changed')));
  elements(built.node).find(n => n['aria-label'] === 'Checkout folder for api').value = '/tmp/new';
  await find(built, 'Rebind (moved)').listeners.click(); await find(built, 'Confirm and bind').listeners.click();
  assert.deepEqual(calls.slice(0, 2), [{ memberId: 'api', root: '/tmp/new', replaces: 'binding-one' }, { memberId: 'api', root: '/tmp/new', replaces: 'binding-one', confirmation: { observationSha256: 'new', reasons: ['moved'] } }]);
});

test('failed records restore usable forms and report failure; unsupported writes lock them', async () => {
  const statuses = [], { client } = clientFor(); const built = view(client, { showStatus: message => statuses.push(message) }); await built.open();
  client.editWorkspace = async () => { client.revision++; built.render(); throw new Error('offline'); };
  await find(built, 'Save member').listeners.click();
  assert.equal(find(built, 'Save member').disabled, false); assert.ok(statuses.includes('offline'));
  client.editWorkspace = async () => ({ status: 'refused', diagnostics: [{ code: 'WORKSPACE_VERSION_UNSUPPORTED', message: 'Future record' }] });
  await find(built, 'Save member').listeners.click();
  assert.match(textOf(built.node), /shown read-only/); assert.equal(find(built, 'Save member').disabled, true);
});

test('declaration and relationship forms issue owner choices and show incomplete fields', async () => {
  const calls = [], { client } = clientFor(); client.readWorkspace = async () => ok({ ...projection, workspace: null });
  client.editWorkspace = async operation => { calls.push(operation); return ok({ projection }); };
  const built = view(client); await built.open();
  elements(built.node).find(n => n['aria-label'] === 'Workspace label').value = ' Team ';
  await find(built, 'Declare workspace').listeners.click(); assert.deepEqual(calls[0], { type: 'declare', label: 'Team' });
  assert.match(textOf(built.node), /responsibilities: Unresolved/);
  await find(built, 'Mark relationships complete').listeners.click();
  assert.deepEqual(calls[1], { type: 'set-relationship-status', status: 'complete' });
  await find(built, 'Add relationship').listeners.click();
  assert.deepEqual(calls[2], { type: 'set-relationship', relationship: { from: 'api', to: 'api', kind: 'depends-on', provenance: { kind: 'owner' } } });
});

test('a fresh bind or verify status survives later writes; an unsupported declaration offers no declare form', async () => {
  const bound = { id: 'binding-one', checkout: { root: '/tmp/api' }, observed, verification: { result: 'matched', reasons: [] } };
  const withBinding = { ...projection, members: [{ ...projection.members[0], bindings: [bound] }, { ...projection.members[0], id: 'ui', identity: 'github.com/acme/ui' }] };
  const { client } = clientFor({ outcome: 'ready', reasons: [], observed });
  client.bindCheckout = async () => ok({ projection: withBinding, binding: bound });
  client.editWorkspace = async () => ok({ projection: withBinding });
  const built = view(client); await built.open();
  elements(built.node).find(node => node.textContent === '' && node.tag === 'input' && node['aria-label'] === 'Checkout folder for api').value = '/tmp/api';
  await find(built, 'Inspect checkout').listeners.click(); await find(built, 'Bind checkout').listeners.click();
  assert.match(textOf(built.node), /Verified: matches the recorded checkout/);
  await find(built, 'Mark relationships complete').listeners.click();
  assert.match(textOf(built.node), /Verified: matches the recorded checkout/, 'an unrelated write keeps the status this page observed');
  assert.equal(elements(built.node).find(node => node['aria-label'] === 'To member').value, 'ui', 'a relationship defaults to two different members');

  const unsupported = { client: { draft, revision: 1, readWorkspace: async () => ok({ ...projection, workspace: null, members: [], unsupported: [{ id: 'workspace-declaration', schema: 'urn:aihq:workbench:journey-record:workspace-declaration:2.0.0' }] }) } };
  const locked = view(unsupported.client); await locked.open();
  assert.equal(find(locked, 'Declare workspace'), undefined);
  assert.match(textOf(locked.node), /does not support/);
});


test('member aliases are trimmed, empty entries dropped and duplicates removed', () => {
  assert.deepEqual(workspace.memberOperation({ aliases: ' github.com/acme/old, , github.com/acme/api, github.com/acme/old ' }).member.aliases,
    ['github.com/acme/old', 'github.com/acme/api']);
});

test('Edit member fills every field and Save preserves confirmed aliases', async () => {
  const member = { ...projection.members[0], label: 'API', aliases: ['github.com/acme/old', 'github.com/acme/service'],
    responsibilities: { status: 'known', values: ['build', 'test'] },
    instructions: { status: 'known', locations: ['AGENTS.md', 'docs/rules.md'] },
    contracts: { status: 'known', references: ['urn:api:v1', 'api.json'] } };
  const { client } = clientFor(), calls = [];
  client.readWorkspace = async () => ok({ ...projection, members: [member] });
  client.editWorkspace = async operation => { calls.push(operation); return ok({ projection }); };
  const built = view(client); await built.open();
  await find(built, 'Edit member').listeners.click();
  const fields = Object.fromEntries(elements(built.node).filter(n => n['aria-label']).map(n => [n['aria-label'], n.value]));
  assert.equal(fields['Member id'], member.id); assert.equal(fields['Remote identity'], member.identity);
  assert.equal(fields['Member label'], 'API');
  assert.equal(fields['Aliases (comma-separated)'], member.aliases.join(', '));
  for (const [name, key] of Object.entries({ responsibilities: 'values', instructions: 'locations', contracts: 'references' })) {
    assert.equal(fields[`${name} status`], 'known');
    assert.equal(fields[`${name} (comma-separated)`], member[name][key].join(', '));
  }
  await find(built, 'Save member').listeners.click();
  const { bindings, ...expected } = member;
  assert.deepEqual(calls, [{ type: 'set-member', member: expected }]);
});

test('removed member bindings show facts and statuses and can only be removed', async () => {
  const binding = { id: 'detached-one', checkout: { root: '/tmp/removed' }, observed,
    verification: { result: 'confirmed', reasons: ['moved'] }, status: 'missing' };
  const { client } = clientFor(), calls = [];
  client.readWorkspace = async () => ok({ ...projection, detached: [binding] });
  client.unbindCheckout = async id => { calls.push(id); return ok({ projection }); };
  const built = view(client); await built.open();
  for (const fact of ['Bindings for removed members', '/tmp/removed', 'aaaaaaaaaaaa', 'main', 'linked', 'clean', 'confirmed', workspace.reasonText('moved'), workspace.bindingStatusText('missing')])
    assert.ok(textOf(built.node).includes(fact), fact);
  assert.equal(find(built, 'Rebind (moved)'), undefined);
  await find(built, 'Remove binding').listeners.click();
  assert.deepEqual(calls, ['detached-one']);
  assert.equal(find(built, 'Remove binding'), undefined);
});

test('unsupported local bindings make the workspace read-only but keep sharing enabled', async () => {
  const downloads = [], { client } = clientFor();
  client.readWorkspace = async () => ok({ ...projection, unsupported: [{ id: 'future-binding', schema: 'urn:aihq:workbench:journey-record:local-binding:2.0.0' }] });
  const built = view(client, { download: (...args) => downloads.push(args) }); await built.open();
  assert.ok(textOf(built.node).includes('Some local bindings use a version this Workbench does not support; they are kept unchanged and are never exported. The workspace is read-only here; Export for sharing still works.'));
  assert.equal(find(built, 'Export for sharing').disabled, false);
  // The service refuses workspace writes while a binding version is unsupported, so edits are not offered.
  assert.equal(find(built, 'Save member').disabled, true);
  assert.equal(find(built, 'Verify checkouts').disabled, true);
  await find(built, 'Export for sharing').listeners.click();
  await find(built, 'Export for sharing').listeners.click();
  assert.deepEqual(downloads, [[[4, 5], 'workspace.share.json'], [[4, 5], 'workspace.share.json']], 'exporting stays available after use');
  assert.doesNotMatch(textOf(built.node), /does not support. It is shown read-only/);
});

test('Verify discloses every bound root including removed members before its button', async () => {
  const { client } = clientFor(); const built = view(client); await built.open();
  assert.doesNotMatch(textOf(built.node), /Verify reads local Git metadata in:/);
  client.readWorkspace = async () => ok({ ...projection,
    members: [{ ...projection.members[0], bindings: [{ id: 'one', checkout: { root: '/tmp/one' } }, { id: 'two', checkout: { root: '/tmp/two' } }] }],
    detached: [{ id: 'removed', checkout: { root: '/tmp/removed' } }] });
  await built.open();
  const nodes = elements(built.node);
  const disclosure = nodes.findIndex(n => n.textContent === 'Verify reads local Git metadata in: /tmp/one, /tmp/two, /tmp/removed');
  assert.ok(disclosure >= 0);
  assert.ok(disclosure < nodes.indexOf(find(built, 'Verify checkouts')));
});

test('unsafe export displays its diagnostic in the status line without downloading', async () => {
  const downloads = [], { client } = clientFor();
  const message = 'The declaration contains a local path and cannot be shared.';
  client.exportWorkspace = async () => ({ status: 'refused', diagnostics: [{ code: 'WORKSPACE_EXPORT_UNSAFE', message }] });
  const built = view(client, { download: (...args) => downloads.push(args) }); await built.open();
  await find(built, 'Export for sharing').listeners.click();
  assert.equal(elements(built.node).find(n => n.role === 'status').textContent, message);
  assert.deepEqual(downloads, []);
});

test('the export reports what it left out', () => {
  assert.equal(workspace.exportedText({ bindings: 1, unknownRecords: 0 }), 'Exported for sharing without 1 local binding and 0 records of a kind this Workbench cannot check.');
  assert.equal(workspace.exportedText({ bindings: 3, unknownRecords: 1 }), 'Exported for sharing without 3 local bindings and 1 record of a kind this Workbench cannot check.');
});
