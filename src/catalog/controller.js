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
import { categoryCoverage } from "./publisher.js";
import { categoryRows } from "./categories.js";
import { loadCatalog } from "./index-source.js";
import { inventoryCounts, scopeEntries, scopeTotal, selectedScope, visibleEntries } from "./selectors.js";
import { emptyView, restoreView, saveView } from "./view-state.js";
import { text } from "../app/dom.js";

/**
 * @param onSelectEntry  called with the selected entry (or null), so the shell
 *                       and the Governance feature can follow the selection
 * @param onSummary      called once with the preview summary it loaded, for the
 *                       header controls that report installed package facts
 */
/**
 * @param onSelectEntry    called with the entry when the selection changes
 * @param onReselectEntry  called when the selected card is activated again
 * @param onSummary        called with the preview summary once it has loaded
 */
export function createCatalog({ onSelectEntry, onReselectEntry = () => {}, onSummary }) {
  const elements = catalogElements();
  const state = {
    entries: [],
    summary: null,
    counts: inventoryCounts([]),
    // Catalog's collection view as applied to the index: current members,
    // and how many entries it holds only for reference.
    inventory: null,
    // Catalog's publisher titles and descriptions, bound to the served index.
    publisher: null,
    // Catalog's publisher qualification and curated categories, each bound to
    // the served index, or the reason the installed Catalog has none.
    qualification: null,
    categories: null,
    context: { membership: new Map(), installed: new Map() },
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
    onSelectSource: (source) => changeView({ source, sourceType: null, category: null }),
    onToggleCategory: (category) => changeView({
      category: state.view.category !== null && state.view.category.id === category.id ? null : category,
    }),
  });
  const toolbar = createToolbar({
    elements: elements.toolbar,
    onQuery: (query) => changeView({ query }),
    onToggleKind: (kind) => changeView({ kind: kind === null || state.view.kind === kind ? null : kind }),
    onSourceType: (sourceType) => {
      const scope = selectedScope(state.counts, state.view);
      // A compatible source-type choice can narrow alongside the category.
      // Moving to another type leaves this source and its category together.
      const keepsScope = sourceType === null || scope?.type === sourceType;
      changeView({ sourceType, ...(keepsScope ? {} : { source: null, category: null }) });
    },
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
      entries: visibleEntries(state.entries, state.view, state.context.membership, state.publisher, state.categories),
      total: scopeTotal(state.entries, state.view, state.context.membership),
      noun: scope === null ? "catalog entries" : "entries from this source",
      selectedId: state.selectedId,
      publisher: state.publisher,
      categories: state.categories,
    };
  }

  /** The rail's model: its categories are counted here, over the selected scope only. */
  function navigationModel() {
    const curated = state.categories?.state === "published" && state.view.source
      ? { view: state.categories, ...categoryRows(state.categories, scopeEntries(state.entries, state.view, state.context.membership)) }
      : { view: state.categories, rows: [], notCurated: 0 };
    return {
      view: state.view,
      total: state.entries.length,
      counts: state.counts,
      organizationName: state.organizationName,
      categoryCoverage: categoryCoverage(state.publisher, state.summary?.entryCount),
      curated,
    };
  }

  function detailsModel(entry) {
    return { entry, counts: state.counts, publisher: state.publisher, qualification: state.qualification };
  }

  function render() {
    state.counts = inventoryCounts(state.entries, state.context);
    const total = state.entries.length;
    const scope = selectedScope(state.counts, state.view);
    const inScope = scopeTotal(state.entries, state.view, state.context.membership);
    const cardsView = cardsModel();
    const availableKinds = visibleEntries(state.entries, { ...state.view, kind: null }, state.context.membership, state.publisher, state.categories);
    const filteredCounts = inventoryCounts(availableKinds);
    provenance.render({
      summary: state.summary,
      total,
      scopeTotal: inScope,
      scope,
      counts: state.counts,
      inventory: state.inventory,
    });
    metrics.render({ kindCounts: state.counts.kindCounts, total, activeKind: state.view.kind });
    navigation.render(navigationModel());
    toolbar.render({
      // Keep zero-result kinds visible so an active kind can still be cleared.
      kindCounts: new Map([...state.counts.kindCounts.keys()].map((kind) => [kind, filteredCounts.kindCounts.get(kind) ?? 0])),
      sourceTypeCounts: state.counts.sourceTypeCounts,
      total: availableKinds.length,
      visibleTotal: cardsView.entries.length,
      view: state.view,
    });
    cards.render(cardsView);
    details.render(detailsModel(selectedEntry()));
  }

  function select(entryId) {
    // The selected card again is not a new selection. The inspector is shown
    // if it was collapsed, and nothing else moves: the Governance workflow for
    // this entry stays exactly as it is.
    if (entryId === state.selectedId) {
      onReselectEntry();
      return;
    }
    const previous = state.selectedId;
    state.selectedId = entryId;
    const entry = selectedEntry();
    // The two cards concerned are updated in place. The grid is not rebuilt,
    // so the card the operator activated keeps keyboard focus.
    cards.setSelected(previous, entryId);
    details.render(detailsModel(entry));
    onSelectEntry(entry);
  }

  return {
    async start() {
      const { entries, inventory, summary, publisher, qualification, categories } = await loadCatalog();
      state.entries = entries;
      state.publisher = publisher;
      state.qualification = qualification;
      state.categories = categories;
      state.inventory = inventory;
      state.summary = summary;
      onSummary?.(summary);
      state.context = {
        membership: inventory.membership,
        // Installed versions from the backend's installation record, by name.
        installed: new Map(
          (summary?.packages ?? [])
            .filter((pkg) => typeof pkg?.packageName === "string" && typeof pkg?.version === "string")
            .map((pkg) => [pkg.packageName, pkg.version]),
        ),
      };
      // Counts first: restoreView validates every saved filter against them, so
      // restoring before they exist silently discards the saved kind and source.
      state.counts = inventoryCounts(state.entries, state.context);
      restoreView(state.view, state.counts, state.categories, state.entries);
      toolbar.setQuery(state.view.query);
      render();
    },

    /** The organization name the user saved, or null. Re-renders the rail. */
    setOrganizationName(name) {
      state.organizationName = name;
      if (state.entries.length > 0) navigation.render(navigationModel());
    },
  };
}
