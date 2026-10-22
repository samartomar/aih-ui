/*
 * The left panel's frameworks: one row per installed framework, and nothing else.
 *
 * The consumer host gives every item the family of the release it came from.
 * A framework is a family release; the Catalog's unnamed default release, an
 * independently supplied inventory (the review-note test fixture) and personal
 * content are not frameworks, and stay reachable from Advanced.
 */

import { el } from "../app/dom.js";

// Workbench-supplied names, until the Catalog publishes a name per release export
// (samartomar/aih-ui#119, samartomar/aih-catalog#119). Keys are the families the
// consumer host gives the installed family releases (tools/consumer/installed-families.mjs);
// the order is the owner's. A family missing here is still listed, under its own name.
const FRAMEWORK_NAMES = new Map([["Extensions", "AIH-Extensions"], ["ECC", "ECC"], ["Anthropic", "Anthropic"], ["Superpowers", "Superpowers"]]);
// Host families that are not frameworks: the default release, an independent inventory, personal content.
const NOT_FRAMEWORKS = new Map([["Catalog", "Other Catalog content"], ["Independent", "Independent"], ["Personal", "Your sources"]]);

/** Said wherever a framework name is shown, until the Catalog publishes the names. */
export const WORKBENCH_NAMED = "Name supplied by the Workbench; the Catalog does not publish framework names yet.";

/** Whether a family is a framework: a family release, not the default release, an independent inventory or personal content. */
export const isFramework = (family) => Boolean(family) && !NOT_FRAMEWORKS.has(family);

/** The words shown for a family, wherever it is shown. */
export function familyLabel(family) {
  return FRAMEWORK_NAMES.get(family) ?? NOT_FRAMEWORKS.get(family) ?? family;
}

/** The frameworks among the catalog's items: the named ones in the owner's order, then any other, with their counts. */
export function frameworkRows(items) {
  const counts = new Map();
  for (const item of items) if (typeof item.family === "string" && !NOT_FRAMEWORKS.has(item.family)) counts.set(item.family, (counts.get(item.family) ?? 0) + 1);
  const named = [...FRAMEWORK_NAMES.keys()].filter((family) => counts.has(family));
  const others = [...counts.keys()].filter((family) => !FRAMEWORK_NAMES.has(family)).sort((a, b) => a.localeCompare(b));
  return [...named, ...others].map((family) => ({ family, label: familyLabel(family), count: counts.get(family) }));
}

// The framework a viewer last chose, remembered in this browser only (#122). Storage can be missing or refuse; the page
// then opens on the first framework.
const LAST_FRAMEWORK = "aih-workbench-framework";
const browserStorage = () => { try { return globalThis.localStorage; } catch { return undefined; } };

/** The framework this viewer last chose, or null. */
export function savedFramework(storage = browserStorage()) {
  try { return storage?.getItem(LAST_FRAMEWORK) || null; } catch { return null; }
}

/** Remembers a framework the viewer chose; a family that is not a framework is not remembered. */
export function rememberFramework(family, storage = browserStorage()) {
  if (!family || NOT_FRAMEWORKS.has(family)) return;
  try { storage?.setItem(LAST_FRAMEWORK, family); } catch { /* Forgetting is harmless. */ }
}

/** A framework is always open: the remembered one while it is installed, else the first in the left panel. */
export function openFramework(rows, remembered) {
  return rows.find((row) => row.family === remembered)?.family ?? rows[0]?.family ?? "";
}

/**
 * @param list      the left panel's framework list element
 * @param onSelect  called with a framework's family; selecting the selected one keeps it selected
 */
export function createFrameworkRail({ list, onSelect }) {
  return {
    /** @param model { rows, selected } */
    render({ rows, selected }) {
      const focused = list.contains(document.activeElement) ? document.activeElement.dataset.family : null;
      list.replaceChildren(...rows.map((row) => {
        const chosen = row.family === selected;
        const button = el("button", `w-full flex items-center justify-between px-2 py-1 rounded text-left cursor-pointer ${chosen ? "bg-surface-container text-primary font-medium" : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"}`);
        button.type = "button";
        button.dataset.family = row.family;
        button.setAttribute("aria-pressed", String(chosen));
        button.title = `${chosen ? `${row.label}: selected (${row.count} items).` : `Show the ${row.count} items from ${row.label}.`} ${WORKBENCH_NAMED}`;
        button.append(el("span", "truncate", row.label), el("span", "font-mono text-[10px] px-1 text-outline shrink-0", String(row.count)));
        button.addEventListener("click", () => onSelect(row.family));
        return button;
      }));
      if (focused) [...list.querySelectorAll("button")].find((button) => button.dataset.family === focused)?.focus({ preventScroll: true });
    },
  };
}
