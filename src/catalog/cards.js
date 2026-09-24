/*
 * The catalog grid: one card per visible entry, plus the count above it.
 *
 * Each slot keeps the meaning the design source gives it:
 *
 *   header   kind icon, the item's name, its CATEGORY badge when categories vary
 *   body     the publisher's PRODUCT DESCRIPTION
 *   footer   the SCAN STATUS pill, the TOKEN ESTIMATE chip, the allow toggle
 *
 * The title and description come from Catalog's publisher metadata: the
 * upstream publisher's own text, verbatim, where Catalog publishes it. The
 * category badge is Catalog's CURATED category when the installed Catalog
 * publishes its curated dataset - its label, or "Not curated", with the
 * rationale on the tooltip - and otherwise the category the upstream publisher
 * declares, as before. A curated category is never called an upstream
 * declaration, and an upstream one is never called curated. Where
 * it does not - and for scan status and token estimate, which nothing publishes -
 * each slot keeps its place and its look and says "Not published"; it is not
 * borrowed for something else. The
 * evidence statements that used to fill the description slot, the provider and
 * kind that used to fill the category slot and the repository that used to fill
 * the token slot all live in the inspector now, where they are labelled as what
 * they are.
 *
 * When every visible entry shares a category, its label is shown once above the
 * grid; each card retains its own provenance and rationale in its tooltip.
 * The toggle stays disabled: there is no source-posture contract to drive it.
 */

import { el } from "../app/dom.js";
import { NOT_PUBLISHED } from "../app/absence.js";
import { KIND_ICON, KIND_TONE, identity } from "./entry.js";
import { provenanceNote, publishedText, publisherOf } from "./publisher.js";
import { categoryBadge } from "./categories.js";

/** The category badge's text, whether it reads as a value, and its tooltip. */
function badgeOf(entry, record, categories, publisher) {
  const curated = categoryBadge(categories, entry);
  if (curated !== null) return { text: curated.text, value: curated.curated, title: curated.title, source: "Catalog category" };
  const declared = publishedText(record, "category");
  return {
    text: declared ?? NOT_PUBLISHED,
    value: declared !== null,
    title: provenanceNote(record, "category", "Category", publisher),
    source: "Upstream category",
  };
}

