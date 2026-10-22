import { policyFile } from './policy-file.js';
import { createConfigurationEditor } from './app/configuration-editor.js';
const $ = id => document.getElementById(id), documentFile = policyFile($('policy'));
const clientHeaders = { 'x-aih-client': crypto.randomUUID() };
const loadCatalog = async () => (await fetch('/api/authoring-catalog', { headers: clientHeaders })).json();
const show = (id, value) => { $(id).textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); };
let catalog, candidate, history, currentIntent, currentOptional = [], currentJudgments = [], revision = 0;
let evidenceBytes, inspected, evidenceFiles = [];
let prepared;
const reviewContext = () => ({ reviewEvidence: evidenceFiles.map(file => [...file.bytes]) });
const invalidate = () => { revision++; candidate = undefined; prepared = undefined; $('accept').disabled = true; $('apply').disabled = true; show('execution', 'Draft or review context changed. Prepare again before Apply.'); show('authority-summary', 'Choices or review context changed. Refresh authority for this draft.'); };
const request = async (operation, body = {}) => (await fetch(`/api/authoring-${operation}`, { method: 'POST', headers: { 'content-type': 'application/json', ...clientHeaders }, body: JSON.stringify({ policyBytes: [...documentFile.bytes()], ...reviewContext(), ...body }) })).json();
const button = (label, action) => { const node = document.createElement('button'); node.textContent = label; node.onclick = action; return node; };
const key = ref => `${ref.releaseSha256}/${ref.itemId}/${ref.scope}`;
const keep = () => $('keep').value.split('\n').filter(v => v.trim()).map(value => { const [releaseSha256, itemId, scope] = value.trim().split('/'); return { releaseSha256, itemId, scope }; });
function download(bytes, filename) { const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); }
function updateFolderBindings() {
  $('folder-binding').replaceChildren();
  const add = document.createElement('option'); add.value = ''; add.textContent = 'Add as new personal content'; $('folder-binding').append(add);
  try {
    const inputs = JSON.parse(documentFile.text()).metadata?.['aih.workbench']?.inputs ?? [];
    for (const input of inputs.filter(input => input.kind === 'local' && input.id?.startsWith('personal-'))) {
      const option = document.createElement('option'); option.value = JSON.stringify(input);
      option.textContent = `Rebind saved ${input.id} · ${input.releaseSha256}`; $('folder-binding').append(option);
    }
    if ($('folder-binding').children.length === 2) $('folder-binding').value = $('folder-binding').children[1].value;
  } catch { /* Invalid imported JSON stays in the editor for ordinary validation. */ }
}
function updateFamilies() {
  const selected = $('family').value; $('family').replaceChildren();
  const all = document.createElement('option'); all.value = ''; all.textContent = 'All families'; $('family').append(all);
  for (const family of [...new Set(catalog.items.map(item => item.family).filter(Boolean))]) {
    const option = document.createElement('option'); option.value = family;
    option.textContent = `${family} (${catalog.items.filter(item => item.family === family).length})`; $('family').append(option);
  }
  $('family').value = [...$('family').children].some(option => option.value === selected) ? selected : '';
}
// Catalog checks the release, but descriptive metadata can have arbitrary JSON.
// Only usable declarations become capability facts; none establish admission.
const declaredCapabilities = item => item.metadata?.discovery?.clientCapabilities;
const nonemptyString = value => typeof value === 'string' && value.trim().length > 0;
const usableCapability = fact => fact !== null && typeof fact === 'object' && !Array.isArray(fact)
  && ['client', 'surface', 'capability'].every(field => nonemptyString(fact[field]))
  && ['supported', 'unsupported', 'unknown'].includes(fact.support)
  && (fact.reason === undefined || nonemptyString(fact.reason))
  && (fact.support !== 'unsupported' || nonemptyString(fact.reason));
