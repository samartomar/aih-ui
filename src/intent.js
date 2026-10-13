import { policyFile } from './policy-file.js';
const $ = id => document.getElementById(id);
const show = (id, value) => { $(id).textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); };
const policyDocument = policyFile($('policy'));
const key = ref => `${ref.releaseSha256}/${ref.itemId}`;
let catalog, candidate, history, stage = 'current', page = 0, revision = 0, removal;
const decisions = new Map();
function invalidate() { revision++; candidate = null; $('accept').disabled = true; $('remove-together').disabled = true; $('resolve').disabled = true; }
async function request(operation, extra = {}) {
  try { const response = await fetch(`/api/intent-${operation}`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ inventory: $('inventory').value, stage, mode: $('mode').value, policyText: policyDocument.text(), ...extra }) });
    return await response.json();
  } catch (error) { return { valid: false, error: error.message }; }
}
function summary(result) {
  return { selections: result.policy?.selections.map(selection => ({ id: selection.id, managementId: selection.managementId,
    reasons: result.reasons?.[selection.id] })), roots: result.intent?.roots, skips: result.intent?.exclusions,
    optional: result.optional, provenance: result.intent?.provenance, diagnostics: result.diagnostics };
}
function download(text, name) { const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }
async function loadCatalog(nextStage = stage) { const data = await (await fetch(`/api/intent-catalog?inventory=${$('inventory').value}&stage=${nextStage}`)).json(); if (data.error) throw new Error(data.error); return data; }
function button(label, action) { const control = document.createElement('button'); control.textContent = label; control.onclick = action; return control; }
function render() {
  const query = $('search').value.toLowerCase();
  const filtered = catalog.items.filter(item => `${item.label} ${item.package.name}`.toLowerCase().includes(query));
  page = Math.min(page, Math.max(0, Math.ceil(filtered.length / 30) - 1));
  show('count', `${filtered.length} matching items · ${catalog.items.length} total · page ${page + 1}`);
  $('previous').disabled = page === 0; $('next').disabled = (page + 1) * 30 >= filtered.length;
  $('items').replaceChildren();
  for (const item of filtered.slice(page * 30, page * 30 + 30)) {
    const box = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = `${item.label} · ${item.package.name}`; box.append(legend);
    const identity = document.createElement('p'); identity.textContent = `Exact key: ${key(item.root)}`; box.append(identity);
    const description = document.createElement('p'); description.textContent = `Requires: ${item.dependencies.requires.map(ref => ref.itemId).join(', ') || 'none'} · Optional: ${item.dependencies.optional.map(ref => ref.itemId).join(', ') || 'none'}`; box.append(description);
    const config = document.createElement('input'); config.value = '{}'; config.oninput = invalidate; config.setAttribute('aria-label', `Configuration JSON for ${item.label}`); box.append(config);
    box.append(button('Choose explicit root', () => { try { propose({ type: 'select', root: { ...item.root, configuration: JSON.parse(config.value) } }); } catch (error) { show('proposal', error.message); } }));
    const { scope, configuration, ...ref } = item.root;
    box.append(button('Skip optional choice', () => propose({ type: 'skip', ref })), button('Clear skip', () => propose({ type: 'unskip', key: key(item.root) })),
      button('Remove explicit root', () => propose({ type: 'remove-root', key: key(item.root), scope: 'project', keepKeys: $('keep').value.split('\n').map(value => value.trim()).filter(Boolean) })),
      button('Remove item / inspect impact', () => propose({ type: 'remove-item', key: key(item.root) })));
    $('items').append(box);
  }
  $('templates').replaceChildren();
  for (const template of catalog.templates) $('templates').append(button(`Add template ${template.id}`, () => propose({ type: 'template', templateId: template.id, templateSha256: template.sha256, originId: `template-${revision}` })));
}
function publish(result) {
  policyDocument.setText(result.policyText); $('mode').value = result.policy.mode; show('summary', summary(result));
  $('origins').replaceChildren();
  for (const origin of result.intent.origins) $('origins').append(button(`Remove origin ${origin.id}${origin.templateId ? ` (${origin.templateId})` : ''}`, () => propose({ type: 'remove-origin', originId: origin.id })));
  render();
}
function present(result, nextStage = stage) {
  show('proposal', result.valid ? { impact: result.impact, changes: result.changes, ...summary(result) } : result);
  if (result.valid && result.policyText) { candidate = { result, stage: nextStage }; $('accept').disabled = false; }
}
async function propose(operation) {
  invalidate(); const attempt = revision;
  try { const result = await request('edit', { operation }); if (attempt !== revision) return; removal = operation; present(result);
    if (result.affectedRoots) $('remove-together').disabled = false;
  } catch (error) { if (attempt === revision) show('proposal', error.message); }
}
$('remove-together').onclick = () => propose({ ...removal, removeDependents: true });
$('accept').onclick = async () => { if (!candidate) return; const accepted = candidate, previous = policyDocument.text(); invalidate(); const attempt = revision;
  try { const data = await loadCatalog(accepted.stage); if (attempt !== revision) return; stage = accepted.stage; catalog = data; history = previous; publish(accepted.result); $('history').disabled = false; show('proposal', 'Candidate accepted into the draft. Previous JSON retained for download.'); }
  catch (error) { if (attempt === revision) show('proposal', error.message); } };
