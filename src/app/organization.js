/* Saved setup review links to editing; experience changes require a file reset. */
import { setupSummary } from "./setup-summary.js";
import { experienceLabel } from "./setup-model.js";

export function createOrganization({ elements, onEdit }) {
  let saved = null;
  let location = null;
  const open = () => {
    if (saved) {
      elements.orgModalOverlay.showModal();
      elements.updateOrgSetupBtn.focus();
    }
  };
  elements.orgModalTrigger.addEventListener("click", open);
  elements.closeOrgModalBtn.addEventListener("click", () => elements.orgModalOverlay.close());
  elements.updateOrgSetupBtn.addEventListener("click", () => {
    elements.orgModalOverlay.close();
    void onEdit();
  });
  return {
    open,
    setSettings(settings, settingsLocation = location) {
      saved = settings;
      location = settingsLocation;
      elements.orgTriggerLabel.textContent = settings.role === "developer" ? "Developer workspace" : settings.organization?.name ?? "Personal workspace";
      elements.orgModalTrigger.title = "View saved local setup";
      elements.workbenchRole.textContent = settings.role ?? "personal";
      elements.workbenchExperience.textContent = settings.experience === "enterprise" ? "Enterprise" : "Vibe coder";
      elements.orgModalTitle.textContent = experienceLabel(settings) + " · local setup";
      elements.orgSetupSummary.replaceChildren(setupSummary(settings, location));
    },
    current: () => saved,
  };
}
