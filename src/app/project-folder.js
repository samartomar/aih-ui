// The "Project folder" row at the top of the review drawer: which folder Install writes into and the installed list
// reads, and Change folder to type or pick another. The host checks the path and owns the folder; this page only
// asks. Recent folders are a per-viewer convenience kept in this browser, never exported or sent anywhere else.

import { projectName } from './install-panel.js';
import { compact } from './compact.js';

const RECENT_KEY = 'wb-recent-project-folders', RECENT_LIMIT = 5;
// Windows paths compare without case and either slash; others exactly.
const sameFolder = (a, b) => { const key = path => /^[a-z]:|\\/i.test(path) ? path.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '') : path; return key(a) === key(b); };

export function rememberFolder(list, path) {
  return [path, ...list.filter(entry => !sameFolder(entry, path))].slice(0, RECENT_LIMIT);
}
export function readRecent(storage) {
  try {
    const value = JSON.parse(storage?.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter(entry => typeof entry === 'string' && entry).slice(0, RECENT_LIMIT) : [];
  } catch { return []; }
}
export function saveRecent(storage, list) {
  try { storage?.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_LIMIT))); } catch { /* Storage may be unavailable; the list is a convenience. */ }
}

export function folderSummary(state) {
  if (!state?.project) return { name: 'No project folder', path: '', note: 'Choose the project folder to install into and to see what is installed there.' };
  return { name: projectName(state.project), path: state.project, note: state.source === 'host-default' ? 'The default for this Workbench.' : '' };
}

const storage = () => { try { return globalThis.localStorage; } catch { return undefined; } };

/**
 * `busy()` is true while Install or Remove runs on this page; `onChanged(state)` runs after the host switched folders,
 * so the page can discard what it prepared for the old one and check the new one.
 */
