/*
 * The catalog grid: one card per visible entry, plus the count above it.
 *
 * A card shows only what the index publishes about that entry. Where the design
 * source shows a product description there is an evidence statement or
 * "Not published" - the card never writes prose about an entry, and the toggle
 * the design source draws stays disabled because no source-posture contract
 * exists to drive it.
 */

import { el } from "../app/dom.js";
import { NOT_PUBLISHED } from "../app/absence.js";
import { KIND_ICON, cardTitleOf, firstSummary, identity, providerOf, sourceIdentity, sourceLabelTitle } from "./entry.js";

function card(entry, selectedId, onSelect) {
  const id = identity(entry);
  const source = sourceIdentity(entry);
  const qual = entry.qualification ?? {};
  const findings = Array.isArray(qual.findings) ? qual.findings.length : null;
  const gaps = Array.isArray(qual.gaps) ? qual.gaps.length : null;
  const isSelected = selectedId === id.entryId;

  const node = el("div", `group rounded border p-3 flex flex-col justify-between hover:border-primary transition-all cursor-pointer ${isSelected ? "border-primary" : "border-surface-container-high/60"}`);
  node.dataset.cardId = id.entryId;
  node.tabIndex = 0;
  node.setAttribute("role", "button");
  node.setAttribute("aria-pressed", String(isSelected));

  const top = el("div");
  const head = el("div", "flex items-start justify-between gap-2");
  const name = el("div", "flex items-center gap-1.5 min-w-0");
  name.appendChild(el("span", "material-symbols-outlined text-[15px] text-[#ffb95f] shrink-0", KIND_ICON[id.kind] ?? "extension"));
  const title = el("span", "font-mono font-bold text-white text-[13px] tracking-tight truncate", cardTitleOf(entry) ?? id.entryId);
  title.title = id.entryId;
  name.appendChild(title);
  head.appendChild(name);
  const badge = el("div", "flex items-center gap-1 shrink-0");
  // The framework the index publishes this under, in the slot the design
  // source gives a grouping label. Absent only when the id does not carry one.
  const provider = providerOf(entry);
  if (provider) {
    badge.appendChild(el("span", "px-1.5 py-0.5 rounded bg-surface-container-low border border-surface-container-high/40 text-[8.5px] font-mono text-outline/90 uppercase", provider));
  }
  badge.appendChild(el("span", "px-1.5 py-0.5 rounded bg-surface-container-low border border-surface-container-high/40 text-[8.5px] font-mono text-outline/90", id.kind.toUpperCase()));
  head.appendChild(badge);
  top.appendChild(head);
  node.title = id.entryId;

  const summary = firstSummary(entry, ["gap", "finding"]);
  const body = el("p", `text-[11px] mt-2 leading-relaxed line-clamp-3 ${summary ? "text-on-surface-variant" : "text-outline/70"}`);
  if (summary) {
    body.appendChild(el("span", "text-outline", "Evidence: "));
    body.appendChild(document.createTextNode(summary));
    body.title = "Published evidence statement, not a product description";
  } else {
    body.textContent = NOT_PUBLISHED;
    body.title = "Not published: the index carries no description and this entry has no evidence statement";
  }
  top.appendChild(body);
  node.appendChild(top);

  const foot = el("div", "pt-2.5 mt-2.5 border-t border-surface-container-high/40 flex items-center justify-between text-[10px]");
  const left = el("div", "flex items-center gap-2 min-w-0");
  const statements = (gaps ?? 0) + (findings ?? 0);
  if (statements > 0) {
    const pill = el("span", "px-1.5 py-0.5 rounded bg-tertiary-container/20 text-tertiary font-mono font-medium flex items-center gap-1 shrink-0");
    pill.appendChild(el("span", "w-1 h-1 rounded-full bg-tertiary"));
    pill.appendChild(el("span", "", `${statements} evidence statement${statements === 1 ? "" : "s"}`));
    pill.title = `${gaps ?? 0} gap statement(s), ${findings ?? 0} finding statement(s)`;
    left.appendChild(pill);
  } else {
    left.appendChild(el("span", "px-1.5 py-0.5 rounded bg-surface-container-low border border-surface-container-high/40 text-outline/70 font-mono shrink-0", "no evidence statements"));
  }
  const sourcePill = el("span", "px-1.5 py-0.5 rounded bg-surface-container-low border border-surface-container-high/40 text-outline/70 font-mono hidden sm:inline-flex items-center gap-1 shrink-0");
  sourcePill.appendChild(el("span", "material-symbols-outlined text-[12px]", "bolt"));
  if (id.sourceLabel === null) {
    sourcePill.appendChild(el("span", "", NOT_PUBLISHED));
    sourcePill.appendChild(el("span", "uppercase", `${id.sourceType} source identity`));
    sourcePill.title = `Not published: this ${id.sourceType} source carries no identity field`;
  } else {
    sourcePill.appendChild(el("span", "", id.sourceLabel));
    sourcePill.title = sourceLabelTitle(source, id.sourceLabel);
  }
  left.appendChild(sourcePill);
  foot.appendChild(left);

  const toggle = el("div", "flex items-center gap-1.5");
  const button = el("button", "toggle-switch w-6 h-3.5 rounded-full bg-surface-container-highest p-0.5 flex items-center opacity-50 cursor-not-allowed", undefined);
  button.type = "button";
  button.disabled = true;
  button.setAttribute("aria-disabled", "true");
  button.dataset.active = "false";
  button.title = `${NOT_PUBLISHED}: no source-posture or allow-list contract`;
  button.appendChild(el("div", "w-2.5 h-2.5 rounded-full bg-outline"));
  toggle.appendChild(button);
  foot.appendChild(toggle);
  node.appendChild(foot);

  const select = () => onSelect(id.entryId);
  node.addEventListener("click", (event) => {
    if (event.target.closest(".toggle-switch")) return;
    select();
  });
  node.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select();
    }
  });
  return node;
}

/**
 * @param elements  { cardsGrid, visibleCount, visibleCaption }
 * @param onSelect  called with the entry id a card stands for
 */
export function createCards({ elements, onSelect }) {
  return {
    /** @param model { entries, total, selectedId } */
    render(model) {
      elements.cardsGrid.replaceChildren();
      if (!model.entries.length) {
        const empty = el("div", "p-4 rounded border border-surface-container-high/60 text-on-surface-variant text-[12px]", "No catalog entry matches this view. Published entries: ");
        empty.appendChild(el("span", "font-mono text-on-surface", String(model.total)));
        elements.cardsGrid.appendChild(empty);
      } else {
        elements.cardsGrid.append(...model.entries.map((entry) => card(entry, model.selectedId, onSelect)));
      }
      elements.visibleCount.textContent = String(model.entries.length);
      elements.visibleCaption.textContent = `of ${model.total} catalog entries`;
    },
  };
}
