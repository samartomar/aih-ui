import { loadSetup } from './settings-client.js';

// Mirrors the record URNs in tools/consumer/improvement-record.mjs, the source of truth; the page cannot import it.
export const SUGGESTION_RECORD = 'urn:aihq:workbench:journey-record:improvement-suggestion:1.0.0';
export const DISMISSAL_RECORD = 'urn:aihq:workbench:journey-record:improvement-dismissal:1.0.0';
export const IMPROVEMENTS_NOTE = 'Suggestions come from fixed improvement rules using this policy, your saved AI clients and the Catalog. No model is called and nothing is applied or sent. Save the draft to keep a dismissal.';
const PROMPT_NOTE = 'AI advice — paste this into an AI client you already use. The Workbench sends nothing, runs nothing and calls no model.';
const RECORD_FIELDS = ['id', 'revision', 'rulesVersion', 'scope', 'change', 'triggers', 'goal', 'references', 'facts', 'unknowns'];

export function groupImprovements(value) {
  return [
    { label: 'Leading suggestion', rows: value?.leading ? [value.leading] : [] },
    { label: 'Alternatives', rows: (value?.alternatives ?? []).slice(0, 3) },
    { label: 'Dismissed', rows: value?.dismissed ?? [] },
    { label: 'Preserved dismissals', rows: value?.preserved ?? [] },
  ];
}
export function promotionText(suggestion) {
  return (suggestion.promotion?.reasons ?? []).map(reason => reason.startsWith('Shown again:') ? reason : `Shown again: ${reason}`);
}
export function dismissOperation(suggestion, reason) {
  const record = Object.fromEntries(RECORD_FIELDS.filter(key => suggestion[key] !== undefined).map(key => [key, suggestion[key]]));
  return { type: 'dismiss', suggestion: record, ...(reason === undefined ? {} : { reason }) };
}
// Where a reason came from, in words; the record keeps the exact kind and reference.
const SOURCES = { setting: () => 'From your Workbench setup', 'saved-reason': ref => `From the reason saved with ${ref}`, request: () => 'From the goal you asked about', 'catalog-item': ref => `Catalog item ${ref}` };
export const referenceText = reference => SOURCES[reference.kind]?.(reference.ref) ?? `${reference.kind}: ${reference.ref}`;
export const restoreOperation = id => ({ type: 'restore', id });
// No saved setup means no declared clients, not a failed check.
async function savedClients() {
  try {
    const result = await loadSetup();
    return result.state === 'saved' && Array.isArray(result.settings?.clients) ? result.settings.clients.filter(id => typeof id === 'string') : [];
  } catch { return []; }
}

