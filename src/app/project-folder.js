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
  head.append(label, name, change);
  const path = el('p', 'font-mono text-[11px] text-outline break-all'); path.id = 'project-folder-path';
  const note = el('p', 'text-on-surface-variant'); note.id = 'project-folder-note';
  // The full path and note sit with the folder field (#137): the default panel shows the name and Change.
  const form = el('div', 'space-y-2'); form.hidden = true;
  const field = el('label', 'block text-on-surface-variant space-y-1', 'Full path of the folder');
  const input = el('input', 'block w-full bg-wb-input border border-wb-border rounded p-1 font-mono text-[11px]'); input.type = 'text'; input.id = 'project-folder-input'; input.spellcheck = false;
  field.append(input);
  const use = button('Use this folder', () => void choose(input.value.trim()), true); use.id = 'project-folder-use';
  const recent = el('div', 'flex flex-wrap items-center gap-2'); recent.id = 'project-folder-recent';
  form.append(path, note, field, use, recent);
  const message = el('p', 'text-on-surface'); message.id = 'project-folder-message'; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  node.append(head, form, message);
  input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); use.click(); } });

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
    if (choosing) return;
    if (busy()) { message.textContent = 'Install or Remove is running. Wait for it to finish, then change the folder.'; return; }
    if (!value) { message.textContent = 'Type the full path of a folder.'; return; }
    choosing = true; use.disabled = true; use.setAttribute('aria-busy', 'true'); message.textContent = 'Checking the folder…';
    try {
      const response = await fetch('/api/authoring-project', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: value }) });
      const result = await response.json();
      if (result.status !== 'ok') { message.textContent = `Can't use this folder: ${result.reason ?? result.error ?? 'the Workbench did not say why.'}`; return; }
      show({ project: result.project, source: result.source }); form.hidden = true; input.value = '';
      message.textContent = `Now using ${projectName(result.project)}. What this page had checked for the previous folder was discarded.`;
      // The host has switched; a failure from here on is the page's reload, not a refusal of the folder.
      try { await onChanged(state); }
      catch (error) { message.textContent = `Now using ${projectName(result.project)}, but this page could not check it again: ${error.message} Reload the page.`; }
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
