/*
 * The Policy Workbench page.
 *
 * This module composes the three parts and connects their callbacks. It holds
 * no state and renders nothing itself:
 *
 *   app/        the shell - rails, inspector tabs, the error banner, the theme
 *               settling, first-run setup and the header's Your tool control
 *   catalog/    Sources & Catalogs: it presents published catalog data only
 *
 * The features do not know about each other. The catalog reports a selection;
 * this file is what opens the inspector and hands the entry to authoring.
 */

import { createShell } from "./app/shell.js";
import { organizationElements, shellElements, yourToolElements } from "./app/elements.js";
import { createYourTool } from "./app/your-tool.js";
import { createOrganization } from "./app/organization.js";
import { createTheme } from "./app/theme.js";
import { authoringMode } from "./app/setup-model.js";
import { createOnboarding } from "./app/onboarding.js";
import { createPolicyWorkspace } from "./app/policy-workspace.js";
import { createAuthoringClient } from './app/authoring-client.js';
import { createAuthoringWorkspace } from './app/authoring-workspace.js';
import { createEvidenceReview } from './app/evidence-review.js';
import { createCatalog } from "./catalog/controller.js";
import { attachStaticTooltips } from "./app/tooltip.js";

async function main() {
  attachStaticTooltips(document);
  // Before anything renders: a theme change has to reach elements that are
  // already on screen, not only ones built after it.
  createTheme();
  const shell = createShell(shellElements());
  let catalog;
  try {
    const policyWorkspace = createPolicyWorkspace();
    const authoring = createAuthoringClient();
    // Back to catalog: the drawer closes, then Sources & Catalogs shows (if another view was open) with focus on
    // the card just chosen, or the search box.
    const authoringWorkspace = createAuthoringWorkspace(authoring, { onBackToCatalog: () => { shell.showCatalog(); catalog.focusCatalog(); } });
    const evidenceReview = createEvidenceReview(authoring, result => authoringWorkspace.present(result));

    // Core's tool list (Harness listTools, src/app/tool-list.js) is read once by
    // Your tools; setup's step and the settings summary show that SAME list, by
    // Core's labels. Core's policy targets arrive with the preview summary the
    // catalog loads, for the controls that write policy targets.
    const organization = createOrganization({ elements: organizationElements(), onEdit: section => onboarding.edit(section), onModeComplete: applySettings });
    // Your tools reads Core's tool list and inspection itself. Its choice is setup's tools (Settings, Edit your tools)
    // plus its own additions minus its own unticks; saving setup clears the unticks. It is always a multi-select.
    // The header's chosen tools feed both the catalog and the authoring context; they rebind no saved execution.
    // Its tool list is the one setup offers and the settings summary names, by Core's labels.
    const yourTool = createYourTool({ elements: yourToolElements(), onChange: tools => { catalog.setTool(tools); authoring.setTool(tools); },
      onList: list => { onboarding.setTools(list); organization.setTools(list); catalog.setToolList(list); authoringWorkspace.setToolList(list); } });

    function applySettings(settings, location) {
      yourTool.setSetupClients(settings.clients);
      organization.setSettings(settings, location);
      policyWorkspace.setSettings(settings);
      authoringWorkspace.setSettings(settings);
      void authoring.setMode(authoringMode(settings));
      void evidenceReview.setDefaultRecipient(settings.reviewer ?? null);
      catalog.setMode(settings);
      catalog.setOrganizationName(settings.role === "admin" ? settings.organization?.name ?? null : null);
    }
    const onboarding = createOnboarding({
      onCloseEdit: () => organization.open(),
      onComplete: applySettings,
      // Saving setup chooses every setup tool in the header again.
      onSaved: () => yourTool.setupSaved(),
    });

    catalog = createCatalog({
      authoring,
      subscribeSecurity: shell.subscribeSecurity,
      onAdd: item => authoringWorkspace.add(item),
      onRemove: item => authoringWorkspace.remove(item),
      // Project basics opens the one workspace view.
      onOpenWorkspace: () => authoringWorkspace.openWorkspace(),
      onSelectEntry: (entry) => {
        authoringWorkspace.select(entry);
        shell.setInspectorSelection(entry !== null);
      },
      // The same card again only brings the inspector back if it was
      // collapsed.
      onReselectEntry: () => shell.openInspector(),
      onSummary: (summary) => {
        const coreTargets = summary?.coreTargets ?? null;
        authoringWorkspace.setTargets(coreTargets);
      },
    });

    // Open setup immediately while the catalog and Core's published clients load.
    // Browser-local drafts never decide whether first-run setup is complete.
    await Promise.all([authoring.start(), onboarding.start(), catalog.start(), yourTool.start()]);
    catalog.setTool(yourTool.current());
    authoring.setTool(yourTool.current());
  } catch (error) {
    shell.showError(error?.message ?? String(error));
    catalog?.sourceUnavailable(error?.message ?? String(error));
    const families = document.getElementById('framework-navigation');
    if (families && !families.querySelector('button')) families.textContent = 'Content families unavailable. See the source error.';
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
