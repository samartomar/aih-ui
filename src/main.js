/*
 * The Policy Workbench page.
 *
 * This module composes the three parts and connects their callbacks. It holds
 * no state and renders nothing itself:
 *
 *   app/        the shell - rails, inspector tabs, the error banner, the theme
 *               settling, first-run setup and the AI tools control
 *   catalog/    Sources & Catalogs: it presents published catalog data only
 *
 * The features do not know about each other. The catalog reports a selection;
 * this file is what opens the inspector and hands the entry to authoring.
 */

import { createShell } from "./app/shell.js";
import { aiToolsElements, organizationElements, shellElements } from "./app/elements.js";
import { createAiTools } from "./app/ai-tools.js";
import { createOrganization } from "./app/organization.js";
import { createTheme } from "./app/theme.js";
import { createOnboarding } from "./app/onboarding.js";
import { createPolicyWorkspace } from "./app/policy-workspace.js";
import { createAuthoringClient } from './app/authoring-client.js';
import { createAuthoringWorkspace } from './app/authoring-workspace.js';
import { createEvidenceReview } from './app/evidence-review.js';
import { saveClients } from "./app/settings-client.js";
import { createCatalog } from "./catalog/controller.js";

async function main() {
  // Before anything renders: a theme change has to reach elements that are
  // already on screen, not only ones built after it.
  createTheme();
  const shell = createShell(shellElements());
  try {
    const policyWorkspace = createPolicyWorkspace();
    const authoring = createAuthoringClient();
    const authoringWorkspace = createAuthoringWorkspace(authoring);
    const evidenceReview = createEvidenceReview(authoring, result => authoringWorkspace.present(result));

    // Core's supported targets arrive with the preview summary the catalog
    // loads. Every control that offers a client reads that SAME list and keeps
    // no copy of its own.
    const organization = createOrganization({ elements: organizationElements(), onEdit: () => onboarding.edit() });
    const aiTools = createAiTools({
      elements: aiToolsElements(),
      onSelectionChange: async (clients) => {
        const result = await saveClients(clients);
        organization.setSettings(result.settings, result.location);
      },
    });

    const onboarding = createOnboarding({
      onCloseEdit: () => organization.open(),
      onComplete: (settings, location) => {
        organization.setSettings(settings, location);
        policyWorkspace.setSettings(settings);
        void evidenceReview.setDefaultRecipient(settings.reviewer ?? null);
        aiTools.setSelection(settings.clients);
        catalog.setOrganizationName(settings.role === "admin" ? settings.organization?.name ?? null : null);
      },
    });

    const catalog = createCatalog({
      authoring,
      onProposal: result => {
        authoringWorkspace.present(result);
        document.getElementById('nav-policy').click();
      },
      onSelectEntry: (entry) => {
        authoringWorkspace.select(entry);
        shell.setInspectorSelection(entry !== null);
      },
      // The same card again only brings the inspector back if it was
      // collapsed.
      onReselectEntry: () => shell.openInspector(),
      onSummary: (summary) => {
        const coreTargets = summary?.coreTargets ?? null;
        aiTools.setTargets(coreTargets);
        onboarding.setTargets(coreTargets);
        authoringWorkspace.setTargets(coreTargets);
      },
    });

    // Open setup immediately while the catalog and Core's published clients load.
    // Browser-local drafts never decide whether first-run setup is complete.
    await authoring.start();
    await Promise.all([onboarding.start(), catalog.start()]);
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
