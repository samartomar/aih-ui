// "Installed in this project": Core's managed inventory grouped by chosen item (installed-list.js), each with
// a two-step Remove (installed-removal.js). It reads the inventory itself; Install and Remove refresh it, and
// it tells the Install panel whether Core lists the whole setup as installed.

import { groupInstalled } from './installed-list.js';
import { cancelRemoval, confirmRemoval, previewRemoval } from './installed-removal.js';
import { compact } from './compact.js';
import { iconSpan } from './icons.js';
import { attachTooltip } from './tooltip.js';

// What Core's redacted 1.1 projection said about one installed selection, each state with its own icon,
// tooltip and wording. Core owns these states; nothing here recomputes them (#167).
const STATE_WORDS = {
  'update-available': ['update-available', 'Update available', 'Core reports a newer offered version of this item.'],
  'no-longer-offered': ['no-longer-offered', 'No longer offered', 'Core no longer finds this item in the offered index supplied to it.'],
  superseded: ['no-longer-offered', 'Superseded', 'Core reports this item replaced by another.'],
  revoked: ['no-longer-offered', 'Revoked', 'Core reports this item revoked.'],
  changed: ['changed-since-install', 'Changed since install', 'Core found installed files that differ from what was reviewed.'],
  missing: ['changed-since-install', 'Missing since install', 'Core found installed files missing.'],
  'block-changed': ['block-edited', 'AIH block edited', 'Core found a managed text block edited by hand.'],
  'block-missing': ['changed-since-install', 'AIH block missing', 'Core found a managed text block missing.'],
  interrupted: ['interrupted', 'Install interrupted', 'Core reports this selection’s installation was interrupted.'],
  'granted-by-aih': ['needs-ok', 'OK granted by AIH', 'The one-server approval was written by AIH as reviewed.'],
  needed: ['needs-ok', 'Needs your OK', 'The tool still needs your OK for this item.'],
  'policy-refused': ['policy-refused', 'Organization policy', 'Organization policy state for this item; it is not an offered-index answer.'],
};
function stateBadges(state = {}, el) {
  const chips = [];
  const add = (key, extra) => { const words = STATE_WORDS[key]; if (!words) return;
    const chip = el('span', 'inline-flex items-center gap-1 text-[11px]', ''); chip.dataset.installedState = key;
    chip.append(iconSpan('state', words[0]), el('span', '', words[1])); attachTooltip(chip, `${words[2]}${extra ? ` ${extra}` : ''}`); chips.push(chip); };
  if (state.update && state.update !== 'current' && state.update !== 'unknown') add(state.update);
  for (const distinct of state.files ?? (state.file && !['matches', 'unchecked', 'unknown'].includes(state.file) ? [state.file] : [])) add(distinct);
  if (state.install === 'interrupted') add('interrupted');
  if (state.approval === 'granted-by-aih') add('granted-by-aih');
  else if (state.approval === 'needed') add('needed');
  // A policy refusal is an organization answer, never 'no longer offered' (Q8).
  if (state.policy && !['permitted', 'recommended', 'unknown'].includes(state.policy)) add('policy-refused', `Organization policy: ${state.policy}.`);
  return chips;
}

