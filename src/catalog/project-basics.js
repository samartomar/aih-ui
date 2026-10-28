// Project tools and workspace link to maintained framework content without duplicating it.
import { el } from '../app/dom.js';

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

export function createProjectBasics({ elements, onChooseFramework, onOpenWorkspace }) {
  elements.openWorkspace.addEventListener('click', () => onOpenWorkspace());
  return { render({ framework }) {
    elements.context.hidden = false; elements.context.replaceChildren();
    if (!framework) { elements.context.textContent = 'Project basics is unavailable from the configured sources. Existing choices remain in Your setup.'; return; }
    const open = el('button', 'set-choice', `Browse ${framework.name}`); open.type = 'button'; open.id = 'project-files-open-framework';
    open.addEventListener('click', () => onChooseFramework(framework)); elements.context.append(open);
  } };
}
