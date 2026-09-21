/*
 * The Policy Workbench page.
 *
 * This module composes the three parts and connects their callbacks. It holds
 * no state and renders nothing itself:
 *
 *   app/        the shell - rails, inspector tabs, the error banner
 *   catalog/    Sources & Catalogs: it presents published catalog data only
 *   governance/ the Governance pane: one vertical slice through @aihq/core
 *
 * The features do not know about each other. The catalog reports a selection;
 * this file is what opens the inspector and hands the entry to Governance.
 */

import { createShell } from "./app/shell.js";
import { shellElements } from "./app/elements.js";
import { createCatalog } from "./catalog/controller.js";
import { createGovernance } from "./governance/controller.js";

async function main() {
  const shell = createShell(shellElements());
  try {
    const governance = createGovernance();
    governance.mount();

    const catalog = createCatalog({
      onSelectEntry: (entry) => {
        shell.openInspector();
        void governance.select(entry);
      },
    });
    await catalog.start();
  } catch (error) {
    shell.showError(error?.message ?? String(error));
  }
}

main().catch((error) => {
  // The shell may not exist yet if the page itself is missing an element.
  console.error(error?.stack ?? String(error));
  const banner = document.getElementById("catalog-error");
  if (banner) {
    banner.textContent = error?.message ?? String(error);
    banner.classList.remove("hidden");
  }
});