export function createInstalledPanel({ client, el, button, onRemoved = () => {}, onInventory = () => {} }) {
  const node = el('section', 'p-3 rounded border border-wb-border bg-surface-container-low space-y-2'); node.id = 'installed-panel'; node.hidden = true;
  const title = el('h3', 'text-sm font-semibold text-on-surface', 'Installed in this project');
  const note = el('p', 'text-on-surface-variant'); note.id = 'installed-note'; note.setAttribute('role', 'status'); note.setAttribute('aria-live', 'polite');
  const list = el('ul', 'space-y-1'); list.id = 'installed-list';
  const message = el('p', 'text-on-surface'); message.id = 'installed-message'; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  node.append(title, note, list, message);

  let inventoryRead = 0, removing = false;
  const policyDocument = () => { try { return JSON.parse(new TextDecoder().decode(client.bytes)); } catch { return undefined; } };
  const label = itemId => { const item = client.catalog?.items.find(entry => entry.id === itemId); return item ? item.label ?? item.id : undefined; };
  const requestHost = (operation, body) => client.requestHost(operation, body);
  const available = () => Boolean(client.catalog);

  // The steps of one preview round: each item's message and the files Core would remove.
  function stepRows(preview) {
    return preview.steps.map(step => {
      const row = el('div', 'space-y-0.5');
      row.append(el('p', 'font-medium', `${step.entry.name}: ${step.message}`));
      if (step.files?.length) { const paths = el('ul', 'space-y-0.5 font-mono text-[11px]'); paths.append(...step.files.map(file => el('li', '', `${file.action}  ${file.path}`))); row.append(paths); }
      return row;
    });
  }

  // One Remove: preview first; each Confirm remove applies what was shown, and asks again for files not yet shown.
  function removeControl(entries, kept = []) {
    const area = el('div', 'space-y-2'); area.hidden = true;
    const close = () => { area.hidden = true; area.replaceChildren(); };
    function showRound(preview, mode, results) {
      const actions = el('div', 'flex flex-wrap gap-2');
      const cancel = button('Cancel', async () => {
        close();
        if (!results.length) { message.textContent = ''; return; }
        // Earlier confirmations may already have deleted files. Stopping future rounds must
        // retain that outcome, refresh inventory and invalidate the old Install success.
        const stopped = cancelRemoval({ preview, results });
        message.textContent = stopped.message; message.dataset.outcome = stopped.outcome;
        await refresh({ keepMessage: true }); onRemoved();
      });
      const confirm = button('Confirm remove', async () => {
        if (removing) return;
        removing = true; confirm.disabled = true; cancel.disabled = true; confirm.setAttribute('aria-busy', 'true'); message.textContent = 'Removing…';
        let done;
        try { done = await confirmRemoval({ preview, request: requestHost, mode, results }); message.textContent = done.message; message.dataset.outcome = done.outcome; }
        catch (error) { message.textContent = `Remove did not finish: ${error.message}. Check the list.`; message.dataset.outcome = 'failed'; }
        finally { removing = false; }
        if (done?.next) { showRound(done.next, mode, done.results); return; }
        close(); await refresh({ keepMessage: true }); onRemoved();
      }, true);
      confirm.disabled = !preview.canConfirm;
      actions.append(confirm, cancel);
      area.replaceChildren(...stepRows(preview), ...kept.map(item => el('p', 'text-on-surface-variant', `Kept: ${item.name}, still needed by ${item.neededBy.join(', ')}.`)),
        el('p', 'text-on-surface-variant', preview.note), actions);
      area.hidden = false;
    }
    const remove = compact(button('Remove', async () => {
      if (removing) return;
      // The setup's own mode, forwarded as the advanced Review removal does; Core refuses what it does not accept.
      const mode = policyDocument()?.mode;
      if (mode === undefined) { message.textContent = 'Remove did not start: this page cannot read the setup. Nothing was removed.'; return; }
      removing = true; remove.disabled = true; remove.setAttribute('aria-busy', 'true'); delete message.dataset.outcome; message.textContent = 'Checking which files would be removed…';
      try {
        const preview = await previewRemoval({ entries, request: requestHost, mode });
        showRound(preview, mode, []);
        message.textContent = preview.canConfirm ? 'Nothing has been removed yet. Check the files, then confirm.' : 'Remove cannot go ahead. Nothing was removed.';
      } catch (error) { message.textContent = `Remove did not start: ${error.message}`; }
      finally { removing = false; remove.disabled = false; remove.removeAttribute('aria-busy'); }
    }), 'ml-auto');
    return { remove, area };
  }

  function show(view) {
    list.replaceChildren();
    if (!view.readable) { note.textContent = `Cannot show what is installed: ${view.reason}`; return; }
    note.textContent = view.partial ? 'This list may be incomplete: Core could not read everything installed in this project.' : '';
    if (!view.groups.length && !view.others.length) { note.textContent = [note.textContent, 'Nothing from Workbench is installed in this project.'].filter(Boolean).join(' '); return; }
    // Build every interactive row once - badges, removal controls and preview areas unchanged - then
    // place each row under its recorded exact set identity (Q7-R). Simultaneous memberships render in
    // their first set with an "Also in" note (actions are never duplicated); no-origin rows stay explicit.
    const pending = new Map();
    const states = new Map(view.groups.flatMap(group => [[group.managementId, group.state], ...group.needed.map(item => [item.managementId, item.state])]));
    for (const group of view.groups) {
      const row = el('li', 'space-y-1'); row.dataset.installedItem = group.itemId; row.title = group.managementId;
      const { remove, area } = removeControl(group.removes, group.kept);
      const head = el('div', 'flex flex-wrap items-center gap-2'); head.append(el('span', 'font-medium', group.name));
      head.append(...stateBadges(group.state, el));
      if (group.sets?.length) head.append(el('span', 'text-on-surface-variant text-[11px]', `From set ${group.sets.map(set => set.setId).join(', ')}`));
      if (group.needed.length) {
        const fold = el('details', 'text-on-surface-variant'); fold.append(el('summary', '', `+ ${group.needed.length} it needs`));
        const members = el('ul', 'pl-3 space-y-0.5');
        for (const item of group.needed) {
          const member = el('li', 'flex flex-wrap items-center gap-2 text-[11px]', ''); member.dataset.installedNeeded = item.managementId;
          member.append(el('span', '', item.name), ...stateBadges(item.state, el)); members.append(member);
        }
        fold.append(members); head.append(fold);
      }
      head.append(remove); row.append(head, area);
      pending.set(group.managementId, { row, kind: 'chosen' });
    }
    for (const item of view.others) {
      const row = el('div', 'space-y-1'); row.dataset.installedOther = item.managementId;
      const { remove, area } = removeControl([item]);
      // The full installed id stays in the tooltip (#137).
      const name = el('span', 'font-medium break-all', item.name); name.title = item.managementId;
      const head = el('div', 'flex flex-wrap items-center gap-2'); head.append(name);
      head.append(...stateBadges(item.state, el));
      if (item.sets?.length) head.append(el('span', 'text-on-surface-variant text-[11px]', `From set ${item.sets.map(set => set.setId).join(', ')}`));
      if (!item.inSetup) head.append(el('span', 'text-on-surface-variant', 'Not in your setup'));
      head.append(remove); row.append(head, area);
      states.set(item.managementId, item.state);
      pending.set(item.managementId, { row, kind: 'other' });
    }
    const memberships = new Map();
    for (const group of view.originGroups ?? []) {
      if (!group.set) continue;
      for (const id of group.items) memberships.set(id, [...(memberships.get(id) ?? []), group.set]);
    }
    const rendered = new Set();
    for (const group of view.originGroups ?? []) {
      if (!group.set) continue;
      const section = el('li', 'space-y-1'); section.dataset.installedSet = `${group.set.setId}/${group.set.setSha256}`;
      const heading = el('p', 'text-[11px] font-medium text-on-surface-variant', `${group.set.setId} · exact set ${group.set.setSha256}`);
      heading.title = `${group.set.framework}/${group.set.setId}/${group.set.setSha256}`;
      const rows = el('ul', 'space-y-1');
      let any = false;
      for (const id of group.items) {
        const entry = pending.get(id);
        if (entry && !rendered.has(id)) {
          rendered.add(id); any = true;
          const all = memberships.get(id) ?? [];
          // Q7-R2: every further membership keeps its exact identity, not a bare id.
          if (all.length > 1) entry.row.children[0].append(el('span', 'text-on-surface-variant text-[11px]', `Also in: ${all.slice(1).map(set => `${set.setId} · ${set.setSha256}`).join(', ')}`));
          rows.append(entry.row);
        } else {
          // No interactive row here (folded under a chosen root, or already placed in another set):
          // keep a visible named read-only reference so the exact group/member identity never vanishes.
          const member = (group.members ?? []).find(candidate => candidate.managementId === id);
          const ref = el('li', 'text-[11px] text-on-surface-variant');
          ref.append(el('span', '', member?.name ?? id), ...stateBadges(states.get(id), el));
          ref.title = id; ref.dataset.setReference = id; any = true;
          rows.append(ref);
        }
      }
      if (any) { section.append(heading, rows); list.append(section); }
    }
    const leftoverChosen = [...pending.entries()].filter(([id, entry]) => !rendered.has(id) && entry.kind === 'chosen');
    const leftoverOther = [...pending.entries()].filter(([id, entry]) => !rendered.has(id) && entry.kind === 'other');
    if (leftoverChosen.length) {
      const section = el('li', 'space-y-1');
      if (rendered.size) section.append(el('p', 'text-[11px] font-medium text-on-surface-variant', 'Chosen items'));
      const rows = el('ul', 'space-y-1'); rows.append(...leftoverChosen.map(([, entry]) => entry.row)); section.append(rows); list.append(section);
    }
    if (leftoverOther.length) {
      // Named apart only when chosen items are listed above them.
      const section = el('li', 'space-y-1');
      if (leftoverChosen.length || rendered.size) section.append(el('p', 'text-[11px] font-medium text-on-surface-variant', 'Other installed items'));
      const rows = el('ul', 'space-y-1'); rows.append(...leftoverOther.map(([, entry]) => entry.row)); section.append(rows); list.append(section);
    }
  }

  /** Reads the inventory again. It reads nothing from the draft and must not supersede Install; a folder change supersedes it. */
  async function refresh({ keepMessage = false } = {}) {
    node.hidden = !available();
    if (node.hidden || removing) return;
    const read = ++inventoryRead;
    if (!keepMessage) { message.textContent = ''; delete message.dataset.outcome; }
    if (!client.catalog.executionAvailable) { list.replaceChildren(); note.textContent = 'Choose a project folder above to see what is installed there.'; onInventory(undefined); return; }
    note.textContent = 'Checking what is installed…';
    try {
      const inventory = await client.requestCurrent('managed');
      if (read !== inventoryRead || inventory?.status === 'superseded') return;
      const view = groupInstalled({ inventory, policy: policyDocument(), intent: client.intent, label });
      show(view); onInventory(view);
    } catch (error) { if (read === inventoryRead) { list.replaceChildren(); note.textContent = `Cannot show what is installed: ${error.message}`; onInventory(undefined); } }
  }
  // A different project folder: the list and any removal still being previewed belong to the old one.
  function clear() { inventoryRead++; list.replaceChildren(); message.textContent = ''; delete message.dataset.outcome; note.textContent = 'Checking what is installed…'; }
  return { node, heading: title, refresh, clear, get busy() { return removing; } };
}