const capabilityFacts = item => Array.isArray(declaredCapabilities(item)) ? declaredCapabilities(item).filter(usableCapability) : [];
function targetFacts(item, target) {
  const facts = capabilityFacts(item).filter(fact => fact.client === target);
  const declared = declaredCapabilities(item);
  const unusable = declared !== undefined && (!Array.isArray(declared) || declared.some(fact => !usableCapability(fact)));
  if (unusable) facts.push({ support: 'unknown', capability: 'Unusable declaration', surface: 'Not established',
    reason: 'Unusable capability declarations remain unknown; they establish no client, surface or capability support.' });
  return facts.length ? facts : [{ support: 'unknown', capability: 'Target support', surface: 'Not declared',
    reason: target ? `No capability facts declared for ${target}.` : 'No target capability facts declared in this inventory.' }];
}
function updateTargets() {
  const targets = [...new Set(catalog.items.flatMap(item => capabilityFacts(item).map(fact => fact.client)))].sort();
  const previous = $('target').value;
  $('target').replaceChildren();
  for (const target of targets) {
    const option = document.createElement('option'); option.value = target; option.textContent = target; $('target').append(option);
  }
  if (!targets.length) { const option = document.createElement('option'); option.value = ''; option.textContent = 'No declared targets'; $('target').append(option); }
  $('target').value = targets.includes(previous) ? previous : targets.includes('claude-code') ? 'claude-code' : targets[0] ?? '';
  $('target').disabled = !targets.length;
}
function render(intent = currentIntent, optional = currentOptional) {
  updateTargets();
  $('items').replaceChildren();
  const query = $('search').value.toLowerCase();
  const scoped = catalog.items.filter(item => (!$('family').value || item.family === $('family').value) && `${item.label} ${item.id} ${item.package.name} ${JSON.stringify(item.sources ?? [])}`.toLowerCase().includes(query))
    .map(item => ({ item, facts: targetFacts(item, $('target').value) }));
  const count = status => scoped.filter(({ facts }) => facts.some(fact => fact.support === status)).length;
  show('support-counts', `${$('target').value || 'No declared target'} · ${scoped.length} items in family/search scope: ${count('supported')} with supported facts · ${count('unsupported')} with unsupported facts · ${count('unknown')} with unknown facts.`);
  const items = scoped.filter(({ facts }) => $('support-filter').value === 'all' || facts.some(fact => fact.support === $('support-filter').value));
  show('inventory-count', `${items.length} of ${catalog.items.length} installed items`);
  if (!items.length) show('inventory-count', `0 of ${catalog.items.length} installed items. Choose Full inventory or another support filter to inspect other facts; family and search filters still apply.`);
  for (const { item, facts: supportFacts } of items) {
    const box = document.createElement('fieldset'), title = document.createElement('legend'); title.textContent = `${item.family ?? 'Catalog'} · ${item.label} · ${item.package.name}`; box.append(title);
    const description = document.createElement('p'); description.textContent = item.description ?? ''; box.append(description);
    const supportTitle = document.createElement('p'); supportTitle.textContent = `Capability facts for ${$('target').value || 'undeclared target'}`; box.append(supportTitle);
    const support = document.createElement('ul');
    for (const fact of supportFacts) {
      const row = document.createElement('li');
      row.textContent = `${fact.support} · ${fact.capability} · ${fact.surface} — ${fact.reason ?? 'No producer reason supplied.'}`;
      support.append(row);
    }
    box.append(support);
    const provenance = document.createElement('details'), caption = document.createElement('summary'), facts = document.createElement('pre');
    caption.textContent = 'Exact identity, upstream origins and dependencies';
    facts.textContent = JSON.stringify({ releaseSha256: item.root.releaseSha256, itemId: item.id, itemSha256: item.root.itemSha256, sources: item.sources ?? [], dependencies: item.dependencies ?? {}, recipeTargets: item.targets ?? [], clientCapabilities: declaredCapabilities(item) ?? [] }, null, 2);
    provenance.append(caption, facts); box.append(provenance);
    const savedRoots = intent?.roots.filter(root => root.releaseSha256 === item.root.releaseSha256 && root.itemId === item.id) ?? [];
    const savedRoot = savedRoots[0];
    const config = document.createElement('div'); box.append(config);
    const scope = document.createElement('select'); scope.setAttribute('aria-label', `Scope for ${item.id}`);
    for (const value of item.scopes) { const option = document.createElement('option'); option.value = value; option.textContent = value; scope.append(option); }
    scope.value = savedRoot?.scope ?? item.root.scope;
    const renderConfig = () => {
      const editor = createConfigurationEditor({ configuration: savedRoots.find(root => root.scope === scope.value)?.configuration ?? {}, inputs: item.inputs, label: item.id,
        button: (label, action) => button(label === 'Review configuration' ? `Choose ${item.id}` : label, action),
        review: configuration => propose({ type: 'select', root: { ...item.root, scope: scope.value, configuration } }) });
      editor.open = true; editor.addEventListener('input', invalidate); config.replaceChildren(editor);
    };
    scope.onchange = () => { invalidate(); renderConfig(); }; box.append(scope); renderConfig(); $('items').append(box);
  }
  $('templates').replaceChildren();
  for (const template of catalog.templates) $('templates').append(button(`Add authored template ${template.id}`, () => propose({ type: 'template', releaseSha256: template.releaseSha256, templateId: template.id, templateSha256: template.sha256, originId: `template-${revision}` })));
  $('origins').replaceChildren(); $('roots').replaceChildren();
  $('optional').replaceChildren();
  if (!intent) { show('summary', 'Validate and reopen to recover choices.'); return; }
  for (const origin of intent.origins) $('origins').append(button(`Remove origin ${origin.id}`, () => propose({ type: 'remove-origin', originId: origin.id, keep: keep() })));
  for (const root of intent.roots) $('roots').append(button(`Trim ${root.itemId}`, () => propose({ type: 'remove-root', root, keep: keep() })));
  for (const suggestion of optional) {
    const originId = intent.origins.find(o => o.kind === 'direct')?.id ?? intent.origins[0]?.id;
    const exclusion = { originId, ...suggestion.to };
    $('optional').append(button(`${suggestion.skipped ? 'Clear skip' : 'Skip optional'} ${suggestion.to.itemId}`, () => propose({ type: suggestion.skipped ? 'unskip' : 'skip', exclusion })));
  }
  show('summary', { roots: intent.roots, exclusions: intent.exclusions, pins: intent.pins.map(pin => ({ releaseSha256: pin.releaseSha256, itemId: pin.itemId })), inputs: intent.inputs, reviews: intent.reviews });
  const selected = $('review-target').value; $('review-target').replaceChildren();
  for (const pin of intent.pins) { const option = document.createElement('option'); option.value = `${pin.releaseSha256}/${pin.itemId}`; option.textContent = `${pin.itemId} · ${pin.releaseSha256}`; $('review-target').append(option); }
  if (intent.pins.some(pin => `${pin.releaseSha256}/${pin.itemId}` === selected)) $('review-target').value = selected;
  show('review-history', { reviews: intent.reviews, judgments: currentJudgments });
}
function publish(value) { documentFile.setBytes(Uint8Array.from(value.policyBytes)); currentIntent = value.intent; currentOptional = value.optional ?? []; currentJudgments = value.reviewJudgments ?? []; updateFolderBindings(); render(); void checkAuthority(); }
async function propose(operation) {
  invalidate(); const attempt = revision;
  try { const result = await request('edit', { operation }); if (attempt !== revision) return; present(result); }
  catch (error) { if (attempt === revision) show('proposal', error.message); }
}
function present(result) {
  show('proposal', result.status === 'ok' ? { roots: result.value.intent?.roots, inclusions: result.value.inclusions, optional: result.value.optional, reviews: result.value.intent?.reviews, judgments: result.value.reviewJudgments, comparisons: result.value.comparisons } : result);
  if (result.status === 'ok' && result.value.policyBytes) { candidate = result.value; $('accept').disabled = false; }
}
$('accept').onclick = () => { if (!candidate) return; const accepted = candidate; history = documentFile.bytes(); invalidate(); publish(accepted); $('history').disabled = false; show('proposal', 'Candidate accepted. Original artifact retained.'); };
$('new').onclick = async () => { invalidate(); const attempt = revision, result = await request('new', { mode: $('execution-mode').value }); if (attempt !== revision) return; if (result.status === 'ok') publish(result.value); else present(result); };
$('support-filter').value = 'supported';
$('target').onchange = () => render(); $('support-filter').onchange = () => render();
$('search').oninput = () => render(); $('family').onchange = () => render(); $('keep').oninput = invalidate; $('policy').addEventListener('input', invalidate);
$('save').onclick = () => download(documentFile.bytes(), 'policy.json'); $('history').onclick = () => { if (history) download(history, 'policy.original.json'); };
$('open').onchange = async () => { invalidate(); const attempt = revision, file = $('open').files[0]; if (!file) return; if (file.size > 1_000_000) return show('proposal', 'Policy exceeds the public byte limit.'); const bytes = new Uint8Array(await file.arrayBuffer()); if (attempt !== revision) return; documentFile.setBytes(bytes); history = bytes.slice(); currentIntent = undefined; currentOptional = []; updateFolderBindings(); render(); $('history').disabled = false; show('proposal', 'Original bytes retained. Validate and reopen to recover choices. Personal inputs require explicit folder reselection and exact rebinding below.'); await checkAuthority(); };
// Unresolved choices stay recorded; show them as markers, not as a raw failure or byte arrays.
const unresolvedSummary = value => ({ editing: 'unresolved', note: 'Every saved choice is kept exactly as recorded; nothing is dropped and no other revision is substituted. Draft editing and compile are in the main Workbench.',
  choices: value.roots.map(root => ({ itemId: root.itemId, scope: root.scope, status: root.status, ...(root.blockedBy ? { blockedBy: root.blockedBy.map(entry => ({ kind: entry.kind, reason: entry.reason, ref: entry.ref.itemId ?? entry.ref.templateId ?? entry.ref.id })) } : {}) })),
  unresolved: value.unresolved.map(entry => ({ kind: entry.kind, reason: entry.reason, ref: entry.ref.itemId ?? entry.ref.templateId ?? entry.ref.id, neededBy: entry.dependents.map(dependent => dependent.itemId) })),
  diagnostics: value.diagnostics });
