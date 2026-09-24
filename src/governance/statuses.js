/*
 * The six verification statuses.
 *
 * One field per axis, always all six, always in the order the contract names
 * them. Never one badge, and never one axis implying another: a component that
 * can only render six separate cells cannot accidentally collapse them.
 */

import { el } from "../app/dom.js";
import { AXES, TONE } from "./vocabulary.js";

/** @param elements { govStatuses } */
export function createStatuses({ elements }) {
  return {
    /** @param view the consumption result, or null when nothing was consumed */
    render(view) {
      const grid = elements.govStatuses;
      grid.replaceChildren();
      if (view === null) return;
      for (const axis of AXES) {
        const value = view[axis];
        const cell = el(
          "div",
          "p-1.5 rounded bg-surface-container-low border border-wb-border space-y-0.5",
        );
        cell.appendChild(el("div", "text-[9px] font-mono uppercase tracking-wider text-outline", axis));
        cell.appendChild(
          el("div", `text-[11px] font-mono font-medium ${TONE[value] ?? "text-on-surface"}`, value),
        );
        grid.appendChild(cell);
      }
    },
  };
}
