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
export const targetLabel = target => [target.scope, target.client, target.repository].filter(Boolean).join(' · ');
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

// Queue edits against the last returned envelope. Replacing an artifact invalidates all old work.
export function createOrganizationSession(client) {
  let value, artifact = 0, revision = 0, queue = Promise.resolve();
  const request = (op, body) => client.request(op, { ...body, policyBytes: undefined, reviewEvidence: undefined });
  const superseded = () => ({ status: 'superseded' });
  return {
    get value() { return value; },
    async replace(op, body = {}) {
      const attempt = ++artifact; revision++; value = undefined; queue = Promise.resolve();
      // A file read may finish after another New/Open; reserve its artifact before reading.
      const input = typeof body === 'function' ? await body() : body;
      if (attempt !== artifact) return superseded();
      const result = await request(op, input);
      if (attempt !== artifact) return superseded();
      if (result.status === 'ok') value = result.value;
      return result;
    },
    edit(operation) {
      const attempt = artifact; revision++;
      const task = queue.then(async () => {
        if (attempt !== artifact) return superseded();
        if (!value) throw new Error('Create or open an organization draft first.');
        const result = await request('organization-edit', { envelopeBytes: [...value.envelopeBytes], operation });
        if (attempt !== artifact) return superseded();
        if (result.status === 'ok') value = result.value;
        return result;
      });
      queue = task.catch(() => {}); return task;
    },
    async read(op) {
      const attempt = artifact, version = revision; await queue;
      if (attempt !== artifact || version !== revision) return superseded();
      if (!value) throw new Error('Create or open an organization draft first.');
      const result = await request(op, { envelopeBytes: [...value.envelopeBytes] });
      return attempt === artifact && version === revision ? result : superseded();
    },
    async savedBytes() {
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
  const status = el('p', 'text-on-surface-variant'); status.id = 'org-status'; status.setAttribute('role', 'status');
  const report = message => { status.textContent = message; showStatus(message); };
  const safe = action => async () => { try { await action(); } catch (error) { report(error.message); } };
  const identify = (control, id) => { control.id = id; return control; };
  const action = (label, id, run) => identify(button(label, safe(run)), id);
  const fieldClass = 'bg-wb-input text-on-surface border border-wb-border rounded p-1';
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
    renderDraft(); report(result.status === 'ok' ? 'Organization draft updated. Save the draft to keep your changes.' : failure(result));
  }
  const edit = operation => adopt(session.edit(operation));
  const open = identify(el('input', fieldClass), 'org-draft-open'); open.type = 'file'; open.setAttribute('aria-label', 'Open organization draft');
  open.addEventListener('change', safe(async () => {
    const file = open.files?.[0]; if (!file) return;
    const pending = session.replace('organization-open', async () => ({ bytes: [...new Uint8Array(await file.arrayBuffer())] }));
    renderDraft(); await adopt(pending); open.value = '';
  }));
  const draftActions = line(); draftActions.append(action('New draft', 'org-draft-new', async () => {
    const pending = session.replace('organization-new'); renderDraft(); await adopt(pending);
  }), labeled('Open draft', open), action('Save draft', 'org-draft-save', async () => download(await session.savedBytes(), 'organization-draft.journey.json')));
  const policyId = input('Policy id', 'org-policy-id');
  const policyRow = line(); policyRow.append(labeled('Policy id', policyId), action('Apply policy id', 'org-policy-id-apply', () => edit({ kind: 'set-policy-id', policyId: policyId.value || null })));
  const owner = input('Source owner', 'org-source-owner'), name = input('Source repository name', 'org-source-name'), path = input('Source path', 'org-source-path');
  const refKind = select('Source revision kind', 'org-source-ref-kind', ['branch', 'tag', 'commit'].map(value => [value, value]), 'branch'), ref = input('Source revision', 'org-source-ref');
  const sourceRow = line();
  sourceRow.append(labeled('Owner', owner), labeled('Repository', name), labeled('Path', path), labeled('Revision kind', refKind), labeled('Revision', ref), action('Apply source', 'org-source-apply', () => edit({ kind: 'set-source', source: [owner, name, path, ref].every(control => !control.value) ? null : { provider: 'github', repository: { owner: owner.value, name: name.value }, path: path.value, revision: { kind: refKind.value, value: ref.value } } })));
  const items = select('Catalog item', 'org-add-item', []), scope = select('Entry scope', 'org-add-scope', scopes, 'project');
  const addRow = line(); addRow.append(labeled('Catalog item', items), labeled('Scope', scope), action('Add item', 'org-add-entry', () => {
    const slash = items.value.indexOf('/');
    if (slash < 0) throw new Error('Select a Catalog item first.');
    return edit({ kind: 'add-entry', releaseSha256: items.value.slice(0, slash), itemId: items.value.slice(slash + 1), scope: scope.value });
  }));
  const entries = block(), targets = block(), unresolved = identify(el('ul', 'space-y-1 text-on-surface-variant'), 'org-unresolved');
  const targetScope = select('Target scope', 'org-target-scope', scopes, 'project'), targetClient = input('Target client', 'org-target-client'), repository = input('Target repository', 'org-target-repository');
  const targetRow = line(); targetRow.append(labeled('Scope', targetScope), labeled('Client', targetClient), labeled('Repository', repository), action('Add target', 'org-target-add', () => edit({ kind: 'add-target', scope: targetScope.value, ...(targetClient.value ? { client: targetClient.value } : {}), ...(repository.value ? { repository: repository.value } : {}) })));
  function renderCatalog() {
    const current = items.value; items.replaceChildren();
    for (const item of client.catalog?.items ?? []) { const option = el('option', '', `${item.label ?? item.id} · ${item.id}`); option.value = `${item.root.releaseSha256}/${item.id}`; items.append(option); }
    if ([...items.options].some(option => option.value === current)) items.value = current;
  }
  client.subscribe?.(renderCatalog); renderCatalog();
  function renderDraft() {
    const draft = session.value?.draft;
    policyId.value = draft?.policyId ?? ''; const source = draft?.source;
    owner.value = source?.repository.owner ?? ''; name.value = source?.repository.name ?? ''; path.value = source?.path ?? ''; refKind.value = source?.revision.kind ?? 'branch'; ref.value = source?.revision.value ?? '';
    // Rebuild rows only after an author action, restoring focus to its corresponding control.
    const focused = node.contains(document.activeElement) ? document.activeElement : null, focusedId = focused?.id ?? '';
    // A removed row takes its control with it: keep the place by focusing the same action on the row now there.
    const focusedRow = focused?.closest('[data-entry-id],[data-target-id]'), focusedList = focusedRow?.parentElement;
    const focusedIndex = focusedRow ? [...focusedList.children].indexOf(focusedRow) : -1, focusedAction = focused?.dataset.action;
    entries.replaceChildren();
    for (const entry of draft?.entries ?? []) {
      const row = block(); row.dataset.entryId = entry.id;
      row.append(el('h4', 'font-medium', `${entry.label} · ${entry.item.itemId} · ${entry.scope}`));
      if (!entry.available) row.append(el('p', 'text-on-surface-variant', 'Warning: this Catalog item is unavailable.'));
      const obligation = select(`Obligation for ${entry.label}`, `${entry.id}-obligation`, [['', 'Unresolved'], ...['required', 'recommended', 'permitted', 'prohibited'].map(value => [value, value])], entry.obligation ?? ''); obligation.dataset.field = 'obligation';
      obligation.addEventListener('change', safe(() => edit({ kind: 'set-obligation', entryId: entry.id, obligation: obligation.value || null })));
      const badge = el('span', 'border border-wb-border rounded px-1', enforcementText(entry.enforcement)); badge.dataset.field = 'enforcement'; row.append(obligation, badge);
      const clients = input(`Clients (comma-separated) for ${entry.label}`, `${entry.id}-clients`, (entry.clients ?? []).join(', ')), repositories = input(`Repositories (comma-separated) for ${entry.label}`, `${entry.id}-repositories`, (entry.repositories ?? []).join(', '));
      clients.dataset.field = 'clients'; repositories.dataset.field = 'repositories';
      const apply = action('Apply selectors', `${entry.id}-selectors`, () => edit({ kind: 'set-selectors', entryId: entry.id, clients: parseSelectors(clients.value), repositories: parseSelectors(repositories.value) })); apply.dataset.action = 'apply-selectors';
      const selectors = line(); selectors.append(labeled('Clients (comma-separated)', clients), labeled('Repositories (comma-separated)', repositories), apply); row.append(selectors);
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
    targets.replaceChildren();
    for (const target of draft?.targets ?? []) {
      const row = line(); row.dataset.targetId = target.id;
      const remove = action(`Remove target ${targetLabel(target)}`, `${target.id}-remove`, () => edit({ kind: 'remove-target', targetId: target.id })); remove.dataset.action = 'remove-target'; row.append(el('span', '', targetLabel(target)), remove); targets.append(row);
    }
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
      row.append(el('h4', 'font-medium', targetLabel(target.target)), el('p', '', target.status), el('pre', 'whitespace-pre-wrap', diagnosticsText(target.diagnostics)));
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
  node.append(el('summary', 'font-medium cursor-pointer', 'Organization baseline (organization author)'), el('p', 'text-on-surface-variant', 'An organization author sets obligations, targets and inputs; preview is computed by Core; exporting writes a candidate file and never publishes or activates authority.'), draftActions, policyRow, sourceRow, addRow, entries, el('h3', 'font-medium', 'Declared targets'), targets, targetRow, el('h3', 'font-medium', 'Unresolved choices'), unresolved, resultActions, preview, handoff, status);
  return { node };
}
