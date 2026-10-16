const CATEGORIES = ['content', 'software', 'client', 'environment'];
const LABELS = { content: 'Content', software: 'Software', client: 'Client', environment: 'Environment' };
const REASONS = { 'sources-unavailable': 'sources are unavailable', 'no-supported-reader': 'no supported reader in this Workbench', 'check-failed': 'the check could not be completed', 'not-checked': 'not checked yet' };
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
export const factText = fact => `${fact.kind === 'authority' ? 'Authority' : fact.kind === 'evidence' ? 'Evidence' : 'Availability'}: ${fact.message}`;
export function categoryLine(row) {
  return `${LABELS[row.category] ?? row.category}: ${row.state === 'not-selected' ? 'not selected' : row.state === 'checked' ? 'checked' : `unknown — ${REASONS[row.reason] ?? row.reason ?? 'not checked yet'}`}`;
}

export function updatesState(previous, result, selected) {
  const value = result?.status === 'ok' ? result.value : null;
  const categories = CATEGORIES.map(category => !selected.includes(category) ? { category, state: 'not-selected', selected: false }
    : { category, state: 'unknown', reason: 'check-failed', ...value?.categories?.find(row => row.category === category), selected: true });
  const unknownCategories = categories.filter(row => row.state === 'unknown').map(row => row.category);
  const retained = (previous?.value?.updates ?? []).filter(row => unknownCategories.includes(row.category));
  const stale = !value || retained.length > 0 || !!(previous?.value?.checkedAt && categories.some(row => row.category === 'content' && row.state === 'unknown'));
  const updates = value ? [...(value.updates ?? []), ...retained.filter(old => !value.updates?.some(row => row.id === old.id))] : previous?.value?.updates ?? [];
  const preserved = value?.preserved ?? previous?.value?.preserved ?? [];
  return { value: { ...value, updates, preserved, categories, checkedAt: stale ? previous?.value?.checkedAt : categories.some(row => row.state === 'checked') ? value?.checkedAt : undefined },
    unknown: unknownCategories.length > 0, stale, failed: !value || !categories.some(row => row.state === 'checked') };
}
export function checkedLine(state) {
  const time = state?.value?.checkedAt;
  if (!time) return state?.failed ? 'The check could not be completed; updates are unknown.' : 'Updates are unknown until checked.';
  return `${state.stale ? 'Updates as of' : 'Last checked'} ${time}.${state.unknown ? ' Some updates are unknown.' : ''}`;
}

export function createUpdatesView({ client, el, button, showStatus }) {
  const node = el('section', 'p-3 border border-wb-border rounded bg-surface-container-low space-y-2'); node.id = 'policy-updates';
  const checked = el('p', 'text-on-surface-variant'); checked.id = 'policy-updates-checked'; checked.setAttribute('role', 'status');
  const categoryRows = el('div', 'space-y-1'), groups = el('div', 'space-y-2');
  const controls = el('div', 'flex flex-wrap items-center gap-2');
  let state, pending = false, attempt = 0;
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
  node.append(el('h3', 'font-medium', 'Available updates'), el('p', 'text-on-surface-variant', UPDATES_NOTE), controls, checked, categoryRows, groups);
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
    node.hidden = !client.draft;
    if (!client.draft) { attempt++; state = undefined; pending = false; return; }
    checkNow.disabled = pending || selected.size === 0;
    checked.textContent = pending ? `Checking… ${checkedLine(state)}` : checkedLine(state);
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
  async function check() {
    if (!client.draft || !selected.size) return;
    const current = ++attempt, revision = client.revision; pending = true; render();
    let result;
    try { result = await client.checkMaintenance(selection()); }
    catch { result = null; }
    if (current !== attempt) return;
    pending = false;
    if (client.revision !== revision || result?.status === 'superseded') { render(); return; }
    state = updatesState(state, result, selection()); render();
  }
  render();
  return { node, render, check, open: check };
}
