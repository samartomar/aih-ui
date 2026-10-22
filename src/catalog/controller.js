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
import { createFrameworkRail, familyLabel, frameworkRows, openFramework, rememberFramework, savedFramework } from "./frameworks.js";
import { createProvenance } from "./provenance.js";
import { createToolbar } from "./toolbar.js";
import { projectItems, capabilityFacts, declaredTargets, supportedEntries } from "./authoring-model.js";
import { publishedClients } from "../app/core-targets.js";
import { inventoryCounts, scopeTotal, selectedScope, visibleEntries, sourceScopes } from "./selectors.js";
import { emptyView, restoreView, saveView } from "./view-state.js";
import { text } from "../app/dom.js";
import { catalogToolView, filterByTools, toolsNotice } from "./tool-match.js";
import { defaultCatalogTool, saveCatalogTool, savedCatalogTool } from "./catalog-tool.js";
import { createYourTool, yourToolModel } from "./your-tool.js";
import { createProjectBasics, frameworkShows, projectFileEntries } from "./project-basics.js";
import { createYourSources } from "./your-sources.js";
import { supportingMaterial } from "./supporting.js";
import { createStartingSets, startingSetIds } from "./starting-sets.js";
import { createHooks, hookEntryIds } from "./hooks.js";
import { inSetupLabel, setupNeeds } from "../app/setup-needs.js";

/**
 * @param onSelectEntry    called with the entry when the selection changes
 * @param onReselectEntry  called when the selected card is activated again
 * @param onSummary        called with the preview summary once it has loaded
 * @param onAdd            called with the catalog item when its card's Add is used; resolves when the Add has settled
 * @param onAddSet         called with a starting set and its chosen optional items when Add all is used; resolves when it has settled
 * @param onFramework      called when a framework is chosen, so its cards show (in place of Project basics)
 * @param onOpenWorkspace  called when Project basics opens the workspace
 * @param onYourSources    called to show Your sources (Add a source, or one of the person's folders)
 */
