/* Mode changes are local setup preferences, never enterprise authorization. */
import { collectIds, el } from "./dom.js";
import { experienceLabel, organizationErrors } from "./setup-model.js";
import { loadSetup, switchMode } from "./settings-client.js";

const MODES = [
  { experience: "vibe", role: null },
  { experience: "enterprise", role: "admin" },
  { experience: "enterprise", role: "developer" },
];
const emptyOrganization = () => ({ name: "", shortId: "", policyRepo: "", emails: [] });
const ADMIN_PROFILE = "aih-workbench-admin-profile-v1";
function rememberedOrganization() {
  try {
    const value = JSON.parse(localStorage.getItem(ADMIN_PROFILE));
    return Object.keys(organizationErrors(value, "admin")).length ? emptyOrganization() : value;
  } catch { return emptyOrganization(); }
}
function rememberOrganization(value) {
  if (Object.keys(organizationErrors(value, "admin")).length) return;
  try { localStorage.setItem(ADMIN_PROFILE, JSON.stringify(value)); } catch { /* Local storage may be unavailable. */ }
}

export function createModePicker({ onComplete }) {
  const e = collectIds(["workbench-mode-trigger", "workbench-experience", "workbench-mode-dialog",
    "workbench-mode-form", "workbench-mode-fields", "workbench-mode-options", "workbench-mode-details",
    "workbench-mode-error", "workbench-mode-save", "workbench-mode-cancel"]);
  let selected = null, active = null, organization = emptyOrganization(), saving = false, sequence = 0;
  const fields = new Map();
  function error(message) {
    e.workbenchModeError.textContent = message ?? "";
    e.workbenchModeError.hidden = !message;
  }
  function details() {
    fields.clear();
    const panel = e.workbenchModeDetails;
    panel.replaceChildren();
    if (selected.role !== "admin") {
      panel.append(el("p", "setup-notice", selected.experience === "vibe"
        ? "Personal workspace. No organization details are required."
        : "Prepare a project policy. Your configured execution host reads your administrator's organization policy; this mode does not grant organization access."));
      if (active.role === "admin") panel.append(el("p", "text-outline", "Your Admin details are remembered in this browser for your next switch. They are inactive in this mode."));
      return;
    }
    panel.append(el("p", "setup-notice", "Complete your organization's details. Choosing Admin does not grant permissions or activate organization policy."));
    for (const [key, caption, maxLength] of [["name", "Organization name", 120], ["shortId", "Organization short ID", 40],
      ["policyRepo", "Policy repository", 200], ["emails", "Organization contact emails", 5100]]) {
      const wrapper = el("div", "space-y-1.5");
      const label = el("label", "block font-medium", caption);
      const input = el(key === "emails" ? "textarea" : "input", "setup-input");
      input.id = `mode-field-${key}`;
      label.htmlFor = input.id;
      input.required = true;
      input.maxLength = maxLength;
      input.value = key === "emails" ? organization.emails.join("\n") : organization[key];
      if (key === "emails") input.rows = 2;
      else input.type = "text";
      if (key === "shortId") input.placeholder = "your-org";
      if (key === "policyRepo") input.placeholder = "github.com/your-org/ai-policies";
      if (key === "emails") input.placeholder = "Separate email addresses with commas or new lines";
      const hint = el("p", "text-outline", {
        name: "Shown in your workspace header.",
        shortId: "Local organization label: lowercase letters, digits and single hyphens.",
        policyRepo: "Use host/owner/repository or an HTTPS URL. Saved as a reference; no repository is connected.",
        emails: "At least one contact, up to 20 distinct addresses. Stored locally; no invitations are sent.",
      }[key]);
      hint.id = `${input.id}-hint`;
      input.setAttribute("aria-describedby", hint.id);
      input.addEventListener("input", () => {
        organization[key] = key === "emails" ? input.value.split(/[,;\n]+/).map(v => v.trim()).filter(Boolean) : input.value.trim();
        input.removeAttribute("aria-invalid");
        message.textContent = ""; message.hidden = true;
        error(null);
      });
      fields.set(key, input);
      const message = el("p", "text-error setup-field-error");
      message.id = `${input.id}-error`; message.hidden = true;
      input.setAttribute("aria-describedby", `${hint.id} ${message.id}`);
      wrapper.append(label, input, hint, message);
      panel.append(wrapper);
    }
  }
  function choices() {
    e.workbenchModeOptions.replaceChildren(...MODES.map(mode => {
      const label = el("label", "setup-choice");
      const input = el("input");
      input.type = "radio";
      input.name = "workbench-mode";
      input.value = mode.role ?? "vibe";
      input.checked = mode.experience === selected.experience && mode.role === selected.role;
      input.addEventListener("change", () => { selected = mode; error(null); details(); });
      label.append(input, el("span", "", experienceLabel(mode)));
      if (mode.experience === active.experience && mode.role === active.role) label.append(el("span", "ml-auto text-outline", "Current"));
      return label;
    }));
  }
  async function open() {
    const request = ++sequence;
    selected = null;
    error(null);
    e.workbenchModeFields.disabled = true;
    e.workbenchModeSave.disabled = true;
    e.workbenchModeSave.textContent = "Loading…";
    e.workbenchModeOptions.replaceChildren();
    e.workbenchModeDetails.replaceChildren(el("p", "text-outline", "Loading your saved mode…"));
    if (!e.workbenchModeDialog.open) e.workbenchModeDialog.showModal();
    try {
      const result = await loadSetup();
      if (request !== sequence) return;
      if (result.state !== "saved") throw new Error("Complete local setup before switching modes.");
      active = { experience: result.settings.experience, role: result.settings.role };
      selected = active;
      organization = structuredClone(result.settings.organization ?? rememberedOrganization());
      rememberOrganization(organization);
      choices(); details();
      e.workbenchModeFields.disabled = false;
      e.workbenchModeOptions.querySelector("input:checked")?.focus();
    } catch (failure) {
      if (request === sequence) error(failure.message);
    } finally {
      if (request === sequence) {
        e.workbenchModeSave.disabled = false;
        e.workbenchModeSave.textContent = selected ? "Save mode" : "Retry";
      }
    }
  }
  function close() {
    if (saving) return;
    sequence += 1;
    e.workbenchModeDialog.close();
    e.workbenchModeTrigger.focus();
  }
  e.workbenchModeTrigger.addEventListener("click", () => { void open(); });
  e.workbenchModeCancel.addEventListener("click", close);
  e.workbenchModeDialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  e.workbenchModeForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (saving) return;
    if (!selected) { void open(); return; }
    const errors = selected.role === "admin" ? organizationErrors(organization, "admin") : {};
    if (Object.keys(errors).length) {
      error(Object.values(errors).join(" "));
      for (const key of Object.keys(errors)) {
        const input = fields.get(key); input?.setAttribute("aria-invalid", "true");
        const message = input && document.getElementById(`${input.id}-error`);
        if (message) { message.textContent = errors[key]; message.hidden = false; }
      }
      fields.get(Object.keys(errors)[0])?.focus();
      return;
    }
    saving = true;
    e.workbenchModeFields.disabled = true;
    e.workbenchModeSave.disabled = true;
    e.workbenchModeCancel.disabled = true;
    e.workbenchModeSave.textContent = "Saving…";
    error(null);
    try {
      const result = await switchMode({ ...selected, organization: selected.role === "admin" ? organization : null });
      rememberOrganization(organization);
      onComplete(result.settings, result.location);
      saving = false;
      close();
    } catch (failure) { error(failure.message); }
    finally {
      saving = false;
      e.workbenchModeFields.disabled = false;
      e.workbenchModeSave.disabled = false;
      e.workbenchModeCancel.disabled = false;
      e.workbenchModeSave.textContent = "Save mode";
    }
  });
  return { setSettings: settings => { e.workbenchExperience.textContent = experienceLabel(settings); } };
}
