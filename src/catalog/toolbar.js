/*
 * The filter toolbar, in two places.
 *
 * PRIMARY - the design source's own task, in its own position:
 *
 *   All Items   Needs Review   Egress Out          need review   send data out
 *
 * "All Items" counts the cards matching the current filters. "Needs Review" and
 * "Egress Out" keep their purpose and their place but are unavailable, with no
 * count: no per-item scan result or Core disposition is published to derive a
 * review state from, and no item declares egress - an empty declaration is not
 * a measurement, so it cannot be counted as "does not send data out". A count
 * would be invented; a disabled control with its reason is not.
 *
 * The unavailable signal chips remain in the toolbar's Signals disclosure,
 * so their explicit absence wording stays available without repeating a row.
 *
 * SECONDARY - the technical filters that are genuinely available (kind, source
 * type, sort), in the grid header where the design source puts its sort
 * control, so they no longer displace the approved toolbar.
 *
 * The kind pills scroll rather than wrap. The fade at their right edge is a
 * scroll affordance and is removed once there is nothing left to scroll to.
 */

import { el } from "../app/dom.js";
import { NOT_PUBLISHED } from "../app/absence.js";
import { sortedCounts } from "./selectors.js";

const PILL_ACTIVE = "px-2.5 py-1 rounded bg-surface-container-highest text-on-surface font-semibold text-[10.5px] font-mono shadow-xs transition-colors shrink-0";
const PILL_IDLE = "px-2.5 py-1 rounded hover:bg-surface-container text-on-surface-variant text-[10.5px] font-mono transition-colors shrink-0";
const PILL_UNAVAILABLE = "px-2.5 py-1 rounded text-on-surface-variant text-[10.5px] font-mono shrink-0 opacity-50 cursor-not-allowed";

/** Why each unavailable review state has nothing to filter on. */
const UNAVAILABLE = {
  "Needs Review":
    `${NOT_PUBLISHED}: no scan result or Core disposition is published per item, so no review state can be derived.`,
  "Egress Out":
    `${NOT_PUBLISHED}: no item declares egress, and an empty declaration is not a measurement of none.`,
};

function reviewPill(label, count, active, onClick) {
  const available = onClick !== null;
  const button = el("button", available ? (active ? PILL_ACTIVE : PILL_IDLE) : PILL_UNAVAILABLE, undefined);
  button.type = "button";
  button.textContent = count === null ? label : `${label} (${count})`;
  button.setAttribute("aria-pressed", String(active));
  if (available) {
    button.addEventListener("click", onClick);
  } else {
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
    button.title = UNAVAILABLE[label];
  }
  return button;
}

function summaryChip(icon, label, title) {
  const chip = el("span", "px-2 py-1 rounded bg-surface-container border border-wb-border text-outline flex items-center gap-1 shrink-0 whitespace-nowrap");
  chip.appendChild(el("span", "material-symbols-outlined text-[12px] text-outline", icon));
  chip.appendChild(el("span", "font-medium", label));
  chip.appendChild(el("span", "text-outline", NOT_PUBLISHED));
  chip.title = title;
  return chip;
}

function kindPill(label, count, active, onClick, key = label) {
  // Sized to the header's own 16.5px line, so moving the kind filter here
  // does not make the row taller than the design source's sort line.
  const button = el("button", `px-2 py-0 leading-[16.5px] rounded text-[10px] font-mono transition-colors shrink-0 ${active ? "bg-surface-container-highest text-on-surface font-semibold shadow-xs" : "hover:bg-surface-container text-on-surface-variant"}`, undefined);
  button.type = "button";
  button.dataset.kind = JSON.stringify(key);
  button.setAttribute("aria-pressed", String(active));
  button.title = `${count} items matching this kind and the current source, category and search filters.`;
  button.textContent = `${label} (${count})`;
  button.addEventListener("click", onClick);
  return button;
}

/**
 * @param elements  { reviewFilters, reviewSummary, kindFilters, search, sourceFilter, sortSelect }
 * @param onQuery / onToggleKind / onSourceType / onSort  the toolbar's callbacks
 */
export function createToolbar({ elements, onQuery, onToggleKind, onSourceType, onSort }) {
  function markPillOverflow() {
    const strip = elements.kindFilters;
    const atEnd = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1;
    strip.dataset.scrolledEnd = String(atEnd);
  }

  elements.search.addEventListener("input", () => onQuery(elements.search.value));
  elements.sourceFilter.addEventListener("change", () => onSourceType(elements.sourceFilter.value || null));
  elements.sortSelect.addEventListener("change", () => onSort(elements.sortSelect.value));
  elements.kindFilters.addEventListener("scroll", markPillOverflow, { passive: true });

  return {
    /** The saved query, put into the input before the first render. */
    setQuery(query) {
      elements.search.value = query;
    },

    /** @param model { kindCounts, sourceTypeCounts, total, visibleTotal, view } */
    render(model) {
      // --- primary: the prototype's review task ---------------------------
      // "All Items" is the only review state that can be derived, so it is the
      // selected one; selecting it again changes nothing.
      elements.reviewFilters.replaceChildren(
        reviewPill("All Items", model.visibleTotal, true, () => {}),
        reviewPill("Needs Review", null, false, null),
        reviewPill("Egress Out", null, false, null),
      );
      elements.reviewSummary.replaceChildren(
        summaryChip("pending_actions", "need review", UNAVAILABLE["Needs Review"]),
        summaryChip("arrow_outward", "send data out", UNAVAILABLE["Egress Out"]),
      );

      // --- secondary: the technical filters -------------------------------
      const focusedKind = elements.kindFilters.contains(document.activeElement) ? document.activeElement.dataset.kind : null;
      elements.kindFilters.replaceChildren();
      elements.kindFilters.appendChild(
        kindPill("All kinds", model.total, model.view.kind === null, () => onToggleKind(null), null),
      );
      for (const [kind] of sortedCounts(model.kindCounts)) {
        elements.kindFilters.appendChild(
          kindPill(kind, model.kindCounts.get(kind), model.view.kind === kind, () => onToggleKind(kind)),
        );
      }
      if (focusedKind) [...elements.kindFilters.querySelectorAll("button[data-kind]")].find((button) => button.dataset.kind === focusedKind)?.focus({ preventScroll: true });

      // The option list is rebuilt only when the published source types change:
      // replacing it on every render would drop the control's open state.
      const built = [...model.sourceTypeCounts.keys()].join(",");
      if (elements.sourceFilter.dataset.built !== built) {
        elements.sourceFilter.replaceChildren();
        const any = el("option", "", "ALL SOURCE TYPES");
        any.value = "";
        elements.sourceFilter.appendChild(any);
        for (const [sourceType, count] of sortedCounts(model.sourceTypeCounts)) {
          const option = el("option", "", `${sourceType.toUpperCase()} (${count})`);
          option.value = sourceType;
          elements.sourceFilter.appendChild(option);
        }
        elements.sourceFilter.dataset.built = built;
      }
      elements.sourceFilter.value = model.view.sourceType ?? "";
      elements.sortSelect.value = model.view.sort;
      markPillOverflow();
    },
  };
}