export function createProjectFolderRow({ el, button, busy = () => false, onChanged = () => {} }) {
  const node = el('section', 'px-3 py-2 rounded border border-wb-border bg-surface-container-low space-y-2'); node.id = 'project-folder'; node.hidden = true;
  const head = el('div', 'flex flex-wrap items-center gap-2');
  const label = el('h3', 'text-sm font-semibold text-on-surface', 'Project folder');
  const name = el('span', 'font-medium text-on-surface'); name.id = 'project-folder-name';
  const change = button('Change folder', () => { form.hidden = !form.hidden; if (!form.hidden) { renderRecent(); input.focus(); } }); change.id = 'project-folder-change';
  compact(change, 'ml-auto');
  const browse = button('Use folder', () => void openMenu()); browse.id = 'project-folder-browse';
  head.append(label, name, browse, change);
  const path = el('p', 'font-mono text-[11px] text-outline break-all'); path.id = 'project-folder-path';
  const note = el('p', 'text-on-surface-variant'); note.id = 'project-folder-note';
  // The full path and note sit with the folder field (#137): the default panel shows the name and Change.
  const form = el('div', 'space-y-2'); form.hidden = true;
  const field = el('label', 'block text-on-surface-variant space-y-1', 'Full path on the Workbench host');
  const input = el('input', 'block w-full bg-wb-input border border-wb-border rounded p-1 font-mono text-[11px]'); input.type = 'text'; input.id = 'project-folder-input'; input.spellcheck = false;
  field.append(input);
  const use = button('Use typed path', () => void choose(input.value.trim()), true); use.id = 'project-folder-use';
  const recent = el('div', 'flex flex-wrap items-center gap-2'); recent.id = 'project-folder-recent';
  form.append(path, note, field, use, recent);
  const message = el('p', 'text-on-surface'); message.id = 'project-folder-message'; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  node.append(head, form, message);
  input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); use.click(); } });

  const dialog = el('dialog', 'p-4 rounded border border-wb-border bg-surface-container-low text-on-surface space-y-2');
  dialog.id = 'project-folder-dialog'; dialog.setAttribute('aria-labelledby', 'project-folder-menu-title');
  const menuTitle = el('h3', 'font-semibold', 'Choose a folder on the Workbench host'); menuTitle.id = 'project-folder-menu-title';
  const menuPath = el('input', 'block w-full bg-wb-input border border-wb-border rounded p-1 font-mono');
  menuPath.id = 'project-folder-menu-path'; menuPath.setAttribute('aria-label', 'Folder path on Workbench host');
  const menuStatus = el('p', 'text-on-surface-variant'); menuStatus.setAttribute('role', 'status');
  const directories = el('div', 'flex flex-wrap gap-2'); directories.id = 'project-folder-directories';
  const go = button('Open path', () => void list(menuPath.value)); go.id = 'project-folder-go';
  const up = button('Parent folder', () => void list(listed?.parent));
  const accept = button('Use this folder', async () => { if (listed && await choose(listed.path)) dialog.close(); }); accept.id = 'project-folder-dialog-use';
  const cancel = button('Cancel', () => dialog.close()); cancel.id = 'project-folder-dialog-cancel';
  dialog.append(menuTitle, el('p', 'text-on-surface-variant', 'These folders are on the machine running Workbench. Browsing does not change the project or install anything.'), menuPath, go, up, directories, menuStatus, accept, cancel);
  node.append(dialog); let listed, listing = 0;
  async function openMenu() { if (busy()) { message.textContent = 'Wait for Install or Remove to finish.'; return; } dialog.showModal(); await list(state?.project ?? undefined); }
  async function list(path) {
    const request = ++listing; listed = undefined; accept.disabled = true; up.disabled = true; menuPath.disabled = true; go.disabled = true;
    directories.replaceChildren(); menuStatus.textContent = 'Reading folders…';
    try {
      const response = await fetch('/api/authoring-project-folders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) });
      const result = await response.json(); if (request !== listing) return;
      if (!response.ok || result.status !== 'ok') { menuStatus.textContent = result.reason ?? 'The folder menu is unavailable on this host. You can enter a full path instead.'; return; }
      listed = result; menuPath.value = result.path; accept.disabled = false; up.disabled = result.parent === result.path;
      for (const entry of result.directories) directories.append(button(entry.name, () => void list(entry.path)));
      menuStatus.textContent = result.truncated ? 'This folder has more entries than the menu can show. Enter a full path to open another folder.' : result.directories.length ? 'Open a folder, then choose Use this folder.' : 'No visible subfolders. You can use this folder or open another path.';
    } catch { if (request === listing) menuStatus.textContent = 'The folder menu could not be read. Enter a full path or cancel.'; }
    finally { if (request === listing) { menuPath.disabled = false; go.disabled = false; } }
  }
  menuPath.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void list(menuPath.value); } });
  let state, choosing = false;
  function renderRecent() {
    const others = readRecent(storage()).filter(entry => !state?.project || !sameFolder(entry, state.project));
    recent.replaceChildren(...(others.length ? [el('span', 'text-on-surface-variant', 'Recent:')] : []),
      ...others.map(entry => { const pick = button(projectName(entry), () => { input.value = entry; void choose(entry); }); pick.title = entry; return pick; }));
  }
  function show(value) {
    state = value; const summary = folderSummary(state);
    name.textContent = summary.name; name.title = [summary.path, summary.note].filter(Boolean).join(' · '); path.textContent = summary.path; note.textContent = state?.stateLocation?.reason ?? summary.note;
    if (state?.project) saveRecent(storage(), rememberFolder(readRecent(storage()), state.project));
    if (!state?.project || state?.stateLocation?.status === 'unavailable') form.hidden = false;
    renderRecent();
  }
  async function choose(value) {
    if (choosing) return false;
    if (busy()) { message.textContent = 'Install or Remove is running. Wait for it to finish, then change the folder.'; return; }
    if (!value) { message.textContent = 'Type the full path of a folder.'; return; }
    choosing = true; use.disabled = true; use.setAttribute('aria-busy', 'true'); message.textContent = 'Checking the folder…';
    try {
      const response = await fetch('/api/authoring-project', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: value }) });
      const result = await response.json();
      if (result.status !== 'ok') { message.textContent = `Can't use this folder: ${result.reason ?? result.error ?? 'the Workbench did not say why.'}`; menuStatus.textContent = message.textContent; return false; }
      show({ project: result.project, source: result.source }); form.hidden = true; input.value = '';
      message.textContent = `Now using ${projectName(result.project)}. What this page had checked for the previous folder was discarded.`;
      // The host has switched; a failure from here on is the page's reload, not a refusal of the folder.
      try { await onChanged(state); }
      catch (error) { message.textContent = `Now using ${projectName(result.project)}, but this page could not check it again: ${error.message} Reload the page.`; }
      return true;
    } catch (error) { message.textContent = `Can't use this folder: ${error.message}`; }
    finally { choosing = false; use.disabled = false; use.removeAttribute('aria-busy'); }
  }
  /** Reads which folder the host uses now. */
  async function refresh() {
    try {
      const response = await fetch('/api/authoring-project', { cache: 'no-store' });
      if (!response.ok) { node.hidden = true; return state; }
      show(await response.json()); node.hidden = false;
    } catch { node.hidden = true; }
    return state;
  }
  return { node, refresh, get state() { return state; } };
}
