/*
 * The metric tiles above the split: one tile per ledger kind.
 *
 * A kind the index does not carry keeps its tile, at its own size, reading
 * "Not published" - never an invented count or percentage. Only counted kinds
 * are clickable, because only they can filter anything.
 */

import { el } from "../app/dom.js";
import { NOT_PUBLISHED } from "../app/absence.js";

/* Prototype order of the six-kind ledger. Kinds the index carries are counted; the rest keep
   the layout and say Not published. */
const LEDGER = [
  { key: "skill", label: "Skills", icon: "extension", color: "#f59e0b" },
  { key: null, label: "Commands", icon: "terminal", color: "#38bdf8" },
  { key: "agent", label: "Agents", icon: "smart_toy", color: "#c084fc" },
  { key: "mcp", label: "MCP Servers", icon: "dns", color: "#60a5fa" },
  { key: null, label: "Hook Events", icon: "webhook", color: "#34d399" },
  { key: null, label: "Token Budget", icon: "toll", color: "#f97316" },
];

function tile(kind, model, onToggleKind) {
  const count = kind.key === null ? null : (model.kindCounts.get(kind.key) ?? 0);
  const active = kind.key !== null && model.activeKind === kind.key;
  const button = el("button", `px-4 pt-3 pb-3 flex flex-col gap-2 text-left transition-colors focus:outline-none ${active ? "bg-[#ffb95f]/[0.07] cursor-pointer" : kind.key === null ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-surface-container/50"}`, undefined);
  button.type = "button";
  button.setAttribute("aria-pressed", String(active));
  if (kind.key === null) {
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
    button.title = `Not published: the index carries no ${kind.label.toLowerCase()} entries`;
  }

  const head = el("div", "flex items-center justify-between gap-2 min-w-0");
  const name = el("span", "flex items-center gap-1.5 min-w-0");
  name.appendChild(el("span", `material-symbols-outlined text-[14px]`, kind.icon)).style.color = kind.color;
  name.appendChild(el("span", `text-[10px] uppercase font-semibold tracking-[0.08em] truncate ${active ? "text-white" : "text-outline"}`, kind.label));
  head.appendChild(name);
  head.appendChild(el("span", "text-[10px] font-mono tabular-nums shrink-0 text-outline", count === null ? NOT_PUBLISHED : `${count}`));
  button.appendChild(head);

  const metrics = el("div", "flex items-baseline justify-between gap-2");
  if (count === null) {
    metrics.appendChild(el("span", "text-[13px] leading-none font-semibold font-mono tracking-tight text-outline", NOT_PUBLISHED));
  } else {
    const numbers = el("span", "flex items-baseline gap-1");
    numbers.appendChild(el("span", "text-[22px] leading-none font-semibold font-mono tabular-nums tracking-tight text-white", String(count)));
    metrics.appendChild(numbers);
    metrics.appendChild(el("span", "text-[10px] font-mono tabular-nums whitespace-nowrap text-outline", "inventory count"));
  }
  button.appendChild(metrics);

  const track = el("div", "h-[3px] rounded-full bg-surface-container-highest/70 overflow-hidden");
  if (count !== null && model.total) {
    const bar = el("div", "h-full rounded-full");
    bar.style.width = `${Math.round((count / model.total) * 100)}%`;
    bar.style.background = kind.color;
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
