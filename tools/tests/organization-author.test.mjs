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
  getAttribute(name) { return this[name] ?? null; }
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

// The target client field follows Core's published list; the server's preview stays the authority on an unknown client.
async function mountTargets(t, targets = []) {
  const previous = globalThis.document; globalThis.document = { activeElement: null };
  t.after(() => { globalThis.document = previous; });
  const calls = [], draft = { entries: [], targets, unresolved: [] }, statuses = [];
  const client = { request: async (op, body) => { calls.push({ op, body }); return ok([1], draft); } };
  const el = (tag, cls, text) => new Node(tag, cls, text), button = (label, handler) => { const node = el('button', '', label); node.listeners.click = handler; return node; };
  const view = createOrganizationAuthorView({ client, el, button, showStatus: message => statuses.push(message) });
  const find = id => elements(view.node).find(control => control.id === id);
  await find('org-draft-new').listeners.click(); calls.length = 0;
  return { view, find, calls, statuses };
}
const published = { state: 'published', targets: ['claude', 'codex', 'zed'], labels: { claude: 'Claude Code', codex: 'Codex' } };
const clientOptions = find => find('org-target-client').options.map(option => [option.value, option.textContent]);

test('target labels render a listed client through its Harness label and keep the old call shape', () => {
  const target = { scope: 'project', client: 'claude', repository: 'host/team/repo' };
  assert.equal(targetLabel(target, { claude: 'Claude Code' }), 'project · Claude Code (claude) · host/team/repo');
  assert.equal(targetLabel(target, {}), 'project · claude · host/team/repo');
  assert.equal(targetLabel({ scope: 'user', client: 'zed' }, { claude: 'Claude Code' }), 'user · zed');
  assert.equal(targetLabel({ scope: 'user' }, { claude: 'Claude Code' }), 'user');
});

test('the target client field offers exactly Core\'s published clients with Harness labels, plus Not declared', async t => {
  const { view, find } = await mountTargets(t);
  assert.deepEqual(clientOptions(find), [['', 'Not declared']]);
  assert.match(find('org-target-client-status').textContent, /not arrived/i);
  view.setTargets(published);
  assert.deepEqual(clientOptions(find), [['', 'Not declared'], ['claude', 'Claude Code (claude)'], ['codex', 'Codex (codex)'], ['zed', 'zed']]);
  assert.equal(find('org-target-client').disabled, false);
  assert.match(find('org-target-client-status').textContent, /clients the installed Core lists/i);
  assert.match(find('org-target-client-status').textContent, /not mean it is installed, connected or admitted/i);
});

test('adding a target sends a listed or undeclared client and refuses one outside the list without a request', async t => {
  const { view, find, calls, statuses } = await mountTargets(t);
  view.setTargets(published);
  find('org-target-scope').value = 'user'; find('org-target-client').value = 'codex';
  await find('org-target-add').listeners.click();
  assert.deepEqual(calls.at(-1).body.operation, { kind: 'add-target', scope: 'user', client: 'codex' });
  find('org-target-client').value = ''; await find('org-target-add').listeners.click();
  assert.deepEqual(calls.at(-1).body.operation, { kind: 'add-target', scope: 'user' });
  calls.length = 0; find('org-target-client').value = 'ghost'; await find('org-target-add').listeners.click();
  assert.equal(calls.length, 0);
  assert.match(find('org-status').textContent, /"ghost".*not.*Core lists/);
  assert.equal(statuses.at(-1), find('org-status').textContent);
});

test('an unavailable or empty Core list leaves the field unavailable with Core\'s reason, never free text', async t => {
  const { view, find, calls } = await mountTargets(t);
  for (const unavailable of [{ state: 'unavailable', reason: 'Core is not installed.' }, { state: 'published', targets: [], labels: {} }, { state: 'unavailable' }]) {
    view.setTargets(unavailable);
    assert.deepEqual(clientOptions(find), [['', 'Not declared']]);
    assert.equal(find('org-target-client').disabled, true);
    assert.match(find('org-target-client-status').textContent, /AI clients are unavailable/);
    assert.match(find('org-target-client-status').textContent, /still be declared without a client/);
  }
  view.setTargets({ state: 'unavailable', reason: 'Core is not installed.' });
  assert.match(find('org-target-client-status').textContent, /Core is not installed\./);
  find('org-target-client').value = 'claude'; await find('org-target-add').listeners.click();
  assert.equal(calls.length, 0);
  find('org-target-client').value = ''; await find('org-target-add').listeners.click();
  assert.deepEqual(calls.at(-1).body.operation, { kind: 'add-target', scope: 'project' });
  view.setTargets(null);
  assert.match(find('org-target-client-status').textContent, /not arrived/i);
});

test('re-sending the list keeps a still-offered selection and drops one Core no longer lists', async t => {
  const { view, find } = await mountTargets(t);
  view.setTargets(published); find('org-target-client').value = 'codex';
  view.setTargets({ ...published, labels: { codex: 'Codex CLI' } });
  assert.equal(find('org-target-client').value, 'codex');
  assert.equal(clientOptions(find).find(([value]) => value === 'codex')[1], 'Codex CLI (codex)');
  view.setTargets({ state: 'published', targets: ['claude'], labels: {} });
  assert.equal(find('org-target-client').value, '');
});

test('declared target rows show a listed client\'s label and keep an unlisted one as its id with a note', async t => {
  const targets = [{ id: 'target-one', scope: 'project', client: 'claude' }, { id: 'target-two', scope: 'user', client: 'legacy' }];
  const { view, find, calls } = await mountTargets(t, targets);
  await find('org-target-add').listeners.click().catch(() => {}); // an edit re-renders the draft's rows
  const rows = () => elements(find('org-target-add').parent ?? view.node).filter(control => control.dataset.targetId);
  const row = id => elements(view.node).find(control => control.dataset.targetId === id);
  assert.match(textOf(row('target-one')), /project · claude/); assert.doesNotMatch(textOf(row('target-one')), /Not listed/);
  assert.doesNotMatch(textOf(row('target-two')), /Not listed/); // no list yet: nothing can be called unlisted
  view.setTargets(published);
  assert.match(textOf(row('target-one')), /project · Claude Code \(claude\)/); assert.doesNotMatch(textOf(row('target-one')), /Not listed/);
  assert.match(textOf(row('target-two')), /user · legacy/);
  assert.match(textOf(row('target-two')), /Not listed by the installed Core; Core decides at preview\./);
  assert.equal(elements(row('target-one')).find(control => control.id === 'target-one-remove').textContent, 'Remove target project · Claude Code (claude)');
  assert.equal(calls.filter(call => call.op === 'organization-edit').length, 1); // only the Add target click above; setTargets requests nothing
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