function card(entry, selectedId, onSelect, publisher, categories) {
  const id = identity(entry);
  const record = publisherOf(publisher, entry);
  const title = publishedText(record, "title");
  const description = publishedText(record, "description");
  const badge = badgeOf(entry, record, categories, publisher);
  const isSelected = selectedId === id.entryId;

  const node = el("div", "wb-card group rounded border p-3 flex flex-col justify-between cursor-pointer");
  node.dataset.cardId = id.entryId;
  node.dataset.categoryLabel = badge.text;
  node.dataset.categoryExplanation = badge.title ?? badge.text;
  node.dataset.categorySource = badge.source;
  node.tabIndex = 0;
  node.setAttribute("role", "button");
  node.setAttribute("aria-pressed", String(isSelected));
  // The exact identifier is always one hover away; the inspector shows it too.
  node.title = id.entryId;

  const top = el("div");
  const head = el("div", "flex items-start justify-between gap-2");
  const name = el("div", "flex items-center gap-1.5 min-w-0");
  name.appendChild(
    el(
      "span",
      `material-symbols-outlined text-[15px] shrink-0 ${KIND_TONE[id.kind] ?? "text-metadata-emphasis"}`,
      KIND_ICON[id.kind] ?? "extension",
    ),
  );
  // The publisher's own name when Catalog publishes one; otherwise the item's id.
  name.appendChild(el("span", "wb-card-title text-wb-body font-mono font-bold text-wb-title tracking-tight truncate", title ?? id.name));
  head.appendChild(name);
  const badges = el("div", "flex items-center gap-1 shrink-0");
  const category = el(
    "span",
    `px-1.5 py-0.5 rounded bg-wb-meta-bg border border-wb-border text-[8.5px] font-mono text-wb-meta${badge.value ? " uppercase" : ""}`,
    badge.text,
  );
  category.title = badge.title;
  badges.appendChild(category);
  head.appendChild(badges);
  top.appendChild(head);

  // The description slot keeps its three lines even when it has one word to
  // show: an unavailable state holds the component's dimensions, so the grid
  // keeps the design source's card proportions instead of closing up.
  const body = el("p", "wb-card-description text-wb-body text-on-surface-variant mt-2 leading-relaxed line-clamp-3 min-h-[4.875em] break-words", description ?? NOT_PUBLISHED);
  body.title = provenanceNote(record, "description", "Description", publisher);
  top.appendChild(body);
  node.appendChild(top);

  const foot = el("div", "pt-2.5 mt-2.5 border-t border-wb-border flex items-center justify-between text-[10px]");
  const left = el("div", "flex items-center gap-2 min-w-0");

  const status = el("span", "px-1.5 py-0.5 rounded bg-wb-meta-bg border border-wb-border text-wb-meta font-mono font-medium flex items-center gap-1 shrink-0");
  status.appendChild(el("span", "w-1 h-1 rounded-full bg-outline"));
  status.appendChild(el("span", "", NOT_PUBLISHED));
  status.title = "Scan status: not published. The index carries no scan result for this item.";
  left.appendChild(status);

  const tokens = el("span", "px-1.5 py-0.5 rounded bg-wb-meta-bg border border-wb-border text-wb-meta font-mono hidden sm:inline-flex items-center gap-1 shrink-0");
  tokens.appendChild(el("span", "material-symbols-outlined text-[13px] text-kind-token", "toll"));
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
 * @param elements  { cardsGrid, visibleCount, visibleCaption, categoryContext }
 * @param onSelect  called with the entry id a card stands for
 */
export function createCards({ elements, onSelect }) {
  return {
    /** @param model { entries, total, noun, selectedId, publisher, categories } */
    render(model) {
      elements.cardsGrid.replaceChildren();
      elements.categoryContext.textContent = "";
      if (!model.entries.length) {
        const empty = el("div", "p-4 rounded border border-wb-border text-on-surface-variant text-[12px]", "No catalog entry matches this view. Published entries: ");
        empty.appendChild(el("span", "font-mono text-on-surface", String(model.total)));
        elements.cardsGrid.appendChild(empty);
      } else {
        const nodes = model.entries.map((entry) => card(entry, model.selectedId, onSelect, model.publisher, model.categories));
        const shared = nodes[0].dataset.categoryLabel;
        if (shared !== NOT_PUBLISHED && nodes.every((node) => node.dataset.categoryLabel === shared && node.dataset.categorySource === nodes[0].dataset.categorySource)) {
          elements.categoryContext.textContent = `${nodes[0].dataset.categorySource} · ${shared}`;
          elements.categoryContext.title = "Hover an item for its own category provenance and rationale.";
          for (const node of nodes) {
            node.dataset.sharedCategory = "true";
            node.title = `${node.dataset.cardId}\n${node.dataset.categoryExplanation}`;
          }
        }
        elements.cardsGrid.append(...nodes);
      }
      elements.visibleCount.textContent = String(model.entries.length);
      elements.visibleCaption.textContent = `of ${model.total} ${model.noun ?? "catalog entries"}`;
    },

    /**
     * Moves the selection from one card to another without rebuilding the
     * grid, so the card the operator activated keeps keyboard focus. A card
     * the current view does not show is simply not there to mark.
     */
    setSelected(previousId, nextId) {
      for (const [entryId, selected] of [[previousId, false], [nextId, true]]) {
        if (entryId === null || entryId === undefined) continue;
        const node = elements.cardsGrid.querySelector(`[data-card-id="${CSS.escape(entryId)}"]`);
        if (node === null) continue;
        node.setAttribute("aria-pressed", String(selected));
      }
    },
  };
}
