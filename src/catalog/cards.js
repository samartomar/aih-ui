/*
 * The catalog grid: one card per visible entry, plus the count above it.
 *
 * Each slot keeps the meaning the design source gives it:
 *
 *   header   kind icon, the item's name, its content-family badge
 *   body     the item's description from the installed Catalog release
 *   footer   the EVIDENCE pill, the TOKEN chip, local preference
 *
 * The evidence pill is the item's state against the Scan evidence the person
 * supplied, read by Scan's public read and coverage operations on the host:
 * not supplied, invalid, unsupported, mismatched or matched. Missing evidence
 * is never a publication claim, and matched is unchecked coverage of exact
 * bytes, not producer authentication, approval or execution authority.
 * No defined producer supplies token values, so the token chip says Unknown.
 * When every visible entry shares a family, its label is shown once above the
 * grid.
 * Local preferences stay unavailable until Catalog publishes an exact mapping
 * from every displayed entry to its authoring asset identity.
 */

import { el } from "../app/dom.js";
import { sourcePresentation } from './source-facts.js';
import { NOT_PUBLISHED, NOT_SUPPLIED } from "../app/absence.js";
import { KIND_ICON, KIND_TONE, identity } from "./entry.js";

const AUTHORITY = "Producer authenticity is unchecked; this is not an approval or execution authority.";
// One entry per evidence state the host reports; the dot keeps the status colour meanings.
export const EVIDENCE_STATE = {
  "not-supplied": { text: NOT_SUPPLIED, dot: "bg-outline", title: () => "Scan evidence: not supplied. Supply a Scan report in Scan Review to see this item's state." },
  invalid: { text: "Invalid evidence", dot: "bg-error", title: () => "Scan evidence: the supplied documents are not valid Scan reports or artifacts." },
  unsupported: { text: "Unsupported report", dot: "bg-tertiary", title: () => "Scan evidence: the supplied report uses a version this Scan reader does not support." },
  unavailable: { text: "Not assessable", dot: "bg-tertiary", title: () => "Scan evidence: Scan could not assess this item against the supplied reports." },
  mismatched: { text: "Mismatched", dot: "bg-error", title: value => `Scan evidence: report ${value.scanId ?? ""} did not capture this item's exact files. ${AUTHORITY}` },
  matched: { text: "Matched", dot: "bg-primary", title: value => `Scan evidence: report ${value.scanId ?? ""} captured this item's exact files; Scan Review shows which observations cover them. ${AUTHORITY}` },
};
const NOT_SUPPLIED_EVIDENCE = { state: "not-supplied" };

const NO_FAMILY = { text: NOT_PUBLISHED, value: false, title: "Content family: not published for this entry.", source: "Content family" };

