/*
 * The Sources & Catalogs feature controller.
 *
 * It owns the one copy of the selection and filter state, and it is the only
 * thing that writes it. Components receive a model and callbacks; they call
 * back, the controller updates the state and renders. There is no event bus and
 * no component reaching into another's DOM or state.
 */

import { catalogElements } from "./elements.js";
import { renderBrowseFacts } from './browse-facts.js';
import { createStartingSets } from './starting-sets.js';
import { createFrameworkNavigation } from './frameworks.js';
import { createCards } from "./cards.js";
import { createDetails } from "./details.js";
import { createMetrics } from "./metrics.js";
import { createNavigation } from "./navigation.js";
import { createProvenance } from "./provenance.js";
import { loadContractCheck } from "../app/contract-check.js";
import { createToolbar } from "./toolbar.js";
import { projectItems, capabilityFacts, declaredTargets, supportedEntries } from "./authoring-model.js";
import { publishedClients } from "../app/core-targets.js";
import { inventoryCounts, scopeTotal, selectedScope, visibleEntries, sourceScopes, sourceFilterValue } from "./selectors.js";
import { emptyView, restoreView, saveView } from "./view-state.js";
import { attachTooltip } from "../app/tooltip.js";
import { el, text } from "../app/dom.js";
import { createProjectBasics, projectFileEntries } from "./project-basics.js";

/**
 * @param onSelectEntry    called with the entry when the selection changes
 * @param onReselectEntry  called when the selected card is activated again
 * @param onSummary        called with the preview summary once it has loaded
 * @param onAdd            called with the catalog item when its card's Add is used; resolves when the Add has settled
 * @param onRemove         called with a chosen catalog item when its card's Remove is used (#144); resolves when it has settled
 * @param onOpenWorkspace  called when Project basics opens the workspace
 */
