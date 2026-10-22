/*
 * The metric tiles above the split: one tile per ledger kind.
 *
 * Each counted tile counts the same entries as the list, in the same family,
 * source, search and target-support scope, before the kind selection itself
 * (so a selected tile can still be cleared). Hook tiles count hook items; an
 * item may declare several events, and no event count is published. Token
 * values are unknown: no defined producer supplies them, so that tile is never
 * clickable and never shows an invented number.
 */

import { el } from "../app/dom.js";
import { KIND_ICON } from "./entry.js";

const LEDGER = [
  { key: "skill", label: "Skills", icon: KIND_ICON.skill, iconTone: "text-kind-skill", barTone: "bg-kind-skill" },
  { key: "command", label: "Commands", icon: "terminal", iconTone: "text-ledger-command", barTone: "bg-ledger-command" },
  { key: "agent", label: "Agents", icon: "smart_toy", iconTone: "text-ledger-agent", barTone: "bg-ledger-agent" },
  { key: "mcp", label: "MCP Servers", icon: "dns", iconTone: "text-ledger-mcp", barTone: "bg-ledger-mcp" },
  { key: "hook", label: "Hook Items", icon: "webhook", iconTone: "text-ledger-hook", barTone: "bg-ledger-hook", caption: "items, not events" },
  { key: null, label: "Tokens", icon: "toll", iconTone: "text-kind-token", barTone: "bg-kind-token" },
];
const UNKNOWN = "Unknown";

function tile(kind, model, onToggleKind) {
  const count = kind.key === null ? null : (model.kindCounts.get(kind.key) ?? 0);
  const active = kind.key !== null && model.activeKind === kind.key;
  const button = el("button", `px-4 pt-3 pb-3 flex flex-col gap-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${active ? "bg-metric-selected cursor-pointer" : kind.key === null ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-surface-container/50"}`, undefined);
  button.type = "button";
  button.dataset.metric = kind.key ?? "tokens";
  button.setAttribute("aria-pressed", String(active));
  if (kind.key === null) {
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
    button.title = "Tokens: unknown. No defined producer supplies token values.";
  } else {
    button.title = `${count} ${kind.label.toLowerCase()} in this view (${model.total} entries in the same scope)${kind.key === "hook" ? ". Each counts one hook item, which may declare several events" : ""}.`;
  }

  const head = el("div", "flex items-center justify-between gap-2 min-w-0");
  const name = el("span", "flex items-center gap-1.5 min-w-0");
  name.appendChild(el("span", `material-symbols-outlined text-[14px] ${kind.iconTone}`, kind.icon));
  name.appendChild(el("span", `text-[10px] uppercase font-medium tracking-[0.08em] truncate ${active ? "text-wb-title" : "text-outline"}`, kind.label));
  head.appendChild(name);
  button.setAttribute("aria-label", `${kind.label}: ${count ?? UNKNOWN}.${kind.caption ? ` ${kind.caption}.` : ''} Filter items in this view.`);
  button.appendChild(head);

  const metrics = el("div", "wb-metric-values flex flex-wrap items-baseline justify-between gap-2 min-w-0");
  if (count === null) {
    metrics.appendChild(el("span", "text-[11px] leading-none font-medium font-mono tracking-tight text-outline", UNKNOWN));
  } else {
    const numbers = el("span", "flex items-baseline gap-1");
    numbers.appendChild(el("span", "wb-metric-count text-wb-metric leading-none font-semibold font-mono tabular-nums tracking-tight text-wb-title", String(count)));
    metrics.appendChild(numbers);
    metrics.appendChild(el("span", "wb-metric-caption text-[10px] font-mono tabular-nums text-outline", kind.caption ?? "in this view"));
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
  for (const glyph of button.querySelectorAll(".material-symbols-outlined")) glyph.setAttribute("aria-hidden", "true");
  return button;
}

/**
 * @param container     the tile row
 * @param onToggleKind  called with the kind a tile filters by
 */
export function createMetrics({ container, onToggleKind }) {
  return {
    /** @param model { kindCounts, total, activeKind }: counts and total over the list's scope before the kind selection */
    render(model) {
      const kinds = [...model.kindCounts.keys()];
      const ledger = kinds.map(key => LEDGER.find(value => value.key === key) ?? { key, label: `${key[0].toUpperCase()}${key.slice(1)}s`, icon: KIND_ICON[key] ?? 'extension', iconTone: 'text-metadata-emphasis', barTone: 'bg-primary' });
      container.replaceChildren(...ledger.map(kind => tile(kind, model, onToggleKind)));
    },
  };
}
