/*
 * The catalog grid: one card per visible entry, plus the count above it.
 *
 * Each slot keeps the meaning the design source gives it:
 *
 *   header   kind icon, the item's name, its CATEGORY badge
 *   body     the publisher's PRODUCT DESCRIPTION
 *   footer   the SCAN STATUS pill, the TOKEN ESTIMATE chip, the allow toggle
 *
 * The installed index publishes none of category, description, scan status or
 * token estimate for any entry. Each slot therefore keeps its place and its
 * look and says "Not published" - it is not borrowed for something else. The
 * evidence statements that used to fill the description slot, the provider and
 * kind that used to fill the category slot and the repository that used to fill
 * the token slot all live in the inspector now, where they are labelled as what
 * they are.
 *
 * The toggle stays disabled: there is no source-posture contract to drive it.
 */

import { el } from "../app/dom.js";
import { NOT_PUBLISHED } from "../app/absence.js";
import { KIND_ICON, KIND_PRIMITIVE, identity } from "./entry.js";

function card(entry, selectedId, onSelect) {
  const id = identity(entry);
  const isSelected = selectedId === id.entryId;

  const node = el("div", `group rounded border p-3 flex flex-col justify-between hover:border-primary transition-all cursor-pointer shadow-xs ${isSelected ? "border-primary" : "border-surface-container-high/60"}`);
  node.dataset.cardId = id.entryId;
  node.tabIndex = 0;
  node.setAttribute("role", "button");
  node.setAttribute("aria-pressed", String(isSelected));
  // The exact identifier is always one hover away; the inspector shows it too.
  node.title = id.entryId;

  const top = el("div");
  const head = el("div", "flex items-start justify-between gap-2");
  const name = el("div", "flex items-center gap-1.5 min-w-0");
  const primitive = KIND_PRIMITIVE[id.kind];
  name.appendChild(
    el(
      "span",
      `material-symbols-outlined text-[15px] shrink-0 ${primitive ?? "text-[#ffb95f]"}`,
      KIND_ICON[id.kind] ?? "extension",
    ),
  );
  name.appendChild(el("span", "font-mono font-bold text-white text-[13px] tracking-tight truncate", id.name));
  head.appendChild(name);
  const badges = el("div", "flex items-center gap-1 shrink-0");
  const category = el(
    "span",
    "px-1.5 py-0.5 rounded bg-surface-container-low border border-surface-container-high/40 text-[8.5px] font-mono text-outline/90",
    NOT_PUBLISHED,
  );
  category.title = `Category: ${NOT_PUBLISHED}. The index carries no category for this item.`;
  badges.appendChild(category);
  head.appendChild(badges);
  top.appendChild(head);

  // The description slot keeps its three lines even when it has one word to
  // show: an unavailable state holds the component's dimensions, so the grid
  // keeps the design source's card proportions instead of closing up.
  const body = el("p", "text-[11px] text-outline/70 mt-2 leading-relaxed line-clamp-3 min-h-[4.875em]", NOT_PUBLISHED);
  body.title = "Description: not published. The index carries no publisher description for this item.";
  top.appendChild(body);
  node.appendChild(top);

  const foot = el("div", "pt-2.5 mt-2.5 border-t border-surface-container-high/40 flex items-center justify-between text-[10px]");
  const left = el("div", "flex items-center gap-2 min-w-0");

  const status = el("span", "px-1.5 py-0.5 rounded bg-surface-container-low border border-surface-container-high/40 text-outline font-mono font-medium flex items-center gap-1 shrink-0");
  status.appendChild(el("span", "w-1 h-1 rounded-full bg-outline"));
  status.appendChild(el("span", "", NOT_PUBLISHED));
  status.title = "Scan status: not published. The index carries no scan result for this item.";
  left.appendChild(status);

  const tokens = el("span", "px-1.5 py-0.5 rounded bg-surface-container-low border border-surface-container-high/40 text-outline font-mono hidden sm:inline-flex items-center gap-1 shrink-0");
  tokens.appendChild(el("span", "material-symbols-outlined text-[13px] primitive-token", "toll"));
  tokens.appendChild(el("span", "", NOT_PUBLISHED));
  tokens.title = "Token estimate: not published.";
  left.appendChild(tokens);
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
    /** @param model { entries, total, noun, selectedId } */
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
      elements.visibleCaption.textContent = `of ${model.total} ${model.noun ?? "catalog entries"}`;
    },
  };
}
