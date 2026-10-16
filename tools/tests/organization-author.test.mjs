import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthoringClient } from '../../src/app/authoring-client.js';
import { parsePermission, parseSelectors, enforcementText, targetLabel, previewSectionText, unresolvedLines, handoffText, createOrganizationSession, createOrganizationAuthorView } from '../../src/app/organization-author.js';

const ok = (bytes, draft = {}) => ({ status: 'ok', value: { envelopeBytes: bytes, draft } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('permission and selector text represents author choices without policy evaluation', () => {
  assert.equal(parsePermission('', 'ignored'), null);
  assert.deepEqual(parsePermission('fixed', 'false'), { fixed: 'false' });
  assert.deepEqual(parsePermission('choices', ' one, two , '), { choices: ['one', 'two'] });
  assert.deepEqual(parsePermission('allowDeclared', ''), { allowDeclared: true });
  assert.equal(parseSelectors(' , '), null);
  assert.deepEqual(parseSelectors('one, two'), ['one', 'two']);
});

test('presentation preserves Core outcomes and server explanations', () => {
  assert.equal(enforcementText('enforced'), 'Enforced');
  assert.equal(enforcementText('advisory'), 'Advisory');
  assert.equal(enforcementText(null), '');
  assert.equal(targetLabel({ scope: 'project', client: 'editor', repository: 'host/team/repo' }), 'project · editor · host/team/repo');
  assert.match(previewSectionText('fulfillment', [{ label: 'Notes', status: 'unknown' }]), /Notes: unknown/);
  assert.doesNotMatch(previewSectionText('fulfillment', [{ status: 'unknown' }]), /fulfilled/);
  assert.equal(previewSectionText('fulfillment', [{ label: 'Notes', status: 'unknown', applicability: 'unknown', unknown: ['repository'] }]), 'Notes: unknown (unknown; undeclared repository)');
  assert.equal(previewSectionText('selection', [{ label: 'Code Review', scope: 'project', origin: 'dependency', requiredBy: ['Implement'] }]), 'Code Review · project · dependency of Implement');
  assert.match(previewSectionText('unsupported', [{ message: 'This item cannot use user scope.' }]), /This item cannot use user scope\./);
  assert.deepEqual(unresolvedLines([{ path: '/policyId', message: 'Choose an id.' }]), ['/policyId: Choose an id.']);
  assert.equal(handoffText({ repository: 'owner/name', path: 'policy.json', ref: 'refs/heads/main' }), 'owner/name · policy.json · refs/heads/main');
});

test('requests omit workspace policy and evidence, serialize edits, and use adopted bytes', async t => {
  const calls = [], previous = globalThis.fetch;
  const pending = deferred();
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, body });
    const result = calls.length === 1 ? ok([1]) : calls.length === 2 ? await pending.promise : ok([3]);
    return { ok: true, json: async () => result };
  };
  t.after(() => { globalThis.fetch = previous; });
  const session = createOrganizationSession(createAuthoringClient());
  await session.replace('organization-new');
  const first = session.edit({ kind: 'set-policy-id', policyId: 'one' });
  const second = session.edit({ kind: 'set-policy-id', policyId: 'two' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2);
  pending.resolve(ok([2])); await Promise.all([first, second]);
  assert.deepEqual(calls[2].body.envelopeBytes, [2]);
  assert.ok(calls.every(({ body }) => !('policyBytes' in body) && !('reviewEvidence' in body)));
  assert.deepEqual(session.value.envelopeBytes, [3]);
});

test('New replaces an artifact immediately and discards in-flight and queued old edits', async () => {
  const pending = deferred(), calls = [];
  const session = createOrganizationSession({ request: async (op, body) => {
    calls.push({ op, body });
    return calls.length === 1 ? ok([1]) : op === 'organization-edit' ? pending.promise : ok([9]);
  } });
  await session.replace('organization-new');
  const first = session.edit({ kind: 'remove-entry', entryId: 'old' });
  const queued = session.edit({ kind: 'remove-entry', entryId: 'also-old' });
  await new Promise(resolve => setImmediate(resolve));
  await session.replace('organization-new'); pending.resolve(ok([2]));
  assert.equal((await first).status, 'superseded');
  assert.equal((await queued).status, 'superseded');
  assert.deepEqual(session.value.envelopeBytes, [9]);
  assert.equal(calls.length, 3);
});

test('preview waits for edits and old preview results are discarded after an edit', async () => {
  const pending = deferred();
  const session = createOrganizationSession({ request: async op => op === 'organization-preview' ? pending.promise : ok([1]) });
  await session.replace('organization-new');
  const preview = session.read('organization-preview');
  await new Promise(resolve => setImmediate(resolve));
  await session.edit({ kind: 'set-policy-id', policyId: 'new' });
  pending.resolve({ status: 'ok', value: { candidate: { status: 'valid' } } });
  assert.equal((await preview).status, 'superseded');
});