async function fresh() { invalidate(); stage = 'current'; const attempt = revision; try { const data = await loadCatalog(); if (attempt !== revision) return; const result = await request('new', { policyText: undefined }); if (attempt === revision) { if (!result.valid) return show('proposal', result); catalog = data; publish(result); show('proposal', 'Fresh draft ready.'); } } catch (error) { if (attempt === revision) show('proposal', error.message); } }
$('new').onclick = fresh;
$('inventory').onchange = () => { page = 0; fresh(); };
$('mode').onchange = () => { invalidate(); show('proposal', 'Start a fresh draft to use the chosen mode.'); };
$('search').oninput = () => { page = 0; render(); };
$('previous').onclick = () => { page--; render(); }; $('next').onclick = () => { page++; render(); };
$('policy').oninput = () => { invalidate(); show('summary', 'Validate and reopen this JSON before editing.'); };
$('keep').oninput = invalidate;
$('save').onclick = () => download(policyDocument.bytes(), 'policy.json'); $('history').onclick = () => { if (history) download(history, 'policy.previous.json'); };
$('open').onchange = async () => { const file = $('open').files[0]; if (!file) return; invalidate(); const attempt = revision; if (file.size > 1_000_000) return show('proposal', 'Policy exceeds the public Core byte limit.'); const bytes = new Uint8Array(await file.arrayBuffer()); if (attempt === revision) { policyDocument.setBytes(bytes); show('proposal', 'File opened. Validate and reopen to restore choices.'); } };
$('reopen').onclick = async () => { invalidate(); const attempt = revision; const result = await request('reopen'); if (attempt !== revision) return;
  if (result.valid && result.editable) {
    try { const nextStage = result.stage ?? stage, data = await loadCatalog(nextStage); if (attempt !== revision) return; stage = nextStage; catalog = data; publish(result); }
    catch (error) { if (attempt === revision) show('proposal', error.message); return; }
  }
  present(result); candidate = null; $('accept').disabled = true; };
async function update(resolutions = {}) {
  invalidate(); const attempt = revision; const result = await request('update', { resolutions }); if (attempt !== revision) return;
  present(result, 'next'); $('decisions').replaceChildren(); decisions.clear();
  for (const change of result.changes ?? []) if (change.state !== 'unchanged' && change.state !== 'added') {
    const label = document.createElement('label'); label.textContent = `${change.saved.itemId}: ${change.state} `;
    const select = document.createElement('select');
    for (const value of ['', ...(change.current ? ['accept'] : []), 'remove', 'keep']) { const option = document.createElement('option'); option.value = value; option.textContent = value || 'Choose a resolution'; select.append(option); }
    select.value = resolutions[change.key] ?? ''; select.onchange = () => { invalidate(); $('resolve').disabled = !decisions.size; }; label.append(select); $('decisions').append(label); decisions.set(change.key, select);
  }
  $('resolve').disabled = !decisions.size;
}
$('update').onclick = () => update();
$('resolve').onclick = () => update(Object.fromEntries([...decisions].filter(([,control]) => control.value).map(([key,control]) => [key, control.value])));
let reportRevision = 0;
$('scan').onchange = async () => { const attempt = ++reportRevision, file = $('scan').files[0]; if (!file) return; if (file.size > 5_500_000) return show('scan-result', 'Report too large for this preview.'); try { const data = new Uint8Array(await file.arrayBuffer()); let text = ''; for (const byte of data) text += String.fromCharCode(byte); const result = await (await fetch('/api/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ base64: btoa(text) }) })).json(); if (attempt === reportRevision) show('scan-result', result); } catch (error) { if (attempt === reportRevision) show('scan-result', error.message); } };
await fresh();
