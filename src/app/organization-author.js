import { publishedClients, clientText } from './core-targets.js';
import { toolLabels } from './tool-list.js';
import { fillBoundedOptions } from './bounded-options.js';
import { recoverOrganizationSession, saveOrganizationSession } from './draft-session.js';

// These helpers translate author input and server results; policy decisions belong to the server.
export function parseSelectors(text) {
  const values = text.split(',').map(value => value.trim()).filter(Boolean);
  return values.length ? values : null;
}
export function parsePermission(kind, text) {
  if (kind === 'fixed') return { fixed: text };
  if (kind === 'choices') return { choices: parseSelectors(text) ?? [] };
  return kind === 'allowDeclared' ? { allowDeclared: true } : null;
}
export const enforcementText = value => ({ enforced: 'Enforced', advisory: 'Advisory' })[value] ?? '';
export const targetLabel = (target, labels = {}) => [target.scope, target.client && clientText(labels, target.client), target.repository].filter(Boolean).join(' · ');
export const unresolvedLines = rows => (rows ?? []).map(row => `${row.path ?? row.entryId ?? 'Draft'}: ${row.message}`);
export const handoffText = handoff => [handoff.repository, handoff.path, handoff.ref].join(' · ');
const diagnosticsText = rows => (rows ?? []).map(row => `${row.code ?? row.path ?? 'Diagnostic'}${row.reason ? ` / ${row.reason}` : ''}: ${row.message}`).join('\n');
export function previewSectionText(section, value) {
  if (section === 'enforced') return `Admitted: ${String(value?.admitted ?? 'unknown')}\n${diagnosticsText(value?.diagnostics)}`;
  return (value ?? []).map(row => {
    const label = row.label ?? row.itemId ?? row.id ?? '';
    if (section === 'unsupported') return row.message ?? `${label}: ${row.status ?? ''}`;
    if (section === 'selection') return `${label} · ${row.scope} · ${row.origin === 'dependency' ? `dependency of ${(row.requiredBy ?? []).join(', ')}` : 'authored'}`;
    // Core's status verbatim: an undeclared fact keeps a requirement unknown, never fulfilled.
    if (section === 'fulfillment' || section === 'advisory') return `${label}: ${row.status} (${row.applicability}${row.unknown?.length ? `; undeclared ${row.unknown.join(', ')}` : ''})`;
    if (section === 'contradictions') return `${label}: ${row.message ?? row.reason ?? ''}${row.requiredBy?.length ? ` (required by ${row.requiredBy.join(', ')})` : ''}`;
    return `${label}: ${JSON.stringify(row)}`;
  }).join('\n') || 'None reported.';
}