function card(entry, selectedId, onSelect, model) {
  const id = identity(entry);
  const source = entry.authoringItem ? sourcePresentation(entry.authoringItem) : null;
  const title = source?.name ?? null;
  const description = source?.description ?? null;
  const badge = entry.authoringItem ? { text: entry.authoringItem.family, value: true, title: 'Installed content family; upstream origins are shown in the inspector.', source: 'Content family' } : NO_FAMILY;
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
  // The item's label from the installed release; otherwise its id.
  name.appendChild(el("span", "wb-card-title text-wb-body font-mono font-medium text-wb-title tracking-tight truncate", title ?? id.name));
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
  const body = el("p", "wb-card-description text-wb-card-description text-on-surface-variant mt-2 line-clamp-3 break-words", description ?? NOT_PUBLISHED);
  body.title = description === null ? "Description: not published for this entry." : "Description from the installed Catalog release.";
  top.appendChild(body);
  node.appendChild(top);

  const foot = el("div", "pt-2.5 mt-2.5 border-t border-wb-border flex items-center justify-between text-[10px]");
  const left = el("div", "flex items-center gap-2 min-w-0");

  const evidence = model.evidence?.get(id.entryId) ?? NOT_SUPPLIED_EVIDENCE;
  const shown = EVIDENCE_STATE[evidence.state] ?? EVIDENCE_STATE.unavailable;
  const status = el("span", "px-1.5 py-0.5 rounded bg-wb-meta-bg border border-wb-border text-wb-meta font-mono font-medium flex items-center gap-1 shrink-0");
  status.dataset.evidenceState = evidence.state;
  status.appendChild(el("span", `w-1 h-1 rounded-full ${shown.dot}`));
  status.appendChild(el("span", "", shown.text));
  status.title = shown.title(evidence);
  left.appendChild(status);

  const tokens = el("span", "px-1.5 py-0.5 rounded bg-wb-meta-bg border border-wb-border text-wb-meta font-mono hidden sm:inline-flex items-center gap-1 shrink-0");
  tokens.appendChild(el("span", "material-symbols-outlined text-[13px] text-kind-token", "toll"));
  tokens.appendChild(el("span", "", "Unknown"));
  tokens.title = "Tokens: unknown. No defined producer supplies token values for this item.";
  left.appendChild(tokens);
  foot.appendChild(left);

  const toggle = el("div", "flex items-center gap-1.5");
  const button = el("button", "toggle-switch w-6 h-3.5 rounded-full bg-surface-container-highest p-0.5 flex items-center opacity-50 cursor-not-allowed", undefined);
  button.type = "button";
  button.disabled = !entry.authoringItem;
  button.setAttribute("aria-disabled", "true");
  button.setAttribute("aria-label", `Local preference unavailable for ${title ?? id.name}`);
  button.title = "Local preference not saved. This control is unavailable in this version and does not change tool access.";
  button.appendChild(el("div", "w-2.5 h-2.5 rounded-full bg-outline"));
  toggle.appendChild(button);
  if (entry.authoringItem) {
    const chosen = model.intent?.roots.some(root => root.itemId === entry.authoringItem.id && root.releaseSha256 === entry.authoringItem.root.releaseSha256);
    button.className = 'px-2 py-1 rounded bg-primary-container text-on-primary text-[10px] font-medium';
    button.replaceChildren(); button.textContent = chosen ? 'Selected' : 'Choose';
    button.setAttribute('aria-label', `Choose ${entry.authoringItem.id}`);
    button.removeAttribute('aria-disabled');
    button.title = 'Review this proposed choice in your policy workspace before accepting it.';
    button.addEventListener('click', event => { event.stopPropagation(); model.onChoose(entry.authoringItem); });
  }
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
    /** @param model { entries, total, noun, selectedId, intent, onChoose, evidence } -- evidence: Map entryId -> { state, scanId } */
    render(model) {
      elements.cardsGrid.replaceChildren();
      elements.categoryContext.textContent = "";
      if (!model.entries.length) {
        const empty = el("div", "p-4 rounded border border-wb-border text-on-surface-variant text-[12px]", "No catalog entry matches this view. Published entries: ");
        empty.appendChild(el("span", "font-mono text-on-surface", String(model.total)));
        elements.cardsGrid.appendChild(empty);
      } else {
        const nodes = model.entries.map((entry) => card(entry, model.selectedId, onSelect, model));
        const shared = nodes[0].dataset.categoryLabel;
        if (shared !== NOT_PUBLISHED && nodes.every((node) => node.dataset.categoryLabel === shared && node.dataset.categorySource === nodes[0].dataset.categorySource)) {
          elements.categoryContext.textContent = `${nodes[0].dataset.categorySource} · ${shared}`;
          elements.categoryContext.title = "Every visible item shares this content family.";
          for (const node of nodes) {
            node.dataset.sharedCategory = "true";
            node.title = `${node.dataset.cardId}\n${node.dataset.categoryExplanation}`;
          }
        }
        elements.cardsGrid.append(...nodes);
      }
      elements.visibleCount.textContent = String(model.entries.length);
      elements.visibleCaption.textContent = model.entries.length === 1 ? "entry" : "entries";
      elements.visibleCaption.title = `Showing ${model.entries.length} of ${model.total} ${model.noun ?? "catalog entries"}.`;
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
