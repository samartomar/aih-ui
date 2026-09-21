/*
 * The filter toolbar: search, the kind pills, the source select and the sort
 * select - one row, as the design source has it.
 *
 * The pills scroll rather than wrap, so the row keeps its height. The fade at
 * the right edge is a scroll affordance and is removed once there is nothing
 * left to scroll to, otherwise it dims a label that is entirely visible.
 */

import { el } from "../app/dom.js";
import { sortedCounts } from "./selectors.js";

function kindPill(label, count, active, onClick) {
  const button = el("button", `px-2.5 py-1 rounded text-[10.5px] font-mono transition-colors shrink-0 ${active ? "bg-surface-container-highest text-on-surface font-semibold shadow-xs" : "hover:bg-surface-container text-on-surface-variant"}`, undefined);
  button.type = "button";
  button.setAttribute("aria-pressed", String(active));
  button.textContent = `${label} (${count})`;
  button.addEventListener("click", onClick);
  return button;
}

/**
 * @param elements  { kindFilters, search, sourceFilter, sortSelect }
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

    /** @param model { kindCounts, sourceTypeCounts, total, view } */
    render(model) {
      elements.kindFilters.replaceChildren();
      elements.kindFilters.appendChild(
        kindPill("All", model.total, model.view.kind === null, () => onToggleKind(null)),
      );
      for (const [kind] of sortedCounts(model.kindCounts)) {
        elements.kindFilters.appendChild(
          kindPill(kind, model.kindCounts.get(kind), model.view.kind === kind, () => onToggleKind(kind)),
        );
      }

      // The option list is rebuilt only when the published source types change:
      // replacing it on every render would drop the control's open state.
      const built = [...model.sourceTypeCounts.keys()].join(",");
      if (elements.sourceFilter.dataset.built !== built) {
        elements.sourceFilter.replaceChildren();
        const any = el("option", "", "All Sources");
        any.value = "";
        elements.sourceFilter.appendChild(any);
        for (const [sourceType, count] of sortedCounts(model.sourceTypeCounts)) {
          const option = el("option", "", `${sourceType} (${count})`);
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
