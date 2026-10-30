import { el, collectIds } from "./dom.js";
import { clientNodes, publishedClients } from "./core-targets.js";
import { REVIEWER_KINDS, newSetupSettings, setupSteps, experienceLabel, organizationErrors, settingsErrors } from "./setup-model.js";
import { reviewerText, setupSummary } from "./setup-summary.js";
import { loadSetup, saveSetup, updateSetup } from "./settings-client.js";

const STEP_TITLES = { experience: "How will you use the Workbench?", role: "What is your enterprise role?", organization: "Your organization", clients: "Which AI clients do you use?", review: "Review your local setup" };
const STEP_LABELS = { experience: "Mode", role: "Role", organization: "Organization", clients: "AI clients", review: "Review" };

export function createOnboarding({ onComplete, onCloseEdit = () => {} }) {
  const elements = collectIds(["setup-dialog", "setup-title", "setup-description", "setup-fixed-experience", "setup-progress", "setup-content", "setup-error", "setup-back", "setup-next", "setup-skip", "setup-cancel", "setup-form"]);
  let draft = newSetupSettings();
  let editing = false;
  let editSection = null;
  let location = null;
  let step = 0;
  let targets = null;
  let labels = {};
  let targetReason = "The published client list is loading.";
  let savedProblem = null;
  let loading = true;
  let saving = false;
  let retryLoad = false;
  let loadSequence = 0;
  let reviewerKind = "individual";
  const fields = new Map();
  const steps = () => setupSteps({ draft, editing, editSection });
  const current = () => steps()[step];
  function error(message) {
    elements.setupError.textContent = message || "";
    elements.setupError.hidden = !message;
  }
  function radioCards(name, options, value, onChange) {
    const group = el("fieldset", "setup-options");
    const legend = el("legend", "sr-only", STEP_TITLES[current()]);
    group.append(legend);
    for (const option of options) {
      const label = el("label", "setup-choice");
      const radio = el("input");
      radio.type = "radio";
      radio.name = name;
      radio.value = option.value;
      radio.checked = value === option.value;
      radio.addEventListener("change", () => { onChange(option.value); error(null); renderProgress(); });
      const text = el("span", "space-y-1");
      text.append(el("strong", "block font-medium text-on-surface text-[14px]", option.title), el("span", "block text-on-surface-variant text-[12px] leading-relaxed", option.description));
      label.append(radio, text);
      group.append(label);
    }
    return group;
  }
  function field(key, label, hint, options = {}) {
    const wrapper = el("div", "space-y-1.5");
    const id = `setup-field-${key}`;
    const caption = el("label", "block text-on-surface font-medium", label);
    caption.htmlFor = id;
    const input = el(options.multiline ? "textarea" : "input", "setup-input");
    input.id = id;
    input.name = key;
    if (options.multiline) input.rows = 3;
    else input.type = "text";
    input.maxLength = options.maxLength ?? 200;
    input.autocomplete = options.autocomplete ?? "off";
    input.placeholder = options.placeholder ?? "";
    input.value = key === "emails" ? draft.organization.emails.join("\n") : draft.organization[key];
    input.setAttribute("aria-describedby", `${id}-hint`);
    input.addEventListener("input", () => {
      draft.organization[key] = key === "emails" ? input.value.split(/[,;\n]+/).map((value) => value.trim()).filter(Boolean) : input.value.trim();
      input.removeAttribute("aria-invalid");
      const message = document.getElementById(`${id}-error`);
      if (message) { message.textContent = ""; message.hidden = true; }
      error(null);
    });
    fields.set(key, input);
    const help = el("p", "text-outline text-[11px] leading-relaxed", hint);
    help.id = `${id}-hint`;
    const message = el("p", "text-error setup-field-error");
    message.id = `${id}-error`;
    message.hidden = true;
    input.setAttribute("aria-describedby", `${id}-hint ${id}-error`);
    wrapper.append(caption, input, help, message);
    return wrapper;
  }
  function renderOrganization() {
    elements.setupDescription.textContent = "Record your organization's details for this local Workbench. Choosing Admin does not grant permissions or create authoritative policy.";
    const group = el("div", "space-y-4");
    group.append(
      field("name", "Organization name", "Required to name this organization in your workspace header.", { maxLength: 120, autocomplete: "organization" }),
      field("shortId", "Organization short ID", "Required local organization label. Use lowercase letters, digits and single hyphens; for example your-org.", { maxLength: 40 }),
      field("policyRepo", "Policy repository", "Required reference for your organization policy: host/owner/repository or an HTTPS URL. No credentials or query parameters. This setup does not connect the repository.", { placeholder: "github.com/your-org/ai-policies" }),
      field("emails", "Organization contact emails", "At least one contact is required for Admin setup. Enter up to 20 distinct emails separated by commas or new lines; they are stored locally.", { multiline: true, maxLength: 5100 }),
    );
    elements.setupContent.append(group);
  }
  function renderClients() {
    elements.setupDescription.textContent = "Select the AI coding clients you use. The list comes from the installed Core package's public nativeClientIds; its order is not a ranking. Selecting one does not install it or verify a connection.";
    if (targets === null) {
      elements.setupContent.append(el("p", "setup-notice", `${targetReason} Existing selections stay saved. You can continue without adding clients.`));
      return;
    }
    const group = el("fieldset", "setup-clients");
    group.append(el("legend", "sr-only", "Supported AI clients"));
    for (const target of targets) {
      const label = el("label", "setup-choice");
      const box = el("input");
      box.type = "checkbox";
      box.checked = draft.clients.includes(target);
      box.addEventListener("change", () => { draft.clients = box.checked ? [...draft.clients, target] : draft.clients.filter((item) => item !== target); });
      label.append(box, ...clientNodes(labels, target));
      group.append(label);
    }
    elements.setupContent.append(group, el("p", "text-outline mt-4 text-[11px]", "Your explicit choices are saved in this workspace's local setup. You can change them later from Settings (Edit AI tools), or use Mode to change your experience. The header's Your tool is separate: it picks the one tool you work in."));
    const unlisted = draft.clients.filter((client) => !targets.includes(client));
    if (unlisted.length) elements.setupContent.append(el("p", "setup-notice mt-4", `Saved clients no longer listed by this Core stay selected: ${unlisted.join(", ")}.`));
  }
  function renderReviewer() {
    const wrapper = el("div", "space-y-1.5 mb-6");
    const kind = el("select", "setup-input");
    kind.id = "setup-field-reviewer-kind";
    kind.name = "reviewerKind";
    for (const value of REVIEWER_KINDS) kind.append(new Option(value, value));
    reviewerKind = draft.reviewer?.kind ?? reviewerKind;
    kind.value = reviewerKind;
    const caption = el("label", "block text-on-surface font-medium", "Reviewing as (optional)");
    caption.htmlFor = "setup-field-reviewer-id";
    const input = el("input", "setup-input");
    input.id = "setup-field-reviewer-id";
    input.name = "reviewerId";
    input.type = "text";
    input.maxLength = 254;
    input.autocomplete = "off";
    input.placeholder = "Your name or team";
    input.value = draft.reviewer?.id ?? "";
    input.setAttribute("aria-describedby", "setup-field-reviewer-hint");
    const kindLabel = el("label", "sr-only", "Reviewer kind");
    kindLabel.htmlFor = kind.id;
    // Empty identity means not set: the key is dropped, never saved empty.
    const sync = () => {
      reviewerKind = kind.value;
      const id = input.value.trim();
      if (id) draft.reviewer = { kind: reviewerKind, id }; else delete draft.reviewer;
      input.removeAttribute("aria-invalid");
      const shown = elements.setupContent.querySelector("[data-setup-reviewer]");
      if (shown) shown.textContent = reviewerText(draft);
      error(null);
    };
    kind.addEventListener("change", sync);
    input.addEventListener("input", sync);
    fields.set("reviewer", input);
    const help = el("p", "text-outline text-[11px] leading-relaxed", "Only labels saved review judgments as yours. It is kept in the local setup file, used only by this Workbench's local service on this computer, and is never written into a policy or draft you export or sent to another service. Leave empty to show every saved judgment as imported.");
    help.id = "setup-field-reviewer-hint";
    const row = el("div", "setup-reviewer");
    row.setAttribute("role", "group");
    caption.id = "setup-field-reviewer-caption";
    row.setAttribute("aria-labelledby", caption.id);
    row.append(kindLabel, kind, input);
    wrapper.append(caption, row, help);
    return wrapper;
  }
  function renderProgress() {
    elements.setupProgress.replaceChildren();
    steps().forEach((key, index) => {
      const item = el("li", index === step ? "text-primary font-medium" : "text-outline", `${index + 1}. ${STEP_LABELS[key]}`);
      if (index === step) item.setAttribute("aria-current", "step");
      elements.setupProgress.append(item);
    });
  }
  function render() {
    error(null);
    fields.clear();
    elements.setupContent.replaceChildren();
    elements.setupBack.disabled = step === 0 || saving || loading;
    elements.setupNext.disabled = saving || loading;
    elements.setupNext.textContent = saving ? "Saving…" : retryLoad ? "Retry loading setup" : current() === "review" ? (editing ? "Save changes" : "Save and enter Workbench") : "Continue";
    elements.setupCancel.hidden = !editing;
    elements.setupCancel.disabled = saving;
    elements.setupFixedExperience.hidden = !editing || loading || retryLoad;
    elements.setupFixedExperience.textContent = editing ? `${experienceLabel(draft)} · Change mode using the Mode control in the header.` : "";
    elements.setupSkip.hidden = loading || retryLoad || current() !== "clients";
    elements.setupSkip.disabled = saving;
    elements.setupSkip.textContent = editing ? "Keep current choices" : "Choose tools later";
    renderProgress();
    if (loading || retryLoad) {
      elements.setupTitle.textContent = editing ? "Loading your saved information" : "Opening your Workbench";
      elements.setupDescription.textContent = "Loading the saved setup for this workspace.";
      if (retryLoad) error("The local setup service could not be loaded. Retry when the preview server is available; existing settings have not been replaced.");
      return;
    }
    elements.setupTitle.textContent = STEP_TITLES[current()];
    elements.setupDescription.textContent = "";
    if (savedProblem) elements.setupContent.append(el("p", "setup-notice mb-4", `The existing setup file could not be used: ${savedProblem} Completing setup will replace it.`));
    if (current() === "experience") {
      elements.setupDescription.textContent = "Choose a starting experience. This setup is saved locally and reopened next time.";
      elements.setupContent.append(radioCards("experience", [
        { value: "vibe", title: "Vibe coder", description: "A personal starting point for exploring the catalog. No enterprise organization is required." },
        { value: "enterprise", title: "Enterprise", description: "Choose Admin or Developer. Admins maintain organization details; Developers prepare project policies for their configured organization host." },
      ], draft.experience, (value) => {
        draft.experience = value;
        draft.role = null;
        draft.organization = null;
      }));
    } else if (current() === "role") {
      elements.setupDescription.textContent = "Your choice determines the setup questions and the saved experience. A self-declared role is not verified enterprise access.";
      elements.setupContent.append(radioCards("role", [
        { value: "admin", title: "Admin", description: "Record organization details, its policy repository and contact people for this local setup." },
        { value: "developer", title: "Developer", description: "Prepare a project policy. Your configured execution host reads your administrator's organization policy." },
      ], draft.role, (value) => {
        draft.role = value;
        draft.organization = value === "admin" ? { name: "", shortId: "", policyRepo: "", emails: [] } : null;
      }));
    } else if (current() === "organization") renderOrganization();
    else if (current() === "clients") renderClients();
    else {
      elements.setupDescription.textContent = draft.experience === "vibe"
        ? "Your personal setup opens the catalog and project policy authoring. Vibe-specific automation is not available in this version. Your choices persist across restarts."
        : draft.role === "developer"
          ? "Your role and preferences persist. The organization policy your admin publishes is read by the configured execution host; it is not chosen or approved by this profile."
          : "Your organization details and preferences persist. Policy authority is follow-on work.";
      elements.setupContent.append(renderReviewer(), setupSummary(draft, location, labels));
    }
    elements.setupTitle.focus();
    elements.setupContent.scrollTop = 0;
  }
  async function advance() {
    if (loading || saving) return;
    if (retryLoad) return start(editing, editSection);
    let errors = {};
    if (current() === "experience" && !draft.experience) errors.experience = "Choose Vibe coder or Enterprise to continue.";
    if (current() === "role" && !draft.role) errors.role = "Choose Admin or Developer to continue.";
    if (current() === "organization") errors = organizationErrors(draft.organization, draft.role);
    if (current() === "review") errors = settingsErrors(draft);
    if (Object.keys(errors).length) {
      error(Object.values(errors).join(" "));
      for (const key of Object.keys(errors)) {
        const input = fields.get(key);
        input?.setAttribute("aria-invalid", "true");
        const message = input && document.getElementById(`${input.id}-error`);
        if (message) { message.textContent = errors[key]; message.hidden = false; }
      }
      fields.get(Object.keys(errors)[0])?.focus();
      return;
    }
    if (current() !== "review") { step += 1; render(); return; }
    saving = true;
    render();
    try {
      const saved = await (editing ? updateSetup(draft) : saveSetup(draft));
      onComplete(saved.settings, saved.location);
      elements.setupDialog.close();
      if (editing) { editing = false; onCloseEdit(); }
    } catch (failure) {
      error(failure.message);
    } finally {
      saving = false;
      elements.setupNext.disabled = false;
      elements.setupNext.textContent = editing ? "Save changes" : "Save and enter Workbench";
      elements.setupBack.disabled = step === 0;
      elements.setupCancel.disabled = false;
    }
  }
  async function start(editMode = false, section = null) {
    const sequence = ++loadSequence;
    editing = editMode;
    editSection = editMode && ["organization", "clients", "review"].includes(section) ? section : null;
    loading = true;
    retryLoad = false;
    savedProblem = null;
    reviewerKind = "individual";
    step = 0;
    if (!elements.setupDialog.open) elements.setupDialog.showModal();
    render();
    try {
      const result = await loadSetup();
      if (sequence !== loadSequence) return;
      location = result.location ?? null;
      if (result.state === "saved") {
        if (editing) {
          // Retired assistance in an older file is dropped when the edit saves.
          draft = { ...structuredClone(result.settings), capabilities: [] };
          if (draft.experience === "enterprise" && draft.role === "developer") draft.organization = null;
        }
        else {
          onComplete(result.settings, location);
          elements.setupDialog.close();
        }
        return;
      }
      if (editing) throw new Error("Saved setup is unavailable.");
      draft = newSetupSettings();
      savedProblem = result.problem ?? null;
      step = 0;
    } catch {
      if (sequence === loadSequence) retryLoad = true;
    } finally {
      if (sequence === loadSequence) {
        loading = false;
        if (elements.setupDialog.open) render();
      }
    }
  }
  function cancelEdit() {
    if (!editing || saving) return;
    loadSequence += 1;
    loading = false;
    retryLoad = false;
    elements.setupDialog.close();
    editing = false;
    onCloseEdit();
  }
  elements.setupDialog.addEventListener("cancel", (event) => { event.preventDefault(); cancelEdit(); });
  elements.setupCancel.addEventListener("click", cancelEdit);
  elements.setupForm.addEventListener("submit", (event) => { event.preventDefault(); void advance(); });
  elements.setupBack.addEventListener("click", () => { if (step > 0 && !saving) { step -= 1; render(); } });
  elements.setupSkip.addEventListener("click", () => {
    if (saving || loading) return;
    step += 1;
    render();
  });
  return {
    start,
    edit: section => start(true, section),
    setTargets(coreTargets) {
      const published = publishedClients(coreTargets);
      targets = published ? published.ids : null;
      labels = published ? published.labels : {};
      targetReason = coreTargets?.reason ?? "The installed Core does not publish supported AI clients.";
      if (elements.setupDialog.open && !loading && current() === "clients") render();
    },
  };
}
