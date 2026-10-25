/*
 * Project basics (owner decision 4 of the second gate A run): what applies to the project whichever framework is
 * chosen. Tool support links the existing Check this machine page; the project files are Catalog content the person
 * adds with the same one-click Add as a card; the workspace opens the one workspace view, which lives in Your setup's
 * Advanced section.
 *
 * Items are routed by the kind the Catalog publishes, never by id. Tool adapters are not offered here: they stay where
 * Get started and Check this machine use them, and under Advanced.
 */

import { createCards } from "./cards.js";

const PROJECT_CONTEXT_KIND = "project-context";
const PROJECT_FILE_KINDS = new Set([PROJECT_CONTEXT_KIND, "client-entry-pointer"]);

/** A project file: the shared project context, or a pointer that brings it into one tool's own file. */
export const isProjectFile = (item) => PROJECT_FILE_KINDS.has(item?.kind);

const labelOf = (entry) => String(entry.authoringItem.label ?? entry.authoringItem.id);

/** The project files among the catalog's entries: the shared project context first, then the pointers by name. */
export function projectFileEntries(entries) {
  return entries.filter((entry) => isProjectFile(entry.authoringItem)).sort((a, b) =>
    (b.authoringItem.kind === PROJECT_CONTEXT_KIND) - (a.authoringItem.kind === PROJECT_CONTEXT_KIND) || labelOf(a).localeCompare(labelOf(b)));
}

/**
 * @param elements        the Project basics section's elements
 * @param onSelect        called with a project file's entry id when its card is selected
 * @param onOpenWorkspace called when the person opens the workspace
 */
export function createProjectBasics({ elements, onSelect, onOpenWorkspace }) {
  const cards = createCards({ elements: { cardsGrid: elements.grid, categoryContext: elements.context, visibleCount: elements.count, visibleCaption: elements.caption }, onSelect });
  elements.openWorkspace.addEventListener("click", () => onOpenWorkspace());
  return {
    /** @param model the catalog's cards model, with the project files as its entries */
    render(model) {
      elements.empty.hidden = model.entries.length > 0;
      elements.grid.hidden = model.entries.length === 0;
      if (model.entries.length) cards.render(model);
      else { elements.grid.replaceChildren(); elements.count.textContent = "0"; elements.caption.textContent = "entries"; }
    },
    setSelected: (previousId, nextId) => cards.setSelected(previousId, nextId),
    focus: (entryId) => cards.focus(entryId),
  };
}
