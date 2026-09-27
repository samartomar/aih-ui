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
  const panes = {
    details: elements.paneDetails,
    security: elements.paneSecurity,
    governance: elements.paneGovernance,
    json: elements.paneJson,
  };

  function switchTab(tab) {
    for (const button of elements.tabButtons) {
      const active = button.dataset.tab === tab;
      button.setAttribute("aria-selected", String(active));
      // One tab stop for the whole list; the arrow keys move between tabs.
      button.tabIndex = active ? 0 : -1;
      button.classList.toggle("text-primary", active);
      button.classList.toggle("text-on-surface-variant", !active);
    }
    for (const [name, pane] of Object.entries(panes)) pane.classList.toggle("hidden", name !== tab);
  }

  function toggleNav() {
    if (currentView === "catalog" && window.innerWidth <= 760 && elements.navRail.classList.contains("w-0") && !elements.inspectorRail.classList.contains("w-0")) {
      toggleInspector();
    }
    const collapsed = elements.navRail.classList.toggle("w-0");
    elements.navRail.classList.toggle("w-60", !collapsed);
    elements.navRail.classList.toggle("border-r-0", collapsed);
    elements.toggleNavBtn.classList.toggle("text-primary", !collapsed);
    elements.toggleNavBtn.classList.toggle("text-on-surface-variant", collapsed);
  }

  function setInspectorOpen(open) {
    const collapsed = !open || !hasInspectorSelection;
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
  }

  function toggleInspector() {
    if (!hasInspectorSelection || currentView !== "catalog") return;
    if (window.innerWidth <= 760 && elements.inspectorRail.classList.contains("w-0") && !elements.navRail.classList.contains("w-0")) {
      toggleNav();
    }
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

  function setView(view) {
    const policy = view === "policy";
    currentView = policy ? "policy" : "catalog";
    elements.catalogWorkspace.hidden = policy;
    elements.policyWorkspace.hidden = !policy;
    elements.frameworkMatrixTabs.hidden = policy;
    elements.catalogScopesSection.hidden = policy;
    elements.inspectorRail.hidden = policy;
    elements.toggleInspectorBtn.hidden = policy;
    activeNavigation(elements.navSources, !policy);
    activeNavigation(elements.navPolicy, policy);
    if (policy) {
      elements.inspectorRail.inert = true;
      elements.inspectorRail.setAttribute("aria-hidden", "true");
      elements.toggleInspectorBtn.setAttribute("aria-expanded", "false");
    } else {
      setInspectorOpen(!elements.inspectorRail.classList.contains("w-0") && window.innerWidth > 1100);
    }
    if (window.innerWidth <= 760 && !elements.navRail.classList.contains("w-0")) toggleNav();
    if (policy) elements.policyWorkspaceTitle.focus();
    else elements.catalogWorkspace.querySelector("h1")?.focus();
  }

  setInspectorOpen(false);

  elements.toggleNavBtn.addEventListener("click", toggleNav);
  elements.toggleInspectorBtn.addEventListener("click", toggleInspector);
  elements.closeInspectorBtn.addEventListener("click", toggleInspector);
  elements.navSources.addEventListener("click", () => setView("catalog"));
  elements.navPolicy.addEventListener("click", () => setView("policy"));
  const narrowInspector = window.matchMedia("(max-width: 1100px)");
  const narrowNav = window.matchMedia("(max-width: 760px)");
  function fitRails() {
    if (narrowInspector.matches && !elements.inspectorRail.classList.contains("w-0")) toggleInspector();
    if (narrowNav.matches && !elements.navRail.classList.contains("w-0")) toggleNav();
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

  return {
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