$('reopen').onclick = async () => { invalidate(); const attempt = revision, result = await request('read', { availability: $('candidate-mode').value }); if (attempt !== revision) return;
  show('proposal', result.status === 'ok' && result.value.editing === 'unresolved' ? unresolvedSummary(result.value) : result); if (result.status === 'ok' && result.value.editing === 'available') { currentIntent = result.value.intent; currentJudgments = result.value.reviewJudgments ?? []; currentOptional = result.value.optional ?? []; render(); } await checkAuthority(); };
$('candidate-mode').onchange = invalidate; $('execution-mode').onchange = invalidate;
$('refresh').onclick = async () => { invalidate(); const attempt = revision, result = await request('reconcile', { candidateMode: $('candidate-mode').value }); if (attempt !== revision) return;
  show('changes', result); $('choices').replaceChildren(); if (result.status !== 'ok') return;
  for (const choice of result.value.choices) {
    if (choice.origin) { $('choices').append(button(`Remove unavailable origin ${choice.origin.id}`, () => propose({ type: 'remove-origin', originId: choice.origin.id }))); continue; }
    if (choice.exclusion) { $('choices').append(button(`Remove unavailable exclusion ${choice.exclusion.itemId}`, () => propose({ type: 'unskip', exclusion: choice.exclusion }))); continue; }
    $('choices').append(button(`Keep exact ${choice.root.itemId}`, () => show('proposal', 'Original exact revision retained. Reopen still requires its snapshot.')),
      button(`Remove ${choice.root.itemId}`, () => propose({ type: 'remove-root', root: choice.root, keep: keep() })));
    for (const target of choice.candidates) $('choices').append(button(`Review update ${target.itemId}`, async () => {
      invalidate(); const attempt = revision, read = await request('read'); if (attempt !== revision || read.status !== 'ok' || read.value.editing !== 'available') return show('proposal', read);
      const intent = structuredClone(read.value.intent); intent.roots = intent.roots.map(root => key(root) === key(choice.root) ? { ...root, ...target } : root);
      intent.inputs = intent.inputs.filter(input => input.releaseSha256 !== choice.root.releaseSha256);
      const composed = await request('compose', { intent }); if (attempt === revision) present(composed);
    }));
  } };
