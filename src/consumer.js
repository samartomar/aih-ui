const $ = id => document.getElementById(id);
const text = (id, value) => { $(id).textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); };
const request = async (op, body) => {
  const response = await fetch(`/api/${op}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return response.json();
};
let catalog;
let session;
let revision = 0;
let reportRevision = 0;
let updateCandidate;
let previousPolicyText;
const invalidate = () => { revision++; session = null; updateCandidate = null; $('update-accept').disabled = true; $('apply').disabled = true; text('review', 'Selections changed. Prepare a new review.'); };
const controls = new Map();
function boundary() {
  text('boundary', $('mode').value === 'vibe' ? 'Vibe uses no organization authority.' : 'Enterprise requires a separate host-configured organization source; saved choices do not grant permission.');
}
function renderItems(intent) {
  $('items').replaceChildren(); controls.clear();
  for (const item of catalog.items) {
    const fieldset = document.createElement('fieldset');
    const label = document.createElement('label');
    const selected = document.createElement('input'); selected.type = 'checkbox';
    const root = intent?.roots.find(root => root.itemId === item.id);
    selected.checked = !!root;
    label.append(selected, document.createTextNode(`${item.label} · ${item.kind}`)); fieldset.append(label);
    const skipped = document.createElement('input'); skipped.type = 'checkbox'; skipped.checked = intent?.excludedItemIds.includes(item.id) ?? false;
    const skipLabel = document.createElement('label'); skipLabel.append(skipped, document.createTextNode('Skip this optional choice')); fieldset.append(skipLabel);
    selected.addEventListener('change', () => { if (selected.checked) skipped.checked = false; });
    skipped.addEventListener('change', () => { if (skipped.checked) selected.checked = false; });
    const description = document.createElement('p'); description.textContent = item.description ?? ''; fieldset.append(description);
    const scope = document.createElement('select'); scope.setAttribute('aria-label', `Scope for ${item.label}`);
    for (const value of item.scopes) { const option = document.createElement('option'); option.value = value; option.textContent = value; scope.append(option); }
    if (root) scope.value = root.scope; fieldset.append(scope);
    const inputs = new Map();
    for (const [name, spec] of Object.entries(item.inputs)) {
      const wrapper = document.createElement('label'); wrapper.textContent = `${name}${spec.required ? ' (required)' : ''}: `;
      const input = document.createElement('input'); input.placeholder = spec.default === undefined ? spec.type : `Default: ${JSON.stringify(spec.default)}`;
      const present = document.createElement('input'); present.type = 'checkbox'; present.checked = !!root && Object.hasOwn(root.configuration, name);
      if (present.checked) input.value = spec.type === 'string' ? root.configuration[name] : JSON.stringify(root.configuration[name]);
      input.addEventListener('input', () => { present.checked = true; });
      wrapper.append(present, document.createTextNode(' Set explicitly '), input); fieldset.append(wrapper); inputs.set(name, { input, spec, present });
    }
    const relationships = document.createElement('p'); relationships.textContent = `Required: ${item.dependencies.requires.map(ref => ref.itemId).join(', ') || 'none'}. Optional: ${item.dependencies.optional.map(ref => ref.itemId).join(', ') || 'none'}.`;
    fieldset.append(relationships);
    fieldset.addEventListener('change', invalidate); fieldset.addEventListener('input', invalidate);
    $('items').append(fieldset); controls.set(item.id, { selected, skipped, scope, inputs });
  }
}
function choices() {
  const roots = [], excludedItemIds = new Set();
  for (const [itemId, control] of controls) {
    if (control.skipped.checked) excludedItemIds.add(itemId);
    if (!control.selected.checked) continue;
    const configuration = {};
    for (const [name, { input, spec, present }] of control.inputs) if (present.checked) configuration[name] = spec.type === 'string' ? input.value : JSON.parse(input.value);
    roots.push({ itemId, scope: control.scope.value, configuration });
  }
  return { roots, excludedItemIds: [...excludedItemIds], mode: $('mode').value, basePolicyText: $('policy').value || undefined };
}
$('mode').addEventListener('change', () => { boundary(); invalidate(); });
$('policy').addEventListener('input', invalidate);
$('author').onclick = async () => {
  invalidate(); const attempt = revision; try { const result = await request('author', choices()); if (attempt !== revision) return; text('author-result', result.valid ? { selections: result.policy.selections.map(value => ({ id: value.id, reasons: result.reasons[value.id] })), diagnostics: result.diagnostics } : result);
    if (result.valid) $('policy').value = result.policyText;
  } catch (error) { text('author-result', error.message); }
};
$('download').onclick = () => { const url = URL.createObjectURL(new Blob([$('policy').value], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'policy.json'; link.click(); URL.revokeObjectURL(url); };
$('open').onchange = async () => { const file = $('open').files[0]; if (!file) return; invalidate(); const attempt = revision; const content = await file.text(); if (attempt !== revision) return; $('policy').value = content; };
$('reopen').onclick = async () => { invalidate(); const attempt = revision; const result = await request('reopen', { policyText: $('policy').value }); if (attempt !== revision) return; text('reopen-result', { valid: result.valid, editable: result.editable, reason: result.reason, diagnostics: result.diagnostics }); if (result.valid && result.editable) { renderItems(result.intent); $('mode').value = result.policy.mode; boundary(); } };
$('update-review').onclick = async () => { invalidate(); const attempt = revision; const result = await request('update-review', { policyText: $('policy').value }); if (attempt !== revision) return; text('update-result', result.valid ? { previousReleaseSha256: result.previousReleaseSha256, nextReleaseSha256: result.nextReleaseSha256, changes: result.changes, excludedItemIds: result.policy.metadata['aih.workbench'].excludedItemIds } : result); if (result.valid) { updateCandidate = result; $('update-accept').disabled = false; } };
$('update-accept').onclick = () => { if (!updateCandidate) return; const candidate = updateCandidate; previousPolicyText = candidate.originalPolicyText; invalidate(); $('policy').value = candidate.policyText; $('download-history').disabled = false; renderItems(candidate.policy.metadata['aih.workbench']); text('update-result', 'Update accepted into draft. Previous JSON retained for download. Prepare and approve a new Core review before applying.'); };
$('download-history').onclick = () => { if (!previousPolicyText) return; const url = URL.createObjectURL(new Blob([previousPolicyText], {type: 'application/json'})); const link = document.createElement('a'); link.href = url; link.download = 'policy.previous.json'; link.click(); URL.revokeObjectURL(url); };
$('prepare').onclick = async () => { invalidate(); const attempt = revision; const result = await request('prepare', { policyText: $('policy').value }); if (attempt !== revision) return; text('review', result); if (result.sessionId) { session = result; $('apply').disabled = false; } };
$('apply').onclick = async () => { if (!session) return; const current = session; session = null; $('apply').disabled = true; text('review', await request('apply', { sessionId: current.sessionId, reviewDigest: current.review.reviewDigest })); };
$('scan').onchange = async () => { const attempt = ++reportRevision; const file = $('scan').files[0]; if (!file) return; if (file.size > 5_500_000) return text('scan-result', 'Report too large for this bounded preview.'); const bytes = new Uint8Array(await file.arrayBuffer()); if (attempt !== reportRevision) return; let encoded = ''; for (const byte of bytes) encoded += String.fromCharCode(byte); const result = await request('report', { base64: btoa(encoded) }); if (attempt === reportRevision) text('scan-result', result); };
try { catalog = await (await fetch('/api/catalog')).json(); text('release', `Exact Catalog release: ${catalog.releaseSha256}`); text('packages', catalog.packages); text('host', catalog.hostAvailable ? 'Host target configured. Preparation does not apply changes; explicit approval is required.' : 'Authoring preview only. Execution target is not configured.'); $('prepare').disabled = !catalog.hostAvailable; renderItems(); boundary(); } catch (error) { text('author-result', error.message); }
