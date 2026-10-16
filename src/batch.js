import { el } from './app/dom.js';
import { scopeRows, actionRows, canApply, outcomeRows, outcomeCounts, outcomeTone, conflictText, diagnosticsText, ATOMIC_NOTE, RERUN_NOTE, UNSUPPORTED_NOTE } from './app/batch-view.js';

const node = id => document.getElementById(`batch-${id}`);
const TONES = { success: 'text-secondary', error: 'text-error', warning: 'text-tertiary', neutral: 'text-on-surface-variant' };
let current = null, clients = null, reviewed = null, busy = false, attempted = false, supported = true;
function controls() {
  node('review').disabled = busy || !current || attempted;
  node('continuation').disabled = busy || !current || attempted || !supported;
  node('apply').disabled = busy || attempted || !supported || !canApply(reviewed, current?.id);
  // Reload has no retained run state; reinspection is always available (an unsupported envelope can only be reviewed).
  node('recover').disabled = busy || !current || !supported;
  for (const box of node('actions').querySelectorAll('input[data-action]')) box.disabled = busy || attempted || !supported;
}
// A refusal or failure keeps the host's answer on the error, so the page can show its codes and, for a refused run, its conflicts.
async function api(path, body) {
  const response = await fetch(`/api/${path}`, body === undefined ? { cache: 'no-store' }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok || result.status !== 'ok') throw Object.assign(new Error(diagnosticsText(result)), { result });
  return result;
}
function renderBatch(projection, batchId) {
  current = { ...projection, id: batchId };
  node('content').hidden = false;
  node('id').textContent = batchId;
  node('supersedes').textContent = projection.supersedes ? `Supersedes ${projection.supersedes}. Fresh work prepared from current state.` : '';
  node('continuation').value = projection.continuation;
  node('scopes').replaceChildren(...scopeRows(projection, clients).map(scope => {
    const row = el('li', 'border border-wb-border rounded p-2');
    row.append(el('p', 'font-medium', `${scope.id} · ${scope.role} · ${scope.label}`), el('p', 'text-on-surface-variant', scope.note));
    if (scope.target?.root) row.append(el('p', 'font-mono text-xs break-all', scope.target.root));
    return row;
  }));
  node('actions').replaceChildren(...actionRows(projection).map(action => {
    const row = el('li', 'p-2');
    row.append(el('p', 'font-medium', `${action.id} · scope ${action.scope} · ${action.category}`), el('p', 'text-on-surface-variant', action.dependencies));
    if (action.retained) row.append(el('p', 'text-on-surface-variant', action.unverifiable ? 'Kept without running: Core cannot confirm this earlier work.' : 'Retained earlier result; fresh inspection preserves it.'));
    if (action.runAgain) {
      const label = el('label', 'flex items-start gap-2'), box = el('input');
      box.type = 'checkbox'; box.id = `batch-rerun-${action.id}`; box.dataset.action = action.id; box.checked = action.runAgainChecked;
      box.addEventListener('change', () => perform(async () => { try { await recover({ choices: true }); } catch (error) { box.checked = !box.checked; throw error; } }));
      const words = el('span'); words.append(el('span', 'font-medium', 'Run again'), el('span', 'block text-on-surface-variant', RERUN_NOTE));
      label.append(box, words); row.append(label);
    }
    return row;
  }));
  node('checks').replaceChildren(...(projection.checks ?? []).map(check => el('li', 'break-all', `${check.kind} · ${check.subject} · ${check.id}`)));
}
function renderReview(review, batchId) {
  reviewed = { ...review, batchId };
  node('review-section').hidden = false;
  node('review-summary').textContent = review.conflicts?.length ? `${review.conflicts.length} conflict(s). Apply is blocked.`
    : review.ready ? 'No conflicts reported. Ready for your approval.' : 'Review is not ready. Apply is blocked.';
  node('conflicts').replaceChildren(...(review.conflicts ?? []).map(conflict => el('li', 'break-all', conflictText(conflict))));
  node('reviewed-scopes').replaceChildren(...(review.scopes ?? []).map(scope => {
    const row = el('li', 'border border-wb-border rounded p-2');
    row.append(el('p', 'font-medium', `Scope ${scope.id} · preparation ${scope.prepare}`));
    for (const operation of scope.operations ?? []) row.append(el('p', 'font-mono text-xs break-all', `${operation.action} · ${operation.target} · ${operation.effects} · ${operation.ownership}`));
    row.append(el('p', 'text-on-surface-variant', `Unrelated files inspected: ${scope.unrelated?.files ?? 'unknown'}`));
    return row;
  }));
}
function renderReport(report) {
  node('outcome-section').hidden = false;
  node('outcome-id').textContent = `Report for ${report.batchId ?? current.id}`;
  node('counts').textContent = `Actions: ${outcomeCounts(report).map(item => `${item.count} ${item.outcome}`).join(', ')}.`;
  node('outcomes').replaceChildren(...outcomeRows(report).map(result => {
    const row = el('tr', 'border-t border-wb-border');
    row.dataset.outcome = result.outcome;
    row.append(el('th', 'p-2 font-medium', result.label), el('td', 'p-2', result.scope),
      el('td', `p-2 ${TONES[outcomeTone(result.outcome)]}`, result.outcome),
      el('td', 'p-2 break-all', `${result.reason}${result.files === undefined ? '' : `; ${result.files} files`}`));
    row.firstChild.scope = 'row';
    return row;
  }));
}
async function perform(task) {
  busy = true; controls(); node('status').textContent = 'Working…';
  try { await task(); }
  catch (error) { node('status').textContent = error.message; }
  finally { busy = false; controls(); }
}
node('atomic-note').textContent = ATOMIC_NOTE;
node('review').addEventListener('click', () => perform(async () => {
  reviewed = null;
  const result = await api('batch-review', { batchId: current.id });
  renderReview(result.review, result.batchId); node('status').textContent = 'Review finished. Nothing was applied.';
}));
node('continuation').addEventListener('change', () => perform(async () => {
  const previous = current.continuation;
  reviewed = null; node('review-section').hidden = true;
  try {
    const result = await api('batch-continuation', { batchId: current.id, continuation: node('continuation').value });
    renderBatch(result.projection, result.batchId); node('status').textContent = 'Continuation choice saved. Review this batch again before applying.';
  } catch (error) { node('continuation').value = previous; throw error; }
}));
node('apply').addEventListener('click', () => perform(async () => {
  if (!canApply(reviewed, current.id) || attempted) throw new Error('Review this batch before applying.');
  attempted = true; reviewed = null; node('review-section').hidden = true;
  try {
    const result = await api('batch-run', { batchId: current.id });
    renderReport(result.report); node('status').textContent = 'Run finished. Inspect every observed outcome; Recover reinspects and prepares fresh work.';
  } catch (error) {
    // A refusal is the host saying nothing was applied: show why (the conflicts, when it names them) and let the person review again.
    if (error.result?.status === 'refused') {
      attempted = false;
      if (error.result.review) renderReview(error.result.review, current.id);
      throw new Error(`Nothing was applied. ${error.message}`);
    }
    renderReport({ batchId: current.id,
      actions: (current.actions ?? []).map(action => ({ id: action.id, scope: action.scope, outcome: 'unknown', reason: 'host-answer-unavailable' })),
      scopes: (current.scopes ?? []).map(scope => ({ id: scope.id, unrelated: { outcome: 'unknown', reason: 'host-answer-unavailable' } })) });
    throw new Error(`Run outcome unavailable: ${error.message} Effects are unknown. Recover to reinspect current state.`);
  }
}));
// Recovery reinspects and writes a superseding batch. Work Core cannot confirm is kept unless the person ticks Run again for it;
// only ticking re-plans with those choices, so the Recover button never carries an earlier Run again into a new attempt.
async function recover({ choices = false } = {}) {
  reviewed = null; node('review-section').hidden = true;
  const old = current.id, rerun = choices ? [...node('actions').querySelectorAll('input[data-action]:checked')].map(box => box.dataset.action) : [];
  const result = await api('batch-recover', { batchId: old, ...(rerun.length ? { rerun } : {}) });
  renderBatch(result.projection, result.batchId); attempted = false;
  if (result.review) renderReview(result.review, result.batchId);
  node('status').textContent = `Recovered from ${old}. Fresh batch ${result.batchId} supersedes it.`;
}
node('recover').addEventListener('click', () => perform(() => recover()));
await perform(async () => {
  const result = await api('batch'); clients = result.clients; supported = result.supported !== false;
  node('notice').textContent = supported ? '' : UNSUPPORTED_NOTE;
  renderBatch(result.projection, result.batchId);
  node('status').textContent = 'Reopened from the journey envelope. Review before applying, or Recover to reinspect earlier effects.';
});
