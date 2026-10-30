/* UI preferences only. These values never grant policy authority or run tools. */
export const SETTINGS_FORMAT = "aih-ui-settings";
export const SETTINGS_VERSION = 1;
export const SETTINGS_LOCATION = ".aih-ui/settings.v1.json";

/* Assistance a setup could once request. Catalog publishes no installable item for any of them, so no choice could reach
 * Your setup and setup no longer offers them. Saved setups that name them stay readable; nothing acts on them. */
const RETIRED_ASSISTANCE = ["code-review", "codebase-memory", "workspace-help", "headroom", "serena", "context-optimization"];

export function experienceLabel(settings) {
  if (settings.experience === "vibe") return "Vibe coder";
  return settings.role === "admin" ? "Enterprise Admin" : "Enterprise Developer";
}

export function emptySettings() {
  return { format: SETTINGS_FORMAT, version: SETTINGS_VERSION, experience: null, role: null, organization: null, capabilities: [], clients: [] };
}

/** UI defaults apply only to a new draft, never to saved settings. */
export function newSetupSettings() {
  return emptySettings();
}

/** Setup steps in order; a section edit shows that section and review. */
export function setupSteps({ draft, editing = false, editSection = null }) {
  if (editSection) return [...(editSection === "review" ? [] : [editSection]), "review"];
  return [
    ...(!editing ? ["experience", ...(draft.experience === "enterprise" ? ["role"] : [])] : []),
    ...(draft.experience === "enterprise" && draft.role === "admin" ? ["organization"] : []),
    "clients", "review",
  ];
}

const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const boundedText = (value, max) => typeof value === "string" && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const listOfStrings = (value, max) => Array.isArray(value) && value.length <= max && value.every((item) => boundedText(item, 254) && item.trim().length > 0) && new Set(value).size === value.length;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REPOSITORY = /^(?:https:\/\/)?[a-z0-9.-]+\.[a-z]{2,}\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/i;

export function organizationErrors(organization, role) {
  const errors = {};
  if (!exactKeys(organization, ["name", "shortId", "policyRepo", "emails"])) return { organization: "Supply organization name, short ID, policy repository and contact emails." };
  if (!boundedText(organization.name, 120) || !organization.name.trim()) errors.name = "Enter an organization name (up to 120 characters).";
  if (!boundedText(organization.shortId, 40) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(organization.shortId)) errors.shortId = "Use a short ID with lowercase letters, digits and single hyphens (up to 40 characters).";
  if (!boundedText(organization.policyRepo, 200) || !REPOSITORY.test(organization.policyRepo)) errors.policyRepo = "Enter the policy repository as host/owner/repository or an HTTPS URL. Do not include credentials or query parameters.";
  if (!listOfStrings(organization.emails, 20) || organization.emails.some((email) => !EMAIL.test(email)) || new Set(organization.emails.map((email) => email.toLowerCase())).size !== organization.emails.length) errors.emails = "Enter up to 20 distinct email addresses, separated by commas or new lines.";
  else if (role === "admin" && organization.emails.length === 0) errors.emails = "Enter at least one organization contact email.";
  return errors;
}

export const REVIEWER_KINDS = ["individual", "organization"];
const REVIEWER_MESSAGE = "Choose individual or organization and enter an identity (up to 254 characters, no leading or trailing spaces), or leave it empty.";

/** Optional reviewing identity: absent means not set. A present value must be exact. */
export function reviewerErrors(reviewer) {
  if (reviewer === undefined) return {};
  const valid = exactKeys(reviewer, ["kind", "id"]) && REVIEWER_KINDS.includes(reviewer.kind)
    && boundedText(reviewer.id, 254) && reviewer.id.length > 0 && reviewer.id === reviewer.id.trim();
  return valid ? {} : { reviewer: REVIEWER_MESSAGE };
}

/** Validate the settings envelope, never a policy or an upstream package record. */
export function settingsErrors(value) {
  // Older files have no reviewer key; "not set" is that key's absence.
  const base = ["format", "version", "experience", "role", "organization", "capabilities", "clients"];
  const reviewed = plain(value) && Object.hasOwn(value, "reviewer");
  if (!exactKeys(value, reviewed ? [...base, "reviewer"] : base)) return { settings: "The setup file has an unexpected structure." };
  const errors = reviewed && value.reviewer === undefined ? { reviewer: REVIEWER_MESSAGE } : reviewerErrors(value.reviewer);
  if (value.format !== SETTINGS_FORMAT || value.version !== SETTINGS_VERSION) errors.version = "This setup version is not supported.";
  if (!["vibe", "enterprise"].includes(value.experience)) errors.experience = "Choose Vibe coder or Enterprise.";
  if (value.experience === "enterprise") {
    if (!["admin", "developer"].includes(value.role)) errors.role = "Choose Admin or Developer.";
    if (value.role === "admin" || (value.role === "developer" && value.organization !== null)) {
      // Older Developer settings carried organization details. Keep them readable
      // without making those local preferences a required policy source.
      Object.assign(errors, organizationErrors(value.organization, value.role));
    }
  } else if (value.role !== null || value.organization !== null) errors.organization = "Vibe setup does not carry enterprise organization details.";
  if (!listOfStrings(value.capabilities, RETIRED_ASSISTANCE.length) || value.capabilities.some((id) => !RETIRED_ASSISTANCE.includes(id))) errors.capabilities = "The setup names assistance this Workbench never offered.";
  if (!listOfStrings(value.clients, 100)) errors.clients = "AI client choices must be a list of distinct supported identifiers.";
  return errors;
}

/** The mode the setup's policy is composed in: every Enterprise setup, Admin or Developer, is an Enterprise policy the organisation governs. */
export const authoringMode = (settings) => (settings?.experience === "enterprise" ? "enterprise" : "vibe");
