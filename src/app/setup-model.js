/* UI preferences only. These values never grant policy authority or run tools. */
export const SETTINGS_FORMAT = "aih-ui-settings";
export const SETTINGS_VERSION = 1;
export const SETTINGS_LOCATION = ".aih-ui/settings.v1.json";

export const CAPABILITIES = [
  { id: "code-review", title: "Code review", icon: "rate_review", benefit: "Request help reviewing code changes and spotting issues.", skipped: "No AIH code-review assistance is requested." },
  { id: "codebase-memory", title: "Codebase memory", icon: "neurology", benefit: "Request help retaining useful project context across sessions.", skipped: "No AIH project-memory assistance is requested." },
  { id: "workspace-help", title: "Workspace help", icon: "folder_open", benefit: "Request help understanding and navigating a workspace.", skipped: "No AIH workspace assistance is requested." },
  { id: "headroom", title: "Headroom", icon: "monitoring", benefit: "Express interest in help managing available context capacity.", skipped: "No Headroom assistance is requested." },
  { id: "serena", title: "Serena", icon: "code", benefit: "Express interest in help navigating and editing code by symbol.", skipped: "No Serena assistance is requested." },
  { id: "context-optimization", title: "Context / token optimization", icon: "compress", benefit: "Request help keeping relevant context concise and reducing avoidable token use.", skipped: "No AIH context or token optimization is requested." },
];

export function experienceLabel(settings) {
  if (settings.experience === "vibe") return "Vibe coder";
  return settings.role === "admin" ? "Enterprise Admin" : "Enterprise Developer";
}

export function emptySettings() {
  return { format: SETTINGS_FORMAT, version: SETTINGS_VERSION, experience: null, role: null, organization: null, capabilities: [], clients: [] };
}

/** UI defaults apply only to a new draft, never to saved settings. */
export function newSetupSettings() {
  return { ...emptySettings(), capabilities: CAPABILITIES.map(({ id }) => id) };
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

/** Validate the settings envelope, never a policy or an upstream package record. */
export function settingsErrors(value) {
  if (!exactKeys(value, ["format", "version", "experience", "role", "organization", "capabilities", "clients"])) return { settings: "The setup file has an unexpected structure." };
  const errors = {};
  if (value.format !== SETTINGS_FORMAT || value.version !== SETTINGS_VERSION) errors.version = "This setup version is not supported.";
  if (!["vibe", "enterprise"].includes(value.experience)) errors.experience = "Choose Vibe coder or Enterprise.";
  if (value.experience === "enterprise") {
    if (!["admin", "developer"].includes(value.role)) errors.role = "Choose Admin or Developer.";
    Object.assign(errors, organizationErrors(value.organization, value.role));
  } else if (value.role !== null || value.organization !== null) errors.organization = "Vibe setup does not carry enterprise organization details.";
  if (!listOfStrings(value.capabilities, CAPABILITIES.length) || value.capabilities.some((id) => !CAPABILITIES.some((item) => item.id === id))) errors.capabilities = "Choose only the listed optional capabilities.";
  if (!listOfStrings(value.clients, 100)) errors.clients = "AI client choices must be a list of distinct supported identifiers.";
  return errors;
}