// Drain accepted edit requests before replacement; a failed Open keeps their latest result.
export function createOrganizationSession(client) {
  let value, artifact = 0, replacement = 0, revision = 0, queue = Promise.resolve(), dirty = false, recoveryAvailable, replacing = false, pendingEdits = 0;
  const checkpoint = () => { if (value) recoveryAvailable = saveOrganizationSession(value.envelopeBytes, dirty); };
  const request = (op, body) => client.request(op, { ...body, policyBytes: undefined, reviewEvidence: undefined });
  const superseded = () => ({ status: 'superseded' });
  return {
    get value() { return value; },
    get dirty() { return dirty; }, get recoveryAvailable() { return recoveryAvailable; },
    get replacing() { return replacing; },
    get pendingEdits() { return pendingEdits; },
    markDownloaded() { dirty = false; checkpoint(); },
    async replace(op, body = {}, { recoveredDirty } = {}) {
      const attempt = ++replacement; revision++;
      replacing = true;
      try {
        // New edits are locked, while edits already queued finish against their original artifact.
        await queue;
        if (attempt !== replacement) return superseded();
        artifact++; queue = Promise.resolve();
        // A file read may finish after another New/Open; reserve its artifact before reading.
        const input = typeof body === 'function' ? await body() : body;
        if (attempt !== replacement) return superseded();
        const result = await request(op, input);
        if (attempt !== replacement) return superseded();
        if (result.status === 'ok') { value = result.value; dirty = recoveredDirty ?? (op === 'organization-new'); checkpoint(); }
        return result;
      } finally { if (attempt === replacement) replacing = false; }
    },
    edit(operation) {
      if (replacing) return Promise.resolve({ status: 'refused', diagnostics: [{ code: 'REPLACEMENT_PENDING', message: 'Wait for New or Open to finish before editing this draft.' }] });
      const attempt = artifact; revision++; pendingEdits++;
      const task = queue.then(async () => {
        if (attempt !== artifact) return superseded();
        if (!value) throw new Error('Create or open an organization draft first.');
        const result = await request('organization-edit', { envelopeBytes: [...value.envelopeBytes], operation });
        if (attempt !== artifact) return superseded();
        if (result.status === 'ok') { value = result.value; dirty = true; checkpoint(); }
        return result;
      }).finally(() => { pendingEdits--; });
      queue = task.catch(() => {}); return task;
    },
    async read(op) {
      if (replacing) return { status: 'refused', diagnostics: [{ code: 'REPLACEMENT_PENDING', message: 'Wait for New or Open to finish before reading this draft.' }] };
      const attempt = artifact, version = revision; await queue;
      if (attempt !== artifact || version !== revision) return superseded();
      if (!value) throw new Error('Create or open an organization draft first.');
      const result = await request(op, { envelopeBytes: [...value.envelopeBytes] });
      return attempt === artifact && version === revision ? result : superseded();
    },
    async savedBytes() {
      if (replacing) throw new Error('Wait for New or Open to finish before downloading this draft.');
      const attempt = artifact; await queue;
      if (attempt !== artifact) throw new Error('Draft changed while saving. Save again.');
      if (!value) throw new Error('Create or open an organization draft first.');
      return value.envelopeBytes;
    },
  };
}

