import { createGapIndicator } from "./gap-indicator.js";
/*
 * The application shell: the collapsible rails, the inspector tabs and the
 * error banner.
 *
 * It owns those elements and their listeners and nothing else. It never reads a
 * catalog entry or a Core answer - a feature that needs the inspector open asks
 * for it through `setInspectorSelection()` and `openInspector()`.
 */

/**
 * @param elements  the shell's own nodes, from shellElements()
 * @returns { setInspectorSelection, openInspector, showError }
 */
export function createShell(elements) {
  let hasInspectorSelection = false;
  let currentView = "catalog";
  let currentTab = "details";
  let inspectorReturnFocus = null;
  // True while the navigation is folded only because the window was phone-width; a wider window brings it back.
  // A navigation the person folded with the toggle stays folded.
  let navFoldedForWidth = false;
  const overlayMedia = window.matchMedia('(max-width: 1100px)');
  const background = [elements.catalogWorkspace, elements.navRail, elements.catalogKindsDisclosure, document.querySelector("body > header"), document.querySelector("body > header").nextElementSibling];
  elements.catalogKindsDisclosure.open = window.innerWidth > 760;
  const contextDisclosure = document.getElementById('policy-context-disclosure');
  contextDisclosure.open = window.innerWidth > 760;
  function syncOverlay(open) {
    const modal = open && overlayMedia.matches;
    for (const node of background) node.inert = modal;
    elements.inspectorRail.setAttribute('role', modal ? 'dialog' : 'complementary');
    if (modal) elements.inspectorRail.setAttribute('aria-modal', 'true');
    else elements.inspectorRail.removeAttribute('aria-modal');
  }
  const header = document.querySelector('body > header');
  const subheader = header.nextElementSibling;
  const measureHeader = () => document.documentElement.style.setProperty('--workbench-top', `${header.getBoundingClientRect().height + subheader.getBoundingClientRect().height}px`);
  new ResizeObserver(measureHeader).observe(header);
  new ResizeObserver(measureHeader).observe(subheader);
  measureHeader();
  const securityListeners = new Set();
  const securityVisible = () => currentView === "catalog" && currentTab === "security" && hasInspectorSelection && !elements.inspectorRail.classList.contains("w-0");
  const notifySecurity = () => { for (const listener of securityListeners) listener(securityVisible()); };
  const panes = {
    details: elements.paneDetails,
    security: elements.paneSecurity,
    json: elements.paneJson,
  };

  function switchTab(tab) {
    currentTab = tab;
    for (const button of elements.tabButtons) {
      const active = button.dataset.tab === tab;
      button.setAttribute("aria-selected", String(active));
      // One tab stop for the whole list; the arrow keys move between tabs.
      button.tabIndex = active ? 0 : -1;
      button.classList.toggle("text-primary", active);
      button.classList.toggle("text-on-surface-variant", !active);
    }
    for (const [name, pane] of Object.entries(panes)) pane.classList.toggle("hidden", name !== tab);
    notifySecurity();
  }

  function syncNavToggle() {
    const open = !elements.navRail.classList.contains("w-0");
    elements.toggleNavBtn.setAttribute("aria-controls", elements.navRail.id || "nav-rail");
    elements.toggleNavBtn.setAttribute("aria-expanded", String(open));
    elements.toggleNavBtn.title = open ? "Hide navigation" : "Show navigation";
  }

  function toggleNav() {
    navFoldedForWidth = false;
    if (currentView === "catalog" && window.innerWidth <= 760 && elements.navRail.classList.contains("w-0") && !elements.inspectorRail.classList.contains("w-0")) {
      toggleInspector();
    }
    const collapsed = elements.navRail.classList.toggle("w-0");
    elements.navRail.classList.toggle("w-60", !collapsed);
    elements.navRail.classList.toggle("border-r-0", collapsed);
    elements.toggleNavBtn.classList.toggle("text-primary", !collapsed);
    elements.toggleNavBtn.classList.toggle("text-on-surface-variant", collapsed);
    syncNavToggle();
  }
  // The page folds the navigation on a phone-width window; this records that the fold was the page's, not the person's.
  function foldNavForWidth() {
    if (elements.navRail.classList.contains("w-0")) return;
    toggleNav(); navFoldedForWidth = true;
  }

  function setInspectorOpen(open) {
    const wasOpen = !elements.inspectorRail.classList.contains('w-0');
    const collapsed = !open || !hasInspectorSelection;
    if (!collapsed && !wasOpen) {
      inspectorReturnFocus = document.activeElement;
      document.dispatchEvent(new CustomEvent('aih:inspector-open'));
    }
    if (collapsed && elements.inspectorRail.contains(document.activeElement)) {
      (hasInspectorSelection ? elements.toggleInspectorBtn : elements.toggleNavBtn).focus();
    }
    elements.inspectorRail.classList.toggle("w-0", collapsed);
    elements.inspectorRail.classList.toggle("w-[var(--inspector-width)]", !collapsed);
    elements.inspectorRail.classList.toggle("border-l-0", collapsed);
    const visible = !collapsed && currentView === "catalog";
    elements.inspectorRail.inert = !visible;
    elements.inspectorRail.setAttribute("aria-hidden", String(!visible));
    elements.toggleInspectorBtn.setAttribute("aria-expanded", String(visible));
    elements.toggleInspectorBtn.classList.toggle("text-primary", !collapsed);
    elements.toggleInspectorBtn.classList.toggle("text-on-surface-variant", collapsed);
    syncOverlay(visible);
    if (visible && !wasOpen && overlayMedia.matches) elements.closeInspectorBtn.focus();
    if (!visible && wasOpen && inspectorReturnFocus?.isConnected) inspectorReturnFocus.focus();
    notifySecurity();
  }

  function toggleInspector() {
    if (!hasInspectorSelection || currentView !== "catalog") return;
    if (window.innerWidth <= 760 && elements.inspectorRail.classList.contains("w-0")) foldNavForWidth();
    setInspectorOpen(elements.inspectorRail.classList.contains("w-0"));
  }

  function activeNavigation(node, active) {
    node.classList.toggle("bg-surface-container", active);
    node.classList.toggle("text-primary", active);
    node.classList.toggle("font-medium", active);
    node.classList.toggle("text-on-surface-variant", !active);
    node.classList.toggle("hover:bg-surface-container", !active);
    node.classList.toggle("hover:text-on-surface", !active);
    if (active) node.setAttribute("aria-current", "page");
    else node.removeAttribute("aria-current");
  }

  function setView(view, updateHash = true) {
    if (updateHash && location.hash !== `#${view}`) location.hash = view;
    const policy = view === "policy" || view === "review";
    currentView = policy ? view : "catalog";
    elements.catalogWorkspace.hidden = policy;
    elements.policyWorkspace.hidden = !policy;
    elements.frameworkMatrixTabs.hidden = policy;
    elements.catalogKindsDisclosure.hidden = policy;
    elements.catalogScopesSection.hidden = policy;
    elements.inspectorRail.hidden = policy;
    elements.toggleInspectorBtn.hidden = policy;
    activeNavigation(elements.navSources, !policy);
    activeNavigation(elements.navPolicy, view === "policy");
    activeNavigation(elements.navScanReview, view === "review");
    if (policy) {
      syncOverlay(false);
      elements.inspectorRail.inert = true;
      elements.inspectorRail.setAttribute("aria-hidden", "true");
      elements.toggleInspectorBtn.setAttribute("aria-expanded", "false");
    } else {
      setInspectorOpen(!elements.inspectorRail.classList.contains("w-0") && window.innerWidth > 1100);
    }
    if (window.innerWidth <= 760) foldNavForWidth();
    notifySecurity();
    if (policy) elements.policyWorkspaceTitle.focus();
    else elements.catalogWorkspace.querySelector("h1")?.focus();
    document.dispatchEvent(new CustomEvent('aih:view-changed', { detail: { view: currentView } }));
  }

  for (const slot of document.querySelectorAll('[data-gap-reason]')) {
    slot.replaceChildren(createGapIndicator({ label: slot.dataset.gapLabel ?? 'Not ready', reason: slot.dataset.gapReason }));
  }
  for (const glyph of document.querySelectorAll('.material-symbols-outlined')) glyph.setAttribute('aria-hidden', 'true');
  setInspectorOpen(false);

  elements.toggleNavBtn.addEventListener("click", toggleNav);
  elements.toggleInspectorBtn.addEventListener("click", toggleInspector);
  elements.closeInspectorBtn.addEventListener("click", toggleInspector);
  elements.navSources.addEventListener("click", event => { event.preventDefault(); setView("catalog"); });
  elements.navPolicy.addEventListener("click", () => setView("policy"));
  elements.navScanReview.addEventListener("click", () => setView("review"));
  document.addEventListener('aih:policy-review-open', () => setInspectorOpen(false));
  // A view this page already switched to (a click updates the address too) is not switched again.
  window.addEventListener('hashchange', () => {
    const view = ['policy', 'review'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'catalog';
    if (view !== currentView) setView(view, false);
  });
  if (location.hash) setView(['policy', 'review'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'catalog', false);
  document.addEventListener('keydown', event => {
    if (elements.inspectorRail.classList.contains('w-0') || currentView !== 'catalog' || document.querySelector('dialog[open]')) return;
    if (event.key === 'Escape') { event.preventDefault(); setInspectorOpen(false); return; }
    if (event.key !== 'Tab' || !overlayMedia.matches) return;
    const stops = [...elements.inspectorRail.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]')].filter(node => node.getClientRects().length);
    const first = stops[0], last = stops.at(-1);
    if (event.shiftKey && (document.activeElement === first || !elements.inspectorRail.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !elements.inspectorRail.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
  });
  const narrowInspector = window.matchMedia("(max-width: 1100px)");
  const narrowNav = window.matchMedia("(max-width: 760px)");
  function fitRails() {
    elements.catalogKindsDisclosure.open = !narrowNav.matches;
    contextDisclosure.open = !narrowNav.matches;
    if (narrowInspector.matches && !elements.inspectorRail.classList.contains("w-0")) toggleInspector();
    if (narrowNav.matches) foldNavForWidth();
    else if (navFoldedForWidth && elements.navRail.classList.contains("w-0")) toggleNav();
  }
  narrowInspector.addEventListener("change", fitRails);
  narrowNav.addEventListener("change", fitRails);
  fitRails();
  for (const button of elements.tabButtons) {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
    // Left and Right move to the neighbouring tab and show it; Home and End
    // jump to the first and last. Escape is not handled here: it belongs to
    // whichever layer is open, and with none open it does nothing.
    button.addEventListener("keydown", (event) => {
      const step = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity }[event.key];
      if (step === undefined) return;
      event.preventDefault();
      const tabs = elements.tabButtons;
      const here = tabs.indexOf(button);
      const there = step === -Infinity ? 0 : step === Infinity ? tabs.length - 1 : (here + step + tabs.length) % tabs.length;
      switchTab(tabs[there].dataset.tab);
      tabs[there].focus();
    });
  }
  // The rail's links to screens with no contract yet are marked unavailable. An
  // unavailable link is followed nowhere and is not a tab stop; the Sources link
  // is this very page and is not followed either.
  for (const link of elements.navRail.querySelectorAll('a[href="#"]')) {
    link.addEventListener("click", (event) => event.preventDefault());
    if (link.getAttribute("aria-disabled") === "true") link.tabIndex = -1;
  }

  syncNavToggle();

  return {
    /** Shows Sources & Catalogs if another view is showing; on the catalog already, nothing moves. */
    showCatalog() { if (currentView !== "catalog") setView("catalog"); },
    subscribeSecurity(listener) { securityListeners.add(listener); listener(securityVisible()); return () => securityListeners.delete(listener); },
    /** Selection availability comes from Catalog; an empty rail cannot open. */
    setInspectorSelection(selected) {
      hasInspectorSelection = selected;
      if (!selected) setInspectorOpen(false);
      elements.toggleInspectorBtn.disabled = !selected;
      elements.toggleInspectorBtn.title = selected ? "Show or hide entry inspector" : "Select a card to open the inspector";
      elements.toggleInspectorBtn.setAttribute("aria-disabled", String(!selected));
      if (selected && currentView === "catalog" && elements.inspectorRail.classList.contains("w-0")) toggleInspector();
    },
    /** Called when a selection needs the inspector visible. Already-open stays open. */
    openInspector() {
      if (currentView === "catalog" && elements.inspectorRail.classList.contains("w-0")) toggleInspector();
    },
    showError(message) {
      elements.catalogError.textContent = message;
      elements.catalogError.classList.remove("hidden");
      console.error(`workbench: ${message}`);
    },
  };
}
