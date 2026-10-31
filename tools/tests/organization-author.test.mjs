import { test } from 'node:test';
import assert from 'node:assert/strict';
// Browser-only recovery and unload controls use the same minimal DOM as these view tests.
globalThis.window = { addEventListener() {}, confirm: () => true };
globalThis.Option = class { constructor(text, value) { this.textContent = text; this.value = value; this.children = []; this.dataset = {}; } };
import { createAuthoringClient } from '../../src/app/authoring-client.js';
import { parsePermission, parseSelectors, enforcementText, targetLabel, previewSectionText, unresolvedLines, handoffText, createOrganizationSession, createOrganizationAuthorView } from '../../src/app/organization-author.js';

const ok = (bytes, draft = {}) => ({ status: 'ok', value: { envelopeBytes: bytes, draft } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('replacement locks edits and downloads until a delayed Open settles and retains prior draft on refusal', async () => {
  const pending = deferred(), calls = [];
  const session = createOrganizationSession({ request: async (op, body) => { calls.push({ op, body }); return op === 'organization-open' ? pending.promise : ok([1], { policyId: 'prior' }); } });
  await session.replace('organization-new');
  const opening = session.replace('organization-open', async () => { await new Promise(resolve => setImmediate(resolve)); return { bytes: [2] }; });
  assert.equal(session.replacing, true);
  assert.equal((await session.edit({ kind: 'set-policy-id', policyId: 'late' })).status, 'refused');
  await assert.rejects(session.savedBytes(), /Wait for New or Open/);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.map(call => call.op), ['organization-new', 'organization-open']);
  pending.resolve({ status: 'refused', diagnostics: [{ message: 'Unreadable file' }] });
  assert.equal((await opening).status, 'refused');
  assert.equal(session.replacing, false); assert.deepEqual(session.value.envelopeBytes, [1]); assert.equal(session.dirty, true);
  await session.edit({ kind: 'set-policy-id', policyId: 'allowed-after-failure' });
  assert.deepEqual(calls.at(-1).body.envelopeBytes, [1]);
});

test('successful replacement cannot be overwritten by edits attempted during New', async () => {
  const pending = deferred(); let creating = false, edits = 0;
  const session = createOrganizationSession({ request: async op => { if (op === 'organization-edit') edits++; return creating ? pending.promise : ok([1]); } });
  await session.replace('organization-new'); creating = true;
  const replacement = session.replace('organization-new');
  assert.equal((await session.edit({ kind: 'set-policy-id', policyId: 'old' })).status, 'refused');
  pending.resolve(ok([2])); await replacement;
  assert.deepEqual(await session.savedBytes(), [2]); assert.equal(edits, 0); assert.equal(session.replacing, false);
});

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

test('New drains in-flight and queued edits, then installs only the exact replacement', async () => {
  const pending = deferred(), calls = [];
  const session = createOrganizationSession({ request: async (op, body) => {
    calls.push({ op, body });
    return calls.length === 1 ? ok([1]) : op === 'organization-edit' ? pending.promise : ok([9]);
  } });
  await session.replace('organization-new');
  const first = session.edit({ kind: 'remove-entry', entryId: 'old' });
  const queued = session.edit({ kind: 'remove-entry', entryId: 'also-old' });
  await new Promise(resolve => setImmediate(resolve));
  const replacing = session.replace('organization-new');
  assert.equal(session.replacing, true); assert.equal(calls.length, 2);
  pending.resolve(ok([2]));
  assert.equal((await first).status, 'ok');
  assert.equal((await queued).status, 'ok');
  await replacing;
  assert.deepEqual(session.value.envelopeBytes, [9]);
  assert.deepEqual(calls.map(call => call.op), ['organization-new', 'organization-edit', 'organization-edit', 'organization-new']);
});

test('a refused Open preserves an edit that was already pending when replacement began', async () => {
  const editResult = deferred(), calls = [];
  const session = createOrganizationSession({ request: async (op, body) => {
    calls.push({ op, body });
    if (op === 'organization-edit') return editResult.promise;
    if (op === 'organization-open') return { status: 'refused', diagnostics: [{ message: 'Invalid replacement' }] };
    return ok([1]);
  } });
  await session.replace('organization-new');
  const editing = session.edit({ kind: 'set-policy-id', policyId: 'keep-my-edit' });
  await new Promise(resolve => setImmediate(resolve));
  const opening = session.replace('organization-open', { bytes: [9] });
  assert.equal(session.replacing, true);
  await assert.rejects(session.savedBytes(), /Wait for New or Open/);
  assert.equal((await session.edit({ kind: 'set-policy-id', policyId: 'blocked' })).status, 'refused');
  assert.deepEqual(calls.map(call => call.op), ['organization-new', 'organization-edit']);
  editResult.resolve(ok([2]));
  assert.equal((await editing).status, 'ok');
  assert.equal((await opening).status, 'refused');
  assert.deepEqual(session.value.envelopeBytes, [2]);
  assert.deepEqual(await session.savedBytes(), [2]);
  assert.equal(session.dirty, true); assert.equal(session.replacing, false);
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
  removeAttribute(name) { delete this[name]; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  get options() { return this.children; }
  closest() { return null; }
  contains(node) { return elements(this).includes(node); }
  querySelectorAll() { return elements(this).filter(node => node.id); }
  focus() { document.activeElement = this; }
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
  assert.equal(find('org-add-item').options[0].value, '');
  assert.equal(find('org-add-item').options[1].value, 'abc/notes');
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
async function mountTargets(t, targets = [], entries = [], onRequest) {
  const previous = globalThis.document; globalThis.document = { activeElement: null };
  t.after(() => { globalThis.document = previous; });
  const calls = [], draft = { entries, targets, unresolved: [] }, statuses = [];
  const client = { request: async (op, body) => { calls.push({ op, body }); return onRequest?.(op, body) ?? ok([1], draft); } };
  const el = (tag, cls, text) => new Node(tag, cls, text), button = (label, handler) => { const node = el('button', '', label); node.listeners.click = handler; return node; };
  const view = createOrganizationAuthorView({ client, el, button, showStatus: message => statuses.push(message) });
  const find = id => elements(view.node).find(control => control.id === id);
  await find('org-draft-new').listeners.click(); calls.length = 0;
  return { view, find, calls, statuses };
}
const published = { state: 'published', targets: ['claude', 'codex', 'zed'], labels: { claude: 'Claude Code', codex: 'Codex' } };
const clientOptions = find => find('org-target-client').options.map(option => [option.value, option.textContent]);

for (const replacementAction of ['New', 'Open']) test(`a clean loaded draft with a pending edit requires confirmation before ${replacementAction}`, async t => {
  const pending = deferred();
  const priorConfirm = window.confirm; t.after(() => { window.confirm = priorConfirm; });
  window.confirm = () => true;
  const { find, calls } = await mountTargets(t, [], [], op => op === 'organization-edit' ? pending.promise : undefined);
  const file = find('org-draft-open'); file.files = [{ size: 1, arrayBuffer: async () => Uint8Array.of(1).buffer }];
  await file.listeners.change(); // A successfully opened draft has no undownloaded changes.
  calls.length = 0;
  const editing = find('org-policy-id-apply').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  let confirmations = 0; window.confirm = message => { confirmations++; assert.match(message, /edits still/); return false; };
  if (replacementAction === 'New') await find('org-draft-new').listeners.click();
  else { file.files = [{ size: 1, arrayBuffer: async () => Uint8Array.of(9).buffer }]; await file.listeners.change(); }
  assert.equal(confirmations, 1);
  assert.deepEqual(calls.map(call => call.op), ['organization-edit'], 'cancelling keeps the pending edit and sends no replacement');
  pending.resolve(ok([2], { entries: [], targets: [], unresolved: [] })); await editing;
  assert.match(find('org-status').textContent, /draft updated/);
});

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

test('a client in Core\'s tool list is named by the tool list\'s label, the name the header and setup use', async t => {
  const { view, find } = await mountTargets(t);
  view.setToolList({ state: 'published', tools: [{ id: 'codex', label: 'Codex CLI' }, { id: 'kiro-ide', label: 'Kiro IDE' }] });
  view.setTargets(published);
  assert.deepEqual(clientOptions(find), [['', 'Not declared'], ['claude', 'Claude Code (claude)'], ['codex', 'Codex CLI (codex)'], ['zed', 'zed']],
    'the offered clients stay Core\'s policy clients; only the name follows the tool list');
  view.setToolList({ state: 'failed', reason: 'x' });
  assert.deepEqual(clientOptions(find)[2], ['codex', 'Codex (codex)']);
});

test('adding a target sends a listed or undeclared client and refuses one outside the list without a request', async t => {
  const { view, find, calls, statuses } = await mountTargets(t);
  view.setTargets(published);
  find('org-target-scope').value = 'user'; find('org-target-client').value = 'codex';
  await find('org-target-add').listeners.click();
  assert.deepEqual(calls.at(-1).body.operation, { kind: 'add-target', scope: 'user', client: 'codex' });
  find('org-target-client').value = ''; await find('org-target-add').listeners.click();
  assert.deepEqual(calls.at(-1).body.operation, { kind: 'add-target', scope: 'user' });
  // A real select cannot hold a value it has no option for; this proves the guard behind it.
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
  assert.match(find('org-target-client-status').textContent, /Core is not installed\. A target/);
  // Core's reason is usually a raw error message without a closing period; it is kept whole.
  view.setTargets({ state: 'unavailable', reason: 'Core not installed' });
  assert.match(find('org-target-client-status').textContent, /: Core not installed\. A target/);
  assert.equal(find('org-target-client')['aria-describedby'], 'org-target-client-status');
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
  const row = id => elements(view.node).find(control => control.dataset.targetId === id);
  assert.match(textOf(row('target-one')), /project · claude/); assert.doesNotMatch(textOf(row('target-one')), /Not listed/);
  assert.doesNotMatch(textOf(row('target-two')), /Not listed/); // no list yet: nothing can be called unlisted
  view.setTargets(published);
  assert.match(textOf(row('target-one')), /project · Claude Code \(claude\)/); assert.doesNotMatch(textOf(row('target-one')), /Not listed/);
  assert.match(textOf(row('target-two')), /user · legacy/);
  assert.match(textOf(row('target-two')), /Not known to the installed Core; preview and export will refuse it\./);
  assert.equal(elements(row('target-one')).find(control => control.id === 'target-one-remove').textContent, 'Remove target project · Claude Code (claude)');
  assert.equal(calls.length, 0); // setTargets only re-renders; it requests nothing
});

test('a list that disables the focused client field moves focus to Add target', async t => {
  const { view, find } = await mountTargets(t);
  view.setTargets(published); find('org-target-client').focus();
  view.setTargets({ ...published, labels: {} });
  assert.equal(document.activeElement, find('org-target-client'));
  view.setTargets({ state: 'unavailable', reason: 'Core not installed' });
  assert.equal(document.activeElement, find('org-target-add'));
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

const savedEntry = clients => ({ id: 'entry-clients', label: 'Notes', item: { itemId: 'notes' }, scope: 'project', available: true, clients, inputs: [] });
test('entry clients offer only published choices, preserve unknown saved ids, and send selected ids', async t => {
  const { view, find, calls } = await mountTargets(t, [], [savedEntry(['codex', 'legacy'])]);
  view.setTargets(published);
  const control = find('entry-clients-clients');
  assert.equal(control.tag, 'select'); assert.equal(control.multiple, true);
  assert.deepEqual(control.options.filter(option => !option.disabled).map(option => option.value), published.targets);
  assert.deepEqual(control.options.filter(option => option.selected).map(option => option.value), ['codex', 'legacy']);
  const unknown = control.options.find(option => option.value === 'legacy');
  assert.equal(unknown.disabled, true); assert.match(unknown.textContent, /not known to Core/i);
  assert.equal(calls.length, 0);
  for (const option of control.options) option.selected = option.value === 'claude' || option.value === 'zed';
  await find('entry-clients-selectors').listeners.click();
  assert.deepEqual(calls.at(-1).body.operation, { kind: 'set-selectors', entryId: 'entry-clients', clients: ['claude', 'zed'], repositories: null });
});
test('entry clients stay visible but unavailable without a published list; repository edits preserve them', async t => {
  const { view, find, calls } = await mountTargets(t, [], [savedEntry(['legacy'])]);
  view.setTargets({ state: 'unavailable', reason: 'Core not installed' });
  const control = find('entry-clients-clients');
  assert.equal(control.tag, 'select'); assert.equal(control.disabled, true);
  assert.deepEqual(control.options.map(option => option.value), ['legacy']);
  assert.match(control.options[0].textContent, /cannot check/i);
  assert.match(textOf(view.node), /Core not installed/);
  find('entry-clients-repositories').value = 'github.com/acme/app';
  await find('entry-clients-selectors').listeners.click();
  assert.deepEqual(calls.at(-1).body.operation, { kind: 'set-selectors', entryId: 'entry-clients', repositories: ['github.com/acme/app'] });
});

test('an author can explicitly clear a saved unknown client restriction even without the Core list', async t => {
  const { find, calls } = await mountTargets(t, [], [savedEntry(['legacy'])]);
  await find('entry-clients-clients-clear').listeners.click();
  assert.deepEqual(calls.at(-1).body.operation, { kind: 'set-selectors', entryId: 'entry-clients', clients: null });
});

test('refreshing the Core list preserves pending entry selectors and repository text', async t => {
  const { view, find } = await mountTargets(t, [], [savedEntry(['codex'])]);
  view.setTargets(published);
  const control = find('entry-clients-clients');
  for (const option of control.options) option.selected = option.value === 'zed';
  find('entry-clients-repositories').value = 'github.com/acme/pending';
  view.setTargets({ ...published, labels: {} });
  assert.deepEqual(find('entry-clients-clients').options.filter(option => option.selected).map(option => option.value), ['zed']);
  assert.equal(find('entry-clients-repositories').value, 'github.com/acme/pending');
});
