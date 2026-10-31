import { el } from "./dom.js";
import { experienceLabel } from "./setup-model.js";
import { toolNames } from "./tool-list.js";

export const reviewerText = (settings) => settings.reviewer ? `${settings.reviewer.kind} ${settings.reviewer.id}` : "Not set — saved review judgments show as imported";

/** Read-only review, shared by the last wizard step and the header's setup view. */
export function setupSummary(settings, location, labels = {}) {
  const section = el("div", "space-y-4");
  const list = el("dl", "setup-summary");
  const row = (label, value) => {
    const group = el("div");
    group.append(el("dt", "text-outline", label), el("dd", "text-on-surface break-words", value));
    list.append(group);
    return group.lastChild;
  };
  row("Mode", experienceLabel(settings));
  if (settings.role === "admin" && settings.organization) {
    row("Organization", `${settings.organization.name} · ${settings.organization.shortId}`);
    row("Policy repository", settings.organization.policyRepo);
    row("Organization contacts", settings.organization.emails.join(", ") || "Not supplied");
  } else if (settings.role === "developer") {
    row("Organization policy", "Read by your configured execution host; prepare your project policy in the Workbench");
  }
  row("Your tools", toolNames(labels, settings.clients) || "None chosen");
  row("Reviewing as", reviewerText(settings)).dataset.setupReviewer = "";
  section.append(list);
  section.append(el("p", "setup-notice", "Local preferences. Saving them does not install tools, read your repository, share data or verify enterprise approval."));
  const file = el("label", "block space-y-2");
  const path = el("textarea", "setup-input setup-path");
  path.readOnly = true;
  path.rows = 2;
  path.value = location ?? "The server has not supplied the settings path.";
  path.addEventListener("focus", () => path.select());
  file.append(el("span", "block text-outline", "Local setup file"), path);
  const storage = el("details");
  storage.append(el("summary", "", "Where preferences are stored"), file);
  section.append(storage);
  return section;
}
