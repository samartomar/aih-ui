// "Installed in this project": Core's managed inventory grouped by chosen item (installed-list.js), each with
// a two-step Remove (installed-removal.js). It reads the inventory itself; Install and Remove refresh it, and
// it tells the Install panel whether Core lists the whole setup as installed.

import { groupInstalled } from './installed-list.js';
import { confirmRemoval, previewRemoval } from './installed-removal.js';
import { compact } from './compact.js';
import { familyLabel } from '../catalog/frameworks.js';

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
      const cancel = button('Cancel', () => { close(); if (!results.length) message.textContent = ''; });
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
    for (const group of view.groups) {
      const row = el('li', 'space-y-1'); row.dataset.installedItem = group.itemId; row.title = group.managementId;
      const { remove, area } = removeControl(group.removes, group.kept);
      const head = el('div', 'flex flex-wrap items-center gap-2'); head.append(el('span', 'font-medium', group.name));
      if (group.needed.length) head.append(el('span', 'text-on-surface-variant', `+ ${group.needed.length} it needs: ${group.needed.map(item => item.name).join(', ')}`));
      head.append(remove); row.append(head, area); list.append(row);
    }
    if (view.others.length) {
      // Named apart only when chosen items are listed above them.
      const others = el('li', 'space-y-1'); if (view.groups.length) others.append(el('p', 'text-[11px] font-medium text-on-surface-variant', 'Other installed items'));
      for (const item of view.others) {
        const row = el('div', 'space-y-1'); row.dataset.installedOther = item.managementId;
        const { remove, area } = removeControl([item]);
        // The Catalog name, or a short name; the full installed id stays in the tooltip and in Advanced (#137).
        const name = el('span', 'font-medium break-all', item.name); name.title = item.managementId;
        const head = el('div', 'flex flex-wrap items-center gap-2'); head.append(name);
        if (item.family) head.append(el('span', 'text-on-surface-variant', familyLabel(item.family)));
        if (!item.inSetup) head.append(el('span', 'text-on-surface-variant', 'Not in your setup'));
        head.append(remove); row.append(head, area); others.append(row);
      }
      list.append(others);
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
      const view = groupInstalled({ inventory, policy: policyDocument(), intent: client.intent, label, items: client.catalog?.items ?? [] });
      show(view); onInventory(view);
    } catch (error) { if (read === inventoryRead) { list.replaceChildren(); note.textContent = `Cannot show what is installed: ${error.message}`; onInventory(undefined); } }
  }
  // A different project folder: the list and any removal still being previewed belong to the old one.
  function clear() { inventoryRead++; list.replaceChildren(); message.textContent = ''; delete message.dataset.outcome; note.textContent = 'Checking what is installed…'; }
  return { node, heading: title, refresh, clear, get busy() { return removing; } };
}
