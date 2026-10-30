// "Installed in this project": Core's managed inventory grouped by chosen item (installed-list.js), with
// reviewed Update and Remove lifecycle operations. It reads the inventory itself; lifecycle results refresh it,
// and it tells the Install panel whether Core lists the whole setup as installed.

import { itemDisplayName } from '../catalog/item-name.js';
import { groupInstalled, keptWords, setLabeller, setRemovalEntries, stillNeededWords } from './installed-list.js';
import { KEPT_FOR_ANOTHER, cancelRemoval, confirmRemoval, previewRemoval, removalMemberWords } from './installed-removal.js';
import { confirmUpdate, previewUpdate, updateEntries } from './installed-update.js';
import { compact } from './compact.js';
import { iconSpan } from './icons.js';

// What Core's redacted 1.1 projection said about one installed selection, each state with its own icon and the
// contract's sentence (workbench-reads, "Your setup", and amendment 3.2.3). Core owns these states; nothing here
// recomputes them (#167). A selection in none of these states shows no state: the list itself is what Core installed,
// so no row says a bare "Installed", and an item Core finds compliant with policy says nothing about it.
const STATE_WORDS = {
  'update-available': ['update-available', () => 'Update available'],
  // Inventory 1.1 returns no replacement names and no reason an item is no longer offered or was revoked, which
  // "Replaced by {names}" and the contract's reason sentences need.
  // Contract amendment 3.2.3 rows 1, 2 and 3 (owner-approved 2026-10-30).
  superseded: ['replaced', () => 'Replaced in the release index; still installed'],
  'no-longer-offered': ['no-longer-offered', () => 'No longer offered; still installed'],
  revoked: ['no-longer-offered', () => 'Withdrawn from the release index; still installed'],
  changed: ['changed-since-install', () => 'Changed since install (your tool already uses the changed copy)'],
  // Contract amendment 3.2.3 row 4 (owner-approved 2026-10-30).
  missing: ['changed-since-install', () => 'Some of its files are missing'],
  unchecked: ['changed-since-install', () => 'Not checked yet'],
  // Contract amendment 3.2.3 row 5 (owner-approved 2026-10-30), when Core names no file.
  'block-changed': ['block-edited', state => state.blockFiles?.length ? `The AIH block in ${blockFiles(state)} was edited` : 'A block AIH added was changed'],
  'block-missing': ['changed-since-install', state => state.blockFiles?.length ? `The AIH block in ${blockFiles(state)} is gone` : 'A block AIH added is missing'],
  interrupted: ['interrupted', state => `Install didn't finish; ${state.written ?? 0} files written`],
  'granted-by-aih': ['needs-ok', state => `Allowed by AIH in ${state.toolLabel}; removed with the server`],
  needed: ['needs-ok', state => `Installed; still needs your OK in ${state.toolLabel}`],
  'non-compliant': ['policy-refused', () => 'Doesn’t meet your organisation’s policy'],
  // Contract amendment 3.2.3 row 6 (owner-approved 2026-10-30).
  'policy-unknown': ['not-checked', () => 'Policy not checked'],
};
const blockFiles = state => state.blockFiles.map(path => path.split(/[\\/]/).pop()).join(', ');
// The states one selection shows, in order: [state, icon, words].
function stateChips(state = {}) {
  const keys = [];
  if (state.update && state.update !== 'current' && state.update !== 'unknown') keys.push(state.update);
  keys.push(...(state.files ?? (state.file && !['matches', 'unknown'].includes(state.file) ? [state.file] : [])));
  if (state.install === 'interrupted') keys.push('interrupted');
  if (state.approval === 'granted-by-aih') keys.push('granted-by-aih');
  else if (state.approval === 'needed') keys.push('needed');
  // A policy refusal is an organization answer, never 'no longer offered' (Q8). Inventory 1.1 refuses with prohibited
  // or not-admitted; required, recommended and permitted are compliant and say nothing.
  if (['prohibited', 'not-admitted'].includes(state.policy)) keys.push('non-compliant');
  else if (state.policy === 'unknown') keys.push('policy-unknown');
  // A state with no words is not shown: a raw Core value never reaches the page.
  return keys.filter(key => STATE_WORDS[key]).map(key => [key, STATE_WORDS[key][0], STATE_WORDS[key][1](state)]);
}
/** The words each state chip of one installed selection says. */
export const stateWords = state => stateChips(state).map(([, , words]) => words);
// Amendment 3.2.3 drops the chip tooltips: a chip's words are all it says.
function stateBadges(state = {}, el) {
  return stateChips(state).map(([key, icon, words]) => {
    const chip = el('span', 'inline-flex items-center gap-1 text-[11px]', ''); chip.dataset.installedState = key;
    chip.append(iconSpan('state', icon), el('span', '', words));
    return chip;
  });
}