export function createCatalog({ authoring, onSelectEntry, onReselectEntry = () => {}, onSummary, subscribeSecurity, onAdd = async () => {}, onRemove = async () => {}, onOpenWorkspace = () => {} }) {
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
    // entryId -> 'Adding…' or 'Removing…' while a card's Add or Remove is in flight (the grid is redrawn meanwhile).
    busy: new Map(),
  };
  let restoredView = false, chosenTool = null, legacyBrowsing = false;
  let browseKey, browseContentKey, browseResult, browseAttempt = 0;
  let enterprise = false;
  const savedSetSources = new Set();
  const choices = new Map();
  const startingSets = createStartingSets({ container: document.getElementById('starting-sets'), onChange: (requests, allItems) => {
    const framework = currentFramework(); if (!framework) return;
    choices.set(framework.sha256, { requests, allItems }); saveBrowsing(); render();
  }, onAdd: requests => addSets(requests) });
  function currentFramework() { return authoring.catalog?.frameworks?.find(framework => sourceFilterValue('family', framework.name, framework.sha256) === state.view.source); }
  function browseChoice(framework) {
    if (!framework) return { requests: [], allItems: true };
    if (!choices.has(framework.sha256)) choices.set(framework.sha256, { requests: (framework.sets ?? []).filter(set => set.offer === 'pre-ticked').map(set => ({ release: { releaseSha256: framework.sha256, scope: 'project' }, setId: set.id, setSha256: set.setSha256, options: {}, members: [] })), allItems: !(framework.sets?.length) });
    return choices.get(framework.sha256);
  }
  function saveBrowsing() { try { sessionStorage.setItem('aih-ui-set-browsing', JSON.stringify([...choices])); } catch { state.browsingStorageUnavailable = true; } }
  try { for (const [key, value] of JSON.parse(sessionStorage.getItem('aih-ui-set-browsing') ?? '[]')) if (Array.isArray(value.requests)) choices.set(key, value); } catch { choices.clear(); }
  async function readBrowse(framework, choice, inspect = false) {
    const contentKey = JSON.stringify([framework?.sha256, chosenTool?.id, choice.requests, enterprise]);
    const key = JSON.stringify([contentKey, inspect]);
    const factsOnly = inspect && contentKey === browseContentKey;
    if (key === browseKey) return;
    browseKey = key; browseContentKey = contentKey; const attempt = ++browseAttempt; if (!factsOnly) browseResult = undefined;
    if (!framework) return;
    try { const result = await authoring.request('browse-content', { releaseSha256: framework.sha256, tool: chosenTool?.id, sets: choice.requests, inspect, enterprise, policyBytes: undefined });
      if (attempt !== browseAttempt) return; browseResult = result;
    } catch { if (attempt !== browseAttempt) return; browseResult = { status: 'failed', reason: 'Could not read this source’s sets or tool fit. Your choices are unchanged.' }; }
    if (factsOnly) { cards.updateFacts(cardsModel()); details.render(detailsModel(selectedEntry())); } else render();
  }
  async function addSets(requests) {
    const result = await authoring.propose({ type: 'select-sets', sets: requests, releaseSha256: currentFramework()?.sha256, tool: chosenTool?.id });
    if (result.status === 'ok' && authoring.candidate && !result.diagnostics?.length) authoring.accept();
    const guidance = document.getElementById('framework-guidance');
    guidance.textContent = result.status === 'ok' ? 'Chosen sets added. Review Your setup; save to keep the exact options and origins.' : (result.diagnostics?.map(value => value.message).join(' ') || 'The selected sets could not be added.');
    if (!authoring.draft && result.diagnostics?.some(value => value.code === 'POLICY_BOUND_EXCEEDED')) {
      const keep = el('button', 'set-choice', 'Keep set choices in a draft'); keep.type = 'button'; keep.id = 'browse-keep-draft';
      attachTooltip(keep, 'Explicitly keep these choices in a non-executable draft, retaining the original policy bytes. Existing policy bounds still apply when compiling.');
      keep.addEventListener('click', async () => { keep.disabled = true; const opened = await authoring.openDraft(); if (opened.status === 'ok') await addSets(requests); else guidance.textContent = opened.diagnostics?.map(value => value.message).join(' ') || 'The draft could not be opened. Original choices remain.'; });
      guidance.append(document.createTextNode(' '), keep);
    }
  }

  const changeView = (patch) => {
    Object.assign(state.view, patch);
    saveView(state.view);
    render();
  };

  const provenance = createProvenance({ elements: elements.provenance });
  provenance.setSummary({});
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
  family.addEventListener('change', () => {
    const row = sourceScopes(state.counts).find(row => row.source.release === family.value);
    legacyBrowsing = Boolean(family.value && !authoring.catalog?.frameworks?.some(framework => framework.name === family.value));
    changeView({ family: family.value, source: row?.filterValue ?? null, sourceType: null });
  });
  const frameworkNavigation = document.getElementById('framework-navigation');
  const frameworks = createFrameworkNavigation({ container: frameworkNavigation, onFirstStep: () => document.getElementById('your-tool-trigger').click(), onChoose: framework => {
    legacyBrowsing = false; state.missingFramework = null;
    const entry = state.entries.find(entry => entry.authoringItem.root.releaseSha256 === framework.sha256);
    changeView({ family: entry?.authoringItem.family ?? framework.name, source: sourceFilterValue('family', framework.name, framework.sha256), sourceType: null, kind: null });
  } });
  target.addEventListener('change', () => changeView({ target: target.value }));
  // Project basics shows in place of the cards.
  const projectBasics = createProjectBasics({ elements: elements.projectBasics, onSelect: (entryId) => select(entryId), onOpenWorkspace });
  const basicsOpen = () => !elements.projectBasics.section.hidden;
  const focusCard = (entryId) => basicsOpen() ? projectBasics.focus(entryId) : cards.focus(entryId);
  support.addEventListener('change', () => changeView({ support: support.value }));
  const resetFilters = () => { legacyBrowsing = false; const { family, source } = state.view; Object.assign(state.view, emptyView(), { family, source }); toolbar.setQuery(''); changeView({ target: target.options[0]?.value ?? '' }); };
  document.getElementById('catalog-reset-filters').addEventListener('click', resetFilters);
  const filterDisclosure = document.getElementById('catalog-filter-disclosure');
  filterDisclosure.open = false;
  const advancedDisclosure = document.getElementById('catalog-advanced');
  for (const [disclosure, button] of [[filterDisclosure, "catalog-filters-close"], [advancedDisclosure, "catalog-advanced-close"]]) {
    const close = () => { disclosure.open = false; disclosure.querySelector("summary").focus(); };
    document.getElementById(button).addEventListener("click", close);
    disclosure.addEventListener("keydown", event => { if (event.key === "Escape" && disclosure.open) { event.stopPropagation(); close(); } });
  }
  filterDisclosure.addEventListener('toggle', () => { if (filterDisclosure.open) advancedDisclosure.open = false; });
  advancedDisclosure.addEventListener('toggle', () => { if (advancedDisclosure.open) filterDisclosure.open = false; });

  function browseEntries(view = state.view) {
    const framework = currentFramework(), choice = browseChoice(framework);
    const selected = browseResult?.resolution?.value?.selections;
    return visibleEntries(state.entries, view)
      .filter(entry => !view.family || entry.authoringItem.family === view.family)
      .filter(entry => !framework || entry.authoringItem.role !== 'supporting')
      .filter(entry => !framework || choice.allItems || selected?.some(value => value.item.releaseSha256 === entry.authoringItem.root.releaseSha256 && value.item.itemId === entry.authoringItem.id));
  }

  function selectedEntry() {
    return state.entries.find((candidate) => text(candidate?.entryId) === state.selectedId) ?? null;
  }

  function unusable(entry) { const fit = browseResult?.compatibility?.items?.find(value => value.item.itemId === entry.authoringItem.id); return fit && (fit.support === 'none' || fit.notRendered || fit.staticBlockers?.length); }
  function cardsModel() {
    const scope = selectedScope(state.counts, state.view);
    return {
      entries: supportedEntries(browseEntries(), target.value, support.value).filter(entry => !unusable(entry)),
      browse: { ...browseResult, enterprise },
      tool: chosenTool,
      total: scopeTotal(state.entries, state.view),
      noun: scope === null ? "catalog entries" : "entries from this source",
      selectedId: state.selectedId,
      intent: authoring.intent,
      acceptedRoots: authoring.draft?.roots ?? authoring.intent?.roots ?? [],
      setupWord: authoring.draft ? "draft" : "setup",
      evidence: state.evidence,
      onReset: resetFilters,
      busy: state.busy,
      onChoose: async (item, entryId) => {
        state.chosenId = entryId ?? null;
        state.busy.set(entryId, 'Adding…');
        try { await onAdd({ ...item, selectedTool: chosenTool?.id }); } finally { state.busy.delete(entryId); render(); }
        // A clean Add rebuilds the grid without opening the review; keyboard focus returns to the card.
        if (document.activeElement === document.body || !document.activeElement?.isConnected) focusCard(state.chosenId);
      },
      onRemove: async (item, entryId) => {
        state.chosenId = entryId ?? null;
        state.busy.set(entryId, 'Removing…');
        try { await onRemove(item); } finally { state.busy.delete(entryId); render(); }
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
    return { entry, browse: { ...browseResult, enterprise }, tool: chosenTool, counts: state.counts, target: target.value,
      // Core's nativeClientIds when it published them, otherwise null (support unknown).
      coreClients: publishedClients(state.summary?.coreTargets)?.ids ?? null };
  }

  function render() {
    // Filters can change while the installed catalog is still loading. Keep
    // the loading presentation until refresh has projected the real inventory.
    if (!restoredView) return;
    state.counts = inventoryCounts(state.entries);
    family.value = state.view.family;
    const available = authoring.catalog?.frameworks?.filter(framework => framework.state === 'ready') ?? [];
    const current = available.find(framework => sourceFilterValue('family', framework.name, framework.sha256) === state.view.source);
    const selectedFramework = legacyBrowsing ? null : current ?? available[0];
    if (!legacyBrowsing && !current && selectedFramework) { if (state.view.family && state.view.family !== selectedFramework.name) state.missingFramework = `The previous framework ${state.view.family} is unavailable. Showing ${selectedFramework.name}; saved choices are unchanged.`; state.view.family = selectedFramework.name; state.view.source = sourceFilterValue('family', selectedFramework.name, selectedFramework.sha256); saveView(state.view); }
    family.value = state.view.family;
    frameworks.setCatalog(authoring.catalog, state.view);
    const guidance = document.querySelector('.framework-landing');
    guidance.dataset.step = chosenTool ? 'choose-content' : 'choose-tool';
    document.getElementById('framework-first-step').textContent = chosenTool ? `Browsing for ${chosenTool.label}` : 'Choose your tool';
    document.getElementById('framework-guidance').textContent = chosenTool ? 'Choose content below. Add it to Your setup, then review your choices.' : 'Choose your tool in the header, then explore the framework below.';
    const choice = browseChoice(selectedFramework);
    readBrowse(selectedFramework, choice, Boolean(state.selectedId));
    startingSets.render({ framework: selectedFramework, ...choice, result: browseResult, hasTool: Boolean(chosenTool), saved: savedSetSources.has(selectedFramework?.sha256), items: authoring.catalog?.items ?? [] });
    let quiet = document.getElementById('browse-unsupported');
    if (!quiet) { quiet = el('details', 'browse-unsupported'); quiet.id = 'browse-unsupported'; elements.cards.cardsGrid.before(quiet); }
    const blocked = browseEntries().filter(unusable); quiet.hidden = !blocked.length;
    quiet.replaceChildren(el('summary', '', `${blocked.length} items don’t work in ${chosenTool?.label ?? 'this tool'} — show why`));
    for (const entry of blocked) { const fit = browseResult.compatibility.items.find(value => value.item.itemId === entry.authoringItem.id); const row = el('div', 'unsupported-item'); row.append(el('p', '', `${entry.authoringItem.name ?? entry.authoringItem.label}: ${fit.notRendered?.detail ?? fit.reason} ${(fit.staticBlockers ?? []).map(value => value.detail).join(' ')}`), renderBrowseFacts(entry.authoringItem, browseResult, chosenTool)); quiet.append(row); }
    const context = document.getElementById('framework-context');
    context.replaceChildren();
    if (selectedFramework) {
      context.append(el('span', 'framework-version', selectedFramework.version || 'Version not published'), el('span', 'framework-description', selectedFramework.description || 'Framework description not published.'));
      const sources = (selectedFramework.sources ?? []).map(source => source.repository ?? source.url ?? source.name ?? source.id).filter(Boolean);
      context.append(el('span', 'framework-origin', sources.length ? sources.join(' · ') : 'Source name not published.'));
      if (state.browsingStorageUnavailable) context.append(el('span', '', 'Browsing preferences cannot be saved in this browser.'));
      if (state.savedChoiceProblem) context.append(el('span', '', state.savedChoiceProblem));
      if (state.missingFramework) context.append(el('span', 'framework-missing', state.missingFramework));
      context.append(el('span', 'framework-internal', selectedFramework.kind === 'internal' ? 'Internal · not verified' : selectedFramework.kind === 'fixture' ? 'Public selection-only fixture · not production' : 'Release source · not verified'));
    }
    document.querySelector(".wb-source-heading").textContent = state.view.family || "Choose content for your AI tool";
    target.value = state.view.target;
    support.value = state.view.support;
    const total = state.entries.length;
    const scope = selectedScope(state.counts, state.view);
    const inScope = scopeTotal(state.entries, state.view);
    const cardsView = cardsModel();
    const scoped = browseEntries();
    const count = status => scoped.filter(entry => capabilityFacts(entry.authoringItem, target.value).some(fact => fact.support === status)).length;
    counts.textContent = `${publishedClients(state.summary?.coreTargets)?.ids.length ?? 'Unknown'} Core clients are listed in setup; this catalog declares ${target.options.length} target clients. Target declarations do not establish installation. ${target.value || 'No declared target'} · ${scoped.length} items in family/search/source scope: ${count('supported')} with supported facts · ${count('unsupported')} with unsupported facts · ${count('unknown')} with unknown facts. Mixed items can count in more than one group.`;
    const availableKinds = supportedEntries(browseEntries({ ...state.view, kind: null }), target.value, support.value);
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
    metrics.render({ kindCounts: inventoryCounts(metricScope).kindCounts, total: metricScope.length, activeKind: state.view.kind });
    navigation.render(navigationModel());
    toolbar.render({
      // Keep zero-result kinds visible so an active kind can still be cleared.
      kindCounts: new Map([...state.counts.kindCounts.keys()].map((kind) => [kind, filteredCounts.kindCounts.get(kind) ?? 0])),
      sourceTypeCounts: state.counts.sourceTypeCounts,
      total: availableKinds.length,
      visibleTotal: cardsView.entries.length,
      view: state.view,
    });
    elements.cards.cardsGrid.setAttribute('aria-busy', 'false');
    cards.render(cardsView);
    // Project files are offered whatever the filters and the tool: they apply to every tool.
    const files = projectFileEntries(state.entries);
    projectBasics.render({ ...cardsView, entries: files, total: files.length, noun: 'project files' });
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
    details.render(detailsModel(entry));
    readBrowse(currentFramework(), browseChoice(currentFramework()), true);
    onSelectEntry(entry);
  }

  return {
    setMode: settings => { enterprise = ['admin', 'developer'].includes(settings?.role); render(); },
    setTool: tool => { chosenTool = tool; frameworks.setTool(tool); render(); },
    async start() {
      state.summary = await (await fetch('./summary.json', { cache: 'no-store' })).json();
      provenance.setSummary(state.summary);
      // The start-up contract check answers on its own time; the strip reads "Checking contracts…" meanwhile.
      loadContractCheck().then(answer => provenance.setContractCheck(answer));
      onSummary?.(state.summary);
      let restoredChoiceBytes;
      const refresh = () => {
        if (!authoring.catalog) return;
        try {
          const bytes = authoring.bytes;
          const policy = bytes.length ? JSON.parse(new TextDecoder().decode(bytes)) : {};
          state.savedChoiceProblem = null;
          const sources = authoring.draft?.intent?.provenance ?? authoring.intent?.provenance ?? policy.metadata?.['aih.workbench']?.provenance;
          const record = { version: 1, choices: (sources ?? []).flatMap(source => source.materialSource?.workbenchSetChoices?.choices ?? []) };
          const identity = JSON.stringify(record);
          if (record?.version === 1 && identity !== restoredChoiceBytes) {
            restoredChoiceBytes = identity;
            savedSetSources.clear();
            for (const choice of record.choices) savedSetSources.add(choice.request.release.releaseSha256);
            for (const framework of authoring.catalog.frameworks ?? []) {
              const requests = record.choices.filter(choice => choice.request.release.releaseSha256 === framework.sha256).map(choice => choice.request);
              if (requests.length) choices.set(framework.sha256, { requests, allItems: false });
            }
          }
        } catch { state.savedChoiceProblem = 'Saved set context could not be read. Existing choices are unchanged.'; }
        state.entries = projectItems(authoring.catalog.items);
        if (state.selectedId && !selectedEntry()) { state.selectedId = null; onSelectEntry(null); }
        const selectedFamily = state.view.family, selectedTarget = state.view.target;
        family.replaceChildren(new Option('All families', ''));
        for (const value of [...new Set(authoring.catalog.items.map(item => item.family))]) {
          family.append(new Option(`${value} (${authoring.catalog.items.filter(item => item.family === value).length})`, value));
        }
        family.value = [...family.options].some(option => option.value === selectedFamily) ? selectedFamily : '';
        target.replaceChildren(...declaredTargets(authoring.catalog.items).map(value => new Option(value, value)));
        target.value = [...target.options].some(option => option.value === selectedTarget) ? selectedTarget
          : [...target.options].some(option => option.value === 'claude-code') ? 'claude-code' : target.options[0]?.value ?? '';
        state.view.family = family.value;
        state.view.target = target.value;
        // Startup loads the catalog and shell concurrently. Restore only after
        // the real inventory exists, so saved kinds and sources are validated
        // against its counts rather than the initial empty placeholder.
        if (!restoredView) {
          state.counts = inventoryCounts(state.entries);
          restoreView(state.view, state.counts);
          restoredView = true;
        }
        if (![...family.options].some(option => option.value === state.view.family)) state.view.family = '';
        if (![...target.options].some(option => option.value === state.view.target)) state.view.target = target.options[0]?.value ?? '';
        toolbar.setQuery(state.view.query);
        render();
        refreshEvidence();
      };
      authoring.subscribe(refresh);
      refresh();
    },

    /** Back to the catalog: focus the card just chosen (or the selected one) if shown, otherwise the search box. */
    focusCatalog() {
      if (!focusCard(state.chosenId ?? state.selectedId)) (basicsOpen() ? document.getElementById('project-basics-title') : elements.toolbar.search).focus();
    },

    /** The organization name the user saved, or null. Re-renders the rail. */
    setOrganizationName(name) {
      state.organizationName = name;
      if (state.entries.length > 0) navigation.render(navigationModel());
    },
  };
}
