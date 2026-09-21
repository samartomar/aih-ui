/*
 * The application shell: the collapsible rails, the inspector tabs and the
 * error banner.
 *
 * It owns those elements and their listeners and nothing else. It never reads a
 * catalog entry or a Core answer - a feature that needs the inspector open asks
 * for it through `openInspector()`.
 */

/**
 * @param elements  the shell's own nodes, from shellElements()
 * @returns { openInspector, showError }
 */
export function createShell(elements) {
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
      button.classList.toggle("bg-surface-container", active);
      button.classList.toggle("text-primary", active);
      button.classList.toggle("font-semibold", active);
      button.classList.toggle("shadow-xs", active);
      button.classList.toggle("text-on-surface-variant", !active);
    }
    for (const [name, pane] of Object.entries(panes)) pane.classList.toggle("hidden", name !== tab);
  }

  function toggleNav() {
    const collapsed = elements.navRail.classList.toggle("w-0");
    elements.navRail.classList.toggle("w-60", !collapsed);
    elements.navRail.classList.toggle("border-r-0", collapsed);
    elements.toggleNavBtn.classList.toggle("text-primary", !collapsed);
    elements.toggleNavBtn.classList.toggle("text-on-surface-variant", collapsed);
  }

  function toggleInspector() {
    const collapsed = elements.inspectorRail.classList.toggle("w-0");
    elements.inspectorRail.classList.toggle("w-[390px]", !collapsed);
    elements.inspectorRail.classList.toggle("border-l-0", collapsed);
    elements.toggleInspectorBtn.classList.toggle("text-primary", !collapsed);
    elements.toggleInspectorBtn.classList.toggle("text-on-surface-variant", collapsed);
  }

  elements.toggleNavBtn.addEventListener("click", toggleNav);
  elements.toggleInspectorBtn.addEventListener("click", toggleInspector);
  elements.closeInspectorBtn.addEventListener("click", toggleInspector);
  for (const button of elements.tabButtons) {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") switchTab("details");
  });

  return {
    /** Called when a selection needs the inspector visible. Already-open stays open. */
    openInspector() {
      if (elements.inspectorRail.classList.contains("w-0")) toggleInspector();
    },
    showError(message) {
      elements.catalogError.textContent = message;
      elements.catalogError.classList.remove("hidden");
      console.error(`workbench: ${message}`);
    },
  };
}
