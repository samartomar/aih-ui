// Mirrors MAINTENANCE_DISPOSITION_RECORD_SCHEMA in tools/consumer/maintenance-record.mjs, the source of truth; the page cannot import it.
export const DISPOSITION_RECORD = 'urn:aihq:workbench:journey-record:maintenance-disposition:1.0.0';
const CATEGORIES = ['content', 'software', 'client', 'environment'];
const LABELS = { content: 'Content', software: 'Software', client: 'Client', environment: 'Environment' };
const REASONS = { 'sources-unavailable': 'sources are unavailable', 'no-configured-source': 'no update source is configured on this host', 'no-supported-reader': 'no supported reader in this Workbench', 'check-failed': 'the check could not be completed', 'not-checked': 'not checked yet' };
// Mirrors RELEASE_ORDER_TEXT in tools/consumer/release-order.mjs, the source of truth; the page cannot import it.
const ORDER_TEXT = "order declared by this host's update source";
const SOURCE_REASONS = { unreadable: 'could not be read', invalid: 'not a valid Catalog release', 'package-mismatch': 'a different package from the one this Workbench installs' };
const ORDER_REASONS = { 'not-in-source': "the selected revision is not in this host's update source", ambiguous: 'listed both before and after it' };
export const UPDATES_NOTE = 'Opening and Check now only read the supplied sources; nothing is applied or scheduled. A defer date is only considered when the Workbench is opened or checked. Save the draft to keep your choices.';

export function groupUpdates(value) {
  const rows = value?.updates ?? [];
  return [
    { label: 'Needs attention', rows: rows.filter(row => row.promoted) },
    { label: 'Kept current', rows: rows.filter(row => !row.promoted && row.disposition?.disposition === 'keep-current') },
    { label: 'Skipped revisions', rows: rows.filter(row => !row.promoted && row.disposition?.disposition === 'skip') },
    { label: 'Deferred', rows: rows.filter(row => !row.promoted && row.disposition?.disposition === 'defer') },
    { label: 'Preserved choices', rows: value?.preserved ?? [] },
  ];
}
export function updateLabel(row, catalog) {
  const ref = row.subject;
  const item = catalog?.items?.find(item => item.id === ref.itemId && item.root?.releaseSha256 === ref.releaseSha256);
  return `${item?.label ?? ref.itemId} · ${row.package?.name ?? LABELS[row.category] ?? row.category}${row.package?.version ? ` ${row.package.version}` : ''}`;
}
export function dispositionText(row) {
  const record = row.disposition;
  if (row.attention === 'defer-date-reached') return `Defer date reached (${record?.deferUntil}); needs attention.`;
  if (!record) return 'New revision available.';
  if (record.disposition === 'keep-current') return 'Keep current — this update remains available.';
  if (record.disposition === 'skip') return 'Skipped this exact revision.';
  return record.deferUntil ? `Deferred until ${record.deferUntil}.` : 'Deferred until you revisit it.';
}
// The lines that say where updates come from; the order is the host's declaration, never a Catalog or producer fact.
export function updateSourceLines(source) {
  if (source?.kind === 'test-fixture') return [{ text: 'Test fixture source — not a real update source.' }];
  if (source?.kind !== 'catalog-roots') return [];
  const count = source.sources?.length ?? 0;
  return [{ text: `Update source: ${count} Catalog package root${count === 1 ? '' : 's'} configured by this host. Later entries are newer — ${ORDER_TEXT}.` },
    ...(source.sources ?? []).map(row => row.state === 'read'
      ? { text: `Source ${row.position}: ${row.package?.name}${row.package?.version ? ` ${row.package.version}` : ''} · release ${row.releaseSha256} — read ${row.readAt}`, mono: true }
      : { text: `Source ${row.position}: offline (${SOURCE_REASONS[row.reason] ?? row.reason}) — ${row.lastReadAt ? `last read ${row.lastReadAt}` : 'never read in this session'}` })];
}
export function orderLine(order) {
  if (order?.relation === 'newer') return `Newer than your selected revision (${ORDER_TEXT}).`;
  if (order?.relation === 'unknown') return `Order relative to your selected revision is unknown (${ORDER_REASONS[order.reason] ?? order.reason}).`;
  return '';
}
export const factText = fact => `${fact.kind === 'authority' ? 'Authority' : fact.kind === 'evidence' ? 'Evidence' : 'Availability'}: ${fact.message}`;
export function categoryLine(row) {
  return `${LABELS[row.category] ?? row.category}: ${row.state === 'not-selected' ? 'not selected' : row.state === 'checked' ? 'checked' : `unknown — ${REASONS[row.reason] ?? row.reason ?? 'not checked yet'}`}`;
}