$('intake').onchange = async () => { invalidate(); const attempt = revision, file = $('intake').files[0]; if (!file) return;
  try { if (file.size > 5_000_000) throw new Error('Snapshot exceeds the bounded intake size.'); const snapshot = JSON.parse(await file.text()); const result = await request('intake', { snapshot }); if (attempt !== revision) return;
    show('intake-result', result.status === 'ok' ? { releaseSha256: result.value.release.sha256, input: result.value.input } : result); if (result.status === 'ok') { catalog = await loadCatalog(); if (attempt === revision) { updateFamilies(); render(); } }
  } catch (error) { if (attempt === revision) show('intake-result', error.message); } };
$('folder-binding').onchange = () => { invalidate(); $('folder').value = ''; show('folder-result', 'Choose the folder explicitly for this binding.'); };
$('folder').onchange = async () => {
  invalidate(); const attempt = revision, chosen = [...$('folder').files]; if (!chosen.length) return;
  show('folder-result', 'Validating the selected files…');
  try {
    if (chosen.length > 256 || chosen.some(file => file.size > 250_000) || chosen.reduce((sum, file) => sum + file.size, 0) > 1_000_000) throw new Error('Choose up to 256 files, 250 KB each, 1 MB total.');
    const root = chosen[0].webkitRelativePath.split('/')[0];
    const files = [];
    for (const file of chosen) {
      if (!file.webkitRelativePath.startsWith(root + '/')) throw new Error('Select one folder with relative file paths.');
      files.push({ path: file.webkitRelativePath.slice(root.length + 1), bytes: [...new Uint8Array(await file.arrayBuffer())] });
    }
    if (attempt !== revision) return;
    const rebind = $('folder-binding').value ? JSON.parse($('folder-binding').value) : undefined;
    const result = await request('folder', { files, ...(rebind ? { rebind } : {}) }); if (attempt !== revision) return;
    if (result.status === 'ok') {
      show('folder-result', 'Loading validated personal inventory…');
      const refreshed = await loadCatalog(); if (attempt !== revision) return;
      catalog = refreshed; updateFamilies(); render();
    }
    show('folder-result', result.status === 'ok' ? { message: result.value.message, input: result.value.input, items: result.value.itemIds } : result);
  } catch (error) { if (attempt === revision) show('folder-result', error.message); }
  finally { $('folder').value = ''; }
};
const reviewTarget = () => { const [releaseSha256, itemId] = $('review-target').value.split('/'); return { releaseSha256, itemId }; };
const clearInspection = () => { inspected = undefined; $('record-review').disabled = true; $('review-finding').replaceChildren(); };
$('review-target').onchange = () => { invalidate(); clearInspection(); };
$('review-file').onchange = async () => {
  invalidate(); clearInspection(); const attempt = revision, files = [...$('review-file').files]; if (!files.length) return;
  if (files.length + evidenceFiles.length > 32 || files.reduce((sum, file) => sum + file.size, evidenceFiles.reduce((sum, file) => sum + file.bytes.length, 0)) > 750_000) return show('review-facts', 'This page accepts up to 32 reports with 750,000 total bytes. Choose fewer or smaller evidence documents, then try again.');
  const loaded = await Promise.all(files.map(async file => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }))); if (attempt !== revision) return;
  evidenceFiles.push(...loaded); $('review-evidence').replaceChildren();
  for (const [index, file] of evidenceFiles.entries()) { const option = document.createElement('option'); option.value = index; option.textContent = file.name; $('review-evidence').append(option); }
  $('review-evidence').value = String(evidenceFiles.length - loaded.length); evidenceBytes = loaded[0].bytes;
  show('review-facts', 'Original evidence bytes loaded. Inspect for the selected subject.');
};
$('review-evidence').onchange = () => { invalidate(); clearInspection(); evidenceBytes = evidenceFiles[Number($('review-evidence').value)]?.bytes; };
$('forget-evidence').onclick = () => { invalidate(); clearInspection(); evidenceFiles = []; evidenceBytes = undefined; $('review-evidence').replaceChildren(); show('review-facts', 'No optional evidence supplied. Existing policy and review history retained.'); };
$('inspect-review').onclick = async () => {
  invalidate(); clearInspection(); const attempt = revision, target = reviewTarget();
  const result = await request('inspect-review', { evidenceIndex: Number($('review-evidence').value), target }); if (attempt !== revision) return;
  if (result.status !== 'ok') return show('review-facts', result);
  inspected = { ...result.value, target }; show('review-facts', { reportSupport: inspected.reportSupport, scanId: inspected.scanId, sourceAssociation: inspected.sourceAssociation, producerAuthentication: inspected.producerAuthentication, annexBytes: inspected.annexBytes, subject: inspected.subject });
  show('review-report', inspected.view);
  for (const [index, binding] of inspected.bindings.entries()) { const option = document.createElement('option'); option.value = index; option.textContent = `${binding.finding.detectorId} · ${binding.finding.ruleId} · ${binding.finding.findingId}`; $('review-finding').append(option); }
  $('record-review').disabled = !inspected.bindings.length;
};
for (const id of ['review-id', 'review-owner-kind', 'review-owner', 'review-actor', 'review-disposition', 'review-reason', 'review-supersedes', 'review-finding']) $(id).oninput = invalidate;
$('record-review').onclick = async () => {
  invalidate(); const attempt = revision, binding = inspected?.bindings[Number($('review-finding').value)]; if (!binding || !evidenceBytes) return;
  const supersedes = $('review-supersedes').value;
  const decision = { id: $('review-id').value, owner: { kind: $('review-owner-kind').value, id: $('review-owner').value }, actor: $('review-actor').value, recordedAt: new Date().toISOString(), disposition: $('review-disposition').value, reason: $('review-reason').value, ...(supersedes ? { supersedes } : {}) };
  const result = await request('record-review', { evidenceIndex: Number($('review-evidence').value), target: inspected.target, finding: binding.finding, decision }); if (attempt === revision) present(result);
};
$('reconsider-reviews').onclick = async () => { invalidate(); const attempt = revision, result = await request('reconsider-reviews'); if (attempt === revision) present(result); };
async function checkAuthority() {
  const attempt = revision;
  if (!catalog.executionAvailable) { show('authority-summary', 'No execution host connected. Portable editing remains available.'); return; }
  try {
    const result = await request('authority'); if (attempt !== revision) return;
    show('authority', result);
    show('authority-summary', result.status !== 'ok' ? 'Current authority unavailable or invalid. No cached authority or fallback is used; installed state is unchanged.'
      : result.value.mode === 'vibe' ? 'Vibe: no organization boundary. Core still checks exact material and target state.'
      : `${result.value.admitted ? 'Advisory preview admits current choices.' : 'Current authority refuses affected choices.'} ${result.value.affectedChoices.length} affected; ${result.value.stillValidChoices.length} still valid. Prepare and Apply independently recheck.`);
  } catch (error) { if (attempt === revision) show('authority-summary', `Authority check failed: ${error.message}. Prepare again after recovery.`); }
}
function presentPreparation(result) {
  show('execution', result);
  const preparation = result.preparation ?? result;
  if (preparation.status === 'ready' && preparation.sessionId) { prepared = preparation; $('apply').disabled = false; }
}
$('authority-refresh').onclick = async () => { invalidate(); await checkAuthority(); };
$('prepare').onclick = async () => {
  invalidate(); const attempt = revision;
  try { const result = await request('prepare'); if (attempt !== revision) return; presentPreparation(result); if (result.authority) { show('authority', result.authority); } }
  catch (error) { if (attempt === revision) show('execution', error.message); }
};
$('apply').onclick = async () => {
  if (!prepared) return;
  const approved = prepared, attempt = revision; prepared = undefined; $('apply').disabled = true;
  try { const result = await request('apply', { sessionId: approved.sessionId, reviewDigest: approved.review.reviewDigest });
    if (attempt !== revision) return; show('execution', result); await checkAuthority();
  } catch (error) { if (attempt === revision) show('execution', `Apply result unavailable: ${error.message}. Inspect installed state before preparing again.`); }
};
$('managed-refresh').onclick = async () => {
  invalidate(); const attempt = revision;
  try {
    const result = await request('managed'); if (attempt !== revision) return;
    show('execution', result); $('managed').replaceChildren();
    for (const selection of result.selections ?? []) $('managed').append(button(`Review removal ${selection.managementId}`, async () => {
      invalidate(); const removalAttempt = revision;
      try { const mode = JSON.parse(documentFile.text()).mode; const removal = await request('remove', { managementId: selection.managementId, scope: selection.scope, mode });
        if (removalAttempt === revision) presentPreparation(removal);
      } catch (error) { if (removalAttempt === revision) show('execution', error.message); }
    }));
  } catch (error) { if (attempt === revision) show('execution', error.message); }
};
catalog = await loadCatalog(); show('source-description', catalog.description); updateFamilies();
for (const id of ['prepare', 'authority-refresh', 'managed-refresh']) $(id).disabled = !catalog.executionAvailable;
await $('new').onclick();
