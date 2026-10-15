// Check this machine: a read-only machine check, copyable guidance, and an
// explicitly approved repair. The host owns Core; this page only renders the
// projections it returns and never applies anything without the approval control.
import { overallLine, rowsFor, summaryCounts } from './app/readiness-view.js';

const $ = id => document.getElementById(id);
const TONE_CLASS = {
  error: 'bg-error-container text-error',
  warning: 'bg-tertiary-container text-tertiary',
  neutral: 'bg-surface-container-highest text-on-surface-variant',
  success: 'bg-secondary-container text-secondary',
};
const el = (tag, className, value) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined && value !== null) node.textContent = String(value);
  return node;
};

// Every response is JSON with a status; anything else is shown, never read as success.
async function call(path, body) {
  const init = body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  try {
    const response = await fetch(path, init);
    const payload = await response.json();
    if (response.ok && payload.status === 'ok') return { status: 'ok', value: payload.value };
    const message = (payload.diagnostics ?? []).map(item => item.message).filter(Boolean).join(' ') || payload.message || `The host answered ${response.status}.`;
    return { status: ['lost', 'rejected'].includes(payload.status) ? payload.status : 'error', message };
  } catch (error) {
    return { status: 'error', message: `The host could not be reached: ${error.message}` };
  }
}

function renderRows(list, projection, extras = new Map()) {
  list.replaceChildren();
  for (const row of rowsFor(projection)) {
    const item = el('li', 'border border-wb-border rounded p-2 space-y-1');
    const head = el('div', 'flex flex-wrap items-center gap-2');
    head.append(el('span', `px-1.5 py-0.5 rounded text-xs font-medium ${TONE_CLASS[row.tone]}`, row.stateLabel), el('span', 'font-medium', row.label),
      el('span', 'font-mono text-xs text-outline', row.id));
    item.append(head);
    if (row.reasonText) item.append(el('p', 'text-on-surface-variant', row.reasonText + (row.reasonText === row.reason ? '' : ` (${row.reason})`)));
    if (row.detail) item.append(el('p', 'text-xs text-on-surface-variant', row.detail));
    if (row.purpose) item.append(el('p', '', row.purpose));
    if (row.effects) item.append(el('p', 'font-mono text-xs text-on-surface-variant', `Effect: ${row.effects}`));
    for (const line of extras.get(row.id) ?? []) item.append(el('p', 'font-mono text-xs text-on-surface-variant break-all', line));
    if (row.application) item.append(el('p', 'text-xs text-on-surface-variant', `Application: ${row.application} · Verification: ${row.verification ?? 'unverified'}`));
    if (row.guidance) item.append(el('p', 'text-xs whitespace-pre-wrap', `Guidance: ${row.guidance}`));
    list.append(item);
  }
  if (!list.children.length) list.append(el('li', 'text-on-surface-variant', 'No conditions were reported.'));
}

function renderSummary(container, projection) {
  container.replaceChildren(...summaryCounts(projection).map(item =>
    el('span', `px-1.5 py-0.5 rounded text-xs font-medium ${TONE_CLASS[item.tone]}`, `${item.label} ${item.count}`)));
}

function showGuidance(text, source) {
  $('guidance').value = text;
  $('guidance-label').textContent = `Guidance for your AI client (read-only) — ${source}`;
  $('copy-status').textContent = 'Copying only puts this text on your clipboard. It executes nothing and changes nothing.';
  $('result-section').hidden = false;
}

let busy = false, prepared = null;
const setBusy = value => { busy = value; $('check').disabled = value; for (const button of $('repairs').querySelectorAll('button')) button.disabled = value; syncApply(); };
const syncApply = () => { $('apply').disabled = busy || !$('approve').checked || !prepared?.approvable; };

// Core publishes AI client targets; other tool ids are free entry that Core validates.
const targetList = () => [...new Set($('targets').value.split(/[\s,]+/).filter(Boolean))];

async function runCheck() {
  setBusy(true);
  $('check-status').textContent = 'Checking this machine…';
  const targets = targetList();
  const result = await call('/api/readiness-check', { ...(targets.length ? { targets } : {}), network: $('offline').checked ? 'off' : 'declared' });
  setBusy(false);
  if (result.status !== 'ok') { $('check-status').textContent = `The check did not run: ${result.message}`; return; }
  const { projection, guidance } = result.value;
  $('check-status').textContent = 'Check finished.';
  $('result-section').hidden = false;
  $('overall').textContent = overallLine(projection);
  renderSummary($('summary'), projection);
  renderRows($('rows'), projection);
  for (const diagnostic of projection.diagnostics ?? []) $('rows').append(el('li', 'text-xs text-on-surface-variant', `${diagnostic.code}: ${diagnostic.message}`));
  showGuidance(guidance, 'from the machine check');
}

