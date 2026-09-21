/*
 * Source navigation: the left rail.
 *
 * Two lists, both built from what the installed index publishes:
 *
 *   - the frameworks, read from the entry ids (see providerOf), nested under
 *     the installed catalog exactly where the design source puts a catalog's
 *     own scopes. The index carries no category, tag or collection field, so
 *     the thematic-categories row keeps its place and its size and says
 *     "Not published" rather than inventing one;
 *   - the source types, each expanding to its published source identities and,
 *     where an identity publishes more than one revision, to those revisions.
 */

import { el } from "../app/dom.js";
import { NOT_PUBLISHED } from "../app/absence.js";
import { shortDigest } from "./entry.js";
import { FILTER_SEPARATOR, UNATTRIBUTED, sortedCounts, sourceFilterValue } from "./selectors.js";

/* A row with a count. Without an onClick it is a disabled row that still holds
   its place: an unavailable state keeps its component's dimensions. */
function railRow(label, count, options = {}) {
  const rowNode = el("button", `w-full flex items-center justify-between px-1.5 py-0.5 rounded text-left transition-colors ${options.active ? "bg-surface-container-high text-primary font-medium" : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface cursor-pointer"}`, undefined);
  rowNode.type = "button";
  rowNode.setAttribute("aria-pressed", String(Boolean(options.active)));
  rowNode.appendChild(el("span", "truncate", label));
  rowNode.appendChild(el("span", `font-mono text-[10px] ${options.active ? "px-1 rounded bg-tertiary-container text-on-tertiary font-bold" : "text-outline"}`, count === null ? NOT_PUBLISHED : String(count)));
  if (options.title) rowNode.title = options.title;
  if (options.onClick) {
    rowNode.addEventListener("click", options.onClick);
  } else {
    rowNode.disabled = true;
    rowNode.setAttribute("aria-disabled", "true");
    rowNode.classList.add("opacity-50", "cursor-not-allowed");
    rowNode.title = options.title ?? `${NOT_PUBLISHED}: not carried by the installed index`;
  }
  return rowNode;
}

/**
 * @param elements  { packageVersion, packageCount, sourcesCount, scopeList, sourceList }
 * @param onToggleProvider / onToggleSourceType / onSelectSource  the rail's callbacks
 */
export function createNavigation({ elements, onToggleProvider, onToggleSourceType, onSelectSource }) {
  function renderScopes(model) {
    elements.scopeList.replaceChildren();
    for (const [provider, count] of sortedCounts(model.providerCounts)) {
      const unattributed = provider === UNATTRIBUTED;
      elements.scopeList.appendChild(railRow(provider, count, {
        active: model.view.provider === provider,
        title: unattributed
          ? "The entry id does not begin with its own kind, so no framework can be read from it"
          : `Framework published in the index as ${provider}`,
        onClick: unattributed ? undefined : () => onToggleProvider(provider),
      }));
    }
    elements.scopeList.appendChild(railRow("Thematic categories", null, {
      title: `${NOT_PUBLISHED}: the index carries no category, tag or collection field`,
    }));
  }

  function renderSources(model) {
    elements.sourceList.replaceChildren();
    for (const [sourceType, count] of sortedCounts(model.sourceTypeCounts)) {
      const identities = model.sourceIdentities.get(sourceType) ?? new Map();
      const activeInType =
        model.view.sourceType === sourceType ||
        (model.view.source?.startsWith(`${sourceType}${FILTER_SEPARATOR}`) ?? false);
      const panel = el("div", "rounded bg-surface-container-low/60 border border-surface-container-high/40 p-1 space-y-0.5");
      panel.appendChild(railRow(sourceType, count, {
        active: model.view.sourceType === sourceType,
        onClick: () => onToggleSourceType(sourceType),
      }));

      if (activeInType) {
        const nested = el("div", "pl-2 space-y-0.5");
        const singleIdentity = identities.size === 1;
        for (const [identityKey, group] of sortedCounts(identities)) {
          const label = identityKey === NOT_PUBLISHED && singleIdentity ? `${sourceType} sources` : identityKey;
          const revisions = sortedCounts(group.revisions);
          const sharedRevision = revisions.length === 1 ? (revisions[0][0] === NOT_PUBLISHED ? "" : revisions[0][0]) : "";
          nested.appendChild(railRow(label, group.total, {
            active: model.view.source === sourceFilterValue(sourceType, identityKey, sharedRevision),
            title: `${sourceType} source identity: ${identityKey}`,
            onClick: () => onSelectSource(sourceFilterValue(sourceType, identityKey, sharedRevision)),
          }));
          if (revisions.length > 1) {
            const revisionRows = el("div", "pl-2 space-y-0.5");
            for (const [revision, revisionCount] of revisions) {
              revisionRows.appendChild(railRow(shortDigest(revision) ?? revision, revisionCount, {
                active: model.view.source === sourceFilterValue(sourceType, identityKey, revision),
                title: `${sourceType} source revision: ${revision}`,
                onClick: () => onSelectSource(sourceFilterValue(sourceType, identityKey, revision)),
              }));
            }
            nested.appendChild(revisionRows);
          }
        }
        panel.appendChild(nested);
      } else {
        const noun = identities.size === 1 ? "source identity" : "source identities";
        panel.appendChild(el("div", "pl-2 px-1.5 py-0.5 font-mono text-[10px] text-outline", `${identities.size} ${noun}`));
      }
      elements.sourceList.appendChild(panel);
    }
  }

  return {
    /** @param model { view, total, packageVersion, providerCounts, sourceTypeCounts, sourceIdentities } */
    render(model) {
      elements.railPackageVersion.textContent = model.packageVersion ?? NOT_PUBLISHED;
      elements.railPackageCount.textContent = String(model.total);
      elements.navSourcesCount.textContent = String(model.total);
      renderScopes(model);
      renderSources(model);
    },
  };
}