// Contract amendment 3.2.3 rows 19 and 20 (owner-approved 2026-10-30).
export const APPLY_RUNNING_NOTE = 'Install is still running in this project folder. What is installed shows here once it has finished.';
export function createInstalledPanel({ client, el, button, onRemoved = () => {}, onFinish = () => {}, onInventory = () => {} }) {
  const node = el('section', 'p-3 rounded border border-wb-border bg-surface-container-low space-y-2'); node.id = 'installed-panel'; node.hidden = true;
  const title = el('h3', 'text-sm font-semibold text-on-surface', 'Installed in this project');
  const note = el('p', 'text-on-surface-variant'); note.id = 'installed-note'; note.setAttribute('role', 'status'); note.setAttribute('aria-live', 'polite');
  const list = el('ul', 'space-y-1'); list.id = 'installed-list';
  const message = el('p', 'text-on-surface'); message.id = 'installed-message'; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  node.append(title, note, list, message);

  let inventoryRead = 0, removing = false;
  const policyDocument = () => { try { return JSON.parse(new TextDecoder().decode(client.bytes)); } catch { return undefined; } };
  // Catalog's display.name (1.7 publishes it as `name`), with a rule's or skill's namespace in brackets, as the cards name it.
  const label = itemId => {
    const item = client.catalog?.items.find(entry => entry.id === itemId); if (!item) return undefined;
    return itemDisplayName({ name: item.display?.name ?? item.name ?? item.label, payload: { namespace: item.namespace ?? item.payload?.namespace } }, item.id);
  };
  // The name Catalog publishes for the recorded set, marked when it is an earlier release of an offered set.
  const setName = set => setLabeller(client.catalog?.frameworks ?? [])(set);
  // The recorded tool's label for the approval wording.
  const toolLabel = tool => (tool === client.tool ? client.toolLabel : undefined) ?? tool ?? 'your tool';
  const requestHost = (operation, body) => client.requestHost(operation, body);
  const available = () => Boolean(client.catalog);

  // The steps of one preview round: each item's message and the files Core would remove.
  function stepRows(preview) {
    return preview.steps.map(step => {
      const row = el('div', 'space-y-0.5');
      row.append(el('p', 'font-medium', `${step.entry.name}: ${step.message}`));
      if (step.files?.length) { const paths = el('ul', 'space-y-0.5 font-mono text-[11px]'); paths.append(...step.files.map(file => el('li', '', `${file.action?.startsWith('keep-') ? removalMemberWords(file, step.entry) : file.action}  ${file.path}`))); row.append(paths); }
      return row;
    });
  }

  // One Remove: preview first; each Confirm remove applies what was shown, and asks again for files not yet shown.
  function removeControl(entries, kept = [], text = 'Remove') {
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
      area.replaceChildren(...stepRows(preview), ...[...kept, ...(preview.kept ?? [])].map(item => el('p', 'text-on-surface-variant', `${item.name}: ${item.reason ?? stillNeededWords(item.neededBy) ?? KEPT_FOR_ANOTHER}`)),
        el('p', 'text-on-surface-variant', preview.note), actions);
      area.hidden = false;
    }
    const remove = compact(button(text, async () => {
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

  // The tools an item is installed for, when it is installed for more than one.
  function toolsLine(row) {
    if (!(row.toolNames?.length > 1)) return [];
    const line = el('span', 'text-on-surface-variant text-[11px]', `for ${row.toolNames.join(', ')}`); line.dataset.installedTools = row.tools.join(' ');
    return [line];
  }

  function finishControl(item) {
    if (item.state.install !== 'interrupted') return null;
    const available = (policyDocument()?.selections ?? []).some(selection => selection.managementId === item.managementId);
    if (!available) return null;
    return compact(button('Finish', () => { message.textContent = 'Review finishing the interrupted install. Nothing is applied yet.'; onFinish(item.managementId); }));
  }

  function updateControl(item) {
    const area = el('div', 'space-y-2'); area.hidden = true; area.dataset.updatePreview = '';
    if (item.state.update !== 'update-available') return { update: null, area: null };
    const update = compact(button('Update', async () => {
      if (removing) return;
      const offered = client.catalog?.items.find(candidate => candidate.id === item.itemId);
      if (!offered) { message.textContent = `Update unavailable: the current Catalog does not publish ${item.itemId}.`; message.dataset.outcome = 'unavailable'; return; }
      removing = true; update.disabled = true; update.setAttribute('aria-busy', 'true'); message.textContent = 'Checking the replacement…'; delete message.dataset.outcome;
      try {
        // Every installed copy of the item (one per tool) is updated in the one request.
        const entries = updateEntries({ item, offered });
        // The setup's own mode, as Remove sends it; the host refuses an update it cannot check for an Enterprise setup.
        const preview = await previewUpdate({ entries, request: requestHost, tool: client.tool, mode: policyDocument()?.mode, nameOf: ref => label(ref.itemId) });
        const actions = el('div', 'flex flex-wrap gap-2');
        const confirm = button('Confirm update', async () => {
          if (removing) return;
          removing = true; confirm.disabled = true; message.textContent = 'Updating…';
          try {
            const done = await confirmUpdate({ preview, request: requestHost, tool: client.tool });
            message.textContent = done.message; message.dataset.outcome = done.outcome;
            if (done.outcome === 'updated') { area.hidden = true; await refresh({ keepMessage: true }); onRemoved(); }
          } catch (error) { message.textContent = `Update did not finish: ${error.message}`; message.dataset.outcome = 'failed'; }
          finally { removing = false; }
        }, true);
        confirm.disabled = !preview.canConfirm;
        const cancel = button('Cancel', () => { area.hidden = true; area.replaceChildren(); message.textContent = ''; });
        actions.append(confirm, cancel);
        area.replaceChildren(...preview.steps.flatMap(step => [
          el('p', 'font-medium', `${step.entry.name}: ${step.message}`),
          ...step.members.map(member => el('p', 'text-on-surface-variant text-[11px]', `${member.action} ${member.path}${member.reason ? ` — ${member.reason}` : ''}`))
        ]), actions);
        area.hidden = false;
        message.textContent = preview.message;
        if (!preview.canConfirm) message.dataset.outcome = 'not-prepared';
      } catch (error) { message.textContent = `Update did not start: ${error.message}`; message.dataset.outcome = 'failed'; }
      finally { removing = false; update.disabled = false; update.removeAttribute('aria-busy'); }
    }));
    return { update, area };
  }

  function show(view) {
    list.replaceChildren();
    if (!view.readable) { note.textContent = `Cannot show what is installed: ${view.reason}`; return; }
    note.textContent = view.partial ? 'This list may be incomplete: Core could not read everything installed in this project.' : '';
    if (!view.groups.length && !view.others.length) { note.textContent = [note.textContent, 'Nothing from Workbench is installed in this project.'].filter(Boolean).join(' '); return; }
    // Build every interactive row once - badges, removal controls and preview areas unchanged - then
    // place each row under its recorded exact set identity (Q7-R). Simultaneous memberships render in
    // their first set, and as a named reference under each further set (actions are never duplicated); no-origin rows stay explicit.
    const pending = new Map();
    // Each state with the label of the tool Core recorded the selection for, which the approval wording names.
    const stated = item => item.state && { ...item.state, toolLabel: toolLabel(item.tool) };
    const states = new Map(view.groups.flatMap(group => [[group.managementId, stated(group)], ...group.needed.map(item => [item.managementId, stated(item)])]));
    for (const group of view.groups) {
      const row = el('li', 'space-y-1'); row.dataset.installedItem = group.itemId; row.dataset.installedRow = group.managementId; row.title = group.managementId;
      const { remove, area } = removeControl(group.removes, group.kept);
      const head = el('div', 'flex flex-wrap items-center gap-2'); head.append(el('span', 'font-medium', group.name), ...toolsLine(group));
      head.append(...stateBadges(stated(group), el));
      if (group.needed.length) {
        const fold = el('details', 'text-on-surface-variant'); fold.append(el('summary', '', `+ ${group.needed.length} it needs`));
        const members = el('ul', 'pl-3 space-y-0.5');
        for (const item of group.needed) {
          const member = el('li', 'flex flex-wrap items-center gap-2 text-[11px]', ''); member.dataset.installedNeeded = item.managementId;
          member.append(el('span', '', item.name), ...stateBadges(stated(item), el)); members.append(member);
        }
        fold.append(members); head.append(fold);
      }
      const finish = finishControl(group), { update, area: updateArea } = updateControl(group);
      if (finish) head.append(finish);
      if (update) head.append(update);
      head.append(remove); row.append(head, ...(updateArea ? [updateArea] : []), area);
      pending.set(group.managementId, { row, kind: 'chosen' });
    }
    for (const item of view.others) {
      const row = el('div', 'space-y-1'); row.dataset.installedOther = item.managementId; row.dataset.installedRow = item.managementId;
      const { remove, area } = removeControl([item, ...(item.copies ?? [])]);
      const finish = finishControl(item), { update, area: updateArea } = updateControl(item);
      // The full installed id stays in the tooltip (#137).
      const name = el('span', 'font-medium break-all', item.name); name.title = item.managementId;
      const head = el('div', 'flex flex-wrap items-center gap-2'); head.append(name, ...toolsLine(item));
      head.append(...stateBadges(stated(item), el));
      if (finish) head.append(finish);
      if (update) head.append(update);
      head.append(remove); row.append(head, ...(updateArea ? [updateArea] : []), area);
      states.set(item.managementId, stated(item));
      pending.set(item.managementId, { row, kind: 'other' });
    }
    const rendered = new Set();
    const copyOf = new Map([...view.groups, ...view.others].flatMap(row => (row.copies ?? []).map(copy => [copy.managementId, row.managementId])));
    for (const group of view.originGroups ?? []) {
      if (!group.set) continue;
      const section = el('li', 'space-y-1'); section.dataset.installedSet = `${group.set.setId}/${group.set.setSha256}`;
      // The set the user picked, by the name Catalog publishes; its exact recorded identity stays in the tooltip.
      const name = setName(group.set);
      const heading = el('p', 'text-[11px] font-medium text-on-surface-variant', name ?? '');
      heading.title = `${group.set.framework}/${group.set.setId}/${group.set.setSha256}`;
      // Core removes only this set's origin from a member another set, a direct choice or a requirement still owns,
      // and what only this set's own members need goes with them. The kept sentence names what keeps it.
      const removals = setRemovalEntries(group).map(({ keptFor, chosen, neededBy, ...entry }) => {
        const kept = keptWords(keptFor, name, setName, chosen) ?? stillNeededWords(neededBy) ?? KEPT_FOR_ANOTHER;
        return kept ? { ...entry, kept } : entry;
      });
      const { remove: removeSet, area: setArea } = removeControl(removals, [], 'Remove this set');
      removeSet.setAttribute('aria-label', name ? `Remove this set: ${name}` : 'Remove this set');
      const setHead = el('div', 'flex flex-wrap items-center gap-2'); setHead.append(heading, removeSet);
      const rows = el('ul', 'space-y-1');
      let any = false;
      for (const id of group.items) {
        // A tool copy shows on its item's row, which names its tools; it is not listed again in the set.
        if (copyOf.has(id) && group.items.includes(copyOf.get(id))) continue;
        const entry = pending.get(id);
        if (entry && !rendered.has(id)) {
          rendered.add(id); any = true;
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
      if (any) { section.append(setHead, setArea, rows); list.append(section); }
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
      // Core may still be writing here (an Apply this page lost contact with, or one started before a reload or elsewhere):
      // its record is read only once that Apply has finished.
      await client.waitWhileApplying?.(() => { if (read === inventoryRead) { list.replaceChildren(); note.textContent = APPLY_RUNNING_NOTE; } });
      if (read !== inventoryRead) return;
      note.textContent = 'Checking what is installed…';
      const inventory = await client.requestCurrent('managed');
      if (read !== inventoryRead || inventory?.status === 'superseded') return;
      const view = groupInstalled({ inventory, policy: policyDocument(), intent: client.intent, label, toolName: id => client.toolLabels?.[id] ?? id });
      show(view); onInventory(view);
    } catch (error) { if (read === inventoryRead) { list.replaceChildren(); note.textContent = `Cannot show what is installed: ${error.message}`; onInventory(undefined); } }
  }
  // A different project folder: the list and any removal still being previewed belong to the old one.
  function clear() { inventoryRead++; list.replaceChildren(); message.textContent = ''; delete message.dataset.outcome; note.textContent = 'Checking what is installed…'; }
  return { node, heading: title, refresh, clear, get busy() { return removing; } };
}
