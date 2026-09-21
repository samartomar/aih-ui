/*
 * The Sources & Catalogs feature controller.
 *
 * It owns the one copy of the selection and filter state, and it is the only
 * thing that writes it. Components receive a model and callbacks; they call
 * back, the controller updates the state and renders. There is no event bus and
 * no component reaching into another's DOM or state.
 */

import { catalogElements } from "./elements.js";
import { createCards } from "./cards.js";
import { createDetails } from "./details.js";
import { createMetrics } from "./metrics.js";
import { createNavigation } from "./navigation.js";
import { createProvenance } from "./provenance.js";
import { createToolbar } from "./toolbar.js";
import { loadCatalog } from "./index-source.js";
import { inventoryCounts, scopeTotal, selectedScope, visibleEntries } from "./selectors.js";
import { emptyView, restoreView, saveView } from "./view-state.js";
import { text } from "../app/dom.js";

/**
 * @param onSelectEntry  called with the selected entry (or null), so the shell
 *                       and the Governance feature can follow the selection
 */
export function createCatalog({ onSelectEntry }) {
  const elements = catalogElements();
  const state = {
    entries: [],
    summary: null,
    counts: inventoryCounts([]),
    view: emptyView(),
    selectedId: null,
    // The organization's own name, when the user has saved one. It labels the
    // organization's additions row; nothing here reads or invents it.
    organizationName: null,
  };

  const changeView = (patch) => {
    Object.assign(state.view, patch);
    saveView(state.view);
    render();
  };

  const provenance = createProvenance({ elements: elements.provenance });
  const metrics = createMetrics({
    container: elements.metrics.container,
    onToggleKind: (kind) => changeView({ kind: state.view.kind === kind ? null : kind }),
  });
  const navigation = createNavigation({
    elements: elements.navigation,
    onSelectSource: (source) => changeView({ source, sourceType: null }),
  });
  const toolbar = createToolbar({
    elements: elements.toolbar,
    onQuery: (query) => changeView({ query }),
    onToggleKind: (kind) => changeView({ kind: kind === null || state.view.kind === kind ? null : kind }),
    onSourceType: (sourceType) => changeView({ sourceType, source: null }),
    onSort: (sort) => changeView({ sort }),
  });
  const cards = createCards({ elements: elements.cards, onSelect: (entryId) => select(entryId) });
  const details = createDetails({ elements: elements.details });

  function selectedEntry() {
    return state.entries.find((candidate) => text(candidate?.entryId) === state.selectedId) ?? null;
  }

  function cardsModel() {
    const scope = selectedScope(state.counts, state.view);
    return {
      entries: visibleEntries(state.entries, state.view),
      total: scopeTotal(state.entries, state.view),
      noun: scope === null ? "catalog entries" : "entries from this source",
      selectedId: state.selectedId,
    };
  }

  function render() {
    state.counts = inventoryCounts(state.entries);
    const total = state.entries.length;
    const scope = selectedScope(state.counts, state.view);
    const inScope = scopeTotal(state.entries, state.view);
    provenance.render({ summary: state.summary, total, scopeTotal: inScope, scope, counts: state.counts });
    metrics.render({ kindCounts: state.counts.kindCounts, total, activeKind: state.view.kind });
    navigation.render({
      view: state.view,
      total,
      counts: state.counts,
      organizationName: state.organizationName,
    });
    toolbar.render({
      kindCounts: state.counts.kindCounts,
      sourceTypeCounts: state.counts.sourceTypeCounts,
      total,
      scopeTotal: inScope,
      view: state.view,
    });
    cards.render(cardsModel());
    details.render({ entry: selectedEntry(), sourceIdentities: state.counts.sourceIdentities });
  }

  function select(entryId) {
    state.selectedId = entryId;
    const entry = selectedEntry();
    cards.render(cardsModel());
    details.render({ entry, sourceIdentities: state.counts.sourceIdentities });
    onSelectEntry(entry);
  }

  return {
    async start() {
      const { entries, summary } = await loadCatalog();
      state.entries = entries;
      state.summary = summary;
      // Counts first: restoreView validates every saved filter against them, so
      // restoring before they exist silently discards the saved kind and source.
      state.counts = inventoryCounts(state.entries);
      restoreView(state.view, state.counts);
      toolbar.setQuery(state.view.query);
      render();
    },

    /** The organization name the user saved, or null. Re-renders the rail. */
    setOrganizationName(name) {
      state.organizationName = name;
      if (state.entries.length > 0) {
        navigation.render({
          view: state.view,
          total: state.entries.length,
          counts: state.counts,
          organizationName: state.organizationName,
        });
      }
    },
  };
}