// The shown row follows the choice currently recorded: none means a new revision, a reached defer date needs attention again.
function withChoice(row, record, today) {
  const attention = !record ? 'new' : record.disposition === 'defer' && record.deferUntil !== undefined && record.deferUntil <= today ? 'defer-date-reached' : null;
  return { ...row, disposition: record ?? null, attention, promoted: attention !== null };
}
// `dispositions` are the envelope's recorded choices; they stand in for the response when the check produced none.
export function updatesState(previous, result, selected, dispositions) {
  const value = result?.status === 'ok' ? result.value : null;
  const categories = CATEGORIES.map(category => !selected.includes(category) ? { category, state: 'not-selected', selected: false }
    : { category, state: 'unknown', reason: 'check-failed', ...value?.categories?.find(row => row.category === category), selected: true });
  const unknownCategories = categories.filter(row => row.state === 'unknown').map(row => row.category);
  const retained = (previous?.value?.updates ?? []).filter(row => unknownCategories.includes(row.category));
  // A check recorded in the saved envelope stands in for the last seen one after a reopen.
  const lastCheck = value?.lastCheck ?? previous?.value?.lastCheck, seen = previous?.value?.checkedAt ?? lastCheck?.checkedAt;
  const stale = !value || retained.length > 0 || !!(seen && categories.some(row => row.category === 'content' && row.state === 'unknown'));
  const current = value ? [...(value.updates ?? []).map(row => row.disposition), ...(value.preserved ?? []).map(entry => entry.record)].filter(Boolean) : dispositions;
  const today = (value?.checkedAt ?? previous?.value?.checkedAt ?? '').slice(0, 10);
  const kept = value ? retained.filter(old => !value.updates?.some(row => row.id === old.id)) : previous?.value?.updates ?? [];
  const rederived = current ? kept.map(row => withChoice(row, current.find(record => record.id === row.id), today)) : kept;
  const updates = value ? [...(value.updates ?? []), ...rederived] : rederived;
  // A choice already shown as a retained row is not listed a second time as an unknown preserved one.
  const shown = new Set(updates.map(row => row.disposition?.id).filter(Boolean));
  // Without a response the kept entries answer to the envelope's current choices: a revisited one is gone.
  const answered = value || !dispositions ? () => true : entry => dispositions.some(record => record.id === entry.record?.id);
  const preserved = (value?.preserved ?? previous?.value?.preserved ?? []).filter(entry => !shown.has(entry.record?.id) && answered(entry));
  const updateSource = value?.updateSource ?? previous?.value?.updateSource;
  return { value: { ...value, updates, preserved, categories, lastCheck, ...(updateSource ? { updateSource } : {}), checkedAt: stale ? seen : categories.some(row => row.state === 'checked') ? value?.checkedAt : undefined },
    unknown: unknownCategories.length > 0, stale, failed: !value || !categories.some(row => row.state === 'checked') };
}
export function checkedLine(state) {
  const time = state?.value?.checkedAt;
  if (!time) return state?.failed ? 'The check could not be completed; updates are unknown.' : 'Updates are unknown until checked.';
  return `${state.stale ? 'Updates as of' : 'Last checked'} ${time}.${state.unknown ? ' Some updates are unknown.' : ''}`;
}

// The check recorded in the draft, shown while this page has no newer check of its own.
export function recordedLine(state) {
  const note = state?.value?.lastCheck;
  return note && state.stale ? `Recorded in this draft: ${note.checkedAt} — ${note.categories.map(categoryLine).join('; ')}.` : '';
}

