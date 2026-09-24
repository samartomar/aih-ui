/*
 * The metric tiles above the split: one tile per ledger kind.
 *
 * A kind the index does not carry keeps its tile, at its own size, reading
 * "Not published" - never an invented count or percentage. Only counted kinds
 * are clickable, because only they can filter anything.
 */

import { el } from "../app/dom.js";
import { NOT_PUBLISHED } from "../app/absence.js";

/* Display order of the six-kind ledger. Kinds the index carries are counted; the rest keep
   the layout and say Not published. */
const LEDGER = [
  { key: "skill", label: "Skills", icon: "extension", iconTone: "text-kind-skill", barTone: "bg-kind-skill" },
  { key: null, label: "Commands", icon: "terminal", iconTone: "text-ledger-command", barTone: "bg-ledger-command" },
  { key: "agent", label: "Agents", icon: "smart_toy", iconTone: "text-ledger-agent", barTone: "bg-ledger-agent" },
  { key: "mcp", label: "MCP Servers", icon: "dns", iconTone: "text-ledger-mcp", barTone: "bg-ledger-mcp" },
  { key: null, label: "Hook Events", icon: "webhook", iconTone: "text-ledger-hook", barTone: "bg-ledger-hook" },
  { key: null, label: "Token Budget", icon: "toll", iconTone: "text-kind-token", barTone: "bg-kind-token" },
];

function tile(kind, model, onToggleKind) {
  const count = kind.key === null ? null : (model.kindCounts.get(kind.key) ?? 0);
  const active = kind.key !== null && model.activeKind === kind.key;
  const button = el("button", `px-4 pt-3 pb-3 flex flex-col gap-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${active ? "bg-metric-selected cursor-pointer" : kind.key === null ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-surface-container/50"}`, undefined);
  button.type = "button";
  button.setAttribute("aria-pressed", String(active));
  if (kind.key === null) {
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
    button.title = `Not published: the index carries no ${kind.label.toLowerCase()} entries`;
  }

  const head = el("div", "flex items-center justify-between gap-2 min-w-0");
  const name = el("span", "flex items-center gap-1.5 min-w-0");
  name.appendChild(el("span", `material-symbols-outlined text-[14px] ${kind.iconTone}`, kind.icon));
  name.appendChild(el("span", `text-[10px] uppercase font-medium tracking-[0.08em] truncate ${active ? "text-wb-title" : "text-outline"}`, kind.label));
  head.appendChild(name);
  head.appendChild(el("span", "text-[10px] font-mono tabular-nums shrink-0 text-outline", count === null ? NOT_PUBLISHED : `${count}`));
  button.appendChild(head);

  const metrics = el("div", "flex items-baseline justify-between gap-2");
  if (count === null) {
    metrics.appendChild(el("span", "text-[11px] leading-none font-medium font-mono tracking-tight text-outline", NOT_PUBLISHED));
  } else {
    const numbers = el("span", "flex items-baseline gap-1");
    numbers.appendChild(el("span", "wb-metric-count text-wb-metric leading-none font-semibold font-mono tabular-nums tracking-tight text-wb-title", String(count)));
    metrics.appendChild(numbers);
    metrics.appendChild(el("span", "text-[10px] font-mono tabular-nums whitespace-nowrap text-outline", "inventory count"));
  }
  button.appendChild(metrics);

  const track = el("div", "h-[3px] rounded-full bg-wb-border overflow-hidden");
  if (count !== null && model.total) {
    const bar = el("div", `h-full rounded-full ${kind.barTone}`);
    bar.style.width = `${Math.round((count / model.total) * 100)}%`;
    track.appendChild(bar);
  }
  button.appendChild(track);

  if (kind.key !== null) button.addEventListener("click", () => onToggleKind(kind.key));
  return button;
}

/**
 * @param container     the tile row
 * @param onToggleKind  called with the kind a tile filters by
 */
export function createMetrics({ container, onToggleKind }) {
  return {
    /** @param model { kindCounts, total, activeKind } */
    render(model) {
      container.replaceChildren(...LEDGER.map((kind) => tile(kind, model, onToggleKind)));
    },
  };
}
