import { el } from './dom.js';
import { authorityFromResult, changeSummary, compareRevision, reviewFreshness, revisionOf, setupInstructions, sourceRows, staleReviewMessage } from './authority-source.js';

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
  return [...(result.diagnostics ?? []), ...(result.value?.diagnostics ?? [])].map(diagnostic => `${diagnostic.code ?? 'Input'}: ${diagnostic.message}`).join(' ') || result.error || result.status;
}

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
  const accept = button('Accept proposed changes', () => { client.accept(); showStatus('Changes accepted. Review your policy and save the exact artifact.'); });
  accept.id = 'policy-accept'; accept.disabled = true;
  const save = button('Save project policy', () => download(client.bytes, 'policy.json')); save.id = 'policy-save';
  let original, optional = [], prepared;
  let selectedItem;
  const showStatus = message => { status.textContent = message; };
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
    showStatus(result.status === 'ok' && result.value.editing === 'available' ? 'Policy and exact sources validated. This is not organization approval or execution authorization.' : failure(result));
  }));
  const copy = document.getElementById('copy-json-btn'), jsonDownload = document.getElementById('download-json-btn');
  for (const action of [copy, jsonDownload]) { action.disabled = false; action.removeAttribute('aria-disabled'); action.classList.remove('cursor-not-allowed'); }
  copy.addEventListener('click', safe(async () => { await navigator.clipboard.writeText(new TextDecoder().decode(client.bytes)); copy.textContent = 'Copied'; }));
  jsonDownload.addEventListener('click', () => download(client.bytes, 'policy.json'));
  const stage = document.getElementById('apply-staging-btn');
  stage.textContent = 'Add to project policy'; stage.title = 'Propose this exact catalog item; review and accept in the project policy workspace.';
  stage.addEventListener('click', safe(async () => { if (!selectedItem) return; present(await client.propose({ type: 'select', root: selectedItem.root })); goToPolicy(); }));
  const reset = document.getElementById('reset-item-btn'); reset.textContent = 'Remove project choice'; reset.title = 'Review removing this explicit project root; shared required dependencies remain owned by the composition validator.';
  reset.addEventListener('click', safe(async () => {
    const root = client.intent?.roots.find(root => root.itemId === selectedItem?.id && root.releaseSha256 === selectedItem?.root.releaseSha256);
    if (root) { present(await client.propose({ type: 'remove-root', root, keep: [] })); goToPolicy(); }
  }));
  controls.append(button('New project policy', safe(async () => {
    original = client.bytes; const result = await client.newDraft();
    if (result.status === 'ok') { showStatus('New project policy has no selected content. Browse Sources & Catalogs to choose content.'); }
    else present(result);
  })), file, button('Validate and reopen', safe(async () => {
    const result = await client.reopen();
    if (result.status === 'ok' && result.value.editing === 'available') { optional = result.value.optional ?? []; render(); showStatus('Saved choices recovered from exact source snapshots.'); }
    else showStatus(`${failure(result)} Reselect the saved personal folder and its binding in Sources & Catalogs, then validate and reopen again. Original bytes retained.`);
  })), save, originalDownload);
  file.addEventListener('change', safe(async () => {
    const selected = file.files[0]; if (!selected) return;
    if (selected.size > 1_000_000) throw new Error('Policy exceeds the public byte limit of 1 MB.');
    const attempt = client.invalidate(), loaded = new Uint8Array(await selected.arrayBuffer());
    if (attempt !== client.revision) return;
    original = loaded; client.importBytes(original);
    showStatus('Original bytes retained. Validate and reopen to recover choices. Personal content requires explicit folder rebinding in Sources & Catalogs.'); file.value = '';
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

  function present(result) {
    diagnostics.textContent = JSON.stringify(result, null, 2);
    if (result.status !== 'ok') { showStatus(failure(result)); return; }
    const value = result.value;
    if (value.optional) optional = value.optional;
    proposed.replaceChildren();
    const candidate = client.candidate;
    if (candidate) {
      proposed.append(el('p', 'font-medium', `Proposed policy: ${candidate.intent.roots.length} explicit choices; ${candidate.intent.pins.length} pinned items including dependencies.`));
      for (const root of candidate.intent.roots) proposed.append(el('p', 'font-mono text-[10px]', root.itemId));
      showStatus('Review the proposed choices and dependencies, then accept. Your current saved artifact is retained until acceptance.');
    }
    render();
  }
  function render() {
    const intent = client.intent;
    accept.disabled = !client.candidate; save.disabled = !client.bytes.length || !intent;
    originalDownload.disabled = !original?.length;
    if (!client.candidate) proposed.replaceChildren();
    bytes.textContent = new TextDecoder().decode(client.bytes);
    document.getElementById('live-json-viewer').textContent = new TextDecoder().decode(client.bytes);
    stage.disabled = !selectedItem || !intent; reset.disabled = !intent?.roots.some(root => root.itemId === selectedItem?.id && root.releaseSha256 === selectedItem?.root.releaseSha256);
    for (const action of [stage, reset]) { action.setAttribute('aria-disabled', String(action.disabled)); action.classList.toggle('opacity-50', action.disabled); action.classList.toggle('cursor-not-allowed', action.disabled); }
    summary.textContent = intent ? `Current artifact: local project policy · ${intent.roots.length} explicit choices · ${intent.pins.length} exact pins including dependencies. This artifact establishes no organization authority.` : 'Imported artifact awaits exact-source validation. Saving and editing resume after successful reopen.';
    accepted.replaceChildren();
    for (const root of intent?.roots ?? []) {
      const item = client.catalog?.items.find(item => item.id === root.itemId && item.root.releaseSha256 === root.releaseSha256);
      const row = el('div', 'p-2 border border-wb-border rounded space-y-1');
      row.append(el('p', 'font-medium', item?.label ?? root.itemId), el('p', 'font-mono text-[10px] text-outline', `${item?.family ?? 'Saved source'} · ${root.scope} · ${root.itemId}`));
      const configuration = el('input', 'w-full bg-wb-input border border-wb-border rounded p-1 font-mono text-[10px]'); configuration.value = JSON.stringify(root.configuration); configuration.setAttribute('aria-label', `Configuration for ${root.itemId}`);
      row.append(configuration, button('Review configuration', safe(async () => present(await client.propose({ type: 'select', root: { ...root, configuration: JSON.parse(configuration.value) } })))),
        button(`Remove ${root.itemId}`, safe(async () => present(await client.propose({ type: 'remove-root', root, keep: [] })))));
      accepted.append(row);
    }
    for (const suggestion of optional) {
      const exclusion = { originId: intent?.origins.find(origin => origin.kind === 'direct')?.id ?? intent?.origins[0]?.id, ...suggestion.to };
      accepted.append(button(`${suggestion.skipped ? 'Clear skip' : 'Skip optional'} ${suggestion.to.itemId}`, safe(async () => present(await client.propose({ type: suggestion.skipped ? 'unskip' : 'skip', exclusion })))));
    }
    host.textContent = client.catalog?.executionAvailable
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
  return { present, select(entry) { selectedItem = entry?.authoringItem; render(); } };
}
