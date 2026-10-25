/*
 * Source navigation: the left rail's Catalog Scopes.
 *
 * One row per PUBLISHED SOURCE IDENTITY - a repository for github, a package
 * for npm, a release for aih - with the current item count, largest first.
 * Nothing is read out of an entry id, and no release is chosen here.
 *
 * A revision is shown only as what it is:
 *   - github:     the commit, when every item of that repository shares one;
 *   - npm:        the version - an integrity value is not a commit.
 *
 * The organization's own additions come last and are empty until something is
 * actually imported.
 */

import { el } from "../app/dom.js";
import { NOT_SUPPLIED } from "../app/absence.js";
import { describeScope, sourceScopes } from "./selectors.js";
import { attachTooltip } from "../app/tooltip.js";

function badgeNode(scope, selected) {
  if (scope.badge === null) return null;
  const tone = selected
    ? "px-1 py-0.2 rounded bg-surface-container-highest text-metadata-emphasis font-mono text-[9px] shrink-0 font-normal"
    : "px-1.5 py-0.2 rounded bg-surface-container-high/80 text-metadata-revision font-mono text-[10px] shrink-0";
  const node = scope.href === null ? el("span", tone, scope.badge) : el("a", `${tone} hover:underline`, scope.badge);
  if (scope.href !== null) {
    node.href = scope.href;
    node.target = "_blank";
    node.rel = "noopener noreferrer";
    // Opening the commit is not a selection.
    node.addEventListener("click", (event) => event.stopPropagation());
  }
  if (scope.badgeTitle) node.title = scope.badgeTitle;
  return node;
}

function scopeRow(row, selected, onSelect) {
  const scope = describeScope(row);
  const panel = el(
    "div",
    selected
      ? "rounded bg-surface-container-low/80 p-1 border border-wb-border space-y-0.5"
      : "rounded bg-surface-container-low/40 hover:bg-surface-container-low/80 p-1 border border-wb-border transition-colors cursor-pointer",
  );
  const head = el("button", `w-full flex items-center justify-between px-1.5 py-1 text-on-surface font-medium text-left cursor-pointer`);
  head.type = "button";
  head.dataset.focusKey = JSON.stringify(["source", row.filterValue]);
  head.setAttribute("aria-pressed", String(selected));
  attachTooltip(head, selected
    ? `${scope.name}: selected. Select again to show every published source.`
    : `Show the ${row.total} items published from ${scope.name}`);
  const left = el("div", `flex items-center ${selected ? "gap-1.5" : "gap-2"} min-w-0 flex-1 mr-1`);
  left.appendChild(
    el("span", `material-symbols-outlined ${selected ? "text-[14px] text-primary" : "text-[15px] text-outline"} shrink-0`, selected ? "folder_open" : "folder"),
  );
  left.appendChild(
    el("span", `${selected ? "text-primary" : "text-on-surface"} truncate font-medium text-[11.5px]`, scope.name),
  );
  const badge = badgeNode(scope, selected);
  if (badge) left.appendChild(badge);
  head.appendChild(left);
  head.appendChild(
    el(
      "span",
      selected
        ? "font-mono text-[10px] px-1 rounded bg-surface-container-highest text-metadata-revision font-medium shrink-0"
        : "font-mono text-[10.5px] px-1 text-outline shrink-0",
      String(row.total),
    ),
  );
  head.addEventListener("click", () => onSelect(selected ? null : row.filterValue));
  panel.appendChild(head);

  for (const glyph of panel.querySelectorAll(".material-symbols-outlined")) glyph.setAttribute("aria-hidden", "true");
  return panel;
}

/** The organization's own additions: nothing is imported yet, and it says so. */
function additionsRow(organizationName) {
  const panel = el("div", "rounded bg-surface-container-low/40 p-1 border border-wb-border opacity-80");
  attachTooltip(panel, "Items your organization adds. None have been imported.");
  const head = el("div", "flex items-center justify-between px-1.5 py-1 text-on-surface font-medium");
  const left = el("div", "flex items-center gap-2 min-w-0 flex-1 mr-1");
  left.appendChild(el("span", "material-symbols-outlined text-[15px] text-outline shrink-0", "extension"));
  left.appendChild(
    el("span", "text-on-surface truncate font-medium text-[11.5px]", organizationName ? `${organizationName} Additions` : "Your Additions"),
  );
  head.appendChild(left);
  head.appendChild(el("span", "font-mono text-[10.5px] px-1 text-outline shrink-0", NOT_SUPPLIED));
  panel.appendChild(head);
  for (const glyph of panel.querySelectorAll(".material-symbols-outlined")) glyph.setAttribute("aria-hidden", "true");
  return panel;
}

/**
 * @param elements  { navSourcesCount, scopeList }
 * @param onSelectSource  called with a scope's filter value, or null for all
 */
export function createNavigation({ elements, onSelectSource }) {
  return {
    /** @param model { view, total, counts, organizationName } */
    render(model) {
      elements.navSourcesCount.textContent = String(model.total);
      const focusKey = elements.scopeList.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
      elements.scopeList.replaceChildren();
      for (const row of sourceScopes(model.counts)) {
        elements.scopeList.appendChild(
          scopeRow(row, model.view.source === row.filterValue, onSelectSource),
        );
      }
      elements.scopeList.appendChild(additionsRow(model.organizationName ?? null));
      if (focusKey) [...elements.scopeList.querySelectorAll("button[data-focus-key]")].find((button) => button.dataset.focusKey === focusKey)?.focus({ preventScroll: true });
    },
  };
}
