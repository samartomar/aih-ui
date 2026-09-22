/*
 * Source navigation: the left rail's Catalog Scopes.
 *
 * One row per PUBLISHED SOURCE IDENTITY - a repository for github, a package
 * for npm - and one row per Catalog COLLECTION for the source types Catalog
 * governs by collection, with the current item count, largest first. Nothing
 * is read out of an entry id, and no release is chosen here: Core-derived
 * content is one @aihq/core row holding exactly the members Catalog names as
 * current, and older releases kept in the index for reference are not rows.
 * @aihq/catalog is not a row: it is the package that transports these sources.
 *
 * A revision is shown only as what it is:
 *   - github:     the commit, when every item of that repository shares one;
 *   - npm:        the version - an integrity value is not a commit;
 *   - collection: its current content release, with a marker when the
 *                 installed owning package is a different release.
 *
 * The selected source opens to show its categories. Catalog publishes none, so
 * that row holds its place and says so. The organization's own additions come
 * last and are empty until something is actually imported.
 */

import { el } from "../app/dom.js";
import { NOT_PUBLISHED, NOT_SUPPLIED } from "../app/absence.js";
import { describeScope, sourceScopes } from "./selectors.js";

function badgeNode(scope, selected) {
  if (scope.badge === null) return null;
  const tone = selected
    ? "px-1 py-0.2 rounded bg-surface-container-highest text-[#ffb95f] font-mono text-[9px] shrink-0 font-normal"
    : "px-1.5 py-0.2 rounded bg-surface-container-high/80 text-secondary font-mono text-[10px] shrink-0";
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

/**
 * Why the categories row is empty, with both numbers counted at run time from
 * the served presentation data. Nothing is written into the page: a Catalog
 * that publishes a curated taxonomy changes this sentence by itself, and a
 * coverage this page could not read says so rather than showing a zero.
 */
function categoriesReason(coverage) {
  // Two numbers or none: a missing count is stated as a missing count, never
  // rendered as a zero and never as the word "undefined".
  if (typeof coverage?.published !== "number" || typeof coverage?.entries !== "number") {
    return `${NOT_PUBLISHED}: Catalog publishes no curated category taxonomy, and this preview could not read how many entries carry a category.`;
  }
  return `${NOT_PUBLISHED}: Catalog publishes a category for ${coverage.published} of ${coverage.entries} entries and no curated taxonomy.`;
}

function scopeRow(row, selected, onSelect, coverage) {
  const scope = describeScope(row);
  const panel = el(
    "div",
    selected
      ? "rounded bg-surface-container-low/80 p-1 border border-surface-container-high/40 space-y-0.5"
      : "rounded bg-surface-container-low/40 hover:bg-surface-container-low/80 p-1 border border-surface-container-high/40 transition-colors cursor-pointer",
  );
  const head = el("button", `w-full flex items-center justify-between px-1.5 py-1 text-on-surface font-medium text-left cursor-pointer`);
  head.type = "button";
  head.setAttribute("aria-pressed", String(selected));
  head.title = selected
    ? `${scope.name}: selected. Select again to show every published source.`
    : `Show the ${row.total} items published from ${scope.name}`;
  const left = el("div", `flex items-center ${selected ? "gap-1.5" : "gap-2"} min-w-0 flex-1 mr-1`);
  left.appendChild(
    el("span", `material-symbols-outlined ${selected ? "text-[14px] text-primary" : "text-[15px] text-outline"} shrink-0`, selected ? "folder_open" : "folder"),
  );
  left.appendChild(
    el("span", `${selected ? "text-primary" : "text-on-surface"} truncate font-semibold text-[11.5px]`, scope.name),
  );
  const badge = badgeNode(scope, selected);
  if (badge) left.appendChild(badge);
  if (scope.differs) {
    // Catalog's current content for this package is a different release from
    // the installed package. Shown, never relabelled.
    const marker = el("span", "material-symbols-outlined text-[13px] text-tertiary shrink-0", "sync_problem");
    marker.title = scope.badgeTitle;
    marker.setAttribute("aria-label", scope.badgeTitle);
    left.appendChild(marker);
  }
  head.appendChild(left);
  head.appendChild(
    el(
      "span",
      selected
        ? "font-mono text-[10px] px-1 rounded bg-surface-container-highest text-secondary font-bold shrink-0"
        : "font-mono text-[10.5px] px-1 text-outline shrink-0",
      String(row.total),
    ),
  );
  head.addEventListener("click", () => onSelect(selected ? null : row.filterValue));
  panel.appendChild(head);

  if (selected) {
    // Where the design source lists this source's categories, with counts.
    // Catalog publishes no curated taxonomy, so the row keeps its place and
    // says how little it does publish, counted from the served data.
    const categories = el("div", "pl-2 space-y-0.5 text-[10.5px]");
    const missing = el("div", "flex items-center justify-between px-1.5 py-0.5 rounded text-on-surface-variant opacity-60 cursor-not-allowed");
    missing.dataset.absence = "categories";
    missing.title = categoriesReason(coverage);
    missing.appendChild(el("span", "truncate", "Categories"));
    missing.appendChild(el("span", "font-mono text-outline text-[10px]", NOT_PUBLISHED));
    categories.appendChild(missing);
    panel.appendChild(categories);
  }
  return panel;
}

/** The organization's own additions: nothing is imported yet, and it says so. */
function additionsRow(organizationName) {
  const panel = el("div", "rounded bg-surface-container-low/40 p-1 border border-surface-container-high/40 opacity-80");
  panel.title = "Items your organization adds. None have been imported.";
  const head = el("div", "flex items-center justify-between px-1.5 py-1 text-on-surface font-medium");
  const left = el("div", "flex items-center gap-2 min-w-0 flex-1 mr-1");
  left.appendChild(el("span", "material-symbols-outlined text-[15px] text-outline shrink-0", "extension"));
  left.appendChild(
    el("span", "text-on-surface truncate font-semibold text-[11.5px]", organizationName ? `${organizationName} Additions` : "Your Additions"),
  );
  head.appendChild(left);
  head.appendChild(el("span", "font-mono text-[10.5px] px-1 text-outline shrink-0", NOT_SUPPLIED));
  panel.appendChild(head);
  return panel;
}

/**
 * @param elements  { navSourcesCount, scopeList }
 * @param onSelectSource  called with a scope's filter value, or null for all
 */
export function createNavigation({ elements, onSelectSource }) {
  return {
    /** @param model { view, total, counts, organizationName, categoryCoverage } */
    render(model) {
      elements.navSourcesCount.textContent = String(model.total);
      elements.scopeList.replaceChildren();
      for (const row of sourceScopes(model.counts)) {
        elements.scopeList.appendChild(
          scopeRow(row, model.view.source === row.filterValue, onSelectSource, model.categoryCoverage),
        );
      }
      elements.scopeList.appendChild(additionsRow(model.organizationName ?? null));
    },
  };
}
