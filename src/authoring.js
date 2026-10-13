import { policyFile } from './policy-file.js';
const $ = id => document.getElementById(id), documentFile = policyFile($('policy'));
const show = (id, value) => { $(id).textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); };
let catalog, candidate, history, currentIntent, currentOptional = [], revision = 0;
let evidenceBytes, inspected, evidenceFiles = [];
const reviewContext = () => ({ reviewEvidence: evidenceFiles.map(file => [...file.bytes]) });
const invalidate = () => { revision++; candidate = undefined; $('accept').disabled = true; };
const request = async (operation, body = {}) => (await fetch(`/api/authoring-${operation}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ policyBytes: [...documentFile.bytes()], ...reviewContext(), ...body }) })).json();
const button = (label, action) => { const node = document.createElement('button'); node.textContent = label; node.onclick = action; return node; };
const key = ref => `${ref.releaseSha256}/${ref.itemId}/${ref.scope}`;
const keep = () => $('keep').value.split('\n').filter(v => v.trim()).map(value => { const [releaseSha256, itemId, scope] = value.trim().split('/'); return { releaseSha256, itemId, scope }; });
function download(bytes, filename) { const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); }
function render(intent = currentIntent, optional = currentOptional) {
  $('items').replaceChildren();
  const query = $('search').value.toLowerCase();
  for (const item of catalog.items.filter(item => `${item.label} ${item.id} ${item.package.name}`.toLowerCase().includes(query)).slice(0, 40)) {
    const box = document.createElement('fieldset'), title = document.createElement('legend'); title.textContent = `${item.label} · ${item.package.name}`; box.append(title);
    const description = document.createElement('p'); description.textContent = item.description ?? ''; box.append(description);
    const savedRoots = intent?.roots.filter(root => root.releaseSha256 === item.root.releaseSha256 && root.itemId === item.id) ?? [];
    const savedRoot = savedRoots[0];
    const config = document.createElement('input'); config.value = JSON.stringify(savedRoot?.configuration ?? {}); config.setAttribute('aria-label', `Configuration for ${item.id}`); config.oninput = invalidate; box.append(config);
    const scope = document.createElement('select'); scope.setAttribute('aria-label', `Scope for ${item.id}`);
    for (const value of item.scopes) { const option = document.createElement('option'); option.value = value; option.textContent = value; scope.append(option); }
    scope.value = savedRoot?.scope ?? item.root.scope;
    scope.onchange = () => { invalidate(); config.value = JSON.stringify(savedRoots.find(root => root.scope === scope.value)?.configuration ?? {}); }; box.append(scope);
    box.append(button(`Choose ${item.id}`, () => { try { return propose({ type: 'select', root: { ...item.root, scope: scope.value, configuration: JSON.parse(config.value) } }); } catch (error) { invalidate(); show('proposal', error.message); } })); $('items').append(box);
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
  show('review-history', intent.reviews);
}
function publish(value) { documentFile.setBytes(Uint8Array.from(value.policyBytes)); currentIntent = value.intent; currentOptional = value.optional ?? []; render(); }
async function propose(operation) {
  invalidate(); const attempt = revision;
  try { const result = await request('edit', { operation }); if (attempt !== revision) return; present(result); }
  catch (error) { if (attempt === revision) show('proposal', error.message); }
}
function present(result) {
  show('proposal', result.status === 'ok' ? { roots: result.value.intent?.roots, inclusions: result.value.inclusions, optional: result.value.optional, reviews: result.value.intent?.reviews, comparisons: result.value.comparisons } : result);
  if (result.status === 'ok' && result.value.policyBytes) { candidate = result.value; $('accept').disabled = false; }
}
$('accept').onclick = () => { if (!candidate) return; const accepted = candidate; history = documentFile.bytes(); invalidate(); publish(accepted); $('history').disabled = false; show('proposal', 'Candidate accepted. Original artifact retained.'); };
$('new').onclick = async () => { invalidate(); const attempt = revision, result = await request('new'); if (attempt !== revision) return; if (result.status === 'ok') publish(result.value); else present(result); };
$('search').oninput = () => render(); $('keep').oninput = invalidate; $('policy').addEventListener('input', invalidate);
$('save').onclick = () => download(documentFile.bytes(), 'policy.json'); $('history').onclick = () => { if (history) download(history, 'policy.original.json'); };
$('open').onchange = async () => { invalidate(); const attempt = revision, file = $('open').files[0]; if (!file) return; if (file.size > 1_000_000) return show('proposal', 'Policy exceeds the public byte limit.'); const bytes = new Uint8Array(await file.arrayBuffer()); if (attempt !== revision) return; documentFile.setBytes(bytes); history = bytes.slice(); currentIntent = undefined; currentOptional = []; render(); $('history').disabled = false; show('proposal', 'Original bytes retained. Validate and reopen to recover choices.'); };
$('reopen').onclick = async () => { invalidate(); const attempt = revision, result = await request('read', { availability: $('candidate-mode').value }); if (attempt !== revision) return;
  show('proposal', result); if (result.status === 'ok' && result.value.editing === 'available') { currentIntent = result.value.intent; currentOptional = result.value.optional ?? []; render(); } };
$('candidate-mode').onchange = invalidate;
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
    show('intake-result', result.status === 'ok' ? { releaseSha256: result.value.release.sha256, input: result.value.input } : result); if (result.status === 'ok') { catalog = await (await fetch('/api/authoring-catalog')).json(); if (attempt === revision) render(); }
  } catch (error) { if (attempt === revision) show('intake-result', error.message); } };
const reviewTarget = () => { const [releaseSha256, itemId] = $('review-target').value.split('/'); return { releaseSha256, itemId }; };
const clearInspection = () => { inspected = undefined; $('record-review').disabled = true; $('review-finding').replaceChildren(); };
$('review-target').onchange = () => { invalidate(); clearInspection(); };
$('review-file').onchange = async () => {
  invalidate(); clearInspection(); const attempt = revision, files = [...$('review-file').files]; if (!files.length) return;
  if (files.length + evidenceFiles.length > 32 || files.reduce((sum, file) => sum + file.size, evidenceFiles.reduce((sum, file) => sum + file.bytes.length, 0)) > 750_000) return show('review-facts', 'This page accepts up to 32 reports with 750,000 total bytes. Use the headless reader for larger bounded artifacts.');
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
catalog = await (await fetch('/api/authoring-catalog')).json(); show('source-description', catalog.description); await $('new').onclick();
