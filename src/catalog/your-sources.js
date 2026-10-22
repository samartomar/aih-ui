/*
 * Your sources (owner decision 5 of the second gate A run): what the person brings, apart from the frameworks. The first
 * kind is a folder on this machine: the folder picker (app/authoring-workspace.js, the same ids it had under Advanced)
 * sends the browser-granted files to the host, which recognizes skills/<name>/SKILL.md through Catalog's public source
 * reader and producer. Each granted folder is one release of the "Personal" family; this view lists one source per
 * release, named by the folder, with the same cards and one-click Add as a framework.
 *
 * The grant lasts for this page session only. This browser remembers folder names (never content or a grant), so after
 * a reload the page can say plainly which folder needs choosing again. The other kinds are disabled with the reason
 * and the upstream issue; a pasted link or command is never read.
 */

import { el } from "../app/dom.js";
import { createCards } from "./cards.js";

/** The host family a granted folder's items carry (tools/consumer/personal-folder.mjs). */
const FOLDER_FAMILY = "Personal";

/** Whether an item came from a folder the person added. */
export const isYourSource = (item) => item?.family === FOLDER_FAMILY;

/** Said for anything pasted: the page does not read it, and what is missing before it could. */
export const PASTE_NOT_YET = "Can't be added yet. The Catalog doesn't publish a parser for pasted links or install commands (samartomar/aih-catalog#120), so this page does not read what you pasted. "
  + "An npm install command also needs ordinary npm packages as Catalog sources (samartomar/aih-catalog#123) and Scan support for them (samartomar/aih-scan#120). "
  + "A GitHub branch link also needs the branch turned into an exact commit (samartomar/aih-catalog#122). "
  + "What you pasted stays in this box as an unverified note only: it is not saved and is not a source.";

const UNNAMED = "Folder chosen on this page";

/**
 * The person's sources: one per granted folder (named by the folder when this page chose it), then each remembered
 * folder this page has no grant for, which needs choosing again.
 * @param entries     the catalog's entries
 * @param named       Map releaseSha256 -> folder name, for the folders this page chose
 * @param remembered  folder names this browser remembers
 */