export function createOrganizationAuthorView({ client, el, button, showStatus }) {
  const node = el('details', 'p-3 border border-wb-border rounded bg-surface-container-low space-y-2'); node.id = 'organization-author';
  const session = createOrganizationSession(client);
  const canReplace = () => !session.replacing && (!(session.dirty || session.pendingEdits) || window.confirm('This organization draft has changes that have not been downloaded or edits still being saved into the draft. Replace the current draft?'));
  window.addEventListener('beforeunload', event => { if (session.dirty || session.pendingEdits) { event.preventDefault(); event.returnValue = ''; } });
  const status = el('p', 'text-on-surface-variant'); status.id = 'org-status'; status.setAttribute('role', 'status');
  const report = message => { status.textContent = message; showStatus(message); };
  const safe = action => async () => { try { await action(); } catch (error) { report(error.message); } finally { syncPrerequisites(); } };
  const identify = (control, id) => { control.id = id; return control; };
  const actions = new Map();
  // A busy action is marked aria-disabled, not disabled: disabling the focused control would drop focus before the re-render restores it.
  const action = (label, id, run) => { const control = identify(button(label, safe(async () => { if (control.dataset.busy) return; control.dataset.busy = 'true'; control.setAttribute('aria-disabled', 'true'); control.setAttribute('aria-busy', 'true'); try { await run(); } finally { delete control.dataset.busy; control.removeAttribute('aria-busy'); syncPrerequisites(); } })), id); control.disabled = id !== 'org-draft-new' && !session.value; actions.set(id, control); return control; };
  const fieldClass = 'bg-wb-input text-on-surface border border-wb-border rounded p-1 max-w-full text-[11px]';
  function input(label, id, value = '') {
    const control = identify(el('input', fieldClass), id); control.type = 'text'; control.value = value; control.setAttribute('aria-label', label); return control;
  }
  function select(label, id, options, value = '') {
    const control = identify(el('select', fieldClass), id); control.setAttribute('aria-label', label);
    for (const [key, text] of options) { const option = el('option', '', text); option.value = key; control.append(option); }
    control.value = value; return control;
  }
  const scopes = [['project', 'Project'], ['user', 'User']];
  const block = () => el('div', 'space-y-2 p-2 border border-wb-border rounded');
  const line = () => el('div', 'flex flex-wrap items-center gap-2');
  // The accessible name keeps the visible label text (label in name).
  function labeled(label, control) {
    const name = control.getAttribute('aria-label');
    if (name && !name.toLowerCase().includes(label.toLowerCase())) control.setAttribute('aria-label', `${label}, ${name}`);
    const wrapper = el('label', 'space-y-1'); wrapper.append(el('span', 'text-on-surface-variant', label), control); return wrapper; }
  function download(bytes, name, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([typeof bytes === 'string' ? bytes : Uint8Array.from(bytes)], { type }));
    const link = el('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const preview = identify(block(), 'org-preview-results'), handoff = identify(block(), 'org-handoff');
  const clearResults = () => { preview.replaceChildren(); handoff.replaceChildren(); };
  const failure = result => diagnosticsText(result.diagnostics) || result.error || 'The server refused this request.';
  async function adopt(promise) {
    clearResults(); const result = await promise;
    if (result.status === 'superseded') return;
    renderDraft(); report(result.status === 'ok' ? `Organization draft updated. Save the draft to keep your changes.${result.diagnostics?.length ? `\n${diagnosticsText(result.diagnostics)}` : ''}` : failure(result));
  }
  const edit = operation => adopt(session.edit(operation));
  const open = identify(el('input', fieldClass), 'org-draft-open'); open.type = 'file'; open.setAttribute('aria-label', 'Open organization draft');
  open.addEventListener('change', safe(async () => {
    const file = open.files?.[0]; if (!file) return;
    if (!canReplace()) { open.value = ''; return; }
    if (file.size > 2_000_000) throw new Error('Organization draft exceeds the 2 MB journey envelope limit.');
    const pending = session.replace('organization-open', async () => ({ bytes: [...new Uint8Array(await file.arrayBuffer())] }));
    renderDraft(); await adopt(pending); open.value = '';
  }));
  const draftActions = line(); draftActions.append(action('New draft', 'org-draft-new', async () => {
    if (!canReplace()) return;
    const pending = session.replace('organization-new'); renderDraft(); await adopt(pending);
  }), labeled('Open draft', open), action('Download draft', 'org-draft-save', async () => { download(await session.savedBytes(), 'organization-draft.journey.json'); session.markDownloaded(); report('Organization draft download started. Keep the downloaded file to reopen your choices.'); }));
  const policyId = input('Policy id', 'org-policy-id');
  const policyRow = line(); policyRow.append(labeled('Policy id', policyId), action('Apply policy id', 'org-policy-id-apply', () => edit({ kind: 'set-policy-id', policyId: policyId.value || null })));
  const owner = input('Source owner', 'org-source-owner'), name = input('Source repository name', 'org-source-name'), path = input('Source path', 'org-source-path');
  const refKind = select('Source revision kind', 'org-source-ref-kind', ['branch', 'tag', 'commit'].map(value => [value, value]), 'branch'), ref = input('Source revision', 'org-source-ref');
  const sourceRow = line();
  sourceRow.append(labeled('Owner', owner), labeled('Repository', name), labeled('Path', path), labeled('Revision kind', refKind), labeled('Revision', ref), action('Apply source', 'org-source-apply', () => edit({ kind: 'set-source', source: [owner, name, path, ref].every(control => !control.value) ? null : { provider: 'github', repository: { owner: owner.value, name: name.value }, path: path.value, revision: { kind: refKind.value, value: ref.value } } })));
  const items = select('Catalog item', 'org-add-item', []), scope = select('Entry scope', 'org-add-scope', scopes, 'project');
  const itemSearch = input('Search Catalog items', 'org-item-search'); itemSearch.type = 'search'; itemSearch.placeholder = 'Search Catalog items'; itemSearch.addEventListener('input', renderCatalog);
  const itemMatches = el('p', 'text-on-surface-variant');
  const addRow = line(); addRow.append(labeled('Search', itemSearch),labeled('Catalog item', items), labeled('Scope', scope), action('Add item', 'org-add-entry', () => {
    const slash = items.value.indexOf('/');
    if (slash < 0) throw new Error('Select a Catalog item first.');
    return edit({ kind: 'add-entry', releaseSha256: items.value.slice(0, slash), itemId: items.value.slice(slash + 1), scope: scope.value });
  }));
  addRow.append(itemMatches);
  const entries = block(), targets = block(), unresolved = identify(el('ul', 'space-y-1 text-on-surface-variant'), 'org-unresolved');
  const targetScope = select('Target scope', 'org-target-scope', scopes, 'project'), targetClient = select('Target client', 'org-target-client', [['', 'Not declared']]), repository = input('Target repository', 'org-target-repository');
  const clientStatus = identify(el('p', 'text-on-surface-variant'), 'org-target-client-status'); targetClient.setAttribute('aria-describedby', clientStatus.id);
  // Core's published AI clients (null before the summary arrives): the field offers only these, and Core's preview stays the authority on a client.
  // A client that is also in Core's tool list (src/app/tool-list.js) is named by its label there, as the header and setup name it.
  let coreTargets = null, clients = null, entryClientFields = [], toolListLabels = {};
  const listed = () => clients?.ids ?? [], labels = () => ({ ...(clients?.labels ?? {}), ...toolListLabels });
  const targetRow = line(); targetRow.append(labeled('Scope', targetScope), labeled('Client', targetClient), labeled('Repository', repository), action('Add target', 'org-target-add', () => {
    if (targetClient.value && !listed().includes(targetClient.value)) throw new Error(`AI client "${targetClient.value}" is not one the installed Core lists. Choose a listed client, or leave it not declared.`);
    return edit({ kind: 'add-target', scope: targetScope.value, ...(targetClient.value ? { client: targetClient.value } : {}), ...(repository.value ? { repository: repository.value } : {}) });
  }));
  function renderCatalog() {
    fillBoundedOptions({ select: items, entries: client.catalog?.items ?? [], query: itemSearch.value, label: item => `${item.label ?? item.id} · ${item.id}`, key: item => `${item.root.releaseSha256}/${item.id}`, message: itemMatches });
    syncPrerequisites();
  }
  function syncPrerequisites() {
    node.inert = session.replacing;
    node.setAttribute('aria-busy', String(session.replacing));
    for (const [id, control] of actions) {
      if (control.dataset.busy) continue;
      control.disabled = session.replacing || (id !== 'org-draft-new' && !session.value);
      if (id === 'org-add-entry') control.disabled ||= !items.value;
      control.setAttribute('aria-disabled', String(control.disabled));
    }
    open.disabled = session.replacing;
  }
  items.addEventListener('change', syncPrerequisites);
  client.subscribe?.(renderCatalog); renderCatalog();
  function fillEntryClients(control, selected) {
    control.replaceChildren(); control.disabled = !listed().length;
    // Unknown saved ids remain selected and labelled, but cannot be newly chosen.
    for (const id of [...listed(), ...selected.filter(id => !listed().includes(id))]) {
      const known = listed().includes(id), option = el('option', '', known ? clientText(labels(), id)
        : `${id} (${clients ? 'not known to Core' : 'Core list unavailable; cannot check'})`);
      option.value = id; option.selected = selected.includes(id); option.disabled = !known; control.append(option);
    }
  }
  const selectedClients = control => [...control.options].filter(option => option.selected).map(option => option.value);
  function renderClients() {
    const current = targetClient.value, reason = typeof coreTargets?.reason === 'string' && coreTargets.reason ? coreTargets.reason : 'The installed @aihq/core publishes no supported AI clients.';
    targetClient.replaceChildren();
    for (const [key, text] of [['', 'Not declared'], ...listed().map(id => [id, clientText(labels(), id)])]) { const option = el('option', '', text); option.value = key; targetClient.append(option); }
    for (const control of entryClientFields) fillEntryClients(control, selectedClients(control));
    targetClient.value = listed().includes(current) ? current : ''; targetClient.disabled = !listed().length;
    clientStatus.textContent = coreTargets === null ? 'Core\'s AI client list has not arrived yet. A target can still be declared without a client.'
      : listed().length ? 'These are the AI clients the installed Core lists. Listing a client does not mean it is installed, connected or admitted.'
      : `Core's AI clients are unavailable: ${reason.replace(/\.?$/, '.')} A target can still be declared without a client.`;
  }
  // A declared client the list does not carry stays in the draft as its id; preview and export refuse it with Core's reason.
  function renderTargets() {
    targets.replaceChildren();
    for (const target of session.value?.draft?.targets ?? []) {
      const row = line(), label = targetLabel(target, labels()); row.dataset.targetId = target.id;
      const remove = action(`Remove target ${label}`, `${target.id}-remove`, () => edit({ kind: 'remove-target', targetId: target.id })); remove.dataset.action = 'remove-target'; row.append(el('span', '', label), remove);
      if (target.client && clients && !listed().includes(target.client)) row.append(el('span', 'text-on-surface-variant', 'Not known to the installed Core; preview and export will refuse it.'));
      targets.append(row);
    }
  }
  function renderDraft() {
    const draft = session.value?.draft;
    syncPrerequisites();
    policyId.value = draft?.policyId ?? ''; const source = draft?.source;
    owner.value = source?.repository.owner ?? ''; name.value = source?.repository.name ?? ''; path.value = source?.path ?? ''; refKind.value = source?.revision.kind ?? 'branch'; ref.value = source?.revision.value ?? '';
    // Rebuild rows only after an author action, restoring focus to its corresponding control.
    const focused = node.contains(document.activeElement) ? document.activeElement : null, focusedId = focused?.id ?? '';
    // A removed row takes its control with it: keep the place by focusing the same action on the row now there.
    const focusedRow = focused?.closest('[data-entry-id],[data-target-id]'), focusedList = focusedRow?.parentElement;
    const focusedIndex = focusedRow ? [...focusedList.children].indexOf(focusedRow) : -1, focusedAction = focused?.dataset.action;
    entries.replaceChildren(); entryClientFields = [];
    for (const entry of draft?.entries ?? []) {
      const row = block(); row.dataset.entryId = entry.id;
      row.append(el('h4', 'font-medium', `${entry.label} · ${entry.item.itemId} · ${entry.scope}`));
      if (!entry.available) row.append(el('p', 'text-on-surface-variant', 'Warning: this Catalog item is unavailable.'));
      const obligation = select(`Obligation for ${entry.label}`, `${entry.id}-obligation`, [['', 'Unresolved'], ...['required', 'recommended', 'permitted', 'prohibited'].map(value => [value, value])], entry.obligation ?? ''); obligation.dataset.field = 'obligation';
      obligation.addEventListener('change', safe(() => edit({ kind: 'set-obligation', entryId: entry.id, obligation: obligation.value || null })));
      const badge = el('span', 'border border-wb-border rounded px-1', enforcementText(entry.enforcement)); badge.dataset.field = 'enforcement'; row.append(obligation, badge);
      const clientChoices = select(`Clients for ${entry.label}`, `${entry.id}-clients`, []);
      clientChoices.multiple = true;
      clientChoices.setAttribute('aria-describedby', clientStatus.id);
      fillEntryClients(clientChoices, entry.clients ?? []); entryClientFields.push(clientChoices);
      const repositories = input(`Repositories (comma-separated) for ${entry.label}`, `${entry.id}-repositories`, (entry.repositories ?? []).join(', '));
      clientChoices.dataset.field = 'clients'; repositories.dataset.field = 'repositories';
      const apply = action('Apply selectors', `${entry.id}-selectors`, () => {
        const selected = selectedClients(clientChoices);
        // Leave saved client facts untouched on repository-only edits, including unavailable lists.
        const changed = selected.length !== (entry.clients ?? []).length || selected.some(id => !entry.clients?.includes(id));
        return edit({ kind: 'set-selectors', entryId: entry.id, ...(changed ? { clients: selected.length ? selected : null } : {}), repositories: parseSelectors(repositories.value) });
      }); apply.dataset.action = 'apply-selectors';
      const selectors = line(); selectors.append(labeled('Clients (none selected means any)', clientChoices), labeled('Repositories (comma-separated)', repositories), apply, action('Clear client restriction', `${entry.id}-clients-clear`, () => edit({ kind: 'set-selectors', entryId: entry.id, clients: null }))); row.append(selectors);
      for (const [index, item] of (entry.inputs ?? []).entries()) {
        const inputRow = line(); inputRow.dataset.inputName = item.name;
        const permission = item.permission, kind = permission && ('fixed' in permission ? 'fixed' : 'choices' in permission ? 'choices' : 'allowDeclared');
        const kindControl = select(`Permission for ${entry.label} ${item.name}`, `${entry.id}-input-${index}-kind`, [['', 'Unresolved'], ['fixed', 'Fixed'], ['choices', 'Choices'], ['allowDeclared', 'Allow declared']], kind || ''); kindControl.dataset.field = 'permission-kind';
        const text = permission && ('fixed' in permission ? (typeof permission.fixed === 'string' ? permission.fixed : JSON.stringify(permission.fixed)) : permission.choices?.join(', '));
        const value = input(`Value (choices comma-separated) for ${entry.label} ${item.name}`, `${entry.id}-input-${index}-value`, text ?? ''); value.dataset.field = 'permission-value';
        const applyInput = action('Apply input', `${entry.id}-input-${index}-apply`, () => edit({ kind: 'set-input', entryId: entry.id, name: item.name, permission: parsePermission(kindControl.value, value.value) })); applyInput.dataset.action = 'apply-input';
        inputRow.append(el('span', '', `${item.name}${item.required ? ' (required)' : ''}: ${item.description ?? ''}`), kindControl, labeled('Value (choices comma-separated)', value), applyInput); row.append(inputRow);
      }
      const remove = action(`Remove ${entry.label}`, `${entry.id}-remove`, () => edit({ kind: 'remove-entry', entryId: entry.id })); remove.dataset.action = 'remove-entry'; row.append(remove); entries.append(row);
    }
    renderTargets();
    unresolved.replaceChildren(...unresolvedLines(draft?.unresolved).map(text => el('li', '', text)));
    if (focusedId) {
      const control = [...node.querySelectorAll('[id]')].find(control => control.id === focusedId);
      const rows = focusedList ? [...focusedList.children] : [], near = rows[Math.min(focusedIndex, rows.length - 1)];
      (control ?? (focusedAction && near?.querySelector(`[data-action="${focusedAction}"]`)) ?? node.querySelector(focusedList === targets ? '#org-target-add' : '#org-add-entry'))?.focus();
    }
  }
  async function showPreview() {
    const result = await session.read('organization-preview'); if (result.status === 'superseded') return;
    preview.replaceChildren();
    if (result.status !== 'ok') { preview.append(el('pre', 'whitespace-pre-wrap', failure(result))); report(failure(result)); return; }
    const { candidate, targets: rows } = result.value;
    preview.append(el('p', 'font-medium', `Candidate: ${candidate.status}`), el('pre', 'whitespace-pre-wrap', diagnosticsText(candidate.diagnostics)), ...unresolvedLines(candidate.unresolved).map(text => el('p', '', text)));
    const titles = { selection: 'Example developer selection', enforced: 'Core admission', advisory: 'Core advisory', fulfillment: 'Core fulfillment', contradictions: 'Core contradictions', unsupported: 'Catalog scope support' };
    for (const target of rows) {
      const row = block(); row.dataset.previewTarget = target.target.id;
      row.append(el('h4', 'font-medium', targetLabel(target.target, labels())), el('p', '', target.status), el('pre', 'whitespace-pre-wrap', diagnosticsText(target.diagnostics)));
      for (const [section, title] of Object.entries(titles)) {
        const part = block(); part.dataset.section = section; part.append(el('h5', 'font-medium', title), el('pre', 'whitespace-pre-wrap break-words', previewSectionText(section, target[section]))); row.append(part);
      }
      preview.append(row);
    }
    report(`Core preview returned candidate status: ${candidate.status}.`);
  }
  async function exportCandidate() {
    const result = await session.read('organization-export'); if (result.status === 'superseded') return;
    handoff.replaceChildren();
    if (result.status !== 'ok') { handoff.append(el('pre', 'whitespace-pre-wrap', failure(result))); report(failure(result)); return; }
    const value = result.value, location = value.handoff;
    handoff.append(el('p', 'font-medium', handoffText(location)));
    for (const [field, label] of [['repository', 'Repository'], ['path', 'Path'], ['ref', 'Ref']]) {
      const fact = el('p', 'break-all'); fact.append(el('span', 'text-on-surface-variant', `${label}: `), identify(el('span', 'font-mono', location[field]), `org-handoff-${field}`)); handoff.append(fact);
    }
    for (const [kind, text] of [['git', location.gitSteps], ['pr', location.prSteps]]) {
      handoff.append(identify(el('pre', 'whitespace-pre-wrap break-words', text), `org-handoff-${kind}`), action(`Copy ${kind === 'git' ? 'git' : 'PR'} steps`, `org-handoff-copy-${kind}`, async () => { await navigator.clipboard.writeText(text); report('Steps copied.'); }));
    }
    handoff.append(action('Download candidate', 'org-export-download', () => download(value.candidateBytes, value.fileName)), action('Download explanation', 'org-export-explanation-download', () => download(value.explanation, value.explanationFileName, 'text/plain')), identify(el('p', '', location.activation), 'org-handoff-activation'));
    report(location.activation);
  }
  const resultActions = line(); resultActions.append(action('Preview', 'org-preview', showPreview), action('Export candidate', 'org-export', exportCandidate));
  node.append(el('summary', 'font-medium cursor-pointer', 'Organization baseline (organization author)'), el('p', 'text-on-surface-variant', 'An organization author sets obligations, targets and inputs; preview is computed by Core; exporting writes a candidate file and never publishes or activates authority.'), draftActions, policyRow, sourceRow, addRow, entries, el('h3', 'font-medium', 'Declared targets'), targets, targetRow, clientStatus, el('h3', 'font-medium', 'Unresolved choices'), unresolved, resultActions, preview, handoff, status);
  function setTargets(next) {
    const focusedId = node.contains(document.activeElement) ? document.activeElement.id : '';
    coreTargets = next ?? null; clients = publishedClients(coreTargets); renderClients(); renderTargets();
    // A field the new list disables cannot keep focus; it moves to the row's action, as after a removed row.
    const byId = id => [...node.querySelectorAll('[id]')].find(control => control.id === id), control = focusedId && byId(focusedId);
    if (focusedId) (control && !control.disabled ? control : byId('org-target-add'))?.focus();
  }
  function setToolList(list) { toolListLabels = toolLabels(list); renderClients(); renderTargets(); }
  renderClients(); syncPrerequisites();
  let recoveryChecked = false;
  node.addEventListener('toggle', safe(async () => {
    if (!node.open || recoveryChecked || session.value) return;
    recoveryChecked = true;
    const saved = recoverOrganizationSession();
    if (!saved) return;
    const pending = session.replace('organization-open', { bytes: [...saved.bytes] }, { recoveredDirty: saved.dirty }); renderDraft();
    const result = await pending;
    if (result.status === 'superseded') return;
    renderDraft(); report(result.status === 'ok' ? 'Organization draft recovered from this browser session. Download it to keep a file.' : failure(result));
  }));
  return { node, setTargets, setToolList };
}
