// "Installed in this project": Core's managed inventory grouped by chosen item (installed-list.js), each with
// a two-step Remove (installed-removal.js). It reads the inventory itself; Install and Remove refresh it.

import { groupInstalled } from './installed-list.js';
import { confirmRemoval, previewRemoval } from './installed-removal.js';

export function createInstalledPanel({ client, el, button, onRemoved = () => {} }) {
  const node = el('section', 'p-4 rounded border border-wb-border bg-surface-container-low space-y-3'); node.id = 'installed-panel'; node.hidden = true;
  const title = el('h3', 'text-base font-semibold text-on-surface', 'Installed in this project');
  const note = el('p', 'text-on-surface-variant'); note.id = 'installed-note'; note.setAttribute('role', 'status'); note.setAttribute('aria-live', 'polite');
  const list = el('ul', 'space-y-3'); list.id = 'installed-list';
  const message = el('p', 'text-on-surface'); message.id = 'installed-message'; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  node.append(title, note, list, message);

  let attempt = 0, removing = false;
  const decode = () => { try { return JSON.parse(new TextDecoder().decode(client.bytes)); } catch { return undefined; } };
  const label = itemId => { const item = client.catalog?.items.find(entry => entry.id === itemId); return item ? item.label ?? item.id : undefined; };
  const host = (operation, body) => client.requestHost(operation, body);
  const available = () => Boolean(client.catalog?.executionAvailable);

  // One Remove: preview first, then Confirm remove applies each prepared removal in order.
  function removeControl(entries, members, kept = []) {
    const area = el('div', 'space-y-2'); area.hidden = true;
    const remove = button('Remove', async () => {
      if (removing) return;
      removing = true; remove.disabled = true; remove.setAttribute('aria-busy', 'true'); message.textContent = 'Checking which files would be removed…';
      try {
        const mode = decode()?.mode ?? 'vibe';
        const preview = await previewRemoval({ entries: entries.map(entry => ({ ...entry, memberCount: members.get(entry.managementId)?.memberCount })), host, mode });
        area.replaceChildren(...preview.steps.map(step => {
          const row = el('div', 'space-y-0.5');
          row.append(el('p', 'font-medium', `${step.entry.name}: ${step.message}`));
          if (step.files?.length) { const paths = el('ul', 'space-y-0.5 font-mono text-[11px]'); paths.append(...step.files.map(file => el('li', '', `${file.action}  ${file.path}`))); row.append(paths); }
          return row;
        }));
        for (const item of kept) area.append(el('p', 'text-on-surface-variant', `Kept: ${item.name}, still needed by ${item.neededBy.join(', ')}.`));
        const actions = el('div', 'flex flex-wrap gap-2');
        const cancel = button('Cancel', () => { area.hidden = true; area.replaceChildren(); message.textContent = ''; });
        const confirm = button('Confirm remove', async () => {
          if (removing) return;
          removing = true; confirm.disabled = true; cancel.disabled = true; confirm.setAttribute('aria-busy', 'true'); message.textContent = 'Removing…';
          try {
            const done = await confirmRemoval({ preview, host, mode });
            message.textContent = done.message; message.dataset.outcome = done.results.every(result => ['removed', 'absent', 'kept'].includes(result.state)) ? 'removed'
              : done.results.every(result => ['removed', 'absent', 'kept', 'unverified'].includes(result.state)) ? 'unverified' : 'failed';
          } catch (error) { message.textContent = `Remove did not finish: ${error.message}. Check the list.`; message.dataset.outcome = 'failed'; }
          finally { removing = false; await refresh({ keepMessage: true }); onRemoved(); }
        }, true);
        confirm.disabled = !preview.canConfirm;
        actions.append(confirm, cancel); area.append(actions); area.hidden = false;
        message.textContent = preview.canConfirm ? 'Nothing has been removed yet. Check the files, then confirm.' : 'Remove cannot go ahead. Nothing was removed.';
      } catch (error) { message.textContent = `Remove did not start: ${error.message}`; }
      finally { removing = false; remove.disabled = false; remove.removeAttribute('aria-busy'); }
    });
    return { remove, area };
  }

  function show(view, members) {
    list.replaceChildren();
    if (!view.readable) { note.textContent = `Cannot show what is installed: ${view.reason}`; return; }
    note.textContent = view.partial ? 'This list may be incomplete: Core could not read everything installed in this project.' : '';
    if (!view.groups.length && !view.others.length) { note.textContent = [note.textContent, 'Nothing from Workbench is installed in this project.'].filter(Boolean).join(' '); return; }
    for (const group of view.groups) {
      const row = el('li', 'p-2 rounded border border-wb-border space-y-1'); row.dataset.installedItem = group.itemId;
      const { remove, area } = removeControl(group.removes, members, group.kept);
      const head = el('div', 'flex flex-wrap items-center gap-2'); head.append(el('span', 'font-medium', group.name));
      if (group.needed.length) head.append(el('span', 'text-on-surface-variant', `+ ${group.needed.length} it needs: ${group.needed.map(item => item.name).join(', ')}`));
      head.append(remove); row.append(head, area); list.append(row);
    }
    if (view.others.length) {
      const others = el('li', 'space-y-1'); others.append(el('p', 'font-medium text-on-surface-variant', 'Other installed items'));
      for (const item of view.others) {
        const row = el('div', 'p-2 rounded border border-wb-border space-y-1'); row.dataset.installedOther = item.managementId;
        const { remove, area } = removeControl([item], members);
        const head = el('div', 'flex flex-wrap items-center gap-2'); head.append(el('span', 'font-mono text-[11px] break-all', item.name));
        if (!item.inSetup) head.append(el('span', 'text-on-surface-variant', 'not in your current setup'));
        head.append(remove); row.append(head, area); others.append(row);
      }
      list.append(others);
    }
  }

  /** Reads the inventory again. A plain request: listing reads nothing from the draft and must not supersede Install. */
  async function refresh({ keepMessage = false } = {}) {
    node.hidden = !available();
    if (node.hidden || removing) return;
    const current = ++attempt;
    if (!keepMessage) { message.textContent = ''; delete message.dataset.outcome; }
    note.textContent = 'Checking what is installed…';
    try {
      const inventory = await client.request('managed');
      if (current !== attempt) return;
      const members = new Map((inventory?.selections ?? []).map(entry => [entry.managementId, entry]));
      show(groupInstalled({ inventory, policy: decode(), intent: client.intent, label }), members);
    } catch (error) { if (current === attempt) { list.replaceChildren(); note.textContent = `Cannot show what is installed: ${error.message}`; } }
  }
  return { node, refresh };
}