export function createUpdatesView({ client, el, button, showStatus }) {
  const node = el('section', 'p-3 border border-wb-border rounded bg-surface-container-low space-y-2'); node.id = 'policy-updates';
  const checked = el('p', 'text-on-surface-variant'); checked.id = 'policy-updates-checked'; checked.setAttribute('role', 'status');
  const recordedNote = el('p', 'text-outline text-[11px]'); recordedNote.id = 'policy-updates-recorded';
  // Not a div: the browser proof reads the category lines as the second div of the view.
  const sourceNode = el('section', 'space-y-1'); sourceNode.id = 'policy-updates-source';
  const categoryRows = el('div', 'space-y-1'), groups = el('div', 'space-y-2');
  const controls = el('div', 'flex flex-wrap items-center gap-2');
  // The last successful check seen by this page, and the newest check time the envelope is known to record.
  let state, pending = false, attempt = 0, lastSuccess, recorded;
  const selected = new Set(['content']);
  const selection = () => CATEGORIES.filter(category => selected.has(category));
  const safe = action => async () => { try { await action(); } catch (error) { showStatus(error.message); } };
  const checkNow = button('Check now', () => check()); checkNow.id = 'policy-updates-check';
  for (const category of CATEGORIES) {
    const label = el('label', 'flex items-center gap-1 text-on-surface-variant');
    const input = el('input'); input.type = 'checkbox'; input.checked = selected.has(category); input.setAttribute('aria-label', `Check ${LABELS[category].toLowerCase()} updates`);
    input.addEventListener('change', () => {
      if (input.checked) selected.add(category); else selected.delete(category);
      attempt++; pending = false;
      if (state) state = { ...state, unknown: true, stale: true, value: { ...state.value, categories: CATEGORIES.map(category => ({ category, selected: selected.has(category), state: selected.has(category) ? 'unknown' : 'not-selected', reason: 'not-checked' })) } };
      render();
    });
    label.append(input, el('span', '', LABELS[category])); controls.append(label);
  }
  controls.append(checkNow);
  node.append(el('h3', 'font-medium', 'Available updates'), el('p', 'text-on-surface-variant', UPDATES_NOTE), controls, checked, recordedNote, sourceNode, categoryRows, groups);
  const diagnostic = result => result?.diagnostics?.map(row => row.message).join(' ') || result?.error || 'The update choice could not be saved.';
  async function record(operation) {
    const result = await client.recordDisposition(operation);
    if (result.status === 'superseded') return;
    if (result.status !== 'ok') return showStatus(diagnostic(result));
    showStatus('Update choice recorded. Save the draft to keep it. Nothing was applied or scheduled.');
    await check();
  }
  function actions(row, preserved = false) {
    const controls = el('div', 'flex flex-wrap items-center gap-2');
    if (!preserved) {
      const set = disposition => ({ type: 'set', category: row.category, subject: row.subject, scope: row.scope, candidate: row.candidate, disposition });
      const date = el('input', 'bg-wb-input border border-wb-border rounded p-1 text-[11px]'); date.type = 'date'; date.value = row.disposition?.deferUntil ?? ''; date.setAttribute('aria-label', `Optional defer date for ${updateLabel(row, client.catalog)}`);
      controls.append(button('Keep current', safe(() => record(set('keep-current')))), button('Skip this revision', safe(() => record(set('skip')))),
        date, button('Defer', safe(() => record({ ...set('defer'), ...(date.value ? { deferUntil: date.value } : {}) }))));
    }
    const existing = preserved ? row.record : row.disposition;
    if (existing) controls.append(button('Revisit', safe(() => record({ type: 'clear', id: existing.id }))));
    return controls;
  }
  function render() {
    // A draft, or an ordinary policy that is open: both are checked, and a choice on a policy saves it as a draft.
    const available = client.draft || client.intent;
    node.hidden = !available;
    if (!available) { attempt++; state = undefined; pending = false; lastSuccess = undefined; recorded = undefined; return; }
    checkNow.disabled = pending || selected.size === 0;
    checked.textContent = pending ? `Checking… ${checkedLine(state)}` : checkedLine(state);
    recordedNote.textContent = recordedLine(state); recordedNote.hidden = !recordedNote.textContent;
    const sourceLines = updateSourceLines(state?.value.updateSource);
    sourceNode.replaceChildren(...sourceLines.map(line => el('p', line.mono ? 'font-mono text-[10px] text-outline break-all' : 'text-on-surface-variant text-[11px] break-words', line.text))); sourceNode.hidden = !sourceLines.length;
    const currentCategories = state?.value.categories ?? CATEGORIES.map(category => ({ category, state: selected.has(category) ? 'unknown' : 'not-selected', reason: 'not-checked' }));
    categoryRows.replaceChildren(...currentCategories.map(row => el('p', 'text-outline text-[11px]', categoryLine(row))));
    if (!selected.size) categoryRows.append(el('p', 'text-outline', 'Select at least one update category to check.'));
    groups.replaceChildren();
    for (const group of groupUpdates(state?.value)) {
      if (!group.rows.length) continue;
      const section = el('div', 'space-y-1'); section.append(el('h4', 'font-medium', group.label));
      for (const row of group.rows) {
        const preserved = group.label === 'Preserved choices', item = preserved ? row.record : row;
        const entry = el('div', 'p-2 border border-wb-border rounded space-y-1');
        entry.append(el('p', 'font-medium', updateLabel(item, client.catalog)), el('p', 'font-mono text-[10px] text-outline break-all', `${item.scope} · revision ${item.candidate.releaseSha256}`));
        if (!preserved) entry.append(el('p', 'font-mono text-[10px] text-outline break-all', `Selected: release ${item.subject.releaseSha256} · item ${item.subject.itemSha256}`),
          el('p', 'font-mono text-[10px] text-outline break-all', `Offered: release ${item.candidate.releaseSha256} · item ${item.candidate.itemSha256}`));
        if (!preserved && item.order) entry.append(el('p', 'text-on-surface-variant text-[11px] break-words', orderLine(item.order)));
        const description = preserved ? `${dispositionText({ disposition: item })} ${row.state === 'orphaned' ? 'Its saved choice is no longer in this draft.' : row.state === 'not-offered' ? 'This revision was not offered in this check.' : 'Availability is unknown.'}` : dispositionText(row);
        entry.append(el('p', 'px-1.5 py-0.5 rounded border border-wb-border text-on-surface-variant text-[10px]', description));
        for (const fact of item.facts ?? []) entry.append(el('p', 'text-on-surface-variant text-[11px] break-words', factText(fact)));
        if (item.reason) entry.append(el('p', 'text-outline text-[11px]', item.reason));
        entry.append(actions(row, preserved)); section.append(entry);
      }
      groups.append(section);
    }
    if (state && !pending && !state.unknown && !state.value.updates.length && !state.value.preserved.length) groups.append(el('p', 'text-on-surface-variant', 'No updates were offered in the checked categories.'));
  }
  // The choices the draft envelope itself records, or undefined when this page holds no envelope.
  const recordedChoices = () => client.draft?.envelope?.records?.filter(record => record.schema === DISPOSITION_RECORD);
  async function check() {
    if (!(client.draft || client.intent) || !selected.size) return;
    const current = ++attempt, revision = client.revision; pending = true; render();
    let result;
    try { result = await client.checkMaintenance(selection()); }
    catch { result = null; }
    if (current !== attempt) return;
    pending = false;
    if (client.revision !== revision || result?.status === 'superseded') { render(); return; }
    state = updatesState(state, result, selection(), recordedChoices());
    const value = result?.status === 'ok' ? result.value : null, note = value?.lastCheck?.checkedAt;
    // A recorded note later than this check (hand-edited or from a skewed clock) never blocks later notes.
    if (note && note <= value.checkedAt && (!recorded || note > recorded)) recorded = note;
    if (value && value.categories.some(row => row.state === 'checked'))
      lastSuccess = { checkedAt: value.checkedAt, categories: value.categories.map(({ category, state: outcome, reason }) => ({ category, state: outcome, ...(reason ? { reason } : {}) })) };
    render();
  }
  // Saving an envelope records the last successful check first, when it is newer than the one the envelope holds.
  // A refused or failed note never stops the save.
  async function noteCheck() {
    if (!client.draft || !lastSuccess || (recorded && recorded >= lastSuccess.checkedAt)) return;
    const sent = lastSuccess;
    try {
      const result = await client.recordDisposition({ type: 'note-check', ...sent });
      if (result?.status === 'ok') recorded = sent.checkedAt;
    } catch { /* The draft is saved as it is. */ }
  }
  // Opening starts from nothing known about this artifact, then reads once.
  function open() { attempt++; state = undefined; lastSuccess = undefined; recorded = undefined; return check(); }
  render();
  return { node, render, check, open, noteCheck };
}