export function folderSources(entries, { named, remembered }) {
  const groups = new Map();
  for (const entry of entries) {
    if (!isYourSource(entry.authoringItem)) continue;
    const key = entry.authoringItem.root?.releaseSha256 ?? "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const order = [...named.keys()].filter((key) => groups.has(key));
  const keys = [...order, ...[...groups.keys()].filter((key) => !named.has(key))];
  const sources = keys.map((key) => ({ key, name: named.get(key) ?? UNNAMED, state: "session", entries: groups.get(key) }));
  const bound = new Set(sources.map((source) => source.name));
  for (const name of remembered) if (!bound.has(name)) sources.push({ key: `remembered:${name}`, name, state: "choose-again", entries: [] });
  return sources;
}

// Folder names only, in this browser only. Storage can be missing or refuse; the page then simply does not remember.
const REMEMBERED = "aih-workbench-your-sources";
const browserStorage = () => { try { return globalThis.localStorage; } catch { return undefined; } };

/** The folder names this browser remembers, oldest first. */
export function rememberedFolders(storage = browserStorage()) {
  try {
    const value = JSON.parse(storage?.getItem(REMEMBERED) ?? "[]");
    return Array.isArray(value) ? value.filter((name) => typeof name === "string" && name) : [];
  } catch { return []; }
}

/** Remembers a folder's name so a fresh page can ask for it again. */
export function rememberFolder(name, storage = browserStorage()) {
  if (!name) return;
  const names = rememberedFolders(storage);
  if (names.includes(name)) return;
  try { storage?.setItem(REMEMBERED, JSON.stringify([...names, name])); } catch { /* Forgetting is harmless. */ }
}

/** Forgets a remembered folder name; the folder itself is untouched. */
export function forgetFolder(name, storage = browserStorage()) {
  try { storage?.setItem(REMEMBERED, JSON.stringify(rememberedFolders(storage).filter((value) => value !== name))); } catch { /* Nothing to forget. */ }
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/**
 * @param onSelect   called with an entry id when one of a source's cards is selected
 * @param onOpen     called to show the Your sources view
 * @param onChange   called when the sources changed (a folder was granted or forgotten), so the catalog renders again
 */
export function createYourSources({ onSelect, onOpen, onChange }) {
  const rail = document.getElementById("your-sources-rail");
  const list = document.getElementById("your-sources-list");
  const folder = document.getElementById("personal-folder");
  const paste = document.getElementById("your-sources-paste-text");
  const pasteStatus = document.getElementById("your-sources-paste-status");
  // releaseSha256 -> the folder's name, for the folders granted to this page session.
  const named = new Map();
  let grids = [];
  let pendingFocus = null;

  document.addEventListener("aih:folder-granted", (event) => {
    const { name, releaseSha256 } = event.detail ?? {};
    if (!releaseSha256) return;
    if (name) { named.set(releaseSha256, name); rememberFolder(name); }
    pendingFocus = releaseSha256;
    onChange();
  });
  document.getElementById("nav-your-sources-add").addEventListener("click", () => {
    onOpen();
    document.getElementById("your-sources-add-title").focus();
  });
  paste.addEventListener("input", () => {
    const typed = paste.value.trim() !== "";
    pasteStatus.hidden = !typed;
    pasteStatus.textContent = typed ? PASTE_NOT_YET : "";
  });

  const heading = (source) => list.querySelector(`[data-source-key="${CSS.escape(source.key)}"] h2`);
  function openSource(source) {
    onOpen();
    heading(source)?.focus();
  }

  function railRow(source) {
    const button = el("button", "w-full flex items-center justify-between px-2 py-1 rounded text-left cursor-pointer text-on-surface-variant hover:bg-surface-container hover:text-on-surface");
    button.type = "button";
    button.dataset.sourceKey = source.key;
    const again = source.state === "choose-again";
    button.title = again ? `${source.name}: choose the folder again to use its skills on this page.` : `${source.name}: ${plural(source.entries.length, "skill", "skills")} from a folder on this machine, for this page session.`;
    const label = el("span", "flex items-center gap-1.5 min-w-0");
    label.append(el("span", "material-symbols-outlined text-[14px]", "folder"), el("span", "truncate", source.name));
    button.append(label, el("span", "font-mono text-[10px] px-1 text-outline shrink-0", again ? "choose again" : String(source.entries.length)));
    button.addEventListener("click", () => openSource(source));
    const row = el("div");
    row.setAttribute("role", "listitem");
    row.append(button);
    return row;
  }

  function section(source, model) {
    const node = el("section", "p-4 rounded border border-wb-border bg-surface-container-low space-y-2");
    node.dataset.sourceKey = source.key;
    const title = el("h2", "font-semibold text-on-surface", source.name);
    title.tabIndex = -1;
    const again = source.state === "choose-again";
    node.append(title, el("p", "font-mono text-[10px] text-outline", again
      ? "Folder on this machine · Not readable on this page"
      : `Folder on this machine · ${plural(source.entries.length, "skill", "skills")} · This page session only · Not scanned`));
    if (again) {
      node.append(el("p", "text-on-surface-variant", `This page can't read ${source.name} any more: the browser lets a page read a folder only until it is reloaded or closed. Choose ${source.name} again to use its skills.`));
      const actions = el("p", "flex flex-wrap gap-2");
      const choose = el("button", "px-3 py-1.5 rounded border border-wb-border text-primary hover:bg-surface-container", `Choose ${source.name} again`);
      choose.type = "button";
      choose.addEventListener("click", () => folder.click());
      const forget = el("button", "px-3 py-1.5 rounded border border-wb-border text-on-surface-variant hover:bg-surface-container hover:text-on-surface", `Forget ${source.name}`);
      forget.type = "button";
      forget.title = "Stop listing this folder name in this browser. The folder itself is untouched.";
      forget.addEventListener("click", () => { forgetFolder(source.name); onChange(); onOpen(); document.getElementById("your-sources-title").focus(); });
      actions.append(choose, forget);
      node.append(actions);
      return node;
    }
    const grid = el("div", "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3");
    grid.dataset.yourSourceGrid = source.key;
    const cards = createCards({ elements: { cardsGrid: grid, categoryContext: el("p"), visibleCount: el("span"), visibleCaption: el("span") }, onSelect });
    cards.render({ ...model, entries: source.entries, total: source.entries.length, noun: "skills from this folder" });
    grids.push(cards);
    node.append(grid);
    return node;
  }

  return {
    /** @param model the catalog's cards model, with every catalog entry as its entries */
    render(model) {
      const sources = folderSources(model.entries, { named, remembered: rememberedFolders() });
      const focusedKey = rail.contains(document.activeElement) ? document.activeElement.dataset.sourceKey : null;
      rail.replaceChildren(...sources.map(railRow));
      if (focusedKey) [...rail.querySelectorAll("button")].find((node) => node.dataset.sourceKey === focusedKey)?.focus({ preventScroll: true });
      grids = [];
      list.replaceChildren(...(sources.length ? sources.map((source) => section(source, model)) : [el("p", "text-on-surface-variant", "Nothing added yet. Add a source below.")]));
      // A folder just granted is shown and its heading focused, once its skills are in the catalog.
      const added = pendingFocus && sources.find((source) => source.key === pendingFocus);
      if (added) { pendingFocus = null; openSource(added); }
    },
    setSelected: (previousId, nextId) => { for (const cards of grids) cards.setSelected(previousId, nextId); },
    focus: (entryId) => grids.some((cards) => cards.focus(entryId)),
  };
}
