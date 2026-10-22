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
const NOT_FRAMEWORKS = new Map([["Catalog", "Other Catalog content"], ["Independent", "Independent"], ["Personal", "Personal"]]);

/** Said wherever a framework name is shown, until the Catalog publishes the names. */
export const WORKBENCH_NAMED = "Name supplied by the Workbench; the Catalog does not publish framework names yet.";

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

/**
 * @param list      the left panel's framework list element
 * @param onSelect  called with a framework's family, or "" to show every family
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
        button.title = `${chosen ? `${row.label}: selected. Select again to show every framework.` : `Show the ${row.count} items from ${row.label}.`} ${WORKBENCH_NAMED}`;
        button.append(el("span", "truncate", row.label), el("span", "font-mono text-[10px] px-1 text-outline shrink-0", String(row.count)));
        button.addEventListener("click", () => onSelect(chosen ? "" : row.family));
        return button;
      }));
      if (focused) [...list.querySelectorAll("button")].find((button) => button.dataset.family === focused)?.focus({ preventScroll: true });
    },
  };
}
