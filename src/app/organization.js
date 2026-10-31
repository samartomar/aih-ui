/* The header Settings menu, the saved setup review and the separate mode setup popup. */
import { setupSummary } from "./setup-summary.js";
import { experienceLabel } from "./setup-model.js";
import { createModePicker } from "./workbench-mode.js";
import { el } from "./dom.js";
import { toolLabels } from "./tool-list.js";

export function createOrganization({ elements, onEdit, onModeComplete }) {
  const modePicker = createModePicker({ onComplete: onModeComplete });
  const menu = document.getElementById("workspace-actions");
  function setMenu(open) {
    menu.hidden = !open;
    elements.orgModalTrigger.setAttribute("aria-expanded", String(open));
    if (open) menu.querySelector("button, a[href]")?.focus();
  }
  // Settings: the workspace actions, then the menu's own items in the page (Change mode…, Check this machine,
  // Get started). Any item closes the menu.
  const firstItem = menu.querySelector("button, a");
  const action = (caption, callback) => {
    const button = el("button", "workspace-action", caption);
    button.type = "button";
    button.addEventListener("click", callback);
    menu.insertBefore(button, firstItem);
  };
  action("Workspace settings", () => open());
  action("Browse catalog", () => document.getElementById("nav-sources").click());
  const items = () => [...menu.querySelectorAll("button, a[href]")];
  menu.addEventListener("click", event => { if (items().some(item => item.contains(event.target))) setMenu(false); });
  document.addEventListener("click", event => { if (!menu.hidden && !menu.contains(event.target) && !elements.orgModalTrigger.contains(event.target)) setMenu(false); });
  document.addEventListener("keydown", event => {
    if (menu.hidden) return;
    if (event.key === "Escape") { event.preventDefault(); setMenu(false); elements.orgModalTrigger.focus(); }

    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = items(), index = buttons.indexOf(document.activeElement);
    buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  });
  menu.addEventListener("focusout", event => { if (event.relatedTarget && !menu.contains(event.relatedTarget) && !elements.orgModalTrigger.contains(event.relatedTarget)) setMenu(false); });
  let saved = null;
  let location = null;
  let labels = {};
  function render() {
    if (!saved) return;
    const summary = setupSummary(saved, location, labels);
    const actions = el("div", "flex flex-wrap gap-2");
    for (const [section, caption] of [["organization", "Edit organization"], ["clients", "Edit your tools"], ["review", "Edit reviewer"]]) {
      if (section === "organization" && saved.role !== "admin") continue;
      const button = el("button", "wb-btn", caption);
      button.type = "button";
      button.addEventListener("click", () => { elements.orgModalOverlay.close(); void onEdit(section); });
      actions.append(button);
    }
    elements.orgSetupSummary.replaceChildren(summary, actions);
  }
  const open = () => {
    if (saved) {
      elements.orgModalOverlay.showModal();
      elements.updateOrgSetupBtn.focus();
    }
  };
  elements.orgModalTrigger.addEventListener("click", () => setMenu(menu.hidden));
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
      elements.workbenchRole.textContent = settings.role ?? "personal";
      modePicker.setSettings(settings);
      elements.orgModalTitle.textContent = experienceLabel(settings) + " · local setup";
      render();
    },
    /** Core's tool list (src/app/tool-list.js), for the names of setup's tools. */
    setTools(list) { labels = toolLabels(list); render(); },
    current: () => saved,
  };
}
