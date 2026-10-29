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
 * not supplied, invalid, unsupported, mismatched or matched, worded as the
 * neutral scan line (never Verified until Scan publishes item summaries).
 * Missing evidence is never a publication claim, and matched is unchecked
 * coverage of exact bytes, not producer authentication, approval or execution
 * authority.
 * No defined producer supplies token values, so the token chip says Unknown.
 * When every visible entry shares a family, its label is shown once above the
 * grid.
 * Local preferences stay unavailable until Catalog publishes an exact mapping
 * from every displayed entry to its authoring asset identity.
 */

import { renderBrowseFacts, itemBrowseFacts } from './browse-facts.js';
import { createGapIndicator } from "../app/gap-indicator.js";
import { el } from "../app/dom.js";
import { sourcePresentation } from './source-facts.js';
import { NOT_PUBLISHED, NOT_SUPPLIED } from "../app/absence.js";
import { iconFor, iconSpan } from "../app/icons.js";
import { attachTooltip } from "../app/tooltip.js";
import { identity } from "./entry.js";

const AUTHORITY = "Producer authenticity is unchecked; this is not an approval or execution authority.";
// One entry per evidence state the host reports, worded as the neutral scan line until Scan publishes item
// summaries: nothing here can say Verified, and the icon (app/icons.js) keeps the status colour meanings.
// `scan` is the scan state whose icon and words the pill borrows; "Not assessable" has no scan-line wording.
export const EVIDENCE_STATE = {
  "not-supplied": { scan: "not-scanned", text: NOT_SUPPLIED, title: () => "No scan record: no Scan report or artifact was supplied. Supply one in Scan Review to see this item's state." },
  invalid: { scan: "unreadable", text: "Scan record can't be read", title: () => "Scan record can't be read: the supplied documents are not valid Scan reports or artifacts." },
  unsupported: { scan: "unreadable", text: "Scan record can't be read", title: () => "Scan record can't be read: the supplied report uses a version this Scan reader does not support." },
  unavailable: { scan: null, text: "Not assessable", title: () => "Not assessable: Scan could not assess this item against the supplied reports." },
  mismatched: { scan: "not-covered", text: "The scan offered covers other files", title: value => `The scan offered covers other files: report ${value.scanId ?? ""} did not capture this item's exact files. ${AUTHORITY}` },
  matched: { scan: "not-verified", text: "Scanned, not verified (unchecked)", title: value => `Scanned, not verified (unchecked): report ${value.scanId ?? ""} captured this item's exact files; Scan Review shows which observations cover them. ${AUTHORITY}` },
};
const NOT_SUPPLIED_EVIDENCE = { state: "not-supplied" };

const NO_FAMILY = { text: NOT_PUBLISHED, value: false, title: "Content family: not published for this entry.", source: "Content family" };