export function createCatalog({ authoring, onSelectEntry, onReselectEntry = () => {}, onSummary, subscribeSecurity, onAdd = async () => {}, onAddSet = async () => {}, onFramework = () => {}, onOpenWorkspace = () => {}, onYourSources = () => {} }) {
  const elements = catalogElements();
  const state = {
    entries: [],
    summary: null,
    counts: inventoryCounts([]),
    view: emptyView(),
    selectedId: null,
    // The card whose own Add button was used last; Back to catalog returns to it (else to the selected card).
    chosenId: null,
    // entryId -> { state, scanId } from the host's read of the supplied Scan evidence; empty means not supplied.
    evidence: new Map(),
    // The organization's own name, when the user has saved one. It labels the
    // organization's additions row; nothing here reads or invents it.
    organizationName: null,
    // The AI tools chosen in Settings (Core ids) and whether the grid shows only content for them.
    selectedTools: [],
    toolsMode: 'mine',
    // Whether items that declare no specific tool are shown beside those the Catalog marks supported for the chosen tool.
    showUndeclared: false,
    // Whether items that declare the chosen tool but are not marked supported for it (unsupported or unknown) are shown.
    showUnsupported: false,
    // Whether supporting material (notices, references, hook script files; see supporting.js) shows as cards.
    // It comes with the content that needs it, so the default path leaves it out of the grid, the kind tabs and the counts.
    showSupporting: false,
    // Whether starting sets (framework and template items; see starting-sets.js) also show as cards. By default they are
    // offered only in the Starting sets line above the cards, and the grid, kind tabs and counts leave them out.
    showStartingSets: false,
    // Whether hooks also show as cards. By default they are offered only in the Hooks section above the cards (#135),
    // and the grid, kind tabs and counts leave them out.
    showHooks: false,
  };
  let restoredView = false;
  // The tool names the installed Catalog declares, read once per catalog.
  let declaredNames = [];
  const declared = () => declaredNames;
  // The entry ids of the catalog's supporting material, worked out once per catalog.
  let supporting = new Set();
  // The entry ids of the catalog's starting sets, worked out once per catalog.
  let starting = new Set();
  // The entry ids of the catalog's hooks (hook items that are not supporting material), worked out once per catalog.
  let hooks = new Set();
  // Which items are in the setup because a chosen item or set needs them, read from the accepted setup once per change.
  let needsFor, needs = new Map();
  const neededBy = item => {
    const intent = authoring.intent, draft = authoring.draft;
    if (needsFor?.intent !== intent || needsFor?.draft !== draft) {
      needsFor = { intent, draft }; needs = setupNeeds({ intent, draft, policyBytes: draft ? undefined : authoring.bytes });
    }
    const roots = needs.get(`${item.root?.releaseSha256}/${item.id}`);
    if (!roots?.length) return '';
    const labelOf = root => authoring.catalog?.items.find(value => value.id === root.itemId && value.root.releaseSha256 === root.releaseSha256)?.label ?? root.itemId;
    return inSetupLabel(roots, labelOf);
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
    onSelectSource: (source) => {
      const row = sourceScopes(state.counts).find(row => row.filterValue === source);
      changeView({ source, sourceType: null, family: row?.source.release ?? '' });
    },
  });
  const toolbar = createToolbar({
    elements: elements.toolbar,
    onQuery: (query) => changeView({ query }),
    onToggleKind: (kind) => changeView({ kind: kind === null || state.view.kind === kind ? null : kind }),
    onSourceType: (sourceType) => {
      const scope = selectedScope(state.counts, state.view);
      // A compatible source-type choice narrows within the source; another type leaves the source.
      const keepsScope = sourceType === null || scope?.type === sourceType;
      changeView({ sourceType, ...(keepsScope ? {} : { source: null, family: "" }) });
    },
    onSort: (sort) => changeView({ sort }),
  });
  const cards = createCards({ elements: elements.cards, onSelect: (entryId) => select(entryId) });
  const details = createDetails({ elements: elements.details, authoring, subscribeSecurity });
  const family = document.getElementById('browse-family');
  const target = document.getElementById('browse-target');
  const support = document.getElementById('browse-support');
  const counts = document.getElementById('support-counts');
  // The left panel's frameworks and the family dropdown under Advanced choose the same family. A framework chosen
  // either way is remembered for this viewer's next visit.
  const familyView = (value) => {
    const row = value ? sourceScopes(state.counts).find(row => row.source.release === value) : null;
    return { family: value, source: row?.filterValue ?? null, sourceType: null };
  };
  const chooseFamily = (value) => { rememberFramework(value); changeView(familyView(value)); };
  family.addEventListener('change', () => chooseFamily(family.value));
  const frameworkRail = createFrameworkRail({ list: document.getElementById('framework-list'), onSelect: (value) => { chooseFamily(value); onFramework(value); } });
  // Project basics (#123) shows in place of the cards; while it shows, no framework is the selected one.
  const projectBasics = createProjectBasics({ elements: elements.projectBasics, onSelect: (entryId) => select(entryId), onOpenWorkspace });
  const basicsOpen = () => !elements.projectBasics.section.hidden;
  // Your sources (#124) shows in place of the cards too: one section per folder the person added.
  const yourSources = createYourSources({ authoring, onSelect: (entryId) => select(entryId), onOpen: onYourSources, onChange: () => render() });
  const sourcesOpen = () => !document.getElementById('your-sources').hidden;
  document.addEventListener('aih:view-changed', () => { if (restoredView) renderFrameworks(); });
  // The left panel counts what each framework shows for the chosen tool, by the same rules as its grid and kind tabs.
  const frameworkCounts = () => new Map(frameworkRows(authoring.catalog?.items ?? []).map(row => [row.family,
    supportedEntries(offeredEntries({ ...emptyView(), ...familyView(row.family), target: state.view.target }), state.view.target, state.view.support).length]));
  const renderFrameworks = () => frameworkRail.render({ rows: frameworkRows(authoring.catalog?.items ?? [], frameworkCounts()), selected: basicsOpen() || sourcesOpen() ? null : state.view.family });
  const focusCard = (entryId) => basicsOpen() ? projectBasics.focus(entryId) : sourcesOpen() ? yourSources.focus(entryId) : cards.focus(entryId);
  // The Catalog tool name is the person's own choice; it is remembered for the next visit and shared with the page.
  target.addEventListener('change', () => { saveCatalogTool(target.value); changeView({ target: target.value }); });
  support.addEventListener('change', () => changeView({ support: support.value }));
  // Reset clears the filters, not the person's tool choice or the open framework.
  const resetFilters = () => { const tool = state.view.target, open = state.view.family; Object.assign(state.view, emptyView()); toolbar.setQuery(''); changeView({ target: tool, ...familyView(open) }); };
  document.getElementById('catalog-reset-filters').addEventListener('click', resetFilters);
  const filterDisclosure = document.getElementById('catalog-filter-disclosure');
  if (window.innerWidth <= 760) filterDisclosure.open = false;
  // The tool line under Advanced: the Catalog tool the grid shows content for, Show all, and the undeclared switch.
  const toolsShowing = document.getElementById('catalog-tools-showing');
  const toolsToggle = document.getElementById('catalog-tools-toggle');
  const toolsUndeclared = document.getElementById('catalog-tools-undeclared');
  const toolsUnsupported = document.getElementById('catalog-tools-unsupported');
  const toolsUnmatched = document.getElementById('catalog-tools-unmatched');
  const toolsSupporting = document.getElementById('catalog-tools-supporting');
  toolsSupporting.addEventListener('click', () => { state.showSupporting = !state.showSupporting; render(); });
  const toolsStarting = document.getElementById('catalog-tools-starting');
  toolsStarting.addEventListener('click', () => { state.showStartingSets = !state.showStartingSets; render(); });
  const startingSets = createStartingSets({ section: document.getElementById('starting-sets'), list: document.getElementById('starting-sets-list'),
    note: document.getElementById('starting-sets-note'), authoring, onAddSet: (set, choice) => onAddSet(set, choice) });
  const toolsHooks = document.getElementById('catalog-tools-hooks');
  toolsHooks.addEventListener('click', () => { state.showHooks = !state.showHooks; render(); });
  const hooksSection = createHooks({ section: document.getElementById('hooks'), list: document.getElementById('hooks-list'),
    note: document.getElementById('hooks-note'), onAdd: item => onAdd(item) });
  toolsToggle.addEventListener('click', () => { state.toolsMode = state.toolsMode === 'mine' ? 'all' : 'mine'; render(); });
  toolsUndeclared.addEventListener('click', () => { state.showUndeclared = !state.showUndeclared; render(); });
  toolsUnsupported.addEventListener('click', () => { state.showUnsupported = !state.showUnsupported; render(); });
  // The header's Your tool: the same Catalog tool choice as the tool line under Advanced, in one click. Choosing a tool
  // there filters by it again, even after Show all.
  const yourTool = createYourTool({
    elements: elements.yourTool,
    onChoose: (tool) => { saveCatalogTool(tool); state.toolsMode = 'mine'; changeView({ target: tool }); },
    onToggleUndeclared: () => { state.showUndeclared = !state.showUndeclared; render(); },
  });
  const coreTools = () => publishedClients(state.summary?.coreTargets) ?? { ids: [], labels: {} };
  const toolOptions = () => ({ mode: state.toolsMode, coreIds: coreTools().ids, selected: state.selectedTools, labels: coreTools().labels });

  // Search, kind, source and family, before any tool filter. A framework never shows tool adapters or project files.
  function scopeEntries(view = state.view) {
    return visibleEntries(state.entries, view).filter(entry => frameworkShows(entry.authoringItem, view.family));
  }
  // The Catalog tool filter decides content; supporting material, starting sets and hooks are left out of it (and of its
  // counts). Supporting material shows, for every tool, only while Show supporting material is on; starting sets only
  // while Show starting sets as cards is on; and hooks, filtered by the tool like other content, only while Show hooks
  // as cards is on. `supporting`, `starting` and `hooks` count them in this scope either way.
  function catalogTool(view = state.view) {
    const scoped = scopeEntries(view), isSupporting = entry => supporting.has(entry.entryId), isStarting = entry => starting.has(entry.entryId), isHook = entry => hooks.has(entry.entryId);
    const options = { tool: view.target, mode: state.toolsMode, showUndeclared: state.showUndeclared, showUnsupported: state.showUnsupported };
    // Hooks have their own section in a framework view; with All families (under Advanced) they stay cards as before.
    const apart = Boolean(view.family);
    const content = catalogToolView(scoped.filter(entry => !isSupporting(entry) && !isStarting(entry) && !(apart && isHook(entry))), options);
    const toolHooks = apart ? catalogToolView(scoped.filter(isHook), options).entries : [];
    const kept = new Set([...content.entries, ...(state.showHooks ? toolHooks : [])]);
    return { ...content, supporting: scoped.filter(isSupporting).length, starting: scoped.filter(isStarting).length, hooks: apart ? scoped.filter(isHook).length : 0,
      // The hooks the Hooks section offers for the tool: counted with the framework's content, though not cards.
      sectionHooks: state.showHooks ? [] : toolHooks,
      entries: scoped.filter(entry => kept.has(entry) || (state.showSupporting && isSupporting(entry)) || (state.showStartingSets && isStarting(entry))) };
  }
  // The open framework's hooks, whatever the search and kind: the Hooks section offers the ones for Your tool.
  function frameworkHooks(view = state.view) {
    if (!view.family) return [];
    return scopeEntries({ ...view, query: '', kind: null, sourceType: null }).filter(entry => hooks.has(entry.entryId)).map(entry => entry.authoringItem);
  }
  // The open framework's starting sets, whatever the search and kind: the line above the cards offers the ones that fit.
  function frameworkSets(view = state.view) {
    if (!view.family) return [];
    return scopeEntries({ ...view, query: '', kind: null, sourceType: null }).filter(entry => starting.has(entry.entryId)).map(entry => entry.authoringItem);
  }
  // The Catalog tool filter first (Catalog names), then the header tools (Core names); neither is translated into the other.
  function browseEntries(view = state.view) {
    return filterByTools(catalogTool(view).entries, toolOptions());
  }
  // What the framework offers for the tool: its cards and the hooks in its Hooks section. The left panel and the kind
  // pills count this, so a framework's hooks still count as content for the tool.
  function offeredEntries(view = state.view) {
    const { entries, sectionHooks } = catalogTool(view);
    return filterByTools([...entries, ...sectionHooks], toolOptions());
  }
  function renderToolsBar() {
    const tool = state.view.target, view = catalogTool(), options = toolOptions();
    toolsShowing.textContent = !tool ? 'Choose the tool name the Catalog uses for your AI tool'
      : state.toolsMode === 'mine' ? 'Content supported, according to the Catalog, for' : 'Showing content for every tool. Your Catalog tool:';
    // What the header tools would hide; without a Catalog tool the switch shows only when that is something.
    const hiddenByCore = toolsNotice(view.entries, { ...options, mode: 'mine' });
    toolsToggle.hidden = !tool && !hiddenByCore;
    toolsToggle.textContent = state.toolsMode === 'mine' ? 'Show all' : tool ? `Show only ${tool}` : 'Show only my tools';
    toolsUndeclared.hidden = !view.filtered;
    toolsUndeclared.textContent = `${state.showUndeclared ? 'Hide' : 'Show'} ${view.undeclared} with no declared tool`;
    toolsUndeclared.setAttribute('aria-pressed', String(state.showUndeclared));
    toolsUndeclared.title = 'Items that declare no tool, or only a generic one. The Catalog does not list them for any specific tool.';
    toolsUnsupported.hidden = !view.filtered || !view.notSupported;
    toolsUnsupported.textContent = `${state.showUnsupported ? 'Hide' : 'Show'} content not marked supported for ${tool} (${view.notSupported})`;
    toolsUnsupported.setAttribute('aria-pressed', String(state.showUnsupported));
    toolsUnsupported.title = `Items that declare ${tool} but that the Catalog marks unsupported or unknown for it.`;
    toolsSupporting.hidden = !view.supporting;
    toolsSupporting.textContent = `${state.showSupporting ? 'Hide' : 'Show'} supporting material (${view.supporting})`;
    toolsSupporting.setAttribute('aria-pressed', String(state.showSupporting));
    toolsSupporting.title = 'Licenses, notices, references and hook script files. They come with the content that needs them, so they are not cards of their own.';
    toolsStarting.hidden = !view.starting;
    toolsStarting.textContent = `${state.showStartingSets ? 'Hide' : 'Show'} starting sets as cards (${view.starting})`;
    toolsStarting.setAttribute('aria-pressed', String(state.showStartingSets));
    toolsStarting.title = 'Whole sets, such as everything a framework has for one tool. The Starting sets line above the cards offers the ones that fit your tool.';
    toolsHooks.hidden = !view.hooks;
    toolsHooks.textContent = `${state.showHooks ? 'Hide' : 'Show'} hooks as cards (${view.hooks})`;
    toolsHooks.setAttribute('aria-pressed', String(state.showHooks));
    toolsHooks.title = 'Hooks run a command in your AI tool. The Hooks section above the cards offers the ones for your tool, with the command each runs.';
    const notice = state.toolsMode === 'mine' ? hiddenByCore : '';
    toolsUnmatched.textContent = notice; toolsUnmatched.hidden = !notice;
    yourTool.render(yourToolModel({ declared: declared(), tool, mode: state.toolsMode, coreIds: options.coreIds, coreLabels: options.labels,
      coreSelected: state.selectedTools, undeclared: view.undeclared, showUndeclared: state.showUndeclared,
      notSupported: view.notSupported, showUnsupported: state.showUnsupported, coreHidden: hiddenByCore }));
  }

  function selectedEntry() {
    return state.entries.find((candidate) => text(candidate?.entryId) === state.selectedId) ?? null;
  }

  function cardsModel() {
    const scope = selectedScope(state.counts, state.view);
    return {
      entries: supportedEntries(browseEntries(), target.value, support.value),
      total: scopeTotal(state.entries, state.view),
      // The card's tool line names this tool only, with its support.
      tool: target.value,
      noun: scope === null ? "catalog entries" : "entries from this source",
      selectedId: state.selectedId,
      intent: authoring.intent,
      acceptedRoots: authoring.draft?.roots ?? authoring.intent?.roots ?? [],
      acceptedLabel: authoring.draft ? "In draft" : "Added",
      neededBy,
      evidence: state.evidence,
      onReset: resetFilters,
      onChoose: async (item, entryId) => {
        state.chosenId = entryId ?? null;
        await onAdd(item);
        // A clean Add rebuilds the grid without opening the review; keyboard focus returns to the card.
        if (document.activeElement === document.body || !document.activeElement?.isConnected) focusCard(state.chosenId);
      },
    };
  }

  /** The rail's model. */
  function navigationModel() {
    return {
      view: state.view,
      total: state.entries.length,
      counts: state.counts,
      organizationName: state.organizationName,
    };
  }

  function detailsModel(entry) {
    return { entry, counts: state.counts, target: target.value, items: authoring.catalog?.items ?? [], supporting,
      // Core's nativeClientIds when it published them, otherwise null (support unknown).
      coreClients: publishedClients(state.summary?.coreTargets)?.ids ?? null };
  }

  function render() {
    // Filters can change while the installed catalog is still loading. Keep
    // the loading presentation until refresh has projected the real inventory.
    if (!restoredView) return;
    state.counts = inventoryCounts(state.entries);
    family.value = state.view.family;
    target.value = state.view.target;
    support.value = state.view.support;
    const total = state.entries.length;
    const scope = selectedScope(state.counts, state.view);
    const inScope = scopeTotal(state.entries, state.view);
    const cardsView = cardsModel();
    const scoped = browseEntries();
    const count = status => scoped.filter(entry => capabilityFacts(entry.authoringItem, target.value).some(fact => fact.support === status)).length;
    counts.textContent = `${publishedClients(state.summary?.coreTargets)?.ids.length ?? 'Unknown'} Core clients are listed in setup; this catalog declares ${declared().length} tool names. Tool declarations do not establish installation. ${target.value || 'No Catalog tool chosen'} · ${scoped.length} items in family/search/source scope: ${count('supported')} with supported facts · ${count('unsupported')} with unsupported facts · ${count('unknown')} with unknown facts${target.value ? ` · ${count('not-declared')} not declared for ${target.value}` : ''}. Mixed items can count in more than one group.`;
    const availableKinds = supportedEntries(offeredEntries({ ...state.view, kind: null }), target.value, support.value);
    const filteredCounts = inventoryCounts(availableKinds);
    provenance.render({
      summary: state.summary,
      total,
      scopeTotal: inScope,
      scope,
      counts: state.counts,
    });
    // The tiles count the list's own scope, before the kind selection so a selected tile can be cleared.
    const metricScope = availableKinds;
    document.getElementById('catalog-kinds-summary').textContent = `Kinds · ${state.view.kind ?? 'All kinds'} · ${metricScope.length} items`;
    metrics.render({ kindCounts: new Map([...state.counts.kindCounts.keys()].map(kind => [kind, filteredCounts.kindCounts.get(kind) ?? 0])), total: metricScope.length, activeKind: state.view.kind });
    navigation.render(navigationModel());
    renderFrameworks();
    toolbar.render({
      // Keep zero-result kinds visible so an active kind can still be cleared.
      kindCounts: new Map([...state.counts.kindCounts.keys()].map((kind) => [kind, filteredCounts.kindCounts.get(kind) ?? 0])),
      sourceTypeCounts: state.counts.sourceTypeCounts,
      total: availableKinds.length,
      visibleTotal: cardsView.entries.length,
      view: state.view,
    });
    elements.cards.cardsGrid.setAttribute('aria-busy', 'false');
    renderToolsBar();
    cards.render(cardsView);
    startingSets.render({ sets: frameworkSets(), tool: state.view.target, items: authoring.catalog?.items ?? [], supporting,
      accepted: cardsView.acceptedRoots, acceptedLabel: cardsView.acceptedLabel });
    hooksSection.render({ hooks: frameworkHooks(), tool: state.view.target, accepted: cardsView.acceptedRoots, acceptedLabel: cardsView.acceptedLabel, neededBy });
    // Project files are offered whatever the filters and the tool: they apply to every tool.
    const files = projectFileEntries(state.entries);
    projectBasics.render({ ...cardsView, entries: files, total: files.length, noun: 'project files' });
    // A folder's skills are offered whatever the filters and the tool, like a framework's are once it is open.
    yourSources.render({ ...cardsView, entries: state.entries });
    details.render(detailsModel(selectedEntry()));
  }

  // Supplied evidence changes only through the review panel; each change, or a new catalog, re-reads every item's state once.
  const EVIDENCE_BATCH = 2048;
  let evidenceRead = { revision: 0, catalog: undefined }, evidenceAttempt = 0;
  async function refreshEvidence() {
    const catalog = authoring.catalog, revision = authoring.evidenceRevision;
    if (!catalog || (evidenceRead.revision === revision && evidenceRead.catalog === catalog)) return;
    evidenceRead = { revision, catalog };
    const attempt = ++evidenceAttempt, next = new Map();
    if (!authoring.reviewEvidenceCount && !state.evidence.size) return;
    if (authoring.reviewEvidenceCount) {
      const subjects = catalog.items.map(item => ({ releaseSha256: item.root.releaseSha256, itemId: item.id }));
      for (let start = 0; start < subjects.length; start += EVIDENCE_BATCH) {
        const batch = subjects.slice(start, start + EVIDENCE_BATCH);
        const result = await authoring.evidenceStates(batch).catch(error => ({ status: 'refused', diagnostics: [{ message: error.message }] }));
        if (attempt !== evidenceAttempt) return;
        if (result.status === 'ok') for (const value of result.value) next.set(`${value.releaseSha256}/${value.itemId}`, value);
        else for (const subject of batch) next.set(`${subject.releaseSha256}/${subject.itemId}`, { state: 'unavailable' });
      }
    }
    state.evidence = next;
    render();
  }

  function select(entryId) {
    // The selected card again is not a new selection. The inspector is shown
    // if it was collapsed, and nothing else moves.
    if (entryId === state.selectedId) {
      onReselectEntry();
      return;
    }
    const previous = state.selectedId;
    state.selectedId = entryId;
    state.chosenId = null;
    const entry = selectedEntry();
    // The two cards concerned are updated in place. The grid is not rebuilt,
    // so the card the operator activated keeps keyboard focus.
    cards.setSelected(previous, entryId);
    projectBasics.setSelected(previous, entryId);
    yourSources.setSelected(previous, entryId);
    details.render(detailsModel(entry));
    onSelectEntry(entry);
  }

  return {
    async start() {
      state.summary = await (await fetch('./summary.json', { cache: 'no-store' })).json();
      onSummary?.(state.summary);
      const refresh = () => {
        if (!authoring.catalog) return;
        state.entries = projectItems(authoring.catalog.items);
        supporting = supportingMaterial(authoring.catalog.items);
        starting = startingSetIds(authoring.catalog.items);
        hooks = hookEntryIds(authoring.catalog.items, supporting);
        if (state.selectedId && !selectedEntry()) { state.selectedId = null; onSelectEntry(null); }
        const selectedFamily = state.view.family, selectedTarget = state.view.target;
        family.replaceChildren(new Option('All families', ''));
        for (const value of [...new Set(authoring.catalog.items.map(item => item.family))]) {
          family.append(new Option(`${familyLabel(value)} (${authoring.catalog.items.filter(item => item.family === value).length})`, value));
        }
        family.value = [...family.options].some(option => option.value === selectedFamily) ? selectedFamily : '';
        declaredNames = declaredTargets(authoring.catalog.items);
        // The Catalog's own tool names. The default is the person's saved choice, else none: never a guess from the Core ids chosen in Settings.
        target.replaceChildren(new Option('choose…', ''), ...declared().map(value => new Option(value, value)));
        target.value = defaultCatalogTool(declared(), restoredView ? selectedTarget : savedCatalogTool());
        state.view.family = family.value;
        state.view.target = target.value;
        // Startup loads the catalog and shell concurrently. Restore only after
        // the real inventory exists, so saved kinds and sources are validated
        // against its counts rather than the initial empty placeholder.
        const opening = !restoredView;
        if (!restoredView) {
          state.counts = inventoryCounts(state.entries);
          restoreView(state.view, state.counts);
          restoredView = true;
        }
        if (![...family.options].some(option => option.value === state.view.family)) state.view.family = '';
        // A framework is always open (#122): on the first load, or when the open family is no longer installed, the
        // viewer's last framework, else the first in the left panel. "All families" under Advanced stays a choice.
        if (!state.view.family && (opening || selectedFamily)) {
          state.counts = inventoryCounts(state.entries);
          Object.assign(state.view, familyView(openFramework(frameworkRows(authoring.catalog.items), savedFramework())));
          saveView(state.view);
        }
        if (![...target.options].some(option => option.value === state.view.target)) state.view.target = target.value;
        toolbar.setQuery(state.view.query);
        render();
        refreshEvidence();
      };
      authoring.subscribe(refresh);
      refresh();
    },

    /** The AI tools chosen in Settings (Core ids). The grid defaults to showing content for them. */
    setSelectedTools(clients) {
      state.selectedTools = [...(clients ?? [])];
      if (restoredView) render();
    },

    /** Back to the catalog: focus the card just chosen (or the selected one) if shown, otherwise the search box. */
    focusCatalog() {
      if (!focusCard(state.chosenId ?? state.selectedId)) (basicsOpen() ? document.getElementById('project-basics-title') : sourcesOpen() ? document.getElementById('your-sources-title') : elements.toolbar.search).focus();
    },

    /** The organization name the user saved, or null. Re-renders the rail. */
    setOrganizationName(name) {
      state.organizationName = name;
      if (state.entries.length > 0) navigation.render(navigationModel());
    },
  };
}