export function createImprovementsView({ client, el, button, showStatus, loadClients = savedClients }) {
  const node = el('section', 'p-3 border border-wb-border rounded bg-surface-container-low space-y-2'); node.id = 'policy-improvements';
  const goal = el('input', 'bg-wb-input border border-wb-border rounded p-1'); goal.id = 'policy-improvements-goal'; goal.type = 'text'; goal.maxLength = 300; goal.value = '';
  const goalLabel = el('label', 'text-on-surface-variant', 'Optional goal'); goalLabel.setAttribute('for', goal.id);
  const status = el('p', 'text-on-surface-variant'); status.setAttribute('role', 'status');
  const groups = el('div', 'space-y-2');
  let value, pending = false, attempt = 0, failed = false;
  const diagnostic = result => result?.diagnostics?.map(row => row.message).join(' ') || result?.error || 'The improvement check could not be completed.';
  const safe = action => async () => { try { await action(); } catch (error) { showStatus(error.message); } };
  const suggest = button('Suggest', safe(() => check())); suggest.id = 'policy-improvements-suggest';
  const controls = el('div', 'flex flex-wrap items-center gap-2'); controls.append(goalLabel, goal, suggest);
  node.append(el('h3', 'font-medium', 'Improvements'), el('p', 'text-on-surface-variant', IMPROVEMENTS_NOTE), controls, status, groups);

  async function record(operation) {
    const result = await client.recordImprovement(operation);
    if (result.status === 'superseded') return;
    if (result.status !== 'ok') return showStatus(diagnostic(result));
    // Old cards describe the previous envelope; a failed recheck must not show stale actions.
    value = undefined;
    showStatus('Improvement choice recorded. Save the draft to keep it.');
    await check();
  }
  function promptControls(suggestion) {
    const controls = el('div', 'space-y-1');
    const prompt = el('div', 'space-y-1'); prompt.hidden = true;
    const textarea = el('textarea', 'w-full bg-wb-input border border-wb-border rounded p-2 text-[11px]');
    textarea.readOnly = true; textarea.value = suggestion.prompt; textarea.setAttribute('aria-label', `AI advice prompt for ${suggestion.label ?? suggestion.change.itemId}`);
    prompt.append(el('p', 'text-on-surface-variant', PROMPT_NOTE), textarea, button('Copy prompt', safe(async () => {
      await navigator.clipboard.writeText(suggestion.prompt);
      showStatus('Prompt copied. Paste it into an AI client you already use.');
    })));
    controls.append(button('Ask your AI client', () => { prompt.hidden = !prompt.hidden; }), prompt);
    return controls;
  }
  function render() {
    node.hidden = !(client.draft || client.intent);
    if (node.hidden) { attempt++; value = undefined; pending = false; failed = false; goal.value = ''; groups.replaceChildren(); return; }
    suggest.disabled = pending;
    status.textContent = pending ? 'Checking improvements…' : failed ? 'The improvement check could not be completed; suggestions are unknown.' : value ? `Checked ${value.checkedAt}.` : 'Suggest improvements using the fixed rules.';
    groups.replaceChildren();
    for (const group of groupImprovements(value)) {
      if (!group.rows.length) continue;
      const section = el('div', 'space-y-1'); section.append(el('h4', 'font-medium', group.label));
      const preserved = group.label === 'Preserved dismissals', dismissed = group.label === 'Dismissed';
      for (const row of group.rows) {
        const suggestion = preserved ? row.suggestion : row;
        const card = el('div', 'p-2 border border-wb-border rounded space-y-1'); card.dataset.suggestionId = suggestion.id;
        card.append(el('p', 'font-medium', suggestion.label ?? suggestion.change.itemId), el('p', 'text-outline text-[11px]', `Scope: ${suggestion.scope}`));
        // Why a dismissed suggestion is back comes first, so it is not mistaken for repeated nudging.
        for (const reason of promotionText(suggestion)) card.append(el('p', 'px-1.5 py-0.5 rounded bg-tertiary-container text-tertiary', reason));
        if (suggestion.description) card.append(el('p', 'text-on-surface-variant', suggestion.description));
        if (suggestion.goal) card.append(el('p', 'text-on-surface-variant', `Goal: ${suggestion.goal}`));
        for (const trigger of suggestion.triggers ?? []) card.append(el('p', 'text-on-surface-variant', trigger.text));
        for (const fact of suggestion.facts ?? []) card.append(el('p', 'text-on-surface-variant text-[11px]', fact.text));
        for (const unknown of suggestion.unknowns ?? []) card.append(el('p', 'text-outline text-[11px]', unknown));
        for (const reference of suggestion.references ?? []) card.append(el('p', 'text-outline text-[11px]', referenceText(reference)));
        const dismissal = preserved ? row.dismissal : suggestion.dismissal;
        if (dismissal?.reason) card.append(el('p', 'text-outline text-[11px]', dismissal.reason));
        if (preserved) card.append(el('p', 'text-on-surface-variant', 'This suggestion is not current. Its dismissal is preserved.'));
        if (dismissed || preserved) card.append(button('Show again', safe(() => record(restoreOperation(suggestion.id)))));
        else card.append(button('Dismiss', safe(() => record(dismissOperation(suggestion)))), promptControls(suggestion));
        section.append(card);
      }
      groups.append(section);
    }
    if (value && !groupImprovements(value).some(group => group.rows.length)) groups.append(el('p', 'text-on-surface-variant', 'No improvements were suggested by the fixed rules.'));
  }
  async function check() {
    if (!(client.draft || client.intent)) return;
    const current = ++attempt, revision = client.revision;
    // Capture the request before loading settings, so another request cannot change its goal.
    const requestedGoal = goal.value.trim(); pending = true; failed = false; render();
    let result;
    try {
      const clients = await loadClients();
      if (current !== attempt) return;
      if (revision !== client.revision) { pending = false; render(); return; }
      result = await client.checkImprovements({ clients, ...(requestedGoal ? { goal: requestedGoal } : {}) });
    } catch (error) { result = { status: 'refused', error: error.message }; }
    if (current !== attempt) return;
    pending = false;
    if (revision !== client.revision || result?.status === 'superseded') { render(); return; }
    failed = result?.status !== 'ok';
    value = failed ? undefined : result.value;
    if (failed) showStatus(diagnostic(result));
    render();
  }
  function open() { attempt++; value = undefined; goal.value = ''; return check(); }
  render();
  return { node, render, check, open };
}
