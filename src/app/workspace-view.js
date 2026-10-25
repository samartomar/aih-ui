// Mirrors tools/consumer/workspace-record.mjs, the source of truth; the page cannot import it.
export const WORKSPACE_DECLARATION_RECORD_SCHEMA = 'urn:aihq:workbench:journey-record:workspace-declaration:1.0.0';
export const LOCAL_BINDING_RECORD_SCHEMA = 'urn:aihq:workbench:journey-record:local-binding:1.0.0';
const READ_ONLY = 'This workspace uses a record version this Workbench does not support. It is shown read-only; the original bytes are kept unchanged.';
const LOCAL_BINDINGS_UNSUPPORTED = 'Some local bindings use a version this Workbench does not support; they are kept unchanged and are never exported. The workspace is read-only here; Export for sharing still works.';
const SHARE_NOTE = 'Local checkout bindings, absolute paths and credentials are not included.';
const trim = value => String(value ?? '').trim();
const list = value => trim(value).split(',').map(trim).filter(Boolean);
const FIELDS = { responsibilities: 'values', instructions: 'locations', contracts: 'references' };
export function relationshipSummary(projection) {
  const count = projection?.relationships?.confirmed?.length ?? 0;
  return projection?.relationships?.status === 'complete'
    ? `Relationships: declared complete by the owner (${count} confirmed).`
    : `Relationships: unresolved — ${count} confirmed so far; this map may be incomplete.`;
}
const REASONS = {
  'additional-checkout': 'This member is already bound to another folder; confirm this is an additional checkout (another worktree or clone). If the checkout moved, use Rebind (moved) instead.',
  moved: 'This member was bound to a different folder; confirm the checkout moved.',
  fork: "The checkout's remote is a fork: same name under a different owner.",
  'similar-name': "The checkout's repository name only resembles the declared one.",
  'ambiguous-remote': 'The checkout has remotes for different repositories, or the repository is declared by more than one member.',
  'no-remote': 'The checkout has no recognizable remote, so its identity cannot be checked.',
};
export const reasonText = reason => REASONS[reason] ?? String(reason);
const STATUSES = {
  current: 'Verified: matches the recorded checkout',
  changed: 'Changed since binding: revision or working state differs — rebind to record it',
  'identity-changed': 'Remote identity changed — inspect and confirm again',
  missing: 'Checkout not found — it may have moved; rebind it',
  'declaration-changed': 'Declaration changed since binding — inspect and rebind',
  unverified: 'Not verified since opening — select Verify checkouts',
};
// What the sharing export left out, in words.
export const exportedText = (excluded = {}) => `Exported for sharing without ${excluded.bindings ?? 0} local ${excluded.bindings === 1 ? 'binding' : 'bindings'} and ${excluded.unknownRecords ?? 0} ${excluded.unknownRecords === 1 ? 'record' : 'records'} of a kind this Workbench cannot check.${excluded.batches ? ` ${excluded.batches} reviewed ${excluded.batches === 1 ? 'batch' : 'batches'} stayed local because they hold local folder paths.` : ''}`;
export const bindingStatusText = status => STATUSES[status] ?? STATUSES.unverified;
export function memberOperation(form) {
  const member = { id: trim(form.id), identity: trim(form.identity), aliases: [...new Set(list(form.aliases))], ...(trim(form.label) ? { label: trim(form.label) } : {}) };
  for (const [field, key] of Object.entries(FIELDS)) {
    const values = list(form[field]);
    member[field] = form[`${field}Status`] === 'known' && values.length ? { status: 'known', [key]: values } : { status: 'unresolved' };
  }
  return { type: 'set-member', member };
}
export function relationshipOperation(form) {
  return { type: 'set-relationship', relationship: { from: trim(form.from), to: trim(form.to), kind: trim(form.kind),
    provenance: { kind: trim(form.provenanceKind), ...(trim(form.ref) ? { ref: trim(form.ref) } : {}) } } };
}
function downloadBytes(bytes, name) {
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createWorkspaceView({ client, el, button, showStatus, download = downloadBytes }) {
  const node = el('section', 'p-3 border border-wb-border rounded bg-surface-container-low space-y-2'); node.id = 'policy-repositories';
  const status = el('p', 'text-on-surface-variant'); status.setAttribute('role', 'status');
  const body = el('div', 'space-y-2');
  node.append(el('h3', 'font-medium', 'Workspace'), status, body);
  const refresh = button('Refresh workspace', () => open()); refresh.type = 'button'; node.append(refresh);
  let projection, checked, pending = false, recording = false, attempt = 0, unsupported = false, message = '';
  // Statuses observed in this page session (Verify, or the fresh observation a bind records); writes keep them.
  const folders = new Map(), plans = new Map(), statuses = new Map();
  const safe = action => async () => { try { await action(); } catch (error) { showStatus(error.message); } };
  const diagnostic = result => result?.diagnostics?.map(row => row.message).join(' ') || result?.error || 'The workspace request could not be completed.';
  const isUnsupported = result => result?.diagnostics?.some(row => row.code === 'WORKSPACE_VERSION_UNSUPPORTED');
  const available = () => Boolean(client.draft || client.intent);
  // Unsupported binding records keep the workspace read-only (the service refuses its writes) but never block sharing:
  // the export leaves every binding out.
  const bindingsOnly = () => !unsupported && Boolean(projection?.unsupported?.some(record => record.schema?.includes(':local-binding:')));
  const locked = () => pending || unsupported || bindingsOnly();
  const text = (parent, value) => parent.append(el('p', 'text-on-surface-variant break-words', value));
  const action = (label, handler, blocked = locked) => {
    const control = button(label, safe(async () => { if (!blocked()) await handler(); }));
    control.disabled = blocked(); return control;
  };
  function field(parent, label, options, initial = '') {
    const wrapper = el('label', 'block text-on-surface-variant space-y-1', label);
    const input = el(options ? 'select' : 'input', 'bg-wb-input border border-wb-border rounded p-1');
    if (options) for (const value of options) { const option = el('option', '', value); option.value = value; input.append(option); }
    else input.type = 'text';
    input.value = initial || options?.[0] || ''; input.setAttribute('aria-label', label); input.disabled = locked();
    wrapper.append(input); parent.append(wrapper); return input;
  }
  // Form nodes survive pending renders, keeping typed values when a request fails.
  const declareForm = el('div', 'space-y-1'), memberForm = el('div', 'space-y-1');
  const declarationLabel = field(declareForm, 'Workspace label');
  memberForm.append(el('h4', 'font-medium', 'Add or edit a repository'), el('p', 'text-on-surface-variant', 'Give the repository a short key and its host/owner/name identity. Save it before linking a local checkout.'));
  const memberFields = { id: field(memberForm, 'Repository key (required)'), label: field(memberForm, 'Display name (optional)'), identity: field(memberForm, 'Repository identity (required)') };
  const extraFacts = el('details', 'space-y-1'); extraFacts.append(el('summary', 'text-primary cursor-pointer', 'Aliases and repository knowledge (optional)')); memberForm.append(extraFacts);
  memberFields.aliases = field(extraFacts, 'Confirmed repository aliases (comma-separated)');
  extraFacts.append(el('p', 'text-on-surface-variant', 'Aliases are other repository identities you have confirmed. Keep facts unresolved until you know them; choosing Known records the entries below.'));
  memberFields.id.placeholder = 'api'; memberFields.label.placeholder = 'API service';
  memberFields.identity.placeholder = 'github.com/acme/api';
  const factLabels = { responsibilities: 'What this repository owns', instructions: 'Agent instruction files', contracts: 'Shared interfaces or contracts' };
  for (const name of Object.keys(FIELDS)) {
    const group = el('div', 'space-y-1'); extraFacts.append(group);
    memberFields[`${name}Status`] = field(group, `${factLabels[name]} — knowledge`, ['unresolved', 'known']);
    memberFields[name] = field(group, `${factLabels[name]} (comma-separated)`);
  }
  const values = fields => Object.fromEntries(Object.entries(fields).map(([key, control]) => [key, control.value]));
  function setFormDisabled(form) {
    // This view owns these nodes; no traversal into another component's subtree.
    for (const control of form) control.disabled = locked();
  }
  function retire() { projection = undefined; unsupported = false; plans.clear(); folders.clear(); statuses.clear(); }
  async function request(call, { write = false, receive } = {}) {
    const current = ++attempt, revision = client.revision;
    pending = true; recording = write; message = ''; render();
    let result;
    try { result = await call(); }
    catch (error) { result = { status: 'refused', error: error.message }; }
    if (current !== attempt) return;
    pending = false; recording = false;
    if (!available() || result?.status === 'superseded' || (!write && revision !== client.revision)) { render(); return; }
    checked = client.revision;
    if (isUnsupported(result) && !bindingsOnly()) unsupported = true;
    if (result?.status === 'ok') {
      receive?.(result.value);
      unsupported = unsupported || Boolean(projection?.unsupported?.some(record => record.schema?.includes(':workspace-declaration:')));
      if (write) { plans.clear(); message = 'Workspace choice recorded. Save the draft to keep it.'; showStatus(message); }
    } else { message = diagnostic(result); showStatus(message); }
    render();
  }
  const edit = operation => request(() => client.editWorkspace(operation), { write: true, receive: value => { projection = value.projection; } });
  async function inspect(member, folder, replaces) {
    const input = { memberId: member.id, root: folder.value, ...(replaces ? { replaces } : {}) };
    plans.delete(member.id);
    await request(() => client.planBinding(input), { receive: plan => { plans.set(member.id, { plan, input }); } });
  }
  function observation(parent, observed) {
    if (!observed) return;
    if (observed.root) text(parent, `Checkout: ${observed.root}`);
    text(parent, `Repository: ${observed.repository ?? 'Unresolved'}; revision: ${observed.revision?.slice(0, 12) ?? 'Unborn'}; branch: ${observed.branch ?? 'Detached'}; worktree: ${observed.worktree?.kind ?? 'Unknown'}; ${observed.workingState?.clean ? 'clean' : 'dirty'}`);
    for (const remote of observed.remotes ?? []) text(parent, `Remote ${remote.name}: ${remote.identity ?? 'Unresolved'}`);
  }
  function bindingRow(binding, member, folder) {
    const row = el('div', 'p-2 border border-wb-border rounded space-y-1');
    text(row, binding.checkout?.root ?? binding.root ?? 'Unknown folder'); observation(row, binding.observed);
    text(row, `Result: ${binding.verification?.result ?? 'Unknown'}`);
    for (const reason of binding.verification?.reasons ?? []) text(row, reasonText(reason));
    text(row, bindingStatusText(statuses.get(binding.id) ?? (typeof binding.status === 'string' ? binding.status : binding.status?.status)));
    if (member) row.append(action('Rebind (moved)', () => inspect(member, folder, binding.id)));
    row.append(action('Remove binding', () => request(() => client.unbindCheckout(binding.id), { write: true, receive: value => { projection = value.projection; } })));
    return row;
  }
  function memberCard(member) {
    const card = el('div', 'p-2 border border-wb-border rounded space-y-1');
    card.dataset.memberId = member.id;
    text(card, `${member.id}${member.label ? ` — ${member.label}` : ''}: ${member.identity}`);
    text(card, `Aliases: ${(member.aliases ?? []).join(', ') || 'None confirmed'}`);
    for (const [name, key] of Object.entries(FIELDS)) text(card, `${name}: ${member[name]?.status === 'known' ? `Known: ${member[name][key].join(', ')}` : 'Unresolved'}`);
    card.append(action('Edit member', () => {
      memberFields.id.value = member.id;
      memberFields.identity.value = member.identity;
      memberFields.aliases.value = (member.aliases ?? []).join(', ');
      memberFields.label.value = member.label ?? '';
      for (const [name, key] of Object.entries(FIELDS)) {
        memberFields[`${name}Status`].value = member[name]?.status ?? 'unresolved';
        memberFields[name].value = (member[name]?.[key] ?? []).join(', ');
      }
    }));
    let folder = folders.get(member.id);
    if (!folder) { const holder = el('div'); folder = field(holder, `Checkout folder for ${member.id}`); folders.set(member.id, folder); }
    folder.disabled = locked();
    const label = el('label', 'block text-on-surface-variant', 'Checkout folder'); label.append(folder); card.append(label);
    card.append(action('Inspect checkout', () => inspect(member, folder)));
    for (const binding of member.bindings ?? []) card.append(bindingRow(binding, member, folder));
    const planned = plans.get(member.id);
    if (planned) {
      const { plan, input } = planned;
      observation(card, plan.observed);
      for (const reason of plan.reasons ?? []) text(card, reasonText(reason));
      if (plan.outcome === 'refused') text(card, plan.refusal?.message ?? 'This checkout cannot be bound to this member.');
      else if (plan.outcome === 'ready' || plan.outcome === 'confirm') card.append(action(plan.outcome === 'confirm' ? 'Confirm and bind' : 'Bind checkout', () => {
        const body = { ...input, ...(plan.outcome === 'confirm' ? { confirmation: { observationSha256: plan.observationSha256, reasons: plan.reasons } } : {}) };
        return request(() => client.bindCheckout(body), { write: true, receive: value => { projection = value.projection; if (value.binding) statuses.set(value.binding.id, 'current'); } });
      }));
    }
    return card;
  }
  function render() {
    if (!recording && checked !== undefined && checked !== client.revision) { retire(); message = 'The open policy or its inputs changed; open the workspace again to refresh it.'; }
    body.replaceChildren(); refresh.disabled = pending || unsupported || !available();
    if (!available()) {
      attempt++; pending = false; recording = false; retire(); checked = undefined;
      status.textContent = 'Open a draft or a saved policy to declare a workspace.'; return;
    }
    status.textContent = unsupported ? READ_ONLY : pending ? 'Reading workspace…' : message;
    if (unsupported) text(body, 'WORKSPACE_VERSION_UNSUPPORTED');
    if (!projection) return;
    if (projection.unsupported?.some(record => record.schema?.includes(':local-binding:'))) text(body, LOCAL_BINDINGS_UNSUPPORTED);
    setFormDisabled([declarationLabel, ...Object.values(memberFields)]);
    if (!projection.workspace) {
      if (unsupported) return;
      // Replace only the action: the label input keeps its value.
      declareForm.replaceChildren(declareForm.children[0], action('Declare workspace', () => edit({ type: 'declare', ...(trim(declarationLabel.value) ? { label: trim(declarationLabel.value) } : {}) })));
      body.append(declareForm); return;
    }
    text(body, `${projection.workspace.label ?? projection.workspace.id} — revision ${projection.revision ?? 'Unknown'}`);
    if ((projection.members ?? []).length >= 2) {
      const link = el('a', 'text-primary hover:underline', 'Review cross-repository work as one batch');
      link.id = 'workspace-batch-link'; link.href = '/batch.html';
      body.append(link);
      text(body, "Opens the reviewed-batch page, where the batch's scopes are reviewed and applied together.");
    }
    const saveMember = action('Save member', () => edit(memberOperation(values(memberFields))));
    body.append(memberForm, saveMember);
    if (!(projection.members ?? []).length) text(body, 'No repositories declared. Add your first member above before describing relationships or binding a checkout.');
    for (const member of projection.members ?? []) body.append(memberCard(member));
    if (projection.detached?.length) {
      body.append(el('h4', 'font-medium', 'Bindings for removed members'));
      for (const binding of projection.detached) body.append(bindingRow(binding));
    }
    text(body, relationshipSummary(projection));
    const relationshipForm = el('div', 'space-y-1');
    const memberIds = (projection.members ?? []).map(member => member.id);
    if (memberIds.length < 2) text(body, 'Add at least two repositories to describe a relationship between them. You can leave relationships unresolved.');
    const relationshipFields = {
      from: field(relationshipForm, 'From member', memberIds), to: field(relationshipForm, 'To member', memberIds, memberIds[1]),
      kind: field(relationshipForm, 'Relationship kind', ['depends-on', 'consumes-api', 'deploys', 'shares-contract']),
      provenanceKind: field(relationshipForm, 'Provenance kind', ['owner', 'contract', 'instruction']), ref: field(relationshipForm, 'Provenance reference (optional)'),
    };
    const addRelationship = action('Add relationship', () => edit(relationshipOperation(values(relationshipFields))), () => locked() || memberIds.length < 2 || relationshipFields.from.value === relationshipFields.to.value);
    const updateRelationship = () => { addRelationship.disabled = locked() || memberIds.length < 2 || relationshipFields.from.value === relationshipFields.to.value; addRelationship.title = addRelationship.disabled ? 'Choose two different repositories.' : ''; };
    relationshipFields.from.addEventListener('change', updateRelationship); relationshipFields.to.addEventListener('change', updateRelationship);
    relationshipForm.append(addRelationship);
    if (memberIds.length >= 2) body.append(relationshipForm);
    for (const relationship of projection.relationships?.confirmed ?? []) {
      const row = el('div', 'space-y-1');
      text(row, `${relationship.from} → ${relationship.to}: ${relationship.kind}; ${relationship.provenance?.kind ?? 'Unknown provenance'}${relationship.provenance?.ref ? `: ${relationship.provenance.ref}` : ''}`);
      row.append(action('Remove', () => edit({ type: 'remove-relationship', id: relationship.id }))); body.append(row);
    }
    for (const relationship of projection.relationships?.suggested ?? []) text(body, `Suggested (unconfirmed): ${relationship.from} → ${relationship.to}: ${relationship.kind}; ${relationship.reason}`);
    body.append(action('Mark relationships complete', () => edit({ type: 'set-relationship-status', status: 'complete' })), action('Mark relationships unresolved', () => edit({ type: 'set-relationship-status', status: 'unresolved' })));
    const bindings = [...(projection.members ?? []).flatMap(member => member.bindings ?? []), ...(projection.detached ?? [])];
    const roots = bindings.map(binding => binding.checkout?.root ?? binding.root).filter(Boolean);
    if (roots.length) text(body, `Verify reads local Git metadata in: ${roots.join(', ')}`);
    body.append(action('Verify checkouts', () => request(() => client.verifyWorkspace(), { receive: value => {
      projection = value.projection;
      // The service returns statuses beside the projection; keep its recorded facts and overlay only status.
      for (const binding of [...(projection.members ?? []).flatMap(member => member.bindings ?? []), ...(projection.detached ?? [])]) {
        const status = value.statuses?.[binding.id];
        if (status) statuses.set(binding.id, typeof status === 'string' ? status : status.status);
      }
    } })), action('Export for sharing', () => request(() => client.exportWorkspace(), { receive: value => { download(value.envelopeBytes, 'workspace.share.json'); message = exportedText(value.excluded); showStatus(message); } }), () => pending || unsupported));
    text(body, SHARE_NOTE);
  }
  async function open() {
    attempt++; pending = false; recording = false; retire(); checked = undefined; message = '';
    declarationLabel.value = ''; for (const [key, control] of Object.entries(memberFields)) control.value = key.endsWith('Status') ? 'unresolved' : '';
    if (!available()) return render();
    return request(() => client.readWorkspace(), { receive: value => { projection = value; } });
  }
  render();
  return { node, render, open };
}