async function prepareRepair(repair) {
  setBusy(true);
  prepared = null; $('approve').checked = false; $('outcome').hidden = true; $('review').hidden = true;
  $('repair-status').textContent = `Preparing ${repair.id}. Nothing is changed while preparing.`;
  const result = await call('/api/readiness-repair-prepare', { key: repair.key });
  if (result.status !== 'ok') { setBusy(false); $('repair-status').textContent = `The repair could not be prepared: ${result.message}`; return; }
  const { sessionId, reviewDigest, operations, projection } = result.value;
  prepared = { sessionId, reviewDigest, approvable: projection.approvable === true && typeof sessionId === 'string' && typeof reviewDigest === 'string' };
  $('review').hidden = false;
  $('review-heading').textContent = `Review: ${repair.id} for ${repair.targets.join(', ')}`;
  $('review-overall').textContent = overallLine(projection);
  renderRows($('review-rows'), projection, new Map(operations.map(item => [item.id, [`Target: ${item.target}`, `Kind: ${item.kind} · Scope: ${item.scope}`]])));
  $('repair-status').textContent = prepared.approvable ? 'Review the changes, then approve to apply. Nothing has been changed.'
    : 'This repair cannot be approved from its current state. Nothing has been changed.';
  setBusy(false);
}

async function applyRepair() {
  if (!prepared?.approvable || !$('approve').checked) return;
  const session = prepared;
  prepared = null; $('approve').checked = false;
  setBusy(true);
  $('repair-status').textContent = 'Applying the approved repair…';
  const result = await call('/api/readiness-repair-apply', { sessionId: session.sessionId, reviewDigest: session.reviewDigest, approved: true });
  setBusy(false);
  $('review').hidden = true;
  if (result.status === 'lost') { $('repair-status').textContent = `The prepared review is no longer available. Nothing was applied. Prepare the repair again. ${result.message}`; return; }
  if (result.status === 'rejected') { $('repair-status').textContent = `The approval was rejected. Nothing was applied. Prepare the repair again. ${result.message}`; return; }
  if (result.status !== 'ok') { $('repair-status').textContent = `The repair could not be applied: ${result.message} Check the machine again before relying on it.`; return; }
  const { outcome, recheck, machine, guidance } = result.value;
  $('repair-status').textContent = 'The approved repair ran. Each change below shows whether it was applied and whether it was verified.';
  $('outcome').hidden = false;
  $('outcome-overall').textContent = overallLine(outcome);
  renderRows($('outcome-rows'), outcome);
  // The recheck covers only the repair's targets; the Result line stays with the latest machine check.
  $('recheck-heading').textContent = `Recheck of the repair's targets only: ${(recheck?.scope ?? outcome.targets).join(', ')}`;
  $('recheck-overall').textContent = overallLine(recheck);
  renderRows($('recheck-rows'), recheck);
  $('overall').textContent = machine ? overallLine(machine) : "Not ready — no machine check has run; the recheck covered only the repair's targets.";
  showGuidance(guidance, "from the latest machine check, the repair outcome and the recheck of the repair's targets");
}

async function copyGuidance() {
  try {
    await navigator.clipboard.writeText($('guidance').value);
    $('copy-status').textContent = 'Copied to your clipboard. Nothing was executed or changed.';
  } catch {
    $('copy-status').textContent = 'The browser refused clipboard access. Select the text above and copy it yourself; nothing was executed.';
  }
}

async function loadRepairs() {
  const result = await call('/api/readiness-repairs');
  if (result.status !== 'ok') { $('repairs-note').textContent = `Supported repairs could not be listed: ${result.message} Guidance remains available.`; return; }
  const repairs = result.value.repairs ?? [];
  $('repairs-note').textContent = repairs.length ? 'These repairs were configured by the host. Preparing one shows exactly what would change; nothing is applied without your approval.'
    : 'No repair is configured for this Workbench. Supported repairs require host configuration; guidance remains available.';
  for (const repair of repairs) {
    const item = el('li', 'flex flex-wrap items-center gap-3');
    item.append(el('span', '', `${repair.id} for ${repair.targets.join(', ')} (network ${repair.network})`));
    const button = el('button', 'px-3 py-1.5 rounded border border-wb-control-border hover:bg-surface-container disabled:opacity-50', 'Prepare repair');
    button.type = 'button';
    button.addEventListener('click', () => prepareRepair(repair));
    item.append(button);
    $('repairs').append(item);
  }
}

// The summary's coreTargets are the AI clients Core publishes; they are offered as shortcuts, never as the only choice.
async function loadPublishedTargets() {
  let published = null, reason = 'The Workbench summary was not reachable.';
  try {
    const summary = await (await fetch('/api/packages')).json();
    if (summary.coreTargets?.state === 'published' && Array.isArray(summary.coreTargets.targets)) published = summary.coreTargets.targets.filter(target => typeof target === 'string');
    else reason = 'The installed Core does not publish its supported clients to this Workbench.';
  } catch { /* the free-entry field still works */ }
  $('target-help').textContent = published
    ? 'Core publishes these AI clients; choose any to add them, or type other target ids. Core reports any id it does not recognize.'
    : `${reason} Type target ids; Core reports any id it does not recognize.`;
  for (const target of published ?? []) {
    const button = el('button', 'px-2 py-0.5 rounded border border-wb-control-border font-mono text-xs hover:bg-surface-container', target);
    button.type = 'button';
    button.addEventListener('click', () => { $('targets').value = [...new Set([...targetList(), target])].join(', '); });
    $('target-choices').append(button);
  }
}

$('check').addEventListener('click', runCheck);
$('apply').addEventListener('click', applyRepair);
$('approve').addEventListener('change', syncApply);
$('copy-guidance').addEventListener('click', copyGuidance);
loadRepairs();
loadPublishedTargets();