class Node {
  constructor(tag, cls, text = '') { this.tag = tag; this.className = cls; this.textContent = text; this.children = []; this.dataset = {}; this.listeners = {}; this.value = ''; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  get options() { return this.children; }
  contains(node) { return elements(this).includes(node); }
}
const elements = root => [root, ...root.children.flatMap(elements)];
const textOf = root => elements(root).map(node => node.textContent).join(' ');

test('view renders accessible author controls and all six server preview sections, then export handoff', async t => {
  const previous = globalThis.document; globalThis.document = { activeElement: null };
  t.after(() => { globalThis.document = previous; });
  const calls = [], draft = { policyId: 'baseline', source: null, entries: [{ id: 'entry-one', item: { itemId: 'notes' }, label: 'Notes', scope: 'project', available: false, obligation: 'required', enforcement: 'enforced', inputs: [{ name: 'style', permission: { choices: ['one', 'two'] } }] }], targets: [{ id: 'target-one', scope: 'project' }], unresolved: [{ path: '/source', message: 'Choose a source.' }] };
  const handoff = { repository: 'owner/name', path: 'baseline.json', ref: 'refs/heads/main', gitSteps: 'git add baseline.json', prSteps: 'Open a PR.', activation: 'Exporting does not publish or activate this candidate.' };
  const client = { catalog: { items: [{ id: 'notes', label: 'Notes', root: { releaseSha256: 'abc' } }] }, request: async (op, body) => {
    calls.push({ op, body });
    if (op === 'organization-preview') return { status: 'ok', value: { candidate: { status: 'valid' }, targets: [{ target: draft.targets[0], status: 'ok', enforced: { admitted: true }, fulfillment: [{ label: 'Notes', status: 'unknown' }], unsupported: [{ message: 'User scope is unsupported.' }] }] } };
    if (op === 'organization-export') return { status: 'ok', value: { fileName: 'candidate.json', candidateBytes: [1], explanationFileName: 'why.txt', explanation: 'Explanation', handoff } };
    return ok([1], draft);
  } };
  const el = (tag, cls, text) => new Node(tag, cls, text);
  const button = (label, handler) => { const node = el('button', '', label); node.listeners.click = handler; return node; };
  const { node } = createOrganizationAuthorView({ client, el, button, showStatus() {} });
  const find = id => elements(node).find(control => control.id === id);
  assert.equal(node.id, 'organization-author'); assert.ok(!node.open);
  assert.equal(find('org-status').role, 'status');
  assert.equal(find('org-add-item').options[0].value, 'abc/notes');
  await find('org-draft-new').listeners.click();
  assert.match(textOf(node), /Warning.*unavailable/);
  assert.match(textOf(find('org-unresolved')), /Choose a source/);
  for (const control of elements(node).filter(control => ['input', 'select'].includes(control.tag))) assert.ok(control['aria-label']);
  const obligation = elements(node).find(control => control.dataset.field === 'obligation');
  obligation.value = 'recommended'; await obligation.listeners.change();
  assert.deepEqual(calls.at(-1).body.operation, { kind: 'set-obligation', entryId: 'entry-one', obligation: 'recommended' });
  await find('org-preview').listeners.click();
  const target = elements(node).find(control => control.dataset.previewTarget === 'target-one');
  assert.deepEqual(elements(target).filter(control => control.dataset.section).map(control => control.dataset.section), ['selection', 'enforced', 'advisory', 'fulfillment', 'contradictions', 'unsupported']);
  assert.match(textOf(target), /Notes: unknown/); assert.match(textOf(target), /User scope is unsupported/);
  await find('org-export').listeners.click();
  for (const key of ['repository', 'path', 'ref', 'activation']) assert.equal(find(`org-handoff-${key}`).textContent, handoff[key]);
  assert.equal(find('org-handoff-git').textContent, handoff.gitSteps);
  assert.equal(find('org-handoff-pr').textContent, handoff.prSteps);
  assert.ok(find('org-handoff-copy-git')); assert.ok(find('org-export-download')); assert.ok(find('org-export-explanation-download'));
});

test('a slow Open file read cannot replace a later New draft', async () => {
  const pending = deferred(), calls = [];
  const session = createOrganizationSession({ request: async (op, body) => { calls.push({ op, body }); return ok([9]); } });
  const opened = session.replace('organization-open', () => pending.promise);
  await session.replace('organization-new');
  pending.resolve({ bytes: [1] });
  assert.equal((await opened).status, 'superseded');
  assert.equal(calls.length, 1);
  assert.deepEqual(session.value.envelopeBytes, [9]);
});

test('a failed edit does not poison the queue or replace the last successful envelope', async () => {
  let edits = 0;
  const session = createOrganizationSession({ request: async op => {
    if (op === 'organization-edit' && ++edits === 1) throw new Error('Offline');
    return ok(op === 'organization-edit' ? [2] : [1]);
  } });
  await session.replace('organization-new');
  await assert.rejects(session.edit({ kind: 'set-policy-id', policyId: 'one' }), /Offline/);
  assert.deepEqual(session.value.envelopeBytes, [1]);
  await session.edit({ kind: 'set-policy-id', policyId: 'two' });
  assert.deepEqual(session.value.envelopeBytes, [2]);
});
