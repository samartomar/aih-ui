import { el } from './dom.js';
import { createUpdatesView } from './updates-view.js';
import { createImprovementsView } from './improvements-view.js';
import { createWorkspaceView } from './workspace-view.js';
import { createOrganizationAuthorView } from './organization-author.js';
import { authorityFromResult, changeSummary, compareRevision, reviewFreshness, revisionOf, setupInstructions, sourceRows, staleReviewMessage } from './authority-source.js';
import { isJourneyEnvelope, importLimitError } from './authoring-client.js';
import { dependencyRows } from './dependency-set.js';

const buttonClass = 'px-3 py-1.5 rounded bg-surface-container text-on-surface border border-wb-border hover:bg-surface-container-high';
function button(label, action) {
  const node = el('button', buttonClass, label); node.type = 'button';
  node.addEventListener('click', action); return node;
}
function download(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function failure(result) {
  // Wrapped Catalog/Core refusals carry their specific reasons in details.diagnostics.
  const describe = diagnostic => [`${diagnostic.code ?? 'Input'}: ${diagnostic.message}`, ...(diagnostic.details?.diagnostics ?? []).map(inner => `(${inner.code ?? inner.reason ?? 'detail'}: ${inner.message ?? ''})`)].join(' ');
  return [...(result.diagnostics ?? []), ...(result.value?.diagnostics ?? [])].map(describe).join(' ') || result.error || result.status;
}

const reasonText = { 'source-unavailable': 'source unavailable', 'revision-unavailable': 'revision unavailable' };
const markerClass = 'px-1.5 py-0.5 rounded border font-mono text-[10px]';
const refOf = ({ releaseSha256, itemId, scope }) => ({ releaseSha256, itemId, scope });
// Exact digests stay in the artifact; messages show a short prefix so they read as text.
const readable = text => text.replace(/\b[a-f0-9]{64}\b/g, digest => `${digest.slice(0, 12)}…`);

export function createAuthoringWorkspace(client) {
  const start = document.getElementById('policy-start-description');
  const choices = document.getElementById('policy-choices-description');
  const review = document.getElementById('policy-review-description');
  const controls = el('div', 'flex flex-wrap gap-2'); start.after(controls);
  const roots = el('div', 'space-y-2'); choices.after(roots);
  const proposal = el('div', 'space-y-2'); proposal.id = 'policy-proposal'; proposal.setAttribute('role', 'status'); review.after(proposal);
  const status = el('p', 'text-on-surface-variant'); status.id = 'policy-status'; controls.after(status);
  const file = el('input'); file.type = 'file'; file.accept = 'application/json,.json'; file.id = 'policy-open'; file.setAttribute('aria-label', 'Open saved project policy');
  const accepted = el('div', 'space-y-2'); accepted.id = 'policy-roots'; roots.append(accepted);
  const accept = button('Accept choices with dependencies', () => {
    client.accept();
    showStatus(client.draft ? 'Draft change accepted. Save the draft to keep it; compile a resolved scope to produce an executable policy.' : 'Changes accepted. Review your policy and save the exact artifact.');
  });
  accept.id = 'policy-accept'; accept.disabled = true;
  const save = button('Save project policy', () => download(client.bytes, 'policy.json')); save.id = 'policy-save';
  let original, optional = [], prepared;
  let selectedItem;
  const draftStatus = el('p', 'text-on-surface-variant break-words'); draftStatus.id = 'policy-draft-status'; draftStatus.setAttribute('role', 'status');
  const showStatus = message => { status.textContent = message; if (client.draft) draftStatus.textContent = message; };
  const safe = action => async () => { try { await action(); } catch (error) { showStatus(error.message); } };
  const originalDownload = button('Download original artifact', () => original && download(original, 'policy.original.json'));
  originalDownload.disabled = true;
  const goToPolicy = () => document.getElementById('nav-policy').click();
  for (const id of ['review-project-changes', 'check-project-policy']) {
    const action = document.getElementById(id); action.classList.remove('opacity-50', 'cursor-not-allowed');
  }
  document.getElementById('review-project-changes').replaceChildren(document.createTextNode('Review Changes'));
  document.getElementById('review-project-changes').addEventListener('click', goToPolicy);
  document.getElementById('check-project-policy').addEventListener('click', safe(async () => {
    goToPolicy(); const result = await client.reopen(); diagnostics.textContent = JSON.stringify(result, null, 2);
    if (reopenedDraft(result)) return;
    if (result.status === 'ok' && result.value.editing === 'available') { showStatus('Policy and exact sources validated. This is not organization approval or execution authorization.'); updates.open(); improvements.open(); workspace.open(); }
    else showStatus(failure(result));
  }));
  const copy = document.getElementById('copy-json-btn'), jsonDownload = document.getElementById('download-json-btn');
  for (const action of [copy, jsonDownload]) { action.disabled = false; action.removeAttribute('aria-disabled'); action.classList.remove('cursor-not-allowed'); }
  copy.addEventListener('click', safe(async () => { await navigator.clipboard.writeText(new TextDecoder().decode(client.bytes)); copy.textContent = 'Copied'; }));
  jsonDownload.addEventListener('click', () => download(client.bytes, 'policy.json'));
  const stage = document.getElementById('apply-staging-btn');
  stage.textContent = 'Add to project policy'; stage.title = 'Propose this exact catalog item; review and accept in the project policy workspace.';
  // With a draft open the client routes this through the draft edit, not the policy proposal.
  stage.addEventListener('click', safe(async () => { if (!selectedItem) return; present(await client.propose({ type: 'select', root: selectedItem.root })); goToPolicy(); }));
  const reset = document.getElementById('reset-item-btn'); reset.textContent = 'Remove project choice'; reset.title = 'Review removing this explicit project root; shared required dependencies remain owned by the composition validator.';
  reset.addEventListener('click', safe(async () => {
    const root = (client.draft?.roots ?? client.intent?.roots)?.find(root => root.itemId === selectedItem?.id && root.releaseSha256 === selectedItem?.root.releaseSha256);
    if (root) { present(await client.propose({ type: 'remove-root', root: client.draft ? refOf(root) : root, keep: [] })); goToPolicy(); }
  }));
  controls.append(button('New project policy', safe(async () => {
    original = client.bytes; const result = await client.newDraft();
    if (result.status === 'ok') { showStatus('New project policy has no selected content. Browse Sources & Catalogs to choose content.'); }
    else present(result);
  })), file, button('Validate and reopen', safe(async () => {
    const result = await client.reopen();
    if (reopenedDraft(result)) return;
    if (result.status === 'ok' && result.value.editing === 'available') { optional = result.value.optional ?? []; render(); showStatus('Saved choices recovered from exact source snapshots.'); updates.open(); improvements.open(); workspace.open(); }
    else showStatus(`${failure(result)} Reselect the saved personal folder and its binding in Sources & Catalogs, then validate and reopen again. Original bytes retained.`);
  })), save, originalDownload);
  file.addEventListener('change', safe(async () => {
    const selected = file.files[0]; if (!selected) return;
    const tooLarge = importLimitError(selected.size);
    if (tooLarge) throw new Error(tooLarge);
    const attempt = client.invalidate(), loaded = new Uint8Array(await selected.arrayBuffer());
    if (attempt !== client.revision) return;
    const tooLargePolicy = importLimitError(loaded.length, loaded);
    if (tooLargePolicy) throw new Error(tooLargePolicy);
    original = loaded; client.importBytes(original); file.value = '';
    if (isJourneyEnvelope(loaded)) {
      showStatus('Saved draft envelope loaded. Opening its recorded choices…');
      const result = await client.reopen(); diagnostics.textContent = JSON.stringify(result, null, 2);
      if (!reopenedDraft(result)) showStatus(failure(result));
    } else showStatus('Original bytes retained. Validate and reopen to recover choices. Personal content requires explicit folder rebinding in Sources & Catalogs.');
  }));
  proposal.append(accept);
  const proposed = el('div', 'space-y-1'); proposed.id = 'policy-proposed-choices'; proposal.prepend(proposed);
  const summary = el('p', 'text-outline'); summary.id = 'policy-summary'; roots.prepend(summary);
  const exact = el('details', 'mt-3'); exact.append(el('summary', 'cursor-pointer text-outline', 'Exact policy artifact and diagnostics'));
  const bytes = el('pre', 'whitespace-pre-wrap break-all text-[10px]'); bytes.id = 'policy-bytes'; exact.append(bytes);
  const diagnostics = el('pre', 'whitespace-pre-wrap break-all text-[10px]'); diagnostics.id = 'policy-diagnostics'; exact.append(diagnostics); proposal.after(exact);
  const reconcile = el('div', 'space-y-2'); reconcile.append(button('Review source changes', safe(async () => {
    const result = await client.request('reconcile'); diagnostics.textContent = JSON.stringify(result, null, 2);
    if (result.status !== 'ok') return showStatus(failure(result));
    reconciliation.replaceChildren();
    showStatus(result.value.choices.length ? 'Source changes need explicit choices. Original artifact retained.' : 'Exact sources remain available. No source update proposed.');
    for (const choice of result.value.choices) {
      if (!choice.root) continue;
      const row = el('div', 'border border-wb-border rounded p-2', choice.root.itemId);
      row.append(button('Keep exact revision', () => showStatus('Original exact revision retained. Its source snapshot must remain available.')),
        button(`Remove unavailable ${choice.root.itemId}`, safe(async () => present(await client.propose({ type: 'remove-root', root: choice.root, keep: [] })))));
      for (const target of choice.candidates ?? []) row.append(button(`Review update ${target.itemId}`, safe(async () => {
        const read = await client.request('read');
        if (read.status !== 'ok' || read.value.editing !== 'available') return showStatus(failure(read));
        const intent = structuredClone(read.value.intent);
        intent.roots = intent.roots.map(root => root.itemId === choice.root.itemId && root.releaseSha256 === choice.root.releaseSha256 && root.scope === choice.root.scope ? { ...root, ...target } : root);
        intent.inputs = intent.inputs.filter(input => input.releaseSha256 !== choice.root.releaseSha256);
        present(await client.proposeRequest('compose', { intent }));
      })));
      reconciliation.append(row);
    }
  }))); proposal.after(reconcile);
  const reconciliation = el('div', 'space-y-2'); reconcile.append(reconciliation);
  const host = el('p', 'mt-3 text-outline'); host.id = 'policy-host-status'; reconcile.after(host);
  // Organization authority source: read-only. The source is host configuration, never browser input.
  const source = el('section', 'mt-3 p-3 border border-wb-border rounded space-y-2'); source.id = 'authority-source';
  source.append(el('h3', 'font-medium', 'Organization authority source'));
  const sourceNote = el('p', 'text-on-surface-variant'); source.append(sourceNote);
  const sourceFacts = el('div', 'space-y-1'), factValues = {};
  for (const [id, label] of [['provider', 'Provider'], ['repository', 'Repository'], ['path', 'Path'], ['ref', 'Revision requested'],
    ['commit', 'Resolved commit'], ['blob', 'Blob'], ['digest', 'Content digest'], ['retrieved', 'Retrieved'], ['policy', 'Policy ID']]) {
    const value = el('span', 'font-mono text-[10px] break-all'); value.id = `authority-source-${id}`; factValues[id] = value;
    sourceFacts.append(el('p', 'flex flex-wrap gap-2', ''));
    sourceFacts.lastChild.append(el('span', 'text-outline', `${label}:`), value);
  }
  const sourceChange = el('p', 'text-on-surface-variant break-all'); sourceChange.id = 'authority-source-change'; sourceChange.setAttribute('role', 'status');
  const sourceReview = el('p', 'text-on-surface-variant'); sourceReview.id = 'authority-source-review';
  const sourceDiagnostics = el('p', 'text-on-surface-variant'); sourceDiagnostics.id = 'authority-source-diagnostics';
  const sourceSetup = el('pre', 'whitespace-pre-wrap break-words text-[10px]'); sourceSetup.id = 'authority-source-setup'; sourceSetup.textContent = setupInstructions();
  const sourceCopy = button('Copy setup instructions', safe(async () => { await navigator.clipboard.writeText(setupInstructions()); sourceCopy.textContent = 'Copied'; }));
  sourceCopy.id = 'authority-source-copy';
  const sourceRefresh = button('Refresh', safe(async () => readSource())); sourceRefresh.id = 'authority-source-refresh';
  source.append(sourceFacts, sourceChange, sourceReview, sourceDiagnostics, sourceSetup, sourceCopy, sourceRefresh);
  host.after(source);
  let known, latest, latestAuthority, sourceRead = false, sourceAttempt = 0, sourceState;
  const configuredSource = () => client.catalog?.organizationSource ?? null;
  const dash = '—';
  function renderSource() {
    const configured = client.catalog ? configuredSource() : undefined;
    sourceState = configured === undefined ? undefined : !configured ? 'not-configured' : sourceState === 'refused' ? 'refused' : latest ? 'configured' : 'unread';
    if (sourceState) source.dataset.state = sourceState; else delete source.dataset.state;
    const rows = sourceRows(configured);
    for (const id of ['provider', 'repository', 'path', 'ref']) factValues[id].textContent = rows[id] ?? dash;
    factValues.commit.textContent = latest?.resolvedCommit ?? dash; factValues.blob.textContent = latest?.blobId ?? dash;
    factValues.digest.textContent = latest?.contentDigest ?? dash;
    factValues.retrieved.textContent = latestAuthority?.retrievedAt ?? dash; factValues.policy.textContent = latestAuthority?.policyId ?? dash;
    const none = sourceState === 'not-configured';
    sourceFacts.hidden = sourceChange.hidden = sourceReview.hidden = sourceRefresh.hidden = none || sourceState === undefined;
    sourceSetup.hidden = sourceCopy.hidden = !none;
    sourceNote.textContent = sourceState === undefined ? 'Reading host configuration…'
      : none ? 'No organization authority source is configured by the host. Enterprise policies cannot be admitted until one is.'
      : 'Read-only. The host configures this source; this page can only read it again.';
    // A failed read keeps the last known revision: an established stale review stays stale.
    const freshness = reviewFreshness(prepared?.review, known);
    sourceReview.dataset.review = freshness;
    sourceReview.textContent = freshness === 'stale' ? staleReviewMessage
      : freshness === 'current' ? 'The prepared review matches the current organization policy revision.' : 'No prepared review is bound to an organization policy revision.';
    apply.disabled = !prepared || freshness === 'stale';
  }
  // A successful read (Refresh, Refresh current authority or Prepare) updates the latest known revision.
  function noteAuthority(authority) {
    if (latestAuthority?.retrievedAt > authority.retrievedAt) return;
    const next = revisionOf(authority), change = compareRevision(known, next);
    sourceChange.dataset.change = change; sourceChange.textContent = changeSummary(change, known, next);
    known = next; latest = next; latestAuthority = authority; sourceState = 'configured'; sourceDiagnostics.textContent = '';
  }
  const syncSource = () => { renderSource(); if (client.catalog && configuredSource() && !sourceRead) safe(readSource)(); };
  async function readSource() {
    if (!configuredSource()) return;
    const attempt = ++sourceAttempt; sourceRead = true;
    const result = await client.request('authority-source');
    if (attempt !== sourceAttempt) return;
    if (result.status === 'ok' && revisionOf(result.authority)) noteAuthority(result.authority);
    else {
      latest = undefined; latestAuthority = undefined; sourceState = 'refused'; delete sourceChange.dataset.change; sourceChange.textContent = '';
      sourceDiagnostics.textContent = failure(result);
    }
    renderSource();
  }
  const execution = el('div', 'space-y-2'); source.after(execution);
  const executionStatus = el('p', 'text-on-surface-variant'); executionStatus.setAttribute('role', 'status');
  const executionDiagnostic = el('details'); executionDiagnostic.append(el('summary', 'cursor-pointer text-outline', 'Exact host review and effects'));
  const hostFacts = el('pre', 'whitespace-pre-wrap break-all text-[10px]'); executionDiagnostic.append(hostFacts);
  const presentHost = result => {
    if (result.status === 'superseded') {
      executionStatus.textContent = 'Host response superseded by a newer draft or host request. Prepare again; if Apply was in flight, inspect managed state before retrying.';
      return;
    }
    hostFacts.textContent = JSON.stringify(result, null, 2);
    const preparation = result.preparation ?? result;
    prepared = preparation.status === 'ready' && preparation.sessionId ? preparation : undefined;
    const read = authorityFromResult(result); if (read) noteAuthority(read);
    renderSource();
    executionStatus.textContent = prepared && !apply.disabled ? 'Prepared effects are ready for review. Inspect the exact host review before explicitly approving Apply.'
      : prepared ? staleReviewMessage
      : result.status === 'ok' ? 'Host responded. Inspect authority and effect details; no organization approval is inferred.' : failure(result);
  };
  const authority = button('Refresh current authority', safe(async () => { prepared = undefined; apply.disabled = true; presentHost(await client.requestHost('authority')); }));
  const prepare = button('Prepare exact effects', safe(async () => { prepared = undefined; apply.disabled = true; presentHost(await client.requestHost('prepare')); }));
  const apply = button('Approve and Apply reviewed effects', safe(async () => {
    if (!prepared) return; const approval = prepared; prepared = undefined; apply.disabled = true;
    presentHost(await client.requestHost('apply', { sessionId: approval.sessionId, reviewDigest: approval.review.reviewDigest }));
  })); apply.disabled = true;
  const managedRows = el('div', 'space-y-1');
  const managed = button('Inspect managed selections', safe(async () => {
    prepared = undefined; apply.disabled = true;
    const result = await client.requestHost('managed');
    if (result.status === 'superseded') return presentHost(result);
    hostFacts.textContent = JSON.stringify(result, null, 2); managedRows.replaceChildren();
    for (const selection of result.selections ?? []) managedRows.append(button(`Review removal ${selection.managementId}`, safe(async () => {
      const mode = JSON.parse(new TextDecoder().decode(client.bytes)).mode;
      prepared = undefined; apply.disabled = true;
      presentHost(await client.requestHost('remove', { managementId: selection.managementId, scope: selection.scope, mode }));
    })));
    executionStatus.textContent = result.selections?.length ? 'Choose an installed managed selection to review its removal.' : 'No managed selections returned. See host diagnostics for availability or refusal.';
  }));
  execution.append(authority, prepare, apply, managed, executionStatus, managedRows, executionDiagnostic);

  // The unresolved draft: every recorded choice with its marker, safe edits, a non-executable
  // save and compile of a resolved scope. It owns its DOM and reads only the client.
  const draftSection = el('section', 'p-3 border border-wb-border rounded bg-surface-container-low space-y-2'); draftSection.id = 'policy-draft'; draftSection.hidden = true;
  const draftTitle = el('h3', 'font-semibold text-on-surface');
  const draftNote = el('p', 'text-on-surface-variant'); draftNote.id = 'policy-draft-note';
  const draftRoots = el('div', 'space-y-2'); draftRoots.id = 'policy-draft-roots';
  const draftMissing = el('div', 'space-y-1'); draftMissing.id = 'policy-draft-unresolved';
  const draftChanges = el('p', 'text-outline'); draftChanges.id = 'policy-draft-changes';
  // Saving the envelope first records the last successful check, so a later offline reopen can still show it.
  const draftSave = button('Save unresolved draft', async () => {
    await updates.noteCheck();
    if (client.draft) download(client.draft.envelopeBytes, 'policy.draft.journey.json');
  }); draftSave.id = 'policy-draft-save';
  const draftSaveNote = el('p', 'text-outline', 'Saves a journey envelope that is not executable. It keeps your original policy bytes exactly and every recorded choice, so you can reopen it later.'); draftSaveNote.id = 'policy-draft-save-note';
  const compileNote = el('p', 'text-on-surface-variant break-words'); compileNote.id = 'policy-draft-compile-note';
  const compileScope = async roots => {
    const result = await client.compileDraft(roots); diagnostics.textContent = JSON.stringify(result, null, 2);
    if (result.status === 'superseded') return showStatus('Compile superseded by a newer draft change. Compile again.');
    if (result.status !== 'ok') return showStatus(`Compile refused. ${readable(failure(result))} ${client.compiled ? 'The previously compiled policy remains the current executable policy.' : 'No executable policy was produced; your draft is unchanged.'}`);
    const { scope } = result.value, count = `${scope.length} ${scope.length === 1 ? 'choice' : 'choices'}`;
    showStatus(`Compiled ${count}${client.compiled?.whole ? '' : ' (resolved choices only)'}. This compiled policy is now the current executable policy; the draft envelope is unchanged and can still be saved.`);
  };
  const compileAll = button('Compile whole draft', safe(() => compileScope())); compileAll.id = 'policy-draft-compile-all';
  const compileResolved = button('Compile resolved choices only', safe(() => compileScope(client.draft.roots.filter(root => root.status === 'resolved').map(refOf)))); compileResolved.id = 'policy-draft-compile-resolved';
  const draftActions = el('div', 'flex flex-wrap gap-2'); draftActions.append(draftSave, compileAll, compileResolved);
  draftSection.append(draftTitle, draftNote, draftRoots, draftMissing, draftChanges, draftActions, draftSaveNote, compileNote, draftStatus);
  choices.after(draftSection);
  const updates = createUpdatesView({ client, el, button, showStatus }); draftSection.after(updates.node);
  const improvements = createImprovementsView({ client, el, button, showStatus }); updates.node.after(improvements.node);
  const workspace = createWorkspaceView({ client, el, button, showStatus }); improvements.node.after(workspace.node);
  const organizationAuthor = createOrganizationAuthorView({ client, el, button, showStatus }); workspace.node.after(organizationAuthor.node);
  const itemLabel = ref => client.catalog?.items.find(item => item.id === ref.itemId && item.root.releaseSha256 === ref.releaseSha256)?.label ?? ref.itemId ?? ref.templateId ?? ref.id;
  const blocker = entry => {
    const what = entry.kind === 'root' ? 'its exact source' : entry.kind === 'dependency' ? `required item ${itemLabel(entry.ref)}`
      : entry.kind === 'origin' ? `template origin ${entry.ref.templateId}` : entry.kind === 'exclusion' ? `skip of ${itemLabel(entry.ref)}` : `input ${entry.ref.id}`;
    return `${what}: ${reasonText[entry.reason] ?? entry.reason}`;
  };
  const markers = root => {
    const row = el('p', 'flex flex-wrap gap-1');
    if (root.status === 'resolved') { row.append(el('span', `${markerClass} bg-secondary-container border-secondary/40 text-secondary`, 'Resolved')); return row; }
    // A contradiction is not a missing source: Catalog refused a choice whose content is fully supplied.
    if (root.status === 'refused') { row.append(el('span', `${markerClass} bg-error-container border-error/40 text-error`, 'Refused by Catalog — change or remove this choice')); return row; }
    for (const reason of new Set(root.blockedBy.map(entry => entry.reason))) row.append(el('span', `${markerClass} bg-tertiary-container border-tertiary/40 text-tertiary`,
      reason === 'revision-unavailable' ? 'Unresolved — revision unavailable (no newer revision substituted)' : 'Unresolved — source unavailable'));
    return row;
  };
  function renderDraft() {
    const draft = client.draft;
    draftSection.hidden = !draft;
    if (!draft) return;
    const unresolvedRoots = draft.roots.filter(root => root.status === 'unresolved'), resolvedRoots = draft.roots.filter(root => root.status === 'resolved');
    // An envelope with required records this version cannot interpret is shown but never compiled.
    const compilable = draft.supported !== false;
    draftTitle.textContent = draft.editing === 'unresolved' ? 'Unresolved draft' : 'Saved draft';
    draftNote.textContent = `Draft revision ${draft.projection.revision.sequence} · ${draft.roots.length} recorded ${draft.roots.length === 1 ? 'choice' : 'choices'}, ${unresolvedRoots.length} unresolved. Every original choice is kept exactly as recorded; nothing is dropped and no other revision is substituted. This draft is not an executable policy.`;
    draftRoots.replaceChildren();
    for (const root of draft.roots) {
      const row = el('div', 'p-2 border border-wb-border rounded space-y-1'); row.dataset.status = root.status; row.dataset.itemId = root.itemId;
      const item = client.catalog?.items.find(entry => entry.id === root.itemId && entry.root.releaseSha256 === root.releaseSha256);
      row.append(el('p', 'font-medium', itemLabel(root)), el('p', 'font-mono text-[10px] text-outline', `${item?.family ?? 'Saved source'} · ${root.scope} · ${root.itemId}`), markers(root));
      for (const entry of root.blockedBy ?? []) row.append(el('p', 'text-outline text-[11px]', blocker(entry)));
      if (root.status === 'refused') row.append(el('p', 'text-error text-[11px] break-words', readable(failure({ diagnostics: root.refusal.diagnostics }))));
      const actions = el('div', 'flex flex-wrap items-center gap-2');
      actions.append(button(`Remove ${root.itemId}`, safe(async () => present(await client.propose({ type: 'remove-root', root: refOf(root), keep: [] })))));
      const replacements = (client.catalog?.items ?? []).filter(entry => entry.scopes?.includes(root.scope) && !(entry.id === root.itemId && entry.root.releaseSha256 === root.releaseSha256));
      if (replacements.length) {
        const pick = el('select', 'bg-wb-input border border-wb-border rounded p-1 max-w-full text-[11px]'); pick.setAttribute('aria-label', `Replacement for ${root.itemId}`);
        pick.append(new Option('Choose an available replacement', ''));
        for (const [index, entry] of replacements.entries()) pick.append(new Option(`${entry.label ?? entry.id} · ${entry.family}`, String(index)));
        actions.append(pick, button(`Replace ${root.itemId}`, safe(async () => {
          if (pick.value === '') return showStatus('Choose an available catalog item to replace this choice with.');
          const target = replacements[Number(pick.value)];
          present(await client.propose({ type: 'replace', root: refOf(root), replacement: { releaseSha256: target.root.releaseSha256, itemId: target.id } }));
        })));
      }
      row.append(actions);
      if (root.status !== 'unresolved') {
        const configuration = el('input', 'w-full bg-wb-input border border-wb-border rounded p-1 font-mono text-[10px]'); configuration.value = JSON.stringify(root.configuration); configuration.setAttribute('aria-label', `Configuration for ${root.itemId}`);
        row.append(configuration, button(`Review configuration of ${root.itemId}`, safe(async () => present(await client.propose({ type: 'select', root: { ...refOf(root), configuration: JSON.parse(configuration.value) } })))));
      }
      draftRoots.append(row);
    }
    draftMissing.replaceChildren();
    const requirements = draft.unresolved.filter(entry => entry.kind !== 'root');
    if (requirements.length) draftMissing.append(el('p', 'font-medium', 'Unresolved requirements'));
    for (const entry of requirements) {
      const needed = entry.dependents.map(itemLabel).join(', ');
      draftMissing.append(el('p', 'text-[11px]', `${blocker(entry)}${needed ? ` · needed by ${needed}` : ''}`));
    }
    const changes = draft.changes, what = changes && [['removed', changes.removedRoots], ['added', changes.addedRoots]].filter(([, list]) => list?.length).map(([verb, list]) => `${verb} ${list.map(itemLabel).join(', ')}`).join('; ');
    draftChanges.textContent = changes ? `Last change: ${what || 'no choice added or removed'}.` : '';
    compileNote.textContent = (draft.compile.status === 'available' ? 'Every recorded choice resolves with its dependencies: the whole draft can be compiled.'
      : `The whole draft cannot be compiled yet. ${readable(failure({ diagnostics: draft.compile.reasons }))}`)
      + (compilable && resolvedRoots.length && unresolvedRoots.length ? ` ${resolvedRoots.length} of ${draft.roots.length} choices are resolved and can be compiled on their own; the others stay in the draft.` : '')
      + (!compilable || resolvedRoots.length ? '' : ' No choice is resolved yet, so there is no resolved scope to compile.');
    compileAll.disabled = !compilable; compileResolved.disabled = !compilable || !resolvedRoots.length;
    for (const action of [compileAll, compileResolved]) { action.setAttribute('aria-disabled', String(action.disabled)); action.classList.toggle('opacity-50', action.disabled); action.classList.toggle('cursor-not-allowed', action.disabled); }
  }
  // Returns true when the reopened artifact is a draft and this has described it.
  function reopenedDraft(result) {
    if (result.status !== 'ok' || !client.draft) return false;
    const draft = client.draft, open = draft.roots.filter(root => root.status === 'unresolved').length;
    original = draft.savedIntentBytes.slice(); optional = [];
    updates.open(); improvements.open(); workspace.open();
    render();
    showStatus(draft.editing === 'unresolved'
      ? `Unresolved draft opened: ${draft.roots.length} saved ${draft.roots.length === 1 ? 'choice' : 'choices'} kept, ${open} unresolved. Nothing was dropped and no other revision was substituted. Rebind the saved sources in Sources & Catalogs and validate again, or edit the draft and compile its resolved choices. Availability: ${[...new Set(draft.diagnostics.map(diagnostic => diagnostic.code))].join(', ')}.`
      : draft.compile.status === 'available' ? 'Saved draft reopened: every recorded choice resolves from exact sources. Compile it to produce an executable policy.'
        : `Saved draft reopened. It cannot be compiled yet: ${readable(failure({ diagnostics: draft.compile.reasons }))}`);
    return true;
  }

  function appendDependencySets(roots, inclusions, label) {
    for (const { root, dependencies } of dependencyRows({ roots, inclusions })) {
      const row = el('div', 'space-y-1');
      row.append(el('p', 'font-mono text-[10px]', label(root)));
      for (const { item } of dependencies) {
        const dependency = el('p', 'pl-3 font-mono text-[10px] text-on-surface-variant', `Required dependency: ${item.itemId} · ${item.scope}`);
        dependency.dataset.dependencyOf = root.itemId; row.append(dependency);
      }
      if (!dependencies.length) row.append(el('p', 'pl-3 text-[10px] text-outline', 'No required dependencies.'));
      proposed.append(row);
    }
    proposed.append(el('p', 'text-on-surface-variant', 'Accepting approves each item together with its displayed required dependencies in one step. No separate dependency approval is needed. This does not authorize host execution.'));
  }
  function present(result) {
    diagnostics.textContent = JSON.stringify(result, null, 2);
    if (result.status !== 'ok') { showStatus(failure(result)); return; }
    const value = result.value;
    if (value.optional) optional = value.optional;
    proposed.replaceChildren();
    const candidate = client.candidate;
    if (candidate?.envelopeBytes) {
      const open = candidate.roots.filter(root => root.status === 'unresolved').length;
      proposed.append(el('p', 'font-medium', `Proposed draft revision ${candidate.projection.revision.sequence}: ${candidate.roots.length} explicit choices; ${open} unresolved. Not an executable policy.`));
      appendDependencySets(candidate.roots, candidate.roots.flatMap(root => (root.dependencies ?? []).map(item => ({ root, item }))), root => `${root.itemId} — ${root.status}`);
      showStatus('Review the proposed draft change, then accept. Your current draft is retained until acceptance.');
    } else if (candidate) {
      proposed.append(el('p', 'font-medium', `Proposed policy: ${candidate.intent.roots.length} explicit choices; ${candidate.intent.pins.length} pinned items including dependencies.`));
      appendDependencySets(candidate.intent.roots, candidate.inclusions, root => root.itemId);
      showStatus('Review the proposed choices and dependencies, then accept. Your current saved artifact is retained until acceptance.');
    }
    render();
  }
  function render() {
    const intent = client.intent, draft = client.draft, current = draft ? draft.roots : intent?.roots ?? [];
    accept.disabled = !client.candidate; save.disabled = !client.bytes.length || !intent;
    originalDownload.disabled = !original?.length;
    if (!client.candidate) proposed.replaceChildren();
    bytes.textContent = new TextDecoder().decode(client.bytes);
    document.getElementById('live-json-viewer').textContent = new TextDecoder().decode(client.bytes);
    stage.disabled = !selectedItem || (!intent && !draft); reset.disabled = !current.some(root => root.itemId === selectedItem?.id && root.releaseSha256 === selectedItem?.root.releaseSha256);
    for (const action of [stage, reset]) { action.setAttribute('aria-disabled', String(action.disabled)); action.classList.toggle('opacity-50', action.disabled); action.classList.toggle('cursor-not-allowed', action.disabled); }
    summary.textContent = draft ? (intent
      ? `Current executable policy: compiled from the draft · ${intent.roots.length} explicit choices · ${intent.pins.length} exact pins including dependencies. The draft envelope is kept separately and is not executable.`
      : 'Current artifact: draft (journey envelope, not executable). Your original policy bytes are retained inside it. Compile a resolved scope to produce an executable policy.')
      : intent ? `Current artifact: local project policy · ${intent.roots.length} explicit choices · ${intent.pins.length} exact pins including dependencies. This artifact establishes no organization authority.` : 'Imported artifact awaits exact-source validation. Saving and editing resume after successful reopen.';
    accepted.replaceChildren();
    for (const root of draft ? [] : intent?.roots ?? []) {
      const item = client.catalog?.items.find(item => item.id === root.itemId && item.root.releaseSha256 === root.releaseSha256);
      const row = el('div', 'p-2 border border-wb-border rounded space-y-1');
      row.append(el('p', 'font-medium', item?.label ?? root.itemId), el('p', 'font-mono text-[10px] text-outline', `${item?.family ?? 'Saved source'} · ${root.scope} · ${root.itemId}`));
      const configuration = el('input', 'w-full bg-wb-input border border-wb-border rounded p-1 font-mono text-[10px]'); configuration.value = JSON.stringify(root.configuration); configuration.setAttribute('aria-label', `Configuration for ${root.itemId}`);
      row.append(configuration, button('Review configuration', safe(async () => present(await client.propose({ type: 'select', root: { ...root, configuration: JSON.parse(configuration.value) } })))),
        button(`Remove ${root.itemId}`, safe(async () => present(await client.propose({ type: 'remove-root', root, keep: [] })))));
      accepted.append(row);
    }
    for (const suggestion of draft ? [] : optional) {
      const exclusion = { originId: intent?.origins.find(origin => origin.kind === 'direct')?.id ?? intent?.origins[0]?.id, ...suggestion.to };
      accepted.append(button(`${suggestion.skipped ? 'Clear skip' : 'Skip optional'} ${suggestion.to.itemId}`, safe(async () => present(await client.propose({ type: suggestion.skipped ? 'unskip' : 'skip', exclusion })))));
    }
    renderDraft(); updates.render(); improvements.render(); workspace.render();
    host.textContent = draft && !intent ? 'Prepare and Apply are unavailable: this draft is not an executable policy. Compile a resolved scope first; the compiled policy is then reviewed with the exact host effects.'
      : client.catalog?.executionAvailable
      ? 'Execution host connected. Prepare and Apply require target review; Enterprise also requires current organization authority.'
      : 'Execution is not connected: this preview has no operator-selected project, material roots or controls. Save the policy for a configured CLI host; supported material facts do not establish native execution or automatic guardrails.';
  }
  const binding = document.getElementById('personal-binding');
  syncSource();
  client.subscribe(() => {
    prepared = undefined; apply.disabled = true;
    managedRows.replaceChildren();
    for (const control of [authority, prepare, managed]) control.disabled = !client.catalog?.executionAvailable || !client.intent;
    const selected = binding.value; binding.replaceChildren(new Option('Add new personal content', ''));
    try {
      const inputs = JSON.parse(new TextDecoder().decode(client.bytes)).metadata?.['aih.workbench']?.inputs ?? [];
      for (const input of inputs.filter(input => input.kind === 'local' && input.id?.startsWith('personal-'))) binding.append(new Option(`Rebind saved ${input.id}`, JSON.stringify(input)));
      binding.value = selected && [...binding.options].some(option => option.value === selected) ? selected : binding.options.length === 2 ? binding.options[1].value : '';
    } catch { /* Original malformed bytes stay available for diagnostics. */ }
    render(); syncSource();
  });
  const folder = document.getElementById('personal-folder'), folderResult = document.getElementById('personal-result');
  folder.addEventListener('change', async () => {
    const chosen = [...folder.files]; if (!chosen.length) return;
    const attempt = client.invalidate(), savedBinding = binding.value;
    folder.disabled = true; folderResult.textContent = 'Validating selected files…';
    try {
      if (chosen.length > 256 || chosen.some(file => file.size > 250_000) || chosen.reduce((total, file) => total + file.size, 0) > 1_000_000) throw new Error('Choose up to 256 files, 250 KB each and 1 MB total.');
      const root = chosen[0].webkitRelativePath.split('/')[0], files = [];
      for (const file of chosen) {
        if (!file.webkitRelativePath.startsWith(root + '/')) throw new Error('Select one folder with relative paths.');
        files.push({ path: file.webkitRelativePath.slice(root.length + 1), bytes: [...new Uint8Array(await file.arrayBuffer())] });
      }
      if (attempt !== client.revision) return;
      const result = await client.request('folder', { files, ...(savedBinding ? { rebind: JSON.parse(savedBinding) } : {}) });
      if (attempt !== client.revision) return;
      if (result.status === 'ok') { folderResult.textContent = 'Loading validated personal inventory…'; await client.loadCatalog({ expectedRevision: attempt }); }
      if (attempt !== client.revision) { folderResult.textContent = 'Folder operation superseded by a draft change. Explicitly select the folder again for the current artifact.'; return; }
      folderResult.textContent = result.status === 'ok' ? result.value.message : failure(result);
    } catch (error) { folderResult.textContent = error.message; }
    finally { folder.value = ''; folder.disabled = false; }
  });
  const intake = el('details', 'p-4 border border-wb-border rounded bg-surface-container-lowest space-y-2');
  intake.append(el('summary', 'cursor-pointer font-medium', 'Advanced: import a portable declaration snapshot'));
  intake.append(el('p', 'text-on-surface-variant', 'Choose a JSON snapshot envelope containing portable input identity, declaration bytes and source-file byte arrays. Existing Catalog intake validates every binding; importing grants no filesystem path, execution material root or organization authority.'));
  const snapshot = el('input'); snapshot.type = 'file'; snapshot.accept = '.json,application/json'; snapshot.setAttribute('aria-label', 'Portable declaration snapshot');
  const intakeStatus = el('p', 'text-on-surface-variant'); intakeStatus.setAttribute('role', 'status');
  snapshot.addEventListener('change', async () => {
    const file = snapshot.files[0]; if (!file) return;
    snapshot.disabled = true;
    try {
      if (file.size > 5_000_000) throw new Error('Snapshot exceeds the bounded intake size of 5 MB.');
      const result = await client.request('intake', { snapshot: JSON.parse(await file.text()) });
      if (result.status === 'ok') { await client.loadCatalog(); intakeStatus.textContent = `Validated ${result.value.release.items.length} declared items. Browse their Independent family and exact origins in Sources & Catalogs.`; }
      else intakeStatus.textContent = failure(result);
    } catch (error) { intakeStatus.textContent = error.message; }
    finally { snapshot.disabled = false; snapshot.value = ''; }
  });
  intake.append(snapshot, intakeStatus); document.querySelector('#policy-workspace > .p-4').append(intake);
  // Core's published AI clients reach the views that offer or name a client.
  function setTargets(coreTargets) { improvements.setTargets(coreTargets); organizationAuthor.setTargets(coreTargets); }
  return { present, select(entry) { selectedItem = entry?.authoringItem; render(); }, setTargets };
}
