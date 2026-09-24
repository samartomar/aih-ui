import { el } from "./dom.js";
import { CAPABILITIES, experienceLabel } from "./setup-model.js";

/** Read-only review, shared by the last wizard step and the header's setup view. */
export function setupSummary(settings, location) {
  const section = el("div", "space-y-4");
  const list = el("dl", "setup-summary");
  const row = (label, value) => {
    const group = el("div");
    group.append(el("dt", "text-outline", label), el("dd", "text-on-surface break-words", value));
    list.append(group);
  };
  row("Experience", experienceLabel(settings));
  if (settings.organization) {
    row("Organization", `${settings.organization.name} · ${settings.organization.shortId}`);
    row(settings.role === "developer" ? "Policy repository supplied by your admin" : "Policy repository", settings.organization.policyRepo);
    row("Organization contacts", settings.organization.emails.join(", ") || "Not supplied");
  }
  row("Optional AIH requests", CAPABILITIES.filter((item) => settings.capabilities.includes(item.id)).map((item) => item.title).join(", ") || "None selected");
  row("AI clients", settings.clients.join(", ") || "None selected");
  section.append(list);
  section.append(el("p", "setup-notice", "This saves local preferences only. It does not install or connect tools, read your code or policy repository, send data to integrations, or verify enterprise approval. Optional assistance is not connected in this version."));
  const file = el("label", "block space-y-2");
  const path = el("textarea", "setup-input setup-path");
  path.readOnly = true;
  path.rows = 2;
  path.value = location ?? "The server has not supplied the settings path.";
  path.addEventListener("focus", () => path.select());
  file.append(el("span", "block text-outline", "Local setup file"), path);
  section.append(file, el("p", "text-outline text-[11px] leading-relaxed", "To change Vibe / Enterprise or Admin / Developer, delete this settings file and restart the Workbench. Other information can be updated without resetting setup."));
  return section;
}