const chosenInSetup = (model, item) => (model.acceptedRoots ?? model.intent?.roots ?? []).some(root => root.itemId === item.id && root.releaseSha256 === item.root.releaseSha256);
function card(entry, selectedId, onSelect, model) {
  const id = identity(entry);
  const source = entry.authoringItem ? sourcePresentation(entry.authoringItem) : null;
  const title = source?.name ?? null;
  const description = source?.description ?? null;
  const badge = entry.authoringItem ? { text: entry.authoringItem.family, value: true, title: 'Installed content family; upstream origins are shown in the inspector.', source: 'Content family' } : NO_FAMILY;
  const isSelected = selectedId === id.entryId;

  const node = el("div", "wb-card group rounded border p-3 flex flex-col justify-between cursor-pointer");
  node.dataset.cardId = id.entryId;
  node.dataset.kind = id.kind;
  node.dataset.categoryLabel = badge.text;
  node.dataset.categoryExplanation = badge.title ?? badge.text;
  node.dataset.categorySource = badge.source;
  node.tabIndex = 0;
  node.setAttribute("role", "button");
  node.setAttribute("aria-pressed", String(isSelected));
  // The exact identifier is always one hover away; the inspector shows it too.
  node.title = `Inspect ${title ?? id.name} · ${id.entryId}`;

  const top = el("div");
  const head = el("div", "flex items-start justify-between gap-2");
  const name = el("div", "flex items-center gap-1.5 min-w-0");
  const kindIcon = iconSpan("kind", id.kind, { size: "text-[15px]", className: "shrink-0" });
  attachTooltip(kindIcon, `Kind: ${iconFor("kind", id.kind).label}`);
  name.appendChild(kindIcon);
  // The item's label from the installed release; otherwise its id.
  name.appendChild(el("span", "wb-card-title text-wb-body font-mono font-medium text-wb-title tracking-tight truncate", title ?? id.name));
  head.appendChild(name);
  const badges = el("div", "card-family flex items-center gap-1 shrink-0");
  const category = el(
    "span",
    `px-1.5 py-0.5 rounded bg-wb-meta-bg border border-wb-border text-[8.5px] font-mono text-wb-meta${badge.value ? " uppercase" : ""}`,
    badge.text,
  );
  attachTooltip(category, badge.title ?? badge.text);
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
  const status = el("span", "px-1.5 py-0.5 rounded bg-wb-meta-bg border border-wb-border text-wb-meta font-mono font-medium flex items-center gap-1 min-w-0");
  status.dataset.evidenceState = evidence.state;
  status.appendChild(iconSpan("scan", shown.scan, { size: "text-[12px]", className: "shrink-0" }));
  // Missing evidence stays a quiet gap indicator whose accessible name is the state; supplied states read as words.
  if (evidence.state === 'not-supplied') {
    status.className = 'text-outline font-mono flex items-center gap-1 shrink-0';
    status.append(createGapIndicator({ label: shown.text, reason: shown.title(evidence) }));
  } else {
    const words = el("span", "truncate", shown.text);
    words.dataset.evidenceText = "";
    status.appendChild(words);
    attachTooltip(status, shown.title(evidence));
  }
  left.appendChild(status);

  const tokens = el("span", "px-1.5 py-0.5 rounded bg-wb-meta-bg border border-wb-border text-wb-meta font-mono hidden sm:inline-flex items-center gap-1 shrink-0");
  tokens.appendChild(el("span", "material-symbols-outlined text-[13px] text-kind-token", "toll"));
  tokens.appendChild(el("span", "", "Unknown"));
  attachTooltip(tokens, "Tokens: unknown. No defined producer supplies token values for this item.");
  left.appendChild(tokens);
  foot.appendChild(left);

  const toggle = el("div", "card-action flex items-center gap-1.5");
  const button = el("button", "toggle-switch w-6 h-3.5 rounded-full bg-surface-container-highest p-0.5 flex items-center opacity-50 cursor-not-allowed", undefined);
  button.type = "button";
  button.disabled = !entry.authoringItem;
  button.setAttribute("aria-disabled", "true");
  button.setAttribute("aria-label", `Local preference unavailable for ${title ?? id.name}`);
  button.title = "Local preference not saved. This control is unavailable in this version and does not change tool access.";
  button.appendChild(el("div", "w-2.5 h-2.5 rounded-full bg-outline"));
  toggle.appendChild(button);
  if (entry.authoringItem) {
    // Add puts the item and the items it needs into the setup in one step; refusals and anything to decide open the review instead.
    // A chosen item's button is Remove (#144), which takes it back out the same way the panel's Remove from setup does.
    const chosen = (model.acceptedRoots ?? model.intent?.roots ?? []).some(root => root.itemId === entry.authoringItem.id && root.releaseSha256 === entry.authoringItem.root.releaseSha256);
    const label = chosen ? 'Remove' : 'Add', busy = chosen ? 'Removing…' : 'Adding…';
    button.className = `px-2 py-1 rounded border text-[10px] font-medium ${chosen ? 'bg-primary-container text-on-primary border-primary hover:border-error' : 'border-wb-control-border text-on-surface-variant hover:text-primary hover:border-primary'}`;
    button.replaceChildren(); button.textContent = label;
    button.disabled = false;
    button.setAttribute('aria-label', `${label} ${entry.authoringItem.id}`);
    button.removeAttribute('aria-disabled');
    button.title = chosen ? `In your ${model.setupWord ?? 'setup'} with the items it needs. Remove takes it out; Undo puts it back.` : 'Add this item and the items it needs to your setup.';
    // An Add or Remove still in flight keeps its busy label when the grid is redrawn meanwhile, so it cannot be used twice.
    const pending = model.busy?.get(id.entryId);
    if (pending) { button.textContent = pending; button.disabled = true; button.setAttribute('aria-busy', 'true'); }
    button.addEventListener('click', async event => {
      event.stopPropagation();
      if (button.disabled) return;
      button.disabled = true; button.textContent = busy; button.setAttribute('aria-busy', 'true');
      try { await (chosen ? model.onRemove?.(entry.authoringItem, id.entryId) : model.onChoose?.(entry.authoringItem, id.entryId)); }
      finally { button.disabled = false; button.textContent = label; button.removeAttribute('aria-busy'); }
    });
  }
  head.appendChild(toggle);
  if (entry.authoringItem?.role) {
    foot.replaceChildren(renderBrowseFacts(entry.authoringItem, model.browse, model.tool, { onApprove: (item, granted) => model.onApprove?.(item, granted), approved: model.approvalOf?.(entry.authoringItem) ?? false, approvalError: model.approvalErrorOf?.(entry.authoringItem) }));
    const namespace = el('span', 'card-namespace', entry.authoringItem.id);
    attachTooltip(namespace, `Namespaced Catalog identity: ${entry.authoringItem.id}`); top.append(namespace);
    const facts = itemBrowseFacts(entry.authoringItem, model.browse, model.tool);
    if (!chosenInSetup(model, entry.authoringItem) && ((facts.recipe && !facts.recipe.available) || (entry.authoringItem.recipes && !model.tool))) {
      button.setAttribute('aria-disabled', 'true');
      button.disabled = true;
      attachTooltip(toggle, facts.recipe?.reason ?? 'Choose your tool in the header before adding per-tool content.');
    }
  }
  node.appendChild(foot);

  const select = () => onSelect(id.entryId);
  node.addEventListener("click", (event) => {
    if (event.target.closest(".toggle-switch")) return;
    select();
  });
  node.addEventListener("keydown", (event) => {
    if (event.target !== node) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select();
    }
  });
  // Decorative glyphs stay hidden; an icon that carries a tooltip is named by its words (app/tooltip.js).
  for (const glyph of node.querySelectorAll(".material-symbols-outlined")) if (!glyph.dataset?.tooltip) glyph.setAttribute("aria-hidden", "true");
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
        const reset = el('button', 'block mt-3 border border-wb-border rounded px-3 py-1', 'Reset filters');
        reset.type = 'button'; reset.addEventListener('click', model.onReset); empty.append(reset);
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

    updateFacts(model) {
      for (const entry of model.entries) {
        if (!entry.authoringItem?.role) continue;
        const node = elements.cardsGrid.querySelector(`[data-card-id="${CSS.escape(entry.entryId)}"]`);
        const facts = node?.querySelector('.browse-facts');
        if (facts) facts.replaceWith(renderBrowseFacts(entry.authoringItem, model.browse, model.tool, { onApprove: (item, granted) => model.onApprove?.(item, granted), approved: model.approvalOf?.(entry.authoringItem) ?? false, approvalError: model.approvalErrorOf?.(entry.authoringItem) }));
      }
    },

    /** Moves keyboard focus to the card for an entry, if the grid shows it; false when it does not. */
    focus(entryId) {
      const node = entryId == null ? undefined : [...elements.cardsGrid.children].find((child) => child.dataset?.cardId === entryId);
      node?.focus();
      return Boolean(node);
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
