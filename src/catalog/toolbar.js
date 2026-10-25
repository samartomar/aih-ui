/*
 * Two-row toolbar: search and review state, then counts, kinds and selectors.
 *
 *   Search                         All   Needs Review   Egress Out   Signals
 *
 * "All" is the unfiltered review state. "Needs Review" and
 * "Egress Out" keep their purpose and their place but are unavailable, with no
 * count: no per-item scan result or Core disposition is published to derive a
 * review state from, and no item declares egress - an empty declaration is not
 * a measurement, so it cannot be counted as "does not send data out". A count
 * would be invented; a disabled control with its reason is not.
 *
 * The unavailable signal chips remain in the toolbar's Signals disclosure,
 * so their explicit absence wording stays available without repeating a row.
 *
 * The second row contains the live entry count, kind chips, source type and sort.
 *
 * The kind pills scroll rather than wrap. The fade at their right edge is a
 * scroll affordance and is removed once there is nothing left to scroll to.
 */

import { createGapIndicator } from "../app/gap-indicator.js";
import { el } from "../app/dom.js";
import { NOT_PUBLISHED } from "../app/absence.js";
import { sortedCounts } from "./selectors.js";
import { iconFor, iconSpan } from "../app/icons.js";
import { attachTooltip } from "../app/tooltip.js";

const PILL_ACTIVE = "px-2.5 py-1 rounded bg-surface-container-highest text-on-surface font-medium text-[10.5px] font-mono shadow-xs transition-colors shrink-0";
const PILL_IDLE = "px-2.5 py-1 rounded hover:bg-surface-container text-on-surface-variant text-[10.5px] font-mono transition-colors shrink-0";
const PILL_UNAVAILABLE = "px-2.5 py-1 rounded text-on-surface-variant text-[10.5px] font-mono shrink-0 opacity-50 cursor-not-allowed";
const KIND_LABELS = { agent: "Agents", mcp: "MCP", skill: "Skills", package: "Packages", profile: "Profiles" };
const KIND_ORDER = Object.keys(KIND_LABELS);

/** Why each unavailable review state has nothing to filter on. */
const UNAVAILABLE = {
  "Needs Review":
    `${NOT_PUBLISHED}: supplied Scan evidence gives an evidence state, not a review state, and no Core disposition is published per item, so no review state can be derived.`,
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
    // Greyed, not disabled, so its reason stays reachable by keyboard; it has no action.
    button.setAttribute("aria-disabled", "true");
    attachTooltip(button, UNAVAILABLE[label]);
  }
  return button;
}

function summaryChip(icon, label, title) {
  const chip = el("span", "px-2 py-1 rounded bg-surface-container border border-wb-border text-outline flex items-center gap-1 shrink-0 whitespace-nowrap");
  chip.appendChild(el("span", "material-symbols-outlined text-[12px] text-outline", icon));
  chip.appendChild(el("span", "font-medium", label));
  chip.appendChild(createGapIndicator({ label: NOT_PUBLISHED, reason: title }));
  // The gap indicator is the chip's keyboard and touch way to the reason; hover keeps the title.
  chip.title = title;
  for (const glyph of chip.querySelectorAll(".material-symbols-outlined")) glyph.setAttribute("aria-hidden", "true");
  return chip;
}

function kindPill(label, count, active, onClick, key = label) {
  // Keep the chips compact and non-wrapping within their scrollable strip.
  const button = el("button", `px-2 py-0 leading-[16.5px] rounded text-[10px] font-mono transition-colors shrink-0 inline-flex items-center gap-1 ${active ? "bg-surface-container-highest text-on-surface font-medium shadow-xs" : "hover:bg-surface-container text-on-surface-variant"}`, undefined);
  button.type = "button";
  button.dataset.kind = JSON.stringify(key);
  button.setAttribute("aria-pressed", String(active));
  // The kind's own icon and accent from the shared map; "All" names no kind.
  if (key !== null) button.appendChild(iconSpan("kind", key, { size: "text-[12px]" }));
  button.appendChild(el("span", "", key === null ? label : `${label} (${count})`));
  const kind = key === null ? "All kinds" : iconFor("kind", key).label;
  attachTooltip(button, `${kind}: ${count} items matching ${key === null ? "the current" : "this kind and the current"} family, source, search and target-support filters.`);
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
  new ResizeObserver(markPillOverflow).observe(elements.kindFilters);

  return {
    /** The saved query, put into the input before the first render. */
    setQuery(query) {
      elements.search.value = query;
    },

    /** @param model { kindCounts, sourceTypeCounts, total, visibleTotal, view } */
    render(model) {
      // --- primary: review state -----------------------------------------
      // "All" is the only review state that can be derived, so it is the
      // selected one; selecting it again changes nothing.
      elements.reviewFilters.replaceChildren(
        reviewPill("All", null, true, () => {}),
        createGapIndicator({ label: "Needs Review not published", reason: UNAVAILABLE["Needs Review"] }),
        createGapIndicator({ label: "Egress Out not published", reason: UNAVAILABLE["Egress Out"] }),
      );
      elements.reviewSummary.replaceChildren(
        summaryChip("pending_actions", "need review", UNAVAILABLE["Needs Review"]),
        summaryChip("arrow_outward", "send data out", UNAVAILABLE["Egress Out"]),
      );

      // --- secondary: the technical filters -------------------------------
      const focusedKind = elements.kindFilters.contains(document.activeElement) ? document.activeElement.dataset.kind : null;
      elements.kindFilters.replaceChildren();
      elements.kindFilters.appendChild(
        kindPill("All", model.total, model.view.kind === null, () => onToggleKind(null), null),
      );
      const kinds = sortedCounts(model.kindCounts).sort(([a], [b]) =>
        (KIND_ORDER.indexOf(a) === -1 ? KIND_ORDER.length : KIND_ORDER.indexOf(a)) -
        (KIND_ORDER.indexOf(b) === -1 ? KIND_ORDER.length : KIND_ORDER.indexOf(b)));
      for (const [kind] of kinds) {
        // Retain an active zero-result kind so its filter remains visible.
        if (model.kindCounts.get(kind) === 0 && model.view.kind !== kind) continue;
        elements.kindFilters.appendChild(
          kindPill(KIND_LABELS[kind] ?? kind, model.kindCounts.get(kind), model.view.kind === kind, () => onToggleKind(kind), kind),
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
      elements.sourceFilter.parentElement.hidden = model.sourceTypeCounts.size <= 1;
      elements.sourceFilter.value = model.view.sourceType ?? "";
      elements.sortSelect.value = model.view.sort;
      markPillOverflow();
    },
  };
}
